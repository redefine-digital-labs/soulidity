import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { isUuid } from '@web/lib/is-uuid'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import {
  claimPreparedSoulPurchaseForExecution,
  finalizePreparedSoulPurchaseExecution,
  getPreparedSoulPurchaseForExecution,
  hashPreparedSoulPurchaseTxBytes,
  releasePreparedSoulPurchaseExecution,
} from '@web/lib/souls/prepared-purchase'
import { dbCreatePass } from '@web/lib/souls/post-tx-db'
import { prisma } from '@web/lib/prisma'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  assertPassChange,
  ensureTransactionSucceeded,
  getVerifiedPassState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { waitForTransactionBestEffort } from '@web/lib/souls/tx-confirmation'
import { verifyPreparedTransactionSignature } from '@web/lib/souls/tx-signature'

export const dynamic = 'force-dynamic'

const AGENT_EXECUTE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const
const MAX_EXECUTE_SIGNATURE_LENGTH = 1024
const RETRYABLE_VERIFICATION_SYNC_ERROR = 'verification_retryable'

type VerifiedPurchasePassState = Awaited<ReturnType<typeof getVerifiedPassState>>

function getRetryableStoredSyncResult(params: {
  resultStatusCode: number | null
  resultBody: unknown
}) {
  if (!params.resultStatusCode || !params.resultBody) {
    return null
  }

  const prevBody = params.resultBody as Record<string, unknown>
  const digest = typeof prevBody.digest === 'string' ? prevBody.digest : null
  const passOnChainId = typeof prevBody.passOnChainId === 'string' ? prevBody.passOnChainId : null
  const syncError = typeof prevBody.syncError === 'string' ? prevBody.syncError : null

  const retryable = params.resultStatusCode === 207 || syncError === RETRYABLE_VERIFICATION_SYNC_ERROR
  if (!retryable || !digest || !passOnChainId) {
    return null
  }

  return {
    statusCode: params.resultStatusCode,
    prevBody,
    digest,
    passOnChainId,
  }
}

function getPurchasePassValidationError(params: {
  passState: VerifiedPurchasePassState
  seriesOnChainId: string
  ownerAddress: string
  planType: string
  releaseOnChainId: string | null
}): string | null {
  const { passState, seriesOnChainId, ownerAddress, planType, releaseOnChainId } = params

  if (!sameSuiValue(passState.seriesId, seriesOnChainId)) {
    return 'Created pass does not belong to the requested Soul'
  }
  if (!sameSuiValue(passState.ownerAddress, ownerAddress)) {
    return 'Created pass owner does not match the agent wallet'
  }
  if (planType === 'onetime') {
    if (passState.passType !== 'perpetual') {
      return 'Prepared one-time purchase did not mint a perpetual pass'
    }
    if (!releaseOnChainId || !sameSuiValue(passState.lockedReleaseId, releaseOnChainId)) {
      return 'Created pass release does not match the prepared purchase context'
    }
    return null
  }

  if (passState.passType !== 'subscription') {
    return 'Prepared subscription purchase did not mint a subscription pass'
  }

  return null
}

