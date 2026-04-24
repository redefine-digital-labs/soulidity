import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { prisma } from '@/lib/prisma'
import { suiClient } from '@/lib/sui'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { extractSoulPurchasedEvent } from '@/lib/soulidity/events'
import {
  endActiveSoulGrantProjectionsFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, sameSuiValue, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_EXECUTE_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const

function getRecoverableSyncFailure(
  statusCode: number | null | undefined,
  responseBody: unknown,
): { responseBody: Record<string, unknown>; statusCode: number; txDigest: string } | null {
  if (typeof statusCode !== 'number' || typeof responseBody !== 'object' || responseBody == null) {
    return null
  }

  const body = responseBody as Record<string, unknown>
  const txDigest = typeof body.digest === 'string' ? body.digest.trim() : ''
  if (!txDigest || body.onChainSuccess !== true || body.dbSynced !== false) {
    return null
  }

  return {
    responseBody: body,
    statusCode,
    txDigest,
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-execute:${auth.agent.agentMemberId}`,
    AGENT_EXECUTE_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent execute requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const preparedPurchaseId = typeof body?.preparedPurchaseId === 'string' ? body.preparedPurchaseId.trim() : null
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : null

  if (!preparedPurchaseId || !signature) {
    return NextResponse.json({ error: 'preparedPurchaseId and signature are required' }, { status: 400 })
  }

  const prepared = await prisma.soulPreparedPurchase.findUnique({
    where: { id: preparedPurchaseId },
  })
  if (!prepared) {
    return NextResponse.json({ error: 'Prepared purchase not found' }, { status: 404 })
  }
  if (prepared.agentMemberId !== auth.agent.agentMemberId) {
    return NextResponse.json({ error: 'Prepared purchase belongs to a different agent' }, { status: 403 })
  }
  if (!prepared.executedAt && new Date() > prepared.expiresAt) {
    return NextResponse.json({ error: 'Prepared purchase has expired' }, { status: 410 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const txBytes = Buffer.from(prepared.txBytesBase64, 'base64')
  const computedHash = createHash('sha256').update(txBytes).digest('hex')
  if (prepared.txBytesHash !== computedHash) {
    return NextResponse.json({ error: 'TX bytes integrity check failed' }, { status: 422 })
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  let onChainPurchaseVerified = false

  const persistPreparedResultBestEffort = async (params: {
    txDigest: string
    statusCode: number
    responseBody: Record<string, unknown>
    resourceKey?: string | null
  }) => {
    try {
      await prisma.soulPreparedPurchase.update({
        where: { id: preparedPurchaseId },
        data: {
          executionTxDigest: params.txDigest,
          resultStatusCode: params.statusCode,
          resultBody: params.responseBody as never,
        },
      })
    } catch (error) {
      console.warn('[agent-purchase-execute] Failed to persist prepared purchase result', {
        agentMemberId: auth.agent.agentMemberId,
        preparedPurchaseId,
        soulId: soul.onChainId,
        txDigest: params.txDigest,
        statusCode: params.statusCode,
        error,
      })
    }

    try {
      await storeSoulidityTxSync({
        routeKey: 'agent-buy',
        txDigest: preparedPurchaseId,
        actorKey: auth.agent.agentMemberId,
        resourceKey: params.resourceKey ?? soul.onChainId,
        statusCode: params.statusCode,
        responseBody: params.responseBody,
      })
    } catch (error) {
      console.warn('[agent-purchase-execute] Failed to persist tx sync cache', {
        agentMemberId: auth.agent.agentMemberId,
        preparedPurchaseId,
        soulId: soul.onChainId,
        txDigest: params.txDigest,
        statusCode: params.statusCode,
        error,
      })
    }
  }

  const finalizeExecutedPurchase = async (txDigest: string, transaction?: Awaited<ReturnType<typeof getSuccessfulTransactionBlock>>) => {
    const executedTransaction = transaction ?? await getSuccessfulTransactionBlock(txDigest)
    const senderAddress = readTransactionSender(executedTransaction)

    if (!senderAddress || !auth.walletAddresses.some(
      (addr) => addr.toLowerCase() === senderAddress.toLowerCase(),
    )) {
      const responseBody = { error: 'Transaction sender does not match agent wallet' }
      await persistPreparedResultBestEffort({
        txDigest,
        statusCode: 422,
        responseBody,
      })
      return NextResponse.json(responseBody, { status: 422 })
    }

    const purchased = extractSoulPurchasedEvent(executedTransaction, packageId)
    if (!sameSuiValue(purchased.soulId, soul.onChainId)) {
      const responseBody = { error: 'Transaction purchased a different Soul' }
      await persistPreparedResultBestEffort({
        txDigest,
        statusCode: 422,
        responseBody,
      })
      return NextResponse.json(responseBody, { status: 422 })
    }

    onChainPurchaseVerified = true

    let mirrored
    try {
      mirrored = await syncSoulProjectionFromChain({
        packageId,
        soulObjectId: soul.onChainId,
        stateObjectId: soul.stateOnChainId,
        memoryObjectId: soul.memoryOnChainId,
        tags: soul.tags,
        previewImages: soul.previewImages,
        readme: soul.readme,
        sealSidecar: soul.sealSidecar as never,
        creatorMemberId: soul.creatorMemberId,
        currentOwnerMemberId: auth.agent.agentMemberId,
        listingObjectOnChainId: null,
        listedPriceAtomic: null,
        listingStatus: 'held',
      })
    } catch (error) {
      const responseBody = {
        digest: txDigest,
        soulOnChainId: soul.onChainId,
        onChainSuccess: true,
        dbSynced: false,
        error: 'Transaction succeeded on chain, but local Soul sync failed.',
      }
      console.warn('[agent-purchase-execute] Chain purchase succeeded but local Soul sync failed', {
        agentMemberId: auth.agent.agentMemberId,
        preparedPurchaseId,
        soulId: soul.onChainId,
        txDigest,
        error,
      })
      await persistPreparedResultBestEffort({
        txDigest,
        statusCode: 207,
        responseBody,
      })
      return NextResponse.json(responseBody, { status: 207 })
    }

    try {
      await endActiveSoulGrantProjectionsFromChain({
        soulOnChainId: mirrored.onChainId,
        status: 'invalidated',
      })
    } catch (error) {
      const responseBody = {
        digest: txDigest,
        soulOnChainId: mirrored.onChainId,
        onChainSuccess: true,
        dbSynced: false,
        error: 'Transaction succeeded on chain, but local grant invalidation sync failed.',
      }
      console.warn('[agent-purchase-execute] Purchase synced but grant invalidation mirror update failed', {
        agentMemberId: auth.agent.agentMemberId,
        preparedPurchaseId,
        soulId: mirrored.onChainId,
        txDigest,
        error,
      })
      await persistPreparedResultBestEffort({
        txDigest,
        statusCode: 207,
        responseBody,
        resourceKey: mirrored.onChainId,
      })
      return NextResponse.json(responseBody, { status: 207 })
    }

    const responseBody = {
      digest: txDigest,
      soulOnChainId: mirrored.onChainId,
      currentOwnerAddress: mirrored.currentOwnerAddress,
      currentKioskId: mirrored.currentKioskId,
      currentKioskCapOnChainId: mirrored.currentKioskCapOnChainId,
      listingStatus: mirrored.listingStatus,
    }

    await persistPreparedResultBestEffort({
      txDigest,
      statusCode: 200,
      responseBody,
      resourceKey: mirrored.onChainId,
    })

    return NextResponse.json(responseBody)
  }

  const recoverablePreparedResult = getRecoverableSyncFailure(prepared.resultStatusCode, prepared.resultBody)

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'agent-buy',
    txDigest: preparedPurchaseId,
    actorKey: auth.agent.agentMemberId,
    resourceKey: soul.onChainId,
  })
  const recoverableStoredResult = stored
    ? getRecoverableSyncFailure(stored.statusCode, stored.responseBody)
    : null

  if (stored && !recoverableStoredResult) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  if (prepared.resultBody && prepared.resultStatusCode && !recoverablePreparedResult) {
    return NextResponse.json(prepared.resultBody, { status: prepared.resultStatusCode })
  }

  if (prepared.executedAt || recoverablePreparedResult || recoverableStoredResult) {
    try {
      const recoveryTxDigest =
        recoverablePreparedResult?.txDigest
        ?? recoverableStoredResult?.txDigest
        ?? prepared.executionTxDigest
        ?? TransactionDataBuilder.getDigestFromBytes(txBytes)

      return await finalizeExecutedPurchase(recoveryTxDigest)
    } catch (error) {
      console.warn('[agent-purchase-execute] Failed to recover executed prepared purchase', {
        agentMemberId: auth.agent.agentMemberId,
        preparedPurchaseId,
        soulId: soul.onChainId,
        error,
      })
      if (recoverableStoredResult) {
        return NextResponse.json(recoverableStoredResult.responseBody, { status: recoverableStoredResult.statusCode })
      }
      if (recoverablePreparedResult) {
        return NextResponse.json(recoverablePreparedResult.responseBody, { status: recoverablePreparedResult.statusCode })
      }
      return NextResponse.json({ error: 'Purchase already executed' }, { status: 409 })
    }
  }

  let txDigest: string | null = null

  try {
    await prisma.soulPreparedPurchase.update({
      where: { id: preparedPurchaseId },
      data: { executedAt: new Date() },
    })

    const executeResult = await suiClient.executeTransactionBlock({
      transactionBlock: prepared.txBytesBase64,
      signature,
      options: { showEffects: true, showEvents: true },
    })

    txDigest = executeResult.digest
    await waitForTransactionBestEffort(txDigest)
    return await finalizeExecutedPurchase(txDigest)
  } catch (error) {
    console.error('[agent-purchase-execute] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      preparedPurchaseId,
      soulId: soul.onChainId,
      error,
    })
    if (txDigest && onChainPurchaseVerified) {
      const responseBody = {
        digest: txDigest,
        soulOnChainId: soul.onChainId,
        onChainSuccess: true,
        dbSynced: false,
        error: 'Transaction succeeded on chain, but purchase finalization failed.',
      }
      await persistPreparedResultBestEffort({
        txDigest,
        statusCode: 207,
        responseBody,
      })
      return NextResponse.json(responseBody, { status: 207 })
    }
    return NextResponse.json({ error: 'Failed to execute purchase transaction' }, { status: 500 })
  }
}
