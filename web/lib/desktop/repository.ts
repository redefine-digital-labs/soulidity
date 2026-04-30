import type { Prisma } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'
import { resolveDesktopSpriteManifest } from '@/lib/desktop/sprite-contract'
import { CANONICAL_PERSONA_SPRITE_ASSET_NAME } from '@/lib/soulidity/metadata'
import type { SoulListingStatus } from '@/lib/soulidity/types'
import { materializeWalrusBlobUrls } from '@/lib/services/walrus'
import type {
  DesktopCatalogItem,
  DesktopCatalogSourceType,
  DesktopPersonaManifest,
  DesktopPersonaManifestFile,
} from '@/lib/types/desktop'

function asIso(value: Date) {
  return value.toISOString()
}

function asAtomicString(value: { toString(): string } | null | undefined) {
  return value ? value.toString() : null
}

const DYNAMIC_SOUL_CATALOG_ID_PREFIX = 'soul:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  metadataOnChainId: true,
  activeSpriteAssetName: true,
  activeSpriteVersionIndex: true,
  activeSpriteDownloadPolicy: true,
  spriteConfigJson: true,
  spriteMoodMapJson: true,
  listingStatus: true,
  listedPriceAtomic: true,
  updatedAt: true,
  assetVersions: {
    where: {
      deletedAt: null,
      assetName: CANONICAL_PERSONA_SPRITE_ASSET_NAME,
    },
    select: {
      assetName: true,
      versionIndex: true,
      visibility: true,
      assetType: true,
      blobId: true,
      blobObjectId: true,
    },
    orderBy: {
      versionIndex: 'desc',
    },
  },
} as const

type DesktopCatalogEntryRow = Prisma.DesktopCatalogEntryGetPayload<{ select: typeof desktopCatalogEntryListSelect }>
type StarterCatalogRow = Prisma.StarterPersonaAssetGetPayload<{ select: typeof starterCatalogSelect }>
type SoulCatalogRow = Prisma.SoulAssetGetPayload<{ select: typeof soulCatalogSelect }>
type DesktopCatalogSource = {
  id: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
}
type ExplicitCatalogSourceRow = {
  id: string
  sourceType: string
  sourceRef: string
}
type CountRow = { count: bigint | number | string }

type PendingCatalogSource =
  | {
      kind: 'starter'
      entry: DesktopCatalogSource
      starter: StarterCatalogRow
    }
  | {
      kind: 'soul'
      entry: DesktopCatalogSource
      soul: SoulCatalogRow
    }

const desktopCatalogEntryManifestSelect = {
  id: true,
  sourceType: true,
  sourceRef: true,
} as const

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

function buildDynamicSoulCatalogId(onChainId: string) {
  return `${DYNAMIC_SOUL_CATALOG_ID_PREFIX}${onChainId}`
}

function parseDynamicSoulCatalogId(id: string) {
  if (!id.startsWith(DYNAMIC_SOUL_CATALOG_ID_PREFIX)) {
    return null
  }

  const onChainId = id.slice(DYNAMIC_SOUL_CATALOG_ID_PREFIX.length).trim()
  return onChainId.length > 0 ? onChainId : null
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function normalizeListingStatus(value: string): SoulListingStatus | null {
  if (value === 'held' || value === 'listed' || value === 'floor-violation') {
    return value
  }
  return null
}

function buildDynamicSoulCatalogSource(onChainId: string): DesktopCatalogSource {
  return {
    id: buildDynamicSoulCatalogId(onChainId),
    sourceType: 'soul',
    sourceRef: onChainId,
  }
}

function toCount(rows: CountRow[]): number {
  const raw = rows[0]?.count ?? 0
  return Number(raw)
}

function toDesktopCatalogSource(row: ExplicitCatalogSourceRow): DesktopCatalogSource | null {
  if (row.sourceType !== 'starter' && row.sourceType !== 'soul') {
    return null
  }
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
  }
}

