import type { ParsedReceipt } from '../lib/types'

export async function parseWithAI(text: string): Promise<ParsedReceipt> {
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) throw new Error('AI parsing failed')

  const data = await res.json()

  return {
    store: {
      brand:    detectBrand(data.store_name),
      name:     data.store_name ?? 'Unknown Store',
      location: data.location ?? undefined,
    },
    purchase_date:  data.purchase_date  ?? undefined,
    purchase_time:  data.purchase_time  ?? undefined,
    transaction_id: data.transaction_id ?? undefined,
    total:          data.total          ?? undefined,
    line_items:     (data.items ?? []).map((item: any, i: number) => ({
      item_code:       item.item_code    ?? undefined,
      name:            item.name,
      original_price:  item.original_price,
      discount_amount: item.discount_amount ?? 0,
      final_price:     Math.max(0, item.final_price), // never negative
      sort_order:      i,
    })),
    raw_ocr_text: text,
  }
}

function detectBrand(storeName: string): string {
  const n = (storeName ?? '').toLowerCase()
  if (n.includes('costco'))     return 'costco'
  if (n.includes('walmart'))    return 'walmart'
  if (n.includes('whole foods')) return 'whole-foods'
  if (n.includes('ross'))       return 'ross'
  if (n.includes('target'))     return 'target'
  if (n.includes('safeway'))    return 'safeway'
  return 'other'
}