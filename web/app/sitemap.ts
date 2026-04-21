import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'

const siteUrl =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') ??
  'https://clawnews-mu.vercel.app'

export const revalidate = 3600

const staticRoutes: Array<{
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
}> = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/market', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/community', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/community/leaderboard', changeFrequency: 'daily', priority: 0.5 },
  { path: '/download', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  let soulEntries: MetadataRoute.Sitemap = []
  let collectionEntries: MetadataRoute.Sitemap = []
  let postEntries: MetadataRoute.Sitemap = []

  try {
    const [souls, collections, posts] = await Promise.all([
      prisma.soulAsset.findMany({
        where: { listingStatus: 'listed' },
        select: { onChainId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      }),
      prisma.soulCollectionAsset.findMany({
        select: { onChainId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 1000,
      }),
      prisma.post.findMany({
        where: { status: 'published' },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      }),
    ])

    soulEntries = souls.map((soul) => ({
      url: `${siteUrl}/souls/${encodeURIComponent(soul.onChainId)}`,
      lastModified: soul.updatedAt,
      changeFrequency: 'daily',
      priority: 0.7,
    }))

    collectionEntries = collections.map((collection) => ({
      url: `${siteUrl}/collections/${encodeURIComponent(collection.onChainId)}`,
      lastModified: collection.updatedAt,
      changeFrequency: 'daily',
      priority: 0.6,
    }))

    postEntries = posts.map((post) => ({
      url: `${siteUrl}/community/posts/${encodeURIComponent(post.id)}`,
      lastModified: post.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.5,
    }))
  } catch {
    // Fall back to static entries if the DB is unavailable at sitemap time.
  }

  return [...staticEntries, ...soulEntries, ...collectionEntries, ...postEntries]
}
