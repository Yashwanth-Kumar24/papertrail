'use client'
import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  getReceipts, getReceiptMeta, getStats,
  deleteReceipt, deleteReceipts, getAllReceiptIds, RECEIPTS_PAGE_SIZE,
} from '@/lib/queries'
import type { ReceiptSort, ReturnFilter } from '@/lib/queries'
import type { Receipt } from '@/lib/types'
import { PAYER_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, CATEGORIES } from '@/lib/types'

const fmt   = (iso: string) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
const money = (n: number) => `$${Number(n).toFixed(2)}`
const toISO = (d: Date) => d.toISOString().split('T')[0]

const DATE_PRESETS = [
  { label: 'All time',      days: 0   },
  { label: 'This week',     days: 7   },
  { label: 'This month',    days: 30  },
  { label: 'Last 3 months', days: 90  },
  { label: 'This year',     days: 365 },
  { label: 'Custom',        days: -1  },
]

// Reverse-maps a from/to pair back to whichever preset pill it matches, so a
// filter state restored from the URL (bookmark, back-navigation) highlights
// the right pill instead of always defaulting to "All time." Presets are
// relative to "today," so this only matches exactly on the day the range was
// set — falls back to "Custom" otherwise, which is honest (the dates are
// still shown and applied correctly either way).
function presetForDates(df: string, dt: string): string {
  if (!df && !dt) return 'All time'
  for (const p of DATE_PRESETS) {
    if (p.days <= 0) continue
    if (df === toISO(new Date(Date.now() - p.days * 86400000)) && dt === toISO(new Date())) return p.label
  }
  return 'Custom'
}

function buildQuery(params: Record<string, string>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:12,padding:'24px 28px',maxWidth:360,width:'90%'}}>
        <h3 style={{fontSize:16,fontWeight:600,marginBottom:8}}>Delete receipt?</h3>
        <p style={{fontSize:13,color:'var(--ink2)',marginBottom:20}}>
          Permanently deletes the receipt, all items, and any saved image. Cannot be undone.
        </p>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={onConfirm} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red-bg)',color:'var(--red-tx)',fontSize:13,fontWeight:600,cursor:'pointer'}}>Yes, delete</button>
        </div>
      </div>
    </div>
  )
}


