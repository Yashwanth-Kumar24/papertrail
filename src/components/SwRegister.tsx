'use client'
import { useEffect } from 'react'

export default function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Unregister old /sw.js registration if present
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const reg of registrations) {
        if (reg.active?.scriptURL.endsWith('/sw.js')) {
          reg.unregister()
        }
      }
    })

    // Register new worker served from API route (avoids HMR injection)
    navigator.serviceWorker.register('/sw', { scope: '/' }).catch(() => {})
  }, [])

  return null
}
