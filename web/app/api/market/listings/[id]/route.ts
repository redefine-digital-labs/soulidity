import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const listing = await prisma.listing.findFirst({
    where: { id, status: 'active', bundle: { status: 'active' } },
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
          seller: { select: { id: true, tgName: true, avatar: true, level: true } },
        },
      },
      _count: { select: { orders: true } },
    },
  })

  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ listing })
}
