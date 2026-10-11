import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'

type Params = { id: string }

async function loadCollection(id: string) {
  try {
    return await prisma.soulCollectionAsset.findUnique({
      where: { onChainId: id },
      select: {
        name: true,
        description: true,
        imageUrl: true,
        listingStatus: true,
        listedPriceAtomic: true,
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
  const collection = await loadCollection(id)

  if (!collection) {
    return {
      title: 'Collection',
      description: 'Soulidity on-chain Soul collection.',
      alternates: { canonical: `/collections/${id}` },
      robots: { index: false, follow: true },
    }
  }

  const priceSuffix =
    collection.listingStatus === 'listed' && collection.listedPriceAtomic
      ? ` · Listed for ${formatAtomicAmountForDisplay(collection.listedPriceAtomic.toString())}`
      : ''
  const title = `${collection.name}${priceSuffix}`
  const description = collection.description?.slice(0, 200) || `${collection.name} on Soulidity.`
  const ogImages = collection.imageUrl ? [{ url: collection.imageUrl }] : undefined

  return {
    title,
    description,
    alternates: { canonical: `/collections/${id}` },
    openGraph: {
      title: `${collection.name} · Soulidity`,
      description,
      url: `/collections/${id}`,
      type: 'article',
      images: ogImages,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${collection.name} · Soulidity`,
      description,
      images: collection.imageUrl ? [collection.imageUrl] : undefined,
    },
  }
}

export default function CollectionDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
