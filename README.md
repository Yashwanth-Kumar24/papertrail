# PaperTrail

A personal receipt tracker — scan any store receipt, extract items with AI, search your purchase history, and track spending over time. Built for household use with a focus on Costco returns and price tracking.

## What it does

- **Scan** — take a photo or upload a receipt image from any store
- **OCR + AI** — Google Vision reads the image, OpenAI extracts structured items, discounts, totals
- **Review & edit** — fix any field before saving — store, location, date, time, total, paid by, items
- **Manual entry** — no receipt? Use "Lost a receipt? Add manually" to type everything in by hand
- **Paid by** — track who paid for each receipt (household members); required on every receipt
- **Receipts** — browse all receipts, filter by store, date, and payer — all three dropdowns coordinate with each other
- **Spending** — date range analytics — total spent, by store, by month, avg per trip, total saved
- **Items** — search any item by name, code, or price across all receipts
- **Price history** — see every purchase of an item with trend — flags when price went up (useful for Costco returns)
- **Needs** — shared household shopping list; add items, check off when bought, done items auto-clear after 2 hours
- **Delete** — remove receipts from list or detail view with confirmation

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Plain CSS with CSS variables |
| OCR | Google Cloud Vision API (server-side) |
| AI parsing | OpenAI GPT-4o-mini (server-side) |
| Database | Supabase Postgres |
| Storage | Supabase Storage (optional receipt images) |
| Hosting | Vercel |

## Local setup

**1. Clone and install**
```
git clone https://github.com/YOUR_USERNAME/papertrail.git
cd papertrail
npm install
```

**2. Create `.env.local`**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key

OPENAI_API_KEY=sk-...
GOOGLE_VISION_API_KEY=AIza...

NEXT_PUBLIC_USE_GOOGLE_OCR=true
```

**3. Supabase setup**
- Run `supabase/schema.sql` in the Supabase SQL editor
- Go to Storage → New bucket → name it `receipt-images` → set to Public → Save
- Run this in SQL editor to allow storage uploads:
```sql
create policy "allow all storage" on storage.objects
  for all using (true) with check (true);
```

**4. Get API keys**

Google Vision API:
- Go to `console.cloud.google.com`
- Create a project → Enable Cloud Vision API
- Credentials → Create credentials → API key
- Restrict key to Cloud Vision API only
- Enable billing (free tier: 1000 requests/month)

OpenAI API:
- Go to `platform.openai.com`
- API keys → Create new key
- Add $5 credit (lasts months at household usage)

**5. Run locally**
```
npm run dev
```

Open `http://localhost:3000`

## Deploy to Vercel

```
npm i -g vercel
vercel login
vercel --prod
```

Add these in Vercel → Project → Settings → Environment Variables:

| Variable | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL | All |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your anon key | All |
| `OPENAI_API_KEY` | your OpenAI key | Production + Preview |
| `GOOGLE_VISION_API_KEY` | your Google key | Production + Preview |
| `NEXT_PUBLIC_USE_GOOGLE_OCR` | `true` | All |

Redeploy once after adding env vars. Future deploys are automatic on every `git push`.

## Project structure

```
src/
  app/
    api/
      ocr/route.ts       Server route — Google Vision OCR
      parse/route.ts     Server route — OpenAI parsing with prompt
    receipts/            Receipt list + detail page
    spending/            Spending analytics with date range
    items/               Item search with price history
    needs/               Shared household shopping list (Needs tab)
    scan/                Scan flow — capture, OCR, review, save, manual entry
  components/
    NavLinks.tsx         Desktop top nav
    MobNav.tsx           Mobile bottom nav
  lib/
    types.ts             TypeScript interfaces + PAYERS/PAYER_COLORS/ShoppingItem
    supabase.ts          Supabase client
    queries.ts           All DB operations
    ocr.ts               OCR wrapper — Google Vision (with compression) or Tesseract fallback
  parsers/
    ai-parser.ts         AI parser — calls /api/parse, normalizes output
    registry.ts          Entry point — mergeReceipts utility
supabase/
  schema.sql             DB schema — run once in Supabase SQL editor
```

