import type { Metadata } from 'next'
import { AdminShell } from './_nav'

export const metadata: Metadata = {
  title: 'Admin',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
