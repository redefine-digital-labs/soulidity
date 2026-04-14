import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { getBlobUrl, materializeWalrusBlobUrls } from '@web/lib/services/walrus'
import type {
  DesktopCatalogItem,
  DesktopCatalogSourceType,
  DesktopPersonaManifest,
  DesktopPersonaManifestFile,
} from '@/lib/types/desktop'

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
  version: true,
  checksum: true,
  files: true,
  updatedAt: true,
} as const

const soulCatalogSelect = {
  onChainId: true,
  name: true,
  description: true,
  imageUrl: true,
  previewImages: true,
  contentBlobId: true,
  updatedAt: true,
} as const

type DesktopCatalogEntryRow = Prisma.DesktopCatalogEntryGetPayload<{ select: typeof desktopCatalogEntryListSelect }>
type StarterCatalogRow = Prisma.StarterPersonaAssetGetPayload<{ select: typeof starterCatalogSelect }>
type SoulCatalogRow = Prisma.SoulAssetGetPayload<{ select: typeof soulCatalogSelect }>

const desktopCatalogEntryManifestSelect = {
  id: true,
  sourceType: true,
  sourceRef: true,
} as const

type DesktopCatalogEntryManifestRow = Prisma.DesktopCatalogEntryGetPayload<{ select: typeof desktopCatalogEntryManifestSelect }>

function materializeDesktopImage(value: string) {
  return materializeWalrusBlobUrls([value])[0] ?? value
}

function resolveDesktopThumbnail(previewImages: string[], fallbackImage: string) {
  const materializedPreview = materializeWalrusBlobUrls(previewImages)[0]
  return materializedPreview ?? previewImages[0] ?? fallbackImage
}

function normalizeManifestFiles(value: unknown): DesktopPersonaManifestFile[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const path = 'path' in entry && typeof entry.path === 'string' ? entry.path : null
    const url = 'url' in entry && typeof entry.url === 'string' ? entry.url : null
    const checksum = 'checksum' in entry && typeof entry.checksum === 'string' ? entry.checksum : null

    if (!path || !url || !checksum) {
      return []
    }

    return [{ path, url, checksum }]
  })
}

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

function toStarterPersonaManifest(
  entry: DesktopCatalogEntryManifestRow,
  starter: StarterCatalogRow,
): DesktopPersonaManifest {
  return {
    id: entry.id,
    sourceType: 'starter',
    sourceRef: entry.sourceRef,
    title: starter.title,
    description: starter.description,
    coverImage: starter.coverImage,
    thumbnail: starter.thumbnail,
    version: starter.version,
    checksum: starter.checksum,
    files: normalizeManifestFiles(starter.files),
    downloadMode: 'direct',
    updatedAt: asIso(starter.updatedAt),
  }
}

function toSoulCatalogItem(entry: DesktopCatalogEntryRow, soul: SoulCatalogRow): DesktopCatalogItem {
  const coverImage = materializeDesktopImage(soul.imageUrl)

  return {
    id: entry.id,
    sourceType: 'soul',
    sourceRef: entry.sourceRef,
    title: soul.name,
    description: soul.description,
    coverImage,
    thumbnail: resolveDesktopThumbnail(soul.previewImages, coverImage),
    updatedAt: asIso(soul.updatedAt),
  }
}

function toSoulPersonaManifest(
  entry: DesktopCatalogEntryManifestRow,
  soul: SoulCatalogRow,
): DesktopPersonaManifest {
  const checksum = `walrus:${soul.contentBlobId}`
  const coverImage = materializeDesktopImage(soul.imageUrl)

  return {
    id: entry.id,
    sourceType: 'soul',
    sourceRef: entry.sourceRef,
    title: soul.name,
    description: soul.description,
    coverImage,
    thumbnail: resolveDesktopThumbnail(soul.previewImages, coverImage),
    version: asIso(soul.updatedAt),
    checksum,
    files: [
      {
        path: 'soul.bundle',
        url: getBlobUrl(soul.contentBlobId),
        checksum,
      },
    ],
    routeId: soul.onChainId,
    onChainId: soul.onChainId,
    downloadMode: 'authenticated',
    updatedAt: asIso(soul.updatedAt),
  }
}

