-- =====================================================================
--  Nur auf dem Server (Supabase): Zugriffsschutz, Zeitstempel, Löschprotokoll, Einladungen
--  Voraussetzung: schema.sql ist eingespielt. auth.uid() kommt von Supabase.
-- =====================================================================

-- ---------- Zeitstempel: der Server bestimmt updated_at (Grundlage für den Abgleich) ----------
create function sync_stamp() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function household_stamp() returns trigger language plpgsql as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger t_creator before insert on household for each row execute function household_stamp();

-- ---------- Löschprotokoll: damit andere Geräte von Löschungen erfahren ----------
create table sync_tombstone (
  id           bigserial primary key,
  household_id uuid not null,
  table_name   text not null,
  row_id       uuid not null,
  deleted_at   timestamptz not null default clock_timestamp()
);
create index sync_tombstone_ix on sync_tombstone (household_id, deleted_at);

create function sync_record_delete() returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(old);
begin
  insert into sync_tombstone (household_id, table_name, row_id)
  values (coalesce((v_row ->> 'household_id')::uuid, (v_row ->> 'id')::uuid), tg_table_name, (v_row ->> tg_argv[0])::uuid);
  return null;
end $$;

do $$
declare t record;
begin
  for t in select name, pk from sync_tables() loop
    execute format('create trigger t_stamp before insert on %I for each row execute function sync_stamp()', t.name);
    execute format('create trigger t_tombstone after delete on %I for each row execute function sync_record_delete(%L)', t.name, t.pk);
  end loop;
end $$;

-- ---------- Zugehörigkeit ----------
create function auth_households() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from household_member where user_id = auth.uid()
$$;

-- ---------- Row Level Security für alle Tabellen ----------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('alter table %I enable row level security', t.relname);
  end loop;
end $$;

-- Haushalt: sehen nur Mitglieder (und wer ihn gerade angelegt hat)
create policy household_select on household for select to authenticated
  using (id in (select auth_households()) or created_by = auth.uid());
create policy household_insert on household for insert to authenticated
  with check (created_by = auth.uid());
create policy household_update on household for update to authenticated
  using (id in (select auth_households())) with check (id in (select auth_households()));

-- Mitgliedschaft: man sieht die Mitglieder des eigenen Haushalts. Neu eintragen kann sich nur, wer den Haushalt
-- angelegt hat; alle anderen treten über join_household bei. Bestehende Mitglieder dürfen Einträge pflegen
-- (ein «Upsert» prüft immer auch die Einfüge-Regel).
create policy member_select on household_member for select to authenticated
  using (household_id in (select auth_households()) or user_id = auth.uid());
create policy member_insert on household_member for insert to authenticated
  with check (household_id in (select auth_households())
              or (user_id = auth.uid() and exists (select 1 from household h where h.id = household_id and h.created_by = auth.uid())));
create policy member_update on household_member for update to authenticated
  using (household_id in (select auth_households())) with check (household_id in (select auth_households()));
create policy member_delete on household_member for delete to authenticated
  using (user_id = auth.uid());

-- Alle übrigen Tabellen mit household_id: nur der eigene Haushalt
do $$
declare t record;
begin
  for t in select c.table_name, c.is_nullable from information_schema.columns c
             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
            where c.table_schema = 'public' and c.column_name = 'household_id' and x.table_type = 'BASE TABLE'
              and c.table_name not in ('household_member', 'household_invite', 'sync_tombstone') loop
    execute format('create policy hh_all on %I for all to authenticated using (household_id in (select auth_households())) with check (household_id in (select auth_households()))', t.table_name);
    if t.is_nullable = 'YES' then   -- z. B. merchant: globale Einträge für alle lesbar
      execute format('create policy global_read on %I for select to authenticated using (household_id is null)', t.table_name);
    end if;
  end loop;
end $$;

-- Kindtabellen ohne eigene household_id: über das Elternobjekt
create policy hh_all on transaction_payment for all to authenticated
  using (exists (select 1 from transaction_header h where h.id = transaction_id and h.household_id in (select auth_households())))
  with check (exists (select 1 from transaction_header h where h.id = transaction_id and h.household_id in (select auth_households())));
