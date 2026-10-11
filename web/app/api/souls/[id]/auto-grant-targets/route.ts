import { NextResponse } from 'next/server'
import {
  ALL_SOUL_GRANT_SCOPE_MASK,
  SOUL_GRANT_SCOPE_BITS,
} from '@soulidity/sdk'
import { computeAutoGrantTargets } from '@/lib/soulidity/auto-grant'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

function parseSingleBitScopeMask(value: string | null): number | null {
  if (!value) return null
  const num = Number.parseInt(value, 10)
  if (!Number.isInteger(num) || num <= 0) return null
  if ((num & ALL_SOUL_GRANT_SCOPE_MASK) !== num) return null
  if (!SOUL_GRANT_SCOPE_BITS.some((bit) => bit.mask === num)) return null
  return num
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const url = new URL(request.url)
  const scopeMask = parseSingleBitScopeMask(url.searchParams.get('scopeMask'))
  if (scopeMask == null) {
    return NextResponse.json(
      { error: 'scopeMask must be a single SOUL_GRANT_SCOPE_* bit' },
      { status: 400 },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (soul.currentOwnerMemberId !== auth.identity.memberId) {
    return NextResponse.json(
      { error: 'Only the Soul owner can pre-flight auto-grants' },
      { status: 403 },
    )
  }

  let plan
  try {
    plan = await computeAutoGrantTargets({
      accountId: auth.identity.accountId,
      soulOnChainId: soul.onChainId,
      stateOnChainId: soul.stateOnChainId,
      scopeMask,
      currentCapacity: soul.grantCapacity,
      activeGrantCount: soul.activeGrantCount,
    })
  } catch (error) {
    // `computeAutoGrantTargets` fails closed when the on-chain
    // mirror-miss fallback cannot read `SoulState.active_grants` —
    // returning a single-bit `desiredScopeMask` on RPC failure would let
    // the caller narrow chain-only grants on supersede.
    console.error('[auto-grant-targets] plan failed', error)
    return NextResponse.json(
      { error: 'Failed to verify on-chain grant state — retry shortly' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    soulOnChainId: soul.onChainId,
    stateOnChainId: soul.stateOnChainId,
    scopeMask,
    targets: plan.targets.map((t) => ({
      memberId: t.memberId,
      address: t.address,
      displayName: t.displayName,
      desiredScopeMask: t.desiredScopeMask,
      isNewGrantee: t.isNewGrantee,
    })),
    currentCapacity: plan.currentCapacity,
    activeGrantCount: plan.activeGrantCount,
    requiredCapacity: plan.requiredCapacity,
  })
}
