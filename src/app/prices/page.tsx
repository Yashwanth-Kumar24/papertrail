'use client'
import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { searchItems, getReturnCandidates, getDistinctBrands } from '@/lib/queries'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ItemHistory } from '@/lib/types'
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
          <Link href={`/receipts/${latest.receipt_id}`} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
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
            <Link href={`/receipts/${p.receipt_id}`} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
              Receipt →
            </Link>
          </td>
        </tr>
      ))}
    </>
  )
}

function ReturnRow({ item }: { item: ItemHistory }) {
  const [open, setOpen]   = useState(false)
  const latest            = item.purchases[0]
  const expensive         = item.max_price_purchase!
  const savings           = item.max_price - item.latest_price
  const daysSince         = Math.floor((Date.now() - new Date(expensive.purchase_date).getTime()) / 86400000)

  return (
    <>
      <tr onClick={() => setOpen(o => !o)} style={{cursor:'pointer'}}>
        <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
        <td>
          <div style={{fontWeight:500}}>{item.name}</div>
          <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>{item.purchases.length} purchases</div>
        </td>
        {/* What you paid (the return candidate) */}
        <td style={{fontFamily:'var(--mono)',fontSize:13}}>
          {money(expensive.final_price)}
          <div style={{fontSize:11,color:'var(--ink3)'}}>{fmt(expensive.purchase_date)}</div>
          <div style={{fontSize:10,color: daysSince <= 90 ? 'var(--green)' : 'var(--ink3)'}}>
            {daysSince}d ago
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
          <Link href={`/receipts/${expensive.receipt_id}`} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
            Return receipt →
          </Link>
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
            <Link href={`/receipts/${p.receipt_id}`} style={{color:'var(--green)',fontSize:12,fontWeight:500}} onClick={e => e.stopPropagation()}>
              Receipt →
            </Link>
          </td>
        </tr>
      ))}
    </>
  )
}

function ItemsPageContent() {
  const [mode,       setMode]       = useState<'search' | 'returns'>('search')
  const [query,      setQuery]      = useState('')
  const [brandFilter,setBrandFilter]= useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(PRICES_BRAND_KEY) ?? ''
  })
  const [results,  setResults]  = useState<ItemHistory[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [returns,    setReturns]    = useState<ItemHistory[]>([])
  const [retLoading, setRetLoading] = useState(false)
  const [retFilter,  setRetFilter]  = useState('')
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    getDistinctBrands().then(setBrandOptions).catch(() => {})
  }, [])

  function updateBrandFilter(val: string) {
    setBrandFilter(val)
    localStorage.setItem(PRICES_BRAND_KEY, val)
    if (query.trim()) run(query, val)
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

  useEffect(() => {
    const q = searchParams.get('q')
    if (q) { setQuery(q); run(q) }
  }, [searchParams, run])

  // Restore price alerts mode when navigating back from a receipt
  useEffect(() => {
    if (searchParams.get('mode') === 'returns') {
      setMode('returns')
      setRetLoading(true)
      getReturnCandidates().then(setReturns).finally(() => setRetLoading(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount only

  function enterReturns() {
    setMode('returns')
    router.replace('/prices?mode=returns')
    if (returns.length > 0) return
    setRetLoading(true)
    getReturnCandidates().then(setReturns).finally(() => setRetLoading(false))
  }

  return (
    <main className="page">
      <div className="pg-head">
        <span className="pg-title">Prices</span>
        <span className="pg-sub">
          {mode === 'search' ? 'Search across all receipts' : `${returns.length} return opportunit${returns.length !== 1 ? 'ies' : 'y'} found`}
        </span>
      </div>

      {/* Mode toggle */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
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
      </div>

      {/* Search mode */}
      {mode === 'search' && (
        <>
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

      {/* Returns mode */}
      {mode === 'returns' && (
        <>
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

          {!retLoading && returns.length > 0 && (
            <>
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
                These items are cheaper now than a previous purchase. Bring the linked receipt to get a refund or rebuy at the lower price. Green days = likely within return window.
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
                    </tr>
                  </thead>
                  <tbody>
                    {(retFilter ? returns.filter(i => i.name.toLowerCase().includes(retFilter.toLowerCase()) || (i.item_code ?? '').toLowerCase().includes(retFilter.toLowerCase())) : returns).map(item => <ReturnRow key={item.item_code ?? item.name} item={item}/>)}
                  </tbody>
                </table>
                {retFilter && returns.filter(i => i.name.toLowerCase().includes(retFilter.toLowerCase()) || (i.item_code ?? '').toLowerCase().includes(retFilter.toLowerCase())).length === 0 && (
                  <p style={{textAlign:'center',color:'var(--ink3)',fontSize:13,padding:'24px 0'}}>No items match &ldquo;{retFilter}&rdquo;</p>
                )}
              </div>
            </>
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
