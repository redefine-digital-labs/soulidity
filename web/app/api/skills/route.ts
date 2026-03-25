import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const skills = await cached('skills:all', 300_000, async () => {
    return prisma.skill.findMany({
      orderBy: { downloads: 'desc' },
    })
  })

  return NextResponse.json(skills)
}
