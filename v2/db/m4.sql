-- =====================================================================
--  M4 · Produkte und Preise, dazu Nacharbeiten M3 (ähnliche Kürzel, Kosten pro Scan)
--  Läuft im Browser und auf dem Server (nach m3.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ähnliche Kürzel (Blueprint §3.3, Stufe 3)
--    Trigramm-Ähnlichkeit nach den Regeln von pg_trgm, aber in reinem SQL: läuft so ohne Erweiterung
--    im Browser, auf dem Server und in den Tests gleich.
-- ---------------------------------------------------------------------
create function trigramme(p text) returns text[] language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct substr('  ' || w || ' ', i, 3)), '{}')
    from regexp_split_to_table(lower(coalesce(p, '')), '[^[:alnum:]]+') w, generate_series(1, length(w) + 1) i
   where w <> ''
$$;
create function aehnlichkeit(a text, b text) returns real language sql immutable parallel safe as $$
  with x as (select trigramme(a) as ta, trigramme(b) as tb),
       y as (select cardinality(ta) as na, cardinality(tb) as nb, (select count(*) from unnest(ta) t where t = any(tb)) as gemeinsam from x)
  select case when na + nb - gemeinsam = 0 then 0 else gemeinsam::real / (na + nb - gemeinsam) end from y
$$;

-- Vorschläge für die Zeilen eines Belegs: exakter Treffer (wie M3), sonst das ähnlichste Kürzel beim gleichen Laden
-- (Ähnlichkeit ≥ 0.55). Ein ähnliches Kürzel ist nie «sicher» und liefert keinen Vergleichspreis (andere Packung möglich).
drop function kuerzel_vorschlaege(uuid, uuid, text[]);
create function kuerzel_vorschlaege(p_household uuid, p_merchant uuid, p_raws text[])
returns table (nr int, raw text, schluessel text, kuerzel_id uuid, produkt_id uuid, produkt text, category_id uuid,
               confidence numeric, times_confirmed int, last_unit_price numeric, sicher boolean,
               aehnlich_wie text, aehnlichkeit real, artikel_id uuid, unit_size numeric, unit_type unit_type, pack_count int)
language sql stable as $$
  with r as (select x.raw, x.nr::int as nr, alias_key(x.raw) as k from unnest(p_raws) with ordinality as x(raw, nr)),
  wahl as (
    select r.*, e.id as exakt, a.id as aehnlich, a.sim
      from r
      left join receipt_alias_mapping e on e.household_id = p_household and e.merchant_id = p_merchant and e.raw_text_key = r.k
      left join lateral (
        select m.id, s.sim from receipt_alias_mapping m, lateral (select aehnlichkeit(r.k, m.raw_text_key) as sim) s
         where e.id is null and length(r.k) >= 3 and m.household_id = p_household and m.merchant_id = p_merchant and s.sim >= 0.55
         order by s.sim desc, m.times_confirmed desc limit 1) a on true)
  select w.nr, w.raw, w.k, z.id, mp.id, mp.name, mp.category_id, z.confidence, z.times_confirmed,
         case when w.exakt is not null then z.last_unit_price end,
         coalesce(w.exakt is not null and z.confidence >= 0.85 and z.times_confirmed >= 2 and mp.id is not null, false),
         case when w.exakt is null then z.raw_text_sample end, w.sim,
         case when w.exakt is not null then ap.id end, case when w.exakt is not null then ap.unit_size end,
         case when w.exakt is not null then ap.unit_type end, case when w.exakt is not null then ap.pack_count end
    from wahl w
    left join receipt_alias_mapping z on z.id = coalesce(w.exakt, w.aehnlich)
    left join master_product mp on mp.id = z.master_product_id and mp.deleted_at is null
    left join merchant_product ap on ap.id = z.merchant_product_id and ap.deleted_at is null
   order by w.nr
$$;

-- ---------------------------------------------------------------------
-- 2. Kosten pro KI-Scan (USD, aus den Token-Zahlen der Antwort; nur auf dem Gerät)
-- ---------------------------------------------------------------------
alter table scan_job add column cost_usd numeric(10,6);

-- ---------------------------------------------------------------------
-- 3. Produkte: zusammenführen, Vergleichseinheit, Artikel pro Laden
-- ---------------------------------------------------------------------
alter table master_product add column merged_into uuid references master_product;
alter table merchant_product add column receipt_key text;   -- alias_key des Belegtexts, wenn der Artikel aus Belegen stammt
create index merchant_product_key_ix on merchant_product (household_id, merchant_id, receipt_key);