/**
 * POST /api/agent/souls/[id]/purchase/execute — Submit a signed purchase TX.
 *
 * Request: { preparedPurchaseId: uuid, signature: base64 }
 * Response: { digest, status, passOnChainId?, onChainSuccess, dbSynced }
 */
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
  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 },
    )
  }

  const series = await prisma.soulSeries.findFirst({
    where: isUuid(id) ? { id } : { onChainId: id },
    select: { onChainId: true },
  })
  if (!series) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const ownerAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  if (!ownerAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 400 })
  }

  const preparedPurchase = await getPreparedSoulPurchaseForExecution({
    preparedPurchaseId,
    agentMemberId: agent.agentMemberId,
    seriesOnChainId: series.onChainId,
  })
  if (!preparedPurchase) {
    return NextResponse.json({ error: 'Prepared purchase not found, expired, or no longer matches this Soul' }, { status: 404 })
  }
  if (!sameSuiValue(preparedPurchase.agentAddress, ownerAddress)) {
    return NextResponse.json({ error: 'Prepared purchase owner does not match the agent wallet' }, { status: 422 })
  }
  if (preparedPurchase.passOnChainId) {
    return NextResponse.json(
      { error: 'Prepared renewal must be executed via the renew endpoint' },
      { status: 422 },
    )
  }
  const retryableStoredSyncResult = getRetryableStoredSyncResult({
    resultStatusCode: preparedPurchase.resultStatusCode,
    resultBody: preparedPurchase.resultBody,
  })
  if (retryableStoredSyncResult) {
    try {
      const passState = await getVerifiedPassState(retryableStoredSyncResult.passOnChainId, soulPackageId)
      const validationError = getPurchasePassValidationError({
        passState,
        seriesOnChainId: series.onChainId,
        ownerAddress,
        planType: preparedPurchase.planType,
        releaseOnChainId: preparedPurchase.releaseOnChainId,
      })
      if (validationError) {
        const resultBody = { error: validationError }
        await finalizePreparedSoulPurchaseExecution({
          preparedPurchaseId,
          txDigest: retryableStoredSyncResult.digest,
          resultStatusCode: 422,
          resultBody,
        })
        return NextResponse.json(resultBody, { status: 422 })
      }

      const syncedResponseBody = {
        digest: retryableStoredSyncResult.digest,
        status: 'success',
        passOnChainId: retryableStoredSyncResult.passOnChainId,
        onChainSuccess: true,
        dbSynced: true,
      }
      await prisma.$transaction(async (tx) => {
        await dbCreatePass({
          db: tx,
          passOnChainId: passState.objectId,
          seriesOnChainId: series.onChainId,
          ownerAddress: passState.ownerAddress,
          passType: passState.passType,
          lockedReleaseId: passState.lockedReleaseId,
          mintTxDigest: retryableStoredSyncResult.digest,
          ...(passState.expiresAt ? { expiresAt: passState.expiresAt } : {}),
        })
        await finalizePreparedSoulPurchaseExecution({
          db: tx,
          preparedPurchaseId,
          txDigest: retryableStoredSyncResult.digest,
          resultStatusCode: 200,
          resultBody: syncedResponseBody,
        })
      })
      return NextResponse.json(syncedResponseBody, { status: 200 })
    } catch (err) {
      console.error('[agent-purchase-execute] Retryable sync retry failed', toSafeErrorDetails(err))
      return NextResponse.json(
        retryableStoredSyncResult.prevBody,
        { status: retryableStoredSyncResult.statusCode },
      )
    }
  }

  if (preparedPurchase.resultStatusCode && preparedPurchase.resultBody) {
    return NextResponse.json(preparedPurchase.resultBody, { status: preparedPurchase.resultStatusCode })
  }
  if (preparedPurchase.executedAt) {
    return NextResponse.json({ error: 'Prepared purchase is already being executed' }, { status: 409 })
  }

  const claimedPreparedPurchase = await claimPreparedSoulPurchaseForExecution({
    preparedPurchaseId,
    agentMemberId: agent.agentMemberId,
    seriesOnChainId: series.onChainId,
  })
  if (!claimedPreparedPurchase) {
    const latestPreparedPurchase = await getPreparedSoulPurchaseForExecution({
      preparedPurchaseId,
      agentMemberId: agent.agentMemberId,
      seriesOnChainId: series.onChainId,
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
    } catch (error) {
      console.error('[agent-purchase-execute] Failed to release prepared purchase claim', {
        preparedPurchaseId,
        error: toSafeErrorDetails(error),
      })
    }
  }

  if (
    hashPreparedSoulPurchaseTxBytes(claimedPreparedPurchase.txBytesBase64)
      !== claimedPreparedPurchase.txBytesHash
  ) {
    console.error('[agent-purchase-execute] Prepared purchase tx bytes hash mismatch', {
      preparedPurchaseId,
    })
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
      options: { showEffects: true, showInput: true, showObjectChanges: true },
    })
  } catch (err) {
    await releaseExecutionClaim()
    console.error('[agent-purchase-execute] Transaction execution failed', toSafeErrorDetails(err))
    return NextResponse.json({ error: 'Transaction execution failed' }, { status: 400 })
  }

  await waitForTransactionBestEffort(suiClient, result.digest)

  const status = result.effects?.status?.status ?? 'unknown'
  let passOnChainId: string | undefined
  const finalizePreparedResult = async (
    statusCode: number,
    body: Record<string, unknown>,
  ): Promise<NextResponse> => {
    try {
      await finalizePreparedSoulPurchaseExecution({
        preparedPurchaseId,
        txDigest: result.digest,
        resultStatusCode: statusCode,
        resultBody: body,
      })
    } catch (error) {
      console.error('[agent-purchase-execute] Failed to finalize prepared purchase execution', {
        preparedPurchaseId,
        txDigest: result.digest,
        statusCode,
        error: toSafeErrorDetails(error),
      })
      await releaseExecutionClaim()
      return NextResponse.json(
        {
          error: 'Transaction submitted, but local execution finalization failed',
          digest: result.digest,
          onChainSuccess: result.effects?.status?.status === 'success',
          dbSynced: false,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(body, { status: statusCode })
  }

  try {
    ensureTransactionSucceeded(result)

    const passObj = result.objectChanges?.find((change) => {
      if (!change || typeof change !== 'object') return false
      const candidate = change as { type?: string; objectType?: string; objectId?: string }
      return candidate.type === 'created'
        && !!candidate.objectId
        && (
          candidate.objectType?.includes('::pass::PerpetualPass')
          || candidate.objectType?.includes('::pass::SubscriptionPass')
        )
    }) as { objectId?: string } | undefined

    let dbSynced = true
    let syncError: string | null = null

    if (!passObj?.objectId) {
      return finalizePreparedResult(422, {
        error: 'Transaction succeeded on chain, but no Soul pass object was created',
        digest: result.digest,
        status,
        onChainSuccess: true,
        dbSynced: false,
      })
    }

    passOnChainId = passObj.objectId
    assertPassChange(result, {
      passOnChainId,
      changeTypes: ['created'],
      errorMessage: 'Transaction did not create a Soul pass',
      expectedSender: ownerAddress,
      expectedPackageId: soulPackageId,
    })

    const passState = await getVerifiedPassState(passOnChainId, soulPackageId)
    const validationError = getPurchasePassValidationError({
      passState,
      seriesOnChainId: series.onChainId,
      ownerAddress,
      planType: claimedPreparedPurchase.planType,
      releaseOnChainId: claimedPreparedPurchase.releaseOnChainId,
    })
    if (validationError) {
      return finalizePreparedResult(422, { error: validationError })
    }

    const syncedResponseBody = {
      digest: result.digest,
      status,
      passOnChainId,
      onChainSuccess: true,
      dbSynced: true,
    }

    try {
      await prisma.$transaction(async (tx) => {
        await dbCreatePass({
          db: tx,
          passOnChainId: passState.objectId,
          seriesOnChainId: series.onChainId,
          ownerAddress: passState.ownerAddress,
          // Let dbCreatePass resolve ownerMemberId from on-chain owner address
          // instead of hardcoding caller — handles post-mint transfer edge case
          passType: passState.passType,
          lockedReleaseId: passState.lockedReleaseId,
          mintTxDigest: result.digest,
          ...(passState.expiresAt ? { expiresAt: passState.expiresAt } : {}),
        })
        await finalizePreparedSoulPurchaseExecution({
          db: tx,
          preparedPurchaseId,
          txDigest: result.digest,
          resultStatusCode: 200,
          resultBody: syncedResponseBody,
        })
      })

      return NextResponse.json(syncedResponseBody, { status: 200 })
    } catch (err) {
      dbSynced = false
      syncError = 'db_sync_failed'
      console.error('[agent-purchase-execute] Local sync transaction failed', toSafeErrorDetails(err))
    }

    const responseBody = {
      digest: result.digest,
      status,
      passOnChainId: passOnChainId ?? null,
      onChainSuccess: true,
      dbSynced,
      ...(dbSynced ? {} : {
        error: 'Transaction succeeded on chain, but local pass sync failed. Retry sync before granting access.',
        syncError,
      }),
    }

    return finalizePreparedResult(dbSynced ? 200 : 207, responseBody)
  } catch (err) {
    const onChainSuccess = result.effects?.status?.status === 'success'
    const retryablePassSyncContext = onChainSuccess && !!passOnChainId

    if (err instanceof OnChainVerificationError) {
      return finalizePreparedResult(err.status, {
        error: getClientSafeOnChainVerificationErrorMessage(err),
        digest: result.digest,
        ...(retryablePassSyncContext ? { passOnChainId } : {}),
        onChainSuccess,
        dbSynced: false,
        ...(retryablePassSyncContext && err.status >= 500 ? { syncError: RETRYABLE_VERIFICATION_SYNC_ERROR } : {}),
      })
    }

    console.error('[agent-purchase-execute] Post-submit verification failed', toSafeErrorDetails(err))
    return finalizePreparedResult(500, {
      error: 'Transaction submitted, but post-submit verification failed',
      digest: result.digest,
      ...(retryablePassSyncContext ? { passOnChainId } : {}),
      onChainSuccess,
      dbSynced: false,
      ...(retryablePassSyncContext ? { syncError: RETRYABLE_VERIFICATION_SYNC_ERROR } : {}),
    })
  }
}
