'use client'
import { useRef, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { recognizeReceipt } from '@/lib/ocr'
import { parseReceipt, mergeReceipts } from '@/parsers/registry'
import type { ParsedReceipt, ParsedItem } from '@/lib/types'
import { PAYERS, PAYER_COLORS, CATEGORIES, CATEGORY_LABELS, suggestCategory } from '@/lib/types'
import { saveReceipt, uploadReceiptImage } from '@/lib/queries'

type Step = 'capture' | 'scanning' | 'review' | 'saving'

const blankItem = (order: number): ParsedItem => ({
  item_code: '', name: '', original_price: 0,
  discount_amount: 0, final_price: 0, sort_order: order,
})

const BLANK_RECEIPT: ParsedReceipt = {
  store: { brand: 'other', name: '' },
  line_items: [],
  raw_ocr_text: '',
}

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
  const [step,        setStep]        = useState<Step>('capture')
  const [pct,         setPct]         = useState(0)
  const [parsed,      setParsed]      = useState<ParsedReceipt | null>(null)
  const [items,       setItems]       = useState<ParsedItem[]>([])
  const [error,       setError]       = useState('')
  const [saveImg,     setSaveImg]     = useState(false)
  const [imgFiles,    setImgFiles]    = useState<File[]>([])
  const [manualMode,  setManualMode]  = useState(false)
  const [editStore,   setEditStore]   = useState('')
  const [location,    setLocation]    = useState('')
  const [editDate,    setEditDate]    = useState('')
  const [editTime,    setEditTime]    = useState('')
  const [editTotal,   setEditTotal]   = useState('')
  const [editPaidBy,    setEditPaidBy]    = useState('')
  const [editTax,       setEditTax]       = useState('')
  const [editCategory,  setEditCategory]  = useState('other')
  const [editNotes,     setEditNotes]     = useState('')
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
        // Always update header fields — on first scan to populate them,
        // on subsequent scans to reflect the merged receipt (store, total, etc.)
        setEditStore(merged.store.name ?? '')
        setLocation(merged.store.location ?? '')
        setEditDate(merged.purchase_date ?? '')
        setEditTime(merged.purchase_time ?? '')
        setEditTotal(merged.total != null ? String(merged.total) : '')
        setEditTax(merged.tax   != null ? String(merged.tax)   : '')
        if (!prev) setEditCategory(suggestCategory(merged.store.brand))
        return merged
      })
      setStep('review')
    } catch {
      setError('OCR failed — try a clearer or flatter photo.')
      setStep('capture')
    }
  }, [])

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (step !== 'capture') return
      const items = Array.from(e.clipboardData?.items ?? [])
      const imgItem = items.find(i => i.type.startsWith('image/'))
      if (!imgItem) return
      const file = imgItem.getAsFile()
      if (!file) return
      const named = new File([file], `paste.${file.type.split('/')[1] || 'png'}`, { type: file.type })
      setImgFiles(prev => [...prev, named])
      process(named)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [step, process])

  const startManual = () => {
    setParsed(BLANK_RECEIPT)
    setItems([blankItem(0)])
    setEditStore(''); setLocation(''); setEditDate('')
    setEditTime(''); setEditTotal(''); setEditPaidBy('')
    setEditTax(''); setEditCategory('other'); setEditNotes('')
    setManualMode(true); setStep('review'); setError('')
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setImgFiles(prev => [...prev, f]); process(f) }
    e.target.value = ''
  }

  function updateItem(idx: number, field: keyof ParsedItem, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      if (field === 'name' || field === 'item_code') return { ...item, [field]: value }
      const num = parseFloat(value) || 0
      if (field === 'original_price') {
        // Keep final_price, recalculate discount so the invariant holds
        const disc = Math.max(0, num - item.final_price)
        return { ...item, original_price: num, discount_amount: disc }
      }
      if (field === 'final_price') {
        // Keep original_price, recalculate discount
        const disc = Math.max(0, item.original_price - num)
        return { ...item, final_price: Math.max(0, num), discount_amount: disc }
      }
      if (field === 'quantity') {
        return { ...item, quantity: Math.max(1, Math.round(num)) }
      }
      return { ...item, [field]: num }
    }))
  }

  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)) }
  function addItem() { setItems(prev => [...prev, blankItem(prev.length)]) }

  const save = async () => {
    if (!parsed || step === 'saving') return
    const resolvedDate = editDate || parsed.purchase_date
    if (!resolvedDate) {
      setError('Please enter the receipt date before saving.')
      return
    }
    if (!editPaidBy) {
      setError('Please select who paid for this receipt.')
      return
    }

    // Snapshot files now — prevents files appended during async ops (or between retries)
    // from being included in this save attempt.
    const filesToUpload = [...imgFiles]

    setStep('saving')
    try {
      const final: ParsedReceipt = {
        ...parsed,
        purchase_date: editDate  || parsed.purchase_date,
        purchase_time: editTime  || parsed.purchase_time,
        total:         editTotal !== '' ? (parseFloat(editTotal) || 0) : (parsed.total ?? 0),
        tax:           editTax  !== '' ? (parseFloat(editTax)  || 0) : parsed.tax,
        paid_by:       editPaidBy,
        source:        manualMode ? 'manual' : 'scan',
        category:      editCategory || 'other',
        notes:         editNotes.trim() || undefined,
        line_items:    items,
        store: {
          ...parsed.store,
          name:     editStore || parsed.store.name,
          location: location  || undefined,
        }
      }
      const id = await saveReceipt(final)

      if (saveImg && filesToUpload.length > 0) {
        const urls: string[] = []
        for (let i = 0; i < filesToUpload.length; i++) {
          const url = await uploadReceiptImage(
            filesToUpload[i], id, i,
            final.store.brand,
            final.purchase_date ?? new Date().toISOString().split('T')[0]
          )
          if (url) urls.push(url)
        }
        if (urls.length) {
          const { supabase } = await import('@/lib/supabase')
          await supabase.from('receipts').update({ image_urls: urls }).eq('id', id)
        }
      }
      // Fire push notification — don't await, never block navigation
      fetch('/api/notify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New receipt added',
          body:  `${editPaidBy} added ${final.store.name} · $${Number(final.total ?? 0).toFixed(2)}`,
          url:   `/receipts/${id}`,
        }),
      }).catch(() => {})

      router.push(`/receipts/${id}`)
    } catch (e: any) {
      // Restore the snapshot — discard any files that were appended after save was triggered.
      // This prevents imgFiles from growing across multiple failed save attempts.
      setImgFiles(filesToUpload)
      setError(e.message ?? 'Save failed.')
      setStep('review')
    }
  }

  const reset = () => {
    setParsed(null); setItems([]); setImgFiles([])
    setSaveImg(false); setStep('capture'); setError('')
    setEditStore(''); setLocation(''); setEditDate('')
    setEditTime(''); setEditTotal(''); setEditTax(''); setEditPaidBy('')
    setEditCategory('other'); setEditNotes('')
    setManualMode(false)
  }

  return (
    <main className="page">
      <div className="pg-head"><span className="pg-title">Scan receipt</span></div>

      <div className="scan-wrap">
        {/* Left panel */}
        <div>
          {manualMode ? (
            <div style={{background:'var(--cream2)',border:'1px solid var(--border)',borderRadius:'var(--rl)',padding:'32px 24px',textAlign:'center'}}>
              <div style={{fontSize:32,marginBottom:10}}>✏️</div>
              <div style={{fontWeight:600,fontSize:15,marginBottom:6}}>Manual entry</div>
              <p style={{fontSize:13,color:'var(--ink2)',marginBottom:20,lineHeight:1.5}}>
                Fill in the receipt details on the right.
              </p>
              <button onClick={reset} style={{
                background:'none',border:'1px solid var(--border2)',
                borderRadius:'var(--r)',padding:'8px 16px',
                fontSize:13,color:'var(--ink2)',cursor:'pointer',
                fontFamily:'var(--sans)',
              }}>
                ← Back to scan
              </button>
            </div>
          ) : (
            <>
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
                <div style={{fontSize:11,color:'var(--ink3)',textAlign:'center',marginTop:4}}>
                  or paste with Ctrl+V / ⌘V
                </div>
              </div>

              {step === 'scanning' && (
                <div style={{marginTop:16,padding:'16px',background:'#fff',border:'1px solid var(--border)',borderRadius:'var(--r)'}}>
                  {pct < 100 ? (
                    <>
                      <p style={{fontSize:13,color:'var(--ink2)',marginBottom:6}}>Reading receipt… {pct}%</p>
                      <div className="progress-bar"><div className="progress-fill" style={{width:`${pct}%`}}/></div>
                    </>
                  ) : (
                    <>
                      <p style={{fontSize:13,color:'var(--ink2)',marginBottom:6}}>Analyzing with AI…</p>
                      <div className="progress-bar"><div className="progress-fill" style={{width:'100%',animation:'pulse 1.5s ease-in-out infinite'}}/></div>
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

              {error && step !== 'review' && (
                <div style={{marginTop:12,padding:'10px 14px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:13}}>
                  {error}
                </div>
              )}

              {/* When in review after a save error, warn user not to re-scan */}
              {step === 'review' && error && (
                <div style={{marginTop:12,padding:'10px 14px',background:'#FEF3C7',color:'#92400E',borderRadius:'var(--r)',fontSize:12,lineHeight:1.5}}>
                  <strong>Your scan is ready.</strong> Fix the issue on the right, then click Save receipt. Don't retake the photo — it's already queued.
                </div>
              )}

              <input ref={photoRef}  type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={onFile}/>
              <input ref={uploadRef} type="file" accept="image/*" style={{display:'none'}} onChange={onFile}/>

              <div style={{marginTop:12,padding:'14px 16px',background:'var(--cream2)',borderRadius:'var(--r)',fontSize:12,color:'var(--ink2)'}}>
                <strong style={{color:'var(--ink)'}}>Long receipt?</strong> Scan in sections — items merge automatically.
              </div>

              <button onClick={startManual} style={{
                marginTop:10,width:'100%',
                background:'var(--cream2)',
                border:'1px solid var(--border2)',
                borderRadius:'var(--r)',
                padding:'11px 16px',fontSize:13,
                color:'var(--ink)',fontWeight:500,
                cursor:'pointer',fontFamily:'var(--sans)',
                display:'flex',alignItems:'center',justifyContent:'center',gap:8,
              }}>
                <span>✏️</span>
                <span>No receipt? Enter manually</span>
              </button>
            </>
          )}
        </div>

        {/* Right — review panel */}
        {parsed && step === 'review' && (
          <div className="review-panel">
            <h3>{manualMode ? 'Add receipt manually' : 'Review before saving'}</h3>

            {error && (
              <div style={{padding:'8px 12px',background:'var(--red-bg)',color:'var(--red-tx)',borderRadius:'var(--r)',fontSize:12,marginBottom:12}}>
                {error}
              </div>
            )}

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

            <div className="rp-row">
              <span className="rp-label">Tax</span>
              <input suppressHydrationWarning type="number" step="0.01" value={editTax} onChange={e => setEditTax(e.target.value)}
                placeholder="0.00"
                style={{fontSize:13,padding:'2px 6px',textAlign:'right',border:'1px solid transparent',borderRadius:4,width:100,fontFamily:'var(--mono)'}}
                onFocus={e => e.target.style.borderColor='var(--green)'}
                onBlur={e  => e.target.style.borderColor='transparent'}
              />
            </div>

            {/* Paid by — required */}
            <div className="rp-row">
              <span className="rp-label">
                Paid by <span style={{color:'var(--red)',fontSize:10,verticalAlign:'middle'}}>required</span>
              </span>
              <select
                value={editPaidBy}
                onChange={e => { setEditPaidBy(e.target.value); if (error.includes('paid')) setError('') }}
                style={{
                  fontSize:13,padding:'3px 8px',
                  border:`1px solid ${editPaidBy ? 'var(--border)' : 'var(--red)'}`,
                  borderRadius:4,background:'#fff',
                  color: editPaidBy ? 'var(--ink)' : 'var(--ink3)',
                  fontFamily:'var(--sans)',cursor:'pointer',
                  ...(editPaidBy ? {background: PAYER_COLORS[editPaidBy]?.bg, color: PAYER_COLORS[editPaidBy]?.color, fontWeight:600} : {}),
                }}
              >
                <option value="">— select payer —</option>
                {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Category */}
            <div className="rp-row">
              <span className="rp-label">Category</span>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                style={{fontSize:13,padding:'3px 8px',border:'1px solid var(--border)',borderRadius:4,background:'#fff',fontFamily:'var(--sans)',cursor:'pointer'}}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div className="rp-row" style={{flexDirection:'column',gap:4,alignItems:'stretch'}}>
              <span className="rp-label">Notes</span>
              <input suppressHydrationWarning
                value={editNotes}
                onChange={e => setEditNotes(e.target.value.slice(0, 280))}
                placeholder="e.g. birthday dinner, work reimbursement…"
                maxLength={280}
                style={{fontSize:12,padding:'4px 7px',border:'1px solid var(--border)',borderRadius:4,color:'var(--ink2)',width:'100%'}}
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
                {items.length} items — click any field to edit
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
              {!manualMode && (
                <button className="btn-secondary" style={{fontSize:12,padding:'7px 14px'}} onClick={() => uploadRef.current?.click()}>
                  + Add section
                </button>
              )}
              <button className="btn-primary" onClick={save}>
                Save receipt
              </button>
              {!manualMode && (
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--ink2)',marginLeft:'auto'}}>
                  <input type="checkbox" checked={saveImg} onChange={e => setSaveImg(e.target.checked)}
                    style={{accentColor:'var(--green)',width:14,height:14}}
                  />
                  Save image
                </label>
              )}
            </div>

            <button onClick={reset} style={{
              marginTop:12,background:'none',
              border:'1px solid var(--border)',
              borderRadius:'var(--r)',
              fontSize:13,color:'var(--ink2)',
              cursor:'pointer',padding:'8px 16px',
              width:'100%',fontFamily:'var(--sans)',
            }}>
              ✕ {manualMode ? 'Discard' : 'Discard and scan again'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
