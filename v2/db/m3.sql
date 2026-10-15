-- =====================================================================
--  M3 · Beleg-Scanner: Produkte, Kürzel-Wörterbuch und Anhänge werden abgeglichen
--  Läuft im Browser und auf dem Server (nach m2.sql).
-- =====================================================================

-- 1. Anhänge: abgeglichen werden nur die Angaben, die Datei selbst bleibt auf dem Handy, das sie aufgenommen hat
alter table attachment add column updated_at timestamptz not null default now();
create trigger t_touch before update on attachment for each row execute function touch_updated_at();
create trigger t_touch before update on receipt_alias_mapping for each row execute function touch_updated_at();

-- 2. Abgleich: Eltern vor Kindern (Produkt vor Kürzel, Anhang vor Beleg)
create or replace function sync_tables() returns table (ord int, name text, pk text)
language sql immutable as $$
  values (1, 'household', 'id'), (2, 'household_member', 'id'), (3, 'household_setting', 'household_id'),
         (4, 'person', 'id'), (5, 'person_income', 'id'), (6, 'account', 'id'), (7, 'account_owner', 'id'),
         (8, 'life_area', 'id'), (9, 'category', 'id'), (10, 'payment_method', 'id'),
         (11, 'merchant', 'id'), (12, 'master_product', 'id'), (13, 'receipt_alias_mapping', 'id'), (14, 'attachment', 'id'),
         (15, 'transaction_header', 'id'), (16, 'line_item', 'id'),
         (17, 'line_item_discount', 'id'), (18, 'transaction_payment', 'id'), (19, 'transfer', 'id')
$$;

-- 3. Feste IDs aus dem Inhalt: Legen zwei Handys offline dasselbe Produkt, dasselbe Kürzel oder dieselbe Datei an,
--    entsteht dieselbe ID. Der Server führt sie dann zusammen, statt an der Eindeutigkeit zu scheitern.
create function stabile_id(p_art text, variadic p_teile text[]) returns uuid language sql immutable as $$
  select md5(p_art || '|' || array_to_string(p_teile, '|'))::uuid
$$;

-- Produkt (MasterProduct) zum Namen holen oder anlegen; die Kategorie wird übernommen, wenn eine angegeben ist
create function produkt_sichern(p_household uuid, p_name text, p_category uuid, p_unit comparison_unit)
returns uuid language plpgsql as $$
declare v_name text := btrim(regexp_replace(p_name, '\s+', ' ', 'g')); v_id uuid;
begin
  if v_name = '' then raise exception 'Produktname fehlt'; end if;
  select id into v_id from master_product where household_id = p_household and lower(name) = lower(v_name) limit 1;
  if v_id is null then
    v_id := stabile_id('produkt', p_household::text, lower(v_name));
    insert into master_product (id, household_id, name, category_id, comparison_unit)
    values (v_id, p_household, v_name, p_category, coalesce(p_unit, 'per_piece'))
    on conflict (id) do nothing;
  elsif p_category is not null then
    update master_product set category_id = p_category where id = v_id and category_id is distinct from p_category;
  end if;
  return v_id;
end $$;

-- Kürzel lernen (ersetzt die Fassung aus M1: feste ID, sonst gleich)
create or replace function confirm_alias(p_household uuid, p_merchant uuid, p_raw text, p_master uuid, p_merchant_product uuid,
                                         p_unit_price numeric, p_was_suggestion_correct boolean) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into receipt_alias_mapping (id, household_id, merchant_id, raw_text_key, raw_text_sample, master_product_id, merchant_product_id,
                                     source, times_seen, times_confirmed, last_unit_price)
  values (stabile_id('kuerzel', p_household::text, p_merchant::text, alias_key(p_raw)), p_household, p_merchant, alias_key(p_raw), p_raw,
          p_master, p_merchant_product, 'user_confirmed', 1, 1, p_unit_price)
  on conflict (household_id, merchant_id, raw_text_key) do update set
    times_seen        = receipt_alias_mapping.times_seen + 1,
    times_confirmed   = receipt_alias_mapping.times_confirmed + case when p_was_suggestion_correct then 1 else 0 end,
    times_corrected   = receipt_alias_mapping.times_corrected + case when p_was_suggestion_correct then 0 else 1 end,
    master_product_id = excluded.master_product_id,
    merchant_product_id = coalesce(excluded.merchant_product_id, receipt_alias_mapping.merchant_product_id),
    raw_text_sample   = excluded.raw_text_sample,
    last_unit_price   = excluded.last_unit_price,
    source            = case when p_was_suggestion_correct then receipt_alias_mapping.source else 'user_confirmed' end,
    last_seen_at      = now()
  returning id into v_id;
  return v_id;
end $$;

-- 4. Vorschläge für die Zeilen eines Belegs: bekanntes Kürzel beim gleichen Laden → Produkt und Kategorie.
--    «sicher» = automatisch übernehmen (Blueprint §3.3: confidence ≥ 0.85 und mindestens 2 Bestätigungen)
create function kuerzel_vorschlaege(p_household uuid, p_merchant uuid, p_raws text[])
returns table (nr int, raw text, schluessel text, kuerzel_id uuid, produkt_id uuid, produkt text, category_id uuid,
               confidence numeric, times_confirmed int, last_unit_price numeric, sicher boolean)
language sql stable as $$
  select r.nr::int, r.raw, alias_key(r.raw), m.id, mp.id, mp.name, mp.category_id, m.confidence, m.times_confirmed, m.last_unit_price,
         coalesce(m.confidence >= 0.85 and m.times_confirmed >= 2, false)
    from unnest(p_raws) with ordinality as r(raw, nr)
    left join receipt_alias_mapping m on m.household_id = p_household and m.merchant_id = p_merchant and m.raw_text_key = alias_key(r.raw)
    left join master_product mp on mp.id = m.master_product_id and mp.deleted_at is null
   order by r.nr
$$;

-- 5. Scan-Protokoll (nur auf dem Gerät) darf das Löschen eines Belegs nicht verhindern
alter table scan_job drop constraint scan_job_transaction_id_fkey,
  add constraint scan_job_transaction_id_fkey foreign key (transaction_id) references transaction_header on delete set null;
alter table scan_job drop constraint scan_job_duplicate_of_txn_id_fkey,
  add constraint scan_job_duplicate_of_txn_id_fkey foreign key (duplicate_of_txn_id) references transaction_header on delete set null;
