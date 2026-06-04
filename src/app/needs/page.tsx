'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { getShoppingList, addShoppingItem, markShoppingItemDone, undoShoppingItem, deleteShoppingItem, clearDoneItems } from '@/lib/queries'
import type { ShoppingItem } from '@/lib/types'
import { PAYERS, PAYER_COLORS } from '@/lib/types'

export default function ListPage() {
  const [items,    setItems]    = useState<ShoppingItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [newText,  setNewText]  = useState('')
  const [newPayer, setNewPayer] = useState<string>(PAYERS[0] ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setItems(await getShoppingList()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    // Re-sync when tab regains focus — another member may have updated the list
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const add = async () => {
    const text = newText.trim()
    if (!text) return
    const temp: ShoppingItem = {
      id: `tmp-${crypto.randomUUID()}`, text, added_by: newPayer,
      done: false, created_at: new Date().toISOString(),
    }
    setItems(prev => [temp, ...prev])
    setNewText('')
    inputRef.current?.focus()
    try {
      const real = await addShoppingItem(text, newPayer)
      setItems(prev => prev.map(i => i.id === temp.id ? real : i))
    } catch {
      setItems(prev => prev.filter(i => i.id !== temp.id))
      setNewText(text)
    }
  }

  const markDone = async (id: string) => {
    const now = new Date().toISOString()
    // Optimistic — move to done section immediately
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: true, done_at: now } : i))
    try { await markShoppingItemDone(id) } catch {
      // Revert on failure
      setItems(prev => prev.map(i => i.id === id ? { ...i, done: false, done_at: undefined } : i))
    }
  }

  const undone = async (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: false, done_at: undefined } : i))
    try { await undoShoppingItem(id) } catch { load() }
  }

  const remove = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    try { await deleteShoppingItem(id) } catch { load() }
  }

  const active = items.filter(i => !i.done)
  const done   = items.filter(i =>  i.done)

  return (
    <main className="page">
      <div className="pg-head">
        <span className="pg-title">Needs</span>
        <span className="pg-sub">{active.length} to buy{done.length > 0 ? ` · ${done.length} done` : ''}</span>
      </div>

      {/* Add bar */}
      <div className="list-add-bar">
        <select
          value={newPayer}
          onChange={e => setNewPayer(e.target.value)}
          className="fsel"
          style={{
            background: PAYER_COLORS[newPayer]?.bg,
            color:      PAYER_COLORS[newPayer]?.color,
            fontWeight: 600, fontSize: 12, flexShrink: 0,
          }}
        >
          {PAYERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add an item… (press Enter)"
          className="list-input"
          autoComplete="off"
        />

        <button
          className="btn-primary"
          style={{padding:'9px 18px', fontSize:13, flexShrink:0}}
          onClick={add}
          disabled={!newText.trim()}
        >
          + Add
        </button>
      </div>

      {loading ? (
        <div className="empty"><p style={{color:'var(--ink3)'}}>Loading…</p></div>
      ) : items.length === 0 ? (
        <div className="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="9" y1="6"  x2="20" y2="6"/>
            <line x1="9" y1="12" x2="20" y2="12"/>
            <line x1="9" y1="18" x2="20" y2="18"/>
            <polyline points="4 6 5 7 7 5"/>
            <polyline points="4 12 5 13 7 11"/>
            <polyline points="4 18 5 19 7 17"/>
          </svg>
          <p style={{fontWeight:500}}>Nothing needed</p>
          <p style={{fontSize:13}}>Add items above — syncs to all devices</p>
        </div>
      ) : (
        <div className="list-items">
          {/* Active items */}
          {active.map(item => (
            <div key={item.id} className="list-item">
              <button className="list-check" onClick={() => markDone(item.id)} aria-label="Mark done"/>
              <span className="list-text">{item.text}</span>
              {item.added_by && (
                <span className="list-by" style={{
                  background: PAYER_COLORS[item.added_by]?.bg ?? 'var(--cream2)',
                  color:      PAYER_COLORS[item.added_by]?.color ?? 'var(--ink3)',
                }}>
                  {item.added_by}
                </span>
              )}
              <button onClick={() => remove(item.id)} className="list-del" aria-label="Remove">×</button>
            </div>
          ))}

          {/* Done items — visible for 24 hrs, tap to undo */}
          {done.length > 0 && (
            <>
              <div style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                marginTop:16, marginBottom:4,
              }}>
                <span style={{fontSize:11,fontWeight:600,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                  Done — disappear after 2 hrs
                </span>
                <button
                  onClick={async () => {
                    setItems(prev => prev.filter(i => !i.done))
                    try { await clearDoneItems() } catch { load() }
                  }}
                  style={{fontSize:11,color:'var(--ink3)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}
                >
                  Clear all
                </button>
              </div>
              {done.map(item => (
                <div key={item.id} className="list-item done">
                  <button
                    className="list-check checked"
                    onClick={() => undone(item.id)}
                    aria-label="Undo"
                    title="Tap to undo"
                  >
                    <svg viewBox="0 0 12 12" fill="none">
                      <polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <span className="list-text">{item.text}</span>
                  {item.added_by && (
                    <span className="list-by" style={{
                      background: PAYER_COLORS[item.added_by]?.bg ?? 'var(--cream2)',
                      color:      PAYER_COLORS[item.added_by]?.color ?? 'var(--ink3)',
                    }}>
                      {item.added_by}
                    </span>
                  )}
                  <button onClick={() => remove(item.id)} className="list-del" aria-label="Remove">×</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </main>
  )
}
