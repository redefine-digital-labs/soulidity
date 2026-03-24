import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@web/lib/is-uuid'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { normalizeSuiWalletAddress } from '@web/lib/auth/challenge'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { dbSetAgentGrant, dbRevokeAgentGrant } from '@web/lib/souls/post-tx-db'
import { parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'
import {
  assertPassChange,
  getSuccessfulTransaction,
  getVerifiedPassState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'

/**
 * Find a pass by DB UUID or on-chain ID, verify owner.
 */
const SOUL_GRANT_MIRROR_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

async function findOwnedPass(passId: string, memberId: string) {
  return prisma.soulPassSnapshot.findFirst({
    where: {
      ...(isUuid(passId) ? { id: passId } : { onChainId: passId }),
      ownerMemberId: memberId,
      status: 'active',
      NOT: {
        passType: 'subscription',
        expiresAt: { lt: new Date() },
      },
    },
  })
}

/**
 * POST /api/souls/passes/[passId]/grant — Set agent grant after on-chain TX.
 * Body: { agentAddress, txDigest }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ passId: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) return error
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can manage agent grants' }, { status: 403 })
  }

  const rateLimit = takeRateLimitToken(
    `soul-pass-grant-mirror:${identity.memberId}`,
    SOUL_GRANT_MIRROR_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many grant sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body?.agentAddress || typeof body.agentAddress !== 'string') {
    return NextResponse.json({ error: 'agentAddress is required' }, { status: 400 })
  }
  const agentAddress = normalizeSuiWalletAddress(body.agentAddress)
  if (!agentAddress) {
    return NextResponse.json({ error: 'agentAddress must be a valid Sui address' }, { status: 400 })
  }
  const txDigest = parseRequiredTxDigest(body.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const { passId } = await params
  const pass = await findOwnedPass(passId, identity.memberId)
  if (!pass) {
    return NextResponse.json({ error: 'Not found or not owner' }, { status: 404 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'grant:set',
    actorKey: identity.memberId,
    resourceKey: pass.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Soul package config is missing' },
      { status: 503 },
    )
  }

  const ownerAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  if (!ownerAddress) {
    return NextResponse.json({ error: 'No Sui wallet bound to account' }, { status: 400 })
  }

  try {
    const transaction = await getSuccessfulTransaction(txDigest)
    assertPassChange(transaction, {
      passOnChainId: pass.onChainId,
      changeTypes: ['mutated'],
      errorMessage: 'Transaction did not mutate the submitted pass',
      expectedSender: ownerAddress,
      expectedPackageId: soulPackageId,
    })

    const passState = await getVerifiedPassState(pass.onChainId, soulPackageId)
    if (!sameSuiValue(passState.ownerAddress, ownerAddress)) {
      return NextResponse.json({ error: 'Pass owner does not match the authenticated wallet' }, { status: 422 })
    }
    if (!sameSuiValue(passState.agentGrant, agentAddress)) {
      return NextResponse.json({ error: 'On-chain pass grant does not match the requested agent' }, { status: 422 })
    }

    const verifiedAgentGrant = passState.agentGrant
    if (!verifiedAgentGrant) {
      return NextResponse.json({ error: 'On-chain pass grant does not match the requested agent' }, { status: 422 })
    }

    const responseBody = { ok: true, agentGrant: verifiedAgentGrant }
    await prisma.$transaction(async (tx) => {
      await dbSetAgentGrant({
        db: tx,
        passOnChainId: pass.onChainId,
        agentAddress: verifiedAgentGrant,
      })
      await storeSoulTxSync({
        db: tx,
        txDigest,
        routeKey: 'grant:set',
        actorKey: identity.memberId,
        resourceKey: pass.onChainId,
        statusCode: 200,
        body: responseBody,
      })
    }, { timeout: 30_000 })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }
    console.error('[soul-pass-grant-mirror] Sync failed', {
      memberId: identity.memberId,
      passId,
      txDigest,
      mode: 'set',
      error: toSafeErrorDetails(error),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/souls/passes/[passId]/grant — Revoke agent grant after on-chain TX.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ passId: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) return error
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can manage agent grants' }, { status: 403 })
  }

  const rateLimit = takeRateLimitToken(
    `soul-pass-grant-mirror:${identity.memberId}`,
    SOUL_GRANT_MIRROR_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many grant sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { passId } = await params
  const pass = await findOwnedPass(passId, identity.memberId)
  if (!pass) {
    return NextResponse.json({ error: 'Not found or not owner' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'grant:revoke',
    actorKey: identity.memberId,
    resourceKey: pass.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Soul package config is missing' },
      { status: 503 },
    )
  }

  const ownerAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  if (!ownerAddress) {
    return NextResponse.json({ error: 'No Sui wallet bound to account' }, { status: 400 })
  }

  try {
    const transaction = await getSuccessfulTransaction(txDigest)
    assertPassChange(transaction, {
      passOnChainId: pass.onChainId,
      changeTypes: ['mutated'],
      errorMessage: 'Transaction did not mutate the submitted pass',
      expectedSender: ownerAddress,
      expectedPackageId: soulPackageId,
    })

    const passState = await getVerifiedPassState(pass.onChainId, soulPackageId)
    if (!sameSuiValue(passState.ownerAddress, ownerAddress)) {
      return NextResponse.json({ error: 'Pass owner does not match the authenticated wallet' }, { status: 422 })
    }
    if (passState.agentGrant !== null) {
      return NextResponse.json({ error: 'On-chain pass grant is still set' }, { status: 422 })
    }

    const responseBody = { ok: true }
    await prisma.$transaction(async (tx) => {
      await dbRevokeAgentGrant({
        db: tx,
        passOnChainId: pass.onChainId,
      })
      await storeSoulTxSync({
        db: tx,
        txDigest,
        routeKey: 'grant:revoke',
        actorKey: identity.memberId,
        resourceKey: pass.onChainId,
        statusCode: 200,
        body: responseBody,
      })
    }, { timeout: 30_000 })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }
    console.error('[soul-pass-grant-mirror] Sync failed', {
      memberId: identity.memberId,
      passId,
      txDigest,
      mode: 'revoke',
      error: toSafeErrorDetails(error),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
