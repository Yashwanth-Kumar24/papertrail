'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  getRecurring, addRecurring, updateRecurring, deleteRecurring,
  markRecurringPaid, markRecurringUnpaid,
  getRecurringPaymentHistory, addRecurringPaymentManual, deleteRecurringPayment,
} from '@/lib/queries'
import { PAYERS, PAYER_COLORS, CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/types'
import type { RecurringBill, RecurringPayment } from '@/lib/types'

const money   = (n: number) => `$${Number(n).toFixed(2)}`
const todayISO = () => new Date().toISOString().split('T')[0]

const FREQ_LABELS: Record<string, string> = {
  monthly: 'Monthly', annual: 'Annual', weekly: 'Weekly', quarterly: 'Quarterly',
}

function toMonthly(bill: RecurringBill): number {
  if (bill.frequency === 'monthly')   return bill.amount
  if (bill.frequency === 'annual')    return bill.amount / 12
  if (bill.frequency === 'weekly')    return bill.amount * 4.33
  if (bill.frequency === 'quarterly') return bill.amount / 3
  return bill.amount
}

// ── Derived due info — reads pre-computed fields from getRecurring() ──────────
function getDueInfo(bill: RecurringBill): { label: string; color: string; daysUntil: number | null } {
  // Paid this cycle: always show green paid badge, never amber warning
  if (bill.paidThisCycle && bill.cyclePayment) {
    const paid = new Date(bill.cyclePayment.paid_at)
    return {
      label: `Paid · ${paid.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      color: 'var(--green)',
      daysUntil: null,
    }
  }

  // Unpaid: compute days until next due date (= day after cycleEnd)
  if (!bill.cycleEnd) {
    if (bill.frequency === 'weekly') return { label: 'Due weekly', color: 'var(--ink3)', daysUntil: 7 }
    return { label: 'No due date', color: 'var(--ink3)', daysUntil: null }
  }

  const now     = new Date(); now.setHours(0, 0, 0, 0)
  const nextDue = new Date(bill.cycleEnd + 'T00:00:00')
  nextDue.setDate(nextDue.getDate() + 1) // cycleEnd is last day of cycle; next due = day after

  const diff = Math.round((nextDue.getTime() - now.getTime()) / 86400000)
  if (diff < 0)   return { label: 'Overdue',          color: 'var(--red)',  daysUntil: diff }
  if (diff === 0) return { label: 'Due today',         color: 'var(--red)',  daysUntil: 0    }
  if (diff <= 7)  return { label: `Due in ${diff}d`,   color: '#D97706',     daysUntil: diff }
  return {
    label: `Due ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    color: 'var(--ink3)',
    daysUntil: diff,
  }
}

// ── Payment history section ────────────────────────────────
function PaymentHistory({ bill, onChanged }: { bill: RecurringBill; onChanged: () => void }) {
  const [history,   setHistory]   = useState<RecurringPayment[]>([])
  const [loading,   setLoading]   = useState(true)
  const [adding,    setAdding]    = useState(false)
  const [newDate,   setNewDate]   = useState(todayISO())
  const [newPayer,  setNewPayer]  = useState(PAYERS[0] ?? '')
  const [newAmount, setNewAmount] = useState(String(bill.amount))
  const [saving,    setSaving]    = useState(false)
  const [confirmDel,setConfirmDel]= useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await getRecurringPaymentHistory(bill.id)) }
    finally { setLoading(false) }
  }, [bill.id])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    if (!newPayer) return
    setSaving(true)
    try {
      await addRecurringPaymentManual(bill.id, newPayer, newDate, parseFloat(newAmount) || bill.amount)
      await load()
      onChanged()
      setAdding(false)
      setNewDate(todayISO())
      setNewAmount(String(bill.amount))
    } finally { setSaving(false) }
  }

  async function handleDelete(paymentId: string) {
    await deleteRecurringPayment(paymentId)
    await load()
    onChanged()
    setConfirmDel(null)
  }

  return (
    <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginTop:4}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em'}}>
          Payment history
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          style={{fontSize:12,fontWeight:600,color:'var(--green)',background:'none',border:'1px solid var(--green)',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}
        >
          {adding ? 'Cancel' : '+ Log payment'}
        </button>
      </div>

      {/* Add payment inline form */}
      {adding && (
        <div style={{background:'var(--cream2)',borderRadius:'var(--r)',padding:'12px 14px',marginBottom:12}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',marginBottom:4}}>Paid on</div>
              <input type="date" value={newDate} max={todayISO()} onChange={e=>setNewDate(e.target.value)}
                style={{width:'100%',fontSize:13,padding:'5px 8px',border:'1px solid var(--border)',borderRadius:'var(--r)',background:'#fff'}}/>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',marginBottom:4}}>Amount</div>
              <input type="number" step="0.01" value={newAmount} onChange={e=>setNewAmount(e.target.value)}
                style={{width:'100%',fontSize:13,padding:'5px 8px',border:'1px solid var(--border)',borderRadius:'var(--r)',background:'#fff',fontFamily:'var(--mono)',textAlign:'right'}}/>
            </div>
          </div>
          <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',marginBottom:6}}>Who paid?</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
            {PAYERS.map(p => (
              <button key={p} onClick={()=>setNewPayer(p)} style={{
                padding:'5px 12px',borderRadius:999,fontSize:12,fontWeight:600,cursor:'pointer',
                border:`2px solid ${newPayer===p ? PAYER_COLORS[p]?.color : 'var(--border)'}`,
                background: newPayer===p ? PAYER_COLORS[p]?.bg : 'transparent',
                color:      newPayer===p ? PAYER_COLORS[p]?.color : 'var(--ink2)',
              }}>{p}</button>
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !newPayer}
            style={{width:'100%',padding:'8px',borderRadius:'var(--r)',border:'none',background:'var(--green)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}
          >
            {saving ? 'Saving…' : 'Save payment'}
          </button>
        </div>
      )}

      {/* History list */}
      {loading ? (
        <p style={{fontSize:13,color:'var(--ink3)'}}>Loading…</p>
      ) : history.length === 0 ? (
        <p style={{fontSize:13,color:'var(--ink3)',fontStyle:'italic'}}>No payments recorded yet. Tap "+ Log payment" to add one.</p>
      ) : history.map(p => (
        <div key={p.id}>
          {confirmDel === p.id ? (
            <div style={{display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid var(--border)',background:'var(--red-bg)',borderRadius:4,padding:'6px 10px',marginBottom:2}}>
              <span style={{flex:1,fontSize:12,color:'var(--red-tx)'}}>Delete this entry?</span>
              <button onClick={()=>setConfirmDel(null)} style={{fontSize:12,background:'none',border:'none',color:'var(--red-tx)',cursor:'pointer'}}>Cancel</button>
              <button onClick={()=>handleDelete(p.id)} style={{fontSize:12,fontWeight:600,background:'var(--red)',color:'#fff',border:'none',borderRadius:4,padding:'3px 10px',cursor:'pointer'}}>Delete</button>
            </div>
          ) : (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--border)',gap:8}}>
              <span style={{fontSize:12,color:'var(--ink3)',minWidth:88,flexShrink:0}}>
                {new Date(p.paid_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              </span>
              <span style={{
                fontSize:10,fontWeight:600,padding:'1px 8px',borderRadius:999,flexShrink:0,
                background:PAYER_COLORS[p.paid_by]?.bg??'var(--cream2)',
                color:PAYER_COLORS[p.paid_by]?.color??'var(--ink2)',
              }}>{p.paid_by}</span>
              <span style={{flex:1,fontFamily:'var(--mono)',fontSize:12,fontWeight:500,textAlign:'right'}}>
                {money(Number(p.amount))}
              </span>
              <button
                onClick={()=>setConfirmDel(p.id)}
                style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:16,lineHeight:1,padding:'0 2px',flexShrink:0}}
                title="Delete this payment"
              >×</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Bill card ──────────────────────────────────────────────
function BillCard({ bill, onEdit, onPaid, onUnpaid }: {
  bill:     RecurringBill
  onEdit:   (b: RecurringBill) => void
  onPaid:   (id: string, paidBy: string, paidAt: string) => void
  onUnpaid: (id: string) => void
}) {
  const due    = getDueInfo(bill)
  const isPaid = bill.paidThisCycle ?? false
  const [picking,  setPicking]  = useState(false)
  const [paidDate, setPaidDate] = useState(todayISO())

  return (
    <div
      onClick={() => onEdit(bill)}
      style={{background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'14px 16px',cursor:'pointer',transition:'border-color .12s',position:'relative'}}
      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--border2)'}
      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--border)'}
    >
      <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
        <button
          onClick={e=>{e.stopPropagation(); if(isPaid){onUnpaid(bill.id)}else{setPaidDate(todayISO());setPicking(true)}}}
          style={{width:22,height:22,borderRadius:'50%',flexShrink:0,marginTop:1,border:`2px solid ${isPaid?'var(--green)':'var(--border2)'}`,background:isPaid?'var(--green)':'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}
          title={isPaid?'Tap to undo':'Mark as paid'}
        >
          {isPaid&&<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><polyline points="2 5.5 4.5 8 9 3" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>

        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontSize:14,fontWeight:600}}>{bill.name}</span>
            <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:999,background:CATEGORY_COLORS[bill.category]?.bg??'var(--cream2)',color:CATEGORY_COLORS[bill.category]?.color??'var(--ink2)'}}>
              {CATEGORY_LABELS[bill.category]??bill.category}
            </span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
            <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:999,background:PAYER_COLORS[bill.paid_by]?.bg??'var(--cream2)',color:PAYER_COLORS[bill.paid_by]?.color??'var(--ink2)'}}>
              {bill.paid_by}
            </span>
            <span style={{fontSize:12,color:'var(--ink3)'}}>{FREQ_LABELS[bill.frequency]}</span>
            <span style={{fontSize:12,fontWeight:600,color:due.color}}>{due.label}</span>
          </div>
        </div>

        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:15,fontWeight:600}}>{money(bill.amount)}</div>
          {bill.frequency!=='monthly'&&<div style={{fontSize:10,color:'var(--ink3)',marginTop:1}}>~{money(toMonthly(bill))}/mo</div>}
        </div>
      </div>

      {/* Payer + date picker */}
      {picking&&(
        <>
          <div onClick={e=>{e.stopPropagation();setPicking(false)}} style={{position:'fixed',inset:0,zIndex:50}}/>
          <div onClick={e=>e.stopPropagation()} style={{position:'absolute',top:'100%',left:36,zIndex:60,marginTop:6,background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'14px 16px',boxShadow:'0 4px 16px rgba(0,0,0,0.10)',minWidth:220}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5}}>Paid on</div>
            <input type="date" value={paidDate} max={todayISO()} onChange={e=>setPaidDate(e.target.value)} onClick={e=>e.stopPropagation()}
              style={{width:'100%',marginBottom:12,fontSize:13,padding:'5px 8px',border:'1px solid var(--border)',borderRadius:'var(--r)',background:'#fff'}}/>
            <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8}}>Who paid?</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {PAYERS.map(p=>(
                <button key={p} onClick={()=>{onPaid(bill.id,p,paidDate);setPicking(false)}} style={{
                  padding:'5px 12px',borderRadius:999,fontSize:12,fontWeight:600,cursor:'pointer',border:'2px solid',
                  borderColor:PAYER_COLORS[p]?.color??'var(--border)',
                  background:PAYER_COLORS[p]?.bg??'var(--cream2)',
                  color:PAYER_COLORS[p]?.color??'var(--ink)',
                }}>{p}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Add/Edit form ──────────────────────────────────────────
const BLANK: Omit<RecurringBill,'id'|'created_at'|'paidThisCycle'|'cycleStart'|'cycleEnd'|'cyclePayment'> = {
  name:'',amount:0,frequency:'monthly',due_day:undefined,due_date:undefined,
  paid_by:PAYERS[0]??'',category:'other',notes:'',active:true,
}

function BillForm({ initial, onSave, onDelete, onCancel, bill }: {
  initial:  typeof BLANK
  onSave:   (data: typeof BLANK) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
  bill?:    RecurringBill
}) {
  const [form,    setForm]    = useState(initial)
  const [saving,  setSaving]  = useState(false)
  const [deleting,setDeleting]= useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err,     setErr]     = useState('')
  // Track if bill data changed so PaymentHistory can reload
  const [histKey, setHistKey] = useState(0)

  function set(k: keyof typeof form, v: any) { setForm(p=>({...p,[k]:v})) }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Name is required.'); return }
    if (!form.amount)      { setErr('Amount is required.'); return }
    if (!form.paid_by)     { setErr('Paid by is required.'); return }
    setSaving(true); setErr('')
    try { await onSave(form) } catch(e:any) { setErr(e.message??'Save failed.') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    try { await onDelete() } catch { setDeleting(false) }
  }

  const inputStyle = {fontSize:13,padding:'7px 10px',border:'1px solid var(--border)',borderRadius:'var(--r)',width:'100%',background:'#fff'}
  const lbl = (txt: string) => <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase' as const,letterSpacing:'.05em',marginBottom:5}}>{txt}</div>

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:999,display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={onCancel}>
      <div style={{background:'#fff',borderRadius:'var(--rl) var(--rl) 0 0',padding:'24px 24px 32px',width:'100%',maxWidth:520,maxHeight:'92vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <h3 style={{fontSize:16,fontWeight:600,marginBottom:20}}>{bill ? 'Edit bill' : 'Add recurring bill'}</h3>

        {err&&<div style={{padding:'8px 12px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13,marginBottom:12}}>{err}</div>}

        <div style={{marginBottom:14}}>{lbl('Name')}
          <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Netflix, Rent, Car insurance…" style={inputStyle}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
          <div>{lbl('Amount')}
            <input type="number" step="0.01" min="0" value={form.amount||''} onChange={e=>set('amount',parseFloat(e.target.value)||0)} placeholder="0.00" style={{...inputStyle,fontFamily:'var(--mono)'}}/>
          </div>
          <div>{lbl('Frequency')}
            <select value={form.frequency} onChange={e=>set('frequency',e.target.value)} style={{...inputStyle,cursor:'pointer'}}>
              {(['monthly','annual','weekly','quarterly'] as const).map(f=><option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
            </select>
          </div>
        </div>
        {form.frequency==='monthly'&&(
          <div style={{marginBottom:14}}>{lbl('Due day of month')}
            <input type="number" min="1" max="31" value={form.due_day||''} onChange={e=>set('due_day',parseInt(e.target.value)||undefined)} placeholder="e.g. 1 or 15" style={inputStyle}/>
          </div>
        )}
        {(form.frequency==='annual'||form.frequency==='quarterly')&&(
          <div style={{marginBottom:14}}>{lbl('Due date')}
            <input type="date" value={form.due_date||''} onChange={e=>set('due_date',e.target.value||undefined)} style={inputStyle}/>
          </div>
        )}
        <div style={{marginBottom:14}}>{lbl('Paid by')}
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {PAYERS.map(p=>(
              <button key={p} onClick={()=>set('paid_by',p)} style={{
                padding:'6px 14px',borderRadius:999,fontSize:13,fontWeight:600,cursor:'pointer',
                border:`2px solid ${form.paid_by===p?PAYER_COLORS[p]?.color:'var(--border)'}`,
                background:form.paid_by===p?PAYER_COLORS[p]?.bg:'transparent',
                color:form.paid_by===p?PAYER_COLORS[p]?.color:'var(--ink2)',
              }}>{p}</button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:14}}>{lbl('Category')}
          <select value={form.category} onChange={e=>set('category',e.target.value)} style={{...inputStyle,cursor:'pointer'}}>
            {CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div style={{marginBottom:20}}>{lbl('Notes (optional)')}
          <input value={form.notes||''} onChange={e=>set('notes',e.target.value.slice(0,280))} placeholder="e.g. auto-renews annually" maxLength={280} style={inputStyle}/>
        </div>

        <div style={{display:'flex',gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:'10px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{flex:2,padding:'10px',borderRadius:'var(--r)',border:'none',background:'var(--green)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
            {saving?'Saving…':'Save'}
          </button>
        </div>

        {bill&&!confirm&&(
          <button onClick={()=>setConfirm(true)} style={{marginTop:12,width:'100%',padding:'8px',background:'none',border:'none',color:'var(--red)',fontSize:12,cursor:'pointer'}}>
            Delete this bill
          </button>
        )}
        {confirm&&(
          <div style={{marginTop:12,padding:'12px',background:'var(--red-bg)',borderRadius:'var(--r)',display:'flex',gap:10,alignItems:'center'}}>
            <span style={{flex:1,fontSize:13,color:'var(--red-tx)'}}>Delete "{form.name}"?</span>
            <button onClick={()=>setConfirm(false)} style={{fontSize:12,background:'none',border:'none',color:'var(--red-tx)',cursor:'pointer'}}>Cancel</button>
            <button onClick={handleDelete} disabled={deleting} style={{fontSize:12,fontWeight:600,background:'var(--red)',color:'#fff',border:'none',borderRadius:6,padding:'5px 12px',cursor:'pointer'}}>
              {deleting?'Deleting…':'Yes, delete'}
            </button>
          </div>
        )}

        {/* Payment history — only shown in edit mode */}
        {bill&&(
          <PaymentHistory
            key={histKey}
            bill={bill}
            onChanged={()=>setHistKey(k=>k+1)}
          />
        )}
      </div>
    </div>
  )
}

// ── Analytics section ──────────────────────────────────────
function RecurringAnalytics({ bills }: { bills: RecurringBill[] }) {
  if (bills.length === 0) return null

  const monthly = bills.reduce((s, b) => s + toMonthly(b), 0)

  // By category
  const catMap = new Map<string, number>()
  for (const b of bills) {
    catMap.set(b.category, (catMap.get(b.category)??0) + toMonthly(b))
  }
  const byCategory = [...catMap.entries()]
    .map(([cat, total]) => ({ cat, total }))
    .sort((a, b) => b.total - a.total)
  const maxCat = byCategory[0]?.total ?? 1

  return (
    <div className="summary-grid" style={{marginBottom:20}}>
      <div className="summary-card">
        <div className="summary-card-title">By category</div>
        {byCategory.map(({cat,total}) => (
          <div key={cat} className="brand-row-s">
            <div style={{flex:1,marginRight:12}}>
              <span style={{fontSize:11,fontWeight:600,padding:'1px 7px',borderRadius:999,background:CATEGORY_COLORS[cat]?.bg??'var(--cream2)',color:CATEGORY_COLORS[cat]?.color??'var(--ink2)'}}>
                {CATEGORY_LABELS[cat]??cat}
              </span>
              <div className="bar-bg" style={{marginTop:5}}>
                <div className="bar-fill" style={{width:`${(total/maxCat)*100}%`,background:CATEGORY_COLORS[cat]?.color??'var(--green)'}}/>
              </div>
            </div>
            <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:12,whiteSpace:'nowrap'}}>{money(total)}/mo</div>
          </div>
        ))}
      </div>

      <div className="summary-card">
        <div className="summary-card-title">Monthly breakdown</div>
        {bills.map(b => (
          <div key={b.id} className="brand-row-s">
            <div style={{flex:1,minWidth:0,marginRight:12}}>
              <div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.name}</div>
              <div style={{fontSize:11,color:'var(--ink3)',marginTop:1}}>{FREQ_LABELS[b.frequency]}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:12}}>{money(toMonthly(b))}/mo</div>
              {b.frequency!=='monthly'&&<div style={{fontSize:10,color:'var(--ink3)'}}>{money(b.amount)} {b.frequency}</div>}
            </div>
          </div>
        ))}
        <div style={{borderTop:'1px solid var(--border)',marginTop:8,paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--ink2)'}}>Total/mo</span>
          <span style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:14}}>{money(monthly)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────
export default function RecurringPage() {
  const [bills,   setBills]   = useState<RecurringBill[]>([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState<{ mode:'add'|'edit'; bill:RecurringBill|null }|null>(null)

  const load = useCallback(async () => {
    try { setBills(await getRecurring()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(data: typeof BLANK) {
    if (form?.mode==='edit'&&form.bill) await updateRecurring(form.bill.id, data)
    else await addRecurring(data)
    await load(); setForm(null)
  }

  async function handleDelete() {
    if (!form?.bill) return
    await deleteRecurring(form.bill.id)
    await load(); setForm(null)
  }

  async function handlePaid(id: string, paidBy: string, paidAt: string) {
    await markRecurringPaid(id, paidBy, paidAt)
    await load()
  }

  async function handleUnpaid(id: string) {
    await markRecurringUnpaid(id)
    await load()
  }

  // Stats
  const monthly    = bills.reduce((s,b)=>s+toMonthly(b),0)
  const dueSoonCnt = bills.filter(b => {
    const d = getDueInfo(b)
    return !b.paidThisCycle && d.daysUntil !== null && d.daysUntil >= 0 && d.daysUntil <= 3
  }).length

  // Sections
  const dueSoon = bills.filter(b => {
    const d = getDueInfo(b)
    return !b.paidThisCycle && d.daysUntil !== null && d.daysUntil >= 0 && d.daysUntil <= 3
  })
  const monthly_ = bills.filter(b=>b.frequency==='monthly'&&!dueSoon.includes(b))
  const annual_  = bills.filter(b=>b.frequency==='annual' &&!dueSoon.includes(b))
  const other_   = bills.filter(b=>!['monthly','annual'].includes(b.frequency)&&!dueSoon.includes(b))

  function Section({ title, items }: { title:string; items:RecurringBill[] }) {
    if (!items.length) return null
    return (
      <div style={{marginBottom:20}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>{title}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {items.map(b=><BillCard key={b.id} bill={b} onEdit={b=>setForm({mode:'edit',bill:b})} onPaid={handlePaid} onUnpaid={handleUnpaid}/>)}
        </div>
      </div>
    )
  }

  return (
    <main className="page">
      {form&&(
        <BillForm
          initial={form.mode==='edit'&&form.bill ? {
            name:form.bill.name,amount:form.bill.amount,frequency:form.bill.frequency,
            due_day:form.bill.due_day,due_date:form.bill.due_date,paid_by:form.bill.paid_by,
            category:form.bill.category,notes:form.bill.notes,active:form.bill.active,
          } : BLANK}
          onSave={handleSave}
          onDelete={form.mode==='edit'?handleDelete:undefined}
          onCancel={()=>setForm(null)}
          bill={form.bill??undefined}
        />
      )}

      <div className="pg-head">
        <span className="pg-title">Recurring</span>
        <button onClick={()=>setForm({mode:'add',bill:null})} className="btn-primary" style={{fontSize:13,padding:'7px 16px'}}>
          + Add bill
        </button>
      </div>

      <div className="stat-grid" style={{marginBottom:24}}>
        <div className="stat-card"><div className="stat-label">Monthly total</div><div className="stat-val" style={{fontSize:20}}>{money(monthly)}</div></div>
        <div className="stat-card"><div className="stat-label">Due this week</div><div className="stat-val" style={{color:dueSoonCnt>0?'#D97706':'inherit'}}>{dueSoonCnt}</div></div>
        <div className="stat-card"><div className="stat-label">Annual total</div><div className="stat-val" style={{fontSize:18}}>{money(monthly*12)}</div></div>
        <div className="stat-card"><div className="stat-label">Active bills</div><div className="stat-val">{bills.length}</div></div>
      </div>

      {loading ? (
        <div className="empty"><p>Loading…</p></div>
      ) : bills.length===0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <p style={{fontWeight:500}}>No recurring bills</p>
          <p style={{fontSize:13}}>Add rent, subscriptions, utilities — anything you pay regularly</p>
        </div>
      ) : (
        <>
          <RecurringAnalytics bills={bills} />
          <Section title="Due soon" items={dueSoon} />
          <Section title="Monthly" items={monthly_} />
          <Section title="Annual"  items={annual_} />
          <Section title="Other"   items={other_} />
        </>
      )}
    </main>
  )
}
