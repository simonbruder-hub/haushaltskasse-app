-- =====================================================================
--  M5 · nur auf dem Server: Stempel, Löschprotokoll und Zugriffsschutz für Budgets, Fixkosten, Verträge, Sparziele
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

-- Sparraten haben jetzt household_id: einfache Regel statt Umweg über den Fonds
drop policy hh_all on sinking_fund_entry;
create policy hh_all on sinking_fund_entry for all to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));

-- Neue Views mit den Rechten der abfragenden Person (siehe server_m4.sql)
do $$
declare v record;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and coalesce(c.reloptions::text, '') not like '%security_invoker%' loop
    execute format('alter view %I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- Stand der Server-Datenbank (siehe server_m2.sql)
create or replace function app_schema_version() returns int language sql stable as $$ select 5 $$;
grant execute on function app_schema_version() to authenticated;
