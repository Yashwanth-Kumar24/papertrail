import { supabase } from './supabase'
import type { Receipt, ParsedReceipt, ItemHistory, ShoppingItem, Budget, RecurringBill, RecurringPayment } from './types'

// ── Save receipt ───────────────────────────────────────────
// Two independent problems used to be handled by one mechanism (a hard
// "already saved" block on store+date+total match), which conflated:
//
//  1. IDEMPOTENCY — the same save attempt submitted twice (double-click,
//     retry after a timeout that may or may not have actually gone through).
//     This has a deterministic answer: it should never create a second row,
//     and it should never surface an error either — a retry of the exact
//     same attempt should just transparently return the same receipt id.
//     Solved with a client-generated token (same pattern as a Stripe
//     Idempotency-Key): the caller passes the same `clientToken` on every
//     attempt of one logical save; the DB has a unique index on it, so a
//     retry is a no-op recovery, not a race to prevent.
//
//  2. PROBABLE DUPLICATE — a genuinely different receipt that happens to
//     collide with an earlier one on store+date+total (common for gas,
//     gift cards). This has no deterministic answer, so it should never be
//     silently blocked — it's surfaced to the caller as a typed
//     PossibleDuplicateError carrying the existing receipt's id, and the
//     caller decides whether to show the user a "save anyway?" prompt
//     (pass `force: true` to bypass just this heuristic check).
//
// The exact-identity path (matching transaction_id, e.g. a real Costco
// barcode) stays a hard, non-overridable block — there's no ambiguity there.
export class PossibleDuplicateError extends Error {
  existingId: string
  constructor(existingId: string) {
    super('A receipt from this store, on this date, for this total already exists.')
    this.name = 'PossibleDuplicateError'
    this.existingId = existingId
  }
}

export async function saveReceipt(
  parsed: ParsedReceipt,
  opts: { clientToken?: string; force?: boolean } = {},
): Promise<string> {
  const { clientToken, force = false } = opts

  // Idempotent replay: this exact save attempt (by client token) already
  // went through — return the same receipt rather than erroring or duplicating.
  if (clientToken) {
    const { data: replay } = await supabase
      .from('receipts').select('id').eq('client_token', clientToken).maybeSingle()
    if (replay?.id) return replay.id
  }

  if (parsed.transaction_id) {
    // Exact identity match — never overridable, transaction_id is a real
    // unique identifier (OCR'd transaction number or Costco barcode).
    const { data: existing, error: existingErr } = await supabase
      .from('receipts')
      .select('id')
      .eq('store_name', parsed.store.name)
      .eq('purchase_date', parsed.purchase_date)
      .eq('transaction_id', parsed.transaction_id)
      .maybeSingle()

    if (existingErr) throw new Error(existingErr.message)
    if (existing?.id) throw new Error('This receipt is already saved.')
  } else if (!force) {
    // Heuristic match — store + date + total (+ time if available). No
    // identifier can prove two such receipts are the same purchase, so this
    // is a soft block: callers can retry with force:true once the user
    // confirms it's genuinely a different receipt.
    let dupQ = supabase
      .from('receipts')
      .select('id')
      .eq('store_name', parsed.store.name)
      .eq('purchase_date', parsed.purchase_date!)
      .eq('total', parsed.total ?? 0)
      .is('transaction_id', null)

    if (parsed.purchase_time) dupQ = dupQ.eq('purchase_time', parsed.purchase_time)

    const { data: existing, error: existingErr } = await dupQ.maybeSingle()
    if (existingErr) throw new Error(existingErr.message)
    if (existing?.id) throw new PossibleDuplicateError(existing.id)
  }

  const { data: rec, error: recErr } = await supabase
    .from('receipts')
    .insert({
      brand:          parsed.store.brand,
      store_name:     parsed.store.name,
      location:       parsed.store.location ?? null,
      purchase_date:  parsed.purchase_date,
      purchase_time:  parsed.purchase_time  ?? null,
      transaction_id: parsed.transaction_id ?? null,
      total:          parsed.total          ?? 0,
      tax:            parsed.tax            ?? null,
      paid_by:        parsed.paid_by        ?? null,
      source:         parsed.source         ?? 'scan',
      category:       parsed.category       ?? 'other',
      notes:          parsed.notes          ?? null,
      raw_ocr_text:   parsed.raw_ocr_text,
      client_token:   clientToken ?? null,
    })
    .select('id')
    .single()

  if (recErr) {
    // Concurrent identical retry: both requests passed the pre-check above
    // before either commit landed, and the unique index on client_token
    // caught it at insert time instead. Recover gracefully — same outcome
    // as the pre-check catching it up front. (A pg unique-violation is
    // SQLSTATE 23505; postgrest-js surfaces it on error.code.)
    if (clientToken && (recErr as any).code === '23505') {
      const { data: replay } = await supabase
        .from('receipts').select('id').eq('client_token', clientToken).maybeSingle()
      if (replay?.id) return replay.id
    }
    throw new Error(recErr.message)
  }

  const rows = parsed.line_items.map(li => ({
    receipt_id:      rec.id,
    item_code:       li.item_code       ?? null,
    name:            li.name,
    original_price:  li.original_price,
    discount_amount: li.discount_amount,
    final_price:     li.final_price,
    quantity:        li.quantity        ?? 1,
    sort_order:      li.sort_order,
  }))

  if (rows.length) {
    const { error: itemErr } = await supabase.from('receipt_items').insert(rows)
    if (itemErr) throw new Error(itemErr.message)
  }

  return rec.id
}

