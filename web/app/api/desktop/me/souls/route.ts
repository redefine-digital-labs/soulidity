import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { listDesktopCatalogItemsBySourceRefs } from '@/lib/desktop/repository'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  // Resolve the authenticated account's member to filter by ownership
  const member = await prisma.member.findFirst({
    where: { accountId: auth.accountId!, kind: 'human' },
    select: { id: true },
  })

  if (!member) {
    return NextResponse.json({ souls: [] })
  }

  // Get on-chain IDs of souls owned by this member
  const ownedSouls = await prisma.soulAsset.findMany({
    where: { currentOwnerMemberId: member.id },
    select: { onChainId: true },
  })

  if (ownedSouls.length === 0) {
    return NextResponse.json({ souls: [] })
  }

  const ownedOnChainIds = ownedSouls.map((s) => s.onChainId)

  // Query catalog entries directly by owned on-chain IDs to avoid pagination truncation
  const ownedItems = await listDesktopCatalogItemsBySourceRefs({
    sourceType: 'soul',
    sourceRefs: ownedOnChainIds,
  })

  return NextResponse.json({ souls: ownedItems })
}
