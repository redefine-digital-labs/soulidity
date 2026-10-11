import type { Metadata } from 'next'
import { ImportShell } from './_shell'

export const metadata: Metadata = {
  title: 'Import Soul',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return <ImportShell>{children}</ImportShell>
}
