import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { listDesktopCatalogItemsBySourceRefs } from '@/lib/desktop/repository'
import { findActiveAssetGrantsForPetOnChain } from '@/lib/desktop/revoke'
import { prisma } from '@/lib/prisma'
import type { DesktopAgentSpriteGrant, DesktopMySoulsItem } from '@/lib/types/desktop'

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
    orderBy: { createdAt: 'desc' },
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

  // When the request was authenticated via the desktop bearer token, look
  // up active asset-scope grants targeting this pet's agent address so the
  // renderer can decide whether to enable each protected Download button
  // without round-tripping the manifest. Browser cookie callers don't get
  // the marker; their UI handles owner downloads through the bound human
  // wallet path.
  //
  // Authoritative chain fallback: when the local `SoulGrantRecord` mirror
  // returns zero matching rows we re-check the chain via
  // `findActiveAssetGrantsForPetOnChain` — the same helper the
  // unlink/revoke surfaces use. Without this, a wallet-signed
  // `grant::issue_to_grantee` whose mirror POST raced/failed would leave
  // the on-chain grant live but the desktop Library would still surface
  // "Authorize on web" and disable the Download button before the
  // manifest route gets a chance to run its own on-chain authorization
  // check (`resolveContentAccessPayload`). The chain fallback runs only
  // when the mirror is fully empty for this pet (matching the
  // `grantable-souls` precedent) so the fast path stays a single DB
  // query for the common case.
  let agentGrantBySoul: Map<string, DesktopAgentSpriteGrant> | null = null
  if (auth.desktopPet) {
    const now = new Date()
    const grantRows = await prisma.soulGrantRecord.findMany({
      where: {
        granteeAddress: auth.desktopPet.agentAddress,
        soulOnChainId: { in: ownedOnChainIds },
        status: 'active',
        scopes: { has: 'assets' },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: {
        onChainId: true,
        soulOnChainId: true,
        expiresAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    agentGrantBySoul = new Map()
    for (const row of grantRows) {
      if (agentGrantBySoul.has(row.soulOnChainId)) continue
      agentGrantBySoul.set(row.soulOnChainId, {
        active: true,
        grantOnChainId: row.onChainId,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      })
    }

    if (agentGrantBySoul.size === 0) {
      const chainResult = await findActiveAssetGrantsForPetOnChain({
        agentAddress: auth.desktopPet.agentAddress,
        ownerMemberId: member.id,
        now,
      })
      for (const grant of chainResult.grants) {
        if (agentGrantBySoul.has(grant.soulOnChainId)) continue
        agentGrantBySoul.set(grant.soulOnChainId, {
          active: true,
          grantOnChainId: grant.grantOnChainId,
          expiresAt: grant.expiresAt,
        })
      }
    }
  }

  const souls: DesktopMySoulsItem[] = ownedItems.map((item) => ({
    ...item,
    agentSpriteGrant: agentGrantBySoul?.get(item.sourceRef) ?? null,
  }))

  return NextResponse.json({ souls })
}
