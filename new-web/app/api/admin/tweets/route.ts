import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const status = request.nextUrl.searchParams.get('status') ?? 'pending_review'

  const items = await prisma.rawItem.findMany({
    where: { sourceType: 'x', status },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(items)
}
