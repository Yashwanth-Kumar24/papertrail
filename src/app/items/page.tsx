'use client'
import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { searchItems } from '@/lib/queries'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ItemHistory } from '@/lib/types'

const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
const money = (n: number) => `$${Number(n).toFixed(2)}`

function TrendBadge({ trend, min, max }: { trend: ItemHistory['trend'], min: number, max: number }) {
  if (trend === 'single' || trend === 'stable') return <span style={{color:'var(--ink3)', fontSize:12}}>= stable</span>
  const diff = Math.abs(max - min).toFixed(2)
  if (trend === 'up')   return <><span className="tr-up">↑ +${diff}</span> <span className="ret-tip">check return</span></>
  if (trend === 'down') return <span className="tr-dn">↓ −${diff}</span>
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
        <td style={{textAlign:'right',fontFamily:'var(--mono)', color: latest.discount_amount > 0 ? 'var(--ink2)' : 'inherit', textDecoration: latest.discount_amount > 0 ? 'line-through' : 'none'}}>
          {latest.discount_amount > 0 ? money(latest.original_price) : '—'}
        </td>
        <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--red)',fontWeight:600}}>
          {latest.discount_amount > 0 ? `−${money(latest.discount_amount)}` : '—'}
        </td>
        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>
          {money(latest.final_price)}
        </td>
        <td><TrendBadge trend={item.trend} min={item.min_price} max={item.max_price}/></td>
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
          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:12,color:'var(--ink3)',textDecoration: p.discount_amount > 0 ? 'line-through' : 'none'}}>
            {p.discount_amount > 0 ? money(p.original_price) : '—'}
          </td>
          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:12,color:'var(--red)'}}>
            {p.discount_amount > 0 ? `−${money(p.discount_amount)}` : '—'}
          </td>
          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:500,fontSize:12}}>{money(p.final_price)}</td>
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

function ItemsPageContent() {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<ItemHistory[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const router = useRouter()
  const searchParams = useSearchParams()
  const run = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true); setSearched(true)
      searchItems(q).then(setResults).finally(() => setLoading(false))
    }, 350)
  }, [debounce])

  useEffect(() => {
    const q = searchParams.get('q')

    if (q) {
      setQuery(q)
      run(q)
    }
  }, [searchParams, run])

  return (
    <main className="page">
      <div className="pg-head">
        <span className="pg-title">Items</span>
        <span className="pg-sub">Search across all receipts</span>
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

              router.replace(
                value
                  ? `/items?q=${encodeURIComponent(value)}`
                  : '/items'
              )
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
                <th style={{textAlign:'right'}}>Original</th>
                <th style={{textAlign:'right'}}>Discount</th>
                <th style={{textAlign:'right'}}>Paid</th>
                <th>Trend</th><th></th>
              </tr>
            </thead>
            <tbody>
              {results.map(item => <ItemRow key={item.item_code ?? item.name} item={item}/>)}
            </tbody>
          </table>
        </div>
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