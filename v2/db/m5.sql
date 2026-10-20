-- =====================================================================
--  M5 · Budget und Konten: Budgets, Fixkosten, Verträge, Sparziele und Daueraufträge werden abgeglichen
--  Läuft im Browser und auf dem Server (nach m4.sql). Die Rechenfunktionen (safe_to_spend, contract_deadlines,
--  sinking_fund_status, analysis_50_30_20 …) stehen seit M1 in schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Abgleich vorbereiten: updated_at (Serverzeit bestimmt der Server), Sparraten mit household_id
-- ---------------------------------------------------------------------
alter table variable_budget add column updated_at timestamptz not null default now();
alter table fixed_cost      add column updated_at timestamptz not null default now();
alter table contract        add column updated_at timestamptz not null default now();
alter table sinking_fund    add column updated_at timestamptz not null default now();
alter table standing_order  add column updated_at timestamptz not null default now();

alter table sinking_fund_entry add column household_id uuid references household on delete cascade,
                               add column updated_at timestamptz not null default now();
update sinking_fund_entry e set household_id = f.household_id from sinking_fund f where f.id = e.fund_id;
alter table sinking_fund_entry alter column household_id set not null;
create function fill_household_from_fund() returns trigger language plpgsql as $$
begin
  if new.household_id is null then select household_id into new.household_id from sinking_fund where id = new.fund_id; end if;
  return new;
end $$;
create trigger t_fill_household before insert on sinking_fund_entry for each row execute function fill_household_from_fund();

create trigger t_touch before update on variable_budget   for each row execute function touch_updated_at();
create trigger t_touch before update on fixed_cost        for each row execute function touch_updated_at();
create trigger t_touch before update on contract          for each row execute function touch_updated_at();
create trigger t_touch before update on sinking_fund      for each row execute function touch_updated_at();
create trigger t_touch before update on standing_order    for each row execute function touch_updated_at();
create trigger t_touch before update on sinking_fund_entry for each row execute function touch_updated_at();

-- Abgleichreihenfolge: Eltern vor Kindern (Dauerauftrag vor Überweisung, Vertrag vor Fixkosten, Fonds vor Sparrate)
create or replace function sync_tables() returns table (ord int, name text, pk text)
language sql immutable as $$
  values (1, 'household', 'id'), (2, 'household_member', 'id'), (3, 'household_setting', 'household_id'),
         (4, 'person', 'id'), (5, 'person_income', 'id'), (6, 'account', 'id'), (7, 'account_owner', 'id'),
         (8, 'life_area', 'id'), (9, 'category', 'id'), (10, 'payment_method', 'id'),
         (11, 'merchant', 'id'), (12, 'master_product', 'id'), (13, 'merchant_product', 'id'), (14, 'receipt_alias_mapping', 'id'),
         (15, 'attachment', 'id'), (16, 'transaction_header', 'id'), (17, 'line_item', 'id'),
         (18, 'line_item_discount', 'id'), (19, 'transaction_payment', 'id'),
         (20, 'standing_order', 'id'), (21, 'transfer', 'id'),
         (22, 'shelf_price', 'id'), (23, 'price_alert_seen', 'id'),
         (24, 'contract', 'id'), (25, 'fixed_cost', 'id'), (26, 'variable_budget', 'id'),
         (27, 'sinking_fund', 'id'), (28, 'sinking_fund_entry', 'id')
$$;

-- ---------------------------------------------------------------------
-- 2. Daueraufträge und Sparraten buchen – von jedem Handy beim Start, ohne sich zu verdoppeln
--    Die ID ergibt sich aus Dauerauftrag und Monat (stabile_id): buchen beide Handys denselben Monat, entsteht
--    dieselbe Zeile, und der Server führt sie zusammen. Gebucht wird nur, was heute fällig oder vorbei ist;
--    nachgeholt werden höchstens 36 Monate. Bereits Gebuchtes ändert sich nie, auch wenn man den Betrag später ändert.
-- ---------------------------------------------------------------------
create function dauerauftraege_buchen(p_heute date) returns int language plpgsql as $$
declare n int;
begin
  with faellig as (
    select s.id as so, s.household_id, s.from_account_id, s.to_account_id, s.amount, s.kind,
           (m::date + (s.day_of_month - 1))::date as tag
      from standing_order s
      cross join lateral generate_series(date_trunc('month', greatest(s.valid_from, p_heute - interval '36 months')),
                                         date_trunc('month', p_heute), interval '1 month') m
     where s.valid_from <= p_heute),
  ins as (
    insert into transfer (id, household_id, from_account_id, to_account_id, amount, transfer_date, kind, standing_order_id, note)
    select stabile_id('dauerauftrag', f.so::text, f.tag::text), f.household_id, f.from_account_id, f.to_account_id, f.amount, f.tag, f.kind, f.so, 'Dauerauftrag'
      from faellig f join standing_order s on s.id = f.so
     where f.tag <= p_heute and f.tag >= s.valid_from and (s.valid_to is null or f.tag <= s.valid_to)
    on conflict do nothing
    returning 1)
  select count(*)::int into n from ins;
  return n;
