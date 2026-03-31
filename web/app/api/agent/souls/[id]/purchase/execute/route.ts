import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import {
  claimPreparedSoulPurchaseForExecution,
  finalizePreparedSoulPurchaseExecution,
  getPreparedSoulPurchaseForExecution,
  getPreparedSoulPurchaseTxDigest,
  hashPreparedSoulPurchaseTxBytes,
  releasePreparedSoulPurchaseExecution,
  storePreparedSoulPurchaseExecutionDigest,
  ZOMBIE_CLAIM_AGE_THRESHOLD_MS,
} from '@web/lib/souls/prepared-purchase'
import {
  dbSetSoulOwnership,
  narrowListingStatus,
  SoulMirrorOwnershipConflictError,
} from '@web/lib/souls/post-tx-db'
import {
  buildPurchaseOwnershipConflictBody,
  buildPurchaseOwnershipChangedBody,
} from '@web/lib/souls/purchase-sync-state'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  extractSoulPurchasedEvent,
  getTrustedPackageIds,
  getVerifiedPersonalKioskCapState,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { waitForTransactionBestEffort } from '@web/lib/souls/tx-confirmation'
import { verifyPreparedTransactionSignature } from '@web/lib/souls/tx-signature'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { isUuid } from '@web/lib/is-uuid'

export const dynamic = 'force-dynamic'

const AGENT_EXECUTE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const
const MAX_EXECUTE_SIGNATURE_LENGTH = 1024

