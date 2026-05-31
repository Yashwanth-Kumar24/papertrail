import type { Metadata, Viewport } from 'next'
import { Manrope, DM_Mono } from 'next/font/google'
import './globals.css'
import NavLinks from '@/components/NavLinks'

const manrope = Manrope({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const dmMono  = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'PaperTrail',
  description: 'Scan and search your receipts',
}

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1,
  themeColor: '#FAF8F4',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body suppressHydrationWarning>
        <header className="topnav">
          <div className="brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            PaperTrail
          </div>
          <NavLinks />
        </header>

        {children}

      </body>
    </html>
  )
}