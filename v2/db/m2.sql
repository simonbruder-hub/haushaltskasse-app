-- =====================================================================
--  M2 · Belege (Einkäufe, Rechnungen, Gutschriften) und Ausgleich
--  Gemeinsam für Browser und Server. Danach: client_m2.sql bzw. server_m2.sql
-- =====================================================================

-- 1. Belegtabellen bekommen household_id und updated_at (Abgleich und Zugriffsschutz)
alter table merchant            add column updated_at timestamptz not null default now();
alter table transaction_payment add column household_id uuid references household on delete cascade,
                                add column updated_at timestamptz not null default now();
alter table line_item           add column household_id uuid references household on delete cascade;
alter table line_item_discount  add column household_id uuid references household on delete cascade,
                                add column updated_at timestamptz not null default now();
alter table transfer            add column updated_at timestamptz not null default now();
update transaction_payment p set household_id = h.household_id from transaction_header h where h.id = p.transaction_id;
update line_item l set household_id = h.household_id from transaction_header h where h.id = l.transaction_id;
update line_item_discount d set household_id = l.household_id from line_item l where l.id = d.line_item_id;
alter table transaction_payment alter column household_id set not null;
alter table line_item           alter column household_id set not null;
alter table line_item_discount  alter column household_id set not null;
create index line_item_hh_ix on line_item (household_id);
create index payment_hh_ix on transaction_payment (household_id);
create index transfer_hh_ix on transfer (household_id, transfer_date);

create function fill_household_from_txn() returns trigger language plpgsql as $$
begin
  if new.household_id is null then select household_id into new.household_id from transaction_header where id = new.transaction_id; end if;
  return new;
end $$;
create trigger t_fill_household before insert on line_item for each row execute function fill_household_from_txn();
create trigger t_fill_household before insert on transaction_payment for each row execute function fill_household_from_txn();
create function fill_household_from_line() returns trigger language plpgsql as $$
begin
  if new.household_id is null then select household_id into new.household_id from line_item where id = new.line_item_id; end if;
  return new;
end $$;
create trigger t_fill_household before insert on line_item_discount for each row execute function fill_household_from_line();

create trigger t_touch before update on merchant            for each row execute function touch_updated_at();
create trigger t_touch before update on transaction_payment for each row execute function touch_updated_at();
create trigger t_touch before update on line_item_discount  for each row execute function touch_updated_at();
create trigger t_touch before update on transfer            for each row execute function touch_updated_at();

-- 2. Abgleich: Belege, Läden und Überweisungen kommen dazu
create or replace function sync_tables() returns table (ord int, name text, pk text)
language sql immutable as $$
  values (1, 'household', 'id'), (2, 'household_member', 'id'), (3, 'household_setting', 'household_id'),
         (4, 'person', 'id'), (5, 'person_income', 'id'), (6, 'account', 'id'), (7, 'account_owner', 'id'),
         (8, 'life_area', 'id'), (9, 'category', 'id'), (10, 'payment_method', 'id'),
         (11, 'merchant', 'id'), (12, 'transaction_header', 'id'), (13, 'line_item', 'id'),
         (14, 'line_item_discount', 'id'), (15, 'transaction_payment', 'id'), (16, 'transfer', 'id')
$$;

