import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  extractSoulAllowlistClearedEvent,
  extractSoulAllowlistSetEvent,
  getTrustedPackageIds,
  getVerifiedPersonalKioskCapState,
  getVerifiedSoulAllowlistCapState,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import {
  dbClearSoulAllowlist,
  dbSetSoulAllowlist,
  SoulMirrorOwnershipConflictError,
} from '@web/lib/souls/post-tx-db'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { parseRequiredAddress, parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { readTransactionSender } from '@web/lib/souls/transaction-metadata'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'

export const dynamic = 'force-dynamic'

const SOUL_ALLOWLIST_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const
const RETRYABLE_ALLOWLIST_SYNC_RETRY_AFTER_SECONDS = '5'

function retryableAllowlistSyncResponse() {
  return NextResponse.json(
    { error: 'Soul ownership is still syncing on chain, retry shortly' },
    { status: 503, headers: { 'Retry-After': RETRYABLE_ALLOWLIST_SYNC_RETRY_AFTER_SECONDS } },
  )
}

function readCurrentKioskCapOnChainId(currentKioskCapOnChainId: string | null | undefined) {
  return typeof currentKioskCapOnChainId === 'string' && currentKioskCapOnChainId.trim().length > 0
    ? currentKioskCapOnChainId
    : null
}

function getStoredAllowlistSetSyncConflict(
  storedSync: { statusCode: number, body: unknown },
  requestedAllowlistAddress: string,
  requestedAllowlistCapOnChainId: string,
) {
  if (storedSync.statusCode !== 200 || !storedSync.body || typeof storedSync.body !== 'object') {
    return null
  }

  const body = storedSync.body as {
    allowlistAddress?: unknown
    soulAllowlistCapOnChainId?: unknown
  }
  if (
    typeof body.allowlistAddress === 'string'
    && !sameSuiValue(body.allowlistAddress, requestedAllowlistAddress)
  ) {
    return 'Stored allowlist sync does not match the requested address'
  }
  if (
    typeof body.soulAllowlistCapOnChainId === 'string'
    && !sameSuiValue(body.soulAllowlistCapOnChainId, requestedAllowlistCapOnChainId)
  ) {
    return 'Stored allowlist sync does not match the requested cap id'
  }

  return null
}

async function requireOwnedSoulForAllowlist(routeId: string, memberId: string) {
  const soul = await findSoulAssetDetailByRouteId(routeId)
  if (!soul) {
    return { soul: null, error: NextResponse.json({ error: 'Soul not found' }, { status: 404 }), requiresWalletFallback: false }
  }
  if (soul.listingStatus !== 'held') {
    return {
      soul: null,
      error: NextResponse.json({ error: 'Only the current owner can manage the allowlist' }, { status: 403 }),
      requiresWalletFallback: false,
    }
  }
  if (soul.currentOwnerMemberId === memberId) {
    return { soul, error: null, requiresWalletFallback: false }
  }
  if (soul.currentOwnerMemberId !== null) {
    return {
      soul: null,
      error: NextResponse.json({ error: 'Only the current owner can manage the allowlist' }, { status: 403 }),
      requiresWalletFallback: false,
    }
  }
  // A missing member binding does not authorize anything by itself; it only allows the route
  // to continue into the on-chain kiosk-owner verification that remains the real access check.
  return { soul, error: null, requiresWalletFallback: true }
}

type SoulDetail = NonNullable<Awaited<ReturnType<typeof findSoulAssetDetailByRouteId>>>

async function verifyCallerOwnsKioskOnChain(params: {
  soul: SoulDetail
  soulPackageId: string
  walletAddresses: string[]
}): Promise<
  | { verified: true; soulState: Awaited<ReturnType<typeof getVerifiedSoulState>> }
  | { verified: false; response: NextResponse }
> {
  const currentKioskCapOnChainId = readCurrentKioskCapOnChainId(params.soul.currentKioskCapOnChainId)
  if (!currentKioskCapOnChainId) {
    return { verified: false, response: retryableAllowlistSyncResponse() }
  }

  const kioskCapStatePromise = getVerifiedPersonalKioskCapState(currentKioskCapOnChainId)
    .then((state) => ({ state, error: null as unknown }))
    .catch((error) => ({ state: null as Awaited<ReturnType<typeof getVerifiedPersonalKioskCapState>> | null, error }))

  let soulState: Awaited<ReturnType<typeof getVerifiedSoulState>>
  try {
    soulState = await getVerifiedSoulState(params.soul.onChainId, params.soulPackageId, {
      expectedKioskId: params.soul.currentKioskId,
    })
  } catch (verificationError) {
    if (verificationError instanceof OnChainVerificationError) {
      return { verified: false, response: retryableAllowlistSyncResponse() }
    }
    throw verificationError
  }

  if (soulState.ownerKind !== 'object') {
    return {
      verified: false,
      response: NextResponse.json(
        { error: 'On-chain Soul owner does not match the authenticated wallet' },
        { status: 422 },
      ),
    }
  }

  // Fast path: DB kiosk mirror matches on-chain
  const soulKioskId = soulState.kioskParentId ?? soulState.ownerObjectId
  if (!soulKioskId || !sameSuiValue(soulKioskId, params.soul.currentKioskId)) {
    return { verified: false, response: retryableAllowlistSyncResponse() }
  }

  const kioskCapStateResult = await kioskCapStatePromise
  if (kioskCapStateResult.error) {
    if (kioskCapStateResult.error instanceof OnChainVerificationError) {
      return { verified: false, response: retryableAllowlistSyncResponse() }
    }
    throw kioskCapStateResult.error
  }
  const kioskCapState = kioskCapStateResult.state
  if (!kioskCapState) {
    return { verified: false, response: retryableAllowlistSyncResponse() }
  }

  if (!sameSuiValue(kioskCapState.kioskId, params.soul.currentKioskId)) {
    return { verified: false, response: retryableAllowlistSyncResponse() }
  }

  if (params.walletAddresses.some((address) => sameSuiValue(address, kioskCapState.ownerAddress))) {
    return { verified: true, soulState }
  }

  return {
    verified: false,
    response: NextResponse.json(
      { error: 'On-chain Soul owner does not match the authenticated wallet' },
      { status: 422 },
    ),
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'This allowlist route only supports human sessions' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-allowlist:${identity.memberId}`, SOUL_ALLOWLIST_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many allowlist sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const owned = await requireOwnedSoulForAllowlist(id, identity.memberId)
  if (owned.error) {
    return owned.error
  }
  const soul = owned.soul

  const body = await request.json().catch(() => null)
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  const allowlistAddress = parseRequiredAddress(body?.allowlistAddress)
  const soulAllowlistCapOnChainId = parseRequiredObjectId(body?.soulAllowlistCapOnChainId)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (!allowlistAddress) {
    return NextResponse.json({ error: 'allowlistAddress must be a valid Sui address' }, { status: 400 })
  }
  if (!soulAllowlistCapOnChainId) {
    return NextResponse.json({ error: 'soulAllowlistCapOnChainId must be a valid object id' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'allowlist:set',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (storedSync) {
    const storedConflict = getStoredAllowlistSetSyncConflict(
      storedSync,
      allowlistAddress,
      soulAllowlistCapOnChainId,
    )
    if (storedConflict) {
      return NextResponse.json({ error: storedConflict }, { status: 409 })
    }
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
      return NextResponse.json({ error: 'Bind a Sui wallet before updating the allowlist' }, { status: 403 })
    }
    // When requiresWalletFallback is set, the DB mirror may be stale — skip the
    // mirrored-address fast-fail and let on-chain verification be the authority.
    if (
      owned.requiresWalletFallback
      && !soul.currentOwnerMemberId  // truly unbound (not stale-mismatch)
      && !walletAddresses.some((address) => sameSuiValue(address, soul.currentOwnerAddress))
    ) {
      return NextResponse.json({ error: 'Only the current owner can manage the allowlist' }, { status: 403 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const txSender = readTransactionSender(transaction)
    if (!txSender || !walletAddresses.some((address) => sameSuiValue(address, txSender))) {
      return NextResponse.json({ error: 'Transaction sender does not match the authenticated wallet' }, { status: 422 })
    }
    const ownershipResult = await verifyCallerOwnsKioskOnChain({ soul, soulPackageId, walletAddresses })
    if (!ownershipResult.verified) {
      return ownershipResult.response
    }
    const soulState = ownershipResult.soulState

    const allowlistSetEvent = extractSoulAllowlistSetEvent(
      transaction,
      soulPackageId,
      getTrustedPackageIds(soulPackageId, soulState.packageId),
    )
    if (!sameSuiValue(allowlistSetEvent.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction did not set the allowlist for this Soul' }, { status: 422 })
    }
    if (!sameSuiValue(allowlistSetEvent.allowlistedAddress, allowlistAddress)) {
      return NextResponse.json({ error: 'Transaction allowlist address does not match the requested address' }, { status: 422 })
    }
    const touchedSubmittedAllowlistCap = transaction.objectChanges?.some((change) => (
      (change?.type === 'created' || change?.type === 'mutated')
      && typeof change.objectId === 'string'
      && sameSuiValue(change.objectId, soulAllowlistCapOnChainId)
    )) ?? false
    if (!touchedSubmittedAllowlistCap) {
      return NextResponse.json({ error: 'Submitted soulAllowlistCapOnChainId was not created or updated by this transaction' }, { status: 422 })
    }

    if (!sameSuiValue(soulState.allowlistAddress, allowlistAddress)) {
      return NextResponse.json({ error: 'On-chain Soul allowlist does not match the requested address' }, { status: 422 })
    }

    const accessCapState = await getVerifiedSoulAllowlistCapState(soulAllowlistCapOnChainId, soulPackageId)
    if (!sameSuiValue(accessCapState.ownerAddress, allowlistAddress)) {
      return NextResponse.json({ error: 'Soul allowlist cap owner does not match the requested address' }, { status: 422 })
    }
    if (!sameSuiValue(accessCapState.allowlistedAddress, allowlistAddress)) {
      return NextResponse.json({ error: 'Soul allowlist cap allowlisted address does not match the requested address' }, { status: 422 })
    }
    if (!sameSuiValue(accessCapState.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Soul allowlist cap does not belong to this Soul' }, { status: 422 })
    }
    if (accessCapState.allowlistVersion !== soulState.allowlistVersion) {
      return NextResponse.json({ error: 'Soul allowlist cap version does not match the on-chain allowlist version' }, { status: 422 })
    }

    await dbSetSoulAllowlist({
      soulOnChainId: soul.onChainId,
      allowlistAddress,
      allowlistCapOnChainId: soulAllowlistCapOnChainId,
      allowlistVersion: soulState.allowlistVersion,
      expectedCurrentOwnerAddress: soul.currentOwnerAddress,
      expectedCurrentKioskId: soul.currentKioskId,
      expectedListingStatus: 'held',
    })

    const responseBody = {
      soulOnChainId: soul.onChainId,
      allowlistAddress,
      soulAllowlistCapOnChainId,
      allowlistVersion: soulState.allowlistVersion.toString(),
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'allowlist:set',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (allowlistError) {
    if (isMultipleSuiWalletBindingsError(allowlistError)) {
      return NextResponse.json({ error: allowlistError.message }, { status: 409 })
    }
    if (allowlistError instanceof SoulMirrorOwnershipConflictError) {
      return NextResponse.json(
        { error: 'Soul ownership changed before the allowlist mirror could be updated' },
        { status: 409 },
      )
    }
    if (allowlistError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(allowlistError) },
        { status: allowlistError.status },
      )
    }

    console.error('[soul-allowlist-mirror] Allowlist sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(allowlistError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul allowlist' }, { status: 500 })
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
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'This allowlist route only supports human sessions' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-allowlist:${identity.memberId}`, SOUL_ALLOWLIST_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many allowlist sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const owned = await requireOwnedSoulForAllowlist(id, identity.memberId)
  if (owned.error) {
    return owned.error
  }
  const soul = owned.soul

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'DELETE request body must include txDigest' }, { status: 400 })
  }
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'allowlist:clear',
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
      return NextResponse.json({ error: 'Bind a Sui wallet before clearing the allowlist' }, { status: 403 })
    }
    if (
      owned.requiresWalletFallback
      && !soul.currentOwnerMemberId
      && !walletAddresses.some((address) => sameSuiValue(address, soul.currentOwnerAddress))
    ) {
      return NextResponse.json({ error: 'Only the current owner can manage the allowlist' }, { status: 403 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const txSender = readTransactionSender(transaction)
    if (!txSender || !walletAddresses.some((address) => sameSuiValue(address, txSender))) {
      return NextResponse.json({ error: 'Transaction sender does not match the authenticated wallet' }, { status: 422 })
    }
    const ownershipResult = await verifyCallerOwnsKioskOnChain({ soul, soulPackageId, walletAddresses })
    if (!ownershipResult.verified) {
      return ownershipResult.response
    }
    const soulState = ownershipResult.soulState

    const allowlistClearedEvent = extractSoulAllowlistClearedEvent(
      transaction,
      soulPackageId,
      getTrustedPackageIds(soulPackageId, soulState.packageId),
    )
    if (!sameSuiValue(allowlistClearedEvent.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction did not clear the allowlist for this Soul' }, { status: 422 })
    }
    if (
      typeof soul.allowlistAddress === 'string'
      && soul.allowlistAddress.trim().length > 0
      && !sameSuiValue(allowlistClearedEvent.oldAllowlistedAddress, soul.allowlistAddress)
    ) {
      return NextResponse.json(
        { error: 'Transaction cleared a different allowlist address than the mirrored Soul state' },
        { status: 422 },
      )
    }

    if (soulState.allowlistAddress !== null) {
      return NextResponse.json({ error: 'On-chain Soul allowlist is still set' }, { status: 422 })
    }

    await dbClearSoulAllowlist({
      soulOnChainId: soul.onChainId,
      allowlistVersion: soulState.allowlistVersion,
      expectedCurrentOwnerAddress: soul.currentOwnerAddress,
      expectedCurrentKioskId: soul.currentKioskId,
      expectedListingStatus: 'held',
    })

    const responseBody = {
      soulOnChainId: soul.onChainId,
      allowlistAddress: null,
      soulAllowlistCapOnChainId: null,
      allowlistVersion: soulState.allowlistVersion.toString(),
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'allowlist:clear',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (clearError) {
    if (isMultipleSuiWalletBindingsError(clearError)) {
      return NextResponse.json({ error: clearError.message }, { status: 409 })
    }
    if (clearError instanceof SoulMirrorOwnershipConflictError) {
      return NextResponse.json(
        { error: 'Soul ownership changed before the allowlist mirror could be cleared' },
        { status: 409 },
      )
    }
    if (clearError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(clearError) },
        { status: clearError.status },
      )
    }

    console.error('[soul-allowlist-mirror] Clear sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(clearError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul allowlist clear' }, { status: 500 })
  }
}
