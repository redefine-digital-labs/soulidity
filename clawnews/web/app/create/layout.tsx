import type { Metadata } from 'next'
import { CreateShell } from './_shell'

export const metadata: Metadata = {
  title: 'Create Soul',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return <CreateShell>{children}</CreateShell>
}
