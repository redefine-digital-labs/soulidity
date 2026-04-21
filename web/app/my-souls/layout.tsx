import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Souls',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function MySoulsLayout({ children }: { children: React.ReactNode }) {
  return children
}
