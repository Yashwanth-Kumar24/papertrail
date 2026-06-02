import type { Metadata, Viewport } from 'next'
import { Manrope, DM_Mono } from 'next/font/google'
import './globals.css'
import NavLinks      from '@/components/NavLinks'
import MobNav        from '@/components/MobNav'
import SwRegister    from '@/components/SwRegister'
import NotifyBanner  from '@/components/NotifyBanner'
import Link from 'next/link'

const manrope = Manrope({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const dmMono  = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'PaperTrail',
  description: 'Scan and search your receipts',
  icons: {
    icon:  '/icon.svg',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable:         true,
    title:           'PaperTrail',
    statusBarStyle:  'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1,
  themeColor: '#1D6F50',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body suppressHydrationWarning>
        <SwRegister />
        <header className="topnav">
          <Link href="/receipts" style={{textDecoration:'none'}}>
            <div className="brand">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              PaperTrail
            </div>
          </Link>
          <NavLinks />
        </header>
        <NotifyBanner />

        {children}
        <MobNav />
      </body>
    </html>
  )
}