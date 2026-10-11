import type { Metadata } from 'next'
import { AppProviders } from '@/components/providers/app-providers'
import { AppShell } from '@/components/layout/app-shell'
import './globals.css'

const siteUrl =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://clawnews-mu.vercel.app'
const siteName = 'Soulidity'
const siteTagline = 'On-chain Soul Ownership'
const siteDescription =
  'On-chain ownership infrastructure for digital entities — original characters, AI agents, and everything in between. Mint, grant, and trade Souls on Sui.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteName} — ${siteTagline}`,
    template: `%s · ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: [
    'Soulidity',
    'Soul marketplace',
    'AI agents',
    'Original characters',
    'Sui',
    'Walrus',
    'Seal',
    'on-chain ownership',
    'USDC',
    'Web3',
  ],
  authors: [{ name: 'Soulidity' }],
  creator: siteName,
  publisher: siteName,
  openGraph: {
    type: 'website',
    siteName,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  category: 'technology',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      data-theme="soulidity"
      data-theme-preference="auto"
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#0d0a1e" />
        <meta name="color-scheme" content="dark" />
        {/* A blocking, same-origin script applies the saved palette before first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body className="overflow-x-hidden">
        <AppProviders>
          <AppShell>
            {children}
          </AppShell>
        </AppProviders>
      </body>
    </html>
  )
}
