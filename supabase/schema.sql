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

  -- Client-generated idempotency key (one per scan/import review session).
  -- A retry of the same save attempt (double-click, retry after a timeout)
  -- is a no-op replay via this, not a race against the duplicate-detection
  -- heuristic below. See saveReceipt() in lib/queries.ts.
  client_token    text,

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
  created_at   timestamptz   default now(),
  -- last_paid_at removed: paid status is computed from recurring_payments at read time

  -- Enforced at both the app layer (BillForm validation) and here — without
  -- the right due info, getCycleWindow() can't compute an exact paid-cycle
  -- window for the bill's stated frequency. Defense in depth: this catches
  -- any future write path (a script, a different client) that skips the
  -- app-level check, not just the UI form.
  constraint recurring_due_info_required check (
    (frequency = 'monthly'   and due_day  is not null) or
    (frequency = 'annual'    and due_date is not null) or
    (frequency = 'quarterly' and due_date is not null) or
    (frequency = 'weekly')
  )
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


-- ── price_alert_claims ─────────────────────────────────────
-- A manual, human-entered log of "I acted on this Price Alert" — never
-- inferred from scanned receipts (a return can happen for unrelated reasons
-- like spoiled food, and a price match produces no receipt at all, so there
-- is nothing reliable to infer this from). One row = one specific line item
-- (receipt_item_id) that's been resolved. Keyed by receipt_item_id rather
-- than (item_code, receipt_id): item_code can be null (not every business
-- prints one), and a single receipt can have multiple codeless line items —
-- the composite key would collide between them, but receipt_items.id is
-- always unique. item_code/item_name are still carried as denormalized
-- columns so the Prices page can match/display claims without an extra
-- join. claim_type is a record of WHY (for the person's own reference)
-- only — both types are excluded from future return-candidate checks
-- identically; a different, still-unclaimed purchase of the same item
-- remains free to surface as its own opportunity. No amount is captured: a
-- return's refund and a price match's credit are both already on the
-- receipt/statement, so there is nothing this table needs to total.
create table price_alert_claims (
  id              uuid          primary key default gen_random_uuid(),
  receipt_item_id uuid          not null references receipt_items(id) on delete cascade,
  receipt_id      uuid          not null references receipts(id) on delete cascade,
  item_code       text,
  item_name       text          not null,
  claim_type      text          not null check (claim_type in ('return', 'price_match')),
  claimed_by      text,
  created_at      timestamptz   not null default now(),
  unique (receipt_item_id)
);


-- ── price_alert_exclusions ──────────────────────────────────
-- Items that should never surface as a Price Alert at all — e.g. gold
-- bullion or gas, whose price swings with the market and were never a
-- "you got overcharged" signal in the first place. Added/removed only from
-- the Excluded tab (no per-alert-row button); once added, get_return_
-- candidates() below filters it out on the very next call, so nothing else
-- needs to stay in sync. Exactly one of item_code/item_name is set — code
-- is the reliable match when available (exact, low OCR-error), name is the
-- fallback for codeless items. NOTE: get_return_candidates() currently
-- requires item_code is not null to ever produce a candidate, so a
-- name-only exclusion has nothing to match against yet — it's stored for
-- symmetry with price_alert_claims and to be ready if candidate detection
-- is ever extended to codeless items.
create table price_alert_exclusions (
  id         uuid        primary key default gen_random_uuid(),
  item_code  text,
  item_name  text,
  created_at timestamptz not null default now(),
  check (item_code is not null or item_name is not null)
);
create unique index on price_alert_exclusions(item_code) where item_code is not null;
create unique index on price_alert_exclusions(lower(item_name)) where item_code is null;


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
create index on price_alert_claims(item_code);


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


-- ── item_returns (view) ───────────────────────────────────
-- The complement of item_purchase_history — only returned line items
-- (final_price < 0). Kept as a separate view rather than widening
-- item_purchase_history's filter: the two are used for different purposes
-- (price-trend analysis vs. "what did I return"), and mixing negative rows
-- into the trend view would corrupt it (that's the whole reason
-- item_purchase_history excludes them in the first place).
create view item_returns as
  select
    ri.id,
    ri.receipt_id,
    ri.item_code,
    ri.name,
    abs(ri.final_price) as refund_amount,
    r.purchase_date  as return_date,
    r.purchase_time,
    r.brand,
    r.store_name,
    r.location,
    r.transaction_id,
    r.paid_by
  from receipt_items ri
  join receipts r on r.id = ri.receipt_id
  where ri.final_price < 0;


-- ── RPC functions (server-side aggregation + atomic writes) ─
-- Added to fix: (1) replaceReceiptItems delete+insert not being atomic,
-- (2) return-candidate detection drifting between the UI and the weekly
-- cron, (3) filter stats / spending analytics / item search shipping full
-- tables or unbounded row sets to the browser instead of aggregating in
-- Postgres. CREATE OR REPLACE is idempotent — safe to re-run.

-- Atomically replace all line items on a receipt. Runs inside one implicit
-- transaction — if the insert half fails, the delete never takes effect
-- either, so a receipt can never end up stranded with zero items.
create or replace function replace_receipt_items(p_receipt_id uuid, p_items jsonb)
returns void
language plpgsql
as $$
begin
  delete from receipt_items where receipt_id = p_receipt_id;

  insert into receipt_items
    (receipt_id, item_code, name, original_price, discount_amount, final_price, quantity, sort_order)
  select
    p_receipt_id,
    nullif(item->>'item_code', ''),
    item->>'name',
    coalesce((item->>'original_price')::numeric, 0),
    coalesce((item->>'discount_amount')::numeric, 0),
    coalesce((item->>'final_price')::numeric, 0),
    coalesce((item->>'quantity')::int, 1),
    (ord - 1)::int
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$$;


-- Return candidates — items where a past purchase price is higher than the
-- most recent purchase (return / price-match opportunity). Only considers
-- items with an item_code and a positive final_price (excludes $0 promo/free
-- items from skewing the "was it ever more expensive" comparison), matching
-- how getReturnCandidates() in queries.ts consumes the result. Used by BOTH
-- the Prices page and the weekly price-alert cron, so there is exactly one
-- implementation of "what counts as a candidate" — a separate, row-capped
-- copy of this logic used to live in the cron route and could silently
-- disagree with the UI.
--
-- Layers exclusions on top, from price_alert_exclusions (user-managed via
-- the Excluded tab — gas, gold bullion, or anything else whose price swings
-- are never a real "you got overcharged" signal). Checks BOTH item_code and
-- name — a name-based exclusion has to match on `name` since a coded item
-- still has a name and a name-only exclusion row has no code to match on.
create or replace function get_return_candidates()
returns table(item_code text)
language sql
stable
as $$
  select item_code
  from item_purchase_history
  where item_code is not null and final_price > 0
    and item_code not in (select item_code from price_alert_exclusions where item_code is not null)
    and upper(trim(name)) not in (select upper(trim(item_name)) from price_alert_exclusions where item_name is not null)
  group by item_code
  having count(*) > 1
     and max(final_price) > (array_agg(final_price order by purchase_date desc))[1];
$$;


-- Filter-aware receipt stats (Receipts page stat cards). Replaces a
-- fetch-all-matching-ids-then-.in()-again round trip that risked hitting
-- PostgREST/URL length limits once the filtered set ran into the thousands.
--
-- p_return_filter: 'purchases' | 'returns' | null (all). This mirrors the
-- Receipts page's own filter/pagination truth (getReceipts still returns
-- both purchases and returns unless this narrows it), so `receipts` here is
-- deliberately a literal row count — NOT the "exclude refunds" trip-count
-- semantics used in get_spending_stats below, which is a different page
-- with a different meaning for "how many receipts."
create or replace function get_receipt_stats(
  p_store         text default null,
  p_date_from     date default null,
  p_date_to       date default null,
  p_paid_by       text default null,
  p_source        text default null,
  p_category      text default null,
  p_return_filter text default null
)
returns table(receipts bigint, total numeric, items bigint, savings numeric, refunded numeric)
language sql
stable
as $$
  with matched as (
    select r.id, r.total
    from receipts r
    where (p_store     is null or r.store_name  = p_store)
      and (p_date_from is null or r.purchase_date >= p_date_from)
      and (p_date_to   is null or r.purchase_date <= p_date_to)
      and (p_paid_by   is null or r.paid_by      = p_paid_by)
      and (p_source    is null or r.source       = p_source)
      and (p_category  is null or r.category     = p_category)
      and (p_return_filter is null
           or (p_return_filter = 'purchases' and r.total >= 0)
           or (p_return_filter = 'returns'   and r.total <  0))
  )
  select
    (select count(*) from matched)::bigint,
    coalesce((select sum(total) from matched), 0),
    (select count(*) from receipt_items ri join matched m on m.id = ri.receipt_id)::bigint,
    coalesce((select sum(ri.discount_amount) from receipt_items ri join matched m on m.id = ri.receipt_id), 0),
    -- Sum of just the return receipts within the matched set — same shape as
    -- get_spending_stats.totalRefunded. Shown as its own line under Total
    -- spent on the Receipts page, since `total` above already nets it in.
    coalesce((select -sum(total) from matched where total < 0), 0);