end $$;

create function fonds_raten_buchen(p_heute date) returns int language plpgsql as $$
declare n int;
begin
  with ins as (
    insert into sinking_fund_entry (id, household_id, fund_id, entry_date, kind, amount, note)
    select stabile_id('fondsrate', f.id::text, m::date::text), f.household_id, f.id, m::date, 'contribution', f.monthly_contribution, 'Monatsrate'
      from sinking_fund f
      cross join lateral generate_series(date_trunc('month', greatest(f.start_date, p_heute - interval '36 months')),
                                         date_trunc('month', p_heute), interval '1 month') m
     where f.closed_at is null and f.monthly_contribution > 0 and m::date <= p_heute
    on conflict do nothing
    returning 1)
  select count(*)::int into n from ins;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Hilfen für die Oberfläche
-- ---------------------------------------------------------------------
-- Nächste Fälligkeit einer Fixkost: das Datum selbst, sonst das erste Datum ab heute in ihrem Rhythmus
create function naechste_faelligkeit(p_datum date, p_haeufigkeit frequency, p_heute date) returns date language sql immutable as $$
  select case
    when p_datum >= p_heute then p_datum
    when p_haeufigkeit = 'weekly' then p_datum + (ceil((p_heute - p_datum) / 7.0)::int * 7)
    else (select min((p_datum + make_interval(months => x.m * g))::date)
            from generate_series(1, 1200) g
           where (p_datum + make_interval(months => x.m * g))::date >= p_heute)
  end
  from (select case p_haeufigkeit when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 else 12 end as m) x
$$;

-- Alle laufenden Budgets eines Haushalts mit Safe-to-Spend, Tempo und Hochrechnung (Blueprint §2.6)
create function budget_status(p_household uuid, p_heute date)
returns table (budget_id uuid, available numeric, spent_before_today numeric, spent_today numeric, month_spent numeric, remaining_days int,
               safe_per_day numeric, left_today numeric, burn_rate_per_day numeric, projected_month_spend numeric, pace text)
language sql stable as $$
  select b.id, s.available, s.spent_before_today, s.spent_today, s.spent_before_today + s.spent_today, s.remaining_days,
         s.safe_per_day, s.left_today, s.burn_rate_per_day, s.projected_month_spend, s.pace
    from variable_budget b cross join lateral safe_to_spend(b.id, p_heute) s
   where b.household_id = p_household and b.valid_from <= p_heute and (b.valid_to is null or b.valid_to >= date_trunc('month', p_heute)::date)
$$;

-- Verträge eines Haushalts mit Frist und Status
create function vertrags_fristen(p_household uuid, p_heute date)
returns table (contract_id uuid, name text, counterparty text, next_renewal date, cancellation_deadline date, remind_on date, days_left int, status text, auto_renews boolean)
language sql stable as $$
  select d.contract_id, d.name, k.counterparty, d.next_renewal, d.cancellation_deadline, d.remind_on, d.days_left, d.status, k.auto_renews
    from contract_deadlines(p_heute) d join contract k on k.id = d.contract_id
   where k.household_id = p_household
$$;

-- Sparziele eines Haushalts
create function sparziele(p_household uuid, p_heute date)
returns table (fund_id uuid, name text, balance numeric, contributed numeric, spent numeric, target_amount numeric, months_left int,
               required_monthly numeric, monthly_contribution numeric, on_track boolean, progress_pct numeric)
language sql stable as $$
  select s.* from sinking_fund_status(p_heute) s join sinking_fund f on f.id = s.fund_id where f.household_id = p_household
$$;
