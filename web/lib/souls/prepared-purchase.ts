import { createHash } from 'node:crypto'
import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { sameSuiValue } from '@web/lib/souls/on-chain-verification'
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
  soulOnChainId: string
  sellerKioskId: string
  agentAddress: string
  priceSui: bigint
  txBytesBase64: string
}): Promise<{ id: string; expiresAt: Date }> {
  if (Buffer.byteLength(params.txBytesBase64, 'utf8') > MAX_PREPARED_TX_BYTES_BASE64) {
    throw new Error('Prepared purchase txBytesBase64 exceeds the size limit')
  }

  cleanupExpiredPreparedPurchases()

  const expiresAt = new Date(Date.now() + PREPARED_PURCHASE_TTL_MS)
  const txBytesHash = hashPreparedSoulPurchaseTxBytes(params.txBytesBase64)

  try {
    return await prisma.soulPreparedPurchase.create({
      data: {
        agentMemberId: params.agentMemberId,
        soulOnChainId: params.soulOnChainId,
        sellerKioskId: params.sellerKioskId,
        agentAddress: params.agentAddress,
        priceSui: params.priceSui.toString(),
        txBytesBase64: params.txBytesBase64,
        txBytesHash,
        expiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    })
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
            soulOnChainId: params.soulOnChainId,
            sellerKioskId: params.sellerKioskId,
            agentAddress: params.agentAddress,
            priceSui: params.priceSui.toString(),
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

      return existing
    }

    throw error
  }
}

export async function getPreparedSoulPurchaseForExecution(params: {
  preparedPurchaseId: string
  agentMemberId: string
  soulOnChainId: string
}): Promise<{
  id: string
  soulOnChainId: string
  sellerKioskId: string
  agentAddress: string
  priceSui: bigint
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
      soulOnChainId: true,
      sellerKioskId: true,
      agentAddress: true,
      priceSui: true,
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
    || !sameSuiValue(prepared.soulOnChainId, params.soulOnChainId)
    || (prepared.expiresAt.getTime() <= Date.now() && prepared.resultStatusCode == null)
  ) {
    return null
  }

  return {
    id: prepared.id,
    soulOnChainId: prepared.soulOnChainId,
    sellerKioskId: prepared.sellerKioskId,
    agentAddress: prepared.agentAddress,
    priceSui: BigInt(prepared.priceSui.toString()),
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
  soulOnChainId: string
}): Promise<{
  id: string
  soulOnChainId: string
  sellerKioskId: string
  agentAddress: string
  priceSui: bigint
  txBytesBase64: string
  txBytesHash: string
  executedAt: Date | null
  resultStatusCode: number | null
  resultBody: PreparedPurchaseResultBody | null
} | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.soulPreparedPurchase.findUnique({
      where: { id: params.preparedPurchaseId },
      select: {
        id: true,
        agentMemberId: true,
        soulOnChainId: true,
        executedAt: true,
        expiresAt: true,
      },
    })

    if (
      !current
      || current.agentMemberId !== params.agentMemberId
      || !sameSuiValue(current.soulOnChainId, params.soulOnChainId)
      || current.executedAt
      || current.expiresAt.getTime() <= Date.now()
    ) {
      return null
    }

    const claimResult = await tx.soulPreparedPurchase.updateMany({
      where: {
        id: current.id,
        executedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        executedAt: new Date(),
      },
    })

    if (claimResult.count === 0) {
      return null
    }

    const prepared = await tx.soulPreparedPurchase.findUnique({
      where: { id: params.preparedPurchaseId },
      select: {
        id: true,
        soulOnChainId: true,
        sellerKioskId: true,
        agentAddress: true,
        priceSui: true,
        txBytesBase64: true,
        txBytesHash: true,
        executedAt: true,
        resultStatusCode: true,
        resultBody: true,
      },
    })

    if (!prepared) {
      return null
    }

    return {
      id: prepared.id,
      soulOnChainId: prepared.soulOnChainId,
      sellerKioskId: prepared.sellerKioskId,
      agentAddress: prepared.agentAddress,
      priceSui: BigInt(prepared.priceSui.toString()),
      txBytesBase64: prepared.txBytesBase64,
      txBytesHash: prepared.txBytesHash,
      executedAt: prepared.executedAt,
      resultStatusCode: prepared.resultStatusCode,
      resultBody: prepared.resultBody as PreparedPurchaseResultBody | null,
    }
  })
}

export async function releasePreparedSoulPurchaseExecution(params: {
  preparedPurchaseId: string
  db?: PreparedPurchaseDbClient
}): Promise<void> {
  const db = params.db ?? prisma
  await db.soulPreparedPurchase.updateMany({
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

export async function finalizePreparedSoulPurchaseExecution(params: {
  preparedPurchaseId: string
  txDigest: string
  resultStatusCode: number
  resultBody: PreparedPurchaseResultBody
  db?: PreparedPurchaseDbClient
}): Promise<void> {
  const db = params.db ?? prisma
  await db.soulPreparedPurchase.updateMany({
    where: {
      id: params.preparedPurchaseId,
    },
    data: {
      executedAt: new Date(),
      executionTxDigest: params.txDigest,
      resultStatusCode: params.resultStatusCode,
      resultBody: params.resultBody as Prisma.InputJsonValue,
    },
  })
}