create policy hh_all on line_item for all to authenticated
  using (exists (select 1 from transaction_header h where h.id = transaction_id and h.household_id in (select auth_households())))
  with check (exists (select 1 from transaction_header h where h.id = transaction_id and h.household_id in (select auth_households())));
create policy hh_all on line_item_discount for all to authenticated
  using (exists (select 1 from line_item l join transaction_header h on h.id = l.transaction_id
                  where l.id = line_item_id and h.household_id in (select auth_households())))
  with check (exists (select 1 from line_item l join transaction_header h on h.id = l.transaction_id
                  where l.id = line_item_id and h.household_id in (select auth_households())));
create policy hh_all on line_item_allocation for all to authenticated
  using (exists (select 1 from line_item l join transaction_header h on h.id = l.transaction_id
                  where l.id = line_item_id and h.household_id in (select auth_households())))
  with check (exists (select 1 from line_item l join transaction_header h on h.id = l.transaction_id
                  where l.id = line_item_id and h.household_id in (select auth_households())));
create policy hh_all on payment_share for all to authenticated
  using (exists (select 1 from transaction_payment p join transaction_header h on h.id = p.transaction_id
                  where p.id = payment_id and h.household_id in (select auth_households())))
  with check (exists (select 1 from transaction_payment p join transaction_header h on h.id = p.transaction_id
                  where p.id = payment_id and h.household_id in (select auth_households())));
create policy hh_all on merchant_branch for all to authenticated
  using (exists (select 1 from merchant m where m.id = merchant_id and (m.household_id is null or m.household_id in (select auth_households()))))
  with check (exists (select 1 from merchant m where m.id = merchant_id and m.household_id in (select auth_households())));
create policy hh_all on sinking_fund_entry for all to authenticated
  using (exists (select 1 from sinking_fund f where f.id = fund_id and f.household_id in (select auth_households())))
  with check (exists (select 1 from sinking_fund f where f.id = fund_id and f.household_id in (select auth_households())));
create policy hh_all on shopping_list_item for all to authenticated
  using (exists (select 1 from shopping_list l where l.id = list_id and l.household_id in (select auth_households())))
  with check (exists (select 1 from shopping_list l where l.id = list_id and l.household_id in (select auth_households())));

-- Gemeinsame Nachschlagetabellen: lesen ja, schreiben nur der Server selbst
create policy read_all on currency for select to authenticated using (true);
create policy read_all on fx_rate for select to authenticated using (true);
create policy read_all on off_cache for select to authenticated using (true);
create policy read_own on sync_tombstone for select to authenticated using (household_id in (select auth_households()));

-- ---------- Einladung: Partnerin/Partner tritt mit einem Code bei ----------
create table household_invite (
  code         text primary key,
  household_id uuid not null references household on delete cascade,
  created_by   uuid not null,
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid,
  used_at      timestamptz
);
alter table household_invite enable row level security;   -- kein direkter Zugriff, nur über die Funktionen

create function create_invite(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not exists (select 1 from household_member where household_id = p_household and user_id = auth.uid()) then
    raise exception 'Kein Mitglied dieses Haushalts';
  end if;
  v_code := substr(translate(upper(encode(sha256((random()::text || clock_timestamp()::text || p_household::text)::bytea), 'base64')),
                             '+/=0O1IL', ''), 1, 8);   -- ohne verwechselbare Zeichen
  insert into household_invite (code, household_id, created_by) values (v_code, p_household, auth.uid());
  return v_code;
end $$;

create function join_household(p_code text, p_person uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v household_invite;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into v from household_invite where code = upper(trim(p_code)) for update;
  if not found or v.used_at is not null or v.expires_at < now() then
    raise exception 'Der Code ist ungültig oder abgelaufen';
  end if;
  insert into household_member (household_id, user_id, role, person_id)
  values (v.household_id, auth.uid(), 'member', p_person)
  on conflict (household_id, user_id) do nothing;
  update household_invite set used_by = auth.uid(), used_at = now() where code = v.code;
  return v.household_id;
end $$;

revoke all on function create_invite(uuid) from public;
revoke all on function join_household(text, uuid) from public;
grant execute on function create_invite(uuid) to authenticated;
grant execute on function join_household(text, uuid) to authenticated;
