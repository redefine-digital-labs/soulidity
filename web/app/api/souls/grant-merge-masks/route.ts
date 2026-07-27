/**
 * Batch helper for "scope-merging" grant issue paths. Any owner-side
 * Authorize action that wants to ADD a scope to an existing grantee
 * (sprite-upload auto-grant, banner Authorize, PetGrantDialog batch,
 * the Grants tab `+ Authorize` form) calls this endpoint first to find
 * out what `scope_mask` the on-chain `grant::issue` should carry so the
 * supersede strictly EXPANDS the grantee's previously-granted scopes
 * instead of narrowing them (the chain replaces the slot wholesale —
 * see `move/soulidity/sources/grant.move::issue`).
 *
 * Inputs are per-(Soul, grantee) tuples with the scope the caller
 * intends to add. The response gives, per item, the existing mask, the
 * merged mask (`existing | added`), whether issuing consumes a new
 * grant slot, and the capacity the Soul must be raised to first.
 */
import { NextResponse } from 'next/server'
import {
  ALL_SOUL_GRANT_SCOPE_MASK,
  getActiveGrantSlotForGrantee,
  getRequiredSoulidityEnv,
  getSoulStateObject,
  parseRequiredAddress,
} from '@soulidity/sdk'
import type { SoulStateObject } from '@soulidity/sdk'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { getActiveGrantScopeByGrantee } from '@/lib/soulidity/auto-grant'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = {
  max: 60,
  windowMs: 5 * 60 * 1000,
} as const

const MAX_ITEMS = 100

interface InputItem {
  soulOnChainId: string
  granteeAddress: string
  addedScopeMask: number
}

function parseAddedScopeMask(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value <= 0) return null
  if ((value & ALL_SOUL_GRANT_SCOPE_MASK) !== value) return null
  return value
}

