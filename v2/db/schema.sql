-- =====================================================================
--  Haushalt & Finanzen · Datenbank-Schema (PostgreSQL 15+ / Supabase)
--  Version M1 (Blueprint v2) · Basiswährung CHF · metrische Einheiten
--  Dieses Schema läuft identisch auf dem Server (Supabase) und im Browser (PGlite).
--  Nur-Server-Teile: server.sql · Nur-Client-Teile: client.sql
-- ---------------------------------------------------------------------
--  Konventionen
--   * Primärschlüssel uuid. Der Client erzeugt UUIDv7 (offline anlegbar),
--     gen_random_uuid() ist nur der Server-Default.
--   * Geld:            numeric(12,2) in Belegwährung, *_base = in CHF
--   * Einheitspreise:  numeric(14,4)
--   * Wechselkurs:     numeric(18,8) = CHF pro 1 Einheit Fremdwährung
--   * Mengen:          numeric(12,3); Basismengen immer in g / ml / Stück
--   * Mandant:         jede Fachtabelle hat (direkt oder über den Beleg)
--                      household_id → Row Level Security (BLUEPRINT §1.5)
--   * Sync:            updated_at + deleted_at (Soft Delete)
--  Kostenmodell: Jede Position gehört einem Topf (account). Ein Topf gehört einer
--  Person (100 %) oder gemeinsam (immer 50/50). Daraus folgen My Share und Saldo.
--  Invarianten eines bestätigten Belegs (geprüft in validate_transaction):
--   Σ line_item.final_price = total_amount = Σ transaction_payment.amount
--   Σ line_item_allocation.amount je Zeile = final_price der Zeile
-- =====================================================================

-- ---------- 0. Aufzählungen ----------
create type item_type        as enum ('product', 'deposit_or_fee', 'refund_or_return');
create type unit_type        as enum ('g', 'kg', 'ml', 'l', 'piece');
create type comparison_unit  as enum ('per_100g', 'per_1kg', 'per_100ml', 'per_1l', 'per_piece');
create type payment_kind     as enum ('cash', 'debit_card', 'credit_card', 'twint', 'bank_transfer', 'ebill',
                                      'voucher', 'gift_card', 'loyalty_points', 'reka', 'lunch_check', 'other');
create type person_role      as enum ('adult', 'child');
create type account_kind     as enum ('privat', 'leben', 'sparen', 'freizeit', 'kind', 'zweck');
create type account_status   as enum ('virtual', 'active', 'closed');
create type transfer_kind    as enum ('deposit', 'saving', 'settlement', 'rebooking', 'income');
create type purchase_intent  as enum ('unknown', 'planned', 'impulse_buy');
create type spending_class   as enum ('need', 'want', 'saving');
create type txn_kind         as enum ('purchase', 'bill', 'refund');
create type txn_status       as enum ('draft', 'needs_review', 'confirmed', 'void');
create type scan_channel     as enum ('receipt_image', 'receipt_pdf', 'loyalty_csv', 'ean', 'qr_bill', 'manual');
create type scan_status      as enum ('queued', 'processing', 'needs_review', 'done', 'failed', 'duplicate');
create type alias_source     as enum ('user_confirmed', 'ean_scan', 'llm_suggested', 'fuzzy_match', 'loyalty_import');
create type price_source     as enum ('receipt', 'ean_live_check', 'loyalty_import', 'manual');
create type alert_kind       as enum ('shrinkflation', 'price_jump', 'price_drop');
create type frequency        as enum ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual');
create type rollover_mode    as enum ('none', 'surplus_only', 'surplus_and_deficit');
create type budget_scope     as enum ('person', 'account');
create type fund_entry_kind  as enum ('contribution', 'adjustment');
create type qr_reference     as enum ('QRR', 'SCOR', 'NON');
create type bill_status      as enum ('open', 'scheduled', 'paid', 'cancelled');
create type attachment_kind  as enum ('receipt_image', 'receipt_pdf', 'searchable_pdf', 'loyalty_csv', 'qr_bill', 'contract', 'warranty');

-- ---------- 0.1 Reine Rechenfunktionen (IMMUTABLE, auch in generierten Spalten nutzbar) ----------
-- Faktor zur Basiseinheit: kg→g und l→ml ×1000, sonst ×1
create function unit_factor(u unit_type) returns numeric
language sql immutable parallel safe as $$
  select case u when 'kg' then 1000 when 'l' then 1000 else 1 end::numeric $$;

create function unit_dimension(u unit_type) returns text
language sql immutable parallel safe as $$
  select case u when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' else 'count' end $$;

create function comparison_divisor(c comparison_unit) returns numeric
language sql immutable parallel safe as $$
  select case c when 'per_100g' then 100 when 'per_1kg' then 1000 when 'per_100ml' then 100 when 'per_1l' then 1000 else 1 end::numeric $$;

create function comparison_dimension(c comparison_unit) returns text
language sql immutable parallel safe as $$
  select case c when 'per_100g' then 'mass' when 'per_1kg' then 'mass' when 'per_100ml' then 'volume' when 'per_1l' then 'volume' else 'count' end $$;

-- Basismenge einer Belegzeile in g / ml / Stück.
--  * Offenverkauf (quantity_unit ≠ piece): die Menge IST Gewicht/Volumen, z. B. 0.734 kg → 734 g
--  * Stückware mit Packungsgrösse: Menge × Packungsgrösse × Faktor × Anzahl im Multipack
--  * Stückware ohne Packungsgrösse: Menge × Multipack (nur per_piece vergleichbar)
create function base_quantity(p_qty numeric, p_qty_unit unit_type, p_unit_size numeric, p_unit_type unit_type, p_pack_count int)
returns numeric language sql immutable parallel safe as $$
  select case
    when p_qty_unit <> 'piece' then p_qty * unit_factor(p_qty_unit)
    when p_unit_size is not null and p_unit_type is not null then p_qty * p_unit_size * unit_factor(p_unit_type) * coalesce(p_pack_count, 1)
    else p_qty * coalesce(p_pack_count, 1) end $$;

create function base_dimension(p_qty_unit unit_type, p_unit_size numeric, p_unit_type unit_type)
returns text language sql immutable parallel safe as $$
  select case
    when p_qty_unit <> 'piece' then unit_dimension(p_qty_unit)
    when p_unit_size is not null and p_unit_type is not null then unit_dimension(p_unit_type)
    else 'count' end $$;

-- Anzahl Vergleichseinheiten einer Basismenge (z. B. 1500 g bei per_100g → 15).
-- Dichte nur für g↔ml (z. B. Joghurt in ml angeschrieben, Vergleich per_100g). null = nicht vergleichbar.
create function comparison_quantity(p_base_qty numeric, p_base_dim text, p_cmp comparison_unit, p_density_g_per_ml numeric default null)
returns numeric language sql immutable parallel safe as $$
  select case
    when p_base_qty is null or p_base_qty <= 0 then null
    when p_base_dim = comparison_dimension(p_cmp) then p_base_qty / comparison_divisor(p_cmp)
    when p_base_dim = 'volume' and comparison_dimension(p_cmp) = 'mass' and p_density_g_per_ml > 0
      then p_base_qty * p_density_g_per_ml / comparison_divisor(p_cmp)
    when p_base_dim = 'mass' and comparison_dimension(p_cmp) = 'volume' and p_density_g_per_ml > 0
      then p_base_qty / p_density_g_per_ml / comparison_divisor(p_cmp)
    else null end $$;

-- Preis pro Vergleichseinheit (4 Nachkommastellen)
create function normalized_unit_price(p_price numeric, p_base_qty numeric, p_base_dim text,
                                      p_cmp comparison_unit, p_density_g_per_ml numeric default null)
returns numeric language sql immutable parallel safe as $$
  select round(p_price / nullif(comparison_quantity(p_base_qty, p_base_dim, p_cmp, p_density_g_per_ml), 0), 4) $$;

create function frequency_per_month(f frequency) returns numeric
language sql immutable parallel safe as $$
  select case f when 'weekly' then 52.0 / 12 when 'monthly' then 1 when 'quarterly' then 1.0 / 3
                when 'semiannual' then 1.0 / 6 else 1.0 / 12 end::numeric $$;

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;

-- =====================================================================
-- 1. Mandant, Personen, Konten (Töpfe)
-- =====================================================================
create table currency (
  code           char(3) primary key,                 -- ISO 4217
  name           text not null,
  minor_units    smallint not null default 2,
  cash_rounding  numeric(6,2)                         -- CHF: 0.05 (Rappenrundung bei Barzahlung)
);

create table household (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  base_currency  char(3) not null default 'CHF' references currency,
  created_by     uuid,                                -- Login der Person, die ihn angelegt hat (Server setzt ihn)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table household_setting (
  household_id                    uuid primary key references household on delete cascade,
  price_jump_threshold_pct        numeric(5,2) not null default 10,   -- Warnung ab +X % (Regulärpreis/Vergleichseinheit)
  shrinkflation_min_size_drop_pct numeric(5,2) not null default 2,    -- Packung mind. X % kleiner
  shrinkflation_price_tolerance_pct numeric(5,2) not null default 2,  -- Packungspreis höchstens X % tiefer
  price_freshness_days            int not null default 60,            -- ältere Preise zählen im Smart Basket nicht
  promo_validity_days             int not null default 7,             -- gesehene Aktion gilt X Tage für Planung
  basket_split_min_saving_chf     numeric(8,2) not null default 5,
  basket_split_min_saving_pct     numeric(5,2) not null default 5,
  contract_reminder_days          int not null default 30,
  warranty_reminder_days          int not null default 60,
  alias_auto_accept_confidence    numeric(4,3) not null default 0.85,
  updated_at                      timestamptz not null default now()
);

create table household_member (                        -- wer darf den Haushalt sehen (RLS); user_id = auth.users.id
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  user_id        uuid not null,
  role           text not null default 'member' check (role in ('owner', 'member', 'viewer')),
  person_id      uuid,                                -- welche Person dieser Login ist (bewusst ohne FK: Sync-Reihenfolge)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, user_id)
);

