import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@/lib/soulidity/repository'
import type { Prisma } from '@db/prisma-client'
import { buildAgentTagLikePatterns, parsePersonaFilter } from '@/lib/soulidity/persona'
import { buildSoulsWhere } from './query'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50
export const dynamic = 'force-dynamic'

type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'popular'

// Token-boundary LIKE patterns mirror the shared `tagMatchesAgentKeyword`
// classifier so `inferPersona` and this server-side filter cannot drift apart
// (and so bare substrings like "ai" inside "maid"/"fairy" no longer match).
const AGENT_KEYWORD_PATTERNS = buildAgentTagLikePatterns()

// Mirror `normalizeTagForMatch` from the shared classifier in SQL: any run of
// whitespace or underscores collapses to `-` so free-form tags like
// "AI Agent" or "research_bot" hit the same hyphen-token LIKE patterns.
async function loadPersonaMatchIds(persona: 'agents' | 'characters'): Promise<string[]> {
  const rows = persona === 'agents'
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "soul_assets"
        WHERE "listing_status" = 'listed'
          AND EXISTS (
            SELECT 1 FROM unnest(tags) AS t
            WHERE regexp_replace(lower(t), '[[:space:]_]+', '-', 'g') LIKE ANY (${AGENT_KEYWORD_PATTERNS})
          )
      `
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "soul_assets"
        WHERE "listing_status" = 'listed'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(tags) AS t
            WHERE regexp_replace(lower(t), '[[:space:]_]+', '-', 'g') LIKE ANY (${AGENT_KEYWORD_PATTERNS})
          )
      `
  return rows.map((r) => r.id)
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseSortOption(value: string | null): SortOption {
  if (value === 'price_asc' || value === 'price_desc' || value === 'popular') return value
  return 'newest'
}

function buildOrderBy(sort: SortOption): Prisma.SoulAssetOrderByWithRelationInput {
  switch (sort) {
    case 'price_asc':
      return { listedPriceAtomic: 'asc' }
    case 'price_desc':
      return { listedPriceAtomic: 'desc' }
    case 'popular':
      return { activeGrantCount: 'desc' }
    case 'newest':
    default:
      return { createdAt: 'desc' }
  }
}

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInteger(request.nextUrl.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
  )
  const q = request.nextUrl.searchParams.get('q')?.trim() || ''
  const tag = request.nextUrl.searchParams.get('tag')?.trim() || ''
  const sort = parseSortOption(request.nextUrl.searchParams.get('sort'))
  const minPriceRaw = request.nextUrl.searchParams.get('minPrice')?.trim() || ''
  const maxPriceRaw = request.nextUrl.searchParams.get('maxPrice')?.trim() || ''
  const creator = request.nextUrl.searchParams.get('creator')?.trim() || ''
  const persona = parsePersonaFilter(request.nextUrl.searchParams.get('persona'))

  let personaIds: string[] | null = null
  if (persona !== 'all') {
    personaIds = await loadPersonaMatchIds(persona)
    if (personaIds.length === 0) {
      return NextResponse.json({ items: [], total: 0, page, totalPages: 1 })
    }
  }

  const where = buildSoulsWhere({ q, tag, minPriceRaw, maxPriceRaw, creator, personaIds })

  const orderBy = buildOrderBy(sort)

  const [items, total] = await Promise.all([
    prisma.soulAsset.findMany({
      where,
      select: soulAssetSummarySelect,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.soulAsset.count({ where }),
  ])

  return NextResponse.json({
    items: toSoulAssetSummaryList(items),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}
