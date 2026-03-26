import { createHash } from 'node:crypto'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { sameSuiValue } from '@web/lib/souls/on-chain-verification'
import { parseAtomicUsdcString, serializeAtomicUsdcAmount } from '@web/lib/souls/price-format'
import { isUniqueConstraintError } from '@shared/prisma-errors'

const PREPARED_PURCHASE_TTL_MS = 5 * 60 * 1000
const PREPARED_PURCHASE_STALE_RETENTION_MS = PREPARED_PURCHASE_TTL_MS
const PREPARED_PURCHASE_CLEANUP_THROTTLE_MS = 60 * 1000
const MAX_PREPARED_TX_BYTES_BASE64 = 64 * 1024

type PreparedPurchaseResultBody = Record<string, unknown>
type PreparedPurchaseDbClient = typeof prisma | Prisma.TransactionClient

let lastPreparedPurchaseCleanupAt = 0

export function hashPreparedSoulPurchaseTxBytes(txBytesBase64: string): string {
  return createHash('sha256').update(txBytesBase64).digest('hex')
}

function getPreparedPurchaseCleanupCutoff(now = Date.now()): Date {
  return new Date(now - PREPARED_PURCHASE_STALE_RETENTION_MS)
}

function shouldCleanupPreparedPurchases(now = Date.now()): boolean {
  if (now - lastPreparedPurchaseCleanupAt < PREPARED_PURCHASE_CLEANUP_THROTTLE_MS) {
    return false
  }

  lastPreparedPurchaseCleanupAt = now
  return true
}

function cleanupExpiredPreparedPurchases(): void {
  if (!shouldCleanupPreparedPurchases()) {
    return
  }

  void prisma.soulPreparedPurchase.deleteMany({
    where: {
      expiresAt: { lt: getPreparedPurchaseCleanupCutoff() },
      executedAt: null,
      resultStatusCode: null,
      executionTxDigest: null,
    },
  }).catch((error) => {
    console.error('Failed to cleanup expired prepared purchases', { error })
  })
}

export async function createPreparedSoulPurchase(params: {
  agentMemberId: string
  seriesOnChainId: string
  planOnChainId: string
  planType: 'onetime' | 'subscription'
  releaseOnChainId: string | null
  passOnChainId?: string | null
  agentAddress: string
  amountUsdc: bigint
  txBytesBase64: string
}): Promise<{ id: string; expiresAt: Date }> {
  if (Buffer.byteLength(params.txBytesBase64, 'utf8') > MAX_PREPARED_TX_BYTES_BASE64) {
    throw new Error('Prepared purchase txBytesBase64 exceeds the size limit')
  }

  cleanupExpiredPreparedPurchases()

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
        passOnChainId: params.passOnChainId ?? null,
        agentAddress: params.agentAddress,
        amountUsdc: params.amountUsdc.toString(),
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
        executionTxDigest: true,
        resultStatusCode: true,
      },
    })
    if (existing) {
      if (!existing.executedAt && existing.resultStatusCode == null) {
        const updated = await prisma.soulPreparedPurchase.updateMany({
          where: {
            id: existing.id,
            executedAt: null,
            resultStatusCode: null,
          },
          data: {
            seriesOnChainId: params.seriesOnChainId,
            planOnChainId: params.planOnChainId,
            planType: params.planType,
            releaseOnChainId: params.releaseOnChainId,
            passOnChainId: params.passOnChainId ?? null,
            agentAddress: params.agentAddress,
            amountUsdc: params.amountUsdc.toString(),
            txBytesBase64: params.txBytesBase64,
            expiresAt,
          },
        })
        if (updated.count === 0) {
          return existing
        }
        return {
          id: existing.id,
          expiresAt,
        }
      }

      if (
        existing.executedAt
        && existing.executionTxDigest == null
        && existing.resultStatusCode == null
        && existing.expiresAt.getTime() <= Date.now()
      ) {
        const reclaimed = await prisma.soulPreparedPurchase.updateMany({
          where: {
            id: existing.id,
            executedAt: { not: null },
            executionTxDigest: null,
            resultStatusCode: null,
            expiresAt: { lte: new Date() },
          },
          data: {
            seriesOnChainId: params.seriesOnChainId,
            planOnChainId: params.planOnChainId,
            planType: params.planType,
            releaseOnChainId: params.releaseOnChainId,
            passOnChainId: params.passOnChainId ?? null,
            agentAddress: params.agentAddress,
            amountUsdc: params.amountUsdc.toString(),
            txBytesBase64: params.txBytesBase64,
            executedAt: null,
            expiresAt,
          },
        })
        if (reclaimed.count > 0) {
          return {
            id: existing.id,
            expiresAt,
          }
        }
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
  passOnChainId: string | null
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
      passOnChainId: true,
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
    || !sameSuiValue(prepared.seriesOnChainId, params.seriesOnChainId)
    || (prepared.expiresAt.getTime() <= Date.now() && prepared.resultStatusCode == null)
  ) {
    return null
  }

  return {
    id: prepared.id,
    seriesOnChainId: prepared.seriesOnChainId,
    planOnChainId: prepared.planOnChainId,
    planType: prepared.planType,
    releaseOnChainId: prepared.releaseOnChainId,
    passOnChainId: prepared.passOnChainId,
    agentAddress: prepared.agentAddress,
    amountUsdc: parseAtomicUsdcString(serializeAtomicUsdcAmount(prepared.amountUsdc) ?? '0'),
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
  passOnChainId: string | null
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
    const current = await tx.soulPreparedPurchase.findUnique({
      where: { id: params.preparedPurchaseId },
      select: {
        id: true,
        agentMemberId: true,
        seriesOnChainId: true,
        executedAt: true,
        expiresAt: true,
      },
    })

    if (
      !current
      || current.agentMemberId !== params.agentMemberId
      || !sameSuiValue(current.seriesOnChainId, params.seriesOnChainId)
      || current.executedAt
      || current.expiresAt.getTime() <= now.getTime()
    ) {
      return null
    }

    const claimed = await tx.soulPreparedPurchase.updateMany({
      where: {
        id: params.preparedPurchaseId,
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
        passOnChainId: true,
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
      passOnChainId: prepared.passOnChainId,
      agentAddress: prepared.agentAddress,
      amountUsdc: parseAtomicUsdcString(serializeAtomicUsdcAmount(prepared.amountUsdc) ?? '0'),
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
  db?: PreparedPurchaseDbClient
}): Promise<void> {
  const db = params.db ?? prisma
  await db.soulPreparedPurchase.update({
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
