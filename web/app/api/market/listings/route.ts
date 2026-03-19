import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const category = searchParams.get('category')
  const search = searchParams.get('search')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(60, parseInt(searchParams.get('limit') || '20'))
  const offset = (page - 1) * limit

  const where: any = {
    status: 'active',
    bundle: { status: 'active' },
  }
  if (category) {
    where.bundle = { ...where.bundle, category }
  }
  if (search) {
    where.bundle = {
      ...where.bundle,
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
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
            previewImages: true,
            version: true,
            seller: { select: { id: true, tgName: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.listing.count({ where }),
  ])

  const serialized = listings.map(l => ({
    ...l,
    priceMist: l.priceMist.toString(),
    priceUsdCents: l.priceUsdCents,
    currency: l.currency,
  }))

  return NextResponse.json({ listings: serialized, total, page, limit })
}
