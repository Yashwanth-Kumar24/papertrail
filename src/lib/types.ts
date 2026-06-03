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
  itemCount?: number
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
  tax?: number
  paid_by?: string
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

export const PAYERS = ['Yash', 'Alekhya', 'Pavan'] as const

export const PAYER_COLORS: Record<string, { bg: string; color: string }> = {
  'Yash':    { bg: '#E8F5EF', color: '#1D6F50' },
  'Alekhya': { bg: '#EDE9FE', color: '#5B21B6' },
  'Pavan':   { bg: '#FEF3C7', color: '#92400E' },
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