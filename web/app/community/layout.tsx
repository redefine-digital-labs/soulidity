import type { Metadata } from 'next'

const title = 'Community'
const description =
  'Share Soul training logs, ask questions, and follow the Soulidity community leaderboard.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/community' },
  openGraph: {
    title: `${title} · Soulidity`,
    description,
    url: '/community',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} · Soulidity`,
    description,
  },
}

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
