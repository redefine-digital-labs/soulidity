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
import { dbRenewPass } from '@web/lib/souls/post-tx-db'
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

function getRetryableStoredSyncResult(params: {
  resultStatusCode: number | null
  resultBody: unknown
  preparedPassOnChainId: string | null
}) {
  if (!params.resultStatusCode || !params.resultBody) {
    return null
  }

  const prevBody = params.resultBody as Record<string, unknown>
  const digest = typeof prevBody.digest === 'string' ? prevBody.digest : null
  const passOnChainId = typeof prevBody.passOnChainId === 'string'
    ? prevBody.passOnChainId
    : params.preparedPassOnChainId
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

/**
 * POST /api/agent/souls/[id]/renew/execute — Submit a signed renew TX.
 *
 * Request: { preparedPurchaseId: uuid, signature: base64 }
 * Response: { digest, status, passOnChainId?, expiresAt?, onChainSuccess, dbSynced }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response: authError } = await requireAgentApiKey(request)
  if (authError) return authError

  const rl = await takeRateLimitToken(`agent-execute-renew:${agent.agentMemberId}`, AGENT_EXECUTE_RATE_LIMIT)
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
  if (!preparedPurchase.passOnChainId) {
    return NextResponse.json(
      { error: 'Prepared purchase must be executed via the purchase endpoint' },
      { status: 422 },
    )
  }
  const retryableStoredSyncResult = getRetryableStoredSyncResult({
    resultStatusCode: preparedPurchase.resultStatusCode,
    resultBody: preparedPurchase.resultBody,
    preparedPassOnChainId: preparedPurchase.passOnChainId,
  })
  if (retryableStoredSyncResult) {
    try {
      const passState = await getVerifiedPassState(retryableStoredSyncResult.passOnChainId, soulPackageId)
      const syncedResponseBody = {
        digest: retryableStoredSyncResult.digest,
        status: 'success',
        passOnChainId: retryableStoredSyncResult.passOnChainId,
        expiresAt: passState.expiresAt!.toISOString(),
        onChainSuccess: true,
        dbSynced: true,
      }
      await prisma.$transaction(async (tx) => {
        await dbRenewPass({
          db: tx,
          passOnChainId: passState.objectId,
          newExpiresAt: passState.expiresAt!,
          renewTxDigest: retryableStoredSyncResult.digest,
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
      console.error('[agent-renew-execute] Retryable sync retry failed', toSafeErrorDetails(err))
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
      console.error('[agent-renew-execute] Failed to release prepared purchase claim', {
        preparedPurchaseId,
        error: toSafeErrorDetails(error),
      })
    }
  }

  if (
    hashPreparedSoulPurchaseTxBytes(claimedPreparedPurchase.txBytesBase64)
      !== claimedPreparedPurchase.txBytesHash
  ) {
    console.error('[agent-renew-execute] Prepared purchase tx bytes hash mismatch', {
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
    console.error('[agent-renew-execute] Transaction execution failed', toSafeErrorDetails(err))
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
      console.error('[agent-renew-execute] Failed to finalize prepared purchase execution', {
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
      return candidate.type === 'mutated'
        && !!candidate.objectId
        && candidate.objectType?.includes('::pass::SubscriptionPass')
    }) as { objectId?: string } | undefined

    let dbSynced = true
    let syncError: string | null = null

    if (!passObj?.objectId) {
      return finalizePreparedResult(422, {
        error: 'Transaction succeeded on chain, but no Soul subscription pass was mutated',
        digest: result.digest,
        status,
        onChainSuccess: true,
        dbSynced: false,
      })
    }

    passOnChainId = passObj.objectId
    assertPassChange(result, {
      passOnChainId,
      changeTypes: ['mutated'],
      errorMessage: 'Transaction did not renew a Soul pass',
      expectedSender: ownerAddress,
      expectedPackageId: soulPackageId,
    })

    const passState = await getVerifiedPassState(passOnChainId, soulPackageId)
    if (!sameSuiValue(passState.seriesId, series.onChainId)) {
      return finalizePreparedResult(422, { error: 'Renewed pass does not belong to the requested Soul' })
    }
    const isOwnerOrGranted = sameSuiValue(passState.ownerAddress, ownerAddress)
      || sameSuiValue(passState.agentGrant, ownerAddress)
    if (!isOwnerOrGranted) {
      return finalizePreparedResult(422, { error: 'Pass is not owned by or granted to the agent wallet' })
    }
    if (passState.passType !== 'subscription') {
      return finalizePreparedResult(422, { error: 'Only subscription passes can be renewed' })
    }
    if (!passState.expiresAt) {
      return finalizePreparedResult(422, { error: 'Renewed subscription pass has no expiration date' })
    }
    if (claimedPreparedPurchase.passOnChainId && !sameSuiValue(passOnChainId, claimedPreparedPurchase.passOnChainId)) {
      return finalizePreparedResult(422, { error: 'Renewed pass does not match the prepared renewal context' })
    }

    const syncedResponseBody = {
      digest: result.digest,
      status,
      passOnChainId,
      expiresAt: passState.expiresAt!.toISOString(),
      onChainSuccess: true,
      dbSynced: true,
    }

    try {
      await prisma.$transaction(async (tx) => {
        await dbRenewPass({
          db: tx,
          passOnChainId: passState.objectId,
          newExpiresAt: passState.expiresAt!,
          renewTxDigest: result.digest,
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
      console.error('[agent-renew-execute] Local sync transaction failed', toSafeErrorDetails(err))
    }

    const responseBody = {
      digest: result.digest,
      status,
      passOnChainId: passOnChainId ?? null,
      expiresAt: passState.expiresAt!.toISOString(),
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
    const retryPassOnChainId = passOnChainId ?? claimedPreparedPurchase.passOnChainId ?? undefined
    const retryablePassSyncContext = onChainSuccess && !!retryPassOnChainId

    if (err instanceof OnChainVerificationError) {
      return finalizePreparedResult(err.status, {
        error: getClientSafeOnChainVerificationErrorMessage(err),
        digest: result.digest,
        ...(retryablePassSyncContext ? { passOnChainId: retryPassOnChainId } : {}),
        onChainSuccess,
        dbSynced: false,
        ...(retryablePassSyncContext && err.status >= 500 ? { syncError: RETRYABLE_VERIFICATION_SYNC_ERROR } : {}),
      })
    }

    console.error('[agent-renew-execute] Post-submit verification failed', toSafeErrorDetails(err))
    return finalizePreparedResult(500, {
      error: 'Transaction submitted, but post-submit verification failed',
      digest: result.digest,
      ...(retryablePassSyncContext ? { passOnChainId: retryPassOnChainId } : {}),
      onChainSuccess,
      dbSynced: false,
      ...(retryablePassSyncContext ? { syncError: RETRYABLE_VERIFICATION_SYNC_ERROR } : {}),
    })
  }
}