async function findDesktopPersonaManifestForEntry(
  entry: DesktopCatalogEntryManifestRow,
): Promise<DesktopPersonaManifest | null> {
  if (entry.sourceType === 'starter') {
    const starter = await prisma.starterPersonaAsset.findUnique({
      where: { slug: entry.sourceRef },
      select: starterCatalogSelect,
    })

    return starter ? toStarterPersonaManifest(entry, starter) : null
  }

  if (entry.sourceType === 'soul') {
    const soul = await prisma.soulAsset.findUnique({
      where: { onChainId: entry.sourceRef },
      select: soulCatalogSelect,
    })

    return soul ? toSoulPersonaManifest(entry, soul) : null
  }

  return null
}

export async function listDesktopCatalogItems(params: {
  page: number
  pageSize: number
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
}) {
  const where = buildDesktopCatalogWhere(params)

  // Fetch all matching entries first, then paginate after resolving sources.
  // This avoids under-filled pages when a catalog entry points to a deleted source.
  const entries = await prisma.desktopCatalogEntry.findMany({
    where,
    select: desktopCatalogEntryListSelect,
    orderBy: [
      { sortOrder: 'asc' },
      { updatedAt: 'desc' },
    ],
  })

  if (entries.length === 0) {
    return { items: [], total: 0 }
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

  const start = (params.page - 1) * params.pageSize
  return { items: items.slice(start, start + params.pageSize), total: items.length }
}

export async function listDesktopCatalogItemsBySourceRefs(params: {
  sourceType: DesktopCatalogSourceType
  sourceRefs: string[]
}): Promise<DesktopCatalogItem[]> {
  if (params.sourceRefs.length === 0) {
    return []
  }

  const entries = await prisma.desktopCatalogEntry.findMany({
    where: {
      sourceType: params.sourceType,
      sourceRef: { in: params.sourceRefs },
      isPublished: true,
      isHidden: false,
    },
    select: desktopCatalogEntryListSelect,
    orderBy: [
      { sortOrder: 'asc' },
      { updatedAt: 'desc' },
    ],
  })

  if (entries.length === 0) {
    return []
  }

  if (params.sourceType === 'starter') {
    const refs = entries.map((e) => e.sourceRef)
    const starters = await prisma.starterPersonaAsset.findMany({
      where: { slug: { in: refs } },
      select: starterCatalogSelect,
    })
    const bySlug = new Map(starters.map((s) => [s.slug, s]))
    return entries.flatMap((entry) => {
      const starter = bySlug.get(entry.sourceRef)
      return starter ? [toStarterCatalogItem(entry, starter)] : []
    })
  }

  if (params.sourceType === 'soul') {
    const refs = entries.map((e) => e.sourceRef)
    const souls = await prisma.soulAsset.findMany({
      where: { onChainId: { in: refs } },
      select: soulCatalogSelect,
    })
    const byId = new Map(souls.map((s) => [s.onChainId, s]))
    return entries.flatMap((entry) => {
      const soul = byId.get(entry.sourceRef)
      return soul ? [toSoulCatalogItem(entry, soul)] : []
    })
  }

  return []
}

export async function findDesktopPersonaManifestById(id: string): Promise<DesktopPersonaManifest | null> {
  const entry = await prisma.desktopCatalogEntry.findFirst({
    where: { id, isPublished: true, isHidden: false },
    select: desktopCatalogEntryManifestSelect,
  })

  if (!entry) {
    return null
  }

  return findDesktopPersonaManifestForEntry(entry)
}

export async function findDesktopPersonaManifestBySource(params: {
  sourceType: DesktopCatalogSourceType
  sourceRef: string
}): Promise<DesktopPersonaManifest | null> {
  const entry = await prisma.desktopCatalogEntry.findFirst({
    where: {
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      isPublished: true,
      isHidden: false,
    },
    select: desktopCatalogEntryManifestSelect,
  })

  if (!entry) {
    return null
  }

  return findDesktopPersonaManifestForEntry(entry)
}