async function countValidExplicitCatalogSources(params: {
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
}): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "desktop_catalog_entries" e
    WHERE (${params.includeUnpublished === true} OR e."is_published" = true)
      AND (${params.includeHidden === true} OR e."is_hidden" = false)
      AND (${params.sourceType ?? null}::text IS NULL OR e."source_type" = ${params.sourceType ?? null})
      AND (
        (
          e."source_type" = 'starter'
          AND EXISTS (
            SELECT 1
            FROM "starter_persona_assets" starter
            WHERE starter."slug" = e."source_ref"
          )
        )
        OR (
          e."source_type" = 'soul'
          AND EXISTS (
            SELECT 1
            FROM "soul_assets" soul
            WHERE soul."on_chain_id" = e."source_ref"
              AND soul."listing_status" = 'listed'
          )
        )
      )
  `
  return toCount(rows)
}

async function listValidExplicitCatalogSources(params: {
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
  skip: number
  take: number
}): Promise<DesktopCatalogSource[]> {
  if (params.take <= 0) return []

  const rows = await prisma.$queryRaw<ExplicitCatalogSourceRow[]>`
    SELECT
      e."id",
      e."source_type" AS "sourceType",
      e."source_ref" AS "sourceRef"
    FROM "desktop_catalog_entries" e
    WHERE (${params.includeUnpublished === true} OR e."is_published" = true)
      AND (${params.includeHidden === true} OR e."is_hidden" = false)
      AND (${params.sourceType ?? null}::text IS NULL OR e."source_type" = ${params.sourceType ?? null})
      AND (
        (
          e."source_type" = 'starter'
          AND EXISTS (
            SELECT 1
            FROM "starter_persona_assets" starter
            WHERE starter."slug" = e."source_ref"
          )
        )
        OR (
          e."source_type" = 'soul'
          AND EXISTS (
            SELECT 1
            FROM "soul_assets" soul
            WHERE soul."on_chain_id" = e."source_ref"
              AND soul."listing_status" = 'listed'
          )
        )
      )
    ORDER BY e."sort_order" ASC, e."updated_at" DESC
    OFFSET ${params.skip}
    LIMIT ${params.take}
  `

  return rows.flatMap((row) => {
    const source = toDesktopCatalogSource(row)
    return source ? [source] : []
  })
}

async function listVisibleExplicitSoulRefs(params: {
  includeHidden?: boolean
  includeUnpublished?: boolean
}): Promise<string[]> {
  const entries = await prisma.desktopCatalogEntry.findMany({
    where: buildDesktopCatalogWhere({
      ...params,
      sourceType: 'soul',
    }),
    select: {
      sourceRef: true,
    },
  })
  return (entries ?? []).map((entry) => entry.sourceRef)
}

async function loadPendingCatalogSources(sources: DesktopCatalogSource[]): Promise<PendingCatalogSource[]> {
  const starterRefs = sources
    .filter((entry) => entry.sourceType === 'starter')
    .map((entry) => entry.sourceRef)
  const explicitSoulRefs = sources
    .filter((entry) => entry.sourceType === 'soul')
    .map((entry) => entry.sourceRef)

  const [starters, explicitSouls] = await Promise.all([
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
    explicitSoulRefs.length > 0
      ? prisma.soulAsset.findMany({
          where: {
            onChainId: {
              in: explicitSoulRefs,
            },
            listingStatus: 'listed',
          },
          select: soulCatalogSelect,
        })
      : Promise.resolve([] as SoulCatalogRow[]),
  ])

  const startersBySlug = new Map(starters.map((starter) => [starter.slug, starter]))
  const explicitSoulsByOnChainId = new Map(explicitSouls.map((soul) => [soul.onChainId, soul]))

  return sources.flatMap((entry): PendingCatalogSource[] => {
    if (entry.sourceType === 'starter') {
      const starter = startersBySlug.get(entry.sourceRef)
      return starter ? [{ kind: 'starter', entry, starter }] : []
    }

    const soul = explicitSoulsByOnChainId.get(entry.sourceRef)
    return soul ? [{ kind: 'soul', entry, soul }] : []
  })
}

function toStarterCatalogItem(entry: DesktopCatalogSource, starter: StarterCatalogRow): DesktopCatalogItem {
  return {
    id: entry.id,
    sourceType: 'starter',
    sourceRef: entry.sourceRef,
    title: starter.title,
    description: starter.description,
    coverImage: starter.coverImage,
    thumbnail: starter.thumbnail,
    listingStatus: null,
    listedPriceAtomic: null,
    spriteDownloadPolicy: 'public',
    updatedAt: asIso(starter.updatedAt),
  }
}

function toStarterPersonaManifest(
  entry: DesktopCatalogSource,
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
    listingStatus: null,
    listedPriceAtomic: null,
    spriteDownloadPolicy: 'public',
    version: starter.version,
    checksum: starter.checksum,
    files: normalizeManifestFiles(starter.files),
    sprite: null,
    downloadMode: 'direct',
    updatedAt: asIso(starter.updatedAt),
  }
}

async function resolveSoulSpriteManifest(soul: SoulCatalogRow) {
  return resolveDesktopSpriteManifest({
    metadataOnChainId: soul.metadataOnChainId,
    activeSpriteAssetName: soul.activeSpriteAssetName,
    activeSpriteVersionIndex: soul.activeSpriteVersionIndex == null ? null : Number(soul.activeSpriteVersionIndex),
    activeSpriteDownloadPolicy: soul.activeSpriteDownloadPolicy,
    spriteConfigJson: soul.spriteConfigJson,
    spriteMoodMapJson: soul.spriteMoodMapJson,
    assetVersions: soul.assetVersions.map((version) => ({
      ...version,
      versionIndex: Number(version.versionIndex),
    })),
  })
}

async function toSoulCatalogItem(entry: DesktopCatalogSource, soul: SoulCatalogRow): Promise<DesktopCatalogItem> {
  const coverImage = materializeDesktopImage(soul.imageUrl)
  const sprite = await resolveSoulSpriteManifest(soul)

  return {
    id: entry.id,
    sourceType: 'soul',
    sourceRef: entry.sourceRef,
    title: soul.name,
    description: soul.description,
    coverImage,
    thumbnail: resolveDesktopThumbnail(soul.previewImages, coverImage),
    listingStatus: normalizeListingStatus(soul.listingStatus),
    listedPriceAtomic: asAtomicString(soul.listedPriceAtomic),
    spriteDownloadPolicy: sprite.downloadPolicy,
    updatedAt: asIso(soul.updatedAt),
  }
}

async function toSoulPersonaManifest(
  entry: DesktopCatalogSource,
  soul: SoulCatalogRow,
): Promise<DesktopPersonaManifest> {
  const coverImage = materializeDesktopImage(soul.imageUrl)
  const sprite = await resolveSoulSpriteManifest(soul)

  return {
    id: entry.id,
    sourceType: 'soul',
    sourceRef: entry.sourceRef,
    title: soul.name,
    description: soul.description,
    coverImage,
    thumbnail: resolveDesktopThumbnail(soul.previewImages, coverImage),
    listingStatus: normalizeListingStatus(soul.listingStatus),
    listedPriceAtomic: asAtomicString(soul.listedPriceAtomic),
    spriteDownloadPolicy: sprite.downloadPolicy,
    version: asIso(soul.updatedAt),
    checksum: `desktop-soul:${soul.onChainId}:${soul.updatedAt.toISOString()}`,
    files: [],
    sprite,
    routeId: soul.onChainId,
    onChainId: soul.onChainId,
    downloadMode: 'authenticated',
    updatedAt: asIso(soul.updatedAt),
  }
}

async function findDesktopPersonaManifestForEntry(
  entry: DesktopCatalogSource,
): Promise<DesktopPersonaManifest | null> {
  if (entry.sourceType === 'starter') {
    const starter = await prisma.starterPersonaAsset.findUnique({
      where: { slug: entry.sourceRef },
      select: starterCatalogSelect,
    })

    return starter ? toStarterPersonaManifest(entry, starter) : null
  }

  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: entry.sourceRef },
    select: soulCatalogSelect,
  })

  return soul ? toSoulPersonaManifest(entry, soul) : null
}

async function resolvePendingCatalogItem(item: PendingCatalogSource): Promise<DesktopCatalogItem> {
  return item.kind === 'starter'
    ? toStarterCatalogItem(item.entry, item.starter)
    : toSoulCatalogItem(item.entry, item.soul)
}

export async function listDesktopCatalogItems(params: {
  page: number
  pageSize: number
  includeHidden?: boolean
  includeUnpublished?: boolean
  sourceType?: DesktopCatalogSourceType | null
}) {
  const start = (params.page - 1) * params.pageSize
  const explicitTotal = await countValidExplicitCatalogSources(params)
  const explicitTake = start < explicitTotal
    ? Math.min(params.pageSize, explicitTotal - start)
    : 0

  const explicitSources = await listValidExplicitCatalogSources({
    ...params,
    skip: start,
    take: explicitTake,
  })
  const pending = await loadPendingCatalogSources(explicitSources)

  let dynamicTotal = 0
  if (params.sourceType !== 'starter') {
    const explicitSoulRefs = await listVisibleExplicitSoulRefs(params)
    const dynamicWhere: Prisma.SoulAssetWhereInput = explicitSoulRefs.length > 0
      ? {
          listingStatus: 'listed',
          onChainId: { notIn: explicitSoulRefs },
        }
      : { listingStatus: 'listed' }
    dynamicTotal = await prisma.soulAsset.count({ where: dynamicWhere })

    const dynamicTake = params.pageSize - pending.length
    const dynamicSkip = Math.max(0, start - explicitTotal)
    if (dynamicTake > 0 && dynamicSkip < dynamicTotal) {
      const dynamicListedSouls = await prisma.soulAsset.findMany({
        where: dynamicWhere,
        select: soulCatalogSelect,
        orderBy: { updatedAt: 'desc' },
        skip: dynamicSkip,
        take: dynamicTake,
      })

      for (const soul of dynamicListedSouls) {
        pending.push({
          kind: 'soul',
          entry: buildDynamicSoulCatalogSource(soul.onChainId),
          soul,
        })
      }
    }
  }

  return {
    items: await Promise.all(pending.map(resolvePendingCatalogItem)),
    total: explicitTotal + dynamicTotal,
  }
}

export async function listDesktopCatalogItemsBySourceRefs(params: {
  sourceType: DesktopCatalogSourceType
  sourceRefs: string[]
}): Promise<DesktopCatalogItem[]> {
  const sourceRefs = Array.from(new Set(params.sourceRefs))
  if (sourceRefs.length === 0) {
    return []
  }

  const entries = await prisma.desktopCatalogEntry.findMany({
    where: {
      sourceType: params.sourceType,
      sourceRef: { in: sourceRefs },
      isPublished: true,
      isHidden: false,
    },
    select: desktopCatalogEntryListSelect,
  })
  const entriesByRef = new Map(entries.map((entry) => [entry.sourceRef, entry]))

  if (params.sourceType === 'starter') {
    const starters = await prisma.starterPersonaAsset.findMany({
      where: { slug: { in: sourceRefs } },
      select: starterCatalogSelect,
    })
    const bySlug = new Map(starters.map((starter) => [starter.slug, starter]))
    return sourceRefs.flatMap((sourceRef) => {
      const entry = entriesByRef.get(sourceRef)
      const starter = bySlug.get(sourceRef)
      return entry && starter
        ? [toStarterCatalogItem({
            id: entry.id,
            sourceType: 'starter',
            sourceRef: entry.sourceRef,
          }, starter)]
        : []
    })
  }

  const souls = await prisma.soulAsset.findMany({
    where: { onChainId: { in: sourceRefs } },
    select: soulCatalogSelect,
  })
  const byId = new Map(souls.map((soul) => [soul.onChainId, soul]))
  const items = await Promise.all(sourceRefs.map(async (sourceRef) => {
    const soul = byId.get(sourceRef)
    if (!soul) {
      return null
    }

    const entry = entriesByRef.get(sourceRef)
    return toSoulCatalogItem(
      entry
        ? {
            id: entry.id,
            sourceType: 'soul',
            sourceRef: entry.sourceRef,
          }
        : buildDynamicSoulCatalogSource(soul.onChainId),
      soul,
    )
  }))

  return items.filter((item): item is DesktopCatalogItem => item !== null)
}

export async function findDesktopPersonaManifestById(
  id: string,
  options: { publicOnly?: boolean } = {},
): Promise<DesktopPersonaManifest | null> {
  const dynamicSoulOnChainId = parseDynamicSoulCatalogId(id)
  if (dynamicSoulOnChainId) {
    const soul = await prisma.soulAsset.findFirst({
      where: options.publicOnly
        ? { onChainId: dynamicSoulOnChainId, listingStatus: 'listed' }
        : { onChainId: dynamicSoulOnChainId },
      select: soulCatalogSelect,
    })

    return soul ? toSoulPersonaManifest(buildDynamicSoulCatalogSource(soul.onChainId), soul) : null
  }

  if (!isUuid(id)) {
    return null
  }

  const entry = await prisma.desktopCatalogEntry.findFirst({
    where: { id, isPublished: true, isHidden: false },
    select: desktopCatalogEntryManifestSelect,
  })

  if (entry) {
    return findDesktopPersonaManifestForEntry({
      id: entry.id,
      sourceType: entry.sourceType as DesktopCatalogSourceType,
      sourceRef: entry.sourceRef,
    })
  }

  return null
}

export async function findDesktopPersonaManifestBySource(params: {
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  publicOnly?: boolean
}): Promise<DesktopPersonaManifest | null> {
  if (params.sourceType === 'starter') {
    const entry = await prisma.desktopCatalogEntry.findFirst({
      where: {
        sourceType: params.sourceType,
        sourceRef: params.sourceRef,
        isPublished: true,
        isHidden: false,
      },
      select: desktopCatalogEntryManifestSelect,
    })

    return entry
      ? findDesktopPersonaManifestForEntry({
          id: entry.id,
          sourceType: 'starter',
          sourceRef: entry.sourceRef,
        })
      : null
  }

  const entry = await prisma.desktopCatalogEntry.findFirst({
    where: {
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
      isPublished: true,
      isHidden: false,
    },
    select: desktopCatalogEntryManifestSelect,
  })

  if (entry) {
    return findDesktopPersonaManifestForEntry({
      id: entry.id,
      sourceType: 'soul',
      sourceRef: entry.sourceRef,
    })
  }

  const soul = await prisma.soulAsset.findFirst({
    where: params.publicOnly
      ? { onChainId: params.sourceRef, listingStatus: 'listed' }
      : { onChainId: params.sourceRef },
    select: soulCatalogSelect,
  })

  return soul ? toSoulPersonaManifest(buildDynamicSoulCatalogSource(soul.onChainId), soul) : null
}