function ReceiptsPageContent() {
  const router      = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [receipts,      setReceipts]      = useState<Receipt[]>([])
  const [totalCount,    setTotalCount]    = useState(0)
  const [offset,        setOffset]        = useState(0)
  const [loadingMore,   setLoadingMore]   = useState(false)
  const [allMeta,       setAllMeta]       = useState<{ store_name: string; purchase_date: string; paid_by: string | null; source: string; category: string; total: number }[]>([])
  const [stats,         setStats]         = useState({ receipts:0, total:0, items:0, savings:0 })
  const [storeName,     setStoreName]     = useState(() => searchParams.get('store') ?? '')
  const [dateFrom,      setDateFrom]      = useState(() => searchParams.get('from') ?? '')
  const [dateTo,        setDateTo]        = useState(() => searchParams.get('to') ?? '')
  const [datePreset,    setDatePreset]    = useState(() => presetForDates(searchParams.get('from') ?? '', searchParams.get('to') ?? ''))
  const [paidBy,        setPaidBy]        = useState(() => searchParams.get('payer') ?? '')
  const [loading,       setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [selected,      setSelected]      = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [sortBy,        setSortBy]        = useState<ReceiptSort>(() => (searchParams.get('sort') as ReceiptSort) || 'date_desc')
  const [sourceFilter,   setSourceFilter]   = useState(() => searchParams.get('source') ?? '')
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') ?? '')
  const [returnFilter,   setReturnFilter]   = useState<'' | ReturnFilter>(() => (searchParams.get('kind') as ReturnFilter) || '')
  const [selectingAll,   setSelectingAll]   = useState(false)

  // Race guard: rapid filter/sort changes (or a stale "Load more" click that
  // resolves after a filter change) can otherwise let an older response land
  // after a newer one and overwrite fresh state with stale data. Combines two
  // layers per standard practice — AbortController cancels the actual network
  // request (saves backend work once this runs against a large receipt
  // history), and a generation counter is the authoritative guard for
  // anything that resolves anyway (e.g. an abort landing just after the
  // response already started processing).
  const abortRef = useRef<AbortController | null>(null)
  const genRef    = useRef(0)

  const loadPage = useCallback(async (
    sn: string, df: string, dt: string, pb: string,
    off: number, append: boolean,
    sort: ReceiptSort = 'date_desc', src?: string, cat?: string, kind?: ReturnFilter,
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const myGen = ++genRef.current

    if (!append) setLoading(true); else setLoadingMore(true)
    try {
      const [{ data, totalCount: tc }, s] = await Promise.all([
        getReceipts(sn || undefined, df || undefined, dt || undefined, pb || undefined, off, sort, src, cat, controller.signal, kind),
        off === 0 ? getStats(sn || undefined, df || undefined, dt || undefined, pb || undefined, src, cat, controller.signal, kind) : Promise.resolve(null),
      ])
      if (genRef.current !== myGen) return // superseded by a newer request — discard
      setReceipts(prev => append ? [...prev, ...data] : data)
      setTotalCount(tc)
      setOffset(off)
      if (s) setStats(s)
    } catch (e: any) {
      if (e?.name === 'AbortError' || genRef.current !== myGen) return // cancelled or superseded — not a real error
      throw e
    } finally {
      // Only the most recent request gets to clear the loading flags — an
      // older, superseded request finishing late must not hide a spinner
      // for work the newer request may still be doing.
      if (genRef.current === myGen) {
        if (!append) setLoading(false); else setLoadingMore(false)
      }
    }
  }, [])

  // Facet source for the coordinated dropdowns — fetched once per mount, not
  // on every filter/sort change. It only needs to change when the underlying
  // receipt set changes (add/delete), which the mutation handlers refresh
  // explicitly below. Re-fetching the whole table on every filter click was
  // the main cost driver on this page once receipt count gets large.
  useEffect(() => {
    getReceiptMeta().then(setAllMeta)
  }, [])

  useEffect(() => {
    setSelected(new Set())
    loadPage(storeName, dateFrom, dateTo, paidBy, 0, false, sortBy, sourceFilter || undefined, categoryFilter || undefined, returnFilter || undefined)
  }, [storeName, dateFrom, dateTo, paidBy, sortBy, sourceFilter, categoryFilter, returnFilter, loadPage])

  // Keep every filter/sort choice in the URL (same pattern already used on
  // the Prices page) so navigating to a receipt and back — or bookmarking,
  // sharing, hitting refresh — restores the exact filtered view instead of
  // resetting to defaults. router.replace targets the current pathname
  // (not a hardcoded /receipts) since this component is also embedded in
  // /expenses' Receipts sub-tab.
  useEffect(() => {
    const qs = buildQuery({
      store:    storeName,
      from:     dateFrom,
      to:       dateTo,
      payer:    paidBy,
      sort:     sortBy === 'date_desc' ? '' : sortBy,
      source:   sourceFilter,
      category: categoryFilter,
      kind:     returnFilter,
    })
    router.replace(`${pathname}${qs}`, { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeName, dateFrom, dateTo, paidBy, sortBy, sourceFilter, categoryFilter, returnFilter])

  // Filter allMeta by active date range + source + category + kind for coordinated dropdowns
  const filteredMeta = useMemo(() => {
    let src = allMeta
    if (dateFrom)       src = src.filter(m => m.purchase_date >= dateFrom)
    if (dateTo)         src = src.filter(m => m.purchase_date <= dateTo)
    if (sourceFilter)   src = src.filter(m => m.source === sourceFilter)
    if (categoryFilter) src = src.filter(m => m.category === categoryFilter)
    if (returnFilter === 'purchases') src = src.filter(m => Number(m.total) >= 0)
    if (returnFilter === 'returns')   src = src.filter(m => Number(m.total) <  0)
    return src
  }, [allMeta, dateFrom, dateTo, sourceFilter, categoryFilter, returnFilter])

  const availableStores = useMemo(() => {
    let src = filteredMeta
    if (paidBy) src = src.filter(m => m.paid_by === paidBy)
    return [...new Set(src.map(m => m.store_name))].sort()
  }, [filteredMeta, paidBy])

  const availablePayers = useMemo(() => {
    let src = filteredMeta
    if (storeName) src = src.filter(m => m.store_name === storeName)
    return [...new Set(src.map(m => m.paid_by).filter(Boolean))].sort() as string[]
  }, [filteredMeta, storeName])

  function applyPreset(label: string, days: number) {
    setDatePreset(label)
    if (days === 0) {
      setDateFrom(''); setDateTo('')
    } else if (days > 0) {
      setDateTo(toISO(new Date()))
      setDateFrom(toISO(new Date(Date.now() - days * 86400000)))
    }
    // days === -1 means Custom — keep current dates, user edits manually
  }

  function handleStoreChange(s: string) {
    setStoreName(s)
    // Reset paidBy if no longer valid under new store + current filters
    const sub = (s ? filteredMeta.filter(m => m.store_name === s) : filteredMeta)
    if (paidBy && !sub.some(m => m.paid_by === paidBy)) setPaidBy('')
  }
  function handlePayerChange(p: string) {
    setPaidBy(p)
    // Reset storeName if no longer valid under new payer + current filters
    const sub = (p ? filteredMeta.filter(m => m.paid_by === p) : filteredMeta)
    if (storeName && !sub.some(m => m.store_name === storeName)) setStoreName('')
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await deleteReceipt(id)
      setReceipts(prev => prev.filter(r => r.id !== id))
      setTotalCount(c => c - 1)
      const [m, s] = await Promise.all([
        getReceiptMeta(),
        getStats(storeName||undefined, dateFrom||undefined, dateTo||undefined, paidBy||undefined, sourceFilter||undefined, categoryFilter||undefined, undefined, returnFilter||undefined),
      ])
      setAllMeta(m); setStats(s)
    } catch { alert('Delete failed. Please try again.') }
    finally { setDeleting(null); setConfirmDelete(null) }
  }

  async function handleBatchDelete() {
    if (!selected.size) return
    setBatchDeleting(true)
    try {
      await deleteReceipts([...selected])
      setReceipts(prev => prev.filter(r => !selected.has(r.id)))
      setTotalCount(c => c - selected.size)
      setSelected(new Set())
      const [m, s] = await Promise.all([
        getReceiptMeta(),
        getStats(storeName||undefined, dateFrom||undefined, dateTo||undefined, paidBy||undefined, sourceFilter||undefined, categoryFilter||undefined, undefined, returnFilter||undefined),
      ])
      setAllMeta(m); setStats(s)
    } catch {
      // deleteReceipts() runs in chunks — a failure partway through can leave
      // some of the selection genuinely deleted in the DB while local state
      // was never updated to reflect it (the setReceipts/setTotalCount above
      // never ran). An alert alone would leave the UI stale; reload page 1
      // from the server so what's shown matches DB truth again.
      alert('Batch delete failed partway through — reloading to show what was actually deleted.')
      setSelected(new Set())
      loadPage(storeName, dateFrom, dateTo, paidBy, 0, false, sortBy, sourceFilter || undefined, categoryFilter || undefined, returnFilter || undefined)
    }
    finally { setBatchDeleting(false) }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSelectAll() {
    if (totalCount === receipts.length) {
      setSelected(new Set(receipts.map(r => r.id)))
    } else {
      setSelectingAll(true)
      try {
        const ids = await getAllReceiptIds(
          storeName || undefined, dateFrom || undefined, dateTo || undefined,
          paidBy || undefined, sourceFilter || undefined, categoryFilter || undefined,
          returnFilter || undefined,
        )
        setSelected(new Set(ids))
      } catch { alert('Could not select all. Try again.') }
      finally { setSelectingAll(false) }
    }
  }

  const hasMore = receipts.length < totalCount

  return (
    <main className="page">
      {confirmDelete && (
        <DeleteConfirm onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)}/>
      )}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Receipts</div><div className="stat-val">{stats.receipts}</div></div>
        <div className="stat-card">
          <div className="stat-label">Total spent</div>
          <div className="stat-val" style={{fontSize:18,color:stats.total<0?'var(--red-tx)':'inherit'}}>
            {stats.total < 0 ? `−${money(Math.abs(stats.total))}` : money(stats.total)}
          </div>
        </div>
        <div className="stat-card"><div className="stat-label">Line items</div><div className="stat-val">{stats.items}</div></div>
        <div className="stat-card"><div className="stat-label">Saved</div><div className="stat-val" style={{color:'var(--green)',fontSize:18}}>{money(stats.savings)}</div></div>
      </div>

      <div className="pg-head">
        <span className="pg-title">Receipts</span>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <Link
            href="/costco"
            style={{
              fontSize:12,fontWeight:600,padding:'5px 12px',borderRadius:999,
              background:'#005DAA',color:'#fff',textDecoration:'none',
              display:'inline-flex',alignItems:'center',gap:5,flexShrink:0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
            Costco
          </Link>
          <span className="pg-sub">
            {loading ? '' : `${receipts.length}${totalCount > receipts.length ? ` of ${totalCount}` : ''} shown`}
          </span>
        </div>
      </div>

      {/* Store + payer dropdowns */}
      <div className="filters">
        <select className="fsel" value={storeName} onChange={e => handleStoreChange(e.target.value)}>
          <option value="">All stores</option>
          {availableStores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="fsel" value={paidBy} onChange={e => handlePayerChange(e.target.value)}>
          <option value="">All payers</option>
          {availablePayers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Date range — preset pills */}
      <div style={{display:'flex',gap:6,marginBottom: datePreset === 'Custom' ? 8 : 14,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em',marginRight:4}}>Date range</span>
        {DATE_PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p.label, p.days)}
            style={{
              fontSize:12,padding:'4px 11px',borderRadius:999,
              border:`1px solid ${datePreset===p.label ? 'var(--ink)' : 'var(--border2)'}`,
              background: datePreset===p.label ? 'var(--ink)' : 'transparent',
              color:      datePreset===p.label ? 'var(--cream)' : 'var(--ink2)',
              fontWeight: datePreset===p.label ? 600 : 400,
              cursor:'pointer', fontFamily:'var(--sans)',
            }}
          >{p.label}</button>
        ))}
      </div>
      {datePreset === 'Custom' && (
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
          <input
            type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            style={{fontSize:12,padding:'5px 8px',border:'1px solid var(--border)',borderRadius:'var(--r)'}}
          />
          <span style={{color:'var(--ink3)',fontSize:13}}>→</span>
          <input
            type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            style={{fontSize:12,padding:'5px 8px',border:'1px solid var(--border)',borderRadius:'var(--r)'}}
          />
        </div>
      )}

      {/* Sort pills */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {([
          { key:'date_desc',  label:'Newest first' },
          { key:'date_asc',   label:'Oldest first' },
          { key:'total_desc', label:'$ High → Low'  },
          { key:'total_asc',  label:'$ Low → High'  },
        ] as {key: ReceiptSort; label: string}[]).map(s => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            style={{
              fontSize:12,padding:'4px 11px',borderRadius:999,border:'1px solid var(--border2)',
              background: sortBy === s.key ? 'var(--green)' : 'transparent',
              color:      sortBy === s.key ? '#fff' : 'var(--ink2)',
              fontWeight: sortBy === s.key ? 600 : 400,
              cursor:'pointer',fontFamily:'var(--sans)',
            }}
          >{s.label}</button>
        ))}
      </div>

      {/* Category filter pills */}
      <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
        <button
          onClick={() => setCategoryFilter('')}
          style={{
            fontSize:12,padding:'4px 11px',borderRadius:999,
            border:`1px solid ${!categoryFilter ? 'var(--ink)' : 'var(--border2)'}`,
            background: !categoryFilter ? 'var(--ink)' : 'transparent',
            color:      !categoryFilter ? 'var(--cream)' : 'var(--ink2)',
            cursor:'pointer',fontFamily:'var(--sans)',fontWeight: !categoryFilter ? 600 : 400,
          }}
        >All</button>
        {CATEGORIES.map(cat => {
          const active = categoryFilter === cat
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(active ? '' : cat)}
              style={{
                fontSize:12,padding:'4px 11px',borderRadius:999,
                border:`1px solid ${active ? CATEGORY_COLORS[cat]?.color : 'var(--border2)'}`,
                background: active ? CATEGORY_COLORS[cat]?.bg  : 'transparent',
                color:      active ? CATEGORY_COLORS[cat]?.color : 'var(--ink2)',
                fontWeight: active ? 600 : 400,
                cursor:'pointer',fontFamily:'var(--sans)',
              }}
            >{CATEGORY_LABELS[cat]}</button>
          )
        })}
      </div>

      {/* Purchases / Returns filter */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em',marginRight:4}}>Kind</span>
        {([
          { key: '',           label: 'All' },
          { key: 'purchases',  label: 'Purchases' },
          { key: 'returns',    label: 'Returns' },
        ] as { key: '' | ReturnFilter; label: string }[]).map(k => {
          const active = returnFilter === k.key
          return (
            <button
              key={k.key || 'all'}
              onClick={() => setReturnFilter(k.key as '' | ReturnFilter)}
              style={{
                fontSize:12,padding:'4px 11px',borderRadius:999,
                border:`1px solid ${active ? 'var(--red-tx)' : 'var(--border2)'}`,
                background: active ? 'var(--red-tx)' : 'transparent',
                color:      active ? '#fff' : 'var(--ink2)',
                fontWeight: active ? 600 : 400,
                cursor:'pointer',fontFamily:'var(--sans)',
              }}
            >{k.label}</button>
          )
        })}
      </div>

      {/* Source filter + select-all in one row */}
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {([
          { key: '',           label: 'All' },
          { key: 'scan',       label: 'Scanned' },
          { key: 'manual',     label: 'Manual' },
          { key: 'costco_api', label: 'Costco Import' },
        ]).map(s => {
          const active = sourceFilter === s.key
          const color  = s.key === 'costco_api' ? '#005DAA' : 'var(--green)'
          return (
            <button
              key={s.key}
              onClick={() => setSourceFilter(s.key)}
              style={{
                fontSize:12, padding:'4px 11px', borderRadius:999,
                border:`1px solid ${active ? color : 'var(--border2)'}`,
                background: active ? color : 'transparent',
                color:      active ? '#fff' : 'var(--ink2)',
                fontWeight: active ? 600 : 400,
                cursor:'pointer', fontFamily:'var(--sans)',
              }}
            >{s.label}</button>
          )
        })}

        {/* Select all */}
        {!loading && receipts.length > 0 && (
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            {selected.size > 0 && (
              <>
                <span style={{fontSize:12,color:'var(--ink2)'}}>
                  <strong>{selected.size}</strong> of {totalCount}
                </span>
                <button
                  onClick={() => setSelected(new Set())}
                  style={{fontSize:12,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',padding:0}}
                >Clear</button>
              </>
            )}
            {selected.size < totalCount && (
              <button
                onClick={handleSelectAll}
                disabled={selectingAll}
                style={{fontSize:12,color:'var(--ink2)',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 12px',cursor:'pointer',flexShrink:0}}
              >
                {selectingAll ? 'Selecting…' : `Select all ${totalCount}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Batch delete bar */}
      {selected.size > 0 && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--red-bg)',borderRadius:'var(--r)',marginBottom:12}}>
          <span style={{fontSize:13,color:'var(--red-tx)',flex:1}}>{selected.size} receipt{selected.size !== 1 ? 's' : ''} selected</span>
          <button onClick={() => setSelected(new Set())} style={{fontSize:12,background:'none',border:'none',color:'var(--red-tx)',cursor:'pointer'}}>Cancel</button>
          <button
            onClick={handleBatchDelete}
            disabled={batchDeleting}
            style={{fontSize:12,fontWeight:600,background:'var(--red-tx)',color:'#fff',border:'none',borderRadius:6,padding:'5px 14px',cursor:'pointer'}}
          >
            {batchDeleting ? 'Deleting…' : `Delete ${selected.size}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : receipts.length === 0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p style={{fontWeight:500}}>No receipts yet</p>
          <p style={{fontSize:13}}>Scan your first receipt to get started</p>
        </div>
      ) : (
        <>
          <div className="rcard-grid">
            {receipts.map(r => (
              <div key={r.id} className="rcard">
                <Link href={`/receipts/${r.id}`} prefetch={false} style={{textDecoration:'none',color:'inherit',display:'block'}}>
                  <div className="rcard-head">
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        <div className="rcard-store">{r.store_name}</div>
                        {Number(r.total) < 0 && (
                          <span style={{fontSize:9,fontWeight:700,background:'var(--red-bg)',color:'var(--red-tx)',padding:'2px 6px',borderRadius:999,flexShrink:0}}>REFUND</span>
                        )}
                      </div>
                      {r.location && <div className="rcard-meta">{r.location}</div>}
                      <div className="rcard-meta">
                        {fmt(r.purchase_date)}
                        {r.purchase_time ? ` · ${r.purchase_time.slice(0,5)}` : ''}
                        {r.itemCount != null && r.itemCount > 0 ? ` · ${r.itemCount} items` : ''}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,flexWrap:'wrap'}}>
                        {r.paid_by && (
                          <span style={{
                            fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:999,
                            background: PAYER_COLORS[r.paid_by]?.bg ?? 'var(--cream2)',
                            color:      PAYER_COLORS[r.paid_by]?.color ?? 'var(--ink2)',
                          }}>
                            {r.paid_by}
                          </span>
                        )}
                        {r.category && r.category !== 'other' && (
                          <span style={{
                            fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:999,
                            background: CATEGORY_COLORS[r.category]?.bg ?? 'var(--cream2)',
                            color:      CATEGORY_COLORS[r.category]?.color ?? 'var(--ink2)',
                          }}>
                            {CATEGORY_LABELS[r.category] ?? r.category}
                          </span>
                        )}
                        {(r.totalSavings ?? 0) > 0 && (
                          <span style={{fontSize:11,fontWeight:600,color:'var(--green)'}}>
                            Saved {money(r.totalSavings!)}
                          </span>
                        )}
                      </div>
                      {r.notes && (
                        <div style={{fontSize:11,color:'var(--ink3)',fontStyle:'italic',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          📝 {r.notes}
                        </div>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0,paddingLeft:12}}>
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); toggleSelect(r.id) }}
                        style={{
                          width:18,height:18,borderRadius:4,
                          border:`2px solid ${selected.has(r.id) ? 'var(--green)' : 'var(--border2)'}`,
                          background: selected.has(r.id) ? 'var(--green)' : 'transparent',
                          cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                          padding:0,flexShrink:0,
                        }}
                        aria-label="Select"
                      >
                        {selected.has(r.id) && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <polyline points="1.5 5 4 7.5 8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                      <div className="rcard-total" style={{color:Number(r.total)<0?'var(--red-tx)':'inherit'}}>
                        {Number(r.total) < 0 ? `−${money(Math.abs(Number(r.total)))}` : money(r.total)}
                      </div>
                    </div>
                  </div>
                </Link>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:8,marginTop:4,borderTop:'1px solid var(--border)'}}>
                  <Link href={`/receipts/${r.id}`} prefetch={false} style={{fontSize:13,fontWeight:500,color:'var(--green)',textDecoration:'none'}}>
                    View receipt →
                  </Link>
                  <button
                    onClick={() => setConfirmDelete(r.id)}
                    disabled={deleting === r.id}
                    style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:12,fontWeight:500,padding:'2px 4px',borderRadius:4}}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink3)')}
                  >
                    {deleting === r.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{textAlign:'center',marginTop:20}}>
              <button
                onClick={() => loadPage(storeName, dateFrom, dateTo, paidBy, offset + RECEIPTS_PAGE_SIZE, true, sortBy, sourceFilter || undefined, categoryFilter || undefined, returnFilter || undefined)}
                disabled={loadingMore}
                style={{
                  background:'none',border:'1px solid var(--border)',borderRadius:'var(--r)',
                  padding:'9px 28px',fontSize:13,color:'var(--ink2)',cursor:'pointer',
                  fontFamily:'var(--sans)',
                }}
              >
                {loadingMore ? 'Loading…' : `Load more (${totalCount - receipts.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

export default function ReceiptsPage() {
  return (
    <Suspense fallback={<main className="page"><div className="empty"><p>Loading…</p></div></main>}>
      <ReceiptsPageContent />
    </Suspense>
  )
}
