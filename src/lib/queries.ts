import { supabase } from './supabase'
import type { Receipt, ParsedReceipt, ItemHistory } from './types'

// ── upsert store ────────────────────────────────────────────
async function upsertStore(s: ParsedReceipt['store']): Promise<string> {
  const { data, error } = await supabase
    .from('stores')
    .upsert({ brand: s.brand, name: s.name, location: s.location },
             { onConflict: 'brand,name' })
    .select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

// ── save receipt ────────────────────────────────────────────
export async function saveReceipt(parsed: ParsedReceipt): Promise<string> {
  const storeId = await upsertStore(parsed.store)

  const { data: rec, error: recErr } = await supabase
    .from('receipts')
    .insert({
      store_id:       storeId,
      store_name:     parsed.store.name,
      location:       parsed.store.location,
      purchase_date:  parsed.purchase_date,
      purchase_time:  parsed.purchase_time,
      transaction_id: parsed.transaction_id,
      total:          parsed.total ?? 0,
      raw_ocr_text:   parsed.raw_ocr_text,
    })
    .select('id').single()

  if (recErr) throw new Error(recErr.message)

  const rows = parsed.line_items.map(li => ({
    receipt_id:      rec.id,
    item_code:       li.item_code ?? null,
    name:            li.name,
    original_price:  li.original_price,
    discount_amount: li.discount_amount,
    final_price:     li.final_price,
    sort_order:      li.sort_order,
  }))

  const { error: itemErr } = await supabase.from('receipt_items').insert(rows)
  if (itemErr) throw new Error(itemErr.message)

  return rec.id
}

// ── get receipts list ───────────────────────────────────────
export async function getReceipts(brand?: string, date?: string) {
  let q = supabase
    .from('receipts')
    .select('*, store:stores(brand, name, location)')
    .order('purchase_date', { ascending: false })
    .order('created_at',    { ascending: false })

  if (date)  q = q.eq('purchase_date', date)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  let rows = (data ?? []) as Receipt[]
  if (brand && brand !== 'all')
    rows = rows.filter(r => r.store?.brand === brand)

  return rows
}

// ── get single receipt with items ──────────────────────────
export async function getReceiptById(id: string): Promise<Receipt | null> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*, store:stores(*), receipt_items(*)')
    .eq('id', id)
    .single()
  if (error) return null
  // Sort items client-side
  if (data?.receipt_items) {
    data.receipt_items.sort((a: any, b: any) => a.sort_order - b.sort_order)
  }
  return data as Receipt
}

// ── get distinct dates ──────────────────────────────────────
export async function getReceiptDates(): Promise<string[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('purchase_date')
    .order('purchase_date', { ascending: false })
  if (error) return []
  return [...new Set((data ?? []).map((r: any) => r.purchase_date))]
}

// ── get distinct brands ─────────────────────────────────────
export async function getStoreBrands(): Promise<string[]> {
  const { data, error } = await supabase
    .from('stores').select('brand')
  if (error) return []
  return [...new Set((data ?? []).map((s: any) => s.brand))]
}

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

export async function deleteReceipt(id: string): Promise<void> {
  const { data } = await supabase
    .from('receipts')
    .select('image_urls')
    .eq('id', id)
    .single()

  if (data?.image_urls && data.image_urls.length > 0) {
    const paths = data.image_urls
      .map((url: string) => {
        const marker = '/receipt-images/'
        const idx = url.indexOf(marker)
        return idx !== -1 ? url.slice(idx + marker.length) : null
      })
      .filter(Boolean)

    if (paths.length > 0) {
      await supabase.storage.from('receipt-images').remove(paths)
    }
  }

  const { error } = await supabase.from('receipts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── search items with price history ────────────────────────
export async function searchItems(
  query: string,
  brand?: string,
  dateFrom?: string,
  dateTo?: string,
  priceMax?: number,
): Promise<ItemHistory[]> {
  let q = supabase.from('item_purchase_history').select('*')

  if (query.trim()) {
    const isCode  = /^\d+$/.test(query.trim())
    const isPrice = /^\$?[\d.]+$/.test(query.trim()) && query.includes('.')

    if (isCode && !isPrice) {
      q = q.eq('item_code', query.trim())
    } else if (isPrice) {
      const price = parseFloat(query.replace('$',''))
      // show items within ±$1 of the typed price
      q = q.gte('final_price', price - 1).lte('final_price', price + 1)
    } else {
      q = q.ilike('name', `%${query.trim()}%`)
    }
  }

  if (brand && brand !== 'all') q = q.eq('store_name', brand)
  if (dateFrom) q = q.gte('purchase_date', dateFrom)
  if (dateTo)   q = q.lte('purchase_date', dateTo)
  if (priceMax) q = q.lte('final_price', priceMax)

  q = q.order('purchase_date', { ascending: false }).limit(300)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return groupHistory(data ?? [])
}

function groupHistory(rows: any[]): ItemHistory[] {
  const map = new Map<string, ItemHistory>()

  for (const row of rows) {
    const key = row.item_code ? `c:${row.item_code}` : `n:${row.name.toUpperCase()}`

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

  return [...map.values()].sort((a, b) => b.purchases.length - a.purchases.length)
}

// ── stats for dashboard ─────────────────────────────────────
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