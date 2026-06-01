'use client'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  getReceipts, getReceiptMeta,
  getStats, deleteReceipt
} from '@/lib/queries'
import type { Receipt } from '@/lib/types'
import { PAYER_COLORS } from '@/lib/types'

const fmt   = (iso: string) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
const money = (n: number) => `$${Number(n).toFixed(2)}`

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:12,padding:'24px 28px',maxWidth:360,width:'90%'}}>
        <h3 style={{fontSize:16,fontWeight:600,marginBottom:8}}>Delete receipt?</h3>
        <p style={{fontSize:13,color:'var(--ink2)',marginBottom:20}}>
          Permanently deletes the receipt, all items, and any saved image. Cannot be undone.
        </p>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red-bg)',color:'var(--red-tx)',fontSize:13,fontWeight:600,cursor:'pointer'}}>
            Yes, delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const [receipts,      setReceipts]      = useState<Receipt[]>([])
  const [allMeta,       setAllMeta]       = useState<{ store_name: string; purchase_date: string; paid_by: string | null }[]>([])
  const [stats,         setStats]         = useState({ receipts:0, total:0, items:0, savings:0 })
  const [storeName,     setStoreName]     = useState('')
  const [date,          setDate]          = useState('')
  const [paidBy,        setPaidBy]        = useState('')
  const [loading,       setLoading]       = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getReceiptMeta(), getStats()])
      .then(([m, s]) => { setAllMeta(m); setStats(s) })
  }, [])

  useEffect(() => {
    setLoading(true)
    getReceipts(storeName || undefined, date || undefined, paidBy || undefined)
      .then(setReceipts)
      .finally(() => setLoading(false))
  }, [storeName, date, paidBy])

  // Each dropdown is filtered by the OTHER two active selections
  const availableStores = useMemo(() => {
    let src = allMeta
    if (date)   src = src.filter(m => m.purchase_date === date)
    if (paidBy) src = src.filter(m => m.paid_by === paidBy)
    return [...new Set(src.map(m => m.store_name))].sort()
  }, [allMeta, date, paidBy])

  const availableDates = useMemo(() => {
    let src = allMeta
    if (storeName) src = src.filter(m => m.store_name === storeName)
    if (paidBy)    src = src.filter(m => m.paid_by === paidBy)
    return [...new Set(src.map(m => m.purchase_date))].sort().reverse()
  }, [allMeta, storeName, paidBy])

  const availablePayers = useMemo(() => {
    let src = allMeta
    if (storeName) src = src.filter(m => m.store_name === storeName)
    if (date)      src = src.filter(m => m.purchase_date === date)
    return [...new Set(src.map(m => m.paid_by).filter(Boolean))].sort() as string[]
  }, [allMeta, storeName, date])

  function handleStoreChange(s: string) {
    setStoreName(s)
    const sub = s ? allMeta.filter(m => m.store_name === s) : allMeta
    if (date   && !sub.some(m => m.purchase_date === date))   setDate('')
    if (paidBy && !sub.some(m => m.paid_by === paidBy))       setPaidBy('')
  }

  function handleDateChange(d: string) {
    setDate(d)
    const sub = d ? allMeta.filter(m => m.purchase_date === d) : allMeta
    if (storeName && !sub.some(m => m.store_name === storeName)) setStoreName('')
    if (paidBy    && !sub.some(m => m.paid_by === paidBy))       setPaidBy('')
  }

  function handlePayerChange(p: string) {
    setPaidBy(p)
    const sub = p ? allMeta.filter(m => m.paid_by === p) : allMeta
    if (storeName && !sub.some(m => m.store_name === storeName)) setStoreName('')
    if (date      && !sub.some(m => m.purchase_date === date))   setDate('')
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await deleteReceipt(id)
      setReceipts(prev => prev.filter(r => r.id !== id))
      const [m, s] = await Promise.all([getReceiptMeta(), getStats()])
      setAllMeta(m); setStats(s)
    } catch {
      alert('Delete failed. Please try again.')
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  return (
    <main className="page">
      {confirmDelete && (
        <DeleteConfirm
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Receipts</div><div className="stat-val">{stats.receipts}</div></div>
        <div className="stat-card"><div className="stat-label">Total spent</div><div className="stat-val" style={{fontSize:18}}>{money(stats.total)}</div></div>
        <div className="stat-card"><div className="stat-label">Line items</div><div className="stat-val">{stats.items}</div></div>
        <div className="stat-card"><div className="stat-label">Saved</div><div className="stat-val" style={{color:'var(--green)',fontSize:18}}>{money(stats.savings)}</div></div>
      </div>

      <div className="pg-head">
        <span className="pg-title">Receipts</span>
        <span className="pg-sub">{receipts.length} shown</span>
      </div>

      <div className="filters">
        <select className="fsel" value={storeName} onChange={e => handleStoreChange(e.target.value)}>
          <option value="">All stores</option>
          {availableStores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="fsel" value={date} onChange={e => handleDateChange(e.target.value)}>
          <option value="">All dates</option>
          {availableDates.map(d => <option key={d} value={d}>{fmt(d)}</option>)}
        </select>
        <select className="fsel" value={paidBy} onChange={e => handlePayerChange(e.target.value)}>
          <option value="">All payers</option>
          {availablePayers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : receipts.length === 0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p style={{fontWeight:500}}>No receipts yet</p>
          <p style={{fontSize:13}}>Scan your first receipt to get started</p>
        </div>
      ) : (
        <div className="rcard-grid">
          {receipts.map(r => (
            <div key={r.id} className="rcard">
              <Link href={`/receipts/${r.id}`} style={{textDecoration:'none',color:'inherit',display:'block'}}>
                <div className="rcard-head">
                  <div>
                    <div className="rcard-store">{r.store_name}</div>
                    {r.location && <div className="rcard-meta">{r.location}</div>}
                    <div className="rcard-meta">
                      {fmt(r.purchase_date)}
                      {r.purchase_time ? ` · ${r.purchase_time.slice(0,5)}` : ''}
                    </div>
                    {r.paid_by && (
                      <span style={{
                        display:'inline-block',marginTop:4,
                        fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:999,
                        background: PAYER_COLORS[r.paid_by]?.bg ?? 'var(--cream2)',
                        color:      PAYER_COLORS[r.paid_by]?.color ?? 'var(--ink2)',
                      }}>
                        {r.paid_by}
                      </span>
                    )}
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div className="rcard-total">{money(r.total)}</div>
                  </div>
                </div>
                <div className="rcard-txn">
                  <span>{r.transaction_id ? `Txn: ${r.transaction_id}` : 'No txn ID'}</span>
                </div>
              </Link>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:8,marginTop:4,borderTop:'1px solid var(--border)'}}>
                <Link href={`/receipts/${r.id}`} style={{fontSize:13,fontWeight:500,color:'var(--green)',textDecoration:'none'}}>
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
      )}
    </main>
  )
}