import { supabase } from './supabase'
import type { Receipt, ParsedReceipt, ItemHistory } from './types'

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
      paid_by:        parsed.paid_by        ?? null,
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

// ── Get receipts list ──────────────────────────────────────
export async function getReceipts(
  storeName?: string,
  date?: string,
  paidBy?: string,
): Promise<Receipt[]> {
  let q = supabase
    .from('receipts')
    .select('*')
    .order('purchase_date', { ascending: false })
    .order('created_at',    { ascending: false })

  if (storeName) q = q.eq('store_name', storeName)
  if (date)      q = q.eq('purchase_date', date)
  if (paidBy)    q = q.eq('paid_by', paidBy)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Receipt[]
}

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

// ── Get store_name+date+paid_by for coordinated filter dropdowns ──
export async function getReceiptMeta(): Promise<{ store_name: string; purchase_date: string; paid_by: string | null }[]> {
  const { data } = await supabase
    .from('receipts')
    .select('store_name, purchase_date, paid_by')
  return (data ?? []) as { store_name: string; purchase_date: string; paid_by: string | null }[]
}

// ── Stats ──────────────────────────────────────────────────
export async function getStats() {
  const { data: recs }  = await supabase.from('receipts').select('total')
  const { data: items } = await supabase.from('receipt_items').select('discount_amount')
  const total   = (recs   ?? []).reduce((s: number, r: any) => s + Number(r.total), 0)
  const savings = (items  ?? []).reduce((s: number, i: any) => s + Number(i.discount_amount), 0)
  return {
    receipts: (recs  ?? []).length,
    total,
    items:    (items ?? []).length,
    savings,
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
    const key = row.item_code
      ? `c:${row.item_code}`
      : `n:${row.name.toUpperCase().trim()}`

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
    if (row.final_price > e.max_price) e.max_price = row.final_price
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
    .select('id, brand, store_name, location, purchase_date, purchase_time, transaction_id, total, paid_by')
    .order('purchase_date', { ascending: false })

  if (dateFrom) q = q.gte('purchase_date', dateFrom)
  if (dateTo)   q = q.lte('purchase_date', dateTo)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const receipts = (data ?? []) as Receipt[]

  // Total spent + saved
  const { data: items } = await supabase
    .from('receipt_items')
    .select('receipt_id, discount_amount')

  const itemMap = new Map<string, number>()
  for (const item of items ?? []) {
    const prev = itemMap.get(item.receipt_id) ?? 0
    itemMap.set(item.receipt_id, prev + Number(item.discount_amount))
  }

  const receiptIds = new Set(receipts.map(r => r.id))
  let totalSaved = 0
  for (const [id, saved] of itemMap.entries()) {
    if (receiptIds.has(id)) totalSaved += saved
  }

  const totalSpent = receipts.reduce((s, r) => s + Number(r.total), 0)
  const avgPerTrip = receipts.length ? totalSpent / receipts.length : 0

  // By brand
  const brandMap = new Map<string, { name: string; count: number; total: number }>()
  for (const r of receipts) {
    const key = r.brand
    const prev = brandMap.get(key) ?? { name: r.store_name, count: 0, total: 0 }
    brandMap.set(key, {
      name:  prev.name,
      count: prev.count + 1,
      total: prev.total + Number(r.total),
    })
  }
  const byBrand = [...brandMap.entries()]
    .map(([brand, v]) => ({ brand, ...v }))
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

  return {
    totalSpent,
    totalSaved,
    receiptCount: receipts.length,
    avgPerTrip,
    byBrand,
    byMonth,
    receipts,
  }
}