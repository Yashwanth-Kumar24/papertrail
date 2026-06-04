# PaperTrail

A personal household receipt tracker — scan any store receipt, extract items with AI, search your purchase history, and track spending over time. Built for Costco returns and price tracking.

**Live:** [papertrail-home.vercel.app](https://papertrail-home.vercel.app)

---

## Versions at a glance

| Version | Stage | What shipped |
|---|---|---|
| **v1.0** | AI Core | OCR + GPT-4o-mini parsing, spending analytics, brand normalization |
| **v1.1** | Household | Paid by, Needs list, PWA, push notifications, price alerts, receipt editing, batch delete |
| **v1.2** | Costco | Direct Costco API import, source tracking, return receipts, quantity field, back-button fix for price alerts |
| **v1.3** | Finance layer | Categories, budget system, recurring bills, spending sub-tabs, heatmap, analytics upgrades, monthly digest |
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
- **Multi-section scanning** — long receipt? Scan in sections; items merge automatically with deduplication
- **Paid by** — required on every receipt; tracks which household member paid

### Receipts
- Browse all receipts in a card grid — store name, date, payer pill, category pill, savings, total
- Filter by store, date, payer, source (Scanned / Manual / Costco Import), and **category** — all coordinated
- **Sort** — Newest first / Oldest first / $ High→Low / $ Low→High
- **Batch select** — check multiple receipts and delete them all at once (select across all pages)
- Paginated (20 per page) with "Load more"
- Stats bar: total receipts, total spent, line items count, total saved
- **Edit** any saved receipt — store, brand, date, total, tax, paid by, category, notes, and every line item

### Spending
Three sub-tabs, all respect the date range selector (This week / This month / Last 3 months / This year / All time):

- **Summary** — key metrics (total spent, receipt count, avg per trip, total saved), top categories by spend, top 5 stores ranked, top 3 biggest receipts, payer split showing receipts + recurring payments side by side, recurring bills obligation card
- **Analytics** — by-payer bars, by-store bars with trend arrows (↑/↓/→ vs prior period), by-month bars with year-over-year toggle (overlay last year's data), daily spending calendar heatmap (tap a day to see all receipts for that date)
- **Budget** — set monthly dollar limits per category; master overview bar + per-category progress bars (green → amber at 75% → red at 100%); inline edit panel
- **Monthly digest** — appears at the top of Spending in the first week of each new month; shows last month's total with delta, top 3 categories, biggest receipt; dismissible

### Items
- Search any item by name, item code, or price across all receipts
- Full purchase history per item: every date, store, and price paid
- Price trend indicator — up / down / stable / single purchase
- **↑ Price alerts mode** — one tap shows all items where a past purchase is more expensive than the current price; sorted by savings opportunity, links directly to the return receipt; days since expensive purchase shown
- Back button from a receipt detail returns to price alerts mode (not search)
- Grouping: item code when available (reliable across stores); name-only items scoped to the same store

### Recurring
- Track rent, subscriptions, utilities — anything paid on a fixed schedule
- Frequencies: monthly, annual, weekly, quarterly; set a due day or date per bill
- **Paid cycle** — auto-resets when the next due date arrives; shows amber "Next due in 3d" warning 3 days before
- **Mark as paid** — pick the date (allows backdating) and who paid this cycle; updates the payment log
- **Undo** — tap the green check to un-mark and roll back the payment record
- **Payment history** — full log of every payment per bill: who paid, when, how much; add past payments manually; delete individual entries
- Analytics: by-category bar chart of monthly obligations + full breakdown table
- Mobile: accessible from the bottom nav; Scan moves to a green floating action button above the nav

### Costco import
- Accessible from the Receipts page header (blue Costco button)
- Paste a Bearer token from browser DevTools: Network tab → any `graphql` request → `costco-x-authorization` header
- Browse receipts by quarter (up to 10 quarters back); click any row to preview full item detail
- Batch-select receipts and import in one click — already-saved receipts are skipped automatically
- Return receipts (refunds) imported with negative totals and REFUND badge; excluded from price tracking
- Full warehouse address stored in proper case (e.g. `800 Heights Blvd, Florence, KY`)
- Per-unit prices stored correctly for multi-unit line items; instant savings merged as discounts
- One push notification per import batch, not per receipt
- Token lives in sessionStorage only — never written to the database

### Needs
- Shared household shopping list synced via Supabase
- Add items tagged with who added them (color-coded by payer)
- Tap the circle to mark done — item moves to a "Done" section
- Tap a done item to undo
- Done items auto-clear after 2 hours (configurable)
- List re-syncs whenever the browser tab regains focus

### Other
- **Push notifications** — household members get a push notification when someone saves a new receipt (title, store, total)
- **Monthly digest push** — sent in the first week of each month with last month's spending recap *(planned)*
- **PWA** — installable on Android and iOS; runs fullscreen like a native app
- **Favicon + app icon** — green receipt icon in browser tabs and on home screen

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

# Household members — comma-separated, up to 6, order sets pill color
NEXT_PUBLIC_PAYERS=Name1,Name2,Name3

NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
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
      costco/route.ts      Server route — Costco GraphQL API proxy (token forwarding)
    sw/route.ts            Service worker — handles push events for PWA
    receipts/              Receipt list + [id] detail + edit
    spending/              Spending analytics with date range
    items/                 Item search, price history, price alerts
    needs/                 Shared household shopping list
    costco/                Costco direct import — browse by quarter, batch import
    recurring/             Recurring bills — track, mark paid, payment history
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
  paid_by, category, notes, last_paid_at, active, created_at

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

## Paid by

Each receipt requires a payer selected from your household list. Members are configured via the `NEXT_PUBLIC_PAYERS` environment variable — no code changes needed.

On first use, backfill any receipts with a null `paid_by`:
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

On the Receipts page, click the checkbox (top-right of each card) to select receipts, then use the red delete bar that appears at the top to delete all selected at once. "Select all" fetches IDs across all pages, not just the current 20. Includes storage image cleanup.

---

## Push notifications

When any household member saves a new receipt, all subscribed devices get a push notification showing who paid, which store, and the total. To subscribe, install the PWA and accept the notification prompt (shown automatically in the app).

Implemented via the Web Push API. Subscriptions are stored in Supabase. Server-side sending via `/api/notify`.

---

## Needs — shared shopping list

The Needs tab is a shared household list synced via Supabase:
- Add items tagged with your name (from `NEXT_PUBLIC_PAYERS`) — color-coded pills
- Tap the circle to mark done — item moves to a "Done" section
- Done items auto-clear after **2 hours** (configurable via `DONE_VISIBLE_HOURS` in `src/lib/queries.ts`)
- Tap a done item's green check to undo
- List re-syncs whenever the browser tab regains focus

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

Set the `NEXT_PUBLIC_PAYERS` environment variable to a comma-separated list of names:

```
NEXT_PUBLIC_PAYERS=Alice,Bob,Carol
```

- Up to 6 members supported
- Colors are assigned by position: green, pink, purple, blue, amber, red
- No code changes needed — names never appear in the codebase
- To rename a member in existing data, run the SQL in the Migration helpers section of `supabase/schema.sql`

---

## Release history

### v1.0 — AI Core
*First real version. Manual/basic parsing (pre-v1.0) is not tagged.*

- OpenAI GPT-4o-mini parsing — extracts items, discounts, totals from raw OCR text
- Google Cloud Vision OCR replacing browser-based Tesseract
- Spending analytics page with by-store breakdown
- Brand normalization (`costco`, `walmart`, `whole-foods`, etc.)
- Schema simplification — single receipts + receipt_items structure
- Multiple receipt images per scan

---

### v1.1 — Household Features
*The app becomes a full household tool.*

- **Paid by** — required payer field on every receipt; color-coded by household member
- **Manual entry** — add a receipt without scanning (for lost/digital receipts)
- **Needs list** — shared household shopping list, synced via Supabase, tab-focus refresh
- **PWA** — installable on Android and iOS; fullscreen, home screen icon, favicon
- **Push notifications** — Web Push API; all devices notified when any member saves a receipt
- **Price alerts** — Items tab mode showing where current price is lower than a past purchase; sorted by savings opportunity, links to the return receipt
- **Receipt editing** — edit store, date, tax, paid by, and every line item after saving
- **Sort** — Newest / Oldest / $ High→Low / $ Low→High on Receipts page
- **Spending by payer** — color-coded bar chart on Spending page
- **Batch delete** — select multiple receipts (across all pages) and delete at once
- Tax field, duplicate detection overhaul, coordinated filter dropdowns

---

### v1.2 — Costco Import + UI Polish
*Direct import from Costco's internal API — no scanning needed for warehouse receipts.*

- **Costco direct import** — browse receipts by quarter (up to 10 quarters back), preview full item detail, batch-select and import in one click
- **Return receipts** — negative-total receipts handled throughout; REFUND badge; return items excluded from price tracking
- **Source tracking** — every receipt tagged `scan` / `manual` / `costco_api`; filterable on Receipts page; badge on detail view
- **Quantity field** — multi-unit purchases store per-unit price; line total (`×qty = total`) shown on detail view
- **Per-unit price normalization** — Costco API and OCR-scanned multi-unit items both stored at unit price for accurate cross-purchase price comparison
- **AI parser quantity fix** — quantity extracted by AI is now saved correctly; multi-quantity discounts stored per-unit
- **Price alerts back-button fix** — navigating to a receipt and pressing back returns to price alerts mode, not search
- **Savings on receipt cards** — green "Saved $X.XX" shown on each card when the receipt has any discounts
- **Costco full address** — full warehouse address stored in proper case (`800 Heights Blvd, Florence, KY`)
- **Env-driven household members** — names and colors fully configured via `NEXT_PUBLIC_PAYERS`; no names in code
- **Items table simplified** — Original + Discount columns merged into a single "Saved" column
- **Txn ID removed from cards and spending table** — internal data; still visible on receipt detail view
- **Costco selection UI** — count + Clear inline, blue import action bar; selection clears automatically after import
- Token lives in sessionStorage only, never written to the database

---

### v1.3 — Categories, Budget, Recurring & Analytics
*Full household finance layer — spending context, fixed bills, and budgeting.*

**Categories**
- 11 categories across all receipts, recurring bills, and budgets: Groceries, Household, Utilities, Dining Out, Entertainment, Clothing, Electronics, Pharmacy, Insurance, Fuel, Other
- Auto-suggested from store brand on scan (Costco → Groceries, CVS → Pharmacy, Home Depot → Household, etc.)
- Shown as colored pills on receipt cards, receipt detail, and throughout the app
- Filterable on the Receipts page via category pill row
- Optional notes field (up to 280 chars) on every receipt — shown below items with a 📝 icon

**Spending page — 3 sub-tabs**
- **Summary tab** (default) — key metrics, top categories, top 5 stores, top 3 biggest receipts, payer split; recurring obligation card with link to Recurring tab
- **Analytics tab** — existing charts + per-store trend arrows (↑/↓/→), year-over-year toggle on the by-month chart, spending calendar heatmap (3-shade coral heat scale, tap a day to see receipts)
- **Budget tab** — monthly limits per category; master overview bar + per-category progress bars (green → amber → red at 75% → 100%); inline edit panel

**Recurring bills tab** (new nav item)
- Track rent, subscriptions, utilities — anything paid on a regular schedule
- Frequencies: monthly, annual, weekly, quarterly
- Due-date-based paid/unpaid cycle — auto-resets when next due date passes; amber "Next due in 3d" warning before reset
- Mark as paid: date picker (allows backdating) + payer picker — records who paid this cycle
- Undo mark-as-paid with one tap
- Payment history per bill — full log of who paid, when, and how much; add past payments manually; delete individual entries
- Analytics: by-category bar chart + full monthly breakdown table
- Mobile: Scan moves to a green FAB above the nav bar; Recurring takes the freed nav slot

**Payer split with recurring**
- Spending Summary "By payer" now shows receipt spending vs recurring payments side by side with a split bar and legend

**Other**
- Monthly digest card — appears at top of Spending first week of each new month; shows last month's total, delta vs prior month, top 3 categories, biggest receipt; dismissible
- `NEXT_PUBLIC_PAYERS` env var fully controls household members — no names anywhere in code or README
- All store grouping fixed: same store never appears twice in spending charts regardless of brand key differences
- Heatmap color palette: 3-shade coral (light rose → soft coral → warm red) with readable text at each level
- Numerous bug fixes: category filter server-side pagination, recurring paid_by NOT NULL constraint on delete, unused imports removed, dynamic import replaced with static

---

## v2.0 — Future scope

- Multi-user support with auth (Supabase Auth or Clerk)
- Bring Your Own Key (BYOK) for OpenAI and Google Vision
- Docker Compose for self-hosting
- Excel export (.xlsx) — summary sheet + one sheet per receipt with full item detail and image link
- Dedicated return tracker view (receipt + current price side by side)
- Costco token auto-refresh (no manual DevTools copy)
