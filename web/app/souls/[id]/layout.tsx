import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'

type Params = { id: string }

async function loadSoul(id: string) {
  try {
    return await prisma.soulAsset.findUnique({
      where: { onChainId: id },
      select: {
        name: true,
        description: true,
        imageUrl: true,
        listingStatus: true,
        listedPriceAtomic: true,
        tags: true,
      },
    })
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { id } = await params
  const soul = await loadSoul(id)

  if (!soul) {
    return {
      title: 'Soul',
      description: 'Soulidity on-chain Soul asset.',
      alternates: { canonical: `/souls/${id}` },
      robots: { index: false, follow: true },
    }
  }

  const priceSuffix =
    soul.listingStatus === 'listed' && soul.listedPriceAtomic
      ? ` · Listed for ${formatAtomicAmountForDisplay(soul.listedPriceAtomic.toString())}`
      : ''
  const title = `${soul.name}${priceSuffix}`
  const description = soul.description?.slice(0, 200) || `${soul.name} on Soulidity.`
  // Crawlers cannot resolve a browser-only native artwork reference. Never
  // turn protected Walrus content into an unauthenticated social image URL.
  const artworkUrl = soul.imageUrl?.startsWith('https://') ? soul.imageUrl : null
  const ogImages = artworkUrl ? [{ url: artworkUrl }] : undefined

  return {
    title,
    description,
    keywords: soul.tags?.length ? soul.tags : undefined,
    alternates: { canonical: `/souls/${id}` },
    openGraph: {
      title: `${soul.name} · Soulidity`,
      description,
      url: `/souls/${id}`,
      type: 'article',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${soul.name} · Soulidity`,
      description,
      images: artworkUrl ? [artworkUrl] : undefined,
    },
  }
}

export default function SoulDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
