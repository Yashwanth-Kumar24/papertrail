'use client'
import { useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { recognizeReceipt } from '@/lib/ocr'
import { parseReceipt, mergeReceipts } from '@/parsers/registry'
import type { ParsedReceipt, ParsedItem } from '@/lib/types'
import { saveReceipt, uploadReceiptImage } from '@/lib/queries'

type Step = 'capture' | 'scanning' | 'review' | 'saving'


const blankItem = (order: number): ParsedItem => ({
  item_code: '', name: '', original_price: 0,
  discount_amount: 0, final_price: 0, sort_order: order,
})

// ── Tip popover — defined outside to avoid re-creation ────
function TipPopover() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{position:'relative',display:'inline-flex'}}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:18,height:18,borderRadius:'50%',
          border:'1.5px solid var(--border2)',
          background:'var(--cream2)',color:'var(--ink2)',
          fontSize:10,fontWeight:600,cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',
          flexShrink:0,padding:0,fontFamily:'var(--sans)',lineHeight:1,
        }}
        aria-label="Photo tips"
      >
        i
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{position:'fixed',inset:0,zIndex:10}}/>
          <div className="tip-popover">
            <div className="tip-caret"/>
            <div style={{fontSize:12,fontWeight:600,color:'var(--ink)',marginBottom:8}}>
              📸 Tips for best results
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {[
                ['💡','Good lighting — avoid shadows'],
                ['📐','Flat on a table — no folds'],
                ['🎯','Phone directly above — straight down'],
                ['📄','Full receipt in frame — edges visible'],
              ].map(([icon, tip]) => (
                <div key={tip} style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,color:'var(--ink2)'}}>
                  <span style={{flexShrink:0}}>{icon}</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function ScanPage() {
  const router = useRouter()
  const [step,      setStep]      = useState<Step>('capture')
  const [pct,       setPct]       = useState(0)
  const [parsed,    setParsed]    = useState<ParsedReceipt | null>(null)
  const [items,     setItems]     = useState<ParsedItem[]>([])
  const [error,     setError]     = useState('')
  const [saveImg,   setSaveImg]   = useState(false)
  const [imgFiles, setImgFiles] = useState<File[]>([])
  const [editStore, setEditStore] = useState('')
  const [location,  setLocation]  = useState('')
  const [editDate,  setEditDate]  = useState('')
  const [editTime,  setEditTime]  = useState('')
  const [editTotal, setEditTotal] = useState('')
  const photoRef  = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const process = useCallback(async (file: File) => {
    setError(''); setStep('scanning'); setPct(0)
    try {
      const text   = await recognizeReceipt(file, p => setPct(p))
      const result = await parseReceipt(text)
      setParsed(prev => {
        const merged = prev ? mergeReceipts(prev, result) : result
        setItems(merged.line_items)
        // On first scan populate all fields; on subsequent scans keep user edits
        if (!prev) {
          setEditStore(merged.store.name ?? '')
          setLocation(merged.store.location ?? '')
          setEditDate(merged.purchase_date ?? '')
          setEditTime(merged.purchase_time ?? '')
          setEditTotal(merged.total != null ? String(merged.total) : '')
        }
        return merged
      })
      setStep('review')
    } catch {
      setError('OCR failed — try a clearer or flatter photo.')
      setStep('capture')
    }
  }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setImgFiles(prev => [...prev, f])
      process(f)
    }
    e.target.value = ''
  }

  function updateItem(idx: number, field: keyof ParsedItem, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      if (field === 'name' || field === 'item_code') return { ...item, [field]: value }
      if (field === 'final_price' || field === 'original_price') {
        const num = parseFloat(value) || 0
        return { ...item, original_price: num, final_price: num, discount_amount: 0 }
      }
      return item
    }))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function addItem() {
    setItems(prev => [...prev, blankItem(prev.length)])
  }

  const save = async () => {
    if (!parsed || step === 'saving') return
    const resolvedDate = editDate || parsed.purchase_date
    if (!resolvedDate) {
      setError('Please enter the receipt date before saving.')
      return
    }
    setStep('saving')
    try {
      const final: ParsedReceipt = {
        ...parsed,
        purchase_date: editDate  || parsed.purchase_date,
        purchase_time: editTime  || parsed.purchase_time,
        total:         parseFloat(editTotal) || parsed.total,
        line_items:    items,
        store: {
          ...parsed.store,
          name:     editStore || parsed.store.name,
          location: location  || undefined,
        }
      }
      const id = await saveReceipt(final)

      if (saveImg && imgFiles.length > 0) {
        const urls: string[] = []

        for (let i = 0; i < imgFiles.length; i++) {
          const url = await uploadReceiptImage(
            imgFiles[i],
            id,
            i,
            final.store.brand,
            final.purchase_date ?? new Date().toISOString().split('T')[0]
          )

          if (url) urls.push(url)
        }

        if (urls.length) {
          const { supabase } = await import('@/lib/supabase')
          await supabase
            .from('receipts')
            .update({ image_urls: urls })
            .eq('id', id)
        }
      }

      router.push(`/receipts/${id}`)
    } catch (e: any) {
      setError(e.message ?? 'Save failed.')
      setStep('review')
    }
  }

  const reset = () => {
    setParsed(null); setItems([]); setImgFiles([])
    setSaveImg(false); setStep('capture'); setError('')
    setEditStore(''); setLocation(''); setEditDate('')
    setEditTime(''); setEditTotal('')
  }

  return (
    <main className="page">
      <div className="pg-head"><span className="pg-title">Scan receipt</span></div>

      <div className="scan-wrap">
        {/* Left */}
        <div>
          <div className="drop-zone">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="12" cy="13" r="4" strokeLinecap="round"/>
            </svg>

            <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
              <span style={{fontSize:13,color:'var(--ink2)'}}>Better photo means better results</span>
              <TipPopover />
            </div>

            <button className="btn-primary btn-full" onClick={() => photoRef.current?.click()}>
              📷 Take photo
            </button>
            <button className="btn-secondary btn-full" onClick={() => uploadRef.current?.click()}>
              ↑ Upload image
            </button>
          </div>

          {step === 'scanning' && (
            <div style={{marginTop:16,padding:'16px',background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--r)'}}>
              {pct < 100 ? (
                <>
                  <p style={{fontSize:13,color:'var(--ink2)',marginBottom:6}}>Reading receipt… {pct}%</p>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{width:`${pct}%`}}/>
                  </div>
                </>
              ) : (
                <>
                  <p style={{fontSize:13,color:'var(--ink2)',marginBottom:6}}>Analyzing with AI…</p>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{width:'100%',animation:'pulse 1.5s ease-in-out infinite'}}/>
                  </div>
                  <p style={{fontSize:11,color:'var(--ink3)',marginTop:6}}>Extracting items, prices and discounts</p>
                </>
              )}
            </div>
          )}

          {step === 'saving' && (
            <div style={{marginTop:16,padding:'14px 16px',background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--r)'}}>
              <p style={{fontSize:13,color:'var(--ink2)'}}>Saving…</p>
            </div>
          )}

          {error && (
            <div style={{marginTop:12,padding:'10px 14px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13}}>
              {error}
            </div>
          )}

          <input ref={photoRef}  type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={onFile}/>
          <input ref={uploadRef} type="file" accept="image/*" style={{display:'none'}} onChange={onFile}/>

          <div style={{marginTop:12,padding:'14px 16px',background:'var(--cream2)',borderRadius:'var(--r)',fontSize:12,color:'var(--ink2)'}}>
            <strong style={{color:'var(--ink)'}}>Long receipt?</strong> Scan in sections — items merge automatically.
          </div>
        </div>

        {/* Right — review */}
        {parsed && step === 'review' && (
          <div className="review-panel">
            <h3>Review before saving</h3>

            <div className="rp-row">
              <span className="rp-label">Store</span>
              <input suppressHydrationWarning value={editStore} onChange={e => setEditStore(e.target.value)}
                placeholder="Store name"
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,width:200,fontFamily:'var(--sans)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>
            <div className="rp-row">
              <span className="rp-label">Location</span>
              <input suppressHydrationWarning value={location} onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Redmond, WA"
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,width:200,fontFamily:'var(--sans)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>
            <div className="rp-row">
              <span className="rp-label">Date</span>
              <input suppressHydrationWarning type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,fontFamily:'var(--sans)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>
            <div className="rp-row">
              <span className="rp-label">Time</span>
              <input suppressHydrationWarning type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,fontFamily:'var(--sans)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>
            <div className="rp-row">
              <span className="rp-label">Total</span>
              <input suppressHydrationWarning type="number" step="0.01" value={editTotal} onChange={e => setEditTotal(e.target.value)}
                placeholder="0.00"
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,width:100,fontFamily:'var(--mono)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>
            {parsed.transaction_id && (
              <div className="rp-row">
                <span className="rp-label">Txn ID</span>
                <span className="rp-val" style={{fontSize:12}}>{parsed.transaction_id}</span>
              </div>
            )}

            <div className="rp-items">
              <div style={{fontSize:11,fontWeight:600,color:'var(--ink2)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:8,paddingBottom:6,borderBottom:'1px solid var(--border)'}}>
                {items.filter(i => i.final_price > 0).length} items — click any field to edit
              </div>

              {items.map((item, i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'72px 1fr 72px 24px',gap:4,padding:'6px 0',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
                  <input suppressHydrationWarning
                    value={item.item_code ?? ''}
                    onChange={e => updateItem(i, 'item_code', e.target.value)}
                    placeholder="code"
                    style={{fontSize:11,padding:'3px 6px',fontFamily:'var(--mono)',background:'var(--cream2)',border:'1px solid transparent',borderRadius:4}}
                    onFocus={e => e.target.style.borderColor='var(--green)'}
                    onBlur={e  => e.target.style.borderColor='transparent'}
                  />
                  <input suppressHydrationWarning
                    value={item.name}
                    onChange={e => updateItem(i, 'name', e.target.value)}
                    placeholder="item name"
                    style={{fontSize:13,padding:'3px 6px',border:'1px solid transparent',borderRadius:4}}
                    onFocus={e => e.target.style.borderColor='var(--green)'}
                    onBlur={e  => e.target.style.borderColor='transparent'}
                  />
                  <input suppressHydrationWarning
                    type="number" step="0.01"
                    value={item.final_price || ''}
                    onChange={e => updateItem(i, 'final_price', e.target.value)}
                    placeholder="0.00"
                    style={{fontSize:13,padding:'3px 6px',fontFamily:'var(--mono)',textAlign:'right',border:'1px solid transparent',borderRadius:4}}
                    onFocus={e => e.target.style.borderColor='var(--green)'}
                    onBlur={e  => e.target.style.borderColor='transparent'}
                  />
                  <button onClick={() => removeItem(i)}
                    style={{background:'none',border:'none',color:'var(--ink3)',cursor:'pointer',fontSize:16,lineHeight:1,padding:'0 2px'}}
                    aria-label="Remove item"
                  >×</button>
                </div>
              ))}

              <button onClick={addItem}
                style={{marginTop:8,background:'none',border:'1px dashed var(--border2)',borderRadius:'var(--r)',width:'100%',padding:'7px',fontSize:12,color:'var(--ink2)',cursor:'pointer'}}
              >
                + Add item manually
              </button>
            </div>

            <div className="save-bar">
              <button className="btn-secondary" style={{fontSize:12,padding:'7px 14px'}} onClick={() => uploadRef.current?.click()}>
                + Add section
              </button>
              <button className="btn-primary" onClick={save}>
                Save receipt
              </button>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--ink2)',marginLeft:'auto'}}>
                <input type="checkbox" checked={saveImg} onChange={e => setSaveImg(e.target.checked)}
                  style={{accentColor:'var(--green)',width:14,height:14}}
                />
                Save image
              </label>
            </div>

            <button onClick={reset} style={{
              marginTop:12,background:'none',
              border:'1px solid var(--border)',
              borderRadius:'var(--r)',
              fontSize:13,color:'var(--ink2)',
              cursor:'pointer',padding:'8px 16px',
              width:'100%',fontFamily:'var(--sans)',
            }}>
              ✕ Discard and scan again
            </button>
          </div>
        )}
      </div>
    </main>
  )
}