$$;


-- Finance page aggregates (Summary + Analytics tabs), computed entirely in
-- Postgres instead of pulling every receipt (+ every item, for the discount
-- sum) to the browser and reduce()-ing there. "All time" and the YoY toggle
-- used to mean an unbounded full-table fetch on every render.
create or replace function get_spending_stats(
  p_date_from date default null,
  p_date_to   date default null
)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select *
    from receipts r
    where (p_date_from is null or r.purchase_date >= p_date_from)
      and (p_date_to   is null or r.purchase_date <= p_date_to)
  ),
  brand_agg as (
    -- pos_cnt (receipts with total > 0) mirrors the original client-side
    -- storeTrend()'s own receipt count, used only for its "3+ receipts"
    -- confidence gate — cnt (all receipts, incl. refunds) is the one shown
    -- in "Top stores" and used for the net total, same as before.
    select lower(trim(store_name)) as key, min(brand) as brand, min(store_name) as name,
           count(*) as cnt, count(*) filter (where total > 0) as pos_cnt, sum(total) as tot
    from filtered
    group by lower(trim(store_name))
  ),
  month_agg as (
    select to_char(purchase_date, 'YYYY-MM') as month, sum(total) as tot
    from filtered
    group by 1
  ),
  payer_agg as (
    select paid_by, count(*) as cnt, sum(total) as tot
    from filtered
    where paid_by is not null
    group by paid_by
  ),
  category_agg as (
    select coalesce(category, 'other') as category, count(*) as cnt, sum(total) as tot
    from filtered
    where total > 0
    group by 1
  ),
  store_month_agg as (
    select lower(trim(store_name)) as key, to_char(purchase_date, 'YYYY-MM') as month, sum(total) as tot
    from filtered
    where total > 0
    group by 1, 2
  ),
  store_month_json as (
    select key, jsonb_object_agg(month, tot order by month) as months
    from store_month_agg
    group by key
  )
  select jsonb_build_object(
    -- totalSpent nets refunds (unfiltered sum — a return receipt's negative
    -- total already reduces this, same as Top stores / By month below).
    'totalSpent',     coalesce((select sum(total) from filtered), 0),
    -- receiptCount excludes return receipts — they aren't a "shopping trip,"
    -- so counting them here would understate Avg per trip and mislabel "X
    -- receipts" displays. Total dollars above still nets their amount; only
    -- the trip *count* excludes them.
    'receiptCount',   (select count(*) from filtered where total > 0),
    -- Total refunded this period, shown as its own figure rather than netted
    -- into any one category — a return receipt's category doesn't reliably
    -- match what was actually returned (see byCategory below), so blending
    -- it in would misattribute spend across categories.
    'totalRefunded',  coalesce((select -sum(total) from filtered where total < 0), 0),
    'totalSaved',     coalesce((select sum(ri.discount_amount) from receipt_items ri join filtered f on f.id = ri.receipt_id), 0),
    'byBrand',      coalesce((select jsonb_agg(jsonb_build_object('brand', brand, 'name', name, 'count', cnt, 'positiveCount', pos_cnt, 'total', tot) order by tot desc) from brand_agg), '[]'::jsonb),
    'byMonth',      coalesce((select jsonb_agg(jsonb_build_object('month', month, 'total', tot) order by month) from month_agg), '[]'::jsonb),
    'byPayer',      coalesce((select jsonb_agg(jsonb_build_object('payer', paid_by, 'count', cnt, 'total', tot) order by tot desc) from payer_agg), '[]'::jsonb),
    'byCategory',   coalesce((select jsonb_agg(jsonb_build_object('category', category, 'count', cnt, 'total', tot) order by tot desc) from category_agg), '[]'::jsonb),
    -- Keyed by the SAME representative display name as byBrand.name (both derived
    -- from the same lower(trim(store_name)) grouping) so the client can look up
    -- stats.byStoreMonth[b.name] directly with no casing mismatch.
    'byStoreMonth', coalesce((
      select jsonb_object_agg(ba.name, smj.months)
      from store_month_json smj
      join brand_agg ba on ba.key = smj.key
    ), '{}'::jsonb)
  );