create table person (                                  -- Erwachsene und Kinder des Haushalts
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references household on delete cascade,
  display_name        text not null,
  role                person_role not null default 'adult',
  birth_date          date,
  sort                smallint not null default 0,      -- Reihenfolge; bei Rappen-Gleichstand abwechselnd (§2.3)
  color               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  unique (household_id, display_name)
);

create table person_income (                           -- für 50/30/20 und den Kontenplan
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  person_id      uuid not null references person on delete cascade,
  valid_from     date not null,
  net_monthly    numeric(12,2) not null check (net_monthly >= 0),
  currency       char(3) not null default 'CHF' references currency,
  updated_at     timestamptz not null default now(),
  unique (person_id, valid_from)
);

-- Konto bzw. Topf. Heute: «Simon Privat», «Eliana Privat» (echte Konten) und «Gemeinsam Leben» (virtuell:
-- Ausgaben laufen noch über die privaten Konten, der Saldo zeigt den Ausgleich). Später: gemeinsames Konto
-- Leben, je ein Spar- und Freizeitkonto, Kinderkonten, weitere Zweck-Konten – nur status/iban ändern.
create table account (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references household on delete cascade,
  name                   text not null,                -- «Gemeinsam Leben», «Simon Sparen», «Lea»
  kind                   account_kind not null,
  status                 account_status not null default 'virtual',
  iban                   text,
  bank_name              text,
  currency               char(3) not null default 'CHF' references currency,
  opening_balance        numeric(12,2) not null default 0,
  opening_date           date,
  beneficiary_person_id  uuid references person,       -- für wen (z. B. Kind), optional
  is_personal_default    boolean not null default false, -- persönlicher Topf seiner Eigentümerin: heute «Privat», später «Freizeit»
  sort                   smallint not null default 0,
  color                  text,
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (household_id, name),
  check (status <> 'active' or opening_date is not null)
);
create table account_owner (                           -- wer den Topf trägt: 1 Person = 1.0 · gemeinsam = 0.5 / 0.5
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  account_id     uuid not null references account on delete cascade,
  person_id      uuid not null references person,
  share          numeric(5,4) not null check (share > 0 and share <= 1),
  updated_at     timestamptz not null default now(),
  unique (account_id, person_id)
);

create table fx_rate (
  currency       char(3) not null references currency,
  rate_date      date not null,
  rate           numeric(18,8) not null check (rate > 0),   -- CHF pro 1 Einheit
  source         text not null default 'ECB',
  primary key (currency, rate_date)
);

-- =====================================================================
-- 2. Händler, Kategorien, Zahlungsmittel
-- =====================================================================
create table merchant (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid references household on delete cascade,   -- null = globale Liste (Migros, Coop …)
  chain_key        text not null,                                 -- 'migros', 'coop', 'lidl', … (Enum im Scanner-Schema)
  name             text not null,
  country          char(2) not null default 'CH',
  loyalty_program  text,                                          -- 'cumulus', 'supercard', …
  receipt_patterns text[] not null default '{}',                  -- Kopfzeilen-Varianten auf Belegen
  created_at       timestamptz not null default now()
);
create unique index merchant_chain_uq on merchant (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), chain_key);

create table merchant_branch (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchant on delete cascade,
  name           text,
  street         text,
  postal_code    text,
  city           text,
  country        char(2) not null default 'CH',
  lat            numeric(9,6),
  lon            numeric(9,6),
  external_id    text,                                            -- Filialnummer laut Beleg/CSV
  unique (merchant_id, external_id)
);

create table life_area (                               -- Lebensbereich: Wohnen, Ernährung, Mobilität …
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  name           text not null,
  spending_class spending_class not null default 'need',
  sort           smallint not null default 0,
  archived_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (household_id, name)
);

create table category (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  life_area_id   uuid not null references life_area,
  parent_id      uuid references category,
  name           text not null,
  spending_class spending_class,                        -- überschreibt den Lebensbereich
  default_cost_account_id uuid references account,      -- z. B. Lebensmittel → Gemeinsam Leben; leer = persönlicher Topf
  sort           smallint not null default 0,
  archived_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (household_id, name)
);

create table payment_method (                          -- Karte/Twint gehört zu einem Konto
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references household on delete cascade,
  account_id       uuid not null references account,
  holder_person_id uuid references person,
  kind             payment_kind not null,
  label            text not null,                      -- «UBS Debit Simon», «Twint Eliana», «Debit Gemeinsam»
  card_last4       char(4),
  archived_at      timestamptz,
  updated_at       timestamptz not null default now()
);

-- =====================================================================
-- 3. Zweistufiger Produktkatalog + Alias-Wörterbuch
-- =====================================================================
create table master_product (                          -- generisch: «Vollmilch», «Bananen», «Spaghetti»
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references household on delete cascade,
  name               text not null,
  category_id        uuid references category,
  comparison_unit    comparison_unit not null,
  density_g_per_ml   numeric(6,3),                     -- nur wenn Packungen teils in g, teils in ml angeschrieben sind
  spending_class     spending_class,                   -- Override für 50/30/20
  track_consumption  boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (household_id, name)
);

create table merchant_product (                        -- konkret: EAN, Marke, Packungsgrösse
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references household on delete cascade,
  master_product_id  uuid not null references master_product,
  merchant_id        uuid references merchant,         -- gesetzt bei Eigenmarken (M-Budget, Prix Garantie, Milbona …)
  ean                text check (ean ~ '^[0-9]{8,14}$'),
  brand              text,
  name               text not null,
  unit_size          numeric(12,3),                    -- 500 (g) · 1.5 (l) · 6 (piece, z. B. Eier)
  unit_type          unit_type,
  pack_count         int not null default 1 check (pack_count >= 1),   -- 6 × 1.5 l → unit_size 1.5, unit_type l, pack_count 6
  drained_size       numeric(12,3),                    -- Abtropfgewicht (g) für Konserven, optional
  is_variable_weight boolean not null default false,   -- Offenverkauf, Preis-EAN 2x…
  image_url          text,
  replaces_id        uuid references merchant_product, -- Nachfolger nach Packungswechsel (Shrinkflation-Kette)
  off_ean            text,                             -- Verweis auf off_cache
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check ((unit_size is null) = (unit_type is null))
);
create unique index merchant_product_ean_uq on merchant_product (household_id, ean) where ean is not null and deleted_at is null;
create index merchant_product_master_ix on merchant_product (master_product_id);

create table off_cache (                               -- global geteilter Cache der OpenFoodFacts-Antworten
  ean              text primary key,
  fetched_at       timestamptz not null default now(),
  status           text not null check (status in ('found', 'not_found', 'error')),
  source_db        text not null default 'off',        -- off | obf (Beauty) | opf (Products)
  product_name     text,
  brand            text,
  quantity_raw     text,                               -- «6 x 1.5 l»
  unit_size        numeric(12,3),
  unit_type        unit_type,
  pack_count       int,
  image_url        text,
  categories_tags  text[],
  payload          jsonb
);

-- Selbstlernendes Wörterbuch: (Händler, normalisierter Belegtext) → MerchantProduct / MasterProduct
create table receipt_alias_mapping (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references household on delete cascade,
  merchant_id         uuid not null references merchant,
  raw_text_key        text not null,                   -- alias_key(raw_text), siehe BLUEPRINT §3.3
  raw_text_sample     text not null,                   -- letzter Originaltext, z. B. «M-CL VOLLMI UHT 1L»
  merchant_product_id uuid references merchant_product,
  master_product_id   uuid not null references master_product,
  source              alias_source not null,
  times_seen          int not null default 1,
  times_confirmed     int not null default 0,
  times_corrected     int not null default 0,
  confidence          numeric(4,3) generated always as ((times_confirmed + 1)::numeric / (times_seen + 2)) stored,
  last_unit_price     numeric(12,4),                   -- Plausibilitätsprüfung (±50 % → nachfragen)
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (household_id, merchant_id, raw_text_key)
);
-- Supabase/Postgres: ähnliche Schlüssel finden (Kanal 3, Stufe 3)
--   create extension if not exists pg_trgm;
--   create index alias_key_trgm_ix on receipt_alias_mapping using gin (raw_text_key gin_trgm_ops);

-- =====================================================================
-- 4. Belege: Header, Zahlungen, Positionen, Rabatte, Überweisungen
-- =====================================================================
create table attachment (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  kind           attachment_kind not null,
  storage_path   text not null,                      -- Supabase Storage: receipts/<household>/<id>.jpg
  mime_type      text not null,
  sha256         char(64) not null,                  -- Dedup identischer Dateien
  page_count     smallint,
  ocr_text       text,                               -- Textschicht (durchsuchbar)
  created_at     timestamptz not null default now(),
  unique (household_id, sha256)
);

create table transaction_header (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references household on delete cascade,
  kind                      txn_kind not null default 'purchase',   -- refund = Rückvergütung/Gutschrift
  status                    txn_status not null default 'draft',
  merchant_id               uuid references merchant,
  branch_id                 uuid references merchant_branch,
  transaction_at            timestamptz,                    -- Datum + Uhrzeit laut Beleg
  booking_date              date not null,                  -- lokales Datum (Europe/Zurich)
  currency                  char(3) not null default 'CHF' references currency,
  fx_rate                   numeric(18,8) not null default 1 check (fx_rate > 0),
  fx_rate_date              date,
  total_amount              numeric(12,2) not null,         -- Endbetrag nach Artikelrabatten, VOR Gutscheinen
  total_amount_base         numeric(12,2) generated always as (round(total_amount * fx_rate, 2)) stored,
  buyer_person_id           uuid not null references person, -- wer eingekauft hat (Vorschläge, Anzeige)
  default_cost_account_id   uuid not null references account, -- Topf, der die Kosten trägt; Positionen erben ihn
  purchase_intent           purchase_intent not null default 'unknown',
  receipt_barcode_id        text,                           -- Barcode/QR-Inhalt des Kassenbons → Dedup
  receipt_number            text,
  register_id               text,
  dedup_key                 text,                           -- chain|YYYY-MM-DD|HH:MM|total (Fallback-Dedup)
  source_channel            scan_channel not null default 'manual',
  scan_job_id               uuid,                           -- FK unten (zirkulär)
  receipt_attachment_id     uuid references attachment,
  notes                     text,
  created_by                uuid,                           -- auth.users.id
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);
create unique index txn_receipt_barcode_uq on transaction_header (household_id, merchant_id, receipt_barcode_id)
  where receipt_barcode_id is not null and deleted_at is null;
