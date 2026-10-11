import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { PrismaRuntime, type Prisma } from '@db/prisma-client'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { prisma } from '@/lib/prisma'
import { NativeReceiveError } from './native-receive'
import { createNativeAgentPurchaseServices } from './native-agent-purchase-services'
import { validateMarketCancelCheckpoint } from './market-cancel-checkpoint'
import { marketBuyCanonical, marketBuyCheck, marketBuyId, validateMarketBuyOperationRecord,
  validateMarketBuySnapshot, type MarketBuyOperationRecord } from './market-buy-operation'

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const HASH = (bytes: string) => createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex')
type SoulPreparedPurchase = Prisma.SoulPreparedPurchaseGetPayload<Record<string, never>>

/** Bytes returned to an external agent may already be signed. Reuse the saved
 * intent until exact ledger evidence or checkpoint retirement makes it terminal. */
export async function prepareNativeAgentPurchase(params: {
  request: Request
  soul: { onChainId: string; stateOnChainId: string; listingObjectOnChainId: string | null }
  agentMemberId: string
  buyer: string
}) {
  const { request, soul, agentMemberId, buyer } = params
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)])
  const scope = { soulId: soul.onChainId, stateId: soul.stateOnChainId,
    listingId: soul.listingObjectOnChainId, buyer }
  const fail = (code: string, status = 409) => { throw new NativeReceiveError(code, code, status) }
  const validateRow = (row: SoulPreparedPurchase) => {
    const record = validateMarketBuyOperationRecord(row.nativeOperation)
    const s = record.snapshot
    const quote = quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic), s)
    marketBuyCheck(row.agentMemberId === agentMemberId && row.agentAddress === buyer
      && row.soulOnChainId === soul.onChainId && s.soulId === soul.onChainId
      && s.stateId === soul.stateOnChainId && s.buyer === buyer
      && row.listingObjectId === s.listingId && row.sellerKioskId === s.sellerKioskId
      && row.priceAtomic.toString() === s.priceAtomic && row.totalAtomic.toString() === s.priceAtomic
      && row.platformFeeAtomic.toString() === quote.protocolFeeAtomic.toString()
      && row.creatorRoyaltyAtomic.toString() === quote.soulCreatorRoyaltyAtomic.toString()
      && row.txBytesBase64 === record.bytes && row.txBytesHash === HASH(record.bytes)
      && (!row.executionTxDigest || row.executionTxDigest === record.digest)
      && Number.isSafeInteger(row.operationRevision) && row.operationRevision >= 0,
    'Saved native purchase scope or bytes mismatch')
    return record
  }
  const response = (row: SoulPreparedPurchase, recoveryRequired: boolean) => {
    const record = validateRow(row), s = record.snapshot
    const quote = quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic), s)
    return NextResponse.json({ preparedPurchaseId: row.id, txBytes: record.bytes,
      context: { soulOnChainId: s.soulId, listingObjectId: s.listingId,
        sellerKioskId: s.sellerKioskId, priceAtomic: s.priceAtomic,
        platformFeeAtomic: quote.protocolFeeAtomic.toString(),
        creatorRoyaltyAtomic: quote.soulCreatorRoyaltyAtomic.toString(),
        makerRoyaltyAtomic: quote.makerSourceRoyaltyAtomic.toString(),
        sellerPayoutAtomic: quote.sellerPayoutAtomic.toString(),
        royaltySource: 'animacraft-maker', totalAtomic: s.priceAtomic, agentAddress: s.buyer,
        expiresAt: row.expiresAt.toISOString(), expirationEpoch: record.expirationEpoch,
        digest: record.digest, phase: record.phase, recoveryRequired,
      } }, { headers: HEADERS })
  }
  try {
    marketBuyCheck(marketBuyId(buyer) && marketBuyId(soul.onChainId) && marketBuyId(soul.stateOnChainId),
      'Canonical native purchase scope required')
    const result = await prisma.$transaction(async db => {
      // Transaction-scoped, nonblocking PostgreSQL lock; no network-long global
      // process mutex and no second active packet for the same Soul/buyer.
      const key = `native-agent-buy:${soul.onChainId}:${buyer}`
      const lock = await db.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
      `
      if (lock.length !== 1 || lock[0].locked !== true) fail('NATIVE_AGENT_PURCHASE_BUSY')
      signal.throwIfAborted()
      const latest = await db.soulPreparedPurchase.findFirst({
        where: { soulOnChainId: soul.onChainId, agentAddress: buyer,
          nativeOperation: { not: PrismaRuntime.DbNull } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      if (latest) {
        if (latest.agentMemberId !== agentMemberId) fail('NATIVE_AGENT_PURCHASE_OTHER_AGENT_PENDING')
        const previous = validateRow(latest)
        if (['PREPARED', 'SIGNING', 'SIGNED', 'CANCELLED'].includes(previous.phase)) {
          // CANCELLED is not evidence that externally exposed bytes were never
          // signed. The execute/recovery endpoint must resolve it explicitly.
          return { row: latest, recoveryRequired: true }
        }
        const previousAdapter = createNativeAgentPurchaseServices(scope, signal).adapter
        const state = await previousAdapter.query(previous)
        if (previous.phase === 'RETIRED' && state === 'MISSING') {
          // The saved checkpoint is immutable history; recheck the ledger before
          // replacing its active pointer rather than assuming it never executed.
          validateMarketCancelCheckpoint(await previousAdapter.expiryCheckpoint(previous), previous.expirationEpoch)
        } else if (!['SUCCEEDED', 'FAILED'].includes(state)
          || previous.phase !== 'RETIRED' && state !== previous.phase) {
          fail('NATIVE_AGENT_PURCHASE_RECOVERY_REQUIRED')
        }
      }
      const observed = validateMarketBuySnapshot(await createNativeAgentPurchaseServices(scope, signal).read())
      marketBuyCheck(observed.soulId === scope.soulId && observed.stateId === scope.stateId
        && observed.buyer === buyer && observed.purchaseAvailable && observed.release.writesEnabled,
      'Native agent purchase is unavailable or signing disabled')
      const { adapter } = createNativeAgentPurchaseServices(scope, signal, observed)
      const prepared = validateMarketBuyOperationRecord(await adapter.prepare())
      marketBuyCheck(prepared.phase === 'PREPARED' && prepared.signature === null
        && marketBuyCanonical(prepared.snapshot) === marketBuyCanonical(observed),
      'Prepared native purchase differs from the verified quote')
      await adapter.preflight(prepared, true)
      signal.throwIfAborted()
      const record: MarketBuyOperationRecord = validateMarketBuyOperationRecord({ ...prepared, phase: 'SIGNING' })
      const quote = quoteAnimacraftV8SoulSale(BigInt(record.snapshot.priceAtomic), record.snapshot)
      const row = await db.soulPreparedPurchase.create({ data: {
        agentMemberId, soulOnChainId: record.snapshot.soulId,
        listingObjectId: record.snapshot.listingId, sellerKioskId: record.snapshot.sellerKioskId,
        agentAddress: buyer, priceAtomic: record.snapshot.priceAtomic,
        platformFeeAtomic: quote.protocolFeeAtomic.toString(),
        creatorRoyaltyAtomic: quote.soulCreatorRoyaltyAtomic.toString(), totalAtomic: record.snapshot.priceAtomic,
        txBytesBase64: record.bytes, txBytesHash: HASH(record.bytes),
        nativeOperation: record as unknown as Prisma.InputJsonValue, operationRevision: 0,
        // Informational API freshness only, never proof of transaction expiry.
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      } })
      validateRow(row)
      return { row, recoveryRequired: false }
    }, { maxWait: 1000, timeout: 30000 })
    signal.throwIfAborted()
    return response(result.row, result.recoveryRequired)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      // The failed SQL transaction is rolled back. Never query/update within an
      // aborted transaction or extend a prior packet's lifetime; retry reads it.
      return NextResponse.json({ code: 'NATIVE_AGENT_PURCHASE_RECOVERY_REQUIRED' }, { status: 409, headers: HEADERS })
    }
    return NextResponse.json({ code: error instanceof NativeReceiveError ? error.code : 'NATIVE_AGENT_PURCHASE_UNAVAILABLE' },
      { status: error instanceof NativeReceiveError ? error.status : 503, headers: HEADERS })
  }
}