-- Produkt zum Namen holen oder anlegen (wie M3); ein zusammengeführtes Produkt verweist auf das neue
create or replace function produkt_sichern(p_household uuid, p_name text, p_category uuid, p_unit comparison_unit)
returns uuid language plpgsql as $$
declare v_name text := btrim(regexp_replace(p_name, '\s+', ' ', 'g')); v_id uuid; v_ziel uuid; i int := 0;
begin
  if v_name = '' then raise exception 'Produktname fehlt'; end if;
  select id into v_id from master_product where household_id = p_household and lower(name) = lower(v_name) limit 1;
  loop   -- Kette der Zusammenführungen folgen
    select merged_into into v_ziel from master_product where id = v_id;
    exit when v_ziel is null or i > 10;
    v_id := v_ziel; i := i + 1;
  end loop;
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

-- Vergleichseinheit oder Dichte ändern: alle Preise des Produkts neu normalisieren (Trigger auf price_observation)
create function vergleich_setzen(p_master uuid, p_unit comparison_unit, p_density numeric) returns void language plpgsql as $$
begin
  update master_product set comparison_unit = p_unit, density_g_per_ml = p_density
   where id = p_master and (comparison_unit, density_g_per_ml) is distinct from (p_unit, p_density);
  update price_observation set comparison_unit = p_unit where master_product_id = p_master;
  perform preisalarme_rechnen(household_id, id) from master_product where id = p_master;
end $$;

-- Zwei Produkte zusammenführen («Milch» → «Vollmilch»): Artikel, Kürzel, Positionen und Preise wandern mit
create function produkte_zusammenfuehren(p_household uuid, p_von uuid, p_nach uuid) returns void language plpgsql as $$
declare v_unit comparison_unit;
begin
  if p_von = p_nach then return; end if;
  if not exists (select 1 from master_product where id = p_nach and household_id = p_household and deleted_at is null) then
    raise exception 'Zielprodukt fehlt';
  end if;
  select comparison_unit into v_unit from master_product where id = p_nach;
  update merchant_product set master_product_id = p_nach where household_id = p_household and master_product_id = p_von;
  update receipt_alias_mapping set master_product_id = p_nach where household_id = p_household and master_product_id = p_von;
  update line_item set master_product_id = p_nach where household_id = p_household and master_product_id = p_von;
  update shopping_list_item set master_product_id = p_nach where master_product_id = p_von;
  update price_observation set master_product_id = p_nach, comparison_unit = v_unit where household_id = p_household and master_product_id = p_von;
  update price_alert set master_product_id = p_nach where household_id = p_household and master_product_id = p_von;
  update master_product set merged_into = p_nach, deleted_at = now() where id = p_von;
  perform preisalarme_rechnen(p_household, p_nach);
end $$;

-- «1L», «280G», «6X1.5L», «10STK» aus einem Belegschlüssel entfernen: gleiches Produkt in anderer Packung erkennen
create function ohne_groesse(p_key text) returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_key, ''),
    '\y\d+([.,]\d+)?\s*[X×]\s*\d+([.,]\d+)?\s*(KG|G|L|ML|CL|DL)\y', ' ', 'g'),
    '\y\d+([.,]\d+)?\s*(KG|G|L|ML|CL|DL|STK|ST|STUECK)\y', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Wird ein Produkt mit Grösse (g, ml) bekannt, zählt pro kg bzw. l statt pro Stück – solange nur Stückpreise ohne Grösse fehlen
create function vergleich_aus_packung(p_master uuid, p_unit_type unit_type) returns void language plpgsql as $$
declare v_neu comparison_unit;
begin
  v_neu := case unit_dimension(p_unit_type) when 'mass' then 'per_1kg' when 'volume' then 'per_1l' end;
  if v_neu is null then return; end if;
  if exists (select 1 from master_product where id = p_master and comparison_unit = 'per_piece')
     and not exists (select 1 from price_observation where master_product_id = p_master and base_dimension = 'count') then
    perform vergleich_setzen(p_master, v_neu, (select density_g_per_ml from master_product where id = p_master));
  end if;
end $$;

