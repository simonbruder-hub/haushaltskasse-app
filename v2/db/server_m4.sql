-- =====================================================================
--  M4 · nur auf dem Server: Stempel, Löschprotokoll und Zugriffsschutz für Artikel, Regalpreise und gelesene Alarme
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

-- Neue Tabellen: nur der eigene Haushalt (merchant_product hat seine Regel schon seit M1)
alter table shelf_price enable row level security;
alter table price_alert_seen enable row level security;
create policy hh_all on shelf_price for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));
create policy hh_all on price_alert_seen for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));

-- Views mit den Rechten der abfragenden Person auswerten: sonst umgehen sie über die Supabase-Schnittstelle
-- den Zugriffsschutz (betrifft auch die Views seit M1; die App selbst liest sie auf dem Server nicht)
do $$
declare v record;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('alter view %I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- Fach-Trigger dürfen den Abgleich nie blockieren (siehe server_m2.sql); die Handys rechnen die Preise selbst
create or replace function on_shelf_price() returns trigger language plpgsql as $$
begin
  begin
    perform record_shelf_price(new.id);
  exception when others then
    raise notice 'Nachberechnung übersprungen: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function on_price_observation_delete() returns trigger language plpgsql as $$
declare r record;
begin
  begin
    for r in select distinct household_id, master_product_id from alt loop
      perform preisalarme_rechnen(r.household_id, r.master_product_id);
    end loop;
  exception when others then
    raise notice 'Nachberechnung übersprungen: %', sqlerrm;
  end;
  return null;
end $$;

-- Stand der Server-Datenbank (siehe server_m2.sql)
create or replace function app_schema_version() returns int language sql stable as $$ select 4 $$;
grant execute on function app_schema_version() to authenticated;
