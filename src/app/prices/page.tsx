'use client'
import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { searchItems, searchReturnedItems, getReturnCandidates, getDistinctBrands, claimPriceAlert, getPriceAlertClaimsSummary } from '@/lib/queries'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ItemHistory, ReturnedItem } from '@/lib/types'
import { BRAND_LABELS } from '@/lib/types'

const PRICES_BRAND_KEY = 'prices_brand_filter'

const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
const money = (n: number) => `$${Number(n).toFixed(2)}`

function TrendBadge({ trend, min, max, latestPrice }: { trend: ItemHistory['trend'], min: number, max: number, latestPrice: number }) {
  if (trend === 'single' || trend === 'stable') return <span style={{color:'var(--ink3)', fontSize:12}}>= stable</span>
  if (trend === 'up')   return <span className="tr-up">↑ +${Math.abs(max - min).toFixed(2)}</span>
  if (trend === 'down') {
    return <><span className="tr-dn">↓ −${Math.abs(max - min).toFixed(2)}</span>{' '}<span className="ret-tip">return opportunity</span></>
  }
  return null
}

function ItemRow({ item }: { item: ItemHistory }) {
  const [open, setOpen] = useState(false)
  const latest = item.purchases[0]

  return (
    <>
      <tr onClick={() => setOpen(o => !o)} style={{cursor:'pointer'}}>
        <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
        <td>
          <div style={{fontWeight:500}}>{item.name}</div>
          {item.purchases.length > 1 && <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>{item.purchases.length} purchases</div>}
        </td>
        <td style={{color:'var(--ink2)',fontSize:12}}>
          {latest.store_name}<br/>
          <span style={{fontSize:11}}>{fmt(latest.purchase_date)}</span>
        </td>
        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>
          {money(latest.final_price)}
        </td>
        <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)',fontWeight:600}}>
          {latest.discount_amount > 0 ? `−${money(latest.discount_amount)}` : <span style={{color:'var(--ink3)',fontWeight:400}}>—</span>}
        </td>
        <td><TrendBadge trend={item.trend} min={item.min_price} max={item.max_price} latestPrice={item.latest_price}/></td>
        <td>
          <Link href={`/receipts/${latest.receipt_id}`} prefetch={false} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
            Receipt →
          </Link>
        </td>
      </tr>
      {open && item.purchases.slice(1).map((p, i) => (
        <tr key={i} style={{background:'var(--cream)'}}>
          <td></td>
          <td style={{fontSize:12,color:'var(--ink2)',paddingLeft:12}}>↳ prev purchase</td>
          <td style={{fontSize:12,color:'var(--ink2)'}}>{p.store_name}<br/><span style={{fontSize:11}}>{fmt(p.purchase_date)}</span></td>
          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:500,fontSize:12}}>{money(p.final_price)}</td>
          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:12,color:'var(--green)'}}>
            {p.discount_amount > 0 ? `−${money(p.discount_amount)}` : <span style={{color:'var(--ink3)'}}>—</span>}
          </td>
          <td></td>
          <td>
            <Link href={`/receipts/${p.receipt_id}`} prefetch={false} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
              Receipt →
            </Link>
          </td>
        </tr>
      ))}
    </>
  )
}

