import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: soulOnChainId } = await params

  const records = await prisma.contentAccessRecord.findMany({
    where: { soulOnChainId, revokedAt: null },
    orderBy: { grantedAtMs: 'desc' },
  })

  return NextResponse.json({ accessList: records })
}
