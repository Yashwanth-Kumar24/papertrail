import type { ParsedReceipt, ParsedItem } from '../lib/types'
import { parseWithAI } from './ai-parser'

export async function parseReceipt(text: string): Promise<ParsedReceipt> {
  return parseWithAI(text)
}

export interface MergeResult {
  receipt: ParsedReceipt
  duplicatesDropped: number
}

// A duplicate line can only be real if it's a re-photographed overlap at the seam
// between two sections — the AI parser is explicitly told to emit repeat items as
// separate rows within one photo (see api/parse PROMPT rule #6), so a receipt can
// legitimately list the same item_code/name twice. We only dedupe within a small
// window on either side of the seam, keyed on price too, instead of across the
// whole receipt — matching every other item, however far apart, is kept.
const OVERLAP_WINDOW = 5

function dupeKey(i: ParsedItem): string {
  return i.item_code ? `c:${i.item_code}:${i.final_price}` : `n:${i.name}:${i.final_price}`
}

export function mergeReceipts(base: ParsedReceipt, add: ParsedReceipt): MergeResult {
  const boundary = base.line_items.slice(-OVERLAP_WINDOW)
  const seen = new Set(boundary.map(dupeKey))
  const offset = base.line_items.length
  let duplicatesDropped = 0

  const newItems = add.line_items
    .filter((i, idx) => {
      // Only items near the new section's own leading edge can be seam duplicates —
      // anything further in is definitely a distinct line and is always kept.
      if (idx >= OVERLAP_WINDOW) return true
      if (seen.has(dupeKey(i))) { duplicatesDropped++; return false }
      return true
    })
    .map((i, idx) => ({ ...i, sort_order: offset + idx }))

  const receipt: ParsedReceipt = {
    ...base,
    total:          base.total          ?? add.total,
    tax:            base.tax            ?? add.tax,
    transaction_id: base.transaction_id ?? add.transaction_id,
    purchase_date:  base.purchase_date  ?? add.purchase_date,
    purchase_time:  base.purchase_time  ?? add.purchase_time,
    line_items:     [...base.line_items, ...newItems],
    raw_ocr_text:   base.raw_ocr_text + '\n\n---\n\n' + add.raw_ocr_text,
  }

  return { receipt, duplicatesDropped }
}