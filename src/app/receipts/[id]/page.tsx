'use client'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { getReceiptById, deleteReceipt, updateReceipt, replaceReceiptItems } from '@/lib/queries'
import type { Receipt, ReceiptItem } from '@/lib/types'
import { PAYER_COLORS, PAYERS, BRAND_LABELS, CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/types'

const Barcode = dynamic(() => import('react-barcode'), { ssr: false })

const fmt   = (iso: string) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
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
          <button onClick={onCancel} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={onConfirm} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red-bg)',color:'var(--red-tx)',fontSize:13,fontWeight:600,cursor:'pointer'}}>Yes, delete</button>
        </div>
      </div>
    </div>
  )
}

type EditItem = {
  item_code: string
  name: string
  original_price: number
  discount_amount: number
  final_price: number
  quantity: number
}

function toEditItem(i: ReceiptItem): EditItem {
  return {
    item_code:       i.item_code ?? '',
    name:            i.name,
    original_price:  i.original_price,
    discount_amount: i.discount_amount,
    final_price:     i.final_price,
    quantity:        i.quantity ?? 1,
  }
}

const inputStyle = {
  fontSize:13, padding:'3px 7px', border:'1px solid var(--border)',
  borderRadius:4, fontFamily:'var(--sans)', width:'100%', background:'#fff',
}

