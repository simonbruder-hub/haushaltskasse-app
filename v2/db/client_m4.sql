-- =====================================================================
--  M4 · nur im Browser: Outbox für Artikel, Regalpreise und gelesene Alarme; Nachbearbeitung nach dem Abgleich
-- =====================================================================
do $$
declare t record;
begin
  for t in select s.name, s.pk from sync_tables() s
            where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                               where c.relname = s.name and g.tgname = 't_outbox') loop
    execute format('create trigger t_outbox after insert or update or delete on %I for each row execute function _outbox_record(%L)', t.name, t.pk);
  end loop;
end $$;

-- Wie M2, dazu: Regalpreise (auch wenn sich ihr Artikel geändert hat) und neu normalisierte Preise,
-- wenn sich Vergleichseinheit oder Dichte eines Produkts geändert haben.
-- Serverdaten kommen ohne Trigger an; auch Löschweitergaben (on delete cascade) laufen dabei nicht.
create or replace function sync_after_pull(p_changed jsonb) returns void language plpgsql as $$
declare v_txn uuid; v_id uuid;
begin
  delete from line_item_allocation a where not exists (select 1 from line_item l where l.id = a.line_item_id);
  delete from payment_share s where not exists (select 1 from transaction_payment p where p.id = s.payment_id);
  delete from price_observation o where o.line_item_id is not null and not exists (select 1 from line_item l where l.id = o.line_item_id);
  delete from price_observation o where o.shelf_price_id is not null and not exists (select 1 from shelf_price s where s.id = o.shelf_price_id);
  for v_txn in
    select distinct t from (
      select x::uuid as t from jsonb_array_elements_text(coalesce(p_changed -> 'transaction_header', '[]')) x
      union select l.transaction_id from line_item l
             where l.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'line_item', '[]')) x)
      union select p.transaction_id from transaction_payment p
             where p.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'transaction_payment', '[]')) x)
      union select l.transaction_id from line_item_discount d join line_item l on l.id = d.line_item_id
             where d.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'line_item_discount', '[]')) x)
      union select l.transaction_id from line_item l
             where l.merchant_product_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'merchant_product', '[]')) x)
    ) s where t is not null
  loop
    if exists (select 1 from transaction_header where id = v_txn and status = 'confirmed') then
      perform recompute_allocations(v_txn);
      perform record_price_observations(v_txn);
    end if;
  end loop;
  for v_id in
    select s.id from shelf_price s
     where s.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'shelf_price', '[]')) x)
        or s.merchant_product_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'merchant_product', '[]')) x)
  loop
    perform record_shelf_price(v_id);
  end loop;
  update price_observation o set comparison_unit = m.comparison_unit
    from master_product m
   where m.id = o.master_product_id
     and m.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'master_product', '[]')) x);
  perform preisalarme_rechnen(m.household_id, m.id) from master_product m
    where m.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_changed -> 'master_product', '[]')) x);
  -- Schwellen für Preisalarme geändert
  perform alle_preisalarme_rechnen(x::uuid) from jsonb_array_elements_text(coalesce(p_changed -> 'household_setting', '[]')) x;
end $$;
