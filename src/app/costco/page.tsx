'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { saveReceipt } from '@/lib/queries'
import { PAYERS, PAYER_COLORS } from '@/lib/types'
import type { ParsedReceipt } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────
interface ListReceipt {
  warehouseName:       string
  receiptType:         string
  transactionDateTime: string
  transactionBarcode:  string
  total:               number
  totalItemCount:      number
  instantSavings?:     number
  tenderArray?:        Tender[]
}

interface DetailReceipt {
  warehouseName:        string
  transactionDate:      string
  transactionDateTime?: string
  transactionBarcode?:  string
  total:                number
  subTotal:             number
  taxes:                number
  instantSavings:       number
  membershipNumber?:    string
  warehouseAddress1?:   string
  warehouseCity?:       string
  warehouseState?:      string
  warehousePostalCode?: string
  totalItemCount?:      number
  itemArray:            CostcoItem[]
  tenderArray:          Tender[]
}

interface CostcoItem {
  itemNumber:           string
  itemDescription01:    string
  itemDescription02?:   string
  unit:                 number
  amount:               number
  itemUnitPriceAmount:  number
}

interface Tender {
  tenderDescription:     string
  amountTender:          number
  displayAccountNumber?: string
}

interface Quarter { text: string; startDate: string; endDate: string }

interface ImportProgress {
  current:       number
  total:         number
  stage:         'fetching' | 'saving'
  warehouseName: string
}

interface FailedReceipt {
  barcode:  string
  label:    string   // warehouse name + date for display
  reason:   string   // actual error message
}

interface ImportResult {
  imported: number
  skipped:  number
  failed:   number
  failures: FailedReceipt[]
}

// ── Quarter generation ─────────────────────────────────────
function generateQuarters(): Quarter[] {
  const now   = new Date()
  const endDays: Record<number, number> = { 3:31, 6:30, 9:30, 12:31 }
  const pad   = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getMonth()+1}/${pad(now.getDate())}/${now.getFullYear()}`

  let year = now.getFullYear()
  let q    = Math.floor(now.getMonth() / 3)
  const result: Quarter[] = []

  for (let i = 0; i < 10; i++) {
    const sm = q * 3 + 1
    const em = sm + 2
    result.push({
      text:      i === 0 ? 'This Quarter' : `Q${q + 1} ${year}`,
      startDate: `${sm}/01/${year}`,
      endDate:   i === 0 ? today : `${em}/${endDays[em]}/${year}`,
    })
    if (--q < 0) { q = 3; year-- }
  }
  return result
}

const QUARTERS = generateQuarters()

// ── Helpers ────────────────────────────────────────────────
// Proper-case an all-caps Costco address part; state abbreviation stays all-caps
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
function fmtLocation(address?: string, city?: string, state?: string): string {
  return [address && titleCase(address), city && titleCase(city), state?.toUpperCase()]
    .filter(Boolean).join(', ')
}

const money   = (n: number) => `$${Math.abs(Number(n)).toFixed(2)}`
const moneyRaw = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Number(n)).toFixed(2)}`
const fmtDate = (dt: string) => {
  const d = dt?.includes('T') ? new Date(dt) : new Date((dt ?? '') + 'T00:00:00')
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}
const fmtTime = (dt?: string) => {
  if (!dt?.includes('T')) return ''
  const d = new Date(dt)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
}

type ProcessedItem = { item_code?: string; name: string; original_price: number; discount_amount: number; final_price: number; quantity: number; sort_order: number }

// ── Unit price extraction ──────────────────────────────────
// Always store per-unit price so price alerts compare correctly regardless of quantity.
function unitPrice(item: CostcoItem): number {
  const qty = Math.abs(Number(item.unit) || 1)
  // itemUnitPriceAmount is the authoritative unit price from Costco
  if (Number(item.itemUnitPriceAmount) > 0) return Number(item.itemUnitPriceAmount)
  // Fallback: derive from line total ÷ quantity
  return Math.abs(Number(item.amount)) / qty
}

