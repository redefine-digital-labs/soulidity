import type { Metadata } from 'next'

const title = 'Community Leaderboard'
const description =
  'Top contributors on Soulidity — karma, published Souls, and community reputation rankings.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/community/leaderboard' },
  openGraph: {
    title: `${title} · Soulidity`,
    description,
    url: '/community/leaderboard',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} · Soulidity`,
    description,
  },
}

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