export default function ReceiptDetail() {
  const { id }     = useParams<{ id: string }>()
  const router     = useRouter()
  const [receipt,  setReceipt]  = useState<Receipt | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [confirm,  setConfirm]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({})

  // Edit state
  const [editing,     setEditing]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [editErr,     setEditErr]     = useState('')
  const [editStore,   setEditStore]   = useState('')
  const [editBrand,   setEditBrand]   = useState('')
  const [editLocation,setEditLocation]= useState('')
  const [editDate,    setEditDate]    = useState('')
  const [editTime,    setEditTime]    = useState('')
  const [editTotal,   setEditTotal]   = useState('')
  const [editTax,     setEditTax]     = useState('')
  const [editPaidBy,   setEditPaidBy]   = useState('')
  const [editCategory, setEditCategory] = useState('other')
  const [editNotes,    setEditNotes]    = useState('')
  const [editItems,    setEditItems]    = useState<EditItem[]>([])

  useEffect(() => {
    getReceiptById(id).then(setReceipt).finally(() => setLoading(false))
  }, [id])

  function startEdit(r: Receipt) {
    setEditStore(r.store_name)
    setEditBrand(r.brand)
    setEditLocation(r.location ?? '')
    setEditDate(r.purchase_date)
    setEditTime(r.purchase_time?.slice(0,5) ?? '')
    setEditTotal(String(r.total))
    setEditTax(r.tax != null ? String(r.tax) : '')
    setEditPaidBy(r.paid_by ?? '')
    setEditCategory(r.category ?? 'other')
    setEditNotes(r.notes ?? '')
    setEditItems((r.receipt_items ?? []).map(toEditItem))
    setEditErr('')
    setEditing(true)
  }

  function cancelEdit() { setEditing(false); setEditErr('') }

  async function saveEdit() {
    if (!receipt) return
    if (!editStore.trim()) { setEditErr('Store name is required.'); return }
    if (!editDate)         { setEditErr('Date is required.'); return }
    if (!editPaidBy)       { setEditErr('Paid by is required.'); return }
    setSaving(true); setEditErr('')
    try {
      await updateReceipt(id, {
        brand:         editBrand,
        store_name:    editStore.trim(),
        location:      editLocation.trim() || undefined,
        purchase_date: editDate,
        purchase_time: editTime || undefined,
        total:         parseFloat(editTotal) || 0,
        tax:           editTax !== '' ? (parseFloat(editTax) || 0) : undefined,
        paid_by:       editPaidBy,
        category:      editCategory || 'other',
        notes:         editNotes.trim() || undefined,
      })
      await replaceReceiptItems(id, editItems.filter(i => i.name.trim()))
      const updated = await getReceiptById(id)
      setReceipt(updated)
      setEditing(false)
    } catch (e: any) {
      setEditErr(e.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function updateEditItem(idx: number, field: keyof EditItem, value: string) {
    setEditItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      if (field === 'name' || field === 'item_code') return { ...item, [field]: value }
      const num = parseFloat(value) || 0
      if (field === 'original_price') {
        const disc = Math.max(0, num - item.final_price)
        return { ...item, original_price: num, discount_amount: disc }
      }
      if (field === 'final_price') {
        const disc = Math.max(0, item.original_price - num)
        return { ...item, final_price: num, discount_amount: disc }
      }
      return { ...item, [field]: num }
    }))
  }

  function removeEditItem(idx: number) { setEditItems(prev => prev.filter((_, i) => i !== idx)) }
  function addEditItem() {
    setEditItems(prev => [...prev, { item_code:'', name:'', original_price:0, discount_amount:0, final_price:0, quantity:1 }])
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteReceipt(id)
      router.push('/receipts')
    } catch {
      alert('Delete failed.')
      setDeleting(false)
      setConfirm(false)
    }
  }

  if (loading) return <main className="page"><div className="empty"><p>Loading…</p></div></main>
  if (!receipt) return <main className="page"><div className="empty"><p>Receipt not found.</p></div></main>

  const items      = receipt.receipt_items ?? []
  const discounted = items.filter(i => i.discount_amount > 0)
  const isReturn = Number(receipt.total) < 0
  const hasQty   = items.some(i => i.quantity !== 1)

  function handleShare() {
    const r     = receipt!
    const url   = window.location.href
    const title = `${r.store_name} · $${Number(r.total).toFixed(2)}`
    const text  = `${new Date(r.purchase_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${r.store_name} · $${Number(r.total).toFixed(2)}`
    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  const SOURCE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
    scan:       { label: 'Scanned',       bg: '#E8F5EF', color: '#1D6F50' },
    manual:     { label: 'Manual Entry',  bg: 'var(--cream2)', color: 'var(--ink2)' },
    costco_api: { label: 'Costco Import', bg: '#E8F0F8', color: '#005DAA' },
  }
  const sourceBadge = SOURCE_BADGE[receipt.source] ?? null

  return (
    <main className="page">
      {confirm && <DeleteConfirm onConfirm={handleDelete} onCancel={() => setConfirm(false)}/>}

      {/* Top bar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,gap:10,flexWrap:'wrap'}}>
        <button className="back-link" onClick={() => router.back()}>← Back</button>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {editing ? (
            <>
              <button
                onClick={cancelEdit}
                style={{padding:'7px 14px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',fontSize:13,cursor:'pointer'}}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{padding:'7px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startEdit(receipt)}
                style={{padding:'7px 14px',borderRadius:8,border:'1px solid var(--border2)',background:'transparent',fontSize:13,cursor:'pointer'}}
              >
                ✏️ Edit
              </button>
              <button
                onClick={handleShare}
                title={copied ? 'Link copied!' : 'Share receipt'}
                style={{
                  padding:'7px 12px',borderRadius:8,border:'1px solid var(--border2)',
                  background: copied ? 'var(--green-bg)' : 'transparent',
                  color: copied ? 'var(--green)' : 'var(--ink2)',
                  fontSize:15,cursor:'pointer',lineHeight:1,transition:'all .15s',
                }}
              >
                {copied ? '✓' : '↑'}
              </button>
              <button
                onClick={() => setConfirm(true)}
                disabled={deleting}
                style={{background:'var(--red-bg)',color:'var(--red-tx)',border:'none',borderRadius:8,padding:'7px 14px',fontSize:13,fontWeight:500,cursor:'pointer'}}
              >
                {deleting ? 'Deleting…' : '✕ Delete'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Return receipt banner */}
      {isReturn && !editing && (
        <div style={{padding:'10px 14px',background:'#FEF3C7',color:'#92400E',borderRadius:'var(--r)',fontSize:13,fontWeight:500,marginBottom:12}}>
          ↩ Return Receipt — ${Math.abs(Number(receipt.total)).toFixed(2)} refunded to Costco
        </div>
      )}

      {editErr && (
        <div style={{padding:'8px 14px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13,marginBottom:12}}>
          {editErr}
        </div>
      )}

      <div className="detail-wrap">
        {/* Left: metadata */}
        <div className="detail-side">
          {editing ? (
            <>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Store</div>
                <input value={editStore} onChange={e => setEditStore(e.target.value)} style={inputStyle} placeholder="Store name"/>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Brand</div>
                <select value={editBrand} onChange={e => setEditBrand(e.target.value)} style={{...inputStyle,cursor:'pointer'}}>
                  {Object.entries(BRAND_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Location</div>
                <input value={editLocation} onChange={e => setEditLocation(e.target.value)} style={inputStyle} placeholder="City, State"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Date</div>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={inputStyle}/>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Time</div>
                  <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} style={inputStyle}/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Total</div>
                  <input type="number" step="0.01" value={editTotal} onChange={e => setEditTotal(e.target.value)} style={{...inputStyle,fontFamily:'var(--mono)'}} placeholder="0.00"/>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Tax</div>
                  <input type="number" step="0.01" value={editTax} onChange={e => setEditTax(e.target.value)} style={{...inputStyle,fontFamily:'var(--mono)'}} placeholder="0.00"/>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Paid by</div>
                <select value={editPaidBy} onChange={e => setEditPaidBy(e.target.value)} style={{...inputStyle,cursor:'pointer'}}>
                  <option value="">— select —</option>
                  {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Category</div>
                <select value={editCategory} onChange={e => setEditCategory(e.target.value)} style={{...inputStyle,cursor:'pointer'}}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div style={{marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>Notes</div>
                <input value={editNotes} onChange={e => setEditNotes(e.target.value.slice(0,280))} placeholder="e.g. birthday dinner, work reimbursement…" maxLength={280} style={inputStyle}/>
              </div>
            </>
          ) : (
            <>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:8}}>
                <h2 style={{margin:0}}>{receipt.store_name}</h2>
                {sourceBadge && (
                  <span style={{fontSize:10,fontWeight:600,background:sourceBadge.bg,color:sourceBadge.color,padding:'3px 8px',borderRadius:999,flexShrink:0,whiteSpace:'nowrap',border:`1px solid ${sourceBadge.color}22`}}>
                    {sourceBadge.label}
                  </span>
                )}
              </div>
              {receipt.category && (
                <div style={{marginBottom:12}}>
                  <span style={{
                    fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999,
                    background: CATEGORY_COLORS[receipt.category]?.bg ?? 'var(--cream2)',
                    color:      CATEGORY_COLORS[receipt.category]?.color ?? 'var(--ink2)',
                  }}>
                    {CATEGORY_LABELS[receipt.category] ?? receipt.category}
                  </span>
                </div>
              )}
              {receipt.location && (
                <div className="meta-row">
                  <span className="meta-label">Location</span>
                  <span style={{textAlign:'right',fontSize:13}}>{receipt.location}</span>
                </div>
              )}
              <div className="meta-row"><span className="meta-label">Date</span><span>{fmt(receipt.purchase_date)}</span></div>
              {receipt.purchase_time && (
                <div className="meta-row"><span className="meta-label">Time</span><span className="meta-val">{receipt.purchase_time.slice(0,5)}</span></div>
              )}
              {receipt.transaction_id && (
                <div className="meta-row"><span className="meta-label">Txn ID</span><span className="meta-val" style={{fontSize:12}}>{receipt.transaction_id}</span></div>
              )}
              {receipt.source === 'costco_api' && (
                <div className="meta-row">
                  <span className="meta-label">Receipt</span>
                  <a
                    href="https://www.costco.com/myaccount/#/app/4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf/ordersandpurchases"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Opens Costco orders page — find this receipt by date"
                    style={{fontSize:12,color:'#005DAA',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4,fontWeight:500}}
                  >
                    View on Costco ↗
                  </a>
                </div>
              )}
              <div className="meta-row"><span className="meta-label">Items</span><span>{items.length}</span></div>
              {discounted.length > 0 && (
                <div className="meta-row">
                  <span className="meta-label">Savings</span>
                  <span style={{color:'var(--green)',fontFamily:'var(--mono)'}}>
                    {money(discounted.reduce((s,i) => s + i.discount_amount, 0))}
                  </span>
                </div>
              )}
              {receipt.tax != null && receipt.tax !== 0 && (
                <div className="meta-row">
                  <span className="meta-label">Tax</span>
                  <span className="meta-val" style={{color:Number(receipt.tax)<0?'var(--red-tx)':'inherit'}}>{money(Math.abs(Number(receipt.tax)))}</span>
                </div>
              )}
              {receipt.paid_by && (
                <div className="meta-row">
                  <span className="meta-label">Paid by</span>
                  <span style={{
                    fontSize:12,fontWeight:600,padding:'2px 10px',borderRadius:999,
                    background: PAYER_COLORS[receipt.paid_by]?.bg ?? 'var(--cream2)',
                    color:      PAYER_COLORS[receipt.paid_by]?.color ?? 'var(--ink2)',
                  }}>
                    {receipt.paid_by}
                  </span>
                </div>
              )}
              <div className="meta-row">
                <span className="meta-label">Total</span>
                <span className="meta-val" style={{color:isReturn?'var(--red-tx)':'inherit'}}>
                  {isReturn ? `−${money(Math.abs(Number(receipt.total)))}` : money(receipt.total)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Right: items */}
        <div className="tbl-wrap">
          {editing ? (
            <div>
              <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8}}>
                {editItems.length} items — edit inline
              </div>
              {editItems.map((item, i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'72px 1fr 80px 80px 28px',gap:4,padding:'5px 0',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
                  <input
                    value={item.item_code}
                    onChange={e => updateEditItem(i, 'item_code', e.target.value)}
                    placeholder="code"
                    style={{fontSize:11,padding:'3px 5px',fontFamily:'var(--mono)',background:'var(--cream2)',border:'1px solid var(--border)',borderRadius:4}}
                  />
                  <input
                    value={item.name}
                    onChange={e => updateEditItem(i, 'name', e.target.value)}
                    placeholder="item name"
                    style={{fontSize:12,padding:'3px 5px',border:'1px solid var(--border)',borderRadius:4}}
                  />
                  <input
                    type="number" step="0.01"
                    value={item.original_price || ''}
                    onChange={e => updateEditItem(i, 'original_price', e.target.value)}
                    placeholder="orig"
                    style={{fontSize:12,padding:'3px 5px',fontFamily:'var(--mono)',textAlign:'right',border:'1px solid var(--border)',borderRadius:4}}
                    title="Original price"
                  />
                  <input
                    type="number" step="0.01"
                    value={item.final_price || ''}
                    onChange={e => updateEditItem(i, 'final_price', e.target.value)}
                    placeholder="paid"
                    style={{fontSize:12,padding:'3px 5px',fontFamily:'var(--mono)',textAlign:'right',border:'1px solid var(--border)',borderRadius:4}}
                    title="Final price paid"
                  />
                  <button onClick={() => removeEditItem(i)}
                    style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:18,lineHeight:1,padding:0}}
                    aria-label="Remove item"
                  >×</button>
                </div>
              ))}
              <button onClick={addEditItem}
                style={{marginTop:8,background:'none',border:'1px dashed var(--border2)',borderRadius:'var(--r)',width:'100%',padding:'7px',fontSize:12,color:'var(--ink2)',cursor:'pointer'}}
              >
                + Add item
              </button>
              <div style={{fontSize:11,color:'var(--ink3)',marginTop:6}}>
                Orig = original price before discount · Paid = final price paid
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Item</th>
                  {hasQty && <th style={{textAlign:'right'}}>Qty</th>}
                  <th style={{textAlign:'right'}}>Original</th>
                  <th style={{textAlign:'right'}}>Discount</th>
                  <th style={{textAlign:'right'}}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const returned = item.final_price < 0
                  const adj      = isReturn && item.final_price > 0  // coupon reversal on a return receipt
                  return (
                    <tr key={item.id}
                      className={item.discount_amount > 0 ? 'disc-row' : ''}
                      style={{opacity: adj ? 0.55 : 1}}
                    >
                      <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
                      <td>
                        <div style={{fontWeight: item.discount_amount > 0 ? 500 : 400, color: returned ? 'var(--red-tx)' : 'inherit'}}>
                          {item.name}
                        </div>
                        {returned && <div style={{fontSize:10,fontWeight:700,color:'var(--red-tx)',marginTop:2}}>RETURNED</div>}
                        {adj      && <div style={{fontSize:10,color:'var(--ink3)',marginTop:1}}>adjustment</div>}
                      </td>
                      {hasQty && (
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',color:returned?'var(--red-tx)':'inherit'}}>
                          {item.quantity}
                        </td>
                      )}
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',color:item.discount_amount > 0 ? 'var(--ink2)':'inherit',textDecoration:item.discount_amount > 0 ? 'line-through':'none'}}>
                        {money(item.original_price)}
                      </td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--red)',fontWeight:item.discount_amount > 0 ? 600:400}}>
                        {item.discount_amount > 0 ? `−${money(item.discount_amount)}` : '—'}
                      </td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:returned?'var(--red-tx)':item.discount_amount > 0 ? 'var(--green)':'inherit'}}>
                        {returned
                          ? `−${money(Math.abs(item.final_price))}`
                          : money(item.final_price)}
                        {/* Show line total when quantity > 1 (e.g. 3 × $5.49 = $16.47) */}
                        {item.quantity > 1 && item.final_price > 0 && (
                          <div style={{fontSize:10,fontWeight:400,color:'var(--ink3)',marginTop:2}}>
                            ×{item.quantity} = {money(item.final_price * item.quantity)}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Notes */}
      {!editing && receipt.notes && (
        <div style={{marginTop:16,padding:'12px 16px',background:'var(--cream2)',borderRadius:'var(--r)',display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{fontSize:16,flexShrink:0}}>📝</span>
          <span style={{fontSize:13,color:'var(--ink2)',lineHeight:1.5}}>{receipt.notes}</span>
        </div>
      )}

      {/* Costco barcode — show at checkout instead of opening the Costco app */}
      {receipt.source === 'costco_api' && receipt.transaction_id && (
        <div style={{marginTop:24}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:12}}>
            Costco Barcode
          </div>
          <div style={{background:'#fff',borderRadius:12,border:'1px solid var(--border)',padding:'24px 20px',display:'inline-flex',flexDirection:'column',alignItems:'center',gap:8}}>
            <Barcode
              value={receipt.transaction_id}
              format="CODE128"
              width={2}
              height={80}
              displayValue={false}
              margin={0}
              background="#fff"
              lineColor="#1a1a1a"
            />
            <span style={{fontSize:11,color:'var(--ink3)',fontFamily:'var(--mono)',letterSpacing:'.05em'}}>
              {receipt.transaction_id}
            </span>
          </div>
          <p style={{fontSize:12,color:'var(--ink3)',marginTop:8}}>
            Show this to the Costco cashier instead of opening the Costco app.
          </p>
        </div>
      )}

      {/* Receipt images */}
      <div style={{marginTop:24}}>
        <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:12}}>
          Receipt image
        </div>
        {receipt.image_urls && receipt.image_urls.length > 0 ? (
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {receipt.image_urls.map((url, i) => (
              <div key={i}>
                {!imgErrors[i] ? (
                  <img
                    src={url}
                    alt={`Receipt ${i + 1}`}
                    onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                    onClick={() => window.open(url, '_blank')}
                    style={{height:320,width:'auto',borderRadius:8,border:'1px solid var(--border)',display:'block',objectFit:'contain',background:'var(--cream2)',cursor:'pointer'}}
                  />
                ) : (
                  <div style={{padding:'16px 20px',background:'var(--cream2)',borderRadius:8,border:'1px dashed var(--border2)',fontSize:13,color:'var(--ink3)'}}>
                    Image failed to load —{' '}
                    <span onClick={() => window.open(url, '_blank')} style={{color:'var(--green)',cursor:'pointer',textDecoration:'underline'}}>
                      open directly
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{padding:'20px 24px',background:'var(--cream2)',borderRadius:8,fontSize:13,color:'var(--ink3)',border:'1px dashed var(--border2)',display:'inline-block'}}>
            No image saved for this receipt
          </div>
        )}
      </div>
    </main>
  )
}
