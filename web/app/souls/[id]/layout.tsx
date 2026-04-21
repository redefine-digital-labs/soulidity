import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

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
  const ogImages = soul.imageUrl ? [{ url: soul.imageUrl }] : undefined

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
      images: soul.imageUrl ? [soul.imageUrl] : undefined,
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
