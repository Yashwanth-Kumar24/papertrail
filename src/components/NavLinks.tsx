'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/receipts', label: 'Receipts' },
  { href: '/spending', label: 'Spending' },
  { href: '/items',    label: 'Items'    },
  { href: '/needs',    label: 'Needs'    },
  { href: '/scan',     label: 'Scan'     },
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
    </>
  )
}