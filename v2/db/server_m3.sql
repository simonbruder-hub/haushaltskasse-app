-- =====================================================================
--  M3 · nur auf dem Server: Stempel und Löschprotokoll für Produkte, Kürzel und Anhänge
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

-- Stand der Server-Datenbank (siehe server_m2.sql)
create or replace function app_schema_version() returns int language sql stable as $$ select 3 $$;
grant execute on function app_schema_version() to authenticated;
