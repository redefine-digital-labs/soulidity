import type { Metadata } from 'next'
import { CreateCollectionShell } from './_shell'

export const metadata: Metadata = {
  title: 'Create Collection',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function CreateCollectionLayout({ children }: { children: React.ReactNode }) {
  return <CreateCollectionShell>{children}</CreateCollectionShell>
}
