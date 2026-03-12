import { NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entitlements = await prisma.entitlement.findMany({
    where: { memberId: session.memberId, status: 'active' },
    include: {
      bundle: { select: { id: true, name: true, category: true, version: true } },
      order: { select: { priceMist: true, txDigest: true, createdAt: true } },
    },
    orderBy: { grantedAt: 'desc' },
  })

  return NextResponse.json({ entitlements })
}
