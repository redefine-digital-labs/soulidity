import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
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
import {
  assertPassChange,
  ensureTransactionSucceeded,
  getVerifiedPassState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { waitForTransactionBestEffort } from '@web/lib/souls/tx-confirmation'
import { verifyPreparedTransactionSignature } from '@web/lib/souls/tx-signature'

export const dynamic = 'force-dynamic'

const AGENT_EXECUTE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

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
  if (!preparedPurchaseId || typeof preparedPurchaseId !== 'string') {
    return NextResponse.json({ error: 'preparedPurchaseId is required' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required (base64)' }, { status: 400 })
  }

  const { id } = await params

  const series = await prisma.soulSeries.findFirst({
    where: { OR: [{ id }, { onChainId: id }] },
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
        error,
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

    const result = await suiClient.executeTransactionBlock({
      transactionBlock: claimedPreparedPurchase.txBytesBase64,
      signature,
      options: { showEffects: true, showInput: true, showObjectChanges: true },
    })

    await waitForTransactionBestEffort(suiClient, result.digest)

    const status = result.effects?.status?.status ?? 'unknown'
    const finalizePreparedResult = async (statusCode: number, body: Record<string, unknown>) => {
      await finalizePreparedSoulPurchaseExecution({
        preparedPurchaseId,
        txDigest: result.digest,
        resultStatusCode: statusCode,
        resultBody: body,
      })

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

      if (passObj?.objectId) {
        passOnChainId = passObj.objectId
        assertPassChange(result, {
          passOnChainId,
          changeTypes: ['created'],
          errorMessage: 'Transaction did not create a Soul pass',
          expectedSender: ownerAddress,
        })

        const passState = await getVerifiedPassState(passOnChainId)
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

        try {
          await dbCreatePass({
            passOnChainId: passState.objectId,
            seriesOnChainId: series.onChainId,
            ownerAddress,
            ownerMemberId: agent.agentMemberId,
            passType: passState.passType,
            lockedReleaseId: passState.lockedReleaseId,
            mintTxDigest: result.digest,
            ...(passState.expiresAt ? { expiresAt: passState.expiresAt } : {}),
          })
        } catch (err) {
          dbSynced = false
          syncError = 'db_sync_failed'
          console.error('[agent-purchase-execute] DB write failed:', err)
        }
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
          error: err.message,
          digest: result.digest,
          onChainSuccess: result.effects?.status?.status === 'success',
          dbSynced: false,
        })
      }

      console.error('[agent-purchase-execute] Post-submit verification failed', err)
      return finalizePreparedResult(500, {
        error: 'Transaction submitted, but post-submit verification failed',
        digest: result.digest,
        onChainSuccess: result.effects?.status?.status === 'success',
        dbSynced: false,
      })
    }
  } catch (err) {
    await releaseExecutionClaim()
    console.error('[agent-purchase-execute] Transaction execution failed', err)
    return NextResponse.json({ error: 'Transaction execution failed' }, { status: 400 })
  }
}
