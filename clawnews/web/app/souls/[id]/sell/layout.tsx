import type { Metadata } from 'next'
import { SellShell } from './_shell'

export const metadata: Metadata = {
  title: 'Manage Listing',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function SellLayout({ children }: { children: React.ReactNode }) {
  return <SellShell>{children}</SellShell>
}
