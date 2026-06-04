-- ============================================================
-- PaperTrail — Full Database Schema  (v1.3)
-- ============================================================
-- Run this entire file in the Supabase SQL editor to set up
-- a fresh project from scratch. Safe to re-run — drops and
-- recreates everything.
-- ============================================================

-- ── Drop existing objects (order matters for FK constraints) ──
drop view  if exists item_purchase_history;
drop table if exists receipt_items      cascade;
drop table if exists receipts           cascade;
drop table if exists shopping_list      cascade;
drop table if exists push_subscriptions cascade;
drop table if exists budgets            cascade;
drop table if exists recurring          cascade;


-- ── receipts ───────────────────────────────────────────────
create table receipts (
  id              uuid          primary key default gen_random_uuid(),

  -- Store identity
  brand           text          not null default 'other',
  -- Normalized brand key. Known values:
  --   costco | walmart | whole-foods | ross | target | safeway |
  --   trader-joes | kroger | cvs | walgreens | aldi |
  --   home-depot | lowes | other
  -- Unknown stores default to 'other' and display by store_name.
  store_name      text          not null,
  location        text,                         -- e.g. "Cincinnati, OH"

  -- Transaction details
  purchase_date   date          not null,
  purchase_time   time,
  transaction_id  text,                         -- OCR txn ID or Costco barcode

  -- Financials (negative total = return receipt)
  total           numeric(10,2) not null default 0,
  tax             numeric(10,2),

  -- Household
  paid_by         text          not null,
  -- Value must be one of the names set in NEXT_PUBLIC_PAYERS env var.
  -- To rename a member: UPDATE receipts SET paid_by='NewName' WHERE paid_by='OldName';

  -- Source
  source          text          not null default 'scan',
  -- Values: 'scan' (OCR+AI) | 'manual' (typed in) | 'costco_api' (imported from Costco)

  -- Category
  category        text          not null default 'other',
  -- Values: groceries | household | utilities | dining | entertainment |
  --         clothing | electronics | pharmacy | insurance | fuel | other

  -- Optional notes
  notes           text,

  -- Media + raw data
  image_urls      text[],                       -- Supabase Storage public URLs (optional)
  raw_ocr_text    text,                         -- full OCR output, kept for debugging

  created_at      timestamptz   default now()
);


-- ── receipt_items ──────────────────────────────────────────
create table receipt_items (
  id              uuid          primary key default gen_random_uuid(),
  receipt_id      uuid          not null references receipts(id) on delete cascade,

  item_code       text,                         -- Costco item number or OCR-extracted code
  name            text          not null,

  -- Pricing (all stored as per-unit amounts)
  original_price  numeric(10,2) not null default 0,   -- price before any discount
  discount_amount numeric(10,2) not null default 0,   -- instant savings applied per unit
  final_price     numeric(10,2) not null default 0,
  -- final_price < 0  → returned item (Costco return receipts)
  -- final_price >= 0 → normal purchase or adjustment

  quantity        integer       not null default 1,
  -- quantity > 1  : multi-unit purchase (e.g. 3 packs); line total = final_price × quantity
  -- quantity = 1  : single unit (default for scanned receipts)
  -- quantity = -1 : returned item (Costco return receipts)

  sort_order      int           default 0,
  created_at      timestamptz   default now()
);


-- ── shopping_list ──────────────────────────────────────────
-- Powers the Needs tab — shared household shopping list.
create table shopping_list (
  id          uuid        primary key default gen_random_uuid(),
  text        text        not null,
  added_by    text,                             -- household member name (from NEXT_PUBLIC_PAYERS)
  done        boolean     not null default false,
  done_at     timestamptz,                      -- when it was checked off
  created_at  timestamptz default now()
);


-- ── push_subscriptions ─────────────────────────────────────
-- Web Push API subscriptions for PWA push notifications.
create table push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  endpoint   text        not null unique,       -- browser push endpoint URL
  auth       text        not null,              -- VAPID auth key
  p256dh     text        not null,              -- VAPID public key
  user_name  text,                              -- optional label (who subscribed)
  created_at timestamptz default now()
);


