import type { ParsedReceipt } from '../lib/types'

export async function parseWithAI(text: string): Promise<ParsedReceipt> {
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `API error ${res.status}`)
  }

  const data = await res.json()
  if (data.error) throw new Error(data.error)

  const brand = normalizeBrand(data.brand, data.store_name ?? '')

  return {
    store: {
      brand,
      name:     normalizeStoreName(brand, data.store_name ?? ''),
      location: data.location ?? undefined,
    },
    purchase_date:  data.purchase_date  ?? undefined,
    purchase_time:  data.purchase_time  ?? undefined,
    transaction_id: data.transaction_id ?? undefined,
    total:          data.total          ?? undefined,
    line_items: (data.items ?? []).map((item: any, i: number) => ({
      item_code:       item.item_code                       ?? undefined,
      name:            item.name                            ?? 'Unknown item',
      original_price:  Number(item.original_price)          || 0,
      discount_amount: Number(item.discount_amount)         || 0,
      final_price:     Math.max(0, Number(item.final_price) || 0),
      sort_order:      i,
    })),
    raw_ocr_text: text,
  }
}

// Canonical display names — always consistent regardless of what AI returns
const CANONICAL_NAMES: Record<string, string> = {
  'costco':      'Costco Wholesale',
  'walmart':     'Walmart',
  'whole-foods': 'Whole Foods Market',
  'ross':        'Ross Dress for Less',
  'target':      'Target',
  'safeway':     'Safeway',
  'trader-joes': "Trader Joe's",
  'kroger':      'Kroger',
  'cvs':         'CVS Pharmacy',
  'walgreens':   'Walgreens',
  'aldi':        'ALDI',
  'home-depot':  'The Home Depot',
  'lowes':       "Lowe's",
}

function normalizeStoreName(brand: string, aiName: string): string {
  // If we have a canonical name for this brand, always use it
  if (CANONICAL_NAMES[brand]) return CANONICAL_NAMES[brand]
  // For 'other' stores use whatever AI returned
  return aiName || 'Unknown Store'
}

function normalizeBrand(aiBrand: string, storeName: string): string {
  const known = Object.keys(CANONICAL_NAMES)
  if (aiBrand && known.includes(aiBrand.toLowerCase())) {
    return aiBrand.toLowerCase()
  }

  // Fallback: detect from store name
  const n = (storeName ?? '').toLowerCase()
  if (n.includes('costco'))       return 'costco'
  if (n.includes('walmart'))      return 'walmart'
  if (n.includes('whole foods'))  return 'whole-foods'
  if (n.includes('ross'))         return 'ross'
  if (n.includes('target'))       return 'target'
  if (n.includes('safeway'))      return 'safeway'
  if (n.includes('trader joe'))   return 'trader-joes'
  if (n.includes('kroger'))       return 'kroger'
  if (n.includes('cvs'))          return 'cvs'
  if (n.includes('walgreens'))    return 'walgreens'
  if (n.includes('aldi'))         return 'aldi'
  if (n.includes('home depot'))   return 'home-depot'
  if (n.includes('lowe'))         return 'lowes'
  return 'other'
}