-- =====================================================================
--  Nur im Browser (PGlite): Änderungsprotokoll für die Synchronisation
--  Jede lokale Änderung an einer synchronisierten Tabelle landet in _outbox.
--  Beim Übernehmen von Serverdaten läuft die Sitzung mit session_replication_role = replica:
--  dann feuern keine Trigger (keine Outbox-Einträge, keine Fremdschlüssel-Reihenfolge-Probleme).
-- =====================================================================
create table _outbox (
  table_name  text not null,
  row_id      uuid not null,
  op          text not null check (op in ('upsert', 'delete')),
  seq         bigserial,
  changed_at  timestamptz not null default clock_timestamp(),
  primary key (table_name, row_id)
);

create table _sync_state (
  key    text primary key,
  value  text
);

create table _schema_version (
  version  int primary key,
  applied  timestamptz not null default now()
);

create function _outbox_record() returns trigger language plpgsql as $$
declare v_pk text := tg_argv[0]; v_id uuid;
begin
  v_id := (to_jsonb(coalesce(new, old)) ->> v_pk)::uuid;
  insert into _outbox (table_name, row_id, op)
  values (tg_table_name, v_id, case when tg_op = 'DELETE' then 'delete' else 'upsert' end)
  on conflict (table_name, row_id) do update
    set op = excluded.op, seq = nextval(pg_get_serial_sequence('_outbox', 'seq')), changed_at = clock_timestamp();
  return null;
end $$;

do $$
declare t record;
begin
  for t in select name, pk from sync_tables() loop
    execute format('create trigger t_outbox after insert or update or delete on %I for each row execute function _outbox_record(%L)', t.name, t.pk);
  end loop;
end $$;
