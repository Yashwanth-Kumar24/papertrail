'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getReceiptById, deleteReceipt } from '@/lib/queries'
import type { Receipt } from '@/lib/types'

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

export default function ReceiptDetail() {
  const { id }     = useParams<{ id: string }>()
  const router     = useRouter()
  const [receipt,  setReceipt]  = useState<Receipt | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [confirm,  setConfirm]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({})

  useEffect(() => {
    getReceiptById(id).then(setReceipt).finally(() => setLoading(false))
  }, [id])

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

  return (
    <main className="page">
      {confirm && <DeleteConfirm onConfirm={handleDelete} onCancel={() => setConfirm(false)}/>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <button className="back-link" onClick={() => router.back()}>← Back to receipts</button>
        <button
          onClick={() => setConfirm(true)}
          disabled={deleting}
          style={{background:'var(--red-bg)',color:'var(--red-tx)',border:'none',borderRadius:8,padding:'7px 14px',fontSize:13,fontWeight:500,cursor:'pointer'}}
        >
          {deleting ? 'Deleting…' : '✕ Delete receipt'}
        </button>
      </div>

      <div className="detail-wrap">
        <div className="detail-side">
          <h2>{receipt.store_name}</h2>
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
          <div className="meta-row"><span className="meta-label">Items</span><span>{items.length}</span></div>
          {discounted.length > 0 && (
            <div className="meta-row">
              <span className="meta-label">Savings</span>
              <span style={{color:'var(--green)',fontFamily:'var(--mono)'}}>
                {money(discounted.reduce((s,i) => s + i.discount_amount, 0))}
              </span>
            </div>
          )}
          <div className="meta-row"><span className="meta-label">Total</span><span className="meta-val">{money(receipt.total)}</span></div>
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th style={{textAlign:'right'}}>Original</th>
                <th style={{textAlign:'right'}}>Discount</th>
                <th style={{textAlign:'right'}}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className={item.discount_amount > 0 ? 'disc-row' : ''}>
                  <td><span className="code-badge">{item.item_code ?? '—'}</span></td>
                  <td style={{fontWeight: item.discount_amount > 0 ? 500 : 400}}>{item.name}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',color:item.discount_amount > 0 ? 'var(--ink2)':'inherit',textDecoration:item.discount_amount > 0 ? 'line-through':'none'}}>
                    {money(item.original_price)}
                  </td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--red)',fontWeight:item.discount_amount > 0 ? 600:400}}>
                    {item.discount_amount > 0 ? `−${money(item.discount_amount)}` : '—'}
                  </td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:item.discount_amount > 0 ? 'var(--green)':'inherit'}}>
                    {money(item.final_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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