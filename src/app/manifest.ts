import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'PaperTrail',
    short_name:       'PaperTrail',
    description:      'Track household receipts, spending, and shopping needs',
    start_url:        '/receipts',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#FAF8F4',
    theme_color:      '#1D6F50',
    icons: [
      { src: '/icon.svg',      sizes: 'any',    type: 'image/svg+xml', purpose: 'any'           },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png',    purpose: 'maskable'      },
    ],
  }
}