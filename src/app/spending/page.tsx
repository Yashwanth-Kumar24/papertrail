'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getSpendingStats } from '@/lib/queries'

const money = (n: number) => `$${Number(n).toFixed(2)}`
const fmt   = (iso: string) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

type Stats = Awaited<ReturnType<typeof getSpendingStats>>

const PRESETS = [
  { label: 'This week',    days: 7   },
  { label: 'This month',   days: 30  },
  { label: 'Last 3 months',days: 90  },
  { label: 'This year',    days: 365 },
  { label: 'All time',     days: 0   },
]

function toISO(d: Date) { return d.toISOString().split('T')[0] }

export default function SpendingPage() {
  const [stats,    setStats]    = useState<Stats | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [preset,   setPreset]   = useState('Last 3 months')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const load = useCallback(async (from?: string, to?: string) => {
    setLoading(true)
    try {
      const s = await getSpendingStats(from, to)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }, [])

  // Init with Last 3 months
  useEffect(() => {
    const to   = toISO(new Date())
    const from = toISO(new Date(Date.now() - 90 * 86400000))
    setDateFrom(from)
    setDateTo(to)
    load(from, to)
  }, [load])

  function applyPreset(label: string, days: number) {
    setPreset(label)
    const to   = toISO(new Date())
    const from = days === 0 ? '' : toISO(new Date(Date.now() - days * 86400000))
    setDateFrom(from)
    setDateTo(to)
    load(from || undefined, to)
  }

  function applyRange(from: string, to: string) {
    setPreset('')
    setDateFrom(from)
    setDateTo(to)
    if (from && to) load(from, to)
  }

  const maxBrand = stats?.byBrand[0]?.total ?? 1
  const maxMonth = Math.max(...(stats?.byMonth.map(m => m.total) ?? [1]))

  return (
    <main className="page">
      <div className="pg-head">
        <span className="pg-title">Spending</span>
        <span className="pg-sub">
          {stats ? `${stats.receiptCount} receipt${stats.receiptCount !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Date filter */}
      <div className="date-pills">
        {PRESETS.map(p => (
          <button
            key={p.label}
            className={`date-pill ${preset === p.label ? 'active' : ''}`}
            onClick={() => applyPreset(p.label, p.days)}
          >
            {p.label}
          </button>
        ))}
        <div className="date-range">
          <input
            type="date" value={dateFrom}
            onChange={e => applyRange(e.target.value, dateTo)}
          />
          <span>→</span>
          <input
            type="date" value={dateTo}
            onChange={e => applyRange(dateFrom, e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : !stats || stats.receiptCount === 0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" strokeLinecap="round"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round"/></svg>
          <p style={{fontWeight:500}}>No spending in this period</p>
          <p style={{fontSize:13}}>Try a wider date range</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Total spent</div>
              <div className="stat-val" style={{fontSize:20}}>{money(stats.totalSpent)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Receipts</div>
              <div className="stat-val">{stats.receiptCount}</div>
              <div className="stat-sub">across {stats.byBrand.length} store{stats.byBrand.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg per trip</div>
              <div className="stat-val" style={{fontSize:20}}>{money(stats.avgPerTrip)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total saved</div>
              <div className="stat-val" style={{color:'var(--green)',fontSize:20}}>{money(stats.totalSaved)}</div>
              <div className="stat-sub">via discounts</div>
            </div>
          </div>

          {/* By brand + by month */}
          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-card-title">By store</div>
              {stats.byBrand.map(b => (
                <div key={b.brand} className="brand-row-s">
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{fontSize:13,fontWeight:500}}>{b.name}</div>
                    <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>{b.count} receipt{b.count !== 1 ? 's' : ''}</div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{width:`${(b.total / maxBrand) * 100}%`}}/>
                    </div>
                  </div>
                  <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>
                    {money(b.total)}
                  </div>
                </div>
              ))}
            </div>

            <div className="summary-card">
              <div className="summary-card-title">By month</div>
              {stats.byMonth.length === 0 ? (
                <p style={{fontSize:13,color:'var(--ink3)'}}>No data</p>
              ) : stats.byMonth.map(m => (
                <div key={m.month} className="month-row">
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{fontSize:13,color:'var(--ink2)'}}>{fmtMonth(m.month)}</div>
                    <div className="bar-bg">
                      <div className="bar-fill" style={{width:`${(m.total / maxMonth) * 100}%`,opacity:.7}}/>
                    </div>
                  </div>
                  <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>
                    {money(m.total)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Receipt list */}
          <div style={{marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>
              Receipts in this period
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="spending-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Date</th>
                  <th>Txn ID</th>
                  <th style={{textAlign:'right'}}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {stats.receipts.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{fontWeight:500}}>{r.store_name}</div>
                      {r.location && <div style={{fontSize:11,color:'var(--ink3)',marginTop:2}}>{r.location}</div>}
                    </td>
                    <td style={{fontSize:12,color:'var(--ink2)'}}>
                      {fmt(r.purchase_date)}
                      {r.purchase_time ? <><br/><span style={{fontSize:11}}>{r.purchase_time.slice(0,5)}</span></> : ''}
                    </td>
                    <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--ink3)'}}>
                      {r.transaction_id ?? '—'}
                    </td>
                    <td>
                      <div>{money(Number(r.total))}</div>
                      <div style={{fontSize:11}}>
                        <Link
                          href={`/receipts/${r.id}`}
                          style={{color:'var(--green)',fontWeight:500,textDecoration:'none'}}
                          onClick={e => e.stopPropagation()}
                        >
                          View →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}