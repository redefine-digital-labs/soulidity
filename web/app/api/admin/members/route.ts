import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

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
