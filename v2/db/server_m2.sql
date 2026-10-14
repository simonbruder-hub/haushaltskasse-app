-- =====================================================================
--  M2 · nur auf dem Server: Stempel, Löschprotokoll, Zugriffsschutz für Belege
-- =====================================================================
do $$
declare t record;
begin
  for t in select s.name, s.pk from sync_tables() s
            where not exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                               where c.relname = s.name and g.tgname = 't_stamp') loop
    execute format('create trigger t_stamp before insert on %I for each row execute function sync_stamp()', t.name);
    execute format('create trigger t_tombstone after delete on %I for each row execute function sync_record_delete(%L)', t.name, t.pk);
  end loop;
end $$;

-- Belegtabellen haben jetzt household_id: einfache Regel statt Umweg über den Belegkopf
drop policy hh_all on transaction_payment;
drop policy hh_all on line_item;
drop policy hh_all on line_item_discount;
create policy hh_all on transaction_payment for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));
create policy hh_all on line_item for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));
create policy hh_all on line_item_discount for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));

-- Auf dem Server dürfen Fach-Trigger den Abgleich nie blockieren: Kopf, Positionen und Zahlungen kommen
-- nacheinander an, Zwischenstände sind unvollständig. Die Handys rechnen ihre Anteile ohnehin selbst.
create or replace function on_transaction_confirm() returns trigger language plpgsql as $$
begin
  begin
    perform recompute_allocations(new.id);
    perform record_price_observations(new.id);
  exception when others then
    raise notice 'Nachberechnung übersprungen: %', sqlerrm;
  end;
  return null;
end $$;
create or replace function refresh_allocations() returns trigger language plpgsql as $$
declare v_txn uuid := coalesce(new.transaction_id, old.transaction_id);
begin
  begin
    if exists (select 1 from transaction_header where id = v_txn and status = 'confirmed') then
      perform recompute_allocations(v_txn);
    end if;
  exception when others then
    raise notice 'Nachberechnung übersprungen: %', sqlerrm;
  end;
  return null;
end $$;
create or replace function refresh_allocations_header() returns trigger language plpgsql as $$
begin
  begin
    perform recompute_allocations(new.id);
  exception when others then
    raise notice 'Nachberechnung übersprungen: %', sqlerrm;
  end;
  return null;
end $$;

-- ---------- Stand der Server-Datenbank ----------
-- Die App gleicht erst ab, wenn der Server mindestens ihren Stand hat; sonst fehlten auf dem Server neue Spalten
-- und ein Teil der Daten käme an, der Rest nicht. Jede spätere Server-Migration ersetzt die Funktion mit ihrer Nummer.
create or replace function app_schema_version() returns int language sql stable as $$ select 2 $$;
grant execute on function app_schema_version() to authenticated;
