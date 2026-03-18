import { NextRequest, NextResponse } from 'next/server'

import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { prisma } from '@web/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const auth = await requireAgentApiKey(request)
  if (auth.response) {
    return auth.response
  }
  const { agent } = auth

  const { listingId } = await params
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      status: 'active',
      bundle: { status: 'active' },
    },
    include: {
      bundle: {
        select: {
          id: true,
          name: true,
          description: true,
          readme: true,
          category: true,
          tags: true,
          previewImages: true,
          version: true,
          contentHash: true,
          seller: {
            select: {
              id: true,
              displayName: true,
              tgName: true,
              level: true,
            },
          },
        },
      },
      _count: {
        select: {
          orders: true,
        },
      },
    },
  })

  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  }

  return NextResponse.json({
    actor: {
      accountId: agent.accountId,
      agentMemberId: agent.agentMemberId,
    },
    listing: {
      ...listing,
      priceMist: listing.priceMist.toString(),
      priceUsdCents: listing.priceUsdCents,
    },
  })
}
