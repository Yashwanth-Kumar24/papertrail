import type { ParsedReceipt } from '../lib/types'

export interface ReceiptParser {
  brand: string
  canParse(text: string): boolean
  parse(text: string): ParsedReceipt
}