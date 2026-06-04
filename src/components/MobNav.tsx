'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  {
    href: '/expenses', label: 'Expenses', also: '/receipts',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  },
  {
    href: '/finance', label: 'Finance',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
  },
  {
    href: '/prices', label: 'Prices',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  },
  {
    href: '/needs', label: 'Needs',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><polyline points="4 6 5 7 7 5"/><polyline points="4 12 5 13 7 11"/><polyline points="4 18 5 19 7 17"/></svg>
  },
]

export default function MobNav() {
  const path = usePathname()
  return (
    <>
      {/* Floating scan button — mobile only */}
      <Link href="/scan" className="mob-fab" aria-label="New scan">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </Link>

      <nav className="mobnav" aria-label="Mobile navigation">
        <div className="mobtabs">
          {links.map(l => {
            const active = path.startsWith(l.href) || (l.also ? path.startsWith(l.also) : false)
            return (
              <Link key={l.href} href={l.href} className={`mobtab ${active ? 'active' : ''}`}>
                {l.icon}
                <span>{l.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
