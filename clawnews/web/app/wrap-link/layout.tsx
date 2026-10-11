import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Wrap + Link',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function WrapLinkLayout({ children }: { children: React.ReactNode }) {
  return children
}
