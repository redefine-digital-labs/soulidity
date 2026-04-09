import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import type { DesktopCatalogItem, DesktopCatalogSourceType } from '@/lib/types/desktop'

function asIso(value: Date) {
  return value.toISOString()
}

export function buildDesktopCatalogWhere(params: {
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
} = {}): Prisma.DesktopCatalogEntryWhereInput {
  const where: Prisma.DesktopCatalogEntryWhereInput = {}

  if (!params.includeUnpublished) {
    where.isPublished = true
  }

  if (!params.includeHidden) {
    where.isHidden = false
  }

  if (params.sourceType) {
    where.sourceType = params.sourceType
  }

  return where
}

const desktopCatalogEntryListSelect = {
  id: true,
  sourceType: true,
  sourceRef: true,
  sortOrder: true,
  updatedAt: true,
} as const

const starterCatalogSelect = {
  slug: true,
  title: true,
  description: true,
  coverImage: true,
  thumbnail: true,
  updatedAt: true,
} as const

const soulCatalogSelect = {
  onChainId: true,
  name: true,
  description: true,
  imageUrl: true,
  previewImages: true,
  updatedAt: true,
} as const

type DesktopCatalogEntryRow = Prisma.DesktopCatalogEntryGetPayload<{ select: typeof desktopCatalogEntryListSelect }>
type StarterCatalogRow = Prisma.StarterPersonaAssetGetPayload<{ select: typeof starterCatalogSelect }>
type SoulCatalogRow = Prisma.SoulAssetGetPayload<{ select: typeof soulCatalogSelect }>

function toStarterCatalogItem(entry: DesktopCatalogEntryRow, starter: StarterCatalogRow): DesktopCatalogItem {
  return {
    id: entry.id,
    sourceType: 'starter',
    sourceRef: entry.sourceRef,
    title: starter.title,
    description: starter.description,
    coverImage: starter.coverImage,
    thumbnail: starter.thumbnail,
    updatedAt: asIso(starter.updatedAt),
  }
}

function toSoulCatalogItem(entry: DesktopCatalogEntryRow, soul: SoulCatalogRow): DesktopCatalogItem {
  return {
    id: entry.id,
    sourceType: 'soul',
    sourceRef: entry.sourceRef,
    title: soul.name,
    description: soul.description,
    coverImage: soul.imageUrl,
    thumbnail: soul.previewImages[0] ?? soul.imageUrl,
    updatedAt: asIso(soul.updatedAt),
  }
}

export async function listDesktopCatalogItems(params: {
  page: number
  pageSize: number
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
}) {
  const where = buildDesktopCatalogWhere(params)

  const [entries, total] = await Promise.all([
    prisma.desktopCatalogEntry.findMany({
      where,
      select: desktopCatalogEntryListSelect,
      orderBy: [
        { sortOrder: 'asc' },
        { updatedAt: 'desc' },
      ],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.desktopCatalogEntry.count({ where }),
  ])

  if (entries.length === 0) {
    return { items: [], total }
  }

  const starterRefs = entries
    .filter((entry) => entry.sourceType === 'starter')
    .map((entry) => entry.sourceRef)
  const soulRefs = entries
    .filter((entry) => entry.sourceType === 'soul')
    .map((entry) => entry.sourceRef)

  const [starters, souls] = await Promise.all([
    starterRefs.length > 0
      ? prisma.starterPersonaAsset.findMany({
          where: {
            slug: {
              in: starterRefs,
            },
          },
          select: starterCatalogSelect,
        })
      : Promise.resolve([] as StarterCatalogRow[]),
    soulRefs.length > 0
      ? prisma.soulAsset.findMany({
          where: {
            onChainId: {
              in: soulRefs,
            },
          },
          select: soulCatalogSelect,
        })
      : Promise.resolve([] as SoulCatalogRow[]),
  ])

  const startersBySlug = new Map(starters.map((starter) => [starter.slug, starter]))
  const soulsByOnChainId = new Map(souls.map((soul) => [soul.onChainId, soul]))

  const items: DesktopCatalogItem[] = []

  for (const entry of entries) {
    if (entry.sourceType === 'starter') {
      const starter = startersBySlug.get(entry.sourceRef)
      if (starter) {
        items.push(toStarterCatalogItem(entry, starter))
      }
      continue
    }

    if (entry.sourceType === 'soul') {
      const soul = soulsByOnChainId.get(entry.sourceRef)
      if (soul) {
        items.push(toSoulCatalogItem(entry, soul))
      }
    }
  }

  return { items, total }
}
