# PaperTrail

A personal receipt tracker — scan any store receipt, extract items with AI, search your purchase history, and track spending over time. Built for household use with a focus on Costco returns and price tracking.

**Live:** [papertrail-home.vercel.app](https://papertrail-home.vercel.app)

## What it does

### Scan
- Take a photo or upload a receipt image from any store
- Google Vision reads the image; OpenAI GPT-4o-mini extracts structured items, discounts, and totals
- Review and edit every field before saving — store, location, date, time, total, tax, paid by, items
- **Manual entry** — no receipt? Use "Lost a receipt? Add manually" to type everything in by hand
- **Multi-section scanning** — long receipt? Scan in sections; items merge automatically with deduplication
- **Paid by** — required on every receipt; tracks which household member paid

### Receipts
- Browse all receipts in a card grid
- Filter by store, date, and payer — all three dropdowns coordinate with each other
- **Sort** — Newest first / Oldest first / $ High→Low / $ Low→High
- **Batch select** — check multiple receipts and delete them all at once
- Paginated (20 per page) with "Load more"
- Stats bar: total receipts, total spent, line items count, total saved

### Spending
- Date range analytics with preset buttons (This week / This month / Last 3 months / This year / All time) and a custom date picker
- Summary cards: total spent, receipt count, avg per trip, total saved via discounts
- **By payer** bar chart (color-coded) showing each household member's spend and % of total
- By-store bar chart, by-month bar chart
- Full receipt list for the selected period with Paid by column and links to detail views

### Items
- Search any item by name, item code, or price across all receipts
- Full purchase history per item: every date, store, and price paid
- Price trend indicator — up / down / stable / single purchase
- **↑ Price alerts mode** — one tap shows all items where a past purchase is more expensive than the current price; sorted by savings, links directly to the return receipt. Works across all stores. Days since expensive purchase shown (green = likely within return window)
- Grouping: item code when available (reliable across stores); name-only items are scoped to the same store to prevent false cross-store matches

### Needs
- Shared household shopping list synced via Supabase
- Add items tagged with who added them (color-coded by payer)
- Tap the circle to mark done — item moves to a "Done" section
- Tap a done item to undo
- Done items auto-clear after 2 hours (configurable)
- List re-syncs whenever the browser tab regains focus

### Other
- **Delete** — remove receipts from the list or detail view with confirmation
- **Push notifications** — household members get a push notification when someone saves a new receipt (title, store, total)
- **PWA** — installable on Android and iOS; runs fullscreen like a native app
- **Favicon + app icon** — green receipt icon shown in browser tabs and on home screen

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Plain CSS with CSS variables, warm cream aesthetic |
| Fonts | Manrope (sans), DM Mono (monospace) |
| OCR | Google Cloud Vision API (server-side) |
| AI parsing | OpenAI GPT-4o-mini (server-side) |
| Database | Supabase Postgres |
| Storage | Supabase Storage (optional receipt images) |
| Hosting | Vercel |
| Mobile | PWA — installable on Android + iOS |

---

## Local setup

**1. Clone and install**
```
git clone https://github.com/Yashwanth-Kumar24/papertrail.git
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
NEXT_PUBLIC_USE_AI_PARSER=true
```

Set `NEXT_PUBLIC_USE_GOOGLE_OCR=false` to fall back to Tesseract.js (free, runs in browser, less accurate).  
Set `NEXT_PUBLIC_USE_AI_PARSER=false` to skip AI parsing and get raw OCR text only.

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

---

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
| `NEXT_PUBLIC_USE_AI_PARSER` | `true` | All |

Redeploy once after adding env vars. Future deploys are automatic on every `git push`.

---

## Project structure

```
src/
  app/
    api/
      ocr/route.ts         Server route — Google Vision OCR
      parse/route.ts       Server route — OpenAI parsing
      notify/route.ts      Server route — send push notifications to subscribers
      subscribe/route.ts   Server route — register push notification subscriptions
    sw/route.ts            Service worker — handles push notifications for PWA
    receipts/              Receipt list + [id] detail page
    spending/              Spending analytics with date range
    items/                 Item search with price history and return flags
    needs/                 Shared household shopping list
    scan/                  Scan flow — capture, OCR, review, save, manual entry
    layout.tsx             Root layout — nav, metadata, PWA manifest link
    manifest.ts            PWA manifest
    apple-icon.tsx         iOS home screen icon (180×180)
    icon.tsx               Browser favicon (32×32)
  components/
    NavLinks.tsx           Desktop top nav
    MobNav.tsx             Mobile bottom nav (≤768px)
  lib/
    types.ts               TypeScript interfaces + PAYERS, PAYER_COLORS, BRAND_LABELS
    supabase.ts            Supabase client
    queries.ts             All DB operations
    ocr.ts                 OCR wrapper — Google Vision (with compression) or Tesseract fallback
  parsers/
    ai-parser.ts           AI parser — calls /api/parse, normalizes output
    registry.ts            Entry point — parseReceipt() + mergeReceipts()
supabase/
  schema.sql               DB schema — run once in Supabase SQL editor
```

---

## Database schema

```sql
receipts:
  id, brand, store_name, location,
  purchase_date, purchase_time, transaction_id,
  total, tax, paid_by, image_urls, raw_ocr_text, created_at

receipt_items:
  id, receipt_id, item_code, name,
  original_price, discount_amount, final_price,
  sort_order, created_at

shopping_list:
  id, text, added_by, done, done_at, created_at

-- View used by item search:
item_purchase_history (joins receipts + receipt_items)
```

`brand` is a normalized key (`costco`, `walmart`, `whole-foods`, `ross`, `target`, `safeway`, `trader-joes`, `kroger`, `cvs`, `walgreens`, `aldi`, `home-depot`, `lowes`, `other`). Unknown stores fall through to `other` and display by exact name.

`paid_by` stores the household member who paid (e.g. `Yash`, `Alekhya`, `Pavan`).

### Duplicate prevention

Two-tier check on every save:
- **Has transaction ID** → checks `store_name + purchase_date + transaction_id`
- **No transaction ID** → checks `store_name + purchase_date + total` (+ time if available)

Both enforced at the application level and via partial unique indexes in Postgres.

---

## OCR + AI pipeline

```
Photo
  → Compress to max 2048px JPEG (client-side, stays under Google Vision 10MB limit)
  → Google Vision API (/api/ocr)
  → Raw text
  → OpenAI GPT-4o-mini (/api/parse, max_tokens: 4000)
  → Structured JSON (store, date, items, discounts, tax, total)
  → Review screen (all fields editable; paid by required)
  → Save to Supabase
  → Push notification sent to all subscribed household devices
```

Fallback: if `NEXT_PUBLIC_USE_GOOGLE_OCR=false`, Tesseract.js runs in the browser (free, less accurate).

---

## Paid by

Each receipt requires a payer selected from a fixed household list (`Yash`, `Alekhya`, `Pavan`). To change names, update the `PAYERS` constant and the `PAYER_COLORS` map in `src/lib/types.ts`.

On first use, backfill existing receipts:
```sql
UPDATE receipts SET paid_by = 'YourName' WHERE paid_by IS NULL;
```

---

## Multi-section scanning

For long receipts (e.g. a full Costco run):
1. Scan the top half — items extracted and shown in review
2. Click **+ Add section** — scan the bottom half
3. Items merge automatically, deduplicating by item code or name
4. Metadata (transaction ID, date, total) fills in from whichever section had it

---

## Batch delete

On the Receipts page, click the checkbox (top-right of each card) to select receipts, then use the red delete bar that appears at the top to delete all selected at once. Includes storage image cleanup.

---

## Push notifications

When any household member saves a new receipt, all subscribed devices get a push notification showing who paid, which store, and the total. To subscribe, install the PWA and accept the notification prompt (shown automatically in the app).

Implemented via the Web Push API. Subscriptions are stored in Supabase. Server-side sending via `/api/notify`.

---

## Needs — shared shopping list

The Needs tab is a shared household list synced via Supabase:
- Add items with your name (Yash / Alekhya / Pavan) — color-coded pills
- Tap the circle to mark done — item moves to a "Done" section
- Done items auto-clear after **2 hours** (configurable via `DONE_VISIBLE_HOURS` in `src/lib/queries.ts`)
- Tap a done item's green check to undo
- List re-syncs whenever the browser tab regains focus

To change the auto-clear window, edit one constant:
```ts
// src/lib/queries.ts
const DONE_VISIBLE_HOURS = 2
```

---

## Install as a mobile app (PWA)

PaperTrail works as an installable app on both Android and iOS — no App Store needed.

**Android (Chrome)**
1. Open the app URL in Chrome
2. Tap the **3-dot menu → Add to Home Screen** (or accept the install banner)
3. Tap **Install**

**iOS (Safari)**
1. Open the app URL in Safari
2. Tap the **Share button** (box with arrow)
3. Tap **Add to Home Screen → Add**

Once installed, the app opens fullscreen with no browser address bar, scanning uses the camera directly, and push notifications work for new receipts.

---

## Cost at household usage (~10 receipts/week)

| Service | Free tier | Your usage | Cost |
|---|---|---|---|
| Supabase | 500MB DB, 1GB storage | ~10MB/year | $0 |
| Vercel | Generous free tier | Low traffic | $0 |
| Google Vision | 1000 req/month | ~40/month | $0 |
| OpenAI GPT-4o-mini | Pay per use | ~$0.001/receipt | ~$0.50/year |

Total: **under $1/year**

---

## Supported stores

The AI parser handles any store automatically. Tested with:
- Costco Wholesale
- Whole Foods Market
- Walmart
- Ross Dress for Less
- Target
- Safeway
- Trader Joe's
- Apna Bazar, Mayuri Foods, CrossRoads Italiano (and any other local store)

Brand normalization ensures consistent filtering for known chains. Unknown stores appear by their exact name.

---

## Household members (payers)

Default: `Yash`, `Alekhya`, `Pavan`. To change, edit `PAYERS` and `PAYER_COLORS` in `src/lib/types.ts`. No database migration needed.

---

## Stage 2 planned

- Multi-user support with auth
- Bring Your Own Key (BYOK) for OpenAI and Google Vision
- Docker Compose for self-hosting
- Excel export (.xlsx) — summary sheet + one sheet per receipt with full item detail and image link
