import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await prisma.post.findMany({
    where: { status: 'published', tags: { not: null } },
    select: { tags: true },
    distinct: ['tags'],
  })

  const tags = Array.from(
    new Set(
      rows.flatMap(r => (r.tags ? r.tags.split(',').map(t => t.trim()) : []))
        .filter(Boolean)
    )
  )

  return NextResponse.json(tags)
}
