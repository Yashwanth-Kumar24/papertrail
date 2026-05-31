'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  {
    href: '/receipts', label: 'Receipts',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
  },
  {
    href: '/items', label: 'Items',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  },
  {
    href: '/scan', label: 'Scan',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7V4h3M17 4h3v3M4 17v3h3M17 20h3v-3M7 12h10"/></svg>
  },
]

export default function NavLinks() {
  const path = usePathname()

  return (
    <>
      <nav className="navlinks">
        {links.map(l => (
          <Link key={l.href} href={l.href} className={`nl ${path.startsWith(l.href) ? 'active' : ''}`}>
            {l.label}
          </Link>
        ))}
      </nav>

      <Link href="/scan" className="nav-cta">+ New scan</Link>

      <nav className="mobnav" aria-label="Mobile navigation">
        <div className="mobtabs">
          {links.map(l => (
            <Link key={l.href} href={l.href} className={`mobtab ${path.startsWith(l.href) ? 'active' : ''}`}>
              {l.icon}
              <span>{l.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}