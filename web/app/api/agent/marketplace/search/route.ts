import { NextRequest, NextResponse } from 'next/server'

import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { prisma } from '@web/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await requireAgentApiKey(request)
  if (auth.response) {
    return auth.response
  }
  const { agent } = auth

  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')
  const category = searchParams.get('category')
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '10')))
  const offset = (page - 1) * limit

  const where: Record<string, unknown> = {
    status: 'active',
    bundle: { status: 'active' },
  }

  if (category) {
    where.bundle = { ...(where.bundle as object), category }
  }

  if (query) {
    where.bundle = {
      ...(where.bundle as object),
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    }
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        bundle: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            tags: true,
            version: true,
          },
        },
        _count: {
          select: {
            orders: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.listing.count({ where }),
  ])

  return NextResponse.json({
    listings: listings.map((listing) => ({
      id: listing.id,
      bundleId: listing.bundleId,
      name: listing.bundle.name,
      description: listing.bundle.description,
      category: listing.bundle.category,
      tags: listing.bundle.tags,
      version: listing.bundle.version,
      salesCount: listing._count.orders,
      priceMist: listing.priceMist.toString(),
      priceUsdCents: listing.priceUsdCents,
      currency: listing.currency,
    })),
    total,
    page,
    limit,
    actor: {
      accountId: agent.accountId,
      agentMemberId: agent.agentMemberId,
    },
  })
}
