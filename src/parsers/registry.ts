import type { ReceiptParser } from './types'
import type { ParsedReceipt, ParsedItem } from '../lib/types'
import { costcoParser } from './costco'

const RE_PRICE = /^(.+?)\s{2,}([\d.]+)\s*$/
const RE_DATE  = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/
const RE_TOT   = /total.*?([\d.]+)/i

const genericParser: ReceiptParser = {
  brand: 'other',
  canParse: () => true,
  parse(text): ParsedReceipt {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    let date = '', time = '', total: number | undefined
    const items: ParsedItem[] = []
    let order = 0

    for (const line of lines) {
      const dm = line.match(RE_DATE)
      if (dm && !date) {
        const [m, d, y] = dm[1].split('/')
        date = `${y}-${m}-${d}`; time = dm[2]; continue
      }
      if (/total/i.test(line)) {
        const tm = line.match(RE_TOT)
        if (tm) { total = parseFloat(tm[1]); continue }
      }
      const pm = line.match(RE_PRICE)
      if (pm) {
        const p = parseFloat(pm[2])
        if (p > 0 && p < 10000)
          items.push({ name: pm[1].trim(), original_price: p, discount_amount: 0, final_price: p, sort_order: order++ })
      }
    }

    return {
      store: { brand: 'other', name: lines[0] || 'Unknown Store' },
      purchase_date: date || undefined,
      purchase_time: time || undefined,
      total,
      line_items: items,
      raw_ocr_text: text,
    }
  },
}

const PARSERS: ReceiptParser[] = [costcoParser, genericParser]

export function parseReceipt(text: string): ParsedReceipt {
  const parser = PARSERS.find(p => p.canParse(text)) ?? genericParser
  return parser.parse(text)
}

export function mergeReceipts(base: ParsedReceipt, add: ParsedReceipt): ParsedReceipt {
  const seen = new Set(base.line_items.map(i => i.item_code ? `c:${i.item_code}` : `n:${i.name}`))
  const offset = base.line_items.length
  const newItems = add.line_items
    .filter(i => { const k = i.item_code ? `c:${i.item_code}` : `n:${i.name}`; if (seen.has(k)) return false; seen.add(k); return true })
    .map((i, idx) => ({ ...i, sort_order: offset + idx }))

  return {
    ...base,
    total:       add.total      ?? base.total,
    line_items:  [...base.line_items, ...newItems],
    raw_ocr_text: base.raw_ocr_text + '\n\n---\n\n' + add.raw_ocr_text,
  }
}