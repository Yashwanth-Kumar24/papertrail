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
