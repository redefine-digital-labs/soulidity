import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAdmin } from '@web/lib/auth/admin'

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const take = 100
  const members = await prisma.member.findMany({
    orderBy: { joinedAt: 'desc' },
    select: { id: true, tgId: true, tgName: true, level: true, joinedAt: true },
    take,
  })
  return NextResponse.json(members)
}