// ── Item processing ────────────────────────────────────────
function processItems(itemArray: CostcoItem[], isReturn: boolean): ProcessedItem[] {
  if (isReturn) {
    // Return receipt: store per-unit prices; final_price is negative to signal return
    return itemArray.map((item, i) => {
      const up  = unitPrice(item)
      const qty = Number(item.unit) || 1   // -1 for returned items, 1 for adjustments
      return {
        item_code:       item.itemNumber || undefined,
        name:            item.itemDescription01 || item.itemNumber,
        original_price:  up,
        discount_amount: 0,
        final_price:     qty < 0 ? -up : up,  // negative signals return; groupHistory filters these out
        quantity:        qty,
        sort_order:      i,
      }
    })
  }

  // Purchase: store per-unit prices; merge savings lines into preceding item
  const result: ProcessedItem[] = []
  let sortIdx = 0
  for (let i = 0; i < itemArray.length; i++) {
    const item   = itemArray[i]
    const amount = Number(item.amount)

    if (amount < 0 && result.length > 0) {
      // Savings line — divide by preceding item's quantity to get per-unit discount
      const prev        = result[result.length - 1]
      const discPerUnit = Math.abs(amount) / (prev.quantity || 1)
      prev.discount_amount  = parseFloat((prev.discount_amount + discPerUnit).toFixed(4))
      prev.final_price      = parseFloat((prev.original_price - prev.discount_amount).toFixed(4))
    } else if (amount >= 0) {
      const up  = unitPrice(item)
      const qty = Math.max(1, Number(item.unit) || 1)
      result.push({
        item_code:       item.itemNumber || undefined,
        name:            item.itemDescription01 || item.itemNumber,
        original_price:  up,
        discount_amount: 0,
        final_price:     up,
        quantity:        qty,
        sort_order:      sortIdx++,
      })
    }
  }
  return result
}

// ── Convert Costco detail → ParsedReceipt ─────────────────
function toParsedReceipt(detail: DetailReceipt, barcode: string, paidBy: string): ParsedReceipt {
  const isReturn = Number(detail.total) < 0
  const location = fmtLocation(detail.warehouseAddress1, detail.warehouseCity, detail.warehouseState)
  const timeStr  = detail.transactionDateTime?.includes('T')
    ? detail.transactionDateTime.split('T')[1]?.slice(0, 8)
    : undefined

  return {
    store:          { brand: 'costco', name: 'Costco Wholesale', location: location || undefined },
    purchase_date:  detail.transactionDate,
    purchase_time:  timeStr,
    transaction_id: barcode,
    total:          Number(detail.total),
    tax:            Number(detail.taxes) || undefined,
    paid_by:        paidBy,
    source:         'costco_api',
    category:       'groceries',
    line_items:     processItems(detail.itemArray, isReturn),
    raw_ocr_text:   '',
  }
}

// ── Token bar ──────────────────────────────────────────────
function TokenBar({ token, onSet }: { token: string; onSet: (t: string) => void }) {
  const [input,    setInput]    = useState('')
  const [expanded, setExpanded] = useState(!token)

  return (
    <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'14px 16px',marginBottom:16}}>
      {expanded ? (
        <>
          <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:4}}>🔑 Paste your Costco Bearer token</div>
          <div style={{fontSize:11,color:'var(--ink3)',marginBottom:10,lineHeight:1.6}}>
            costco.com → DevTools (F12) → Network tab → filter <code style={{background:'var(--cream2)',padding:'1px 4px',borderRadius:3}}>graphql</code> → click any request → Request Headers → copy <code style={{background:'var(--cream2)',padding:'1px 4px',borderRadius:3}}>costco-x-authorization</code>
          </div>
          <div style={{display:'flex',gap:8}}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && input.trim()) { onSet(input.trim()); setExpanded(false); setInput('') } }}
              placeholder="Bearer eyJhbGciOiJSUzI1NiIs…"
              style={{flex:1,fontSize:11,padding:'7px 10px',border:'1px solid var(--border2)',borderRadius:'var(--r)',fontFamily:'var(--mono)',background:'var(--cream)'}}
            />
            <button
              onClick={() => { if (!input.trim()) return; onSet(input.trim()); setExpanded(false); setInput('') }}
              disabled={!input.trim()}
              className="btn-primary"
              style={{fontSize:13,padding:'7px 16px',flexShrink:0}}
            >Set token</button>
          </div>
          <div style={{fontSize:11,color:'var(--ink3)',marginTop:6}}>
            Expires in ~15 min · Session only — never stored in database
          </div>
        </>
      ) : (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',display:'inline-block',flexShrink:0}}/>
            <span style={{fontSize:13,color:'var(--ink2)'}}>Token active — expires in ~15 min</span>
          </div>
          <button onClick={() => setExpanded(true)} style={{fontSize:12,color:'var(--ink2)',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>
            Update
          </button>
        </div>
      )}
    </div>
  )
}

