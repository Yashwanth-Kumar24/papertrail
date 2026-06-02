'use client'
import { useState, useEffect } from 'react'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export default function NotifyBanner() {
  const [show,   setShow]   = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'denied'>('idle')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return
    if (localStorage.getItem('notify-dismissed')) return
    setShow(true)
  }, [])

  const enable = async () => {
    setStatus('loading')
    try {
      const reg        = await navigator.serviceWorker.ready
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setStatus('denied'); return }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ) as BufferSource,
      })

      await fetch('/api/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subscription: sub }),
      })

      setStatus('done')
      setTimeout(() => setShow(false), 2000)
    } catch {
      setStatus('idle')
    }
  }

  const dismiss = () => {
    localStorage.setItem('notify-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div style={{
      background:   'var(--green-bg)',
      borderBottom: '1px solid var(--border)',
      padding:      '10px 24px',
      display:      'flex',
      alignItems:   'center',
      gap:          12,
      fontSize:     13,
      flexWrap:     'wrap',
    }}>
      <span style={{flex:1, color:'var(--ink)', minWidth:160}}>
        🔔 Get notified when a receipt is added
      </span>

      <button
        onClick={enable}
        disabled={status === 'loading' || status === 'done'}
        style={{
          background: 'var(--green)', color: '#fff',
          border: 'none', borderRadius: 6,
          padding: '6px 18px', fontSize: 12, fontWeight: 600,
          cursor: status === 'loading' || status === 'done' ? 'default' : 'pointer',
          opacity: status === 'loading' ? 0.7 : 1,
        }}
      >
        {status === 'loading' ? 'Enabling…' : status === 'done' ? '✓ Enabled!' : 'Enable'}
      </button>

      {status === 'denied' && (
        <span style={{fontSize:12, color:'var(--red-tx)'}}>
          Notifications blocked — allow in browser settings
        </span>
      )}

      <button
        onClick={dismiss}
        style={{background:'none', border:'none', color:'var(--ink3)', cursor:'pointer', fontSize:20, lineHeight:1, padding:'0 2px'}}
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}
