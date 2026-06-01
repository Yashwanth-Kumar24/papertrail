import type { ParsedReceipt } from '../lib/types'
import { parseWithAI } from './ai-parser'

export async function parseReceipt(text: string): Promise<ParsedReceipt> {
  return parseWithAI(text)
}

export function mergeReceipts(base: ParsedReceipt, add: ParsedReceipt): ParsedReceipt {
  const seen = new Set(
    base.line_items.map(i => i.item_code ? `c:${i.item_code}` : `n:${i.name}`)
  )
  const offset = base.line_items.length
  const newItems = add.line_items
    .filter(i => {
      const k = i.item_code ? `c:${i.item_code}` : `n:${i.name}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((i, idx) => ({ ...i, sort_order: offset + idx }))

  return {
    ...base,
    total:        add.total ?? base.total,
    line_items:   [...base.line_items, ...newItems],
    raw_ocr_text: base.raw_ocr_text + '\n\n---\n\n' + add.raw_ocr_text,
  }
}