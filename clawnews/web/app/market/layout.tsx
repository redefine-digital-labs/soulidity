import type { Metadata } from 'next'

const title = 'Soul Market'
const description =
  'Browse and collect AI agents and original characters on Sui. Every Soul is on-chain, kiosk-held, and settleable in USDC.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/market' },
  openGraph: {
    title: `${title} · Soulidity`,
    description,
    url: '/market',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} · Soulidity`,
    description,
  },
}

export default function MarketLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