// ── Upload image ───────────────────────────────────────────
export async function uploadReceiptImage(
  file: File,
  receiptId: string,
  index: number,
  brand: string,
  date: string,
): Promise<string | null> {
  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${brand}/${date}/${receiptId}${index > 0 ? `_${index}` : ''}.${ext}`

  const { error } = await supabase.storage
    .from('receipt-images')
    .upload(path, file, { upsert: true })

  if (error) { console.error('Upload failed:', error.message); return null }

  const { data } = supabase.storage.from('receipt-images').getPublicUrl(path)
  return data.publicUrl
}

const PAGE_SIZE = 20

export type ReceiptSort = 'date_desc' | 'date_asc' | 'total_desc' | 'total_asc'

export type ReturnFilter = 'purchases' | 'returns'

// ── Get receipts list (paginated, with item count) ─────────
// Accepts an optional AbortSignal so the caller can cancel an in-flight
// request when a newer one supersedes it (rapid filter/sort changes) —
// the actual network request is cancelled, not just its result discarded,
// which matters once this is running against a large receipt history.
export async function getReceipts(
  storeName?: string,
  dateFrom?: string,
  dateTo?: string,
  paidBy?: string,
  offset = 0,
  sortBy: ReceiptSort = 'date_desc',
  source?: string,
  category?: string,
  signal?: AbortSignal,
  returnFilter?: ReturnFilter,
): Promise<{ data: Receipt[]; totalCount: number }> {
  let q = supabase
    .from('receipts')
    .select('*, receipt_items(discount_amount)', { count: 'exact' })
    .range(offset, offset + PAGE_SIZE - 1)

  if (storeName) q = q.eq('store_name', storeName)
  if (dateFrom)  q = q.gte('purchase_date', dateFrom)
  if (dateTo)    q = q.lte('purchase_date', dateTo)
  if (paidBy)    q = q.eq('paid_by', paidBy)
  if (source)    q = q.eq('source', source)
  if (category)  q = q.eq('category', category)
  if (returnFilter === 'purchases') q = q.gte('total', 0)
  if (returnFilter === 'returns')   q = q.lt('total', 0)

  if (sortBy === 'date_desc')  q = q.order('purchase_date', { ascending: false }).order('created_at', { ascending: false })
  if (sortBy === 'date_asc')   q = q.order('purchase_date', { ascending: true  }).order('created_at', { ascending: true  })
  if (sortBy === 'total_desc') q = q.order('total', { ascending: false }).order('purchase_date', { ascending: false })
  if (sortBy === 'total_asc')  q = q.order('total', { ascending: true  }).order('purchase_date', { ascending: false })

  if (signal) q = q.abortSignal(signal)

  const { data, error, count } = await q
  if (error) throw new Error(error.message)

  const mapped = (data ?? []).map(({ receipt_items, ...r }: any) => ({
    ...r,
    itemCount:     (receipt_items ?? []).length,
    totalSavings:  (receipt_items ?? []).reduce((s: number, i: any) => s + Number(i.discount_amount ?? 0), 0),
  })) as Receipt[]

  return { data: mapped, totalCount: count ?? 0 }
}

export { PAGE_SIZE as RECEIPTS_PAGE_SIZE }

// ── Get single receipt ─────────────────────────────────────
export async function getReceiptById(id: string): Promise<Receipt | null> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*, receipt_items(*)')
    .eq('id', id)
    .single()

  if (error) return null
  if (data?.receipt_items) {
    data.receipt_items.sort((a: any, b: any) => a.sort_order - b.sort_order)
  }
  return data as Receipt
}

// ── Get store_name+date+paid_by+source+category+total for coordinated filter dropdowns ──
export interface ReceiptMeta {
  store_name: string
  purchase_date: string
  paid_by: string | null
  source: string
  category: string
  total: number
}
export async function getReceiptMeta(): Promise<ReceiptMeta[]> {
  const { data } = await supabase
    .from('receipts')
    .select('store_name, purchase_date, paid_by, source, category, total')
  return (data ?? []) as ReceiptMeta[]
}

// ── Stats (filter-aware) ───────────────────────────────────
// Computed entirely in Postgres (get_receipt_stats in schema.sql) instead of
// pulling every matching receipt id to the client and re-querying with .in() —
// that two-round-trip shape doesn't scale and risks PostgREST/URL length
// limits once the filtered set runs into the thousands.
export async function getStats(storeName?: string, dateFrom?: string, dateTo?: string, paidBy?: string, source?: string, category?: string, signal?: AbortSignal, returnFilter?: ReturnFilter) {
  let q = supabase.rpc('get_receipt_stats', {
    p_store:         storeName ?? null,
    p_date_from:     dateFrom  ?? null,
    p_date_to:       dateTo    ?? null,
    p_paid_by:       paidBy    ?? null,
    p_source:        source    ?? null,
    p_category:      category  ?? null,
    p_return_filter: returnFilter ?? null,
  })
  if (signal) q = q.abortSignal(signal)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return {
    receipts: Number(row?.receipts ?? 0),
    total:    Number(row?.total    ?? 0),
    items:    Number(row?.items    ?? 0),
    savings:  Number(row?.savings  ?? 0),
    refunded: Number(row?.refunded ?? 0),
  }
}

// ── Batch delete receipts ─────────────────────────────────
// Chunked to keep every .in() call's id list well under PostgREST/URL length
// limits — a "select all N receipts" batch delete can otherwise put thousands
// of UUIDs into a single query string.
const DELETE_CHUNK_SIZE = 150

export async function deleteReceipts(ids: string[]): Promise<void> {
  if (!ids.length) return
  for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE)
    const { data } = await supabase.from('receipts').select('image_urls').in('id', chunk)
    const paths = (data ?? [])
      .flatMap((r: any) => r.image_urls ?? [])
      .map((url: string) => { const i2 = url.indexOf('/receipt-images/'); return i2 !== -1 ? url.slice(i2 + 16) : null })
      .filter(Boolean) as string[]
    if (paths.length) await supabase.storage.from('receipt-images').remove(paths)
    const { error } = await supabase.from('receipts').delete().in('id', chunk)
    if (error) throw new Error(error.message)
  }
}

// ── Delete receipt ─────────────────────────────────────────
export async function deleteReceipt(id: string): Promise<void> {
  const { data } = await supabase
    .from('receipts')
    .select('image_urls')
    .eq('id', id)
    .single()

  if (data?.image_urls?.length) {
    const paths = data.image_urls
      .map((url: string) => {
        const marker = '/receipt-images/'
        const idx    = url.indexOf(marker)
        return idx !== -1 ? url.slice(idx + marker.length) : null
      })
      .filter(Boolean)

    if (paths.length) {
      await supabase.storage.from('receipt-images').remove(paths)
    }
  }

  const { error } = await supabase.from('receipts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Distinct brands present in receipts ───────────────────
export async function getDistinctBrands(): Promise<string[]> {
  const { data } = await supabase.from('receipts').select('brand')
  const brands = [...new Set((data ?? []).map((r: any) => r.brand).filter(Boolean))] as string[]
  return brands.sort()
}

// ── Search items with price history ───────────────────────
// Two-step, same shape as getReturnCandidates(): search_item_history() first
// narrows to the (bounded) set of distinct items matching the query/filters,
// then returns their FULL purchase history with no row cap. The old approach
// capped at 300 raw rows before grouping, so a broad term (e.g. a common
// grocery name) could silently truncate an individual item's older purchases
// once a household's receipt history got large enough.
export async function searchItems(
  query: string,
  brand?: string,
  dateFrom?: string,
  dateTo?: string,
  priceMax?: number,
): Promise<ItemHistory[]> {
  if (!query.trim()) return []

  const { data, error } = await supabase.rpc('search_item_history', {
    p_query:     query.trim(),
    p_brand:     brand && brand !== 'all' ? brand : null,
    p_date_from: dateFrom ?? null,
    p_date_to:   dateTo   ?? null,
    p_price_max: priceMax ?? null,
  })
  if (error) throw new Error(error.message)
  return groupHistory(data ?? [])
}

// ── Search returned items (Prices → ↩ Returns tab) ──────────
// Entirely separate from searchItems()/item_purchase_history above — sourced
// from item_returns instead, so it can never affect the main search's price-
// trend math (which explicitly excludes returned rows for exactly that
// reason). No grouping/trend computation here, just a flat, most-recent-
// first list — "what did I return, when, for how much."
export async function searchReturnedItems(
  query: string,
  brand?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<import('./types').ReturnedItem[]> {
  if (!query.trim()) return []

  const { data, error } = await supabase.rpc('search_returned_items', {
    p_query:     query.trim(),
    p_brand:     brand && brand !== 'all' ? brand : null,
    p_date_from: dateFrom ?? null,
    p_date_to:   dateTo   ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as import('./types').ReturnedItem[]
}

function groupHistory(rows: any[]): ItemHistory[] {
  const map = new Map<string, ItemHistory>()

  for (const row of rows) {
    // Skip returned items — negative final_price corrupts price trend analysis
    if (Number(row.final_price) < 0) continue

    // Item code is the most reliable key (works across stores).
    // Without a code, scope to same store to avoid cross-store false matches.
    const key = row.item_code
      ? `c:${row.item_code}`
      : `s:${(row.store_name ?? '').toLowerCase().trim()}:n:${row.name.toUpperCase().trim()}`

    if (!map.has(key)) {
      map.set(key, {
        item_code:    row.item_code,
        name:         row.name,
        purchases:    [],
        min_price:    Infinity,
        max_price:    -Infinity,
        latest_price: row.final_price,
        trend:        'single',
      })
    }

    const e = map.get(key)!
    e.purchases.push({
      receipt_id:      row.receipt_id,
      purchase_date:   row.purchase_date,
      store_name:      row.store_name,
      brand:           row.brand,
      location:        row.location,
      transaction_id:  row.transaction_id,
      original_price:  row.original_price,
      discount_amount: row.discount_amount,
      final_price:     row.final_price,
    })

    if (row.final_price < e.min_price) e.min_price = row.final_price
    if (row.final_price > e.max_price) {
      e.max_price = row.final_price
      e.max_price_purchase = {
        receipt_id:    row.receipt_id,
        purchase_date: row.purchase_date,
        store_name:    row.store_name,
        final_price:   row.final_price,
      }
    }
  }

  for (const e of map.values()) {
    if (e.purchases.length === 1) { e.trend = 'single'; continue }
    const latest   = e.purchases[0].final_price
    const earliest = e.purchases[e.purchases.length - 1].final_price
    e.latest_price = latest
    e.trend = latest > earliest ? 'up' : latest < earliest ? 'down' : 'stable'
  }

  return [...map.values()]
    .sort((a, b) => b.purchases.length - a.purchases.length)
}

// All grouping/aggregation now happens in Postgres (get_spending_stats in
// schema.sql) instead of pulling every receipt (+ every item, for the
// discount sum) to the browser and reduce()-ing there. "All time" and the
// YoY toggle used to mean an unbounded full-table fetch on every render.
export async function getSpendingStats(dateFrom?: string, dateTo?: string) {
  const { data, error } = await supabase.rpc('get_spending_stats', {
    p_date_from: dateFrom ?? null,
    p_date_to:   dateTo   ?? null,
  })
  if (error) throw new Error(error.message)

  const s = (data ?? {}) as any
  const totalSpent   = Number(s.totalSpent ?? 0)
  const receiptCount = Number(s.receiptCount ?? 0)

  return {
    totalSpent,
    totalSaved:    Number(s.totalSaved ?? 0),
    // Total refunded this period, shown as its own figure — never netted
    // into a category, since a return receipt's category doesn't reliably
    // match what was actually returned (see get_spending_stats in schema.sql).
    totalRefunded: Number(s.totalRefunded ?? 0),
    receiptCount,
    avgPerTrip:   receiptCount ? totalSpent / receiptCount : 0,
    byBrand:      ((s.byBrand ?? []) as any[]).map(b => ({ brand: b.brand, name: b.name, count: Number(b.count), positiveCount: Number(b.positiveCount ?? b.count), total: Number(b.total) })),
    byMonth:      ((s.byMonth ?? []) as any[]).map(m => ({ month: m.month, total: Number(m.total) })),
    byPayer:      ((s.byPayer ?? []) as any[]).map(p => ({ payer: p.payer, count: Number(p.count), total: Number(p.total) })),
    byCategory:   ((s.byCategory ?? []) as any[]).map(c => ({ category: c.category, count: Number(c.count), total: Number(c.total) })),
    // Per-store monthly totals — { [store_name]: { [YYYY-MM]: total } } —
    // powers AnalyticsTab.storeTrend() without shipping every raw receipt.
    byStoreMonth: (s.byStoreMonth ?? {}) as Record<string, Record<string, number>>,
  }
}

// ── Top N receipts by total, for a date range (biggest-receipt cards) ──
// A small bounded query — was previously derived by sorting the full
// getSpendingStats() receipts array client-side.
export async function getTopReceipts(dateFrom?: string, dateTo?: string, limit = 3): Promise<Receipt[]> {
  let q = supabase
    .from('receipts')
    .select('id, store_name, purchase_date, total, category')
    .gt('total', 0)
    .order('total', { ascending: false })
    .limit(limit)
  if (dateFrom) q = q.gte('purchase_date', dateFrom)
  if (dateTo)   q = q.lte('purchase_date', dateTo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Receipt[]
}

// ── Shopping list ──────────────────────────────────────────
// Change this to adjust how long checked-off items stay visible
const DONE_VISIBLE_HOURS = 2

export async function getShoppingList(): Promise<ShoppingItem[]> {
  const { data, error } = await supabase
    .from('shopping_list')
    .select('*')
    .order('done',       { ascending: true  })   // active items first
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const cutoff = new Date(Date.now() - DONE_VISIBLE_HOURS * 60 * 60 * 1000).toISOString()
  return ((data ?? []) as ShoppingItem[]).filter(
    i => !i.done || (i.done_at != null && i.done_at >= cutoff)
  )
}

export async function addShoppingItem(text: string, added_by: string): Promise<ShoppingItem> {
  const { data, error } = await supabase
    .from('shopping_list')
    .insert({ text, added_by })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ShoppingItem
}

export async function markShoppingItemDone(id: string): Promise<void> {
  const { error } = await supabase
    .from('shopping_list')
    .update({ done: true, done_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteShoppingItem(id: string): Promise<void> {
  const { error } = await supabase.from('shopping_list').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function undoShoppingItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('shopping_list')
    .update({ done: false, done_at: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function clearDoneItems(): Promise<void> {
  const { error } = await supabase.from('shopping_list').delete().eq('done', true)
  if (error) throw new Error(error.message)
}

// ── Get all receipt IDs matching current filter (for select-all across pages) ─
export async function getAllReceiptIds(
  storeName?: string,
  dateFrom?: string,
  dateTo?: string,
  paidBy?: string,
  source?: string,
  category?: string,
  returnFilter?: ReturnFilter,
): Promise<string[]> {
  let q = supabase.from('receipts').select('id')
  if (storeName) q = q.eq('store_name', storeName)
  if (dateFrom)  q = q.gte('purchase_date', dateFrom)
  if (dateTo)    q = q.lte('purchase_date', dateTo)
  if (paidBy)    q = q.eq('paid_by', paidBy)
  if (source)    q = q.eq('source', source)
  if (category)  q = q.eq('category', category)
  if (returnFilter === 'purchases') q = q.gte('total', 0)
  if (returnFilter === 'returns')   q = q.lt('total', 0)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => r.id)
}

// ── Update receipt header fields ───────────────────────────
export async function updateReceipt(id: string, data: {
  brand: string
  store_name: string
  location?: string
  purchase_date: string
  purchase_time?: string
  total: number
  tax?: number
  paid_by: string
  category?: string
  notes?: string
}): Promise<void> {
  const { error } = await supabase
    .from('receipts')
    .update({
      brand:         data.brand,
      store_name:    data.store_name,
      location:      data.location || null,
      purchase_date: data.purchase_date,
      purchase_time: data.purchase_time || null,
      total:         data.total,
      tax:           data.tax ?? null,
      paid_by:       data.paid_by,
      category:      data.category ?? 'other',
      notes:         data.notes || null,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Replace all items on a receipt (delete + re-insert, atomic) ────
// Runs inside a single Postgres function so a failed insert can never leave
// the receipt with its items deleted and nothing put back — see
// replace_receipt_items() in schema.sql.
export async function replaceReceiptItems(
  receiptId: string,
  items: { item_code?: string; name: string; original_price: number; discount_amount: number; final_price: number; quantity?: number }[],
): Promise<void> {
  const payload = items.map(item => ({
    item_code:       item.item_code || null,
    name:            item.name,
    original_price:  item.original_price,
    discount_amount: item.discount_amount,
    final_price:     item.final_price,
    quantity:        item.quantity ?? 1,
  }))
  const { error } = await supabase.rpc('replace_receipt_items', {
    p_receipt_id: receiptId,
    p_items:      payload,
  })
  if (error) throw new Error(error.message)
}

// ── Return candidates (items where price trended up) ───────
// Claims-aware: a 'return' claim removes that specific purchase from
// candidacy permanently (nothing left to compare — the item and the money
// are both gone); a 'price_match' claim keeps it eligible but at its
// corrected price (original − money recovered), so a further future price
// drop can still surface as a new, distinct opportunity. This is the one
// function both the Prices page and the weekly cron call (see
// api/cron/price-alert/route.ts), so claimed alerts disappear from both
// automatically — no separate cron-side bookkeeping needed.
export async function getReturnCandidates(): Promise<import('./types').ItemHistory[]> {
  // Step 1: DB function returns only qualifying item_codes (fast, no row limit issues).
  // Deliberately claims-unaware — it's a coarse, fast pre-filter; claim
  // adjustments only ever lower a purchase's effective price, so anything
  // that fails the raw (unadjusted) check here could never pass after
  // adjustment either. Precision happens in step 2 below.
  const { data: candidates, error: rpcErr } = await supabase.rpc('get_return_candidates')
  if (rpcErr) throw new Error(rpcErr.message)

  const itemCodes = (candidates ?? []).map((c: any) => c.item_code).filter(Boolean) as string[]
  if (!itemCodes.length) return []

  // Step 2: fetch full purchase history + any claims for those items in parallel.
  const [{ data, error }, claims] = await Promise.all([
    supabase
      .from('item_purchase_history')
      .select('*')
      .in('item_code', itemCodes)
      .order('purchase_date', { ascending: false }),
    getPriceAlertClaims(itemCodes),
  ])
  if (error) throw new Error(error.message)

  const returnedKeys   = new Set(claims.filter(c => c.claim_type === 'return').map(c => `${c.item_code}:${c.receipt_id}`))
  const priceMatchByKey = new Map(claims.filter(c => c.claim_type === 'price_match').map(c => [`${c.item_code}:${c.receipt_id}`, c.claimed_amount]))

  const adjusted = (data ?? [])
    .filter((row: any) => !returnedKeys.has(`${row.item_code}:${row.receipt_id}`))
    .map((row: any) => {
      const recovered = priceMatchByKey.get(`${row.item_code}:${row.receipt_id}`)
      return recovered != null
        ? { ...row, final_price: Math.max(0, Number(row.final_price) - recovered) }
        : row
    })

  return groupHistory(adjusted)
    .filter(i => i.purchases.length > 1 && i.max_price > i.latest_price)
    .sort((a, b) => (b.max_price - b.latest_price) - (a.max_price - a.latest_price))
}

async function getPriceAlertClaims(itemCodes: string[]): Promise<import('./types').PriceAlertClaim[]> {
  if (!itemCodes.length) return []
  const { data, error } = await supabase
    .from('price_alert_claims')
    .select('item_code, receipt_id, claim_type, claimed_amount')
    .in('item_code', itemCodes)
  if (error) throw new Error(error.message)
  return (data ?? []) as import('./types').PriceAlertClaim[]
}

// Records that a Price Alert row was acted on. Upsert on (item_code,
// receipt_id) — re-claiming the same instance (e.g. fixing a wrong claim
// type) corrects it in place rather than erroring on the unique constraint.
export async function claimPriceAlert(
  itemCode: string,
  receiptId: string,
  claimType: 'return' | 'price_match',
  claimedAmount: number,
  claimedBy?: string,
): Promise<void> {
  const { error } = await supabase
    .from('price_alert_claims')
    .upsert({
      item_code:      itemCode,
      receipt_id:     receiptId,
      claim_type:     claimType,
      claimed_amount: claimedAmount,
      claimed_by:     claimedBy ?? null,
    }, { onConflict: 'item_code,receipt_id' })
  if (error) throw new Error(error.message)
}

// Lifetime total shown at the top of the Price Alerts page.
export async function getPriceAlertClaimsSummary(): Promise<{ count: number; total: number }> {
  const { data, error } = await supabase.from('price_alert_claims').select('claimed_amount')
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return {
    count: rows.length,
    total: rows.reduce((s, c: any) => s + Number(c.claimed_amount), 0),
  }
}

// ── Receipts by date (for heatmap day detail) ──────────────
export async function getReceiptsByDate(date: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*, receipt_items(discount_amount)')
    .eq('purchase_date', date)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(({ receipt_items, ...r }: any) => ({
    ...r,
    totalSavings: (receipt_items ?? []).reduce((s: number, i: any) => s + Number(i.discount_amount ?? 0), 0),
  })) as Receipt[]
}

// ── Daily spending totals for calendar heatmap ─────────────
export async function getDailySpending(
  year: number,
  month: number,
): Promise<Record<string, { total: number; count: number }>> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data } = await supabase
    .from('receipts')
    .select('purchase_date, total')
    .gte('purchase_date', from)
    .lte('purchase_date', to)

  const map: Record<string, { total: number; count: number }> = {}
  for (const r of data ?? []) {
    if (Number(r.total) <= 0) continue
    const d = r.purchase_date as string
    if (!map[d]) map[d] = { total: 0, count: 0 }
    map[d].total += Number(r.total)
    map[d].count += 1
  }
  return map
}

// ── Category spending for current month (for budget check) ─
export async function getCategorySpendingForMonth(
  month: string,   // "YYYY-MM"
): Promise<Record<string, number>> {
  const from = `${month}-01`
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const to   = `${month}-${String(lastDay).padStart(2, '0')}`

  const { data } = await supabase
    .from('receipts')
    .select('category, total')
    .gte('purchase_date', from)
    .lte('purchase_date', to)

  const map: Record<string, number> = {}
  for (const r of data ?? []) {
    if (Number(r.total) <= 0) continue
    const cat = (r.category as string) ?? 'other'
    map[cat] = (map[cat] ?? 0) + Number(r.total)
  }
  return map
}

// Total refunded in a date range — shown as its own figure next to category
// spend rather than netted into any one category (a return receipt's
// category doesn't reliably match what was actually returned). Used by the
// Budget tab, scoped to the same calendar month as getCategorySpendingForMonth.
export async function getRefundTotal(dateFrom?: string, dateTo?: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_refund_total', {
    p_date_from: dateFrom ?? null,
    p_date_to:   dateTo   ?? null,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

// ── Budgets ────────────────────────────────────────────────
export async function getBudgets(): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .order('category')
  if (error) throw new Error(error.message)
  return (data ?? []) as Budget[]
}

export async function upsertBudget(
  category: string,
  amount: number,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('budgets')
    .upsert({ category, amount, active, updated_at: new Date().toISOString() }, { onConflict: 'category' })
  if (error) throw new Error(error.message)
}

// ── Recurring: cycle window (pure, no DB calls) ────────────
// Returns the inclusive date range [cycleStart, cycleEnd] for the current
// billing cycle of a bill, relative to the given reference date (default: today).
export function getCycleWindow(
  bill: RecurringBill,
  ref?: Date,
): { cycleStart: Date; cycleEnd: Date } {
  const today = ref ? new Date(ref) : new Date()
  today.setHours(0, 0, 0, 0)

  if (bill.frequency === 'monthly' && bill.due_day) {
    const day = bill.due_day
    // cycleStart = this month's due_day if today >= that day, else last month's
    const cycleStart = today.getDate() >= day
      ? new Date(today.getFullYear(), today.getMonth(), day)
      : new Date(today.getFullYear(), today.getMonth() - 1, day)
    // cycleEnd = day before next due_day occurrence.
    // Use setMonth(+1) then subtract 1 day so JS clamps months correctly
    // (e.g. due_day=31 in Jan → next due = Feb 28/29, cycleEnd = Feb 27/28).
    const nextStart = new Date(cycleStart)
    nextStart.setMonth(nextStart.getMonth() + 1)
    const cycleEnd = new Date(nextStart)
    cycleEnd.setDate(cycleEnd.getDate() - 1)
    return { cycleStart, cycleEnd }
  }

  if (bill.frequency === 'annual' && bill.due_date) {
    const base = new Date(bill.due_date + 'T00:00:00')
    const thisYear = new Date(today.getFullYear(), base.getMonth(), base.getDate())
    const cycleStart = today >= thisYear
      ? thisYear
      : new Date(today.getFullYear() - 1, base.getMonth(), base.getDate())
    const cycleEnd = new Date(cycleStart.getFullYear() + 1, cycleStart.getMonth(), cycleStart.getDate())
    cycleEnd.setDate(cycleEnd.getDate() - 1)
    return { cycleStart, cycleEnd }
  }

  if (bill.frequency === 'quarterly' && bill.due_date) {
    const base = new Date(bill.due_date + 'T00:00:00')
    let d = new Date(base)
    // Roll forward until d is the first occurrence strictly after today
    while (d <= today) d.setMonth(d.getMonth() + 3)
    const cycleStart = new Date(d); cycleStart.setMonth(cycleStart.getMonth() - 3)
    const cycleEnd   = new Date(d); cycleEnd.setDate(cycleEnd.getDate() - 1)
    return { cycleStart, cycleEnd }
  }

  if (bill.frequency === 'weekly') {
    const cycleEnd   = new Date(today)
    const cycleStart = new Date(today); cycleStart.setDate(cycleStart.getDate() - 6)
    return { cycleStart, cycleEnd }
  }

  // Legacy fallback — a monthly bill with no due_day, or an annual/quarterly
  // bill with no due_date. BillForm now requires the right field for each
  // frequency (and the DB has a matching CHECK constraint), so this can only
  // be hit by a bill saved before that validation existed. It used to fall
  // through to the weekly 6-day window above, silently reclassifying e.g. a
  // monthly bill's paid status onto a rolling-week cadence with no error
  // shown anywhere — flapping between "paid"/"not paid" every few days.
  // Falling back to the current calendar month/quarter/year is a materially
  // less wrong default for exactly the cases this can still occur.
  if (bill.frequency === 'annual') {
    return {
      cycleStart: new Date(today.getFullYear(), 0, 1),
      cycleEnd:   new Date(today.getFullYear(), 11, 31),
    }
  }
  if (bill.frequency === 'quarterly') {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3
    return {
      cycleStart: new Date(today.getFullYear(), qStartMonth, 1),
      cycleEnd:   new Date(today.getFullYear(), qStartMonth + 3, 0),
    }
  }
  // monthly with no due_day
  return {
    cycleStart: new Date(today.getFullYear(), today.getMonth(), 1),
    cycleEnd:   new Date(today.getFullYear(), today.getMonth() + 1, 0),
  }
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Recurring bills ────────────────────────────────────────
// Two queries total — no per-bill queries.
// Attaches paidThisCycle / cycleStart / cycleEnd / cyclePayment to each bill.
export async function getRecurring(): Promise<RecurringBill[]> {
  // Look back 13 months to cover even annual cycles that were paid near their start date
  const lookback = new Date()
  lookback.setMonth(lookback.getMonth() - 13)

  const [{ data: bills, error }, { data: payments }] = await Promise.all([
    supabase.from('recurring').select('*').eq('active', true).order('name'),
    supabase.from('recurring_payments')
      .select('id, recurring_id, paid_by, paid_at, amount')
      .gte('paid_at', lookback.toISOString())
      .order('paid_at', { ascending: false }),
  ])
  if (error) throw new Error(error.message)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  return (bills ?? []).map((bill: any) => {
    const { cycleStart, cycleEnd } = getCycleWindow(bill as RecurringBill, today)

    // Find all payments whose date falls inside [cycleStart, cycleEnd]
    const cyclePayments = (payments ?? []).filter((p: any) => {
      if (p.recurring_id !== bill.id) return false
      const pDate = new Date(p.paid_at); pDate.setHours(0, 0, 0, 0)
      return pDate >= cycleStart && pDate <= cycleEnd
    })

    const paidThisCycle = cyclePayments.length > 0
    const cyclePayment  = paidThisCycle
      ? { paid_at: cyclePayments[0].paid_at, paid_by: cyclePayments[0].paid_by, amount: Number(cyclePayments[0].amount) }
      : null

    return {
      ...bill,
      paidThisCycle,
      cycleStart: isoDate(cycleStart),
      cycleEnd:   isoDate(cycleEnd),
      cyclePayment,
    } as RecurringBill
  })
}

export async function addRecurring(bill: Omit<RecurringBill, 'id' | 'created_at' | 'paidThisCycle' | 'cycleStart' | 'cycleEnd' | 'cyclePayment'>): Promise<RecurringBill> {
  const { data, error } = await supabase.from('recurring').insert(bill).select().single()
  if (error) throw new Error(error.message)
  return data as RecurringBill
}

export async function updateRecurring(id: string, bill: Partial<Omit<RecurringBill, 'id' | 'created_at' | 'paidThisCycle' | 'cycleStart' | 'cycleEnd' | 'cyclePayment'>>): Promise<void> {
  const { error } = await supabase.from('recurring').update(bill).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRecurring(id: string): Promise<void> {
  const { error } = await supabase.from('recurring').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Insert payment row + update paid_by on the bill. No last_paid_at sync needed.
// recurring.paid_by is the bill's owner/default payer — a command-and-aggregate
// boundary: it's only ever mutated by the "edit bill" command (updateRecurring),
// never by "record a payment" here. recurring_payments is the append-only log
// of who actually paid each cycle, which is already the correct source of
// truth for that (see getRecurringPaymentsForPeriod). This used to also
// overwrite recurring.paid_by on every payment, so one household member
// covering a single cycle would silently and permanently reassign who the
// bill is "owned by" going forward.
export async function markRecurringPaid(id: string, paidBy: string, paidAt?: string): Promise<void> {
  const { data: bill } = await supabase.from('recurring').select('amount').eq('id', id).single()
  const ts = paidAt ? new Date(paidAt + 'T12:00:00').toISOString() : new Date().toISOString()
  const { error } = await supabase
    .from('recurring_payments')
    .insert({ recurring_id: id, paid_by: paidBy, paid_at: ts, amount: bill?.amount ?? 0 })
  if (error) throw new Error(error.message)
}

// Delete the current-cycle payment. Paid status recomputes on next getRecurring call.
export async function markRecurringUnpaid(id: string): Promise<void> {
  const { data: bill } = await supabase.from('recurring').select('*').eq('id', id).single()
  if (!bill) return

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const { cycleStart, cycleEnd } = getCycleWindow(bill as RecurringBill, today)

  // Find the most recent payment that falls within the current cycle window
  const cycleEndTs = new Date(cycleEnd); cycleEndTs.setHours(23, 59, 59, 999)
  const { data: payment } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('recurring_id', id)
    .gte('paid_at', cycleStart.toISOString())
    .lte('paid_at', cycleEndTs.toISOString())
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (payment?.id) {
    await supabase.from('recurring_payments').delete().eq('id', payment.id)
  }
}

// Insert a manually-dated payment. Cycle membership is computed at read time — no sync needed.
export async function addRecurringPaymentManual(
  recurringId: string, paidBy: string, paidAt: string, amount: number,
): Promise<void> {
  const ts = new Date(paidAt + 'T12:00:00').toISOString()
  const { error } = await supabase.from('recurring_payments').insert({
    recurring_id: recurringId, paid_by: paidBy, paid_at: ts, amount,
  })
  if (error) throw new Error(error.message)
}

// Delete any payment by ID. Paid status recomputes automatically on next load.
export async function deleteRecurringPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.from('recurring_payments').delete().eq('id', paymentId)
  if (error) throw new Error(error.message)
}

// Offset + "Load more" — the right-weight pagination for a small, bounded,
// per-bill list (payments for one recurring bill), same pattern already used
// on the Receipts page. Fetches one extra row past the page size purely to
// detect whether there's a next page, without a separate count query.
const PAYMENT_HISTORY_PAGE_SIZE = 12

export async function getRecurringPaymentHistory(
  recurringId: string,
  offset = 0,
): Promise<{ data: RecurringPayment[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from('recurring_payments')
    .select('*')
    .eq('recurring_id', recurringId)
    .order('paid_at', { ascending: false })
    .range(offset, offset + PAYMENT_HISTORY_PAGE_SIZE)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as RecurringPayment[]
  const hasMore = rows.length > PAYMENT_HISTORY_PAGE_SIZE
  return { data: hasMore ? rows.slice(0, PAYMENT_HISTORY_PAGE_SIZE) : rows, hasMore }
}

export { PAYMENT_HISTORY_PAGE_SIZE }


export async function getRecurringPaymentsForPeriod(
  dateFrom?: string,
  dateTo?: string,
): Promise<{ payer: string; total: number; count: number }[]> {
  let q = supabase.from('recurring_payments').select('paid_by, amount')
  if (dateFrom) q = q.gte('paid_at', dateFrom + 'T00:00:00')
  if (dateTo)   q = q.lte('paid_at', dateTo   + 'T23:59:59')
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const map = new Map<string, { total: number; count: number }>()
  for (const p of data ?? []) {
    const prev = map.get(p.paid_by) ?? { total: 0, count: 0 }
    map.set(p.paid_by, { total: prev.total + Number(p.amount), count: prev.count + 1 })
  }
  return [...map.entries()]
    .map(([payer, v]) => ({ payer, ...v }))
    .sort((a, b) => b.total - a.total)
}