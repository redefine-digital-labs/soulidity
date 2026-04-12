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

  const versions = await prisma.soulAssetVersionRecord.findMany({
    where: { soulOnChainId: soul.onChainId, deletedAt: null },
    orderBy: [{ assetName: 'asc' }, { versionIndex: 'desc' }],
  })

  return NextResponse.json({
    assets: versions.map((v) => ({ ...v, createdAtMs: Number(v.createdAtMs) })),
  })
}