function tryExtractSoulPurchasedEventWithCurrentPackage(
  transaction: Parameters<typeof extractSoulPurchasedEvent>[0],
  packageId: string,
) {
  try {
    return extractSoulPurchasedEvent(transaction, packageId)
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return null
    }
    throw error
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response: authError } = await requireAgentApiKey(request)
  if (authError) return authError

  const rl = await takeRateLimitToken(`agent-execute:${agent.agentMemberId}`, AGENT_EXECUTE_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { preparedPurchaseId, signature } = body
  if (!preparedPurchaseId || typeof preparedPurchaseId !== 'string' || !isUuid(preparedPurchaseId)) {
    return NextResponse.json({ error: 'preparedPurchaseId must be a valid UUID' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required (base64)' }, { status: 400 })
  }
  if (signature.length > MAX_EXECUTE_SIGNATURE_LENGTH) {
    return NextResponse.json({ error: 'signature is too large' }, { status: 400 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
  }

  let agentAddress: string | null
  try {
    agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 400 })
  }

  const preparedPurchase = await getPreparedSoulPurchaseForExecution({
    preparedPurchaseId,
    agentMemberId: agent.agentMemberId,
    soulOnChainId: soul.onChainId,
  })
  if (!preparedPurchase) {
    return NextResponse.json({ error: 'Prepared purchase not found, expired, or no longer matches this Soul' }, { status: 404 })
  }
  if (!sameSuiValue(preparedPurchase.agentAddress, agentAddress)) {
    return NextResponse.json({ error: 'Prepared purchase owner does not match the agent wallet' }, { status: 422 })
  }
  if (preparedPurchase.resultStatusCode && preparedPurchase.resultBody) {
    const cachedBody = preparedPurchase.resultBody as Record<string, unknown>
    const isRecoverableDbSyncFailure =
      cachedBody.onChainSuccess === true
      && cachedBody.dbSynced === false
      && typeof cachedBody.digest === 'string'
      && (preparedPurchase.resultStatusCode === 207 || preparedPurchase.resultStatusCode === 422 || preparedPurchase.resultStatusCode >= 500)

    if (!isRecoverableDbSyncFailure) {
      return NextResponse.json(preparedPurchase.resultBody, { status: preparedPurchase.resultStatusCode })
    }

    let currentKioskId = typeof cachedBody.currentKioskId === 'string' ? cachedBody.currentKioskId : null
    let currentKioskCapOnChainId = typeof cachedBody.currentKioskCapOnChainId === 'string' ? cachedBody.currentKioskCapOnChainId : null
    if (!currentKioskId || !currentKioskCapOnChainId) {
      try {
        const recoveredTx = await getSuccessfulTransactionBlock(cachedBody.digest as string)
        const recoveredDirectPurchaseEvent = tryExtractSoulPurchasedEventWithCurrentPackage(recoveredTx, soulPackageId)
        const recoveredSoulState = await getVerifiedSoulState(
          soul.onChainId,
          soulPackageId,
          recoveredDirectPurchaseEvent ? { expectedKioskId: recoveredDirectPurchaseEvent.buyerKioskId } : undefined,
        )
        const purchaseEvent = recoveredDirectPurchaseEvent ?? extractSoulPurchasedEvent(
          recoveredTx,
          soulPackageId,
          getTrustedPackageIds(soulPackageId, recoveredSoulState.packageId),
        )
        if (!sameSuiValue(purchaseEvent.buyerAddress, agentAddress)) {
          const mismatchBody = {
            digest: cachedBody.digest,
            soulOnChainId: soul.onChainId,
            onChainSuccess: true,
            dbSynced: false,
            error: 'Purchased Soul owner does not match the agent wallet',
          }
          await finalizePreparedSoulPurchaseExecution({
            preparedPurchaseId,
            txDigest: cachedBody.digest as string,
            resultStatusCode: 422,
            resultBody: mismatchBody,
          })
          return NextResponse.json(mismatchBody, { status: 422 })
        }
        currentKioskId = purchaseEvent.buyerKioskId
        currentKioskCapOnChainId = purchaseEvent.buyerKioskCapOnChainId
      } catch (kioskRecoveryError) {
        console.warn('[agent-purchase-execute] Skipping cached partial-result re-sync because kiosk ids are missing and on-chain recovery failed', {
          preparedPurchaseId,
          error: toSafeErrorDetails(kioskRecoveryError),
        })
        return NextResponse.json(preparedPurchase.resultBody, { status: preparedPurchase.resultStatusCode })
      }
    }

    try {
      const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId, {
        expectedKioskId: currentKioskId,
      })
      const soulKioskIdRecovery = soulState.kioskParentId ?? soulState.ownerObjectId
      if (
        preparedPurchase.resultStatusCode === 207
        && (
          soulState.ownerKind !== 'object'
          || !soulKioskIdRecovery
          || !sameSuiValue(soulKioskIdRecovery, currentKioskId)
        )
      ) {
        const ownershipChangedBody = buildPurchaseOwnershipChangedBody({
          digest: cachedBody.digest as string,
          soulOnChainId: soul.onChainId,
        })
        await finalizePreparedSoulPurchaseExecution({
          preparedPurchaseId,
          txDigest: cachedBody.digest as string,
          resultStatusCode: 410,
          resultBody: ownershipChangedBody,
        })
        return NextResponse.json(ownershipChangedBody, { status: 410 })
      }
      if (
        soulState.ownerKind === 'object'
        && soulKioskIdRecovery && sameSuiValue(
          soulKioskIdRecovery,
          currentKioskId,
        )
      ) {
        const kioskCapState = await getVerifiedPersonalKioskCapState(currentKioskCapOnChainId)
        if (
          !sameSuiValue(kioskCapState.kioskId, currentKioskId)
          || !sameSuiValue(kioskCapState.ownerAddress, agentAddress)
        ) {
          console.warn('[agent-purchase-execute] Recovered kiosk cap does not match the agent wallet', {
            preparedPurchaseId,
            expectedAgentAddress: agentAddress,
            recoveredKioskId: kioskCapState.kioskId,
            cachedKioskId: currentKioskId,
            recoveredKioskCapOwner: kioskCapState.ownerAddress,
          })
          const mismatchBody = {
            digest: cachedBody.digest,
            soulOnChainId: soul.onChainId,
            currentOwnerAddress: agentAddress,
            currentKioskId,
            currentKioskCapOnChainId,
            onChainSuccess: true,
            dbSynced: false,
            error: 'Purchase ownership verification failed',
          }
          await finalizePreparedSoulPurchaseExecution({
            preparedPurchaseId,
            txDigest: cachedBody.digest as string,
            resultStatusCode: 422,
            resultBody: mismatchBody,
          })
          return NextResponse.json(mismatchBody, { status: 422 })
        }
        try {
          await dbSetSoulOwnership({
            soulOnChainId: soul.onChainId,
            currentOwnerAddress: agentAddress,
            currentOwnerMemberId: agent.agentMemberId,
            currentKioskId,
            currentKioskCapOnChainId,
            listingObjectOnChainId: null,
            listingStatus: 'held',
            listedPriceAtomic: null,
            allowlistVersion: soulState.allowlistVersion,
            expectedCurrentOwnerAddress: soul.currentOwnerAddress,
            expectedCurrentKioskId: soul.currentKioskId,
            expectedListingStatus: narrowListingStatus(soul.listingStatus),
          })
        } catch (syncError) {
          if (syncError instanceof SoulMirrorOwnershipConflictError) {
            const conflictBody = buildPurchaseOwnershipConflictBody({
              digest: cachedBody.digest as string,
              soulOnChainId: soul.onChainId,
              currentOwnerAddress: agentAddress,
              currentKioskId,
              currentKioskCapOnChainId,
              ownerLabel: 'agent',
            })
            await finalizePreparedSoulPurchaseExecution({
              preparedPurchaseId,
              txDigest: cachedBody.digest as string,
              resultStatusCode: 409,
              resultBody: conflictBody,
            })
            return NextResponse.json(conflictBody, { status: 409 })
          }
          throw syncError
        }
        const syncedBody = {
          digest: cachedBody.digest,
          soulOnChainId: soul.onChainId,
          currentOwnerAddress: agentAddress,
          currentKioskId,
          currentKioskCapOnChainId,
          onChainSuccess: true,
          dbSynced: true,
        }
        await finalizePreparedSoulPurchaseExecution({
          preparedPurchaseId,
          txDigest: cachedBody.digest as string,
          resultStatusCode: 200,
          resultBody: syncedBody,
        })
        return NextResponse.json(syncedBody, { status: 200 })
      }
    } catch (resyncError) {
      console.warn('[agent-purchase-execute] Re-sync attempt failed for cached partial result', {
        preparedPurchaseId,
        error: toSafeErrorDetails(resyncError),
      })
    }

    return NextResponse.json(preparedPurchase.resultBody, { status: preparedPurchase.resultStatusCode })
  }
  const finalizePreparedResult = async (
    txDigest: string,
    statusCode: number,
    body: Record<string, unknown>,
  ): Promise<NextResponse> => {
    await finalizePreparedSoulPurchaseExecution({
      preparedPurchaseId,
      txDigest,
      resultStatusCode: statusCode,
      resultBody: body,
    })
    return NextResponse.json(body, { status: statusCode })
  }

  const finalizeSubmittedPurchase = async (
    submittedTransaction: Parameters<typeof extractSoulPurchasedEvent>[0] & { digest: string },
    expectedSellerKioskId: string,
  ) => {
    const directPurchaseEvent = tryExtractSoulPurchasedEventWithCurrentPackage(submittedTransaction, soulPackageId)
    const soulState = await getVerifiedSoulState(
      soul.onChainId,
      soulPackageId,
      directPurchaseEvent ? { expectedKioskId: directPurchaseEvent.buyerKioskId } : undefined,
    )
    const purchaseEvent = directPurchaseEvent ?? extractSoulPurchasedEvent(
      submittedTransaction,
      soulPackageId,
      getTrustedPackageIds(soulPackageId, soulState.packageId),
    )
    if (!sameSuiValue(purchaseEvent.soulObjectId, soul.onChainId)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, { error: 'Transaction did not purchase the requested Soul' })
    }
    if (!sameSuiValue(purchaseEvent.sellerKioskId, expectedSellerKioskId)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, {
        error: 'Transaction seller kiosk does not match the prepared purchase',
      })
    }
    if (!sameSuiValue(purchaseEvent.buyerAddress, agentAddress)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, {
        error: 'Purchased Soul owner does not match the agent wallet',
      })
    }

    const soulKioskIdAgent = soulState.kioskParentId ?? soulState.ownerObjectId
    if (soulState.ownerKind !== 'object' || !soulKioskIdAgent || !sameSuiValue(soulKioskIdAgent, purchaseEvent.buyerKioskId)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, {
        error: 'Purchased Soul was not moved into the agent kiosk',
      })
    }

    const buyerKioskCapState = await getVerifiedPersonalKioskCapState(purchaseEvent.buyerKioskCapOnChainId)
    if (!sameSuiValue(buyerKioskCapState.kioskId, purchaseEvent.buyerKioskId)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, {
        error: 'Purchased Soul kiosk cap does not match the buyer kiosk',
      })
    }
    if (!sameSuiValue(buyerKioskCapState.ownerAddress, agentAddress)) {
      return await finalizePreparedResult(submittedTransaction.digest, 422, {
        error: 'Purchased Soul kiosk cap does not belong to the agent wallet',
      })
    }

    let statusCode = 200
    let resultBody: Record<string, unknown>
    try {
      await dbSetSoulOwnership({
        soulOnChainId: soul.onChainId,
        currentOwnerAddress: agentAddress,
        currentOwnerMemberId: agent.agentMemberId,
        currentKioskId: purchaseEvent.buyerKioskId,
        currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
        listingObjectOnChainId: null,
        listingStatus: 'held',
        listedPriceAtomic: null,
        allowlistVersion: soulState.allowlistVersion,
        expectedCurrentOwnerAddress: soul.currentOwnerAddress,
        expectedCurrentKioskId: soul.currentKioskId,
        expectedListingStatus: narrowListingStatus(soul.listingStatus),
      })
      resultBody = {
        digest: submittedTransaction.digest,
        soulOnChainId: soul.onChainId,
        currentOwnerAddress: agentAddress,
        currentKioskId: purchaseEvent.buyerKioskId,
        currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
        listingStatus: 'held' as const,
        onChainSuccess: true,
        dbSynced: true,
      }
    } catch (syncError) {
      if (syncError instanceof SoulMirrorOwnershipConflictError) {
        statusCode = 409
        resultBody = buildPurchaseOwnershipConflictBody({
          digest: submittedTransaction.digest,
          soulOnChainId: soul.onChainId,
          currentOwnerAddress: agentAddress,
          currentKioskId: purchaseEvent.buyerKioskId,
          currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
          ownerLabel: 'agent',
        })
      } else {
        statusCode = 207
        console.error('[agent-purchase-execute] Local soul sync failed', toSafeErrorDetails(syncError))
        resultBody = {
          digest: submittedTransaction.digest,
          soulOnChainId: soul.onChainId,
          currentOwnerAddress: agentAddress,
          currentKioskId: purchaseEvent.buyerKioskId,
          currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
          listingStatus: 'held' as const,
          onChainSuccess: true,
          dbSynced: false,
          error: 'Transaction succeeded on chain, but local Soul sync failed.',
        }
      }
    }

    return await finalizePreparedResult(submittedTransaction.digest, statusCode, resultBody)
  }

  if (preparedPurchase.executedAt) {
    const isZombie =
      preparedPurchase.executionTxDigest == null
      && preparedPurchase.resultStatusCode == null
      && (Date.now() - preparedPurchase.executedAt.getTime()) > ZOMBIE_CLAIM_AGE_THRESHOLD_MS

    if (isZombie) {
      console.warn('[agent-purchase-execute] Reclaiming zombie prepared purchase', { preparedPurchaseId })
      await releasePreparedSoulPurchaseExecution({ preparedPurchaseId })
    } else {
      try {
        const recoveredTransaction = await getSuccessfulTransactionBlock(
          preparedPurchase.executionTxDigest ?? getPreparedSoulPurchaseTxDigest(preparedPurchase.txBytesBase64),
        )
        return await finalizeSubmittedPurchase(recoveredTransaction, preparedPurchase.sellerKioskId)
      } catch (recoveryError) {
        console.warn('[agent-purchase-execute] Prepared purchase recovery is still pending', {
          preparedPurchaseId,
          error: toSafeErrorDetails(recoveryError),
        })
        return NextResponse.json({ error: 'Prepared purchase is already being executed' }, { status: 409 })
      }
    }
  }

  const claimedPreparedPurchase = await claimPreparedSoulPurchaseForExecution({
    preparedPurchaseId,
    agentMemberId: agent.agentMemberId,
    soulOnChainId: soul.onChainId,
  })
  if (!claimedPreparedPurchase) {
    const latestPreparedPurchase = await getPreparedSoulPurchaseForExecution({
      preparedPurchaseId,
      agentMemberId: agent.agentMemberId,
      soulOnChainId: soul.onChainId,
    })
    if (latestPreparedPurchase?.resultStatusCode && latestPreparedPurchase.resultBody) {
      return NextResponse.json(
        latestPreparedPurchase.resultBody,
        { status: latestPreparedPurchase.resultStatusCode },
      )
    }
    return NextResponse.json({ error: 'Prepared purchase is already being executed' }, { status: 409 })
  }

  const releaseExecutionClaim = async () => {
    try {
      await releasePreparedSoulPurchaseExecution({ preparedPurchaseId })
    } catch (releaseError) {
      console.error('[agent-purchase-execute] Failed to release prepared purchase claim', {
        preparedPurchaseId,
        error: toSafeErrorDetails(releaseError),
      })
    }
  }

  if (hashPreparedSoulPurchaseTxBytes(claimedPreparedPurchase.txBytesBase64) !== claimedPreparedPurchase.txBytesHash) {
    await releaseExecutionClaim()
    return NextResponse.json({ error: 'Prepared purchase is invalid' }, { status: 500 })
  }

  try {
    await verifyPreparedTransactionSignature({
      txBytesBase64: claimedPreparedPurchase.txBytesBase64,
      signature,
      agentAddress: claimedPreparedPurchase.agentAddress,
    })
  } catch {
    await releaseExecutionClaim()
    return NextResponse.json(
      { error: 'Transaction signature does not match the prepared agent wallet' },
      { status: 400 },
    )
  }

  let result
  try {
    result = await suiClient.executeTransactionBlock({
      transactionBlock: claimedPreparedPurchase.txBytesBase64,
      signature,
      options: { showEffects: true, showInput: true, showObjectChanges: true, showEvents: true },
    })
  } catch (executionError) {
    await releaseExecutionClaim()
    console.error('[agent-purchase-execute] Transaction execution failed', toSafeErrorDetails(executionError))
    return NextResponse.json({ error: 'Transaction execution failed' }, { status: 400 })
  }

  if (result.effects?.status?.status !== 'success') {
    await releaseExecutionClaim()
    console.error('[agent-purchase-execute] Transaction effects indicate failure', {
      preparedPurchaseId,
      error: result.effects?.status?.error ?? 'Transaction effects indicate failure',
    })
    return NextResponse.json({ error: 'Transaction effects indicate failure' }, { status: 400 })
  }

  await waitForTransactionBestEffort(suiClient, result.digest)
  try {
    await storePreparedSoulPurchaseExecutionDigest({
      preparedPurchaseId,
      txDigest: result.digest,
    })
  } catch (digestStoreError) {
    console.error('[agent-purchase-execute] Failed to persist prepared purchase tx digest', {
      preparedPurchaseId,
      digest: result.digest,
      error: toSafeErrorDetails(digestStoreError),
    })
  }

  try {
    return await finalizeSubmittedPurchase(result, claimedPreparedPurchase.sellerKioskId)
  } catch (verificationError) {
    if (verificationError instanceof OnChainVerificationError) {
      return await finalizePreparedResult(result.digest, verificationError.status, {
        error: getClientSafeOnChainVerificationErrorMessage(verificationError),
        digest: result.digest,
        onChainSuccess: true,
        dbSynced: false,
      })
    }

    console.error('[agent-purchase-execute] Post-submit verification failed', toSafeErrorDetails(verificationError))
    return await finalizePreparedResult(result.digest, 500, {
      error: 'Transaction submitted, but post-submit verification failed',
      digest: result.digest,
      onChainSuccess: true,
      dbSynced: false,
    })
  }
}
