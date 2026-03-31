import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET() {
  const categories = await prisma.soulAsset.findMany({
    where: { listingStatus: 'listed' },
    select: { category: true },
    distinct: ['category'],
  })

  return NextResponse.json(
    categories
      .map((c) => c.category)
      .filter(Boolean)
      .sort(),
  )
}
