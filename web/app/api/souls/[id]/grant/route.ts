import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  getVerifiedSoulAccessCapState,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { dbRevokeSoulAgentGrant, dbSetSoulAgentGrant } from '@web/lib/souls/post-tx-db'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'

const SOUL_GRANT_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

async function requireOwnedSoulForGrant(routeId: string, memberId: string) {
  const soul = await findSoulAssetDetailByRouteId(routeId)
  if (!soul) {
    return { soul: null, error: NextResponse.json({ error: 'Soul not found' }, { status: 404 }) }
  }
  if (soul.currentOwnerMemberId !== memberId || soul.listingStatus !== 'held') {
    return { soul: null, error: NextResponse.json({ error: 'Only the current owner can manage agent access' }, { status: 403 }) }
  }
  return { soul, error: null }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const rateLimit = await takeRateLimitToken(`soul-grant:${identity.memberId}`, SOUL_GRANT_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many grant sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const owned = await requireOwnedSoulForGrant(id, identity.memberId)
  if (owned.error) {
    return owned.error
  }
  const soul = owned.soul

  const body = await request.json().catch(() => null)
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  const agentAddress = parseRequiredObjectId(body?.agentAddress)
  const soulAccessCapOnChainId = parseRequiredObjectId(body?.soulAccessCapOnChainId)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'agentAddress must be a valid Sui address' }, { status: 400 })
  }
  if (!soulAccessCapOnChainId) {
    return NextResponse.json({ error: 'soulAccessCapOnChainId must be a valid object id' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'grant:set',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  try {
    const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (walletAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before granting access' }, { status: 403 })
    }

    await getSuccessfulTransactionBlock(txDigest)

    const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId)
    if (!soulState.ownerAddress || !walletAddresses.some((address) => sameSuiValue(address, soulState.ownerAddress))) {
      return NextResponse.json({ error: 'On-chain Soul owner does not match the authenticated wallet' }, { status: 422 })
    }
    if (!sameSuiValue(soulState.agentGrant, agentAddress)) {
      return NextResponse.json({ error: 'On-chain Soul grant does not match the requested agent' }, { status: 422 })
    }

    const accessCapState = await getVerifiedSoulAccessCapState(soulAccessCapOnChainId, soulPackageId)
    if (!sameSuiValue(accessCapState.ownerAddress, agentAddress)) {
      return NextResponse.json({ error: 'Soul access cap owner does not match the requested agent' }, { status: 422 })
    }
    if (!sameSuiValue(accessCapState.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Soul access cap does not belong to this Soul' }, { status: 422 })
    }
    if (accessCapState.grantVersion !== soulState.grantVersion) {
      return NextResponse.json({ error: 'Soul access cap version does not match the on-chain Soul grant version' }, { status: 422 })
    }

    await dbSetSoulAgentGrant({
      soulOnChainId: soul.onChainId,
      agentGrantAddress: agentAddress,
      agentAccessCapOnChainId: soulAccessCapOnChainId,
      grantVersion: soulState.grantVersion,
    })

    const responseBody = {
      soulOnChainId: soul.onChainId,
      agentGrantAddress: agentAddress,
      soulAccessCapOnChainId,
      grantVersion: soulState.grantVersion.toString(),
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'grant:set',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (grantError) {
    if (grantError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(grantError) },
        { status: grantError.status },
      )
    }

    console.error('[soul-grant-mirror] Grant sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(grantError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul grant' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const { id } = await params
  const owned = await requireOwnedSoulForGrant(id, identity.memberId)
  if (owned.error) {
    return owned.error
  }
  const soul = owned.soul

  const body = await request.json().catch(() => null)
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'grant:revoke',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  try {
    const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (walletAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before revoking access' }, { status: 403 })
    }

    await getSuccessfulTransactionBlock(txDigest)

    const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId)
    if (!soulState.ownerAddress || !walletAddresses.some((address) => sameSuiValue(address, soulState.ownerAddress))) {
      return NextResponse.json({ error: 'On-chain Soul owner does not match the authenticated wallet' }, { status: 422 })
    }
    if (soulState.agentGrant !== null) {
      return NextResponse.json({ error: 'On-chain Soul grant is still set' }, { status: 422 })
    }

    await dbRevokeSoulAgentGrant({
      soulOnChainId: soul.onChainId,
      grantVersion: soulState.grantVersion,
    })

    const responseBody = {
      soulOnChainId: soul.onChainId,
      agentGrantAddress: null,
      soulAccessCapOnChainId: null,
      grantVersion: soulState.grantVersion.toString(),
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'grant:revoke',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (revokeError) {
    if (revokeError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(revokeError) },
        { status: revokeError.status },
      )
    }

    console.error('[soul-grant-mirror] Revoke sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(revokeError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul grant revoke' }, { status: 500 })
  }
}
