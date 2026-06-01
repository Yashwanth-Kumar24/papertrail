# PaperTrail

A personal receipt tracker — scan any store receipt, extract items with AI, search your purchase history, and track spending over time. Built for household use with a focus on Costco returns and price tracking.

## What it does

- **Scan** — take a photo or upload a receipt image from any store
- **OCR + AI** — Google Vision reads the image, OpenAI extracts structured items, discounts, totals
- **Review & edit** — fix any field before saving — store, location, date, time, total, items
- **Receipts** — browse all receipts, filter by store and date
- **Spending** — date range analytics — total spent, by store, by month, avg per trip
- **Items** — search any item by name, code, or price across all receipts
- **Price history** — see every purchase of an item with trend — flags when price went up (useful for returns)
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

NEXT_PUBLIC_USE_AI_PARSER=true
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
| `NEXT_PUBLIC_USE_AI_PARSER` | `true` | All |
| `NEXT_PUBLIC_USE_GOOGLE_OCR` | `true` | All |

Redeploy once after adding env vars.

Future deploys are automatic on every `git push`.

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
    scan/                Scan flow — capture, OCR, review, save
  components/
    NavLinks.tsx         Desktop top nav
    MobNav.tsx           Mobile bottom nav
  lib/
    types.ts             TypeScript interfaces
    supabase.ts          Supabase client
    queries.ts           All DB operations
    ocr.ts               OCR wrapper — Google Vision or Tesseract fallback
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
  total, image_urls, raw_ocr_text, created_at

receipt_items:
  id, receipt_id, item_code, name,
  original_price, discount_amount, final_price,
  sort_order, created_at
```

No stores table — brand is a normalized key directly on receipts (`costco`, `walmart`, `whole-foods`, etc).

## OCR + AI pipeline

```
Photo
  → Google Vision API (/api/ocr)
  → Raw text
  → OpenAI GPT-4o-mini (/api/parse)
  → Structured JSON (store, date, items, discounts)
  → Review screen (all fields editable)
  → Save to Supabase
```

Fallback: if `NEXT_PUBLIC_USE_GOOGLE_OCR=false`, Tesseract.js runs in the browser (free, less accurate).
Fallback: if `NEXT_PUBLIC_USE_AI_PARSER=false`, regex parser runs (free, Costco only).

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

Brand normalization ensures consistent filtering regardless of how the store name appears on the receipt.

## Stage 2 planned

- Edit receipt after saving
- Dedicated return tracker view (items where price went up)
- Multi-user support with auth
- Bring Your Own Key (BYOK) for OpenAI and Google Vision
- Docker Compose for self-hosting
- PWA manifest for phone home screen install