// daysSince <= 30 is Costco's ~30-day price-adjustment window — Return is
// always offered; Price match only within that window (matches a purchase
// beyond it can't actually be adjusted, so offering the button would lie).
function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function ReturnRow({ item, onClaimed }: { item: ItemHistory; onClaimed: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'return' | 'price_match' | null>(null)
  const latest         = item.purchases[0]
  const expensive       = item.max_price_purchase!
  const savings         = item.max_price - item.latest_price
  const days            = daysSince(expensive.purchase_date)
  const canPriceMatch   = days <= 30

  // Claims this one specific purchase (item_code + expensive.receipt_id) —
  // never the item as a whole. A different, still-unclaimed purchase of the
  // same item can still surface as its own row later.
  async function claim(type: 'return' | 'price_match') {
    if (busy) return
    setBusy(type)
    try {
      await claimPriceAlert(item.item_code!, expensive.receipt_id, type)
      onClaimed()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <tr onClick={() => setOpen(o => !o)} style={{cursor:'pointer'}}>
        <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
        <td>
          <div style={{fontWeight:500}}>{item.name}</div>
          <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>{item.purchases.length} purchases</div>
        </td>
        {/* The one specific purchase the buttons on this row act on */}
        <td style={{fontFamily:'var(--mono)',fontSize:13}}>
          {money(expensive.final_price)}
          <div style={{fontSize:11,color:'var(--ink3)'}}>{fmt(expensive.purchase_date)}</div>
          <div style={{fontSize:10,color: days <= 90 ? 'var(--green)' : 'var(--ink3)'}}>
            {days}d ago
          </div>
        </td>
        {/* Current (cheaper) price */}
        <td style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:600}}>
          {money(latest.final_price)}
          <div style={{fontSize:11,color:'var(--ink3)'}}>{fmt(latest.purchase_date)}</div>
        </td>
        {/* Savings */}
        <td style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--green)'}}>
          −{money(savings)}
        </td>
        {/* Link to the expensive receipt — the one to bring to the store */}
        <td>
          <Link href={`/receipts/${expensive.receipt_id}`} prefetch={false} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
            Return receipt →
          </Link>
        </td>
        {/* Claim this purchase — Return always available, Price match only
            inside the 30-day window. Either way only THIS purchase drops
            off; a different purchase of the same item can resurface later. */}
        <td onClick={e => e.stopPropagation()}>
          <div style={{display:'flex',gap:6,whiteSpace:'nowrap'}}>
            <button
              onClick={() => claim('return')}
              disabled={busy !== null}
              style={{fontSize:11,fontWeight:600,padding:'4px 9px',borderRadius:999,border:'1px solid var(--red-tx)',background:'none',color:'var(--red-tx)',cursor: busy ? 'default' : 'pointer',opacity: busy && busy !== 'return' ? 0.4 : 1}}
            >
              {busy === 'return' ? '…' : '↩ Return'}
            </button>
            {canPriceMatch && (
              <button
                onClick={() => claim('price_match')}
                disabled={busy !== null}
                style={{fontSize:11,fontWeight:600,padding:'4px 9px',borderRadius:999,border:'1px solid var(--green)',background:'none',color:'var(--green)',cursor: busy ? 'default' : 'pointer',opacity: busy && busy !== 'price_match' ? 0.4 : 1}}
              >
                {busy === 'price_match' ? '…' : '↺ Match'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && item.purchases.map((p, i) => (
        <tr key={i} style={{background:'var(--cream)'}}>
          <td></td>
          <td style={{fontSize:12,color:'var(--ink2)',paddingLeft:12}}>
            {i === 0 ? '↳ current' : '↳ prev'}
          </td>
          <td colSpan={2} style={{fontSize:12,color:'var(--ink2)'}}>{p.store_name} · {fmt(p.purchase_date)}</td>
          <td style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:12}}>{money(p.final_price)}</td>
          <td>
            <Link href={`/receipts/${p.receipt_id}`} prefetch={false} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
              Receipt →
            </Link>
          </td>
          <td></td>
        </tr>
      ))}
    </>
  )
}

function RefundRow({ item }: { item: ReturnedItem }) {
  return (
    <tr>
      <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
      <td style={{fontWeight:500}}>{item.name}</td>
      <td style={{color:'var(--ink2)',fontSize:12}}>
        {item.store_name}<br/>
        <span style={{fontSize:11}}>{fmt(item.return_date)}</span>
      </td>
      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:'var(--red-tx)'}}>
        −{money(item.refund_amount)}
      </td>
      <td>
        <Link href={`/receipts/${item.receipt_id}`} prefetch={false} style={{color:'var(--green)',fontSize:12,fontWeight:500}}>
          Receipt →
        </Link>
      </td>
    </tr>
  )
}

