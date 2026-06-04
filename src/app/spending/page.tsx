'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getSpendingStats, getDailySpending, getReceiptsByDate, getBudgets, upsertBudget, getRecurring, getRecurringPaymentsForPeriod, getCategorySpendingForMonth } from '@/lib/queries'
import { PAYER_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, CATEGORIES } from '@/lib/types'
import type { Budget, Receipt, RecurringBill } from '@/lib/types'

const money    = (n: number) => `$${Number(n).toFixed(2)}`
const fmt      = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
const fmtMonthShort = (ym: string) => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}
const toISO = (d: Date) => d.toISOString().split('T')[0]
const nowMonth = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

type Stats = Awaited<ReturnType<typeof getSpendingStats>>

const PRESETS = [
  { label: 'This week',     days: 7   },
  { label: 'This month',    days: 30  },
  { label: 'Last 3 months', days: 90  },
  { label: 'This year',     days: 365 },
  { label: 'All time',      days: 0   },
]

// ── Monthly digest ─────────────────────────────────────────
function MonthlyDigest({ onDismiss }: { onDismiss: () => void }) {
  const [data, setData] = useState<Stats | null>(null)
  const [prev, setPrev] = useState<number | null>(null)

  useEffect(() => {
    const now  = new Date()
    const thisM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const lastM = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0)
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    // month before last — for delta comparison
    const prevFirst = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const prevLast  = new Date(now.getFullYear(), now.getMonth() - 1, 0)

    Promise.all([
      getSpendingStats(toISO(firstDay), toISO(lastDay)),
      getSpendingStats(toISO(prevFirst), toISO(prevLast)),
    ]).then(([cur, prevStats]) => {
      setData(cur)
      setPrev(prevStats.totalSpent)
    })
  }, [])

  if (!data) return <div style={{padding:'14px 18px',background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',marginBottom:20}}>Loading recap…</div>

  const now  = new Date()
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long' })
  const delta = prev !== null ? data.totalSpent - prev : null
  const top3  = data.byCategory.slice(0, 3)
  const biggestReceipt = [...data.receipts].sort((a, b) => Number(b.total) - Number(a.total))[0]

  return (
    <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'16px 20px',marginBottom:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>
            {lastMonthName} Recap
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:10}}>
            <span style={{fontSize:22,fontWeight:700,fontFamily:'var(--mono)'}}>{money(data.totalSpent)}</span>
            {delta !== null && (
              <span style={{fontSize:12,color: delta > 0 ? 'var(--red)' : 'var(--green)', fontWeight:600}}>
                {delta > 0 ? '↑' : '↓'} {money(Math.abs(delta))} vs {new Date(now.getFullYear(), now.getMonth()-2, 1).toLocaleDateString('en-US',{month:'short'})}
              </span>
            )}
          </div>
          <div style={{fontSize:12,color:'var(--ink3)',marginTop:2}}>{data.receiptCount} receipt{data.receiptCount !== 1 ? 's' : ''}</div>
        </div>
        <button onClick={onDismiss} style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 2px'}}>×</button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:biggestReceipt ? 10 : 0}}>
        {top3.map(c => (
          <span key={c.category} style={{
            fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999,
            background: CATEGORY_COLORS[c.category]?.bg ?? 'var(--cream2)',
            color:      CATEGORY_COLORS[c.category]?.color ?? 'var(--ink2)',
          }}>
            {CATEGORY_LABELS[c.category] ?? c.category} · {money(c.total)}
          </span>
        ))}
      </div>
      {biggestReceipt && (
        <div style={{fontSize:12,color:'var(--ink2)'}}>
          Biggest trip:{' '}
          <Link href={`/receipts/${biggestReceipt.id}`} style={{color:'var(--green)',fontWeight:500}}>
            {biggestReceipt.store_name} · {money(Number(biggestReceipt.total))}
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Sub-tab button ─────────────────────────────────────────
function SubTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:'7px 18px',border:'none',borderRadius:999,
        fontSize:13,fontWeight: active ? 600 : 500,cursor:'pointer',
        background: active ? 'var(--green)' : 'transparent',
        color:      active ? '#fff' : 'var(--ink2)',
        transition:'all .12s',
      }}
    >{label}</button>
  )
}

