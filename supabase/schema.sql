drop view if exists item_purchase_history;
drop table if exists receipt_items cascade;
drop table if exists receipts cascade;
drop table if exists stores cascade;

create table receipts (
  id              uuid primary key default gen_random_uuid(),
  brand           text not null default 'other',
  store_name      text not null,
  location        text,
  purchase_date   date not null,
  purchase_time   time,
  transaction_id  text,
  total           numeric(10,2) not null default 0,
  paid_by         text,
  image_urls      text[],
  raw_ocr_text    text,
  created_at      timestamptz default now()
);

create table receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references receipts(id) on delete cascade,
  item_code       text,
  name            text not null,
  original_price  numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  final_price     numeric(10,2) not null default 0,
  sort_order      int default 0,
  created_at      timestamptz default now()
);

create index on receipts(brand);
create index on receipts(purchase_date desc);
create index on receipts(created_at desc);
create index on receipt_items(receipt_id);
create index on receipt_items(item_code);
create index on receipt_items
  using gin(to_tsvector('english', name));

create view item_purchase_history as
  select
    ri.id, ri.receipt_id,
    ri.item_code, ri.name,
    ri.original_price, ri.discount_amount, ri.final_price,
    r.purchase_date, r.purchase_time,
    r.brand, r.store_name, r.location,
    r.transaction_id
  from receipt_items ri
  join receipts r on r.id = ri.receipt_id;

alter table receipts      disable row level security;
alter table receipt_items disable row level security;

create unique index receipts_unique_txn
on receipts (store_name, purchase_date, transaction_id, total)
where transaction_id is not null;

create unique index receipts_unique_notxn
on receipts (store_name, purchase_date, coalesce(purchase_time::text, ''), total)
where transaction_id is null;