-- ── budgets ────────────────────────────────────────────────
-- Monthly spending budgets per category.
create table budgets (
  id         uuid          primary key default gen_random_uuid(),
  category   text          not null unique,     -- must match CATEGORIES in types.ts
  amount     numeric(10,2) not null default 0,
  active     boolean       not null default true,
  created_at timestamptz   default now(),
  updated_at timestamptz   default now()
);


-- ── recurring ──────────────────────────────────────────────
-- Recurring bills and subscriptions.
create table recurring (
  id           uuid          primary key default gen_random_uuid(),
  name         text          not null,
  amount       numeric(10,2) not null,
  frequency    text          not null default 'monthly',
  -- Values: monthly | annual | weekly | quarterly
  due_day      integer,                         -- day of month for monthly (1-31)
  due_date     date,                            -- specific date for annual
  paid_by      text          not null,
  category     text          not null default 'other',
  -- Same values as receipts.category
  notes        text,
  active       boolean       not null default true,
  created_at   timestamptz   default now()
  -- last_paid_at removed: paid status is computed from recurring_payments at read time
);


-- ── recurring_payments ─────────────────────────────────────
-- Log of every "mark as paid" event — tracks who paid which bill each cycle.
create table recurring_payments (
  id           uuid          primary key default gen_random_uuid(),
  recurring_id uuid          not null references recurring(id) on delete cascade,
  paid_by      text          not null,
  paid_at      timestamptz   not null default now(),
  amount       numeric(10,2) not null,
  created_at   timestamptz   default now()
);


-- ── Indexes ────────────────────────────────────────────────
create index on receipts(brand);
create index on receipts(purchase_date desc);
create index on receipts(created_at desc);
create index on receipts(source);
create index on receipts(paid_by);
create index on receipts(category);
create index on receipt_items(receipt_id);
create index on receipt_items(item_code);
create index on receipt_items using gin(to_tsvector('english', name));
create index on recurring(active);
create index on recurring_payments(recurring_id);
create index on recurring_payments(paid_at desc);
create index on recurring_payments(paid_by);


-- ── item_purchase_history (view) ──────────────────────────
-- Used by item search (/items), price alerts, and return candidate detection.
-- Intentionally excludes returned items (final_price < 0) so return receipts
-- don't corrupt price trend analysis.
create view item_purchase_history as
  select
    ri.id,
    ri.receipt_id,
    ri.item_code,
    ri.name,
    ri.original_price,
    ri.discount_amount,
    ri.final_price,
    ri.quantity,
    r.purchase_date,
    r.purchase_time,
    r.brand,
    r.store_name,
    r.location,
    r.transaction_id,
    r.source,
    r.paid_by,
    r.category
  from receipt_items ri
  join receipts r on r.id = ri.receipt_id
  where ri.final_price >= 0;
  -- Excludes: returned items (final_price < 0), coupon reversals on return receipts


-- ── Row Level Security ─────────────────────────────────────
-- Disabled — this is a single-household personal app with no auth.
-- Re-enable and add policies when multi-user auth is added (v2.0).
alter table receipts           disable row level security;
alter table receipt_items      disable row level security;
alter table shopping_list      disable row level security;
alter table push_subscriptions disable row level security;
alter table budgets            disable row level security;
alter table recurring          disable row level security;
alter table recurring_payments disable row level security;


-- ── Duplicate prevention indexes ──────────────────────────
-- Enforced at both application level (queries.ts) and DB level.

-- Receipts with a transaction ID: unique by store + date + txn + total
create unique index receipts_unique_txn
  on receipts (store_name, purchase_date, transaction_id, total)
  where transaction_id is not null;

-- Receipts without a transaction ID: unique by store + date + time + total
create unique index receipts_unique_notxn
  on receipts (store_name, purchase_date, coalesce(purchase_time::text, ''), total)
  where transaction_id is null;