-- Artikel (MerchantProduct) zu einer Belegzeile: pro Laden und Belegtext genau einer (feste ID über Geräte hinweg).
-- Gleicher Text ohne Grösse, aber neue Packung → Nachfolger des alten Artikels (replaces_id, Shrinkflation-Kette).
create function artikel_sichern(p_household uuid, p_merchant uuid, p_raw text, p_master uuid,
                                p_unit_size numeric, p_unit_type unit_type, p_pack_count int) returns uuid language plpgsql as $$
declare
  v_key text := alias_key(p_raw); v_basis text; v_id uuid; v_vorg uuid;
  v_typ unit_type := case when p_unit_size is not null then coalesce(p_unit_type, 'piece') end;
  v_anz int := case when p_unit_size is not null then greatest(coalesce(p_pack_count, 1), 1) else 1 end;
begin
  if p_merchant is null or p_master is null or coalesce(v_key, '') = '' then return null; end if;
  v_basis := ohne_groesse(v_key);
  v_id := stabile_id('artikel', p_household::text, p_merchant::text, v_key);
  if exists (select 1 from merchant_product where id = v_id) then
    update merchant_product
       set master_product_id = p_master, deleted_at = null,
           unit_size = coalesce(p_unit_size, unit_size), unit_type = coalesce(v_typ, unit_type),
           pack_count = case when p_unit_size is not null then v_anz else pack_count end
     where id = v_id
       and (master_product_id is distinct from p_master or deleted_at is not null
            or (p_unit_size is not null and (unit_size, unit_type, pack_count) is distinct from (p_unit_size, v_typ, v_anz)));
  else
    if v_basis <> v_key and length(v_basis) >= 3 then
      select id into v_vorg from merchant_product
       where household_id = p_household and merchant_id = p_merchant and receipt_key is not null and receipt_key <> v_key
         and receipt_key <> ohne_groesse(receipt_key) and ohne_groesse(receipt_key) = v_basis and deleted_at is null
       order by updated_at desc limit 1;
    end if;
    insert into merchant_product (id, household_id, master_product_id, merchant_id, name, receipt_key, unit_size, unit_type, pack_count, replaces_id)
    values (v_id, p_household, p_master, p_merchant, v_key, v_key, p_unit_size, v_typ, v_anz, v_vorg)
    on conflict (id) do nothing;
  end if;
  if p_unit_size is not null then perform vergleich_aus_packung(p_master, v_typ); end if;
  return v_id;
end $$;