create index txn_dedup_ix on transaction_header (household_id, dedup_key) where deleted_at is null;
create index txn_date_ix on transaction_header (household_id, booking_date);

create table transaction_payment (                     -- Zahlungen inkl. Gutscheine/Treuepunkte
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null references transaction_header on delete cascade,
  position           smallint not null default 1,
  kind               payment_kind not null,
  account_id         uuid references account,           -- von welchem Konto; leer nur bei Gutscheinen/Punkten
  payment_method_id  uuid references payment_method,
  amount             numeric(12,2) not null,            -- > 0 bezahlt · < 0 Gutschrift auf dieses Konto
  amount_base        numeric(12,2),                     -- von recompute_allocations gesetzt (rundungsgenau)
  label              text,
  card_last4         char(4),
  is_cash_equivalent boolean generated always as
                     (kind not in ('voucher', 'gift_card', 'loyalty_points', 'reka', 'lunch_check')) stored,
  check ((kind in ('voucher', 'gift_card', 'loyalty_points', 'reka', 'lunch_check')) = (account_id is null))
);
create index payment_txn_ix on transaction_payment (transaction_id);

create table line_item (
  id                    uuid primary key default gen_random_uuid(),
  transaction_id        uuid not null references transaction_header on delete cascade,
  position              smallint not null,
  item_type             item_type not null default 'product',
  raw_text              text not null,                  -- exakt wie gedruckt
  display_name          text,
  merchant_product_id   uuid references merchant_product,
  master_product_id     uuid references master_product,
  alias_mapping_id      uuid references receipt_alias_mapping,
  category_id           uuid references category,
  cost_account_id       uuid references account,        -- Topf dieser Position; leer = Topf des Belegs
  quantity              numeric(12,3) not null default 1 check (quantity > 0),  -- Stückzahl oder Gewicht/Volumen
  quantity_unit         unit_type not null default 'piece',                      -- kg bei Offenverkauf
  unit_size             numeric(12,3),                  -- Snapshot der Packungsgrösse zum Kaufzeitpunkt
  unit_type             unit_type,
  pack_count            int not null default 1 check (pack_count >= 1),
  base_quantity         numeric(14,3) generated always as (base_quantity(quantity, quantity_unit, unit_size, unit_type, pack_count)) stored,
  base_dimension        text generated always as (base_dimension(quantity_unit, unit_size, unit_type)) stored,
  regular_unit_price    numeric(12,4),                  -- Regulärpreis pro Stück bzw. pro kg
  regular_price         numeric(12,2) not null,         -- Zeilenbetrag VOR Artikelrabatt (Rückvergütung: negativ)
  item_discount         numeric(12,2) not null default 0 check (item_discount >= 0),  -- Σ line_item_discount
  final_price           numeric(12,2) generated always as (regular_price - item_discount) stored,
  is_promo              boolean not null default false,
  promo_label           text,
  vat_code              text,
  vat_rate              numeric(5,2),
  purchase_intent       purchase_intent not null default 'unknown',
  spending_class        spending_class,                 -- Override für 50/30/20
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check ((unit_size is null) = (unit_type is null)),
  check (item_type <> 'product' or (regular_price >= 0 and item_discount <= regular_price)),
  check (item_type <> 'refund_or_return' or (regular_price <= 0 and item_discount = 0)),
  check (not is_promo or item_discount > 0 or promo_label is not null)
);
create index line_item_txn_ix on line_item (transaction_id);
create index line_item_master_ix on line_item (master_product_id);

-- Herkunft jedes Artikelrabatts (Aktion, 3-für-2, anteiliger Bon-Rabatt …)
create table line_item_discount (
  id             uuid primary key default gen_random_uuid(),
  line_item_id   uuid not null references line_item on delete cascade,
  kind           text not null check (kind in ('promo', 'multi_buy', 'markdown', 'basket_allocated', 'staff', 'manufacturer_coupon')),
  label          text,                                -- «Aktion 30%», «3 für 2», «Mitarbeiterrabatt 10%»
  amount         numeric(12,2) not null check (amount > 0)
);

-- Ergebnis: Anteil je Person = Betrag × Anteil am Topf (materialisiert, von recompute_allocations geschrieben)
create table line_item_allocation (
  line_item_id   uuid not null references line_item on delete cascade,
  person_id      uuid not null references person,
  amount         numeric(12,2) not null,              -- Belegwährung
  amount_base    numeric(12,2) not null,              -- CHF
  primary key (line_item_id, person_id)
);
create index allocation_person_ix on line_item_allocation (person_id);

-- Wem eine Zahlung zugerechnet wird (für den Saldo):
--   Zahlung von einem Konto → Eigentümer des Kontos nach Anteil
--   Gutschein/Punkte        → im Verhältnis der Kostenanteile des Belegs (ändert die Beteiligung nicht)
create table payment_share (
  payment_id     uuid not null references transaction_payment on delete cascade,
  person_id      uuid not null references person,
  amount_base    numeric(12,2) not null,
  primary key (payment_id, person_id)
);

create table standing_order (                          -- Dauerauftrag = Kontenplan (Lohn → Töpfe)
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references household on delete cascade,
  from_account_id  uuid references account,           -- leer = Einnahme von aussen (Lohn, Kinderzulage)
  to_account_id    uuid not null references account,
  amount           numeric(12,2) not null check (amount > 0),
  day_of_month     smallint not null default 25 check (day_of_month between 1 and 28),
  kind             transfer_kind not null default 'deposit',
  valid_from       date not null,
  valid_to         date,
  note             text,
  check (from_account_id is distinct from to_account_id)
);

create table transfer (                                -- Überweisung: Einzahlung in Topf, Sparen, Ausgleich, Umbuchung
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references household on delete cascade,
  from_account_id    uuid references account,         -- leer = Einnahme von aussen (für den Saldo neutral)
  to_account_id      uuid not null references account,
  amount             numeric(12,2) not null check (amount > 0),
  transfer_date      date not null,
  kind               transfer_kind not null default 'deposit',
  standing_order_id  uuid references standing_order,
  note               text,
  created_at         timestamptz not null default now(),
  check (from_account_id is distinct from to_account_id),
  unique (standing_order_id, transfer_date)
);

create table warranty (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references household on delete cascade,
  line_item_id         uuid references line_item on delete set null,
  transaction_id       uuid references transaction_header on delete set null,
  item_name            text not null,
  brand                text,
  serial_number        text,
  purchase_date        date not null,
  warranty_months      int not null default 24,     -- CH: gesetzl. 2 Jahre (OR 210), vertraglich oft abweichend
  expires_on           date generated always as ((purchase_date + make_interval(months => warranty_months))::date) stored,
  extended_until       date,
  attachment_id        uuid references attachment,
  note                 text
);

-- =====================================================================
-- 5. Scanner: Aufträge, QR-Rechnungen, Kreditoren
-- =====================================================================
create table scan_job (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references household on delete cascade,
  channel                scan_channel not null,
  status                 scan_status not null default 'queued',
  attachment_id          uuid references attachment,
  input_sha256           char(64),
  model                  text,                         -- verwendetes Modell (Konfiguration)
  request_id             text,
  raw_output             jsonb,                        -- unveränderte Modellantwort
  parsed                 jsonb,                        -- validiertes Extraktions-JSON
  validation_errors      text[] not null default '{}',
  transaction_id         uuid references transaction_header,
  duplicate_of_txn_id    uuid references transaction_header,
  tokens_in              int,
  tokens_out             int,
  created_at             timestamptz not null default now(),
  finished_at            timestamptz
);
alter table transaction_header add constraint txn_scan_job_fk foreign key (scan_job_id) references scan_job;

create table creditor_mapping (                        -- gelernt: IBAN → Kategorie / Fixkosten / Topf
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references household on delete cascade,
  iban               text not null,
  creditor_name      text not null,
  merchant_id        uuid references merchant,
  category_id        uuid references category,
  fixed_cost_id      uuid,                             -- FK unten
  cost_account_id    uuid references account,
  unique (household_id, iban)
);

create table qr_bill (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references household on delete cascade,
  scan_job_id            uuid references scan_job,
  transaction_id         uuid references transaction_header,   -- gesetzt, sobald bezahlt
  creditor_mapping_id    uuid references creditor_mapping,
  iban                   text not null,
  is_qr_iban             boolean not null,
  creditor_name          text not null,
  creditor_street        text,
  creditor_building_no   text,
  creditor_postal_code   text,
  creditor_town          text,
  creditor_country       char(2),
  amount                 numeric(12,2),                -- kann leer sein (Spendeneinzahlung)
  currency               char(3) not null check (currency in ('CHF', 'EUR')),
  debtor_name            text,
  reference_type         qr_reference not null,
  reference              text,
  unstructured_message   text,
  bill_information       text,                         -- Swico S1: //S1/10/…/11/…/40/…
  invoice_number         text,                         -- aus S1 /10/
  invoice_date           date,                         -- aus S1 /11/
  due_date               date,                         -- aus S1 /11/ + /40/ (Zahlungsfrist)
  alt_procedures         text[] not null default '{}',
  status                 bill_status not null default 'open',
  raw_payload            text not null,
  payload_sha256         char(64) not null,
  created_at             timestamptz not null default now(),
  unique (household_id, payload_sha256)
);

