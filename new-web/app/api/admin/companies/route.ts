import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const category = request.nextUrl.searchParams.get('category')
  const parsed = parseInt(request.nextUrl.searchParams.get('limit') ?? '100')
  const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 100, 1), MAX_LIMIT)

  const companies = await prisma.company.findMany({
    where: category ? { category } : undefined,
    orderBy: { mentionCount: 'desc' },
    take: limit,
  })
  return NextResponse.json(companies)
}
