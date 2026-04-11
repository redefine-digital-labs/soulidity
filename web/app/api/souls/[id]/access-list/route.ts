import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { buildSoulRouteWhere } from '@web/lib/soulidity/repository'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const where = buildSoulRouteWhere(id)
  if (!where) return NextResponse.json({ error: 'Invalid soul ID' }, { status: 400 })

  const soul = await prisma.soulAsset.findFirst({ where, select: { onChainId: true } })
  if (!soul) return NextResponse.json({ error: 'Soul not found' }, { status: 404 })

  const records = await prisma.contentAccessRecord.findMany({
    where: { soulOnChainId: soul.onChainId, revokedAt: null },
    orderBy: { grantedAtMs: 'desc' },
  })

  const serialized = records.map((r) => ({
    ...r,
    pricePaidAtomic: r.pricePaidAtomic.toString(),
    grantedAtMs: r.grantedAtMs.toString(),
    expiresAtMs: r.expiresAtMs?.toString() ?? null,
  }))

  return NextResponse.json({ accessList: serialized })
}