-- =====================================================================
-- 6. Preis-Intelligenz
-- =====================================================================
create table price_observation (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references household on delete cascade,
  merchant_id              uuid not null references merchant,
  branch_id                uuid references merchant_branch,
  merchant_product_id      uuid references merchant_product,
  master_product_id        uuid not null references master_product,
  line_item_id             uuid references line_item on delete cascade,
  observed_on              date not null,
  source                   price_source not null,
  currency                 char(3) not null default 'CHF' references currency,
  fx_rate                  numeric(18,8) not null default 1,
  unit_regular_price       numeric(12,4) not null,      -- pro Packung bzw. pro kg/l (Offenverkauf)
  unit_paid_price          numeric(12,4) not null,      -- nach Artikelrabatt
  is_promo                 boolean not null default false,
  regular_known            boolean not null default true,  -- false: Aktion ohne gedruckten Regulärpreis → nicht für Alarme
  unit_base_quantity       numeric(14,3),               -- g/ml/Stück pro Packung bzw. 1000 bei kg/l
  base_dimension           text,
  comparison_unit          comparison_unit not null,
  normalized_regular_base  numeric(14,4),               -- CHF pro Vergleichseinheit (Trigger)
  normalized_paid_base     numeric(14,4),
  created_at               timestamptz not null default now()
);
create index price_obs_product_ix on price_observation (merchant_product_id, merchant_id, observed_on desc);
create index price_obs_master_ix on price_observation (household_id, master_product_id, merchant_id, observed_on desc);

create table price_alert (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references household on delete cascade,
  kind                     alert_kind not null,
  merchant_id              uuid references merchant,
  merchant_product_id      uuid references merchant_product,
  master_product_id        uuid references master_product,
  previous_observation_id  uuid references price_observation on delete cascade,
  observation_id           uuid not null references price_observation on delete cascade,
  old_base_quantity        numeric(14,3),
  new_base_quantity        numeric(14,3),
  old_unit_price           numeric(12,4),
  new_unit_price           numeric(12,4),
  old_normalized           numeric(14,4),
  new_normalized           numeric(14,4),
  change_pct               numeric(7,2) not null,       -- Veränderung pro Vergleichseinheit
  detected_at              timestamptz not null default now(),
  acknowledged_at          timestamptz
);

create table shopping_list (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  name           text not null default 'Einkaufsliste',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create table shopping_list_item (
  id                 uuid primary key default gen_random_uuid(),
  list_id            uuid not null references shopping_list on delete cascade,
  master_product_id  uuid not null references master_product,
  quantity           numeric(12,3) not null default 1,
  unit               unit_type not null default 'piece',  -- 2 l Milch, 1 kg Mehl, 6 piece Eier
  checked_at         timestamptz,
  added_at           timestamptz not null default now()
);

-- =====================================================================
-- 7. Budget: Fixkosten/Verträge, variable Budgets, Sinking Funds
-- =====================================================================
create table contract (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references household on delete cascade,
  name                      text not null,                -- «Krankenkasse Grundversicherung», «Sunrise Internet»
  counterparty              text not null,
  merchant_id               uuid references merchant,
  contract_number           text,
  start_date                date,
  renewal_date              date not null,                -- nächstes Laufzeitende / Verlängerungsdatum
  renewal_period_months     int not null default 12,
  auto_renews               boolean not null default true,
  cancellation_notice_days  int not null default 90,      -- Kündigungsfrist in Tagen vor renewal_date
  notice_to_month_end       boolean not null default false,  -- Kündigung muss bis Ende Vormonat eintreffen
  cancelled_on              date,
  attachment_id             uuid references attachment,
  note                      text
);

create table fixed_cost (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references household on delete cascade,
  name                 text not null,
  life_area_id         uuid not null references life_area,
  category_id          uuid references category,
  contract_id          uuid references contract,
  cost_account_id      uuid not null references account,   -- Topf (Miete → Gemeinsam Leben)
  pay_from_account_id  uuid references account,            -- heute oft privat, später das gemeinsame Konto
  amount               numeric(12,2) not null check (amount >= 0),
  currency             char(3) not null default 'CHF' references currency,
  frequency            frequency not null default 'monthly',
  next_due_date        date not null,
  payment_method_id    uuid references payment_method,
  spending_class       spending_class not null default 'need',
  is_active            boolean not null default true
);
alter table creditor_mapping add constraint creditor_fixed_cost_fk foreign key (fixed_cost_id) references fixed_cost;

create table variable_budget (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household on delete cascade,
  name           text not null,
  scope          budget_scope not null default 'person', -- person: My Share einer Person (heute) · account: alle Kosten eines Topfs
  person_id      uuid references person,
  account_id     uuid references account,
  life_area_id   uuid references life_area,               -- höchstens eines von beiden; beides leer = alles
  category_id    uuid references category,
  monthly_amount numeric(12,2) not null check (monthly_amount >= 0),
  rollover_mode  rollover_mode not null default 'none',
  valid_from     date not null,
  valid_to       date,
  check (not (life_area_id is not null and category_id is not null)),
  check ((scope = 'person') = (person_id is not null)),
  check ((scope = 'account') = (account_id is not null))
);

create table sinking_fund (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references household on delete cascade,
  name                  text not null,                     -- «Ferien 2027», «Zahnarzt Simon», «Velo Lea»
  holding_account_id    uuid not null references account,  -- wo das Geld liegt (z. B. Sparkonto)
  cost_account_id       uuid not null references account,  -- Topf, dessen Ausgaben …
  category_id           uuid not null references category, -- … in dieser Kategorie den Fonds belasten
  target_amount         numeric(12,2) not null,
  target_date           date,
  monthly_contribution  numeric(12,2) not null default 0,
  start_date            date not null,
  closed_at             date
);
create table sinking_fund_entry (                      -- Einzahlungen und Korrekturen; Entnahmen = Ausgaben der Kategorie
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references sinking_fund on delete cascade,
  entry_date     date not null,
  kind           fund_entry_kind not null default 'contribution',
  amount         numeric(12,2) not null,
  note           text,
  unique (fund_id, entry_date, kind)
);

-- =====================================================================
-- 8. Trigger & Rechenlogik
-- =====================================================================

-- 8.1 Σ Rabatt-Herkunft → line_item.item_discount
create function sync_item_discount() returns trigger language plpgsql as $$
declare v_id uuid := coalesce(new.line_item_id, old.line_item_id);
begin
  update line_item set item_discount = coalesce((select sum(amount) from line_item_discount where line_item_id = v_id), 0)
   where id = v_id;
  return null;
end $$;
create trigger line_item_discount_sum after insert or update or delete on line_item_discount
  for each row execute function sync_item_discount();

-- 8.2 Kern: Anteile aller Positionen und Zahlungen eines Belegs berechnen
--  Position: Topf = cost_account_id, sonst Topf des Belegs. Anteil je Person = Betrag × account_owner.share
--  Zahlung:  Konto → Eigentümer nach Anteil · Gutschein/Punkte → im Verhältnis der Kostenanteile des Belegs
--  Rundung:  Largest Remainder; bei Gleichstand (50/50 und ungerader Rappen) abwechselnd nach (Position + person.sort)
--  CHF:      Position = round(final × fx), Rundungsrest des Belegs auf die betragsgrösste Position
create function recompute_allocations(p_txn uuid) returns void language plpgsql as $$
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
    from p, rest where tp.id = p.id;

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

-- 8.3 Invarianten prüfen (beim Bestätigen)
create function validate_transaction(p_txn uuid) returns void language plpgsql as $$
declare h transaction_header; v_lines numeric; v_pay numeric; v_bad uuid;
begin
  select * into h from transaction_header where id = p_txn;
  select coalesce(sum(final_price), 0) into v_lines from line_item where transaction_id = p_txn and deleted_at is null;
  select coalesce(sum(amount), 0) into v_pay from transaction_payment where transaction_id = p_txn;
  if abs(v_lines - h.total_amount) > 0.005 then
    raise exception 'Positionen % ≠ Total % (Differenz %)', v_lines, h.total_amount, v_lines - h.total_amount;
  end if;
  if abs(v_pay - h.total_amount) > 0.005 then
    raise exception 'Zahlungen % ≠ Total % (Differenz %)', v_pay, h.total_amount, v_pay - h.total_amount;
  end if;
  select l.id into v_bad from line_item l left join line_item_allocation a on a.line_item_id = l.id
   where l.transaction_id = p_txn and l.deleted_at is null
   group by l.id, l.final_price having abs(coalesce(sum(a.amount), 0) - l.final_price) > 0.005 limit 1;
  if v_bad is not null then raise exception 'Teilung der Position % geht nicht auf (Anteile ≠ 100 %%)', v_bad; end if;
end $$;

-- 8.4 Preisbeobachtungen aus einem bestätigten Beleg
create function record_price_observations(p_txn uuid) returns void language plpgsql as $$
begin
  delete from price_observation where line_item_id in (select id from line_item where transaction_id = p_txn);
  insert into price_observation (household_id, merchant_id, branch_id, merchant_product_id, master_product_id, line_item_id,
                                 observed_on, source, currency, fx_rate, unit_regular_price, unit_paid_price, is_promo, regular_known,
                                 unit_base_quantity, base_dimension, comparison_unit)
  select h.household_id, h.merchant_id, h.branch_id, l.merchant_product_id, l.master_product_id, l.id,
         h.booking_date, case when h.source_channel = 'loyalty_csv' then 'loyalty_import'::price_source else 'receipt'::price_source end,
         h.currency, h.fx_rate,
         coalesce(l.regular_unit_price, round(l.regular_price / l.quantity, 4)),
         case when l.item_discount = 0 then coalesce(l.regular_unit_price, round(l.regular_price / l.quantity, 4))
              else round(l.final_price / l.quantity, 4) end,
         l.is_promo or l.item_discount > 0, l.item_discount > 0 or not l.is_promo,
         l.base_quantity / l.quantity, l.base_dimension, m.comparison_unit
    from line_item l
    join transaction_header h on h.id = l.transaction_id
    join master_product m on m.id = l.master_product_id
   where l.transaction_id = p_txn and l.item_type = 'product' and l.deleted_at is null and h.merchant_id is not null
   order by l.position;
end $$;

-- 8.5 Normalisieren + Shrinkflation/Preissprung erkennen
create function price_observation_normalize() returns trigger language plpgsql as $$
declare v_density numeric;
begin
  select density_g_per_ml into v_density from master_product where id = new.master_product_id;
  new.normalized_regular_base := normalized_unit_price(new.unit_regular_price * new.fx_rate, new.unit_base_quantity, new.base_dimension, new.comparison_unit, v_density);
  new.normalized_paid_base    := normalized_unit_price(new.unit_paid_price    * new.fx_rate, new.unit_base_quantity, new.base_dimension, new.comparison_unit, v_density);
  return new;
end $$;
create trigger price_observation_normalize before insert or update on price_observation
  for each row execute function price_observation_normalize();

create function price_observation_alerts() returns trigger language plpgsql as $$
declare s household_setting; prev price_observation; v_pct numeric;
begin
  if new.merchant_product_id is null or not new.regular_known or new.normalized_regular_base is null then return null; end if;
  select * into s from household_setting where household_id = new.household_id;
  if not found then s.price_jump_threshold_pct := 10; s.shrinkflation_min_size_drop_pct := 2; s.shrinkflation_price_tolerance_pct := 2; end if;

  -- Shrinkflation: gleiches Produkt (oder Vorgänger-Produkt), Packung kleiner, Packungspreis ~ gleich oder höher
  select o.* into prev from price_observation o
   where o.household_id = new.household_id and o.regular_known and o.id <> new.id
     and o.observed_on <= new.observed_on
     and (o.merchant_product_id = new.merchant_product_id
          or o.merchant_product_id = (select replaces_id from merchant_product where id = new.merchant_product_id))
     and o.unit_base_quantity is not null and o.base_dimension = new.base_dimension
   order by o.observed_on desc, o.created_at desc limit 1;
  if found and new.unit_base_quantity < prev.unit_base_quantity * (1 - s.shrinkflation_min_size_drop_pct / 100)
           and new.unit_regular_price * new.fx_rate >= prev.unit_regular_price * prev.fx_rate * (1 - s.shrinkflation_price_tolerance_pct / 100) then
    v_pct := round(((new.unit_regular_price * new.fx_rate / new.unit_base_quantity)
                  / (prev.unit_regular_price * prev.fx_rate / prev.unit_base_quantity) - 1) * 100, 2);
    insert into price_alert (household_id, kind, merchant_id, merchant_product_id, master_product_id, previous_observation_id, observation_id,
                             old_base_quantity, new_base_quantity, old_unit_price, new_unit_price, old_normalized, new_normalized, change_pct)
    values (new.household_id, 'shrinkflation', new.merchant_id, new.merchant_product_id, new.master_product_id, prev.id, new.id,
            prev.unit_base_quantity, new.unit_base_quantity, prev.unit_regular_price, new.unit_regular_price,
            prev.normalized_regular_base, new.normalized_regular_base, v_pct);
    return null;
  end if;

  -- Preissprung: gleicher Händler, gleiche Packung, letzter Regulärpreis
  select o.* into prev from price_observation o
   where o.merchant_product_id = new.merchant_product_id and o.merchant_id = new.merchant_id
     and o.regular_known and o.id <> new.id and o.observed_on <= new.observed_on
   order by o.observed_on desc, o.created_at desc limit 1;
  if found and prev.unit_regular_price > 0 and prev.unit_base_quantity > 0 and new.unit_base_quantity > 0 then
    v_pct := round(((new.unit_regular_price * new.fx_rate / new.unit_base_quantity)
                  / (prev.unit_regular_price * prev.fx_rate / prev.unit_base_quantity) - 1) * 100, 2);
    if abs(v_pct) >= s.price_jump_threshold_pct then
      insert into price_alert (household_id, kind, merchant_id, merchant_product_id, master_product_id, previous_observation_id, observation_id,
                               old_base_quantity, new_base_quantity, old_unit_price, new_unit_price, old_normalized, new_normalized, change_pct)
      values (new.household_id, case when v_pct > 0 then 'price_jump'::alert_kind else 'price_drop'::alert_kind end,
              new.merchant_id, new.merchant_product_id, new.master_product_id, prev.id, new.id,
              prev.unit_base_quantity, new.unit_base_quantity, prev.unit_regular_price, new.unit_regular_price,
              prev.normalized_regular_base, new.normalized_regular_base, v_pct);
    end if;
  end if;
  return null;
end $$;
create trigger price_observation_alerts after insert on price_observation
  for each row execute function price_observation_alerts();

-- 8.6 Beleg bestätigen: Anteile rechnen, prüfen, Preise erfassen
create function on_transaction_confirm() returns trigger language plpgsql as $$
begin
  perform recompute_allocations(new.id);
  perform validate_transaction(new.id);
  perform record_price_observations(new.id);
  return null;
end $$;
create trigger transaction_confirm after update of status on transaction_header
  for each row when (new.status = 'confirmed' and old.status is distinct from 'confirmed')
  execute function on_transaction_confirm();

-- Änderungen an bestätigten Belegen halten die Anteile aktuell
create function refresh_allocations() returns trigger language plpgsql as $$
declare v_txn uuid := case when tg_table_name = 'transaction_header' then new.id
                           else coalesce(new.transaction_id, old.transaction_id) end;
begin
  if exists (select 1 from transaction_header where id = v_txn and status = 'confirmed') then
    perform recompute_allocations(v_txn);
  end if;
  return null;
end $$;
create trigger line_item_refresh after update of regular_price, item_discount, cost_account_id, deleted_at on line_item
  for each row execute function refresh_allocations();
create trigger payment_refresh after insert or delete or update of amount, kind, account_id on transaction_payment
  for each row execute function refresh_allocations();
create trigger txn_pot_refresh after update of default_cost_account_id on transaction_header
  for each row when (new.status = 'confirmed') execute function refresh_allocations();

-- 8.7 Alias lernen (vom Prüf-Dialog aufgerufen)
--  normalisierter Schlüssel: Grossbuchstaben, Umlaute ausgeschrieben, Preise/Mengenfaktoren/Gewichte/MWST-Code entfernt,
--  Packungsgrössen bleiben (1L ≠ 0.5L)
create function alias_key(p_raw text) returns text language sql immutable as $$
  select btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      translate(replace(replace(replace(upper(p_raw), 'Ä', 'AE'), 'Ö', 'OE'), 'Ü', 'UE'), 'ÉÈÊÀÂÔÛÇ', 'EEEAAOUC'),
      '^\s*\d+\s*[X×]\s+', ''),                                  -- «2 x » Mengenfaktor vorne
      '\s+\d+[.,]\d{3}\s*KG\y.*$', ''),                          -- «0.734 kg x 2.90/kg …» Gewicht im Offenverkauf
      '\s+-?\d+[.,]\d{2}(\s+[A-Z0-9])?\s*$', ''),                -- Preis (+ MWST-Code) am Zeilenende
      '(\*|%|\yAKTION\y|\yPROMO\y)', ' ', 'g'),                  -- Aktionsmarker
      '[^A-Z0-9.,/ -]', '', 'g'),
      '\s+', ' ', 'g')) $$;