## Database schema

```sql
receipts:
  id, brand, store_name, location,
  purchase_date, purchase_time, transaction_id,
  total, paid_by, image_urls, raw_ocr_text, created_at

receipt_items:
  id, receipt_id, item_code, name,
  original_price, discount_amount, final_price,
  sort_order, created_at

shopping_list:
  id, text, added_by, done, done_at, created_at
```

`paid_by` stores the household member who paid (e.g. `Yash`, `Alekhya`, `Pavan`).
No stores table — `brand` is a normalized key on receipts (`costco`, `walmart`, `whole-foods`, etc).

### Duplicate prevention

Two-tier check on save:
- **Has transaction ID** → checks `store_name + purchase_date + transaction_id`
- **No transaction ID** → checks `store_name + purchase_date + total` (+ time if available)

Both enforced at the application level and via partial unique indexes in Postgres.

## OCR + AI pipeline

```
Photo
  → Compress to max 2048px JPEG (client-side, stays under Google Vision 10MB limit)
  → Google Vision API (/api/ocr)
  → Raw text
  → OpenAI GPT-4o-mini (/api/parse, max_tokens: 4000)
  → Structured JSON (store, date, items, discounts)
  → Review screen (all fields editable + paid by required)
  → Save to Supabase
```

Fallback: if `NEXT_PUBLIC_USE_GOOGLE_OCR=false`, Tesseract.js runs in the browser (free, less accurate).

## Paid by

Each receipt requires a payer selected from a fixed household list (`Yash`, `Alekhya`, `Pavan`). To change names, update the `PAYERS` constant in `src/lib/types.ts` and the `PAYER_COLORS` map.

On first use, backfill existing receipts:
```sql
UPDATE receipts SET paid_by = 'YourName' WHERE paid_by IS NULL;
```

## Multi-section scanning

For long receipts (e.g. full Costco run):
1. Scan the top half — items extracted and shown in review
2. Click **+ Add section** — scan the bottom half
3. Items merge automatically, deduplicating by item code or name
4. Metadata (transaction ID, date, total) fills in from whichever section had it

## Needs — shared shopping list

The Needs tab is a shared household list synced via Supabase:
- Add items with your name (Yash / Alekhya / Pavan)
- Tap the circle to mark done — item moves to a "Done" section
- Done items auto-clear after **2 hours** (configurable via `DONE_VISIBLE_HOURS` in `src/lib/queries.ts`)
- Tap a done item's green check to undo
- List re-syncs whenever the browser tab regains focus

To change the auto-clear window, edit one constant:
```ts
// src/lib/queries.ts
const DONE_VISIBLE_HOURS = 2  // change to any number of hours
```

## Manual receipt entry

For receipts that were lost or thrown away:
1. Go to Scan → click **Lost a receipt? Add manually**
2. Fill in store, date, total, paid by, and items manually
3. Save — same duplicate detection applies

## Cost at household usage (~10 receipts/week)

| Service | Free tier | Your usage | Cost |
|---|---|---|---|
| Supabase | 500MB DB, 1GB storage | ~10MB/year | $0 |
| Vercel | Generous free tier | Low traffic | $0 |
| Google Vision | 1000 req/month | ~40/month | $0 |
| OpenAI GPT-4o-mini | Pay per use | ~$0.001/receipt | ~$0.50/year |

Total: **under $1/year**

## Supported stores

The AI parser handles any store automatically. Tested with:
- Costco Wholesale
- Whole Foods Market
- Walmart
- Ross
- Apna Bazar, Mayuri Foods (and any other local store — no configuration needed)

Brand normalization ensures consistent filtering for known chains. Unknown stores appear by their exact name in all filters.

## Stage 2 planned

- Edit receipt after saving (item name, price corrections)
- Dedicated return tracker view (items where price went up)
- Multi-user support with auth
- Bring Your Own Key (BYOK) for OpenAI and Google Vision
- Docker Compose for self-hosting
