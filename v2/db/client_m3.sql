-- =====================================================================
--  M3 · nur im Browser: Outbox für die neuen Tabellen
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