create function confirm_alias(p_household uuid, p_merchant uuid, p_raw text, p_master uuid, p_merchant_product uuid,
                              p_unit_price numeric, p_was_suggestion_correct boolean) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into receipt_alias_mapping (household_id, merchant_id, raw_text_key, raw_text_sample, master_product_id, merchant_product_id,
                                     source, times_seen, times_confirmed, last_unit_price)
  values (p_household, p_merchant, alias_key(p_raw), p_raw, p_master, p_merchant_product, 'user_confirmed', 1, 1, p_unit_price)
  on conflict (household_id, merchant_id, raw_text_key) do update set
    times_seen        = receipt_alias_mapping.times_seen + 1,
    times_confirmed   = receipt_alias_mapping.times_confirmed + case when p_was_suggestion_correct then 1 else 0 end,
    times_corrected   = receipt_alias_mapping.times_corrected + case when p_was_suggestion_correct then 0 else 1 end,
    master_product_id = excluded.master_product_id,
    merchant_product_id = coalesce(excluded.merchant_product_id, receipt_alias_mapping.merchant_product_id),
    raw_text_sample   = excluded.raw_text_sample,
    last_unit_price   = excluded.last_unit_price,
    source            = case when p_was_suggestion_correct then receipt_alias_mapping.source else 'user_confirmed' end,
    last_seen_at      = now(),
    updated_at        = now()
  returning id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- 9. Auswertungen (Views & Funktionen)
-- =====================================================================

-- 9.1 Jeder Personenanteil mit Topf, Kategorie und Klasse
create view v_allocation as
select a.line_item_id, a.person_id, h.household_id, h.id as transaction_id,
       h.booking_date as budget_date,
       coalesce(l.cost_account_id, h.default_cost_account_id) as cost_account_id,
       l.category_id, c.life_area_id, c.parent_id as category_parent_id,
       coalesce(l.spending_class, mp.spending_class, c.spending_class, la.spending_class, 'want') as spending_class,
       l.item_type, l.purchase_intent, a.amount, a.amount_base
  from line_item_allocation a
  join line_item l           on l.id = a.line_item_id and l.deleted_at is null
  join transaction_header h  on h.id = l.transaction_id and h.status = 'confirmed' and h.deleted_at is null
  left join master_product mp on mp.id = l.master_product_id
  left join category c        on c.id = l.category_id
  left join life_area la      on la.id = c.life_area_id;