export async function POST(request: Request) {
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(
    `grant-merge-masks:${auth.identity.memberId}`,
    RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many grant-merge-mask requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as { items?: unknown } | null
  const rawItems = body?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
  }
  if (rawItems.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `items length must be ≤ ${MAX_ITEMS}` },
      { status: 400 },
    )
  }

  const parsed: InputItem[] = []
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: `items[${i}] must be an object` }, { status: 400 })
    }
    const soulOnChainId = parseRequiredAddress(raw.soulOnChainId)
    if (!soulOnChainId) {
      return NextResponse.json(
        { error: `items[${i}].soulOnChainId must be a valid Sui object id` },
        { status: 400 },
      )
    }
    const granteeAddress = parseRequiredAddress(raw.granteeAddress)
    if (!granteeAddress) {
      return NextResponse.json(
        { error: `items[${i}].granteeAddress must be a valid Sui address` },
        { status: 400 },
      )
    }
    const addedScopeMask = parseAddedScopeMask(raw.addedScopeMask)
    if (addedScopeMask == null) {
      return NextResponse.json(
        {
          error: `items[${i}].addedScopeMask must be a non-zero subset of SOUL_GRANT_SCOPE bits (mask ≤ ${ALL_SOUL_GRANT_SCOPE_MASK})`,
        },
        { status: 400 },
      )
    }
    parsed.push({ soulOnChainId, granteeAddress, addedScopeMask })
  }

  // Load every targeted Soul once, owner-check up front. `stateOnChainId`
  // is required for the on-chain fallback below (a missing mirror row must
  // not be treated as "no grant on chain" because grants can land before
  // `/content/sync` mirrors them — see R-001).
  const uniqueSoulIds = Array.from(new Set(parsed.map((p) => p.soulOnChainId)))
  const souls = await prisma.soulAsset.findMany({
    where: { onChainId: { in: uniqueSoulIds } },
    select: {
      onChainId: true,
      stateOnChainId: true,
      currentOwnerMemberId: true,
      grantCapacity: true,
      activeGrantCount: true,
    },
  })
  const soulByOnChainId = new Map(souls.map((s) => [s.onChainId, s]))

  for (const id of uniqueSoulIds) {
    const soul = soulByOnChainId.get(id)
    if (!soul) {
      return NextResponse.json({ error: `Soul ${id} not found`, soulOnChainId: id }, { status: 404 })
    }
    if (soul.currentOwnerMemberId !== auth.identity.memberId) {
      return NextResponse.json(
        { error: `Caller is not the owner of Soul ${id}`, soulOnChainId: id },
        { status: 403 },
      )
    }
  }

  // Batch existing-mask lookup per Soul. Each lookup is a single
  // `prisma.soulGrantRecord.findMany`, fired in parallel across souls.
  const granteesBySoul = new Map<string, Set<string>>()
  for (const item of parsed) {
    const set = granteesBySoul.get(item.soulOnChainId) ?? new Set<string>()
    set.add(item.granteeAddress)
    granteesBySoul.set(item.soulOnChainId, set)
  }

  const scopeMapsBySoul = new Map<string, Map<string, number>>()
  await Promise.all(
    Array.from(granteesBySoul.entries()).map(async ([soulOnChainId, grantees]) => {
      const map = await getActiveGrantScopeByGrantee({
        soulOnChainId,
        granteeAddresses: Array.from(grantees),
      })
      scopeMapsBySoul.set(soulOnChainId, map)
    }),
  )

  // R-001: mirror-miss chain verification. `SoulGrantRecord` is a post-TX
  // mirror; a grant whose `/content/sync` write has not yet committed (or
  // failed transiently, or was issued outside this UI) is on chain but
  // absent here. Treating that as `existingScopeMask = 0` and re-issuing
  // with the bare `addedScopeMask` makes `grant::issue` replace the slot
  // wholesale with the narrower mask, silently dropping every prior scope.
  // For each (Soul, grantee) where the mirror is empty, read the on-chain
  // active grant slot directly and use its `scopeMask` as the existing
  // mask. Fail closed on any RPC error so we never return a single-bit
  // mask that could narrow chain state.
  const chainScopeMaskByItem = new Map<string, number>()
  const itemsNeedingChainCheck = parsed.filter((item) => {
    const mirrorMask = scopeMapsBySoul.get(item.soulOnChainId)?.get(item.granteeAddress) ?? 0
    return mirrorMask === 0
  })
  if (itemsNeedingChainCheck.length > 0) {
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    const soulsToVerify = Array.from(new Set(itemsNeedingChainCheck.map((i) => i.soulOnChainId)))
    try {
      const stateBySoul = new Map<string, SoulStateObject>()
      await Promise.all(
        soulsToVerify.map(async (soulOnChainId) => {
          const soul = soulByOnChainId.get(soulOnChainId)!
          // includeActiveGrants=false: per-grantee dynamic-field lookup
          // below is cheaper than materializing every active slot when
          // the Soul's `active_grants` table has many entries.
          const state = await getSoulStateObject(soul.stateOnChainId, packageId, {
            includeActiveGrants: false,
          })
          stateBySoul.set(soulOnChainId, state)
        }),
      )
      await Promise.all(
        itemsNeedingChainCheck.map(async (item) => {
          const state = stateBySoul.get(item.soulOnChainId)!
          const slot = await getActiveGrantSlotForGrantee(state, item.granteeAddress)
          if (slot && slot.scopeMask > 0) {
            chainScopeMaskByItem.set(
              `${item.soulOnChainId}|${item.granteeAddress}`,
              slot.scopeMask,
            )
          }
        }),
      )
    } catch (error) {
      console.error('[grant-merge-masks] On-chain grant verification failed', error)
      return NextResponse.json(
        { error: 'Failed to verify on-chain grant state — retry shortly' },
        { status: 502 },
      )
    }
  }

  const responseItems = parsed.map((item) => {
    const soul = soulByOnChainId.get(item.soulOnChainId)!
    const mirrorMask = scopeMapsBySoul.get(item.soulOnChainId)?.get(item.granteeAddress) ?? 0
    // Mirror is authoritative when present (post-TX writes are atomic with
    // the on-chain TX commit). When the mirror has no row, fall back to
    // the chain slot's mask if the on-chain verification above found one.
    const chainMask = chainScopeMaskByItem.get(`${item.soulOnChainId}|${item.granteeAddress}`) ?? 0
    const existingScopeMask = mirrorMask !== 0 ? mirrorMask : chainMask
    const mergedScopeMask = existingScopeMask | item.addedScopeMask
    const isNewGrantee = existingScopeMask === 0
    // `grant::issue` removes an existing grantee's slot before pushing
    // the new one — so existing grantees do NOT add to required capacity.
    const requiredCapacity = Math.max(
      soul.grantCapacity,
      soul.activeGrantCount + (isNewGrantee ? 1 : 0),
    )
    return {
      soulOnChainId: item.soulOnChainId,
      granteeAddress: item.granteeAddress,
      addedScopeMask: item.addedScopeMask,
      existingScopeMask,
      mergedScopeMask,
      isNewGrantee,
      currentCapacity: soul.grantCapacity,
      activeGrantCount: soul.activeGrantCount,
      requiredCapacity,
    }
  })

  return NextResponse.json({ items: responseItems })
}
