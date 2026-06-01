export interface Receipt {
  id: string
  brand: string
  store_name: string
  location?: string
  purchase_date: string
  purchase_time?: string
  transaction_id?: string
  total: number
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
  final_price: number
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
}

export interface ParsedReceipt {
  store: ParsedStore
  purchase_date?: string
  purchase_time?: string
  transaction_id?: string
  total?: number
  line_items: ParsedItem[]
  raw_ocr_text: string
}

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