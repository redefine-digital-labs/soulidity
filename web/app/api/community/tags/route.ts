import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tags = await cached('community:tags', 300_000, async () => {
    const rows = await prisma.post.findMany({
      where: { status: 'published', tags: { not: null } },
      select: { tags: true },
      distinct: ['tags'],
    })

    return Array.from(
      new Set(
        rows.flatMap(r => (r.tags ? r.tags.split(',').map(t => t.trim()) : []))
          .filter(Boolean)
      )
    )
  })

  return NextResponse.json(tags)
}
