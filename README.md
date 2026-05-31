# PaperTrail

Personal receipt tracker — scan, store, and search Costco receipts.
Built for household use to track purchases and find items for returns.

## What it does

- **Scan** — take a photo or upload a receipt image, OCR runs in the browser
- **Review & edit** — fix item names, prices, location before saving
- **Receipts** — view all receipts, filter by store and date, delete
- **Items** — search any item by name, code, or price across all receipts
- **Price history** — see every time you bought an item with price trend
- **Return helper** — flags items where price went up since you last bought

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Plain CSS with CSS variables |
| OCR | Tesseract.js — runs in browser, image never leaves device |
| Database | Supabase Postgres |
| Storage | Supabase Storage (optional receipt images) |
| Hosting | Vercel |

## Local setup

1. Install dependencies

```
npm install
```

2. Create `.env.local` in the project root

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

3. Supabase setup
   - Run `supabase/schema.sql` in the Supabase SQL editor
   - Create a storage bucket named `receipt-images` and set it to public
   - Disable RLS on stores, receipts, receipt_items tables

4. Run locally

```
npm run dev
```

## Deploy to Vercel

```
npm i -g vercel
vercel login
vercel --prod
```

Then go to Vercel dashboard → Project → Settings → Environment Variables and add:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Redeploy once after adding env vars.

## Project structure

```
src/
  app/
    receipts/       Receipt list + detail
    items/          Item search with price history
    scan/           Scan flow — OCR, review, save
  components/
    NavLinks.tsx    Top nav + mobile bottom nav
  lib/
    types.ts        TypeScript interfaces
    supabase.ts     Supabase client
    queries.ts      All DB operations
    ocr.ts          Tesseract.js wrapper
  parsers/
    costco.ts       Costco receipt parser
    registry.ts     Parser routing + merge logic
    types.ts        Parser interface
supabase/
  schema.sql        DB schema — run once in Supabase SQL editor
```

## Stage 2 planned

- Edit receipt after saving (item name, price corrections)
- Walmart, Whole Foods, Ross, Target parsers
- Dedicated return tracker view
- PWA manifest for phone home screen install
- Duplicate receipt detection improvement