$$;


-- Item search (Prices page). Step 1 finds the bounded set of distinct items
-- matching the query/filters (capped at 50 distinct ITEMS, not purchase
-- rows); step 2 returns ALL purchase history for exactly those items, with
-- no cap — even a frequently-bought item is naturally a few hundred rows at
-- most. Replaces a flat `.limit(300)` applied before grouping, which could
-- silently truncate an item's older purchases once a household's history
-- got large enough for a broad search term to exceed 300 rows.
create or replace function search_item_history(
  p_query     text,
  p_brand     text    default null,
  p_date_from date    default null,
  p_date_to   date    default null,
  p_price_max numeric default null
)
returns setof item_purchase_history
language plpgsql
stable
as $$
declare
  is_code   boolean := p_query ~ '^[0-9]+$';
  is_price  boolean := p_query ~ '^\$?[0-9]*\.[0-9]+$';
  price_val numeric;
begin
  if is_price then
    price_val := replace(p_query, '$', '')::numeric;
  end if;

  return query
  with matched_groups as (
    select distinct h.item_code, h.store_name, h.name
    from item_purchase_history h
    where
      case
        when is_code and not is_price then h.item_code = p_query
        when is_price                 then h.final_price between price_val - 1 and price_val + 1
        else                                h.name ilike '%' || p_query || '%'
      end
      and (p_brand     is null or p_brand = 'all' or h.brand = p_brand)
      and (p_date_from is null or h.purchase_date >= p_date_from)
      and (p_date_to   is null or h.purchase_date <= p_date_to)
      and (p_price_max is null or h.final_price <= p_price_max)
    order by h.name
    limit 50
  )
  select h.*
  from item_purchase_history h
  join matched_groups g
    on (g.item_code is not null and h.item_code = g.item_code)
    or (g.item_code is null and h.item_code is null and h.store_name = g.store_name and h.name = g.name)
  order by h.purchase_date desc;