-- ============================================================
-- Storage setup (Supabase UI — run once per project)
-- ============================================================
-- 1. Go to Storage → New bucket
-- 2. Name: receipt-images
-- 3. Toggle: Public → Save
-- 4. Run this policy to allow uploads from the app:
--
-- create policy "allow all storage"
--   on storage.objects for all
--   using (true) with check (true);
--
-- ============================================================


-- ============================================================
-- Migration helpers — for upgrading an existing database
-- ============================================================

-- ── Add category + notes (upgrading from v1.2) ─────────────
-- alter table receipts add column if not exists category text not null default 'other';
-- alter table receipts add column if not exists notes text;
-- create index if not exists receipts_category_idx on receipts(category);

-- ── Add source column (if upgrading from pre-v1.2 schema) ──
-- alter table receipts add column if not exists source text not null default 'scan';

-- ── Add quantity column (if upgrading from pre-v1.2 schema) ──
-- alter table receipt_items add column if not exists quantity integer not null default 1;

-- ── Create budgets table (upgrading from v1.2) ─────────────
-- create table if not exists budgets (
--   id uuid primary key default gen_random_uuid(),
--   category text not null unique,
--   amount numeric(10,2) not null default 0,
--   active boolean not null default true,
--   created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- );
-- alter table budgets disable row level security;

-- ── Create recurring_payments table (upgrading from v1.3) ──
-- create table if not exists recurring_payments (
--   id           uuid          primary key default gen_random_uuid(),
--   recurring_id uuid          not null references recurring(id) on delete cascade,
--   paid_by      text          not null,
--   paid_at      timestamptz   not null default now(),
--   amount       numeric(10,2) not null,
--   created_at   timestamptz   default now()
-- );
-- alter table recurring_payments disable row level security;
-- create index if not exists recurring_payments_rid_idx  on recurring_payments(recurring_id);
-- create index if not exists recurring_payments_at_idx   on recurring_payments(paid_at desc);
-- create index if not exists recurring_payments_by_idx   on recurring_payments(paid_by);

-- ── Create recurring table (upgrading from v1.2) ───────────
-- create table if not exists recurring (
--   id uuid primary key default gen_random_uuid(),
--   name text not null,
--   amount numeric(10,2) not null,
--   frequency text not null default 'monthly',
--   due_day integer,
--   due_date date,
--   paid_by text not null,
--   category text not null default 'other',
--   notes text,
--   last_paid_at timestamptz,
--   active boolean not null default true,
--   created_at timestamptz default now()
-- );
-- alter table recurring disable row level security;
-- create index if not exists on recurring(active);

-- ── Remove last_paid_at (new cycle-window design, v1.4+) ──
-- ALTER TABLE recurring DROP COLUMN IF EXISTS last_paid_at;
-- ALTER TABLE recurring DROP COLUMN IF EXISTS paid_this_cycle; -- if it was ever added

-- ── Rename a household member ──────────────────────────────
-- UPDATE receipts      SET paid_by  = 'NewName' WHERE paid_by  = 'OldName';
-- UPDATE shopping_list SET added_by = 'NewName' WHERE added_by = 'OldName';
-- UPDATE recurring     SET paid_by  = 'NewName' WHERE paid_by  = 'OldName';

-- ── Backfill paid_by if it was nullable in an older schema ─
-- UPDATE receipts SET paid_by = 'YourName' WHERE paid_by IS NULL;


-- ============================================================
-- Environment variables required
-- ============================================================
-- NEXT_PUBLIC_SUPABASE_URL          = https://your-project.supabase.co
-- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = your-anon-key
-- OPENAI_API_KEY                    = sk-...
-- GOOGLE_VISION_API_KEY             = AIza...
-- NEXT_PUBLIC_USE_GOOGLE_OCR        = true
-- NEXT_PUBLIC_PAYERS                = Name1,Name2,Name3
-- NEXT_PUBLIC_VAPID_PUBLIC_KEY      = (generate with: npx web-push generate-vapid-keys)
-- VAPID_PRIVATE_KEY                 = (same command above)
-- VAPID_SUBJECT                     = mailto:you@example.com
-- ============================================================
