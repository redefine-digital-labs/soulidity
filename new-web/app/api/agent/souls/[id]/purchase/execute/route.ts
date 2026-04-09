import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'
import { takeRateLimitToken } from '@web/lib/rate-limit'
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
  if (prepared.executedAt) {
    if (prepared.resultBody && prepared.resultStatusCode) {
      return NextResponse.json(prepared.resultBody, { status: prepared.resultStatusCode })
    }
    return NextResponse.json({ error: 'Purchase already executed' }, { status: 409 })
  }
  if (new Date() > prepared.expiresAt) {
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

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'agent-buy',
    txDigest: preparedPurchaseId,
    actorKey: auth.agent.agentMemberId,
    resourceKey: soul.onChainId,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

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

    const txDigest = executeResult.digest
    await waitForTransactionBestEffort(txDigest)

    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderAddress = readTransactionSender(transaction)

    if (!senderAddress || !auth.walletAddresses.some(
      (addr) => addr.toLowerCase() === senderAddress.toLowerCase(),
    )) {
      return NextResponse.json({ error: 'Transaction sender does not match agent wallet' }, { status: 422 })
    }

    const purchased = extractSoulPurchasedEvent(transaction, packageId)
    if (!sameSuiValue(purchased.soulId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction purchased a different Soul' }, { status: 422 })
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      memoryObjectId: soul.memoryOnChainId,
      category: soul.category,
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

    await endActiveSoulGrantProjectionsFromChain({
      soulOnChainId: mirrored.onChainId,
      status: 'invalidated',
    })

    const responseBody = {
      digest: txDigest,
      soulOnChainId: mirrored.onChainId,
      currentOwnerAddress: mirrored.currentOwnerAddress,
      currentKioskId: mirrored.currentKioskId,
      currentKioskCapOnChainId: mirrored.currentKioskCapOnChainId,
      listingStatus: mirrored.listingStatus,
    }

    await prisma.soulPreparedPurchase.update({
      where: { id: preparedPurchaseId },
      data: {
        executionTxDigest: txDigest,
        resultStatusCode: 200,
        resultBody: responseBody,
      },
    })

    await storeSoulidityTxSync({
      routeKey: 'agent-buy',
      txDigest: preparedPurchaseId,
      actorKey: auth.agent.agentMemberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[agent-purchase-execute] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      preparedPurchaseId,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to execute purchase transaction' }, { status: 500 })
  }
}