function ItemsPageContent() {
  const [mode,       setMode]       = useState<'search' | 'returns' | 'refunds'>('search')
  const [query,      setQuery]      = useState('')
  const [brandFilter,setBrandFilter]= useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(PRICES_BRAND_KEY) ?? ''
  })
  const [results,  setResults]  = useState<ItemHistory[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [returns,      setReturns]      = useState<ItemHistory[]>([])
  const [retLoading,   setRetLoading]   = useState(false)
  const [retFilter,    setRetFilter]    = useState('')
  const [retScope,     setRetScope]     = useState<'all' | 'eligible'>('all')
  const [claimsSummary, setClaimsSummary] = useState({ count: 0 })
  const retFetchedAt = useRef<number>(0)
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ↩ Refunds tab — a separate search entirely, sourced from item_returns
  // instead of item_purchase_history (see searchReturnedItems in
  // lib/queries.ts). Not to be confused with "returns" above, which is
  // actually the "↑ Price alerts" mode (current price drops, an opportunity
  // to return-and-rebuy) — this one is "what did I actually return."
  const [refundQuery,    setRefundQuery]    = useState('')
  const [refundResults,  setRefundResults]  = useState<ReturnedItem[]>([])
  const [refundLoading,  setRefundLoading]  = useState(false)
  const [refundSearched, setRefundSearched] = useState(false)
  const refundDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    getDistinctBrands().then(setBrandOptions).catch(() => {})
  }, [])

  function updateBrandFilter(val: string) {
    setBrandFilter(val)
    localStorage.setItem(PRICES_BRAND_KEY, val)
    if (mode === 'refunds') { if (refundQuery.trim()) runRefundSearch(refundQuery, val) }
    else if (query.trim()) run(query, val)
  }
  const router = useRouter()
  const searchParams = useSearchParams()

  const run = useCallback((q: string, brand?: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true); setSearched(true)
      const b = brand !== undefined ? brand : brandFilter
      searchItems(q, b || undefined).then(setResults).finally(() => setLoading(false))
    }, 350)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounce, brandFilter])

  const runRefundSearch = useCallback((q: string, brand?: string) => {
    if (!q.trim()) { setRefundResults([]); setRefundSearched(false); return }
    clearTimeout(refundDebounce.current)
    refundDebounce.current = setTimeout(async () => {
      setRefundLoading(true); setRefundSearched(true)
      const b = brand !== undefined ? brand : brandFilter
      searchReturnedItems(q, b || undefined).then(setRefundResults).finally(() => setRefundLoading(false))
    }, 350)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundDebounce, brandFilter])

  useEffect(() => {
    const q = searchParams.get('q')
    if (q) { setQuery(q); run(q) }
  }, [searchParams, run])

  // Shared by the mount-restore effect, enterReturns(), and the post-claim
  // refresh — one place that fetches both the candidate list and the
  // lifetime claims total together, so they never go out of sync.
  const loadReturns = useCallback(() => {
    setRetLoading(true)
    Promise.all([
      getReturnCandidates(),
      getPriceAlertClaimsSummary(),
    ]).then(([r, summary]) => {
      setReturns(r); setClaimsSummary(summary); retFetchedAt.current = Date.now()
    }).finally(() => setRetLoading(false))
  }, [])

  // Restore price alerts mode when navigating back from a receipt
  useEffect(() => {
    if (searchParams.get('mode') === 'returns') {
      setMode('returns')
      loadReturns()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount only

  function enterReturns() {
    setMode('returns')
    router.replace('/prices?mode=returns')
    const stale = Date.now() - retFetchedAt.current > 2 * 60 * 1000
    if (!stale && returns.length > 0) return
    loadReturns()
  }

  function enterRefunds() {
    setMode('refunds')
    router.replace('/prices?mode=refunds')
  }

  return (
    <main className="page">
      <div className="pg-head">
        <span className="pg-title">Prices</span>
        <span className="pg-sub">
          {mode === 'search'   ? 'Search across all receipts'
            : mode === 'returns' ? `${returns.length} return opportunit${returns.length !== 1 ? 'ies' : 'y'} found`
            : 'Search items you\'ve returned'}
        </span>
      </div>

      {/* Mode toggle */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        <button
          onClick={() => { setMode('search'); router.replace(query ? `/prices?q=${encodeURIComponent(query)}` : '/prices') }}
          style={{
            fontSize:13,padding:'6px 16px',borderRadius:999,border:'1px solid var(--border2)',
            background: mode === 'search' ? 'var(--green)' : 'transparent',
            color:      mode === 'search' ? '#fff' : 'var(--ink2)',
            fontWeight: mode === 'search' ? 600 : 400,
            cursor:'pointer',fontFamily:'var(--sans)',
          }}
        >
          🔍 Search
        </button>
        <button
          onClick={enterReturns}
          style={{
            fontSize:13,padding:'6px 16px',borderRadius:999,border:'1px solid var(--border2)',
            background: mode === 'returns' ? 'var(--red-tx)' : 'transparent',
            color:      mode === 'returns' ? '#fff' : 'var(--ink2)',
            fontWeight: mode === 'returns' ? 600 : 400,
            cursor:'pointer',fontFamily:'var(--sans)',
          }}
        >
          ↑ Price alerts
        </button>
        <button
          onClick={enterRefunds}
          style={{
            fontSize:13,padding:'6px 16px',borderRadius:999,border:'1px solid var(--border2)',
            background: mode === 'refunds' ? '#92400E' : 'transparent',
            color:      mode === 'refunds' ? '#fff' : 'var(--ink2)',
            fontWeight: mode === 'refunds' ? 600 : 400,
            cursor:'pointer',fontFamily:'var(--sans)',
          }}
        >
          ↩ Refunds
        </button>
      </div>

      {/* Brand filter — shared across all three modes */}
      {mode !== 'returns' && (
        <div style={{marginBottom:12}}>
          <select
            value={brandFilter}
            onChange={e => updateBrandFilter(e.target.value)}
            className="fsel"
            style={{fontSize:13,padding:'6px 10px'}}
          >
            <option value="">All stores</option>
            {brandOptions.filter(b => b !== 'other').map(b => (
              <option key={b} value={b}>{BRAND_LABELS[b] ?? b}</option>
            ))}
            {brandOptions.includes('other') && (
              <option value="other">Other</option>
            )}
          </select>
        </div>
      )}

      {/* Search mode */}
      {mode === 'search' && (
        <>
          <div className="search-wrap">
            <div className="sinput">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                suppressHydrationWarning
                data-gramm="false"
                value={query}
                onChange={e => {
                  const value = e.target.value
                  setQuery(value)
                  run(value)
                  router.replace(value ? `/prices?q=${encodeURIComponent(value)}` : '/prices')
                }}
                placeholder="Name, item code, or price (e.g. 11.99)…"
                autoComplete="off"
              />
            </div>
          </div>

          {!searched && (
            <div className="empty">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeLinecap="round"/><line x1="21" y1="21" x2="16.65" y2="16.65" strokeLinecap="round"/></svg>
              <p style={{fontWeight:500}}>Search your items</p>
              <p style={{fontSize:13}}>
                Name → <strong>MANGO</strong> &nbsp;·&nbsp;
                Code → <strong>2033869</strong> &nbsp;·&nbsp;
                Price → <strong>11.99</strong>
              </p>
              <p style={{fontSize:12,marginTop:4,color:'var(--green)'}}>Price history and return tips show automatically</p>
            </div>
          )}

          {loading && <div className="empty"><p style={{color:'var(--ink3)'}}>Searching…</p></div>}

          {!loading && searched && results.length === 0 && (
            <div className="empty"><p style={{fontWeight:500}}>No items found</p><p style={{fontSize:13}}>Try a different name or code</p></div>
          )}

          {!loading && results.length > 0 && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Item</th><th>Store · Date</th>
                    <th style={{textAlign:'right'}}>Paid</th>
                    <th style={{textAlign:'right'}}>Saved</th>
                    <th>Trend</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(item => <ItemRow key={item.item_code ?? item.name} item={item}/>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Returns mode (price alerts) */}
      {mode === 'returns' && (
        <>
          {!retLoading && claimsSummary.count > 0 && (
            <div style={{fontSize:13,color:'var(--green)',fontWeight:500,marginBottom:12}}>
              ✓ {claimsSummary.count} claimed
            </div>
          )}

          {retLoading && <div className="empty"><p style={{color:'var(--ink3)'}}>Scanning price history…</p></div>}

          {!retLoading && returns.length === 0 && (
            <div className="empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
              </svg>
              <p style={{fontWeight:500}}>No return opportunities found</p>
              <p style={{fontSize:13}}>All items are at the same or higher price as when you first bought them</p>
            </div>
          )}

          {!retLoading && returns.length > 0 && (() => {
            const scoped  = retScope === 'eligible' ? returns.filter(i => daysSince(i.max_price_purchase!.purchase_date) <= 30) : returns
            const visible = retFilter
              ? scoped.filter(i => i.name.toLowerCase().includes(retFilter.toLowerCase()) || (i.item_code ?? '').toLowerCase().includes(retFilter.toLowerCase()))
              : scoped
            return (
            <>
              <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                <button
                  onClick={() => setRetScope('all')}
                  style={{fontSize:12,fontWeight:600,padding:'5px 12px',borderRadius:999,cursor:'pointer',border:`1px solid ${retScope==='all' ? 'var(--ink2)' : 'var(--border2)'}`,background: retScope==='all' ? 'var(--ink2)' : 'transparent',color: retScope==='all' ? '#fff' : 'var(--ink2)'}}
                >All ({returns.length})</button>
                <button
                  onClick={() => setRetScope('eligible')}
                  style={{fontSize:12,fontWeight:600,padding:'5px 12px',borderRadius:999,cursor:'pointer',border:`1px solid ${retScope==='eligible' ? 'var(--green)' : 'var(--border2)'}`,background: retScope==='eligible' ? 'var(--green)' : 'transparent',color: retScope==='eligible' ? '#fff' : 'var(--ink2)'}}
                >↺ Price-match eligible (≤30d)</button>
              </div>
              <div className="search-wrap" style={{marginBottom:12}}>
                <div className="sinput">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    value={retFilter}
                    onChange={e => setRetFilter(e.target.value)}
                    placeholder="Filter by name or item code…"
                    autoComplete="off"
                  />
                  {retFilter && (
                    <button onClick={() => setRetFilter('')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--ink3)',fontSize:16,padding:'0 4px'}}>×</button>
                  )}
                </div>
              </div>
              <div style={{padding:'10px 14px',background:'#FEF3C7',borderRadius:'var(--r)',fontSize:13,color:'#92400E',marginBottom:12}}>
                Each row is one specific purchase — the price and date under &ldquo;You paid&rdquo; are that purchase, and the buttons act on that purchase only. <strong>↩ Return</strong> is always available; <strong>↺ Match</strong> only shows within Costco&rsquo;s ~30-day price-adjustment window. Either way, only that purchase drops off — a different purchase of the same item can still show up later.
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Item</th>
                      <th>You paid</th>
                      <th>Now</th>
                      <th>Save</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(item => <ReturnRow key={`${item.item_code ?? item.name}:${item.max_price_purchase!.receipt_id}`} item={item} onClaimed={loadReturns}/>)}
                  </tbody>
                </table>
                {visible.length === 0 && (
                  <p style={{textAlign:'center',color:'var(--ink3)',fontSize:13,padding:'24px 0'}}>
                    {retFilter ? <>No items match &ldquo;{retFilter}&rdquo;</> : 'No items in this window'}
                  </p>
                )}
              </div>
            </>
            )
          })()}
        </>
      )}

      {/* Refunds mode — search items actually returned */}
      {mode === 'refunds' && (
        <>
          <div className="search-wrap">
            <div className="sinput">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                suppressHydrationWarning
                value={refundQuery}
                onChange={e => { const value = e.target.value; setRefundQuery(value); runRefundSearch(value) }}
                placeholder="Name or item code…"
                autoComplete="off"
              />
            </div>
          </div>

          {!refundSearched && (
            <div className="empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/>
              </svg>
              <p style={{fontWeight:500}}>Search items you've returned</p>
              <p style={{fontSize:13}}>Name → <strong>SWIFFER</strong> &nbsp;·&nbsp; Code → <strong>1456660</strong></p>
              <p style={{fontSize:12,marginTop:4,color:'var(--ink3)'}}>Separate from the main Search — includes only returned items</p>
            </div>
          )}

          {refundLoading && <div className="empty"><p style={{color:'var(--ink3)'}}>Searching…</p></div>}

          {!refundLoading && refundSearched && refundResults.length === 0 && (
            <div className="empty"><p style={{fontWeight:500}}>No returned items found</p><p style={{fontSize:13}}>Try a different name or code</p></div>
          )}

          {!refundLoading && refundResults.length > 0 && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Item</th><th>Store · Date</th>
                    <th style={{textAlign:'right'}}>Refunded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {refundResults.map(item => <RefundRow key={item.id} item={item}/>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  )
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<main className="page">Loading items…</main>}>
      <ItemsPageContent />
    </Suspense>
  )
}
