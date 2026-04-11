import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: soulOnChainId } = await params

  const versions = await prisma.soulAssetVersionRecord.findMany({
    where: { soulOnChainId, deletedAt: null },
    orderBy: [{ assetName: 'asc' }, { versionIndex: 'desc' }],
  })

  return NextResponse.json({ assets: versions })
}
