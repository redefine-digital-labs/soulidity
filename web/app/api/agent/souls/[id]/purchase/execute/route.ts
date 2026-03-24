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

  const rl = takeRateLimitToken(`agent-execute:${agent.agentMemberId}`, AGENT_EXECUTE_RATE_LIMIT)
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
  // 207 = on-chain TX succeeded but DB sync failed — allow retry
  if (preparedPurchase.resultStatusCode === 207 && preparedPurchase.resultBody) {
    const prevBody = preparedPurchase.resultBody as Record<string, unknown>
    const passOnChainId = typeof prevBody.passOnChainId === 'string' ? prevBody.passOnChainId : null
    const digest = typeof prevBody.digest === 'string' ? prevBody.digest : null

    if (passOnChainId && digest) {
      try {
        const passState = await getVerifiedPassState(passOnChainId, soulPackageId)
        const syncedResponseBody = {
          digest,
          status: 'success',
          passOnChainId,
          onChainSuccess: true,
          dbSynced: true,
        }
        await prisma.$transaction(async (tx) => {
          await dbCreatePass({
            db: tx,
            passOnChainId: passState.objectId,
            seriesOnChainId: series.onChainId,
            ownerAddress,
            ownerMemberId: agent.agentMemberId,
            passType: passState.passType,
            lockedReleaseId: passState.lockedReleaseId,
            mintTxDigest: digest,
            ...(passState.expiresAt ? { expiresAt: passState.expiresAt } : {}),
          })
          await finalizePreparedSoulPurchaseExecution({
            db: tx,
            preparedPurchaseId,
            txDigest: digest,
            resultStatusCode: 200,
            resultBody: syncedResponseBody,
          })
        })
        return NextResponse.json(syncedResponseBody, { status: 200 })
      } catch (err) {
        console.error('[agent-purchase-execute] DB sync retry failed', toSafeErrorDetails(err))
        return NextResponse.json(prevBody, { status: 207 })
      }
    }

    return NextResponse.json(prevBody, { status: 207 })
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

    let passOnChainId: string | undefined
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
    if (!sameSuiValue(passState.seriesId, series.onChainId)) {
      return finalizePreparedResult(422, { error: 'Created pass does not belong to the requested Soul' })
    }
    if (!sameSuiValue(passState.ownerAddress, ownerAddress)) {
      return finalizePreparedResult(422, { error: 'Created pass owner does not match the agent wallet' })
    }
    if (claimedPreparedPurchase.planType === 'onetime') {
      if (passState.passType !== 'perpetual') {
        return finalizePreparedResult(422, { error: 'Prepared one-time purchase did not mint a perpetual pass' })
      }
      if (
        !claimedPreparedPurchase.releaseOnChainId
        || !sameSuiValue(passState.lockedReleaseId, claimedPreparedPurchase.releaseOnChainId)
      ) {
        return finalizePreparedResult(422, { error: 'Created pass release does not match the prepared purchase context' })
      }
    } else if (passState.passType !== 'subscription') {
      return finalizePreparedResult(422, { error: 'Prepared subscription purchase did not mint a subscription pass' })
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
          ownerAddress,
          ownerMemberId: agent.agentMemberId,
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
    if (err instanceof OnChainVerificationError) {
      return finalizePreparedResult(err.status, {
        error: getClientSafeOnChainVerificationErrorMessage(err),
        digest: result.digest,
        onChainSuccess: result.effects?.status?.status === 'success',
        dbSynced: false,
      })
    }

    console.error('[agent-purchase-execute] Post-submit verification failed', toSafeErrorDetails(err))
    return finalizePreparedResult(500, {
      error: 'Transaction submitted, but post-submit verification failed',
      digest: result.digest,
      onChainSuccess: result.effects?.status?.status === 'success',
      dbSynced: false,
    })
  }
}