end;
$$;


-- Returns search (Prices → ↩ Returns tab). Sourced from item_returns, not
-- item_purchase_history — entirely separate dataset from the main item
-- search, so this never touches (or risks corrupting) that search's price-
-- trend math. No two-step narrow-then-fetch here like search_item_history:
-- total return volume is inherently small (most receipts are never
-- returned), so a single capped query is enough — no truncation risk at
-- realistic scale.
--
-- Matches item_code OR name unconditionally (not "if query looks numeric,
-- ONLY check item_code") — Costco's return-line data can put garbled numeric
-- fragments in the name field itself (e.g. a line named "/2534" whose real
-- item_code is unrelated, like 384182), so a purely-numeric query needs to
-- still be checked against the name too, or a visibly-matching row silently
-- returns nothing. Deliberately scoped to this function only — the main
-- Search tab (search_item_history) is untouched, its names come from the AI
-- parser and don't have this failure mode in practice.
create or replace function search_returned_items(
  p_query     text,
  p_brand     text default null,
  p_date_from date default null,
  p_date_to   date default null
)
returns setof item_returns
language plpgsql
stable
as $$
begin
  return query
  select h.*
  from item_returns h
  where
    (h.item_code = p_query or h.name ilike '%' || p_query || '%')
    and (p_brand     is null or p_brand = 'all' or h.brand = p_brand)
    and (p_date_from is null or h.return_date >= p_date_from)
    and (p_date_to   is null or h.return_date <= p_date_to)
  -- exact item_code matches first, so a precise code search still feels
  -- precise even though name-matching now runs alongside it
  order by (h.item_code = p_query) desc, h.return_date desc
  limit 200;
end;
$$;


-- Total refunded in a date range — powers the "Refunded" figure shown
-- alongside category/budget breakdowns (see get_spending_stats above for
-- why refunds aren't netted directly into category totals). Used by the
-- Budget tab, which is scoped to a calendar month rather than the Finance
-- page's arbitrary date range (already covered by get_spending_stats'
-- totalRefunded field).
create or replace function get_refund_total(
  p_date_from date default null,
  p_date_to   date default null
)
returns numeric
language sql
stable
as $$
  select coalesce(-sum(total), 0)
  from receipts
  where total < 0
    and (p_date_from is null or purchase_date >= p_date_from)
    and (p_date_to   is null or purchase_date <= p_date_to);
$$;


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
alter table price_alert_claims     disable row level security;
alter table price_alert_exclusions disable row level security;


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

-- Idempotency key: a retry of the same save attempt (double-click, retry
-- after a timeout) is a no-op replay via client_token, not a race against
-- the two duplicate-prevention indexes above. See saveReceipt() in queries.ts.
create unique index receipts_unique_client_token
  on receipts (client_token)
  where client_token is not null;


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