-- 3. Anteile neu rechnen: CHF-Beträge der Zahlungen nur schreiben, wenn sie sich ändern
--    (sonst erzeugt jede Neuberechnung eine Änderung, die wieder abgeglichen wird)
create or replace function recompute_allocations(p_txn uuid) returns void language plpgsql as $$
declare h transaction_header; v_bad text;
begin
  select * into h from transaction_header where id = p_txn;
  select a.name into v_bad
    from line_item l join account a on a.id = coalesce(l.cost_account_id, h.default_cost_account_id)
   where l.transaction_id = p_txn and l.deleted_at is null
     and abs(coalesce((select sum(share) from account_owner o where o.account_id = a.id), 0) - 1) > 0.00001
   limit 1;
  if v_bad is not null then raise exception 'Topf «%»: Anteile der Eigentümer ergeben nicht 100 %%', v_bad; end if;

  delete from line_item_allocation a using line_item l where a.line_item_id = l.id and l.transaction_id = p_txn;
  delete from payment_share s using transaction_payment p where s.payment_id = p.id and p.transaction_id = p_txn;

  -- Zahlungen in CHF (rundungsgenau)
  with p as (
    select id, round(amount * h.fx_rate, 2) as b,
           row_number() over (order by abs(amount) desc, position, id) as rk
      from transaction_payment where transaction_id = p_txn),
  rest as (select round(coalesce(sum(amount), 0) * h.fx_rate, 2) - coalesce((select sum(b) from p), 0) as r
             from transaction_payment where transaction_id = p_txn)
  update transaction_payment tp set amount_base = p.b + case when p.rk = 1 then rest.r else 0 end
    from p, rest where tp.id = p.id and tp.amount_base is distinct from p.b + case when p.rk = 1 then rest.r else 0 end;

  -- Positionen → Personen
  insert into line_item_allocation (line_item_id, person_id, amount, amount_base)
  with lines as (
    select l.*, round(l.final_price * h.fx_rate, 2) as fb,
           row_number() over (order by abs(l.final_price) desc, l.position) as rk
      from line_item l where l.transaction_id = p_txn and l.deleted_at is null),
  lines_b as (
    select l.*, l.fb + case when l.rk = 1 then round(sum(l.final_price) over () * h.fx_rate, 2) - sum(l.fb) over () else 0 end as final_base
      from lines l),
  raw as (
    select l.id as line_id, l.position, o.person_id, pe.sort, l.final_price, l.final_base,
           l.final_price * o.share as raw_amt, l.final_base * o.share as raw_base
      from lines_b l
      join account_owner o on o.account_id = coalesce(l.cost_account_id, h.default_cost_account_id)
      join person pe on pe.id = o.person_id),
  fl as (
    select raw.*,
           sign(final_price) * trunc(abs(raw_amt) * 100) / 100 as f_amt,
           sign(final_base)  * trunc(abs(raw_base) * 100) / 100 as f_base
      from raw),
  ranked as (
    select fl.*,
      row_number() over (partition by line_id order by abs(raw_amt) - abs(f_amt) desc, (position + sort) % 2, sort, person_id) as rk_amt,
      round((abs(final_price) - sum(abs(f_amt)) over (partition by line_id)) * 100) as miss_amt,
      row_number() over (partition by line_id order by abs(raw_base) - abs(f_base) desc, (position + sort) % 2, sort, person_id) as rk_base,
      round((abs(final_base) - sum(abs(f_base)) over (partition by line_id)) * 100) as miss_base
      from fl)
  select line_id, person_id,
         f_amt  + case when rk_amt  <= miss_amt  then sign(final_price) * 0.01 else 0 end,
         f_base + case when rk_base <= miss_base then sign(final_base)  * 0.01 else 0 end
    from ranked;

  -- Zahlungen → Personen
  insert into payment_share (payment_id, person_id, amount_base)
  with pay as (select * from transaction_payment where transaction_id = p_txn),
  cost as (
    select a.person_id, sum(a.amount_base) as s
      from line_item_allocation a join line_item l on l.id = a.line_item_id
     where l.transaction_id = p_txn group by 1),
  w as (
    select p.id as payment_id, p.position, p.amount_base, o.person_id, o.share::numeric as weight
      from pay p join account_owner o on o.account_id = p.account_id
     where p.account_id is not null
    union all
    select p.id, p.position, p.amount_base, c.person_id, c.s
      from pay p cross join cost c
     where p.account_id is null),
  raw as (
    select w.*, pe.sort,
           case when sum(weight) over (partition by payment_id) = 0 then 0
                else amount_base * weight / sum(weight) over (partition by payment_id) end as r
      from w join person pe on pe.id = w.person_id),
  fl as (select raw.*, sign(amount_base) * trunc(abs(r) * 100) / 100 as f from raw),
  ranked as (
    select fl.*,
      row_number() over (partition by payment_id order by abs(r) - abs(f) desc, (position + sort) % 2, sort, person_id) as k,
      round((abs(amount_base) - sum(abs(f)) over (partition by payment_id)) * 100) as miss
      from fl)
  select payment_id, person_id, f + case when k <= miss then sign(amount_base) * 0.01 else 0 end
    from ranked;

  delete from line_item_allocation a using line_item l
   where a.line_item_id = l.id and l.transaction_id = p_txn and a.amount = 0 and a.amount_base = 0;
  delete from payment_share s using transaction_payment p
   where s.payment_id = p.id and p.transaction_id = p_txn and s.amount_base = 0;
end $$;

-- 4. Nachführen bei Änderungen an bestätigten Belegen (Belegkopf hat eine eigene Funktion)
create or replace function refresh_allocations() returns trigger language plpgsql as $$
declare v_txn uuid := coalesce(new.transaction_id, old.transaction_id);
begin
  if exists (select 1 from transaction_header where id = v_txn and status = 'confirmed') then
    perform recompute_allocations(v_txn);
  end if;
  return null;
end $$;
create function refresh_allocations_header() returns trigger language plpgsql as $$
begin
  perform recompute_allocations(new.id);
  return null;
end $$;
drop trigger txn_pot_refresh on transaction_header;
create trigger txn_pot_refresh after update of default_cost_account_id, fx_rate on transaction_header
  for each row when (new.status = 'confirmed') execute function refresh_allocations_header();

-- 5. Wirkung jedes Belegs auf den Saldo (bezahlt − Anteil, je erwachsene Person)
create view v_txn_effect as
select h.household_id, h.id as transaction_id, h.booking_date, p.id as person_id,
       coalesce(paid.s, 0) as paid, coalesce(share.s, 0) as share, coalesce(paid.s, 0) - coalesce(share.s, 0) as effect
  from transaction_header h
  join person p on p.household_id = h.household_id and p.role = 'adult'
  left join lateral (select sum(ps.amount_base) as s from payment_share ps join transaction_payment tp on tp.id = ps.payment_id
                      where tp.transaction_id = h.id and ps.person_id = p.id) paid on true
  left join lateral (select sum(a.amount_base) as s from line_item_allocation a join line_item l on l.id = a.line_item_id
                      where l.transaction_id = h.id and a.person_id = p.id) share on true
 where h.status = 'confirmed' and h.deleted_at is null;

-- 6. Privatkonto einer Person (für Ausgleichszahlungen)
create view v_private_account as
select o.person_id, a.id as account_id, a.household_id
  from account a join account_owner o on o.account_id = a.id
 where a.kind = 'privat' and a.status <> 'closed'
   and (select count(*) from account_owner x where x.account_id = a.id) = 1;
