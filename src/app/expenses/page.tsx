'use client'
import { useState, Activity } from 'react'
import ReceiptsPage from '../receipts/page'
import RecurringPage from '../recurring/page'

export default function ExpensesPage() {
  const [tab, setTab] = useState<'receipts' | 'recurring'>('receipts')

  return (
    <>
      {/* Sub-tab bar — same horizontal padding as .page */}
      <div style={{maxWidth:1100,margin:'0 auto',padding:'20px 32px 0',display:'flex',gap:4}}>
        <button
          onClick={() => setTab('receipts')}
          style={{
            padding:'7px 18px',border:'none',borderRadius:999,
            fontSize:13,fontWeight: tab==='receipts' ? 600 : 500,cursor:'pointer',
            background: tab==='receipts' ? 'var(--green)' : 'transparent',
            color:      tab==='receipts' ? '#fff' : 'var(--ink2)',
            transition:'all .12s',
          }}
        >Receipts</button>
        <button
          onClick={() => setTab('recurring')}
          style={{
            padding:'7px 18px',border:'none',borderRadius:999,
            fontSize:13,fontWeight: tab==='recurring' ? 600 : 500,cursor:'pointer',
            background: tab==='recurring' ? 'var(--green)' : 'transparent',
            color:      tab==='recurring' ? '#fff' : 'var(--ink2)',
            transition:'all .12s',
          }}
        >Recurring</button>
      </div>

      {/*
        Both tabs stay mounted via Activity instead of `tab==='x' ? <A/> : <B/>`,
        which used to fully unmount the inactive tab — losing filters, sort,
        selection, and scroll position every time you switched away and back.
        Activity hides the inactive one with display:none and tears down its
        Effects (so it won't keep fetching/polling in the background), but
        preserves its component state and DOM; Effects re-run — and data
        re-fetches — the moment it becomes visible again.
      */}
      <Activity mode={tab === 'receipts' ? 'visible' : 'hidden'}>
        <ReceiptsPage />
      </Activity>
      <Activity mode={tab === 'recurring' ? 'visible' : 'hidden'}>
        <RecurringPage />
      </Activity>
    </>
  )
}