-- 9.2 Belegübersicht: Artikelrabatte vs. Gutscheine
create view v_transaction_summary as
select h.id as transaction_id, h.household_id, h.booking_date, h.merchant_id, h.currency, h.total_amount, h.total_amount_base,
       coalesce(sum(l.regular_price) filter (where l.item_type = 'product'), 0)        as regular_total,
       coalesce(sum(l.item_discount), 0)                                               as item_discount_total,   -- echte Ersparnis
       (select coalesce(sum(amount), 0) from transaction_payment tp
         where tp.transaction_id = h.id and not tp.is_cash_equivalent)                  as voucher_or_loyalty_redeemed,
       (select coalesce(sum(amount), 0) from transaction_payment tp
         where tp.transaction_id = h.id and tp.is_cash_equivalent)                      as cash_paid
  from transaction_header h left join line_item l on l.transaction_id = h.id and l.deleted_at is null
 where h.deleted_at is null
 group by h.id;

-- 9.3 Saldo zwischen den Personen
--   Saldo_p = bezahlt_p − My Share_p + Σ Überweisungen × (Anteil_p am Quellkonto − Anteil_p am Zielkonto)
--   > 0: p hat für andere mitbezahlt · < 0: p schuldet · Σ über alle Personen = 0
--   Einzahlungen von aussen (Lohn, Kinderzulage: from_account_id leer) sind neutral.
create view v_settlement_balance as
with paid as (
  select h.household_id, s.person_id,
         sum(s.amount_base) as paid_total,
         sum(s.amount_base) filter (where tp.account_id is null) as voucher_part
    from payment_share s
    join transaction_payment tp on tp.id = s.payment_id
    join transaction_header h on h.id = tp.transaction_id
   where h.status = 'confirmed' and h.deleted_at is null
   group by 1, 2),
share as (select person_id, sum(amount_base) as my_share from v_allocation group by 1),
tr as (
  select o.person_id, sum(x.amount * o.share * x.dir) as net
    from (select from_account_id as acc, amount, 1 as dir from transfer where from_account_id is not null
          union all
          select to_account_id, amount, -1 from transfer where from_account_id is not null) x
    join account_owner o on o.account_id = x.acc
   group by 1)
select p.household_id, p.id as person_id, p.display_name,
       coalesce(paid.paid_total, 0) as paid_total, coalesce(paid.voucher_part, 0) as voucher_part,
       coalesce(share.my_share, 0) as my_share, round(coalesce(tr.net, 0), 2) as transfers_net,
       round(coalesce(paid.paid_total, 0) - coalesce(share.my_share, 0) + coalesce(tr.net, 0), 2) as balance
  from person p
  left join paid  on paid.person_id = p.id
  left join share on share.person_id = p.id
  left join tr    on tr.person_id = p.id
 where p.role = 'adult';

-- Ausgleichsvorschlag mit minimaler Anzahl Überweisungen (greedy: grösster Schuldner → grösster Gläubiger)
create function suggest_settlements(p_household uuid)
returns table (from_person_id uuid, to_person_id uuid, amount numeric) language plpgsql as $$
declare d record; c record; v_amt numeric;
begin
  create temp table _bal on commit drop as
    select person_id, balance from v_settlement_balance where household_id = p_household and abs(balance) >= 0.01;
  loop
    select * into d from _bal where balance <= -0.01 order by balance asc, person_id limit 1;
    select * into c from _bal where balance >=  0.01 order by balance desc, person_id limit 1;
    exit when d is null or c is null;
    v_amt := least(-d.balance, c.balance);
    from_person_id := d.person_id; to_person_id := c.person_id; amount := v_amt; return next;
    update _bal set balance = balance + v_amt where person_id = d.person_id;
    update _bal set balance = balance - v_amt where person_id = c.person_id;
  end loop;
  drop table _bal;
end $$;

-- 9.4 Kontostand und Geldfluss je Konto (sinnvoll für Konten, deren Einzahlungen erfasst sind)
create view v_account_flow as
select t.to_account_id as account_id, t.transfer_date as d, t.amount as amount, 'transfer_in' as what from transfer t
union all
select t.from_account_id, t.transfer_date, -t.amount, 'transfer_out' from transfer t where t.from_account_id is not null
union all
select tp.account_id, h.booking_date, -tp.amount_base, case when tp.amount >= 0 then 'payment' else 'credit' end
  from transaction_payment tp join transaction_header h on h.id = tp.transaction_id
 where tp.account_id is not null and h.status = 'confirmed' and h.deleted_at is null;

create view v_account_balance as
select a.id as account_id, a.household_id, a.name, a.kind, a.status, a.opening_balance,
       a.opening_balance + coalesce((select sum(f.amount) from v_account_flow f
                                      where f.account_id = a.id and f.d >= coalesce(a.opening_date, '-infinity'::date)), 0) as balance
  from account a;

create view v_account_flow_month as
select account_id, date_trunc('month', d)::date as month,
       sum(amount) filter (where amount > 0) as money_in, -sum(amount) filter (where amount < 0) as money_out, sum(amount) as net
  from v_account_flow group by 1, 2;

-- 9.5 Variable Budgets: person = nur My Share · account = alle Kosten des Topfs
--      Kategorien mit aktivem Sinking Fund belasten den Fonds statt das Budget
create function budget_spent(p_budget uuid, p_from date, p_to date) returns numeric language sql stable as $$
  select coalesce(sum(v.amount_base), 0)
    from variable_budget b
    join v_allocation v on v.household_id = b.household_id
   where b.id = p_budget
     and v.budget_date >= p_from and v.budget_date < p_to
     and (case when b.scope = 'person' then v.person_id = b.person_id else v.cost_account_id = b.account_id end)
     and (b.life_area_id is null or v.life_area_id = b.life_area_id)
     and (b.category_id is null or v.category_id = b.category_id or v.category_parent_id = b.category_id)
     and not exists (select 1 from sinking_fund f where f.closed_at is null and f.household_id = b.household_id
                       and f.category_id = v.category_id and f.cost_account_id = v.cost_account_id)
$$;

create function budget_months(p_budget uuid, p_until date)
returns table (month date, budget_amount numeric, rollover_in numeric, available numeric, spent numeric, carry_out numeric)
language sql stable as $$
  with recursive b as (select * from variable_budget where id = p_budget),
  m as (
    select row_number() over (order by g) as n, g::date as month
      from b, generate_series(date_trunc('month', b.valid_from), date_trunc('month', least(p_until, coalesce(b.valid_to, p_until))), interval '1 month') g),
  ms as (select m.n, m.month, b.monthly_amount, b.rollover_mode,
                budget_spent(p_budget, m.month, (m.month + interval '1 month')::date) as spent from m, b),
  r as (
    select n, month, monthly_amount::numeric, 0::numeric as rollover_in, monthly_amount::numeric as available, spent::numeric,
           (case rollover_mode when 'none' then 0 when 'surplus_only' then greatest(monthly_amount - spent, 0)
                else monthly_amount - spent end)::numeric as carry_out, rollover_mode
      from ms where n = 1
    union all
    select ms.n, ms.month, ms.monthly_amount::numeric, r.carry_out, (ms.monthly_amount + r.carry_out)::numeric, ms.spent::numeric,
           (case ms.rollover_mode when 'none' then 0 when 'surplus_only' then greatest(ms.monthly_amount + r.carry_out - ms.spent, 0)
                else ms.monthly_amount + r.carry_out - ms.spent end)::numeric, ms.rollover_mode
      from r join ms on ms.n = r.n + 1)
  select month, monthly_amount, rollover_in, available, spent, carry_out from r order by month
$$;

-- Safe-to-Spend heute = (verfügbar − ausgegeben bis gestern) / verbleibende Tage inkl. heute
create function safe_to_spend(p_budget uuid, p_today date)
returns table (available numeric, spent_before_today numeric, spent_today numeric, remaining_days int,
               safe_per_day numeric, left_today numeric, burn_rate_per_day numeric, projected_month_spend numeric,
               pace text)
language plpgsql stable as $$
declare v_month date := date_trunc('month', p_today)::date; v_dim int; v_day int; v_avail numeric; b variable_budget;
begin
  select * into b from variable_budget where id = p_budget;
  v_dim := extract(day from (v_month + interval '1 month - 1 day'))::int;
  v_day := extract(day from p_today)::int;
  select bm.available into v_avail from budget_months(p_budget, p_today) bm where bm.month = v_month;
  available          := coalesce(v_avail, b.monthly_amount);
  spent_before_today := budget_spent(p_budget, v_month, p_today);
  spent_today        := budget_spent(p_budget, p_today, p_today + 1);
  remaining_days     := v_dim - v_day + 1;
  safe_per_day       := (floor(greatest(available - spent_before_today, 0) / remaining_days * 20) / 20)::numeric(12,2);   -- auf 5 Rappen abgerundet
  left_today         := safe_per_day - spent_today;
  burn_rate_per_day  := round((spent_before_today + spent_today) / v_day, 2);
  projected_month_spend := round(burn_rate_per_day * v_dim, 2);
  pace := case when projected_month_spend <= available then 'on_track'
               when projected_month_spend <= available * 1.1 then 'warning' else 'over' end;
  return next;
end $$;

-- 9.6 Fixkosten: Monatsäquivalent je Topf und je Person
create view v_fixed_cost_monthly as
select f.id as fixed_cost_id, f.household_id, f.name, f.cost_account_id, a.name as account_name, f.life_area_id,
       f.spending_class, f.amount, f.frequency, round(f.amount * frequency_per_month(f.frequency), 2) as monthly_equivalent
  from fixed_cost f join account a on a.id = f.cost_account_id
 where f.is_active;

create view v_fixed_cost_person_monthly as
select f.household_id, o.person_id, sum(round(f.monthly_equivalent * o.share, 2)) as monthly_share
  from v_fixed_cost_monthly f join account_owner o on o.account_id = f.cost_account_id
 group by 1, 2;

