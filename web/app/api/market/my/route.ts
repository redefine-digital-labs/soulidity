import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const entitlements = await prisma.entitlement.findMany({
    where: { memberId: identity.memberId, status: 'active' },
    include: {
      bundle: { select: { id: true, name: true, category: true, version: true } },
      order: {
        select: {
          priceMist: true,
          currency: true,
          txDigest: true,
          createdAt: true,
          purchaseIntent: {
            select: {
              expectedAmount: true,
            },
          },
        },
      },
    },
    orderBy: { grantedAt: 'desc' },
  })

  const serialized = entitlements.map(e => ({
    ...e,
    order: e.order
      ? {
          priceMist: e.order.priceMist.toString(),
          paidAmount: (e.order.purchaseIntent?.expectedAmount ?? e.order.priceMist).toString(),
          currency: e.order.currency,
          txDigest: e.order.txDigest,
          createdAt: e.order.createdAt,
        }
      : e.order,
  }))

  return NextResponse.json({ entitlements: serialized })
}