-- Artikel mit EAN (aus dem Laden oder OpenFoodFacts): eine pro Haushalt und EAN, unabhängig vom Laden
create function ean_artikel_sichern(p_household uuid, p_ean text, p_master uuid, p_name text, p_brand text,
                                    p_unit_size numeric, p_unit_type unit_type, p_pack_count int, p_bild text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_typ unit_type := case when p_unit_size is not null then coalesce(p_unit_type, 'piece') end;
  v_anz int := case when p_unit_size is not null then greatest(coalesce(p_pack_count, 1), 1) else 1 end;
begin
  if p_ean !~ '^[0-9]{8,14}$' then raise exception 'EAN ungültig'; end if;
  select id into v_id from merchant_product where household_id = p_household and ean = p_ean and deleted_at is null;
  v_id := coalesce(v_id, stabile_id('ean', p_household::text, p_ean));
  insert into merchant_product (id, household_id, master_product_id, ean, brand, name, unit_size, unit_type, pack_count, image_url, off_ean)
  values (v_id, p_household, p_master, p_ean, nullif(btrim(p_brand), ''), coalesce(nullif(btrim(p_name), ''), p_ean), p_unit_size, v_typ, v_anz, p_bild, p_ean)
  on conflict (id) do update set
    master_product_id = excluded.master_product_id, brand = coalesce(excluded.brand, merchant_product.brand), name = excluded.name,
    unit_size = excluded.unit_size, unit_type = excluded.unit_type, pack_count = excluded.pack_count,
    image_url = coalesce(excluded.image_url, merchant_product.image_url), deleted_at = null
  where (merchant_product.master_product_id, merchant_product.name, merchant_product.unit_size, merchant_product.unit_type, merchant_product.pack_count,
         merchant_product.deleted_at is null)
        is distinct from (excluded.master_product_id, excluded.name, excluded.unit_size, excluded.unit_type, excluded.pack_count, true)
     or (excluded.brand is not null and excluded.brand is distinct from merchant_product.brand)
     or (excluded.image_url is not null and excluded.image_url is distinct from merchant_product.image_url);
  if p_unit_size is not null then perform vergleich_aus_packung(p_master, v_typ); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. Regalpreise aus dem Laden (EAN-Scan) – werden abgeglichen; die Preisbeobachtung rechnet jedes Gerät selbst
-- ---------------------------------------------------------------------
create table shelf_price (
  id                  uuid primary key,
  household_id        uuid not null references household on delete cascade,
  merchant_id         uuid not null references merchant,
  merchant_product_id uuid not null references merchant_product,
  observed_on         date not null,
  price               numeric(12,2) not null check (price > 0),            -- Preis am Regal bzw. Aktionspreis, pro Packung
  regular_price       numeric(12,2) check (regular_price > 0),             -- bei einer Aktion: der Normalpreis, wenn angeschrieben
  is_promo            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (regular_price is null or regular_price >= price)
);
create index shelf_price_product_ix on shelf_price (merchant_product_id);
create trigger t_touch before update on shelf_price for each row execute function touch_updated_at();

alter table price_observation add column shelf_price_id uuid references shelf_price on delete cascade;
create index price_obs_shelf_ix on price_observation (shelf_price_id);

create function record_shelf_price(p_id uuid) returns void language plpgsql as $$
begin
  delete from price_observation where shelf_price_id = p_id;
  insert into price_observation (household_id, merchant_id, merchant_product_id, master_product_id, shelf_price_id, observed_on, source,
                                 unit_regular_price, unit_paid_price, is_promo, regular_known, unit_base_quantity, base_dimension, comparison_unit)
  select s.household_id, s.merchant_id, s.merchant_product_id, a.master_product_id, s.id, s.observed_on, 'ean_live_check',
         coalesce(s.regular_price, s.price), s.price, s.is_promo, not s.is_promo or s.regular_price is not null,
         base_quantity(1, 'piece', a.unit_size, a.unit_type, a.pack_count), base_dimension('piece', a.unit_size, a.unit_type), m.comparison_unit
    from shelf_price s join merchant_product a on a.id = s.merchant_product_id join master_product m on m.id = a.master_product_id
   where s.id = p_id;
  perform preisalarme_rechnen(o.household_id, o.master_product_id) from price_observation o where o.shelf_price_id = p_id;
end $$;
create function on_shelf_price() returns trigger language plpgsql as $$
begin
  perform record_shelf_price(new.id);
  return null;
end $$;
create trigger t_shelf_price after insert or update on shelf_price for each row execute function on_shelf_price();

-- ---------------------------------------------------------------------
-- 5. Preisalarme: «gelesen» übersteht das Neurechnen und kommt aufs andere Handy
--    Ein Alarm ist eindeutig über Art und Quelle der neuen Beobachtung (Belegposition oder Regalpreis).
-- ---------------------------------------------------------------------
create table price_alert_seen (
  id           uuid primary key,                -- stabile_id('alarm', Haushalt, Art, Quelle)
  household_id uuid not null references household on delete cascade,
  kind         alert_kind not null,
  source_id    uuid not null,
  seen_at      timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger t_touch before update on price_alert_seen for each row execute function touch_updated_at();

create view v_price_alert as
select a.id, a.household_id, a.kind, a.merchant_id, m.name as laden, a.merchant_product_id, a.master_product_id, p.name as produkt,
       o.observed_on, a.old_base_quantity, a.new_base_quantity, a.old_unit_price, a.new_unit_price, a.old_normalized, a.new_normalized,
       a.change_pct, p.comparison_unit, coalesce(o.line_item_id, o.shelf_price_id) as source_id, g.seen_at
  from price_alert a
  join price_observation o on o.id = a.observation_id
  join master_product p on p.id = a.master_product_id
  left join merchant m on m.id = a.merchant_id
  left join price_alert_seen g on g.id = stabile_id('alarm', a.household_id::text, a.kind::text, coalesce(o.line_item_id, o.shelf_price_id)::text);

create function alarm_gelesen(p_household uuid, p_kind alert_kind, p_source uuid) returns void language sql as $$
  insert into price_alert_seen (id, household_id, kind, source_id)
  values (stabile_id('alarm', p_household::text, p_kind::text, p_source::text), p_household, p_kind, p_source)
  on conflict (id) do nothing
$$;

-- ---------------------------------------------------------------------
-- 5b. Preisalarme unabhängig von der Reihenfolge
--    Bisher entstand ein Alarm beim Einfügen einer Beobachtung (Trigger). Nach einem Abgleich rechnet das Handy
--    die Preise der geänderten Belege aber in beliebiger Reihenfolge neu – dann fehlte z. B. ein Preissprung.
--    Neu: Alarme pro Produkt in fester Reihenfolge (Datum, dann Quelle – uuid7, also zeitlich) neu aufbauen.
-- ---------------------------------------------------------------------
drop trigger price_observation_alerts on price_observation;

create function preisalarme_rechnen(p_household uuid, p_master uuid) returns void language plpgsql as $$
declare s household_setting; x price_observation; prev price_observation; v_pct numeric;
begin
  delete from price_alert where household_id = p_household and master_product_id = p_master;
  select * into s from household_setting where household_id = p_household;
  if not found then s.price_jump_threshold_pct := 10; s.shrinkflation_min_size_drop_pct := 2; s.shrinkflation_price_tolerance_pct := 2; end if;
  for x in
    select * from price_observation
     where household_id = p_household and master_product_id = p_master
       and merchant_product_id is not null and regular_known and normalized_regular_base is not null
     order by observed_on, coalesce(line_item_id, shelf_price_id, id)
  loop
    -- Shrinkflation: gleicher Artikel oder sein Vorgänger, Packung kleiner, Packungspreis ~ gleich oder höher
    select o.* into prev from price_observation o
     where o.household_id = p_household and o.regular_known and o.id <> x.id
       and (o.observed_on, coalesce(o.line_item_id, o.shelf_price_id, o.id)) < (x.observed_on, coalesce(x.line_item_id, x.shelf_price_id, x.id))
       and (o.merchant_product_id = x.merchant_product_id
            or o.merchant_product_id = (select replaces_id from merchant_product where id = x.merchant_product_id))
       and o.unit_base_quantity is not null and o.base_dimension = x.base_dimension
     order by o.observed_on desc, coalesce(o.line_item_id, o.shelf_price_id, o.id) desc limit 1;
    if found and x.unit_base_quantity < prev.unit_base_quantity * (1 - s.shrinkflation_min_size_drop_pct / 100)
             and x.unit_regular_price * x.fx_rate >= prev.unit_regular_price * prev.fx_rate * (1 - s.shrinkflation_price_tolerance_pct / 100) then
      v_pct := round(((x.unit_regular_price * x.fx_rate / x.unit_base_quantity)
                    / (prev.unit_regular_price * prev.fx_rate / prev.unit_base_quantity) - 1) * 100, 2);
      insert into price_alert (household_id, kind, merchant_id, merchant_product_id, master_product_id, previous_observation_id, observation_id,
                               old_base_quantity, new_base_quantity, old_unit_price, new_unit_price, old_normalized, new_normalized, change_pct)
      values (p_household, 'shrinkflation', x.merchant_id, x.merchant_product_id, p_master, prev.id, x.id,
              prev.unit_base_quantity, x.unit_base_quantity, prev.unit_regular_price, x.unit_regular_price,
              prev.normalized_regular_base, x.normalized_regular_base, v_pct);
      continue;
    end if;
    -- Preissprung: gleicher Händler, gleicher Artikel, letzter bekannter Normalpreis
    select o.* into prev from price_observation o
     where o.merchant_product_id = x.merchant_product_id and o.merchant_id = x.merchant_id and o.regular_known and o.id <> x.id
       and (o.observed_on, coalesce(o.line_item_id, o.shelf_price_id, o.id)) < (x.observed_on, coalesce(x.line_item_id, x.shelf_price_id, x.id))
     order by o.observed_on desc, coalesce(o.line_item_id, o.shelf_price_id, o.id) desc limit 1;
    if found and prev.unit_regular_price > 0 and prev.unit_base_quantity > 0 and x.unit_base_quantity > 0 then
      v_pct := round(((x.unit_regular_price * x.fx_rate / x.unit_base_quantity)
                    / (prev.unit_regular_price * prev.fx_rate / prev.unit_base_quantity) - 1) * 100, 2);
      if abs(v_pct) >= s.price_jump_threshold_pct then
        insert into price_alert (household_id, kind, merchant_id, merchant_product_id, master_product_id, previous_observation_id, observation_id,
                                 old_base_quantity, new_base_quantity, old_unit_price, new_unit_price, old_normalized, new_normalized, change_pct)
        values (p_household, case when v_pct > 0 then 'price_jump'::alert_kind else 'price_drop'::alert_kind end,
                x.merchant_id, x.merchant_product_id, p_master, prev.id, x.id,
                prev.unit_base_quantity, x.unit_base_quantity, prev.unit_regular_price, x.unit_regular_price,
                prev.normalized_regular_base, x.normalized_regular_base, v_pct);
      end if;
    end if;
  end loop;
end $$;

-- Fällt eine Beobachtung weg (Beleg oder Regalpreis gelöscht, Preise neu erfasst): Alarme der Produkte neu aufbauen
create function on_price_observation_delete() returns trigger language plpgsql as $$
declare r record;
begin
  for r in select distinct household_id, master_product_id from alt loop
    perform preisalarme_rechnen(r.household_id, r.master_product_id);
  end loop;
  return null;
end $$;
create trigger t_preis_weg after delete on price_observation referencing old table as alt
  for each statement execute function on_price_observation_delete();

-- Preise eines Belegs neu erfassen (wie M1), danach die Alarme der betroffenen Produkte neu aufbauen
create or replace function record_price_observations(p_txn uuid) returns void language plpgsql as $$
declare v_hh uuid; v_masters uuid[]; v_m uuid;
begin
  select household_id into v_hh from transaction_header where id = p_txn;
  select array_agg(distinct master_product_id) into v_masters from price_observation
   where line_item_id in (select id from line_item where transaction_id = p_txn);
  delete from price_observation where line_item_id in (select id from line_item where transaction_id = p_txn);
  insert into price_observation (household_id, merchant_id, branch_id, merchant_product_id, master_product_id, line_item_id,
                                 observed_on, source, currency, fx_rate, unit_regular_price, unit_paid_price, is_promo, regular_known,
                                 unit_base_quantity, base_dimension, comparison_unit)
  select h.household_id, h.merchant_id, h.branch_id, l.merchant_product_id, l.master_product_id, l.id,
         h.booking_date, case when h.source_channel = 'loyalty_csv' then 'loyalty_import'::price_source else 'receipt'::price_source end,
         h.currency, h.fx_rate,
         coalesce(l.regular_unit_price, round(l.regular_price / l.quantity, 4)),
         case when l.item_discount = 0 then coalesce(l.regular_unit_price, round(l.regular_price / l.quantity, 4))
              else round(l.final_price / l.quantity, 4) end,
         l.is_promo or l.item_discount > 0, l.item_discount > 0 or not l.is_promo,
         l.base_quantity / l.quantity, l.base_dimension, m.comparison_unit
    from line_item l
    join transaction_header h on h.id = l.transaction_id
    join master_product m on m.id = l.master_product_id
   where l.transaction_id = p_txn and l.item_type = 'product' and l.deleted_at is null and h.merchant_id is not null
     and h.status = 'confirmed' and h.deleted_at is null
   order by l.position;
  for v_m in select distinct x from unnest(coalesce(v_masters, '{}') || array(
               select master_product_id from line_item where transaction_id = p_txn and master_product_id is not null)) x loop
    perform preisalarme_rechnen(v_hh, v_m);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Preisvergleich
--    Aktueller Preis: eine Aktion zählt, solange sie frisch ist (promo_validity_days), sonst der Normalpreis.
-- ---------------------------------------------------------------------
create function produkt_preise(p_household uuid, p_master uuid, p_heute date)
returns table (merchant_id uuid, laden text, merchant_product_id uuid, artikel text, ean text, unit_size numeric, unit_type unit_type,
               pack_count int, beobachtet date, quelle price_source, packungspreis numeric, normalpreis numeric, aktion boolean,
               pro_einheit numeric, alt boolean, guenstigster boolean)
language sql stable as $$
  with s as (
    select coalesce(max(promo_validity_days), 7) as aktion_tage, coalesce(max(price_freshness_days), 60) as frisch_tage
      from household_setting where household_id = p_household),
  letzte as (
    select distinct on (o.merchant_id, o.merchant_product_id) o.*
      from price_observation o
     where o.household_id = p_household and o.master_product_id = p_master and o.observed_on <= p_heute
     order by o.merchant_id, o.merchant_product_id, o.observed_on desc, o.created_at desc),
  x as (
    select l.*, (l.is_promo and l.observed_on > p_heute - s.aktion_tage) as aktion_gilt,
           case when l.is_promo and l.observed_on > p_heute - s.aktion_tage then l.normalized_paid_base else l.normalized_regular_base end as norm,
           l.observed_on <= p_heute - s.frisch_tage as zu_alt
      from letzte l, s)
  select x.merchant_id, m.name, x.merchant_product_id, a.name, a.ean, a.unit_size, a.unit_type, a.pack_count, x.observed_on, x.source,
         round(case when x.aktion_gilt then x.unit_paid_price else x.unit_regular_price end * x.fx_rate, 2),
         round(x.unit_regular_price * x.fx_rate, 2), x.aktion_gilt, x.norm, x.zu_alt,
         x.norm is not null and x.norm = min(x.norm) filter (where not x.zu_alt) over ()
    from x join merchant m on m.id = x.merchant_id left join merchant_product a on a.id = x.merchant_product_id
   order by x.zu_alt, x.norm nulls last, x.observed_on desc
$$;

create function produkt_uebersicht(p_household uuid, p_heute date)
returns table (id uuid, name text, category_id uuid, comparison_unit comparison_unit, laeden int, kaeufe int,
               zuletzt date, bester_preis numeric, bester_laden text, alarme int)
language sql stable as $$
  with s as (
    select coalesce(max(promo_validity_days), 7) as aktion_tage, coalesce(max(price_freshness_days), 60) as frisch_tage
      from household_setting where household_id = p_household),
  letzte as (
    select distinct on (o.master_product_id, o.merchant_id, o.merchant_product_id) o.*
      from price_observation o where o.household_id = p_household and o.observed_on <= p_heute
     order by o.master_product_id, o.merchant_id, o.merchant_product_id, o.observed_on desc, o.created_at desc),
  aktuell as (
    select l.master_product_id, l.merchant_id,
           case when l.is_promo and l.observed_on > p_heute - s.aktion_tage then l.normalized_paid_base else l.normalized_regular_base end as norm
      from letzte l, s where l.observed_on > p_heute - s.frisch_tage),
  bester as (
    select distinct on (a.master_product_id) a.master_product_id, a.norm, m.name as laden
      from aktuell a join merchant m on m.id = a.merchant_id where a.norm is not null
     order by a.master_product_id, a.norm),
  stat as (
    select o.master_product_id, count(distinct o.merchant_id)::int as laeden,
           count(*) filter (where o.line_item_id is not null)::int as kaeufe, max(o.observed_on) as zuletzt
      from price_observation o where o.household_id = p_household group by 1),
  alarme as (
    select master_product_id, count(*)::int as n from v_price_alert where household_id = p_household and seen_at is null group by 1)
  select p.id, p.name, p.category_id, p.comparison_unit, coalesce(st.laeden, 0), coalesce(st.kaeufe, 0), st.zuletzt,
         b.norm, b.laden, coalesce(al.n, 0)
    from master_product p
    left join stat st on st.master_product_id = p.id
    left join bester b on b.master_product_id = p.id
    left join alarme al on al.master_product_id = p.id
   where p.household_id = p_household and p.deleted_at is null
   order by st.zuletzt desc nulls last, p.name
$$;

-- ---------------------------------------------------------------------
-- 7. Abgleich: Artikel nach den Produkten, Regalpreise und gelesene Alarme am Schluss
-- ---------------------------------------------------------------------
create or replace function sync_tables() returns table (ord int, name text, pk text)
language sql immutable as $$
  values (1, 'household', 'id'), (2, 'household_member', 'id'), (3, 'household_setting', 'household_id'),
         (4, 'person', 'id'), (5, 'person_income', 'id'), (6, 'account', 'id'), (7, 'account_owner', 'id'),
         (8, 'life_area', 'id'), (9, 'category', 'id'), (10, 'payment_method', 'id'),
         (11, 'merchant', 'id'), (12, 'master_product', 'id'), (13, 'merchant_product', 'id'), (14, 'receipt_alias_mapping', 'id'),
         (15, 'attachment', 'id'), (16, 'transaction_header', 'id'), (17, 'line_item', 'id'),
         (18, 'line_item_discount', 'id'), (19, 'transaction_payment', 'id'), (20, 'transfer', 'id'),
         (21, 'shelf_price', 'id'), (22, 'price_alert_seen', 'id')
$$;
