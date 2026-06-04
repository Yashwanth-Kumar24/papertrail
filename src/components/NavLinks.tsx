'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/expenses', label: 'Expenses', also: '/receipts' },
  { href: '/finance',  label: 'Finance'  },
  { href: '/prices',   label: 'Prices'   },
  { href: '/needs',    label: 'Needs'    },
]

export default function NavLinks() {
  const path = usePathname()
  return (
    <>
      <nav className="navlinks">
        {links.map(l => {
          const active = path.startsWith(l.href) || (l.also ? path.startsWith(l.also) : false)
          return (
            <Link key={l.href} href={l.href} className={`nl ${active ? 'active' : ''}`}>
              {l.label}
            </Link>
          )
        })}
      </nav>
      <Link href="/scan" className="nav-cta">+ New scan</Link>
    </>
  )
}
