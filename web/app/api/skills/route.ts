import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const skills = await prisma.skill.findMany({
    orderBy: { downloads: 'desc' },
  })

  return NextResponse.json(skills)
}