// ── Import modal ───────────────────────────────────────────
function ImportModal({
  receipts, paidBy, onPaidByChange, onConfirm, onCancel, progress, result, onDone,
}: {
  receipts:        ListReceipt[]
  paidBy:          string
  onPaidByChange:  (p: string) => void
  onConfirm:       () => void
  onCancel:        () => void
  progress:        ImportProgress | null
  result:          ImportResult | null
  onDone:          () => void
}) {
  const isReturn = (r: ListReceipt) => Number(r.total) < 0
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:12,padding:'24px 28px',maxWidth:480,width:'100%',maxHeight:'80vh',overflowY:'auto'}}>

        {/* Result view */}
        {result && (
          <>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>Import complete</h3>
            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:20}}>
              {result.imported > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--cream2)',borderRadius:'var(--r)'}}>
                  <span style={{fontSize:20}}>✓</span>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>{result.imported} receipt{result.imported !== 1 ? 's' : ''} imported</div>
                    <div style={{fontSize:12,color:'var(--ink2)'}}>Now visible in Receipts, Spending, and Items</div>
                  </div>
                </div>
              )}
              {result.skipped > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'#FEF3C7',borderRadius:'var(--r)'}}>
                  <span style={{fontSize:20}}>↷</span>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>{result.skipped} skipped</div>
                    <div style={{fontSize:12,color:'#92400E'}}>Already in the app</div>
                  </div>
                </div>
              )}
              {result.failed > 0 && (
                <div style={{background:'var(--red-bg)',borderRadius:'var(--r)',overflow:'hidden'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px'}}>
                    <span style={{fontSize:20}}>✕</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:14,color:'var(--red-tx)'}}>{result.failed} failed</div>
                      <div style={{fontSize:12,color:'var(--red-tx)'}}>Re-import safely — already saved receipts are skipped automatically</div>
                    </div>
                  </div>
                  {result.failures.length > 0 && (
                    <div style={{borderTop:'1px solid rgba(0,0,0,0.08)',padding:'8px 14px',display:'flex',flexDirection:'column',gap:4}}>
                      {result.failures.map((f, i) => (
                        <div key={i} style={{fontSize:11,color:'var(--red-tx)'}}>
                          <span style={{fontWeight:600}}>{f.label}</span>
                          <span style={{opacity:0.7}}> — {f.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={onDone} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                Done
              </button>
              <Link href="/receipts" style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer',color:'var(--green)',fontWeight:500,textDecoration:'none',display:'inline-flex',alignItems:'center'}}>
                View in Receipts →
              </Link>
            </div>
          </>
        )}

        {/* Progress view */}
        {progress && !result && (
          <>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:16}}>Importing…</h3>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,color:'var(--ink2)',marginBottom:8}}>
                {progress.stage === 'fetching' ? 'Fetching' : 'Saving'} {progress.warehouseName} · {progress.current} of {progress.total}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{width:`${(progress.current / progress.total) * 100}%`,transition:'width .3s'}}/>
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--ink3)'}}>
              Re-running is safe — already imported receipts are skipped automatically
            </div>
          </>
        )}

        {/* Confirm view */}
        {!progress && !result && (
          <>
            <h3 style={{fontSize:16,fontWeight:600,marginBottom:4}}>
              Import {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} to PaperTrail
            </h3>
            <p style={{fontSize:13,color:'var(--ink2)',marginBottom:16}}>Already-imported receipts are automatically skipped.</p>

            {/* Receipt list */}
            <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:16,maxHeight:220,overflowY:'auto'}}>
              {receipts.map(r => (
                <div key={r.transactionBarcode} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',background:'var(--cream)',borderRadius:'var(--r)',fontSize:13}}>
                  <div>
                    <span style={{fontWeight:500}}>Costco {r.warehouseName}</span>
                    <span style={{color:'var(--ink3)',marginLeft:8}}>{fmtDate(r.transactionDateTime)}</span>
                    {isReturn(r) && (
                      <span style={{marginLeft:8,fontSize:10,fontWeight:700,background:'var(--red-bg)',color:'var(--red-tx)',padding:'1px 6px',borderRadius:999}}>REFUND</span>
                    )}
                  </div>
                  <span style={{fontFamily:'var(--mono)',fontWeight:600,color:isReturn(r) ? 'var(--red-tx)' : 'inherit'}}>
                    {isReturn(r) ? '−' : ''}{money(r.total)}
                  </span>
                </div>
              ))}
            </div>

            {/* Paid by */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--ink2)',marginBottom:8}}>
                Paid by <span style={{color:'var(--red)',fontSize:10}}>required</span>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {PAYERS.map(p => (
                  <button
                    key={p}
                    onClick={() => onPaidByChange(p)}
                    style={{
                      padding:'6px 16px',borderRadius:999,fontSize:13,fontWeight:600,cursor:'pointer',border:'2px solid',
                      borderColor:  paidBy === p ? (PAYER_COLORS[p]?.color ?? 'var(--border2)') : 'var(--border)',
                      background:   paidBy === p ? (PAYER_COLORS[p]?.bg    ?? 'var(--cream2)') : 'transparent',
                      color:        paidBy === p ? (PAYER_COLORS[p]?.color  ?? 'var(--ink)')   : 'var(--ink2)',
                    }}
                  >{p}</button>
                ))}
              </div>
            </div>

            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={onCancel} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button
                onClick={onConfirm}
                disabled={!paidBy}
                style={{padding:'8px 20px',borderRadius:8,border:'none',background:paidBy?'var(--green)':'var(--border)',color:'#fff',fontSize:13,fontWeight:600,cursor:paidBy?'pointer':'not-allowed'}}
              >
                Import {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Receipt detail view ────────────────────────────────────
function ReceiptDetail({
  detail, barcode, onBack, onImport,
}: {
  detail:    DetailReceipt
  barcode:   string
  onBack:    () => void
  onImport:  () => void
}) {
  const isReturn = Number(detail.total) < 0
  const loc      = fmtLocation(detail.warehouseAddress1, detail.warehouseCity, detail.warehouseState)
  const hasQty   = detail.itemArray.some(i => Math.abs(Number(i.unit)) !== 1)
  const isAdj    = (item: CostcoItem) => (item.itemDescription01 || '').trim().startsWith('/')

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,gap:10,flexWrap:'wrap'}}>
        <button onClick={onBack} className="back-link">← Back to list</button>
        <button
          onClick={onImport}
          style={{padding:'7px 16px',borderRadius:8,border:'none',background:'#005DAA',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}
        >
          ↓ Import to App
        </button>
      </div>

      {isReturn && (
        <div style={{padding:'10px 14px',background:'#FEF3C7',color:'#92400E',borderRadius:'var(--r)',fontSize:13,fontWeight:500,marginBottom:16}}>
          ↩ Return Receipt — {money(detail.total)} refunded
          {detail.tenderArray[0] ? ` to ${detail.tenderArray[0].tenderDescription}${detail.tenderArray[0].displayAccountNumber ? ` ••••${detail.tenderArray[0].displayAccountNumber}` : ''}` : ''}
        </div>
      )}

      <div className="detail-wrap">
        <div className="detail-side">
          <h2>Costco {detail.warehouseName}</h2>
          {loc && <div className="meta-row"><span className="meta-label">Location</span><span style={{textAlign:'right',fontSize:12}}>{loc}</span></div>}
          {detail.warehousePostalCode && <div className="meta-row"><span className="meta-label">Zip</span><span className="meta-val">{detail.warehousePostalCode}</span></div>}
          <div className="meta-row"><span className="meta-label">Date</span><span>{fmtDate(detail.transactionDate)}</span></div>
          {detail.transactionDateTime && fmtTime(detail.transactionDateTime) && (
            <div className="meta-row"><span className="meta-label">Time</span><span className="meta-val">{fmtTime(detail.transactionDateTime)}</span></div>
          )}
          <div className="meta-row"><span className="meta-label">Items</span><span>{detail.itemArray.length}</span></div>
          <div className="meta-row"><span className="meta-label">Subtotal</span><span style={{fontFamily:'var(--mono)',color:isReturn?'var(--red-tx)':'inherit'}}>{moneyRaw(detail.subTotal)}</span></div>
          {Number(detail.taxes) !== 0 && <div className="meta-row"><span className="meta-label">Tax</span><span style={{fontFamily:'var(--mono)',color:isReturn?'var(--red-tx)':'inherit'}}>{moneyRaw(detail.taxes)}</span></div>}
          {detail.instantSavings > 0 && <div className="meta-row"><span className="meta-label">Saved</span><span style={{fontFamily:'var(--mono)',color:'var(--green)',fontWeight:600}}>{money(detail.instantSavings)}</span></div>}
          <div className="meta-row"><span className="meta-label">Total</span><span style={{fontFamily:'var(--mono)',fontWeight:700,color:isReturn?'var(--red-tx)':'inherit'}}>{moneyRaw(detail.total)}</span></div>
          {detail.tenderArray.map((t, i) => (
            <div key={i} className="meta-row">
              <span className="meta-label">{i === 0 ? 'Payment' : ''}</span>
              <span style={{fontSize:12,textAlign:'right'}}>{t.tenderDescription}{t.displayAccountNumber ? ` ••••${t.displayAccountNumber}` : ''} {moneyRaw(t.amountTender)}</span>
            </div>
          ))}
          {detail.membershipNumber && <div className="meta-row"><span className="meta-label">Member #</span><span style={{fontFamily:'var(--mono)',fontSize:11}}>{detail.membershipNumber}</span></div>}
          <div className="meta-row" style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)'}}>
            <span className="meta-label" style={{fontSize:10}}>Barcode</span>
            <span style={{fontFamily:'var(--mono)',fontSize:10,wordBreak:'break-all',textAlign:'right',color:'var(--ink3)'}}>{barcode}</span>
          </div>
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                {hasQty && <th style={{textAlign:'right'}}>Qty</th>}
                <th style={{textAlign:'right'}}>Unit</th>
                <th style={{textAlign:'right'}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.itemArray.map((item, i) => {
                const returned = Number(item.amount) < 0 && Number(item.unit) < 0
                const adj      = isAdj(item)
                return (
                  <tr key={i} style={{opacity: adj ? 0.55 : 1}}>
                    <td><span className="code-badge" style={{fontStyle: adj ? 'italic' : 'normal'}}>{item.itemNumber}</span></td>
                    <td>
                      <div style={{fontWeight: returned ? 400 : 500, color: returned ? 'var(--red-tx)' : adj ? 'var(--ink2)' : 'inherit'}}>
                        {item.itemDescription01}
                      </div>
                      {item.itemDescription02 && <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>{item.itemDescription02}</div>}
                      {returned && <div style={{fontSize:10,fontWeight:600,color:'var(--red-tx)',marginTop:2}}>RETURNED</div>}
                      {adj && <div style={{fontSize:10,color:'var(--ink3)',marginTop:1}}>adjustment</div>}
                    </td>
                    {hasQty && <td style={{textAlign:'right',fontFamily:'var(--mono)',color:returned?'var(--red-tx)':'inherit'}}>{item.unit}</td>}
                    <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{item.itemUnitPriceAmount > 0 ? money(item.itemUnitPriceAmount) : '—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:returned?'var(--red-tx)':adj?'var(--ink2)':'inherit'}}>
                      {moneyRaw(item.amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────
export default function CostcoPage() {
  const [token,         setToken]         = useState('')
  const [quarter,       setQuarter]       = useState<Quarter>(QUARTERS[0])
  const [receipts,      setReceipts]      = useState<ListReceipt[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [detail,        setDetail]        = useState<DetailReceipt | null>(null)
  const [activeBarcode, setActiveBarcode] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState('')
  const [detailCache,   setDetailCache]   = useState<Record<string, DetailReceipt>>({})

  // Selection + import state
  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [importModalOpen,setImportModalOpen] = useState(false)
  const [importPaidBy,   setImportPaidBy]   = useState<string>(PAYERS[0] ?? '')
  const [importing,      setImporting]      = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importResult,   setImportResult]   = useState<ImportResult | null>(null)

  // Load token from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('costco_token')
    if (saved) setToken(saved)
  }, [])

  function handleSetToken(t: string) {
    const full = t.startsWith('Bearer ') ? t : `Bearer ${t}`
    setToken(full)
    sessionStorage.setItem('costco_token', full)
    setError('')
  }

  const fetchList = useCallback(async (q: Quarter, t: string) => {
    if (!t) return
    setLoading(true); setError(''); setReceipts([])
    setDetail(null); setActiveBarcode(''); setDetailError(''); setSelected(new Set())
    try {
      const res  = await fetch('/api/costco', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ type:'list', token:t, startDate:q.startDate, endDate:q.endDate }),
      })
      const json = await res.json()
      if (!res.ok || json.error) { setError(json.error ?? 'Failed to fetch receipts.'); return }
      setReceipts(json.data?.receiptsWithCounts?.receipts ?? [])
    } catch { setError('Network error — check your connection.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (token) fetchList(quarter, token) }, [quarter, token, fetchList])

  async function fetchDetail(barcode: string): Promise<DetailReceipt | null> {
    if (detailCache[barcode]) return detailCache[barcode]
    const res  = await fetch('/api/costco', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ type:'detail', token, barcode }),
    })
    const json = await res.json()
    if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load receipt.')
    const d = json.data?.receiptsWithCounts?.receipts?.[0] ?? null
    if (d) setDetailCache(prev => ({ ...prev, [barcode]: d }))
    return d
  }

  async function openDetail(barcode: string) {
    if (detailLoading) return
    setActiveBarcode(barcode); setDetailLoading(true); setDetailError(''); setDetail(null)
    try {
      const d = await fetchDetail(barcode)
      if (d) setDetail(d)
      else { setDetailError('Receipt detail not found.'); setActiveBarcode('') }
    } catch (e: any) {
      setDetailError(e.message ?? 'Network error.'); setActiveBarcode('')
    } finally { setDetailLoading(false) }
  }

  function closeDetail() { setDetail(null); setActiveBarcode(''); setDetailError('') }

  function toggleSelect(barcode: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(barcode) ? next.delete(barcode) : next.add(barcode)
      return next
    })
  }

  function selectAll() { setSelected(new Set(receipts.map(r => r.transactionBarcode))) }
  function clearAll()  { setSelected(new Set()) }

  // ── Import pipeline ──────────────────────────────────────
  async function runImport() {
    setImporting(true)
    const barcodes = [...selected]
    let imported = 0, skipped = 0, failed = 0, importedTotal = 0
    const failures: FailedReceipt[] = []

    for (let i = 0; i < barcodes.length; i++) {
      const barcode     = barcodes[i]
      const listReceipt = receipts.find(r => r.transactionBarcode === barcode)
      const label       = listReceipt
        ? `${listReceipt.warehouseName} · ${listReceipt.transactionDateTime?.slice(0,10) ?? barcode}`
        : barcode

      setImportProgress({
        current: i + 1, total: barcodes.length,
        stage: 'fetching',
        warehouseName: listReceipt?.warehouseName ?? barcode,
      })

      // Small delay to avoid Costco rate-limiting on bulk imports
      if (i > 0) await new Promise(r => setTimeout(r, 300))

      let d: DetailReceipt | null = null
      try {
        d = await fetchDetail(barcode)
      } catch (e: any) {
        const reason = e.message ?? 'Unknown error'
        if (reason.includes('expired') || reason.includes('401')) {
          setError('Token expired during import. Paste a fresh token and re-import — already saved receipts will be skipped automatically.')
          failures.push({ barcode, label, reason: 'Token expired (401)' })
          failed++
          break
        }
        failures.push({ barcode, label, reason })
        failed++; continue
      }

      if (!d) {
        failures.push({ barcode, label, reason: 'No detail data returned from Costco API' })
        failed++; continue
      }

      setImportProgress(prev => prev ? { ...prev, stage:'saving' } : null)

      const parsed = toParsedReceipt(d, barcode, importPaidBy)
      try {
        await saveReceipt(parsed)
        imported++
        if (Number(d.total) > 0) importedTotal += Number(d.total)
      } catch (e: any) {
        if (e.message?.includes('already saved')) skipped++
        else {
          failures.push({ barcode, label, reason: e.message ?? 'Save failed' })
          failed++
        }
      }
    }

    // One summary notification — no per-receipt spam
    if (imported > 0) {
      fetch('/api/notify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Costco receipts imported',
          body:  `${importPaidBy} imported ${imported} Costco receipt${imported !== 1 ? 's' : ''} · $${importedTotal.toFixed(2)}`,
          url:   '/receipts',
        }),
      }).catch(() => {})
    }

    setImporting(false)
    setImportProgress(null)
    setImportResult({ imported, skipped, failed, failures })
  }

  function closeModal() {
    if (importing) return
    setImportModalOpen(false)
    setImportResult(null)
    setImportProgress(null)
    setSelected(new Set())
  }

  // ── Derived stats ────────────────────────────────────────
  const totalSpent  = receipts.filter(r => Number(r.total) > 0).reduce((s,r) => s + Number(r.total), 0)
  const totalRefund = receipts.filter(r => Number(r.total) < 0).reduce((s,r) => s + Math.abs(Number(r.total)), 0)
  const totalSaved  = receipts.reduce((s,r) => s + Number(r.instantSavings ?? 0), 0)
  const selectedList = receipts.filter(r => selected.has(r.transactionBarcode))

  return (
    <main className="page">
      {/* Import modal */}
      {importModalOpen && (
        <ImportModal
          receipts={selectedList}
          paidBy={importPaidBy}
          onPaidByChange={setImportPaidBy}
          onConfirm={runImport}
          onCancel={closeModal}
          progress={importProgress}
          result={importResult}
          onDone={closeModal}
        />
      )}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <Link href="/receipts" className="back-link">← Receipts</Link>
      </div>
      <div className="pg-head" style={{marginBottom:16}}>
        <div>
          <span className="pg-title">Costco Receipts</span>
          <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>Pulled directly from your Costco account</div>
        </div>
      </div>

      <TokenBar token={token} onSet={handleSetToken}/>

      {token && (
        <>
          {/* Quarter picker */}
          <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
            {QUARTERS.map(q => (
              <button
                key={q.startDate}
                onClick={() => setQuarter(q)}
                style={{
                  fontSize:12, padding:'4px 12px', borderRadius:999,
                  border:'1px solid var(--border2)',
                  background: quarter.startDate === q.startDate ? 'var(--green)' : 'transparent',
                  color:      quarter.startDate === q.startDate ? '#fff' : 'var(--ink2)',
                  fontWeight: quarter.startDate === q.startDate ? 600 : 400,
                  cursor:'pointer', fontFamily:'var(--sans)',
                }}
              >{q.text}</button>
            ))}
          </div>

          {error && <div style={{padding:'10px 14px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13,marginBottom:12}}>{error}</div>}
          {loading && <div className="empty"><p style={{color:'var(--ink3)'}}>Fetching from Costco…</p></div>}
          {detailError && <div style={{padding:'10px 14px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13,marginBottom:12}}>{detailError}</div>}

          {/* Detail view */}
          {!loading && detail && (
            <ReceiptDetail
              detail={detail}
              barcode={activeBarcode}
              onBack={closeDetail}
              onImport={() => {
                setSelected(new Set([activeBarcode]))
                setImportModalOpen(true)
              }}
            />
          )}

          {/* List view */}
          {!loading && !detail && receipts.length > 0 && (
            <>
              {/* Stats */}
              <div className="stat-grid" style={{marginBottom:16}}>
                <div className="stat-card"><div className="stat-label">Receipts</div><div className="stat-val">{receipts.length}</div></div>
                <div className="stat-card"><div className="stat-label">Total spent</div><div className="stat-val" style={{fontSize:18}}>${totalSpent.toFixed(2)}</div></div>
                {totalRefund > 0 && <div className="stat-card"><div className="stat-label">Refunded</div><div className="stat-val" style={{fontSize:18,color:'var(--red-tx)'}}>${totalRefund.toFixed(2)}</div></div>}
                {totalSaved > 0 && <div className="stat-card"><div className="stat-label">Saved</div><div className="stat-val" style={{fontSize:18,color:'var(--green)'}}>${totalSaved.toFixed(2)}</div></div>}
              </div>

              {/* Selection toolbar */}
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexWrap:'wrap'}}>
                {selected.size < receipts.length && (
                  <button onClick={selectAll} style={{fontSize:12,color:'var(--ink2)',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 12px',cursor:'pointer',flexShrink:0}}>
                    Select all {receipts.length}
                  </button>
                )}
                {selected.size > 0 && (
                  <>
                    <span style={{fontSize:12,color:'var(--ink2)'}}>
                      <strong>{selected.size}</strong> of {receipts.length} selected
                    </span>
                    <button onClick={clearAll} style={{fontSize:12,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',padding:0}}>
                      Clear
                    </button>
                  </>
                )}
              </div>

              {/* Import action bar */}
              {selected.size > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'#EBF3FB',borderRadius:'var(--r)',marginBottom:12,border:'1px solid #C5DCEF'}}>
                  <span style={{fontSize:13,color:'#005DAA',flex:1,fontWeight:500}}>
                    {selected.size} receipt{selected.size !== 1 ? 's' : ''} selected
                  </span>
                  <button onClick={clearAll} style={{fontSize:12,background:'none',border:'none',color:'#005DAA',cursor:'pointer',opacity:.7}}>Cancel</button>
                  <button
                    onClick={() => setImportModalOpen(true)}
                    style={{fontSize:13,fontWeight:600,padding:'5px 16px',borderRadius:6,border:'none',background:'#005DAA',color:'#fff',cursor:'pointer'}}
                  >
                    ↓ Import {selected.size}
                  </button>
                </div>
              )}

              {/* Receipt rows */}
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {receipts.map(r => {
                  const isReturn    = Number(r.total) < 0
                  const isLoading   = detailLoading && activeBarcode === r.transactionBarcode
                  const isSelected  = selected.has(r.transactionBarcode)
                  return (
                    <div
                      key={r.transactionBarcode}
                      onClick={() => openDetail(r.transactionBarcode)}
                      style={{
                        background:'#fff',
                        border:`1px solid ${isSelected ? 'var(--green)' : 'var(--border)'}`,
                        borderRadius:'var(--rl)', padding:'14px 16px',
                        cursor: detailLoading ? 'wait' : 'pointer',
                        opacity: detailLoading && !isLoading ? 0.6 : 1,
                        transition:'border-color .12s,box-shadow .12s',
                        boxShadow: isSelected ? '0 0 0 1px var(--green)' : 'none',
                      }}
                      onMouseEnter={e => { if (!detailLoading && !isSelected) (e.currentTarget as HTMLElement).style.borderColor='var(--border2)' }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor='var(--border)' }}
                    >
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                            <span style={{fontWeight:600,fontSize:14}}>Costco {r.warehouseName}</span>
                            {isReturn && <span style={{fontSize:10,fontWeight:700,background:'var(--red-bg)',color:'var(--red-tx)',padding:'2px 7px',borderRadius:999}}>REFUND</span>}
                          </div>
                          <div style={{fontSize:12,color:'var(--ink2)'}}>
                            {fmtDate(r.transactionDateTime)}
                            {fmtTime(r.transactionDateTime) ? ` · ${fmtTime(r.transactionDateTime)}` : ''}
                            {` · ${r.totalItemCount} item${r.totalItemCount !== 1 ? 's' : ''}`}
                          </div>
                          {r.tenderArray?.[0] && (
                            <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>
                              {r.tenderArray[0].tenderDescription}
                              {r.tenderArray[0].displayAccountNumber ? ` ••••${r.tenderArray[0].displayAccountNumber}` : ''}
                            </div>
                          )}
                          {(r.instantSavings ?? 0) > 0 && (
                            <div style={{fontSize:11,color:'var(--green)',fontWeight:600,marginTop:3}}>Saved ${Number(r.instantSavings).toFixed(2)}</div>
                          )}
                        </div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                          {/* Checkbox */}
                          <button
                            onClick={e => toggleSelect(r.transactionBarcode, e)}
                            style={{
                              width:18, height:18, borderRadius:4, padding:0,
                              border:`2px solid ${isSelected ? 'var(--green)' : 'var(--border2)'}`,
                              background: isSelected ? 'var(--green)' : 'transparent',
                              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                            }}
                            aria-label="Select for import"
                          >
                            {isSelected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1.5 5 4 7.5 8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </button>
                          <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:600,color:isReturn?'var(--red-tx)':'inherit'}}>
                            {isReturn ? '−' : ''}{money(r.total)}
                          </div>
                          <div style={{fontSize:11,color:'var(--ink3)'}}>{isLoading ? 'Loading…' : 'View →'}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!loading && !detail && receipts.length === 0 && !error && (
            <div className="empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <p style={{fontWeight:500}}>No receipts in this period</p>
              <p style={{fontSize:13}}>Try a different quarter or check your token</p>
            </div>
          )}
        </>
      )}

      {!token && (
        <div className="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p style={{fontWeight:500}}>Paste your Bearer token above</p>
          <p style={{fontSize:13}}>Your receipts will appear here once the token is set</p>
        </div>
      )}
    </main>
  )
}
