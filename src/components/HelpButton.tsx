'use client'
import { useState, useEffect } from 'react'
import OnboardingModal from './OnboardingModal'

export default function HelpButton() {
  const [open, setOpen] = useState(false)
  const [isFirstVisit, setIsFirstVisit] = useState(false)

  // Auto-show once on first visit
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('onboarding-done')) return
    setIsFirstVisit(true)
    setOpen(true)
  }, [])

  function handleClose() {
    if (isFirstVisit) {
      localStorage.setItem('onboarding-done', '1')
      setIsFirstVisit(false)
    }
    setOpen(false)
  }

  function handleHelpClick() {
    setIsFirstVisit(false)
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={handleHelpClick}
        aria-label="Help — how PaperTrail works"
        title="How PaperTrail works"
        style={{
          marginLeft: '10px',
          background: 'none',
          border: '1.5px solid var(--border2)',
          cursor: 'pointer',
          color: 'var(--ink3)',
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1,
          borderRadius: '50%',
          fontFamily: 'var(--sans)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          flexShrink: 0,
          transition: 'color 0.15s, border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget
          el.style.color = 'var(--ink)'
          el.style.borderColor = 'var(--ink3)'
          el.style.background = 'var(--cream3)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget
          el.style.color = 'var(--ink3)'
          el.style.borderColor = 'var(--border2)'
          el.style.background = 'none'
        }}
      >
        ?
      </button>
      <OnboardingModal open={open} onClose={handleClose} isFirstVisit={isFirstVisit} />
    </>
  )
}
