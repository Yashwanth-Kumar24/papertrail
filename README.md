# PaperTrail

A personal household receipt tracker — scan any store receipt, extract items with AI, search your purchase history, and track spending over time. Built for Costco returns and price tracking.

**Live:** [papertrail-home.vercel.app](https://papertrail-home.vercel.app)

---

## Versions at a glance

| Version | Stage | What shipped |
|---|---|---|
| **v1.0** | AI Core | OCR + GPT-4o-mini parsing, spending analytics, brand normalization |
| **v1.1** | Household | Paid by, Needs list, PWA, push notifications, price alerts, receipt editing, batch delete |
| **v1.2** | Costco | Direct Costco API import, source tracking, return receipts, quantity field |
| **v1.3** | Finance layer | Categories, budget system, recurring bills, spending sub-tabs, heatmap, analytics upgrades, monthly digest |
| **v1.4** | UX + Engagement | Nav restructure, recurring redesign, barcode display, share receipts, weekly price alert push, spending export, onboarding modal, `?` help button |
| **v2.0** | Multi-user | Auth, BYOK, Docker, Excel export *(future scope)* |

---

## What it does

### Scan
- Take a photo or upload a receipt image from any store
- Google Vision reads the image; OpenAI GPT-4o-mini extracts structured items, discounts, and totals
- Review and edit every field before saving — store, location, date, time, total, tax, paid by, category, notes, items
- **Category** — auto-suggested from the store brand (e.g. Costco → Groceries, CVS → Pharmacy); always editable
- **Notes** — optional free-text field up to 280 characters (e.g. "birthday dinner", "work reimbursement")
- **Manual entry** — no receipt? Tap "No receipt? Enter manually" to type everything in by hand
- **Multi-section scanning** — long receipt? Scan in sections; items merge automatically; header fields (store, date, total) update on each scan
- **Paid by** — required on every receipt; tracks which household member paid

### Expenses
Two sub-tabs under a single nav item:

- **Receipts** — browse all receipts in a card grid; filter by store, date preset or custom range, payer, source, and category (all coordinated); sort by date or amount; batch-select and delete; paginated with stats bar
- **Recurring** — track rent, subscriptions, utilities on monthly / annual / weekly / quarterly schedules; mark paid per cycle; full payment history log

### Receipts (detail)
- Edit any saved receipt — store, brand, date, total, tax, paid by, category, notes, and every line item
- **Share** — tap ↑ to open the native share sheet (iOS/Android) or copy the link to clipboard (desktop); recipient opens the URL directly with no login required
- **Costco receipts** — "View on Costco ↗" link opens the Costco orders page; scannable **Code 128 barcode** rendered from the transaction ID — show it to the cashier instead of opening the Costco app

### Finance
Three sub-tabs, all respect the date range selector (This week / This month / Last 3 months / This year / All time / Custom):

- **Summary** — key metrics (total spent, receipt count, avg per trip, total saved), top categories by spend, top 5 stores ranked, top 3 biggest receipts, payer split showing receipts + recurring payments side by side, recurring bills obligation card
- **Analytics** — by-payer bars, by-store bars with trend arrows (↑/↓/→ vs prior period, minimum 3 receipts), by-month bars with year-over-year toggle, daily spending calendar heatmap (tap a day to see all receipts); **↓ Export** button generates a print-ready PDF summary respecting the active date filter
- **Budget** — Variable spend section: category progress bars with last-month comparison tick marks and delta text; Fixed bills section: per-bill paid/unpaid bars; three summary cards (Variable / Fixed / Total outflow)
- **Monthly digest** — appears at the top of Finance in the first week of each new month; shows last month's total with delta, top 3 categories, biggest receipt; dismissible

### Prices
- Search any item by name, item code, or price across all receipts
- Full purchase history per item: every date, store, and price paid
- Price trend indicator — up / down / stable / single purchase
- **↑ Price alerts mode** — shows all items where a past purchase is more expensive than the current price; sorted by savings opportunity, links directly to the return receipt
- **Weekly push notification** — every Saturday morning a push is sent if return candidates exist, linking directly to Price alerts; no notification if count is zero (no noise)

### Needs
- Shared household shopping list synced via Supabase
- Add items tagged with who added them (color-coded by payer)
- Tap the circle to mark done — item moves to a "Done" section with undo
- Done items auto-clear after 2 hours
- List re-syncs whenever the browser tab regains focus

### Other
- **Onboarding modal** — shown once on first visit; summarises the 5 main features; dismissed with "Let's go →" and never shown again
- **`?` help button** — always-visible in the top-right corner of the header; re-opens the feature overview at any time with a "Got it" dismiss and a `×` close button
- **Push notifications** — household members get a push notification when someone saves a new receipt (title, store, total)
- **PWA** — installable on Android and iOS; runs fullscreen like a native app

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
| Storage | Supabase Storage (receipt images) |
| Hosting | Vercel (with cron jobs) |
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

# Household members — comma-separated, up to 6, order sets pill color
NEXT_PUBLIC_PAYERS=Name1,Name2,Name3

NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com

# Protects the Saturday price-alert cron endpoint
CRON_SECRET=any-random-secret
```

Set `NEXT_PUBLIC_USE_GOOGLE_OCR=false` to fall back to Tesseract.js (free, runs in browser, less accurate).

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

VAPID keys (for push notifications):
```
npx web-push generate-vapid-keys
```

Generate a cron secret (any random string):
```
openssl rand -hex 32
```

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
| `NEXT_PUBLIC_PAYERS` | `Name1,Name2,Name3` | All |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | your VAPID public key | All |
| `VAPID_PRIVATE_KEY` | your VAPID private key | Production + Preview |
| `VAPID_SUBJECT` | `mailto:you@example.com` | All |
| `CRON_SECRET` | your random secret | Production + Preview |

Redeploy once after adding env vars. Future deploys are automatic on every `git push`.

---

## Project structure

```
src/
  app/
    api/
      ocr/route.ts              Server route — Google Vision OCR
      parse/route.ts            Server route — OpenAI parsing
      notify/route.ts           Server route — send push notifications
      subscribe/route.ts        Server route — register push subscriptions
      costco/route.ts           Server route — Costco GraphQL API proxy
      cron/
        price-alert/route.ts    Cron route — Saturday price alert push (protected by CRON_SECRET)
    sw/route.ts                 Service worker — push events + notification click → deep link
    expenses/                   Expenses shell — Receipts + Recurring sub-tabs
    receipts/                   Receipt list + [id] detail/edit/share
    finance/                    Finance — Summary / Analytics / Budget sub-tabs
    prices/                     Item search, price history, price alerts
    needs/                      Shared household shopping list
    costco/                     Costco direct import — browse by quarter, batch import
    recurring/                  Recurring bills — track, mark paid, payment history
    scan/                       Scan flow — capture, OCR, review, save, manual entry
    layout.tsx                  Root layout — nav, metadata, onboarding modal
    manifest.ts                 PWA manifest
    apple-icon.tsx              iOS home screen icon (180×180)
    icon.tsx                    Browser favicon (32×32)
  components/
    NavLinks.tsx                Desktop top nav (Expenses / Finance / Prices / Needs)
    MobNav.tsx                  Mobile bottom nav (≤768px)
    NotifyBanner.tsx            One-time push notification opt-in banner
    OnboardingModal.tsx         First-visit feature overview modal
    ExportButton.tsx            Print-to-PDF export for Finance page
  lib/
    types.ts                    TypeScript interfaces + PAYERS, PAYER_COLORS, BRAND_LABELS
    supabase.ts                 Supabase client
    queries.ts                  All DB operations + getCycleWindow()
    ocr.ts                      OCR wrapper — Google Vision or Tesseract fallback
  parsers/
    ai-parser.ts                AI parser — calls /api/parse, normalizes output
    registry.ts                 parseReceipt() + mergeReceipts()
supabase/
  schema.sql                    DB schema — run once in Supabase SQL editor
vercel.json                     Cron schedule — price alert every Saturday 9am UTC
```

---

## Database schema

```sql
receipts:
  id, brand, store_name, location,
  purchase_date, purchase_time, transaction_id,
  total, tax, paid_by,
  source,           -- 'scan' | 'manual' | 'costco_api'
  category,         -- groceries | household | utilities | dining | entertainment |
                    -- clothing | electronics | pharmacy | insurance | fuel | other
  notes,            -- optional free-text up to 280 chars
  image_urls, raw_ocr_text, created_at

receipt_items:
  id, receipt_id, item_code, name,
  original_price, discount_amount, final_price,
  quantity,         -- -1=returned, 1=default, >1=multi-unit
  sort_order, created_at

shopping_list:
  id, text, added_by, done, done_at, created_at

push_subscriptions:
  id, endpoint, auth, p256dh, user_name, created_at

budgets:
  id, category, amount, active, created_at, updated_at

recurring:
  id, name, amount, frequency,  -- monthly | annual | weekly | quarterly
  due_day, due_date,
  paid_by, category, notes, active, created_at
  -- paid status computed at read time from recurring_payments (no last_paid_at column)

recurring_payments:
  id, recurring_id, paid_by, paid_at, amount, created_at

-- View used by item search and price alerts (excludes returned items):
item_purchase_history (joins receipts + receipt_items where final_price >= 0)
```

`brand` is a normalized key (`costco`, `walmart`, `whole-foods`, `ross`, `target`, `safeway`, `trader-joes`, `kroger`, `cvs`, `walgreens`, `aldi`, `home-depot`, `lowes`, `other`). Unknown stores fall through to `other` and display by exact name.

`paid_by` stores the household member who paid. Values come from the `NEXT_PUBLIC_PAYERS` env var.

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

## Recurring bills — cycle window design

Paid status is never stored in the database. On every load, `getRecurring()` fetches all active bills + the last 13 months of `recurring_payments` in two queries, then computes a cycle window per bill in JavaScript:

- **Monthly** — cycle starts on `due_day` of the current or previous month (whichever is most recent); ends the day before the next occurrence. High due-days (29–31) clamp correctly to short months.
- **Annual** — cycle is the 12-month window starting on the most recent anniversary of `due_date`
- **Quarterly** — 3-month rolling window from `due_date`
- **Weekly** — last 6 days to today

A bill is `paidThisCycle` if any `recurring_payments` row falls within `[cycleStart, cycleEnd]`.

To drop the old `last_paid_at` column from an existing database:
```sql
ALTER TABLE recurring DROP COLUMN IF EXISTS last_paid_at;
```

---

## Paid by

Each receipt requires a payer selected from your household list. Members are configured via the `NEXT_PUBLIC_PAYERS` environment variable — no code changes needed.

On first use, backfill any receipts with a null `paid_by`:
```sql
UPDATE receipts SET paid_by = 'YourName' WHERE paid_by IS NULL;
```

---

## Sharing a receipt

On any receipt detail page, tap **↑** (between Edit and Delete):
- **Mobile / PWA** — opens the native share sheet (AirDrop, Messages, WhatsApp, copy link, etc.)
- **Desktop** — copies the direct URL to clipboard; button flashes ✓

The recipient opens the link and sees the full receipt — no login required.

---

## Costco barcode

On Costco-imported receipts, the detail page renders a scannable **Code 128 barcode** from the transaction ID. Show it to the cashier instead of opening the Costco app. The "View on Costco ↗" link opens the Costco orders page for the full receipt history.

---

## Weekly price alert push

Every Saturday at 9am UTC, a Vercel cron job hits `/api/cron/price-alert`. It counts items where the most recent purchase is cheaper than a past purchase (return/price-match opportunities) and sends one push notification per subscriber:

```
PaperTrail · Price Alerts
4 items may qualify for a return or price match — tap to review
```

Tapping navigates directly to `/prices?mode=returns`. If zero candidates exist, no notification is sent. The endpoint is protected by `CRON_SECRET`.

---

## Export spending summary

On the Finance page (Summary or Analytics tab), tap **↓ Export**. The browser print dialog opens with a clean, print-optimised layout — navigation, buttons, and filters are hidden. Save as PDF. The export respects whatever date range and filters are currently active.

---

## Batch delete

On the Receipts page, click the checkbox (top-right of each card) to select receipts, then use the red delete bar that appears at the top to delete all selected at once. "Select all" fetches IDs across all pages, not just the current 20. Includes storage image cleanup.

---

## Push notifications

When any household member saves a new receipt, all subscribed devices get a push notification showing who paid, which store, and the total. To subscribe, install the PWA and accept the notification prompt shown automatically in the app.

Implemented via the Web Push API. Subscriptions stored in Supabase. Server-side sending via `/api/notify`.

---

## Install as a mobile app (PWA)

**Android (Chrome)**
1. Open the app URL in Chrome
2. Tap the **3-dot menu → Add to Home Screen**
3. Tap **Install**

**iOS (Safari)**
1. Open the app URL in Safari
2. Tap the **Share button** (box with arrow)
3. Tap **Add to Home Screen → Add**

Once installed, the app opens fullscreen, scanning uses the camera directly, and push notifications work for new receipts.

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

Set the `NEXT_PUBLIC_PAYERS` environment variable to a comma-separated list of names:

```
NEXT_PUBLIC_PAYERS=Alice,Bob,Carol
```

- Up to 6 members supported
- Colors assigned by position: green, pink, purple, blue, amber, red
- No code changes needed — names never appear in the codebase
- To rename a member in existing data, run the SQL in the Migration helpers section of `supabase/schema.sql`

---

## Release history

### v1.4 — UX + Engagement
*Nav restructure, recurring redesign, sharing, Costco barcode, weekly push, and export.*

- **Nav restructure** — 4 top-level tabs: Expenses (Receipts + Recurring sub-tabs), Finance (Summary / Analytics / Budget), Prices, Needs
- **Recurring redesign** — paid status computed from `recurring_payments` log via cycle window; no `last_paid_at` column; correct for all frequencies including edge-case due-days (29–31)
- **Receipts date filter** — preset pills (This week / This month / Last 3 months / This year / All time / Custom) replacing single-date dropdown; matches Finance page style
- **Coordinated filter dropdowns** — store, payer, source, category all cross-filter each other in real time
- **Share receipt** — ↑ button on detail page; native share sheet on mobile, clipboard copy on desktop
- **Costco barcode** — Code 128 barcode rendered on Costco receipt detail; show to cashier instead of opening the Costco app
- **Costco "View on Costco"** — link on Costco receipt detail opening the orders page
- **Weekly price alert push** — Vercel cron every Saturday 9am UTC; sends push only when candidates exist; deep-links to `/prices?mode=returns`
- **↓ Export** — print-to-PDF for Finance Summary + Analytics tabs; respects active date filter; hides all chrome via `@media print`
- **Onboarding modal** — shown once on first visit; 5-feature overview; localStorage dismiss
- **Budget tab redesign** — Variable + Fixed sections separated; last-month comparison tick marks and delta text on every bar; three summary cards
- **Analytics heatmap** — green palette replacing coral; "Receipts in this period" table removed
- **Digest delta** — "↑ more than Apr" / "↓ less than Apr" phrasing replacing "vs Apr"
- **Bug fixes** — monthly cycle overflow for due-day ≥ 29; scan page price field editing losing discount; multi-scan header fields not updating on second scan; prices page routing broken after rename

---

### v1.3 — Categories, Budget, Recurring & Analytics
*Full household finance layer — spending context, fixed bills, and budgeting.*

- 11 categories across receipts, recurring bills, and budgets
- Auto-suggested category from store brand on scan
- Spending page with 3 sub-tabs: Summary, Analytics, Budget
- Recurring bills tab — frequencies, paid cycle, payment history, analytics
- Monthly digest card
- Payer split with recurring payments
- Spending heatmap, YoY toggle, trend arrows

---

### v1.2 — Costco Import + UI Polish
*Direct import from Costco's internal API — no scanning needed for warehouse receipts.*

- Costco direct import — browse by quarter, batch-select and import
- Return receipts — negative totals, REFUND badge, excluded from price tracking
- Source tracking — scan / manual / costco_api
- Quantity field — per-unit prices stored correctly
- Price alerts back-button fix

---

### v1.1 — Household Features
*The app becomes a full household tool.*

- Paid by, Manual entry, Needs list, PWA, Push notifications
- Price alerts, Receipt editing, Sort, Batch delete
- Spending by payer, coordinated filter dropdowns

---

### v1.0 — AI Core
*First real version.*

- OpenAI GPT-4o-mini parsing, Google Cloud Vision OCR
- Spending analytics, brand normalization
- Multiple receipt images per scan

---

## v2.0 — Future scope

- Multi-user support with auth (Supabase Auth or Clerk)
- Bring Your Own Key (BYOK) for OpenAI and Google Vision
- Docker Compose for self-hosting
- Excel export (.xlsx) — summary sheet + one sheet per receipt
- Costco token auto-refresh (no manual DevTools copy)