-- 9.7 Verträge: nächste Verlängerung, Kündigungsfrist, Erinnerung
create function contract_deadlines(p_today date)
returns table (contract_id uuid, name text, next_renewal date, cancellation_deadline date, remind_on date, days_left int, status text)
language sql stable as $$
  with c as (
    select k.*, coalesce(s.contract_reminder_days, 30) as lead,
           case when k.auto_renews and k.renewal_date < p_today
                then (select min((k.renewal_date + make_interval(months => k.renewal_period_months * g))::date)
                        from generate_series(1, 1200) g
                       where (k.renewal_date + make_interval(months => k.renewal_period_months * g))::date >= p_today)
                else k.renewal_date end as nr
      from contract k left join household_setting s on s.household_id = k.household_id
     where k.cancelled_on is null),
  d as (
    select c.*, case when c.notice_to_month_end
                     then (date_trunc('month', c.nr - c.cancellation_notice_days + 1) - interval '1 day')::date   -- letzter Tag des Vormonats
                     else c.nr - c.cancellation_notice_days end as deadline
      from c)
  select id, name, nr, deadline, deadline - lead, deadline - p_today,
         case when p_today > deadline then 'missed'
              when deadline - p_today <= 7 then 'last_chance'
              when p_today >= deadline - lead then 'remind' else 'ok' end
    from d
$$;

-- 9.8 Sinking Funds: Stand, nötige Monatsrate, Fortschritt
create function sinking_fund_status(p_today date)
returns table (fund_id uuid, name text, balance numeric, contributed numeric, spent numeric, target_amount numeric,
               months_left int, required_monthly numeric, monthly_contribution numeric, on_track boolean, progress_pct numeric)
language sql stable as $$
  select f.id, f.name, x.contributed - x.spent, x.contributed, x.spent, f.target_amount, x.ml,
         ceil(greatest(f.target_amount - (x.contributed - x.spent), 0) / x.ml * 20) / 20,
         f.monthly_contribution,
         f.monthly_contribution >= ceil(greatest(f.target_amount - (x.contributed - x.spent), 0) / x.ml * 20) / 20,
         round(least((x.contributed - x.spent) / nullif(f.target_amount, 0) * 100, 100), 1)
    from sinking_fund f
    cross join lateral (
      select coalesce((select sum(amount) from sinking_fund_entry e where e.fund_id = f.id and e.entry_date <= p_today), 0) as contributed,
             coalesce((select sum(v.amount_base) from v_allocation v
                        where v.household_id = f.household_id and v.cost_account_id = f.cost_account_id
                          and v.category_id = f.category_id and v.budget_date >= f.start_date and v.budget_date <= p_today), 0) as spent,
             greatest(1, case when f.target_date is null then 1 else
                 (extract(year from f.target_date) * 12 + extract(month from f.target_date))
               - (extract(year from p_today) * 12 + extract(month from p_today)) + 1 end)::int as ml
    ) x
   where f.closed_at is null
$$;

-- Monatliche Einzahlungen buchen (idempotent; z. B. täglicher Cron)
create function post_fund_contributions(p_month date) returns int language sql as $$
  with ins as (
    insert into sinking_fund_entry (fund_id, entry_date, kind, amount, note)
    select id, date_trunc('month', p_month)::date, 'contribution', monthly_contribution, 'Monatsrate'
      from sinking_fund where closed_at is null and monthly_contribution > 0 and start_date <= p_month
    on conflict (fund_id, entry_date, kind) do nothing returning 1)
  select count(*)::int from ins
$$;

-- 9.9 Daueraufträge eines Monats buchen (idempotent; z. B. täglicher Cron)
create function post_standing_orders(p_month date) returns int language sql as $$
  with ins as (
    insert into transfer (household_id, from_account_id, to_account_id, amount, transfer_date, kind, standing_order_id, note)
    select s.household_id, s.from_account_id, s.to_account_id, s.amount,
           (date_trunc('month', p_month) + (s.day_of_month - 1) * interval '1 day')::date, s.kind, s.id, 'Dauerauftrag'
      from standing_order s
     where s.valid_from <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
       and (s.valid_to is null or s.valid_to >= date_trunc('month', p_month)::date)
    on conflict (standing_order_id, transfer_date) do nothing
    returning 1)
  select count(*)::int from ins
$$;

-- Kontenplan: wohin das Geld jeden Monat fliesst
create view v_standing_order_plan as
select s.household_id, s.id as standing_order_id, fa.name as from_account, ta.name as to_account, ta.kind as to_kind,
       s.amount, s.day_of_month, s.kind, s.valid_from, s.valid_to
  from standing_order s
  left join account fa on fa.id = s.from_account_id
  join account ta on ta.id = s.to_account_id;

-- 9.10 50/30/20 je Person und Monat (die Budgets sind heute pro Person getrennt)
--   Bedarf/Wünsche = My Share nach Klasse · gespart = Überweisungen auf eigene Sparkonten · Rest = nicht verplant
create function analysis_50_30_20(p_person uuid, p_month date)
returns table (income numeric, needs numeric, wants numeric, saved_to_accounts numeric, unallocated numeric,
               needs_pct numeric, wants_pct numeric, savings_pct numeric)
language sql stable as $$
  with m as (select date_trunc('month', p_month)::date as von, (date_trunc('month', p_month) + interval '1 month')::date as bis),
  inc as (
    select coalesce((select net_monthly from person_income where person_id = p_person and valid_from <= p_month
                      order by valid_from desc limit 1), 0) as v),
  sp as (
    select coalesce(sum(amount_base) filter (where spending_class = 'need'), 0) as needs,
           coalesce(sum(amount_base) filter (where spending_class = 'want'), 0) as wants
      from v_allocation, m where person_id = p_person and budget_date >= m.von and budget_date < m.bis),
  sv as (
    select coalesce(sum(t.amount * o.share), 0) as saved
      from m
      join transfer t on t.transfer_date >= m.von and t.transfer_date < m.bis
      join account ta on ta.id = t.to_account_id and ta.kind = 'sparen'
      join account_owner o on o.account_id = ta.id and o.person_id = p_person
     where not exists (select 1 from account fa where fa.id = t.from_account_id and fa.kind = 'sparen'))
  select inc.v, sp.needs, sp.wants, round(sv.saved, 2), inc.v - sp.needs - sp.wants - round(sv.saved, 2),
         round(sp.needs / nullif(inc.v, 0) * 100, 1), round(sp.wants / nullif(inc.v, 0) * 100, 1),
         round((inc.v - sp.needs - sp.wants) / nullif(inc.v, 0) * 100, 1)
    from inc, sp, sv
$$;

-- 9.11 Verbrauchszyklus je MasterProduct
create view v_consumption_cycle as
with buys as (
  select h.household_id, l.master_product_id, h.booking_date as d, sum(l.base_quantity) as qty
    from line_item l join transaction_header h on h.id = l.transaction_id
    join master_product m on m.id = l.master_product_id and m.track_consumption
   where l.item_type = 'product' and l.deleted_at is null and h.status = 'confirmed' and h.deleted_at is null
   group by 1, 2, 3),
gaps as (
  select b.*, d - lag(d) over (partition by household_id, master_product_id order by d) as gap from buys b)
select household_id, master_product_id, count(*) as purchases, min(d) as first_purchase, max(d) as last_purchase,
       percentile_cont(0.5) within group (order by gap) as median_interval_days,
       (array_agg(qty order by d desc))[1] as last_quantity,
       round((sum(qty) - (array_agg(qty order by d desc))[1]) / nullif(max(d) - min(d), 0), 3) as daily_consumption,
       (max(d) + round(percentile_cont(0.5) within group (order by gap))::int) as next_expected
  from gaps group by 1, 2 having count(*) >= 3;

-- 9.12 Smart Basket: günstigster Händler und lohnende Aufteilung auf 2 Läden
create function smart_basket(p_list uuid, p_today date)
returns table (option_rank int, merchants text, total_chf numeric, priced_items int, total_items int,
               saving_vs_best_single numeric, recommended boolean)
language sql stable as $$
  with s as (
    select hs.* from shopping_list sl join household_setting hs on hs.household_id = sl.household_id where sl.id = p_list),
  items as (
    select li.id, li.master_product_id, mp.comparison_unit, li.quantity * unit_factor(li.unit) as base_qty,
           unit_dimension(li.unit) as dim, mp.density_g_per_ml
      from shopping_list_item li join master_product mp on mp.id = li.master_product_id
     where li.list_id = p_list and li.checked_at is null),
  latest as (                             -- je Produkt, Händler, MerchantProduct: jüngste Beobachtung
    select distinct on (o.master_product_id, o.merchant_id, o.merchant_product_id) o.*
      from price_observation o, s
     where o.observed_on > p_today - s.price_freshness_days
       and o.master_product_id in (select master_product_id from items)
     order by o.master_product_id, o.merchant_id, o.merchant_product_id, o.observed_on desc, o.created_at desc),
  best as (                               -- günstigste Variante je Händler (Aktion nur, wenn frisch)
    select l.master_product_id, l.merchant_id,
           min(case when l.is_promo and l.observed_on > p_today - s.promo_validity_days
                    then l.normalized_paid_base else l.normalized_regular_base end) as norm
      from latest l, s group by 1, 2),
  cost as (
    select i.id as item_id, b.merchant_id,
           round(b.norm * comparison_quantity(i.base_qty, i.dim, i.comparison_unit, i.density_g_per_ml), 2) as c
      from items i join best b on b.master_product_id = i.master_product_id),
  merchants as (select distinct c.merchant_id, m.name from cost c join merchant m on m.id = c.merchant_id),
  fallback as (select item_id, max(c) as c from cost group by 1),   -- fehlender Preis → teuerster bekannter (konservativ)
  single as (
    select m.merchant_id, sum(coalesce(c.c, f.c)) as total, count(c.c) as priced
      from merchants m cross join fallback f left join cost c on c.merchant_id = m.merchant_id and c.item_id = f.item_id
     group by 1),
  pair as (
    select a.merchant_id as m1, b.merchant_id as m2,
           sum(least(coalesce(ca.c, f.c), coalesce(cb.c, f.c))) as total,
           count(*) filter (where ca.c is not null or cb.c is not null) as priced
      from merchants a join merchants b on (a.name, a.merchant_id) < (b.name, b.merchant_id)
      cross join fallback f
      left join cost ca on ca.merchant_id = a.merchant_id and ca.item_id = f.item_id
      left join cost cb on cb.merchant_id = b.merchant_id and cb.item_id = f.item_id
     group by 1, 2),
  pair_useful as (                        -- nur Paare, die günstiger sind als jeder der beiden Läden allein
    select p.* from pair p join single s1 on s1.merchant_id = p.m1 join single s2 on s2.merchant_id = p.m2
     where p.total < least(s1.total, s2.total)),
  opts as (
    select (select name from merchant where id = single.merchant_id) as merchants, total, priced, 1 as stores from single
    union all
    select (select name from merchant where id = m1) || ' + ' || (select name from merchant where id = m2), total, priced, 2 from pair_useful),
  bs as (select min(total) as best_single from single)
  select (row_number() over (order by o.total, o.stores))::int, o.merchants, o.total, o.priced::int,
         (select count(*) from items)::int, bs.best_single - o.total,
         case when o.stores = 1 then o.total = bs.best_single
                   and not exists (select 1 from opts o2, s where o2.stores = 2
                                     and bs.best_single - o2.total >= greatest(s.basket_split_min_saving_chf, bs.best_single * s.basket_split_min_saving_pct / 100))
              else o.total = (select min(total) from opts where stores = 2)
                   and bs.best_single - o.total >= (select greatest(s.basket_split_min_saving_chf, bs.best_single * s.basket_split_min_saving_pct / 100) from s)
         end
    from opts o, bs
   order by o.total, o.stores
