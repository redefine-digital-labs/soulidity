import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type Params = { channel: string }

const CHANNEL_META: Record<string, { title: string; description: string }> = {
  general: {
    title: 'General · Community',
    description: 'Share Soul training logs, showcase work, and chat with the Soulidity community.',
  },
  news: {
    title: 'News · Community',
    description: 'Soulidity product and ecosystem announcements, releases, and protocol updates.',
  },
  questions: {
    title: 'Questions · Community',
    description: 'Ask and answer questions about Soulidity, Souls, SoulGrant, and the on-chain stack.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { channel } = await params
  const meta = CHANNEL_META[channel]
  if (!meta) notFound()

  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/community/${channel}` },
    openGraph: {
      title: `${meta.title} · Soulidity`,
      description: meta.description,
      url: `/community/${channel}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${meta.title} · Soulidity`,
      description: meta.description,
    },
  }
}

export default function CommunityChannelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
