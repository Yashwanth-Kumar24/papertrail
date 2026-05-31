import type { ReceiptParser } from './types'
import type { ParsedReceipt, ParsedItem } from '../lib/types'

function mmddToIso(d: string) {
  const [m, dd, y] = d.split('/')
  return `${y}-${m.padStart(2,'0')}-${dd.padStart(2,'0')}`
}

// Core item pattern — matches anywhere in the line:
// [optional junk] ITEMCODE  NAME  PRICE
// itemcode = 2-8 digits
// name = uppercase words/chars
// price = digits.2digits at end
const RE_ITEM = /(\d{2,8})\s+([A-Z][A-Z0-9,.\s*\/-]{2,28}?)\s{1,}(\d{1,4}\.\d{2})\s*$/

// Discount: 0000xxxxx / itemcode  amount
const RE_DISC = /0{3,}\d+\s*\/\s*(\d{2,8})\s+([\d.]+)/

// Skip lines that are definitely not items
const SKIP = [
  /SUBTOTAL/i, /^\*+\s*TOTAL/i, /^TOTAL\b/i, /^TAX\b/i,
  /^CHANGE/i, /APPROVED/i, /^AMOUNT/i, /TRAN\s+ID/i,
  /^SEQ#/i, /^AID:/i, /COSTCO\s+VISA/i, /COSTCO\s+WALLET/i,
  /PLEASE/i, /THANK/i, /^OP#/i, /CHECKOUT/i,
  /BOB\s+COUNT/i, /^FSA/i, /^X{4,}/i,
  /^WHSE/i, /COSTCO\s+WHOLESALE/i,
  /ITEMS\s+SOLD/i, /NUMBER\s+OF\s+ITEMS/i,
  /INSTANT\s+SAVINGS/i, /^-{3,}/, /^={3,}/,
  /APP#/i, /VISA\s+\d/i, /^\d{2}\/\d{2}\/\d{4}/,
  /PURCHASE/i, /NAME:\s+SCO/i, /TRM:/i, /TRN/i,
]

const shouldSkip = (l: string) =>
  !l || l.length < 6 || SKIP.some(r => r.test(l))

export const costcoParser: ReceiptParser = {
  brand: 'costco',
  canParse: (text) => /COSTCO/i.test(text),

  parse(text): ParsedReceipt {
    const lines = text
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim().toUpperCase())
      .filter(Boolean)

    let storeName = '', location = '', warehouseNum = ''
    let date = '', time = '', txnId = ''
    let total: number | undefined
    const rawItems: ParsedItem[] = []
    let order = 0
    let inItems = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Store name block
      if (/COSTCO WHOLESALE/i.test(line) && !storeName) {
        for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
          const sm = lines[j].match(/^(.+?)\s+#(\d{2,4})/)
          if (sm) {
            storeName = lines[j].trim()
            warehouseNum = sm[2]
            for (let k = j+1; k < Math.min(j+5, lines.length); k++) {
              const cl = lines[k].match(/([A-Z][A-Z\s]{2,}),?\s+([A-Z]{2})\s+\d{5}/)
              if (cl) { location = `${cl[1].trim()}, ${cl[2]}`; break }
            }
            break
          }
        }
        continue
      }

      // Member line — start of items section
      if (/MEMB|NEMB/i.test(line) && /\d{6,}/.test(line)) {
        inItems = true
        continue
      }

      // Date + time
      const dm = line.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/)
      if (dm && !date) {
        date = mmddToIso(dm[1])
        time = dm[2]
        continue
      }

      // Transaction ID — handles ID%: ID#: ID:
      const tm = line.match(/TRAN\s+ID[#%:]?\s*([\d.]+)/i)
      if (tm) {
        txnId = tm[1].replace(/\./g, '').replace(/\s/g,'')
        continue
      }

      // Total — **** TOTAL or GE WX TOTAL [XT BE] won't match (good)
      const totm = line.match(/\*{2,}\s*TOTAL\s+([\d.]+)/)
      if (totm) { total = parseFloat(totm[1]); continue }

      // Amount line fallback for total
      const amtm = line.match(/^AMOUNT:\s*\$?([\d.]+)/)
      if (amtm && !total) { total = parseFloat(amtm[1]); continue }

      if (shouldSkip(line)) continue

      // Discount line
      const disc = line.match(RE_DISC)
      if (disc) {
        const amt = parseFloat(disc[2])
        rawItems.push({
          item_code: disc[1],
          name: `Discount on ${disc[1]}`,
          original_price: 0, discount_amount: amt, final_price: -amt, sort_order: order++,
        })
        continue
      }

      // Item line — match anywhere in the line
      const im = line.match(RE_ITEM)
      if (im) {
        const code  = im[1]
        const name  = im[2].trim()
        const price = parseFloat(im[3])

        // Sanity: item code shouldn't be all same digits, price > 0
        if (price > 0 && price < 10000 && !/^(\d)\1+$/.test(code)) {
          rawItems.push({
            item_code: code, name,
            original_price: price, discount_amount: 0, final_price: price,
            sort_order: order++,
          })
        }
      }
    }

    // Apply discounts to their target items
    const items: ParsedItem[] = []
    for (const item of rawItems) {
      if (item.discount_amount < 0) {
        const target = items.find(i => i.item_code === item.item_code)
        if (target) {
          target.discount_amount = Math.abs(item.discount_amount)
          target.final_price = parseFloat(
            (target.original_price - target.discount_amount).toFixed(2)
          )
          continue
        }
      }
      items.push(item)
    }
    
    // Fallback: extract city from storeName e.g. "REDMOND #1225" → "Redmond"
    if (!location && storeName) {
      const cityMatch = storeName.match(/^([A-Z][A-Z\s]+?)\s+#\d+/)
      if (cityMatch) {
        location = cityMatch[1].trim()
          .split(' ')
          .map((w: string) => w.charAt(0) + w.slice(1).toLowerCase())
          .join(' ')
      }
    }

    return {
      store: {
        brand: 'costco',
        name: storeName || 'Costco Wholesale',
        location: location || undefined,
      },
      purchase_date:  date  || undefined,
      purchase_time:  time  || undefined,
      transaction_id: txnId || undefined,
      total,
      line_items: items,
      raw_ocr_text: text,
    }
  },
}