$$;

-- 9.13 Garantien
create view v_warranty_status as
select w.*, coalesce(w.extended_until, w.expires_on) as valid_until,
       coalesce(w.extended_until, w.expires_on) - current_date as days_left,
       case when coalesce(w.extended_until, w.expires_on) < current_date then 'expired'
            when coalesce(w.extended_until, w.expires_on) - current_date <= coalesce(s.warranty_reminder_days, 60) then 'expiring_soon'
            else 'active' end as status,
       h.receipt_attachment_id
  from warranty w
  left join transaction_header h on h.id = w.transaction_id
  left join household_setting s on s.household_id = w.household_id;

-- updated_at pflegen
create trigger t_touch before update on household          for each row execute function touch_updated_at();
create trigger t_touch before update on person             for each row execute function touch_updated_at();
create trigger t_touch before update on account            for each row execute function touch_updated_at();
create trigger t_touch before update on master_product     for each row execute function touch_updated_at();
create trigger t_touch before update on merchant_product   for each row execute function touch_updated_at();
create trigger t_touch before update on transaction_header for each row execute function touch_updated_at();
create trigger t_touch before update on line_item          for each row execute function touch_updated_at();

-- =====================================================================
-- 10. Synchronisation und Ersteinrichtung
-- =====================================================================

-- Tabellen, die zwischen Handy (PGlite) und Server (Supabase) synchronisiert werden – in Abhängigkeitsreihenfolge.
-- Abgeleitete Tabellen (line_item_allocation, payment_share, price_observation, price_alert) werden NICHT
-- synchronisiert: beide Seiten berechnen sie mit derselben Logik selbst.
-- Weitere Tabellen kommen mit ihren Modulen dazu (M2: Belege, M5: Budget …).
create function sync_tables() returns table (ord int, name text, pk text)
language sql immutable as $$
  values (1, 'household', 'id'), (2, 'household_member', 'id'), (3, 'household_setting', 'household_id'),
         (4, 'person', 'id'), (5, 'person_income', 'id'), (6, 'account', 'id'), (7, 'account_owner', 'id'),
         (8, 'life_area', 'id'), (9, 'category', 'id'), (10, 'payment_method', 'id')
$$;

-- household_id aus dem Elternobjekt übernehmen, wenn es fehlt
create function fill_household_from_account() returns trigger language plpgsql as $$
begin
  if new.household_id is null then select household_id into new.household_id from account where id = new.account_id; end if;
  return new;
end $$;
create trigger t_fill_household before insert on account_owner for each row execute function fill_household_from_account();
create function fill_household_from_person() returns trigger language plpgsql as $$
begin
  if new.household_id is null then select household_id into new.household_id from person where id = new.person_id; end if;
  return new;
end $$;
create trigger t_fill_household before insert on person_income for each row execute function fill_household_from_person();

-- updated_at für alle synchronisierten Tabellen
do $$
declare t record;
begin
  for t in select name from sync_tables() where name not in ('household', 'person', 'account') loop
    execute format('create trigger t_touch before update on %I for each row execute function touch_updated_at()', t.name);
  end loop;
end $$;

-- Persönlicher Topf einer Person: heute «Privat», später «Freizeit»
create view v_personal_account as
select o.person_id, a.id as account_id, a.name, a.household_id
  from account a join account_owner o on o.account_id = a.id
 where a.is_personal_default and a.status <> 'closed'
   and (select count(*) from account_owner x where x.account_id = a.id) = 1;

-- Ersteinrichtung: zwei Erwachsene, Konten/Töpfe, Lebensbereiche und Kategorien mit Standard-Topf
create function seed_household(p_household uuid, p_name text, p_adult1 text, p_adult2 text, p_today date default current_date)
returns void language plpgsql as $$
declare
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); leben uuid := gen_random_uuid();
  acc uuid; la uuid; r record; c record;
begin
  insert into household (id, name) values (p_household, p_name) on conflict (id) do nothing;
  insert into household_setting (household_id) values (p_household) on conflict do nothing;
  insert into person (id, household_id, display_name, role, sort) values
    (p1, p_household, p_adult1, 'adult', 1), (p2, p_household, p_adult2, 'adult', 2);

  -- Konten/Töpfe: Privatkonten aktiv, alles andere vorbereitet (virtuell)
  insert into account (id, household_id, name, kind, status, sort) values (leben, p_household, 'Gemeinsam Leben', 'leben', 'virtual', 1);
  insert into account_owner (household_id, account_id, person_id, share) values (p_household, leben, p1, 0.5), (p_household, leben, p2, 0.5);
  for r in select * from (values (p1, p_adult1, 0), (p2, p_adult2, 1)) v(pid, pname, i) loop
    acc := gen_random_uuid();
    insert into account (id, household_id, name, kind, status, opening_date, is_personal_default, sort)
      values (acc, p_household, r.pname || ' Privat', 'privat', 'active', p_today, true, 10 + r.i);
    insert into account_owner (household_id, account_id, person_id, share) values (p_household, acc, r.pid, 1);
    acc := gen_random_uuid();
    insert into account (id, household_id, name, kind, status, sort) values (acc, p_household, r.pname || ' Sparen', 'sparen', 'virtual', 20 + r.i);
    insert into account_owner (household_id, account_id, person_id, share) values (p_household, acc, r.pid, 1);
    acc := gen_random_uuid();
    insert into account (id, household_id, name, kind, status, sort) values (acc, p_household, r.pname || ' Freizeit', 'freizeit', 'virtual', 30 + r.i);
    insert into account_owner (household_id, account_id, person_id, share) values (p_household, acc, r.pid, 1);
  end loop;

  -- Lebensbereiche und Kategorien (G = Gemeinsam Leben, P = persönlicher Topf der einkaufenden Person)
  for r in select * from (values
      (1,  'Ernährung',      'need',   array['Lebensmittel:G', 'Getränke:G']),
      (2,  'Haushalt',       'need',   array['Haushaltsartikel:G', 'Putzmittel:G', 'Reparaturen:G']),
      (3,  'Wohnen',         'need',   array['Miete:G', 'Nebenkosten:G', 'Strom:G', 'Einrichtung:G']),
      (4,  'Ausgehen',       'want',   array['Restaurant:G', 'Take-away:G']),
      (5,  'Ferien',         'want',   array['Unterkunft:G', 'Reise:G', 'Ferien diverses:G']),
      (6,  'Kinder',         'need',   array['Kinderbedarf:G', 'Betreuung:G']),
      (7,  'Mobilität',      'need',   array['ÖV:P', 'Velo:P', 'Auto:G']),
      (8,  'Gesundheit',     'need',   array['Krankenkasse:P', 'Arzt und Zahnarzt:P', 'Apotheke:P']),
      (9,  'Versicherungen', 'need',   array['Hausrat und Haftpflicht:G', 'Weitere Versicherungen:P']),
      (10, 'Kommunikation',  'need',   array['Internet:G', 'Handy und Abos:P']),
      (11, 'Körperpflege',   'need',   array['Drogerie:P', 'Kosmetik und Coiffeur:P']),
      (12, 'Kleidung',       'want',   array['Kleider und Schuhe:P']),
      (13, 'Freizeit',       'want',   array['Hobby:P', 'Sport:P', 'Kultur und Medien:P']),
      (14, 'Geschenke',      'want',   array['Geschenke:P']),
      (15, 'Bildung',        'need',   array['Weiterbildung:P']),
      (16, 'Steuern',        'need',   array['Steuern:P']),
      (17, 'Sonstiges',      'want',   array['Diverses:P'])
    ) v(sort, name, cls, cats) loop
    la := gen_random_uuid();
    insert into life_area (id, household_id, name, spending_class, sort) values (la, p_household, r.name, r.cls::spending_class, r.sort);
    for c in select split_part(x, ':', 1) as cname, split_part(x, ':', 2) as pot, ord
               from unnest(r.cats) with ordinality u(x, ord) loop
      insert into category (household_id, life_area_id, name, default_cost_account_id, sort)
        values (p_household, la, c.cname, case when c.pot = 'G' then leben end, c.ord);
    end loop;
  end loop;
end $$;