// ── Calendar heatmap ───────────────────────────────────────
function SpendingHeatmap() {
  const now   = new Date()
  const [calYear,  setCalYear]  = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)
  const [dayData,  setDayData]  = useState<Record<string, { total: number; count: number }>>({})
  const [selDay,   setSelDay]   = useState<string | null>(null)
  const [dayReceipts, setDayReceipts] = useState<Receipt[]>([])
  const [loadingDay,  setLoadingDay]  = useState(false)

  useEffect(() => {
    getDailySpending(calYear, calMonth).then(setDayData)
    setSelDay(null)
  }, [calYear, calMonth])

  async function openDay(date: string) {
    setSelDay(date)
    setLoadingDay(true)
    try { setDayReceipts(await getReceiptsByDate(date)) }
    finally { setLoadingDay(false) }
  }

  function prevMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    const isNow = calYear === now.getFullYear() && calMonth === now.getMonth() + 1
    if (isNow) return
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1) }
    else setCalMonth(m => m + 1)
  }

  const isNow    = calYear === now.getFullYear() && calMonth === now.getMonth() + 1
  const monthLabel = new Date(calYear, calMonth - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const firstDow = new Date(calYear, calMonth - 1, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth, 0).getDate()

  const maxDay   = Math.max(...Object.values(dayData).map(d => d.total), 1)
  const days     = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const blanks   = Array.from({ length: firstDow })

  // 3-tier coral/red palette — intuitive "spending intensity"
  function heatColor(total: number): { bg: string; text: string } {
    if (total === 0) return { bg: 'var(--cream2)', text: 'var(--ink3)' }
    const pct = total / maxDay
    if (pct < 0.33) return { bg: '#FEE2E2', text: '#B91C1C' }   // light rose
    if (pct < 0.66) return { bg: '#FCA5A5', text: '#7F1D1D' }   // soft coral
    return              { bg: '#EF4444', text: '#fff'     }       // warm red
  }

  const isoDay = (d: number) =>
    `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return (
    <div style={{marginTop:24}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.07em'}}>
          Daily spending
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button onClick={prevMonth} style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 10px',cursor:'pointer',fontSize:13,color:'var(--ink2)'}}>‹</button>
          <span style={{fontSize:13,fontWeight:500,minWidth:120,textAlign:'center'}}>{monthLabel}</span>
          <button onClick={nextMonth} disabled={isNow} style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 10px',cursor: isNow ? 'not-allowed' : 'pointer',fontSize:13,color: isNow ? 'var(--border2)' : 'var(--ink2)'}}>›</button>
        </div>
      </div>

      <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'14px 16px'}}>
        {/* Day headers */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:6}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} style={{fontSize:10,fontWeight:600,color:'var(--ink3)',textAlign:'center'}}>{d}</div>
          ))}
        </div>
        {/* Day cells */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
          {blanks.map((_, i) => <div key={`b${i}`}/>)}
          {days.map(d => {
            const iso   = isoDay(d)
            const info  = dayData[iso]
            const heat  = heatColor(info?.total ?? 0)
            const sel   = selDay === iso
            return (
              <div
                key={d}
                onClick={() => info ? openDay(iso) : undefined}
                style={{
                  borderRadius:6,
                  padding:'6px 4px',
                  background: sel ? 'var(--green)' : heat.bg,
                  cursor: info ? 'pointer' : 'default',
                  minHeight:44,
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start',
                  gap:2,
                  border: sel ? '2px solid var(--green)' : '2px solid transparent',
                  transition:'all .1s',
                }}
              >
                <span style={{fontSize:11,fontWeight:500,color: sel ? '#fff' : 'var(--ink2)'}}>{d}</span>
                {info && <span style={{fontSize:9,fontWeight:600,color: sel ? '#fff' : heat.text,fontFamily:'var(--mono)'}}>${info.total.toFixed(0)}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Day detail panel */}
      {selDay && (
        <div style={{marginTop:12,background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'14px 18px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:600}}>
              {new Date(selDay + 'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
            </div>
            <button onClick={() => setSelDay(null)} style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
          </div>
          {loadingDay ? (
            <p style={{fontSize:13,color:'var(--ink3)'}}>Loading…</p>
          ) : dayReceipts.length === 0 ? (
            <p style={{fontSize:13,color:'var(--ink3)'}}>No receipts this day</p>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {dayReceipts.map(r => (
                <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500,fontSize:13}}>{r.store_name}</div>
                    <div style={{display:'flex',gap:6,marginTop:3,flexWrap:'wrap'}}>
                      {r.paid_by && (
                        <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:999,background:PAYER_COLORS[r.paid_by]?.bg??'var(--cream2)',color:PAYER_COLORS[r.paid_by]?.color??'var(--ink2)'}}>
                          {r.paid_by}
                        </span>
                      )}
                      {r.category && (
                        <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:999,background:CATEGORY_COLORS[r.category]?.bg??'var(--cream2)',color:CATEGORY_COLORS[r.category]?.color??'var(--ink2)'}}>
                          {CATEGORY_LABELS[r.category]??r.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                    <span style={{fontFamily:'var(--mono)',fontWeight:600}}>{money(Number(r.total))}</span>
                    <Link href={`/receipts/${r.id}`} style={{fontSize:12,color:'var(--green)',fontWeight:500}}>View →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Budget tab ─────────────────────────────────────────────
function BudgetTab() {
  const [budgets,    setBudgets]    = useState<Budget[]>([])
  const [spending,   setSpending]   = useState<Record<string, number>>({})
  const [editing,    setEditing]    = useState(false)
  const [draftAmts,  setDraftAmts]  = useState<Record<string, string>>({})
  const [draftActive,setDraftActive]= useState<Record<string, boolean>>({})
  const [saving,     setSaving]     = useState(false)
  const month = nowMonth()

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([
      getBudgets(),
      getCategorySpendingForMonth(month),
    ])
    setBudgets(b)
    setSpending(s)
  }, [month])

  useEffect(() => { load() }, [load])

  function startEdit() {
    const amounts: Record<string, string> = {}
    const active: Record<string, boolean> = {}
    for (const cat of CATEGORIES) {
      const b = budgets.find(b => b.category === cat)
      amounts[cat] = b ? String(b.amount) : ''
      active[cat]  = b ? b.active : false
    }
    setDraftAmts(amounts)
    setDraftActive(active)
    setEditing(true)
  }

  async function saveEdits() {
    setSaving(true)
    try {
      await Promise.all(
        CATEGORIES.map(cat => {
          const amt = parseFloat(draftAmts[cat] || '0') || 0
          const on  = draftActive[cat] ?? false
          if (amt > 0 || on) return upsertBudget(cat, amt, on)
          return Promise.resolve()
        })
      )
      await load()
      setEditing(false)
    } finally { setSaving(false) }
  }

  const activeBudgets = budgets.filter(b => b.active && b.amount > 0)
  const totalBudget   = activeBudgets.reduce((s, b) => s + Number(b.amount), 0)
  const totalSpent    = activeBudgets.reduce((s, b) => s + (spending[b.category] ?? 0), 0)
  const overallPct    = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0
  const monthName     = new Date(Number(month.slice(0,4)), Number(month.slice(5,7))-1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <div style={{fontSize:13,fontWeight:600,color:'var(--ink2)'}}>{monthName}</div>
        <button
          onClick={editing ? saveEdits : startEdit}
          disabled={saving}
          style={{fontSize:12,padding:'5px 14px',borderRadius:'var(--r)',border:'1px solid var(--border2)',background:'transparent',cursor:'pointer',fontWeight:500}}
        >
          {saving ? 'Saving…' : editing ? 'Save budgets' : 'Edit budgets'}
        </button>
      </div>

      {editing ? (
        <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'16px 18px',marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>
            Set monthly limits
          </div>
          {CATEGORIES.map(cat => (
            <div key={cat} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
              <input
                type="checkbox"
                checked={draftActive[cat] ?? false}
                onChange={e => setDraftActive(p => ({...p, [cat]: e.target.checked}))}
                style={{accentColor:'var(--green)',width:15,height:15,flexShrink:0}}
              />
              <span style={{
                fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,flexShrink:0,
                background: CATEGORY_COLORS[cat]?.bg ?? 'var(--cream2)',
                color:      CATEGORY_COLORS[cat]?.color ?? 'var(--ink2)',
              }}>{CATEGORY_LABELS[cat]}</span>
              <div style={{flex:1}}/>
              <span style={{fontSize:13,color:'var(--ink3)'}}>$</span>
              <input
                type="number"
                step="10"
                min="0"
                value={draftAmts[cat] ?? ''}
                onChange={e => {
                  setDraftAmts(p => ({...p, [cat]: e.target.value}))
                  if (e.target.value) setDraftActive(p => ({...p, [cat]: true}))
                }}
                placeholder="0"
                style={{width:80,textAlign:'right',padding:'4px 8px',fontFamily:'var(--mono)',fontSize:13,border:'1px solid var(--border)',borderRadius:4,background:'#fff'}}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          {activeBudgets.length === 0 ? (
            <div className="empty" style={{padding:'40px 24px'}}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
              <p style={{fontWeight:500}}>No budgets set</p>
              <p style={{fontSize:13}}>Click "Edit budgets" to set monthly limits</p>
            </div>
          ) : (
            <>
              {/* Master overview */}
              <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'16px 18px',marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                  <div style={{fontSize:13,fontWeight:600}}>Overall</div>
                  <div style={{fontSize:13,fontFamily:'var(--mono)'}}>
                    <span style={{fontWeight:600}}>{money(totalSpent)}</span>
                    <span style={{color:'var(--ink3)'}}> / {money(totalBudget)}</span>
                  </div>
                </div>
                <div className="progress-bar" style={{height:8,borderRadius:4}}>
                  <div className="progress-fill" style={{
                    width:`${overallPct}%`,height:'100%',borderRadius:4,
                    background: overallPct >= 100 ? 'var(--red)' : overallPct >= 75 ? '#F59E0B' : 'var(--green)',
                  }}/>
                </div>
              </div>

              {/* Per-category rows */}
              <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',overflow:'hidden'}}>
                {activeBudgets.map(b => {
                  const spent = spending[b.category] ?? 0
                  const pct   = b.amount > 0 ? (spent / b.amount) * 100 : 0
                  const over  = pct > 100
                  const barColor = pct >= 100 ? 'var(--red)' : pct >= 75 ? '#F59E0B' : 'var(--green)'
                  return (
                    <div key={b.category} style={{padding:'12px 18px',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                        <span style={{
                          width:8,height:8,borderRadius:'50%',flexShrink:0,
                          background: CATEGORY_COLORS[b.category]?.color ?? 'var(--green)',
                        }}/>
                        <span style={{fontSize:13,fontWeight:500,flex:1}}>{CATEGORY_LABELS[b.category]}</span>
                        <span style={{fontSize:12,fontFamily:'var(--mono)',color: over ? 'var(--red)' : 'var(--ink2)'}}>
                          {money(spent)} <span style={{color:'var(--ink3)'}}>/ {money(b.amount)}</span>
                        </span>
                        <span style={{fontSize:11,fontWeight:600,color: over ? 'var(--red)' : 'var(--ink3)',minWidth:34,textAlign:'right'}}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div style={{position:'relative'}}>
                        <div className="progress-bar" style={{height:6,borderRadius:3}}>
                          <div className="progress-fill" style={{
                            width:`${Math.min(pct, 100)}%`,height:'100%',borderRadius:3,background:barColor,
                          }}/>
                        </div>
                        {over && (
                          <span style={{position:'absolute',right:0,top:-1,fontSize:10,color:'var(--red)',fontWeight:700}}>
                            +{money(spent - b.amount)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Recurring overview — simple obligation card in Summary ──
function RecurringOverview() {
  const [bills, setBills] = useState<RecurringBill[]>([])
  useEffect(() => { getRecurring().then(setBills).catch(() => {}) }, [])

  const toMonthly = (b: RecurringBill) => {
    if (b.frequency === 'monthly')   return b.amount
    if (b.frequency === 'annual')    return b.amount / 12
    if (b.frequency === 'weekly')    return b.amount * 4.33
    if (b.frequency === 'quarterly') return b.amount / 3
    return b.amount
  }
  const monthly = bills.reduce((s, b) => s + toMonthly(b), 0)
  if (bills.length === 0) return null

  return (
    <div style={{background:'var(--cream2)',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'12px 18px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
      <div style={{display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Recurring</span>
        <span style={{fontSize:16,fontWeight:700,fontFamily:'var(--mono)'}}>${monthly.toFixed(2)}<span style={{fontSize:11,fontWeight:400,color:'var(--ink3)'}}>/mo</span></span>
        <span style={{fontSize:12,color:'var(--ink3)'}}>{bills.length} bill{bills.length!==1?'s':''} · see full breakdown in</span>
      </div>
      <a href="/recurring" style={{fontSize:13,fontWeight:600,color:'var(--green)',textDecoration:'none',flexShrink:0,whiteSpace:'nowrap'}}>Recurring tab →</a>
    </div>
  )
}

// ── Payer split card — receipts + recurring ────────────────
function PayerSplitCard({ stats, dateFrom, dateTo }: { stats: Stats; dateFrom: string; dateTo: string }) {
  const [recurringByPayer, setRecurringByPayer] = useState<{ payer: string; total: number }[]>([])

  useEffect(() => {
    getRecurringPaymentsForPeriod(dateFrom || undefined, dateTo || undefined)
      .then(setRecurringByPayer).catch(() => {})
  }, [dateFrom, dateTo])

  // Merge receipt + recurring per payer
  const allPayers = [...new Set([
    ...stats.byPayer.map(p => p.payer),
    ...recurringByPayer.map(p => p.payer),
  ])]

  const combined = allPayers.map(payer => ({
    payer,
    receipts:  stats.byPayer.find(p => p.payer === payer)?.total ?? 0,
    recurring: recurringByPayer.find(p => p.payer === payer)?.total ?? 0,
  })).sort((a, b) => (b.receipts + b.recurring) - (a.receipts + a.recurring))

  const maxTotal = Math.max(...combined.map(p => p.receipts + p.recurring), 1)
  const hasRecurring = recurringByPayer.length > 0

  return (
    <div className="summary-card">
      <div className="summary-card-title">By payer</div>
      {combined.map(p => {
        const total = p.receipts + p.recurring
        const pct   = (total / maxTotal) * 100
        return (
          <div key={p.payer} className="brand-row-s">
            <div style={{flex:1,marginRight:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,background:PAYER_COLORS[p.payer]?.bg??'var(--cream2)',color:PAYER_COLORS[p.payer]?.color??'var(--ink2)'}}>
                  {p.payer}
                </span>
                {hasRecurring && (
                  <span style={{fontSize:11,color:'var(--ink3)'}}>
                    {money(p.receipts)} receipts{p.recurring > 0 ? ` + ${money(p.recurring)} recurring` : ''}
                  </span>
                )}
              </div>
              <div className="bar-bg" style={{marginTop:6}}>
                {/* Receipts portion */}
                <div style={{display:'flex',height:'100%',borderRadius:2,overflow:'hidden',width:`${pct}%`}}>
                  <div style={{flex: p.receipts, background: PAYER_COLORS[p.payer]?.color ?? 'var(--green)'}}/>
                  {p.recurring > 0 && <div style={{flex: p.recurring, background: PAYER_COLORS[p.payer]?.color ?? 'var(--green)', opacity: 0.4}}/>}
                </div>
              </div>
            </div>
            <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(total)}</div>
          </div>
        )
      })}
      {hasRecurring && (
        <div style={{display:'flex',gap:14,marginTop:10,fontSize:11,color:'var(--ink3)'}}>
          <span style={{display:'flex',alignItems:'center',gap:4}}>
            <span style={{width:10,height:4,borderRadius:2,background:'var(--green)',display:'inline-block'}}/>
            Receipts
          </span>
          <span style={{display:'flex',alignItems:'center',gap:4}}>
            <span style={{width:10,height:4,borderRadius:2,background:'var(--green)',opacity:.4,display:'inline-block'}}/>
            Recurring
          </span>
        </div>
      )}
    </div>
  )
}

// ── Summary tab ────────────────────────────────────────────
function SummaryTab({ stats, dateFrom, dateTo }: { stats: Stats; dateFrom: string; dateTo: string }) {
  const maxCat   = stats.byCategory[0]?.total ?? 1
  const top5     = stats.byBrand.slice(0, 5)
  const top3rec  = [...stats.receipts]
    .filter(r => Number(r.total) > 0)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, 3)

  return (
    <div>
      <RecurringOverview />

      {/* Key metrics */}
      <div className="stat-grid" style={{marginBottom:20}}>
        <div className="stat-card"><div className="stat-label">Total spent</div><div className="stat-val" style={{fontSize:20}}>{money(stats.totalSpent)}</div></div>
        <div className="stat-card"><div className="stat-label">Receipts</div><div className="stat-val">{stats.receiptCount}</div></div>
        <div className="stat-card"><div className="stat-label">Avg per trip</div><div className="stat-val" style={{fontSize:20}}>{money(stats.avgPerTrip)}</div></div>
        <div className="stat-card"><div className="stat-label">Total saved</div><div className="stat-val" style={{color:'var(--green)',fontSize:20}}>{money(stats.totalSaved)}</div></div>
      </div>

      <div className="summary-grid">
        {/* Top categories */}
        <div className="summary-card">
          <div className="summary-card-title">By category</div>
          {stats.byCategory.length === 0 ? (
            <p style={{fontSize:13,color:'var(--ink3)'}}>No data</p>
          ) : stats.byCategory.map(c => (
            <div key={c.category} className="brand-row-s">
              <div style={{flex:1,marginRight:12}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{
                    fontSize:11,fontWeight:600,padding:'1px 7px',borderRadius:999,
                    background: CATEGORY_COLORS[c.category]?.bg ?? 'var(--cream2)',
                    color:      CATEGORY_COLORS[c.category]?.color ?? 'var(--ink2)',
                  }}>{CATEGORY_LABELS[c.category] ?? c.category}</span>
                  <span style={{fontSize:11,color:'var(--ink3)'}}>{c.count} receipt{c.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="bar-bg" style={{marginTop:5}}>
                  <div className="bar-fill" style={{width:`${(c.total/maxCat)*100}%`,background:CATEGORY_COLORS[c.category]?.color??'var(--green)'}}/>
                </div>
              </div>
              <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(c.total)}</div>
            </div>
          ))}
        </div>

        {/* Top 5 stores */}
        <div className="summary-card">
          <div className="summary-card-title">Top stores</div>
          {top5.length === 0 ? (
            <p style={{fontSize:13,color:'var(--ink3)'}}>No data</p>
          ) : top5.map((b, i) => (
            <div key={b.name} className="brand-row-s">
              <div style={{flex:1,minWidth:0,marginRight:12}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:11,color:'var(--ink3)',fontFamily:'var(--mono)',minWidth:14}}>#{i+1}</span>
                  <span style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</span>
                </div>
                <div style={{fontSize:11,color:'var(--ink3)',marginTop:1,paddingLeft:20}}>
                  {b.count} receipt{b.count !== 1 ? 's' : ''} · {((b.total/stats.totalSpent)*100).toFixed(0)}%
                </div>
              </div>
              <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(b.total)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 3 biggest receipts */}
      {top3rec.length > 0 && (
        <div className="summary-card" style={{marginBottom:20}}>
          <div className="summary-card-title">Biggest receipts</div>
          {top3rec.map(r => (
            <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500}}>{r.store_name}</div>
                <div style={{display:'flex',gap:6,marginTop:3,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{fontSize:11,color:'var(--ink3)'}}>{fmt(r.purchase_date)}</span>
                  {r.category && r.category !== 'other' && (
                    <span style={{fontSize:10,fontWeight:600,padding:'1px 6px',borderRadius:999,background:CATEGORY_COLORS[r.category]?.bg??'var(--cream2)',color:CATEGORY_COLORS[r.category]?.color??'var(--ink2)'}}>
                      {CATEGORY_LABELS[r.category]}
                    </span>
                  )}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                <span style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:14}}>{money(Number(r.total))}</span>
                <Link href={`/receipts/${r.id}`} style={{fontSize:12,color:'var(--green)',fontWeight:500}}>View →</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payer split — receipts + recurring combined */}
      {stats.byPayer.length > 0 && (
        <PayerSplitCard stats={stats} dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </div>
  )
}

// ── Analytics tab ──────────────────────────────────────────
function AnalyticsTab({ stats }: { stats: Stats }) {
  const [showYoY,   setShowYoY]   = useState(false)
  const [yoyData,   setYoyData]   = useState<Record<string, number>>({})
  const [yoyLoading,setYoyLoading]= useState(false)

  const maxBrand = stats.byBrand[0]?.total ?? 1
  const maxMonth = Math.max(...(stats.byMonth.map(m => m.total)), 1)

  // Load YoY data when toggled on
  useEffect(() => {
    if (!showYoY || stats.byMonth.length === 0) return
    setYoyLoading(true)
    const months = stats.byMonth.map(m => m.month)
    const minM = months[0], maxM = months[months.length - 1]
    const from = `${Number(minM.slice(0,4))-1}${minM.slice(4)}-01`
    const lastDay = new Date(Number(maxM.slice(0,4))-1, Number(maxM.slice(5,7)), 0).getDate()
    const to   = `${Number(maxM.slice(0,4))-1}${maxM.slice(4)}-${String(lastDay).padStart(2,'0')}`
    getSpendingStats(from, to).then(d => {
      const map: Record<string, number> = {}
      for (const m of d.byMonth) map[m.month] = m.total
      setYoyData(map)
    }).finally(() => setYoyLoading(false))
  }, [showYoY, stats.byMonth])

  // Compute store trends from byMonth data grouped by brand
  function storeTrend(brandKey: string): { dir: 'up' | 'down' | 'stable'; pct: number } | null {
    if (stats.byMonth.length < 2) return null
    // Simple heuristic: compare last month vs month before in receipts list
    const brandReceipts = stats.receipts.filter((r: any) => r.brand === brandKey && Number(r.total) > 0)
    const byMonth: Record<string, number> = {}
    for (const r of brandReceipts) {
      const m = r.purchase_date.slice(0, 7)
      byMonth[m] = (byMonth[m] ?? 0) + Number(r.total)
    }
    const mths = Object.keys(byMonth).sort()
    if (mths.length < 2) return null
    const last = byMonth[mths[mths.length-1]]
    const prev = byMonth[mths[mths.length-2]]
    if (!prev) return null
    const pct = ((last - prev) / prev) * 100
    if (pct > 10)  return { dir: 'up',   pct }
    if (pct < -10) return { dir: 'down', pct: Math.abs(pct) }
    return { dir: 'stable', pct: 0 }
  }

  return (
    <div>
      {/* Stats */}
      <div className="stat-grid" style={{marginBottom:20}}>
        <div className="stat-card"><div className="stat-label">Total spent</div><div className="stat-val" style={{fontSize:20}}>{money(stats.totalSpent)}</div></div>
        <div className="stat-card"><div className="stat-label">Receipts</div><div className="stat-val">{stats.receiptCount}</div><div className="stat-sub">across {stats.byBrand.length} store{stats.byBrand.length!==1?'s':''}</div></div>
        <div className="stat-card"><div className="stat-label">Avg per trip</div><div className="stat-val" style={{fontSize:20}}>{money(stats.avgPerTrip)}</div></div>
        <div className="stat-card"><div className="stat-label">Total saved</div><div className="stat-val" style={{color:'var(--green)',fontSize:20}}>{money(stats.totalSaved)}</div><div className="stat-sub">via discounts</div></div>
      </div>

      {/* By payer */}
      {stats.byPayer.length > 0 && (
        <div className="summary-card" style={{marginBottom:16}}>
          <div className="summary-card-title">By payer</div>
          {stats.byPayer.map(p => {
            const pct = (p.total / stats.totalSpent) * 100
            return (
              <div key={p.payer} className="brand-row-s">
                <div style={{flex:1,marginRight:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,background:PAYER_COLORS[p.payer]?.bg??'var(--cream2)',color:PAYER_COLORS[p.payer]?.color??'var(--ink2)'}}>
                      {p.payer}
                    </span>
                    <span style={{fontSize:11,color:'var(--ink3)'}}>{p.count} receipt{p.count!==1?'s':''} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="bar-bg" style={{marginTop:6}}>
                    <div className="bar-fill" style={{width:`${pct}%`,background:PAYER_COLORS[p.payer]?.color??'var(--green)'}}/>
                  </div>
                </div>
                <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(p.total)}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="summary-grid">
        {/* By store with trend arrows */}
        <div className="summary-card">
          <div className="summary-card-title">By store</div>
          {stats.byBrand.map(b => {
            const trend = storeTrend(b.brand)
            return (
              <div key={b.name} className="brand-row-s">
                <div style={{flex:1,marginRight:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{fontSize:13,fontWeight:500}}>{b.name}</div>
                    {trend && trend.dir !== 'stable' && (
                      <span style={{fontSize:11,fontWeight:700,color: trend.dir==='up'?'var(--red)':'var(--green)'}}>
                        {trend.dir==='up' ? '↑' : '↓'} {trend.pct.toFixed(0)}%
                      </span>
                    )}
                    {trend?.dir === 'stable' && <span style={{fontSize:11,color:'var(--ink3)'}}>→</span>}
                  </div>
                  <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>{b.count} receipt{b.count!==1?'s':''}</div>
                  <div className="bar-bg">
                    <div className="bar-fill" style={{width:`${(b.total/maxBrand)*100}%`}}/>
                  </div>
                </div>
                <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(b.total)}</div>
              </div>
            )
          })}
        </div>

        {/* By month with YoY toggle */}
        <div className="summary-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <div className="summary-card-title" style={{marginBottom:0}}>By month</div>
            <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--ink2)',cursor:'pointer'}}>
              <input
                type="checkbox"
                checked={showYoY}
                onChange={e => setShowYoY(e.target.checked)}
                style={{accentColor:'var(--green)',width:12,height:12}}
              />
              vs last year
            </label>
          </div>
          {stats.byMonth.length === 0 ? (
            <p style={{fontSize:13,color:'var(--ink3)'}}>No data</p>
          ) : stats.byMonth.map(m => {
            const prevYear = `${Number(m.month.slice(0,4))-1}${m.month.slice(4)}`
            const prevVal  = yoyData[prevYear]
            const maxVal   = Math.max(maxMonth, showYoY && prevVal ? prevVal : 0)
            return (
              <div key={m.month} className="month-row">
                <div style={{flex:1,marginRight:12}}>
                  <div style={{fontSize:13,color:'var(--ink2)'}}>{fmtMonthShort(m.month)}</div>
                  <div style={{position:'relative',height:6,marginTop:4}}>
                    {showYoY && prevVal && !yoyLoading && (
                      <div style={{position:'absolute',inset:0,background:'var(--cream3)',borderRadius:3,width:`${(prevVal/maxVal)*100}%`,opacity:.6}}/>
                    )}
                    <div className="bar-fill" style={{position:'absolute',inset:0,width:`${(m.total/maxVal)*100}%`,background:'var(--green)',borderRadius:3}}/>
                  </div>
                  {showYoY && prevVal && !yoyLoading && (
                    <div style={{fontSize:10,color:'var(--ink3)',marginTop:2,display:'flex',gap:8}}>
                      <span>This yr: {money(m.total)}</span>
                      <span>Last yr: {money(prevVal)}</span>
                    </div>
                  )}
                </div>
                <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:13,whiteSpace:'nowrap'}}>{money(m.total)}</div>
              </div>
            )
          })}
          {showYoY && <div style={{display:'flex',gap:14,marginTop:10,fontSize:11,color:'var(--ink3)'}}>
            <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:12,height:4,background:'var(--green)',borderRadius:2,display:'inline-block'}}/> This year</span>
            <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:12,height:4,background:'var(--cream3)',borderRadius:2,display:'inline-block'}}/> Last year</span>
          </div>}
        </div>
      </div>

      {/* Heatmap */}
      <SpendingHeatmap />

      {/* Receipt list */}
      <div style={{marginTop:24,marginBottom:8}}>
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
              <th>Paid by</th>
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
                <td>
                  {r.paid_by ? (
                    <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap',background:PAYER_COLORS[r.paid_by]?.bg??'var(--cream2)',color:PAYER_COLORS[r.paid_by]?.color??'var(--ink2)'}}>
                      {r.paid_by}
                    </span>
                  ) : <span style={{color:'var(--ink3)',fontSize:12}}>—</span>}
                </td>
                <td style={{textAlign:'right'}}>
                  <div style={{fontFamily:'var(--mono)',fontWeight:500}}>{money(Number(r.total))}</div>
                  <div style={{fontSize:11,marginTop:2}}>
                    <Link href={`/receipts/${r.id}`} style={{color:'var(--green)',fontWeight:500,textDecoration:'none'}}>View →</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────
export default function SpendingPage() {
  const [tab,      setTab]      = useState<'summary' | 'analytics' | 'budget'>('summary')
  const [stats,    setStats]    = useState<Stats | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [preset,   setPreset]   = useState('Last 3 months')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [showDigest, setShowDigest] = useState(false)

  const load = useCallback(async (from?: string, to?: string) => {
    setLoading(true)
    try { setStats(await getSpendingStats(from, to)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const to   = toISO(new Date())
    const from = toISO(new Date(Date.now() - 90 * 86400000))
    setDateFrom(from); setDateTo(to)
    load(from, to)

    // Monthly digest: show once per month on first open after the 1st
    const cur = nowMonth()
    const last = localStorage.getItem('digest_shown_month')
    const today = new Date().getDate()
    if (last !== cur && today <= 7) setShowDigest(true)
  }, [load])

  function applyPreset(label: string, days: number) {
    setPreset(label)
    const to   = toISO(new Date())
    const from = days === 0 ? '' : toISO(new Date(Date.now() - days * 86400000))
    setDateFrom(from); setDateTo(to)
    load(from || undefined, to)
  }

  function applyRange(from: string, to: string) {
    setPreset('')
    setDateFrom(from); setDateTo(to)
    if (from && to) load(from, to)
  }

  function dismissDigest() {
    localStorage.setItem('digest_shown_month', nowMonth())
    setShowDigest(false)
  }

  return (
    <main className="page">
      {showDigest && <MonthlyDigest onDismiss={dismissDigest} />}

      <div className="pg-head">
        <span className="pg-title">Spending</span>
        <span className="pg-sub">
          {stats ? `${stats.receiptCount} receipt${stats.receiptCount !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Date filter — hidden for budget tab */}
      {tab !== 'budget' && (
        <div className="date-pills">
          {PRESETS.map(p => (
            <button key={p.label} className={`date-pill ${preset === p.label ? 'active' : ''}`} onClick={() => applyPreset(p.label, p.days)}>
              {p.label}
            </button>
          ))}
          <div className="date-range">
            <input type="date" value={dateFrom} onChange={e => applyRange(e.target.value, dateTo)}/>
            <span>→</span>
            <input type="date" value={dateTo}   onChange={e => applyRange(dateFrom, e.target.value)}/>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{display:'flex',gap:4,marginBottom:20,background:'var(--cream2)',borderRadius:999,padding:4,width:'fit-content'}}>
        <SubTab label="Summary"   active={tab==='summary'}   onClick={() => setTab('summary')}/>
        <SubTab label="Analytics" active={tab==='analytics'} onClick={() => setTab('analytics')}/>
        <SubTab label="Budget"    active={tab==='budget'}    onClick={() => setTab('budget')}/>
      </div>

      {tab === 'budget' ? (
        <BudgetTab />
      ) : loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : !stats || stats.receiptCount === 0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" strokeLinecap="round"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round"/></svg>
          <p style={{fontWeight:500}}>No spending in this period</p>
          <p style={{fontSize:13}}>Try a wider date range</p>
        </div>
      ) : (
        <>
          {tab === 'summary'   && <SummaryTab   stats={stats} dateFrom={dateFrom} dateTo={dateTo} />}
          {tab === 'analytics' && <AnalyticsTab stats={stats} />}
        </>
      )}
    </main>
  )
}
