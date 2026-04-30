import type { Prisma } from '@db/prisma-client'

export function buildSoulsWhere(params: {
  q: string
  tag: string
  minPriceRaw: string
  maxPriceRaw: string
  creator: string
  personaKind?: 'agents' | 'characters' | null
}): Prisma.SoulAssetWhereInput {
  const { q, tag, minPriceRaw, maxPriceRaw, creator, personaKind } = params
  const where: Prisma.SoulAssetWhereInput = {
    listingStatus: 'listed',
  }

  if (personaKind) {
    where.personaKind = personaKind
  }

  if (tag) {
    where.tags = { has: tag.toLowerCase() }
  }

  const conditions: Prisma.SoulAssetWhereInput[] = []

  if (q) {
    conditions.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ],
    })
  }

  if (minPriceRaw || maxPriceRaw) {
    const priceFilter: Prisma.DecimalNullableFilter = {}
    if (minPriceRaw) priceFilter.gte = minPriceRaw
    if (maxPriceRaw) priceFilter.lte = maxPriceRaw
    where.listedPriceAtomic = priceFilter
  }

  if (creator) {
    conditions.push({
      OR: [
        { creatorAddress: { contains: creator, mode: 'insensitive' } },
        {
          creatorMember: {
            OR: [
              { displayName: { contains: creator, mode: 'insensitive' } },
              { handle: { contains: creator, mode: 'insensitive' } },
            ],
          },
        },
      ],
    })
  }

  if (conditions.length > 0) {
    where.AND = conditions
  }

  return where
}
