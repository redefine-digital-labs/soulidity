import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Buy Soul',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function BuyLayout({ children }: { children: React.ReactNode }) {
  return children
}
