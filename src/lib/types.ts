export interface Receipt {
  id: string
  brand: string
  store_name: string
  location?: string
  purchase_date: string
  purchase_time?: string
  transaction_id?: string
  total: number
  tax?: number
  paid_by?: string
  source: string              // 'scan' | 'manual' | 'costco_api'
  category?: string
  notes?: string
  itemCount?: number
  totalSavings?: number
  image_urls?: string[]
  raw_ocr_text?: string
  created_at: string
  receipt_items?: ReceiptItem[]
}

export interface ReceiptItem {
  id: string
  receipt_id: string
  item_code?: string
  name: string
  original_price: number
  discount_amount: number
  final_price: number         // negative = returned item
  quantity: number            // -1 = returned, 1 = default, >1 = multi-unit
  sort_order: number
}

export interface ParsedStore {
  brand: string
  name: string
  location?: string
}

export interface ParsedItem {
  item_code?: string
  name: string
  original_price: number
  discount_amount: number
  final_price: number
  sort_order: number
  quantity?: number           // from Costco import; defaults to 1
}

export interface ParsedReceipt {
  store: ParsedStore
  purchase_date?: string
  purchase_time?: string
  transaction_id?: string
  total?: number
  tax?: number
  paid_by?: string
  source?: string             // 'scan' | 'manual' | 'costco_api'
  category?: string
  notes?: string
  line_items: ParsedItem[]
  raw_ocr_text: string
}

export interface ShoppingItem {
  id: string
  text: string
  added_by?: string
  done: boolean
  done_at?: string
  created_at: string
}

export interface Budget {
  id: string
  category: string
  amount: number
  active: boolean
}

export interface RecurringPayment {
  id: string
  recurring_id: string
  paid_by: string
  paid_at: string
  amount: number
}

export interface RecurringBill {
  id: string
  name: string
  amount: number
  frequency: 'monthly' | 'annual' | 'weekly' | 'quarterly'
  due_day?: number      // day of month for monthly (1-31)
  due_date?: string     // specific date for annual (YYYY-MM-DD)
  paid_by: string
  category: string
  notes?: string
  last_paid_at?: string
  active: boolean
  created_at: string
}

// Colors assigned by position — index 0 = first name in NEXT_PUBLIC_PAYERS, etc.
const PAYER_PALETTE: { bg: string; color: string }[] = [
  { bg: '#E8F5EF', color: '#1D6F50' },  // green
  { bg: '#FCE7F3', color: '#9D174D' },  // pink
  { bg: '#EDE9FE', color: '#5B21B6' },  // purple
  { bg: '#DBEAFE', color: '#1D4ED8' },  // blue
  { bg: '#FEF3C7', color: '#92400E' },  // amber
  { bg: '#FEE2E2', color: '#991B1B' },  // red
]

export const PAYERS: readonly string[] = (process.env.NEXT_PUBLIC_PAYERS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

export const PAYER_COLORS: Record<string, { bg: string; color: string }> =
  Object.fromEntries(PAYERS.map((name, i) => [name, PAYER_PALETTE[i % PAYER_PALETTE.length]]))

export interface ItemHistory {
  item_code?: string
  name: string
  purchases: {
    receipt_id: string
    purchase_date: string
    store_name: string
    brand: string
    location?: string
    transaction_id?: string
    original_price: number
    discount_amount: number
    final_price: number
  }[]
  min_price: number
  max_price: number
  latest_price: number
  trend: 'up' | 'down' | 'stable' | 'single'
  max_price_purchase?: {
    receipt_id: string
    purchase_date: string
    store_name: string
    final_price: number
  }
}

export const BRAND_LABELS: Record<string, string> = {
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
  'other':       'Other',
}

// ── Categories ─────────────────────────────────────────────
export const CATEGORIES = [
  'groceries', 'household', 'utilities', 'dining', 'entertainment',
  'clothing', 'electronics', 'pharmacy', 'insurance', 'fuel', 'other',
] as const

export type Category = typeof CATEGORIES[number]

export const CATEGORY_LABELS: Record<string, string> = {
  'groceries':   'Groceries',
  'household':   'Household',
  'utilities':   'Utilities',
  'dining':         'Dining Out',
  'entertainment':  'Entertainment',
  'clothing':       'Clothing',
  'electronics': 'Electronics',
  'pharmacy':    'Pharmacy',
  'insurance':   'Insurance',
  'fuel':        'Fuel',
  'other':       'Other',
}

export const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  'groceries':   { bg: '#E8F5EF', color: '#1D6F50' },
  'household':   { bg: '#FEF3C7', color: '#92400E' },
  'utilities':   { bg: '#E0F2FE', color: '#0369A1' },
  'dining':        { bg: '#FEE8D8', color: '#9A3412' },
  'entertainment': { bg: '#FDF4FF', color: '#7E22CE' },
  'clothing':      { bg: '#EDE9FE', color: '#5B21B6' },
  'electronics': { bg: '#DBEAFE', color: '#1D4ED8' },
  'pharmacy':    { bg: '#CCFBF1', color: '#0F766E' },
  'insurance':   { bg: '#FCE7F3', color: '#9D174D' },
  'fuel':        { bg: '#E2E8F0', color: '#334155' },
  'other':       { bg: '#F3F0EA', color: '#5C574E' },
}

// Auto-suggest category from brand key
export function suggestCategory(brand: string): string {
  const map: Record<string, string> = {
    'costco': 'groceries', 'walmart': 'groceries', 'whole-foods': 'groceries',
    'safeway': 'groceries', 'trader-joes': 'groceries', 'kroger': 'groceries', 'aldi': 'groceries',
    'home-depot': 'household', 'lowes': 'household',
    'ross': 'clothing',
    'cvs': 'pharmacy', 'walgreens': 'pharmacy',
  }
  return map[brand] ?? 'other'
}
