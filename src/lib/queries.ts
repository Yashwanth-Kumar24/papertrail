import { supabase } from './supabase'
import type { Receipt, ParsedReceipt, ItemHistory, ShoppingItem, Budget, RecurringBill, RecurringPayment } from './types'

// ── Save receipt ───────────────────────────────────────────
export async function saveReceipt(parsed: ParsedReceipt): Promise<string> {
  if (parsed.transaction_id) {
    // Primary: exact match by transaction ID
    const { data: existing, error: existingErr } = await supabase
      .from('receipts')
      .select('id')
      .eq('store_name', parsed.store.name)
      .eq('purchase_date', parsed.purchase_date)
      .eq('transaction_id', parsed.transaction_id)
      .maybeSingle()

    if (existingErr) throw new Error(existingErr.message)
    if (existing?.id) throw new Error('This receipt is already saved.')
  } else {
    // Fallback: match by store + date + total (+ time if available)
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
    if (existing?.id) throw new Error('This receipt is already saved.')
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
    })
    .select('id')
    .single()

  if (recErr) throw new Error(recErr.message)

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

// ── Get receipts list (paginated, with item count) ─────────
export async function getReceipts(
  storeName?: string,
  date?: string,
  paidBy?: string,
  offset = 0,
  sortBy: ReceiptSort = 'date_desc',
  source?: string,
  category?: string,
): Promise<{ data: Receipt[]; totalCount: number }> {
  let q = supabase
    .from('receipts')
    .select('*, receipt_items(discount_amount)', { count: 'exact' })
    .range(offset, offset + PAGE_SIZE - 1)

  if (storeName) q = q.eq('store_name', storeName)
  if (date)      q = q.eq('purchase_date', date)
  if (paidBy)    q = q.eq('paid_by', paidBy)
  if (source)    q = q.eq('source', source)
  if (category)  q = q.eq('category', category)

  if (sortBy === 'date_desc')  q = q.order('purchase_date', { ascending: false }).order('created_at', { ascending: false })
  if (sortBy === 'date_asc')   q = q.order('purchase_date', { ascending: true  }).order('created_at', { ascending: true  })
  if (sortBy === 'total_desc') q = q.order('total', { ascending: false }).order('purchase_date', { ascending: false })
  if (sortBy === 'total_asc')  q = q.order('total', { ascending: true  }).order('purchase_date', { ascending: false })

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

// ── Get store_name+date+paid_by+source+category for coordinated filter dropdowns ──
export async function getReceiptMeta(): Promise<{ store_name: string; purchase_date: string; paid_by: string | null; source: string; category: string }[]> {
  const { data } = await supabase
    .from('receipts')
    .select('store_name, purchase_date, paid_by, source, category')
  return (data ?? []) as { store_name: string; purchase_date: string; paid_by: string | null; source: string; category: string }[]
}

// ── Stats (filter-aware) ───────────────────────────────────
export async function getStats(storeName?: string, date?: string, paidBy?: string, source?: string, category?: string) {
  let rq = supabase.from('receipts').select('id, total')
  if (storeName) rq = rq.eq('store_name', storeName)
  if (date)      rq = rq.eq('purchase_date', date)
  if (paidBy)    rq = rq.eq('paid_by', paidBy)
  if (source)    rq = rq.eq('source', source)
  if (category)  rq = rq.eq('category', category)
  const { data: recs } = await rq

  const ids    = (recs ?? []).map((r: any) => r.id)
  const total  = (recs ?? []).reduce((s: number, r: any) => s + Number(r.total), 0)

  if (!ids.length) return { receipts: 0, total: 0, items: 0, savings: 0 }

  const { data: items, count: itemCount } = await supabase
    .from('receipt_items')
    .select('discount_amount', { count: 'exact' })
    .in('receipt_id', ids)

  const savings = (items ?? []).reduce((s: number, i: any) => s + Number(i.discount_amount), 0)
  return { receipts: ids.length, total, items: itemCount ?? 0, savings }
}

// ── Batch delete receipts ─────────────────────────────────
export async function deleteReceipts(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { data } = await supabase.from('receipts').select('image_urls').in('id', ids)
  const paths = (data ?? [])
    .flatMap((r: any) => r.image_urls ?? [])
    .map((url: string) => { const i = url.indexOf('/receipt-images/'); return i !== -1 ? url.slice(i + 16) : null })
    .filter(Boolean) as string[]
  if (paths.length) await supabase.storage.from('receipt-images').remove(paths)
  const { error } = await supabase.from('receipts').delete().in('id', ids)
  if (error) throw new Error(error.message)
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

// ── Search items with price history ───────────────────────
export async function searchItems(
  query: string,
  brand?: string,
  dateFrom?: string,
  dateTo?: string,
  priceMax?: number,
): Promise<ItemHistory[]> {
  if (!query.trim()) return []

  const q     = query.trim()
  const isCode  = /^\d+$/.test(q)
  const isPrice = /^\$?[\d.]+$/.test(q) && q.includes('.')

  let dbq = supabase.from('item_purchase_history').select('*')

  if (isCode && !isPrice) {
    dbq = dbq.eq('item_code', q)
  } else if (isPrice) {
    const price = parseFloat(q.replace('$', ''))
    dbq = dbq.gte('final_price', price - 1).lte('final_price', price + 1)
  } else {
    dbq = dbq.ilike('name', `%${q}%`)
  }

  if (brand && brand !== 'all') dbq = dbq.eq('brand', brand)
  if (dateFrom) dbq = dbq.gte('purchase_date', dateFrom)
  if (dateTo)   dbq = dbq.lte('purchase_date', dateTo)
  if (priceMax) dbq = dbq.lte('final_price', priceMax)

  dbq = dbq.order('purchase_date', { ascending: false }).limit(300)

  const { data, error } = await dbq
  if (error) throw new Error(error.message)
  return groupHistory(data ?? [])
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

export async function getSpendingStats(dateFrom?: string, dateTo?: string) {
  let q = supabase
    .from('receipts')
    .select('id, brand, store_name, location, purchase_date, purchase_time, transaction_id, total, paid_by, category, notes, source')
    .order('purchase_date', { ascending: false })

  if (dateFrom) q = q.gte('purchase_date', dateFrom)
  if (dateTo)   q = q.lte('purchase_date', dateTo)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const receipts = (data ?? []) as Receipt[]

  // Total saved — only for receipts in the filtered set
  const receiptIds = receipts.map(r => r.id)
  let totalSaved = 0
  if (receiptIds.length) {
    const { data: items } = await supabase
      .from('receipt_items')
      .select('discount_amount')
      .in('receipt_id', receiptIds)
    totalSaved = (items ?? []).reduce((s: number, i: any) => s + Number(i.discount_amount), 0)
  }

  const totalSpent = receipts.reduce((s, r) => s + Number(r.total), 0)
  const avgPerTrip = receipts.length ? totalSpent / receipts.length : 0

  // By store — group by store_name so the same store never appears twice
  // regardless of whether brand normalization differs between scan vs API import
  const brandMap = new Map<string, { brand: string; name: string; count: number; total: number }>()
  for (const r of receipts) {
    const key  = r.store_name.toLowerCase().trim()
    const prev = brandMap.get(key) ?? { brand: r.brand, name: r.store_name, count: 0, total: 0 }
    brandMap.set(key, { ...prev, count: prev.count + 1, total: prev.total + Number(r.total) })
  }
  const byBrand = [...brandMap.values()]
    .sort((a, b) => b.total - a.total)

  // By month
  const monthMap = new Map<string, number>()
  for (const r of receipts) {
    const month = r.purchase_date.slice(0, 7) // YYYY-MM
    monthMap.set(month, (monthMap.get(month) ?? 0) + Number(r.total))
  }
  const byMonth = [...monthMap.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // By payer
  const payerMap = new Map<string, { count: number; total: number }>()
  for (const r of receipts) {
    if (!r.paid_by) continue
    const prev = payerMap.get(r.paid_by) ?? { count: 0, total: 0 }
    payerMap.set(r.paid_by, { count: prev.count + 1, total: prev.total + Number(r.total) })
  }
  const byPayer = [...payerMap.entries()]
    .map(([payer, v]) => ({ payer, ...v }))
    .sort((a, b) => b.total - a.total)

  // By category
  const categoryMap = new Map<string, { count: number; total: number }>()
  for (const r of receipts) {
    if (Number(r.total) <= 0) continue
    const cat = (r as any).category ?? 'other'
    const prev = categoryMap.get(cat) ?? { count: 0, total: 0 }
    categoryMap.set(cat, { count: prev.count + 1, total: prev.total + Number(r.total) })
  }
  const byCategory = [...categoryMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total)

  return {
    totalSpent,
    totalSaved,
    receiptCount: receipts.length,
    avgPerTrip,
    byBrand,
    byMonth,
    byPayer,
    byCategory,
    receipts,
  }
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
  date?: string,
  paidBy?: string,
  source?: string,
  category?: string,
): Promise<string[]> {
  let q = supabase.from('receipts').select('id')
  if (storeName) q = q.eq('store_name', storeName)
  if (date)      q = q.eq('purchase_date', date)
  if (paidBy)    q = q.eq('paid_by', paidBy)
  if (source)    q = q.eq('source', source)
  if (category)  q = q.eq('category', category)
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

// ── Replace all items on a receipt (delete + re-insert) ────
export async function replaceReceiptItems(
  receiptId: string,
  items: { item_code?: string; name: string; original_price: number; discount_amount: number; final_price: number; quantity?: number }[],
): Promise<void> {
  const { error: delErr } = await supabase.from('receipt_items').delete().eq('receipt_id', receiptId)
  if (delErr) throw new Error(delErr.message)
  if (!items.length) return
  const rows = items.map((item, i) => ({
    receipt_id:      receiptId,
    item_code:       item.item_code || null,
    name:            item.name,
    original_price:  item.original_price,
    discount_amount: item.discount_amount,
    final_price:     item.final_price,
    quantity:        item.quantity ?? 1,
    sort_order:      i,
  }))
  const { error: insErr } = await supabase.from('receipt_items').insert(rows)
  if (insErr) throw new Error(insErr.message)
}

// ── Return candidates (items where price trended up) ───────
export async function getReturnCandidates(): Promise<import('./types').ItemHistory[]> {
  const { data, error } = await supabase
    .from('item_purchase_history')
    .select('*')
    .order('purchase_date', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)
  const all = groupHistory(data ?? [])
  return all
    .filter(i => i.purchases.length > 1 && i.max_price > i.latest_price)
    .sort((a, b) => (b.max_price - b.latest_price) - (a.max_price - a.latest_price))
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

// ── Recurring bills ────────────────────────────────────────
export async function getRecurring(): Promise<RecurringBill[]> {
  const { data, error } = await supabase
    .from('recurring')
    .select('*')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as RecurringBill[]
}

export async function addRecurring(bill: Omit<RecurringBill, 'id' | 'created_at' | 'last_paid_at'>): Promise<RecurringBill> {
  const { data, error } = await supabase
    .from('recurring')
    .insert(bill)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as RecurringBill
}

export async function updateRecurring(id: string, bill: Partial<Omit<RecurringBill, 'id' | 'created_at'>>): Promise<void> {
  const { error } = await supabase
    .from('recurring')
    .update(bill)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRecurring(id: string): Promise<void> {
  const { error } = await supabase.from('recurring').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markRecurringPaid(id: string, paidBy: string, paidAt?: string): Promise<void> {
  const { data: bill } = await supabase.from('recurring').select('amount').eq('id', id).single()
  const ts = paidAt ? new Date(paidAt + 'T12:00:00').toISOString() : new Date().toISOString()

  const [{ error: billErr }, { error: payErr }] = await Promise.all([
    supabase.from('recurring').update({ last_paid_at: ts, paid_by: paidBy }).eq('id', id),
    supabase.from('recurring_payments').insert({
      recurring_id: id, paid_by: paidBy, paid_at: ts, amount: bill?.amount ?? 0,
    }),
  ])
  if (billErr) throw new Error(billErr.message)
  if (payErr)  throw new Error(payErr.message)
}

export async function markRecurringUnpaid(id: string): Promise<void> {
  // Find and delete the most recent payment for this bill
  const { data: latest } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('recurring_id', id)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await supabase.from('recurring').update({ last_paid_at: null }).eq('id', id)
  if (latest?.id) {
    await supabase.from('recurring_payments').delete().eq('id', latest.id)
  }
}

export async function addRecurringPaymentManual(
  recurringId: string, paidBy: string, paidAt: string, amount: number,
): Promise<void> {
  const ts = new Date(paidAt + 'T12:00:00').toISOString()
  await supabase.from('recurring_payments').insert({
    recurring_id: recurringId, paid_by: paidBy, paid_at: ts, amount,
  })
  // Update last_paid_at on the bill if this payment is more recent
  const { data: bill } = await supabase.from('recurring').select('last_paid_at').eq('id', recurringId).single()
  if (!bill?.last_paid_at || new Date(ts) > new Date(bill.last_paid_at)) {
    await supabase.from('recurring').update({ last_paid_at: ts, paid_by: paidBy }).eq('id', recurringId)
  }
}

export async function deleteRecurringPayment(paymentId: string, recurringId: string): Promise<void> {
  await supabase.from('recurring_payments').delete().eq('id', paymentId)
  // Recalculate last_paid_at from remaining payments
  const { data: remaining } = await supabase
    .from('recurring_payments')
    .select('paid_at, paid_by')
    .eq('recurring_id', recurringId)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // Only update paid_by when a previous payment exists — paid_by is NOT NULL in schema
  const update: Record<string, unknown> = { last_paid_at: remaining?.paid_at ?? null }
  if (remaining?.paid_by) update.paid_by = remaining.paid_by
  await supabase.from('recurring').update(update).eq('id', recurringId)
}

export async function getRecurringPaymentHistory(recurringId: string): Promise<RecurringPayment[]> {
  const { data, error } = await supabase
    .from('recurring_payments')
    .select('*')
    .eq('recurring_id', recurringId)
    .order('paid_at', { ascending: false })
    .limit(12)
  if (error) throw new Error(error.message)
  return (data ?? []) as RecurringPayment[]
}

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