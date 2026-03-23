import { createHash } from 'node:crypto'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { isUniqueConstraintError } from '@shared/prisma-errors'

const PREPARED_PURCHASE_TTL_MS = 5 * 60 * 1000
const MAX_PREPARED_TX_BYTES_BASE64 = 64 * 1024

type PreparedPurchaseResultBody = Record<string, unknown>

export function hashPreparedSoulPurchaseTxBytes(txBytesBase64: string): string {
  return createHash('sha256').update(txBytesBase64).digest('hex')
}

export async function createPreparedSoulPurchase(params: {
  agentMemberId: string
  seriesOnChainId: string
  planOnChainId: string
  planType: 'onetime' | 'subscription'
  releaseOnChainId: string | null
  agentAddress: string
  amountUsdc: bigint
  txBytesBase64: string
}): Promise<{ id: string; expiresAt: Date }> {
  if (Buffer.byteLength(params.txBytesBase64, 'utf8') > MAX_PREPARED_TX_BYTES_BASE64) {
    throw new Error('Prepared purchase txBytesBase64 exceeds the size limit')
  }

  const expiresAt = new Date(Date.now() + PREPARED_PURCHASE_TTL_MS)
  const txBytesHash = hashPreparedSoulPurchaseTxBytes(params.txBytesBase64)

  try {
    const prepared = await prisma.soulPreparedPurchase.create({
      data: {
        agentMemberId: params.agentMemberId,
        seriesOnChainId: params.seriesOnChainId,
        planOnChainId: params.planOnChainId,
        planType: params.planType,
        releaseOnChainId: params.releaseOnChainId,
        agentAddress: params.agentAddress,
        amountUsdc: params.amountUsdc,
        txBytesBase64: params.txBytesBase64,
        txBytesHash,
        expiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    })

    return prepared
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const existing = await prisma.soulPreparedPurchase.findFirst({
      where: {
        agentMemberId: params.agentMemberId,
        txBytesHash,
      },
      select: {
        id: true,
        expiresAt: true,
        executedAt: true,
        resultStatusCode: true,
      },
    })
    if (existing) {
      if (!existing.executedAt && existing.resultStatusCode == null) {
        return prisma.soulPreparedPurchase.update({
          where: { id: existing.id },
          data: {
            seriesOnChainId: params.seriesOnChainId,
            planOnChainId: params.planOnChainId,
            planType: params.planType,
            releaseOnChainId: params.releaseOnChainId,
            agentAddress: params.agentAddress,
            amountUsdc: params.amountUsdc,
            txBytesBase64: params.txBytesBase64,
            expiresAt,
          },
          select: {
            id: true,
            expiresAt: true,
          },
        })
      }

      return existing
    }

    throw error
  }
}

export async function getPreparedSoulPurchaseForExecution(params: {
  preparedPurchaseId: string
  agentMemberId: string
  seriesOnChainId: string
}): Promise<{
  id: string
  seriesOnChainId: string
  planOnChainId: string
  planType: string
  releaseOnChainId: string | null
  agentAddress: string
  amountUsdc: bigint
  txBytesBase64: string
  txBytesHash: string
  expiresAt: Date
  executedAt: Date | null
  resultStatusCode: number | null
  resultBody: PreparedPurchaseResultBody | null
} | null> {
  const prepared = await prisma.soulPreparedPurchase.findUnique({
    where: { id: params.preparedPurchaseId },
    select: {
      id: true,
      agentMemberId: true,
      seriesOnChainId: true,
      planOnChainId: true,
      planType: true,
      releaseOnChainId: true,
      agentAddress: true,
      amountUsdc: true,
      txBytesBase64: true,
      txBytesHash: true,
      expiresAt: true,
      executedAt: true,
      resultStatusCode: true,
      resultBody: true,
    },
  })

  if (!prepared) {
    return null
  }

  if (
    prepared.agentMemberId !== params.agentMemberId
    || prepared.seriesOnChainId !== params.seriesOnChainId
    || prepared.expiresAt.getTime() <= Date.now()
  ) {
    return null
  }

  return {
    id: prepared.id,
    seriesOnChainId: prepared.seriesOnChainId,
    planOnChainId: prepared.planOnChainId,
    planType: prepared.planType,
    releaseOnChainId: prepared.releaseOnChainId,
    agentAddress: prepared.agentAddress,
    amountUsdc: prepared.amountUsdc,
    txBytesBase64: prepared.txBytesBase64,
    txBytesHash: prepared.txBytesHash,
    expiresAt: prepared.expiresAt,
    executedAt: prepared.executedAt,
    resultStatusCode: prepared.resultStatusCode,
    resultBody: prepared.resultBody as PreparedPurchaseResultBody | null,
  }
}

export async function claimPreparedSoulPurchaseForExecution(params: {
  preparedPurchaseId: string
  agentMemberId: string
  seriesOnChainId: string
}): Promise<{
  id: string
  seriesOnChainId: string
  planOnChainId: string
  planType: string
  releaseOnChainId: string | null
  agentAddress: string
  amountUsdc: bigint
  txBytesBase64: string
  txBytesHash: string
  executedAt: Date
  resultStatusCode: number | null
  resultBody: PreparedPurchaseResultBody | null
} | null> {
  return prisma.$transaction(async (tx) => {
    const now = new Date()
    const claimed = await tx.soulPreparedPurchase.updateMany({
      where: {
        id: params.preparedPurchaseId,
        agentMemberId: params.agentMemberId,
        seriesOnChainId: params.seriesOnChainId,
        executedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        executedAt: now,
      },
    })

    if (claimed.count === 0) {
      return null
    }

    const prepared = await tx.soulPreparedPurchase.findUnique({
      where: { id: params.preparedPurchaseId },
      select: {
        id: true,
        seriesOnChainId: true,
        planOnChainId: true,
        planType: true,
        releaseOnChainId: true,
        agentAddress: true,
        amountUsdc: true,
        txBytesBase64: true,
        txBytesHash: true,
        executedAt: true,
        resultStatusCode: true,
        resultBody: true,
      },
    })

    if (!prepared || !prepared.executedAt) {
      return null
    }

    return {
      id: prepared.id,
      seriesOnChainId: prepared.seriesOnChainId,
      planOnChainId: prepared.planOnChainId,
      planType: prepared.planType,
      releaseOnChainId: prepared.releaseOnChainId,
      agentAddress: prepared.agentAddress,
      amountUsdc: prepared.amountUsdc,
      txBytesBase64: prepared.txBytesBase64,
      txBytesHash: prepared.txBytesHash,
      executedAt: prepared.executedAt,
      resultStatusCode: prepared.resultStatusCode,
      resultBody: prepared.resultBody as PreparedPurchaseResultBody | null,
    }
  })
}

export async function finalizePreparedSoulPurchaseExecution(params: {
  preparedPurchaseId: string
  txDigest: string
  resultStatusCode: number
  resultBody: PreparedPurchaseResultBody
}): Promise<void> {
  await prisma.soulPreparedPurchase.update({
    where: { id: params.preparedPurchaseId },
    data: {
      executionTxDigest: params.txDigest,
      resultStatusCode: params.resultStatusCode,
      resultBody: params.resultBody as Prisma.InputJsonValue,
    },
  })
}

export async function releasePreparedSoulPurchaseExecution(params: {
  preparedPurchaseId: string
}): Promise<void> {
  await prisma.soulPreparedPurchase.updateMany({
    where: {
      id: params.preparedPurchaseId,
      resultStatusCode: null,
      executionTxDigest: null,
    },
    data: {
      executedAt: null,
    },
  })
}
