-- PaperTrail v1 — Final Schema
-- Run this in Supabase SQL editor

create table stores (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  name          text not null,
  location      text,
  created_at    timestamptz default now(),
  unique(brand, name)
);

create table receipts (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid references stores(id) on delete set null,
  store_name      text not null,
  location        text,
  purchase_date   date not null,
  purchase_time   time,
  transaction_id  text,
  total           numeric(10,2) not null,
  image_urls      text[],
  raw_ocr_text    text,
  created_at      timestamptz default now(),
  unique(transaction_id, location),
  unique nulls not distinct (purchase_date, purchase_time, total, location)
);

create table receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references receipts(id) on delete cascade,
  item_code       text,
  name            text not null,
  original_price  numeric(10,2) not null,
  discount_amount numeric(10,2) default 0,
  final_price     numeric(10,2) not null,
  sort_order      int default 0,
  created_at      timestamptz default now()
);

create index on receipts(purchase_date desc);
create index on receipts(store_id);
create index on receipt_items(receipt_id);
create index on receipt_items(item_code);
create index on receipt_items using gin(to_tsvector('english', name));

create view item_purchase_history as
  select
    ri.id, ri.receipt_id, ri.item_code, ri.name,
    ri.original_price, ri.discount_amount, ri.final_price,
    r.purchase_date, r.store_name, r.location, r.transaction_id
  from receipt_items ri
  join receipts r on r.id = ri.receipt_id;

-- Disable RLS (personal household app, no public access)
alter table stores        disable row level security;
alter table receipts      disable row level security;
alter table receipt_items disable row level security;

-- Storage bucket (create manually in Supabase dashboard if preferred)
-- Storage > New bucket > "receipt-images" > Public > Save
-- Then add this policy:
-- create policy "allow all storage" on storage.objects
--   for all using (true) with check (true);