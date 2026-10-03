import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bid, marketBuyFixture } from './fixtures/market-buy-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { validateMarketBuyOperationRecord, type MarketBuyOperationRecord } from '../../web/lib/animacraft/market-buy-operation'
import { NativeReceiveError } from '../../web/lib/animacraft/native-receive'

// Only HTTP auth/repository, persistence and the RPC service boundary are mocked.
// The journal validator and SDK-built TransactionData bytes remain real.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), soul: vi.fn(), services: vi.fn(), read: vi.fn(),
  prepare: vi.fn(), preflight: vi.fn(), query: vi.fn(), expiryCheckpoint: vi.fn(),
  sign: vi.fn(), broadcast: vi.fn(), sync: vi.fn(), env: vi.fn(), config: vi.fn(),
  ordinaryQuote: vi.fn(), ordinaryBuilder: vi.fn(), coins: vi.fn(), kiosk: vi.fn(),
  transaction: vi.fn(), lock: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
}))
vi.mock('@/lib/soulidity/agent-server', () => ({ requireAgentWalletIdentity: mocks.auth }))
vi.mock('@web/lib/rate-limit', () => ({ takeRateLimitToken: mocks.rate }))
vi.mock('@/lib/soulidity/repository', () => ({ findSoulAssetDetailByRouteId: mocks.soul }))
vi.mock('@/lib/animacraft/native-agent-purchase-services', () => ({ createNativeAgentPurchaseServices: mocks.services }))
vi.mock('@web/lib/prisma', () => ({ prisma: {
  $transaction: mocks.transaction,
  soulPreparedPurchase: { findFirst: mocks.findFirst, create: mocks.create, findUnique: mocks.findUnique, update: mocks.update },
} }))
vi.mock('@soulidity/sdk/coin-selection', () => ({ selectCoinObjectIdsForAmountAcrossPages: mocks.coins }))
vi.mock('@soulidity/sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@soulidity/sdk')>(),
  suiClient: {}, getRequiredSoulidityEnv: mocks.env, getMarketConfigV2: mocks.config,
  quoteSoulPurchase: mocks.ordinaryQuote, buildBuySoulTx: mocks.ordinaryBuilder,
  resolveOwnedPersonalKiosk: mocks.kiosk,
}))

const NOW = new Date('2026-09-06T12:00:00.000Z')
const PREPARED_ID = '550e8400-e29b-41d4-a716-446655440000'
let fixture: Awaited<ReturnType<typeof marketBuyFixture>>
const tx = { $queryRaw: mocks.lock, soulPreparedPurchase: {
  findFirst: mocks.findFirst, create: mocks.create, findUnique: mocks.findUnique, update: mocks.update,
} }

function stored(record: MarketBuyOperationRecord = { ...fixture.record, phase: 'SIGNING' }) {
  return {
    id: PREPARED_ID, agentMemberId: 'agent-1', soulOnChainId: record.snapshot.soulId,
    listingObjectId: record.snapshot.listingId, sellerKioskId: record.snapshot.sellerKioskId,
    agentAddress: record.snapshot.buyer, priceAtomic: record.snapshot.priceAtomic,
    platformFeeAtomic: '25000', creatorRoyaltyAtomic: '25000', totalAtomic: record.snapshot.priceAtomic,
    txBytesBase64: record.bytes, txBytesHash: createHash('sha256').update(Buffer.from(record.bytes, 'base64')).digest('hex'),
    nativeOperation: structuredClone(record), operationRevision: 0,
    expiresAt: new Date(NOW.getTime() + 600_000), executedAt: null, resultStatusCode: null,
    executionTxDigest: null, resultBody: null,
  }
}
async function callRoute(signal?: AbortSignal) {
  const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route')
  return POST(new Request(`http://localhost/api/agent/souls/${bid(12)}/purchase`, { method: 'POST', signal }),
    { params: Promise.resolve({ id: bid(12) }) })
}
function noNewTransaction() {
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.preflight).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
}
function noLegacy() {
  for (const fn of [mocks.env, mocks.config, mocks.ordinaryQuote, mocks.ordinaryBuilder, mocks.coins, mocks.kiosk]) {
    expect(fn).not.toHaveBeenCalled()
  }
  expect(mocks.sign).not.toHaveBeenCalled()
  expect(mocks.broadcast).not.toHaveBeenCalled()
}

describe('native agent purchase preparation: exact bytes and durable exposure', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    fixture = await marketBuyFixture()
    expect(validateMarketBuyOperationRecord(fixture.record)).toEqual(fixture.record)
    mocks.auth.mockResolvedValue({ agent: { agentMemberId: 'agent-1' }, walletAddresses: [fixture.snapshot.buyer] })
    mocks.rate.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mocks.soul.mockResolvedValue({ onChainId: fixture.snapshot.soulId, stateOnChainId: fixture.snapshot.stateId,
      provenanceKind: 'animacraft', listingStatus: 'held', listingObjectOnChainId: null,
      listedPriceAtomic: null, currentKioskId: bid(999), creatorRoyaltyBps: 0, collection: null, collectionOnChainId: null })
    mocks.read.mockResolvedValue(structuredClone(fixture.snapshot))
    mocks.prepare.mockResolvedValue(structuredClone(fixture.record))
    mocks.preflight.mockResolvedValue(undefined)
    mocks.query.mockResolvedValue('MISSING')
    mocks.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture().evidence)
    mocks.services.mockReturnValue({ read: mocks.read, adapter: { prepare: mocks.prepare, preflight: mocks.preflight,
      query: mocks.query, expiryCheckpoint: mocks.expiryCheckpoint, sign: mocks.sign, broadcast: mocks.broadcast, sync: mocks.sync } })
    mocks.transaction.mockImplementation(async work => work(tx))
    mocks.lock.mockResolvedValue([{ locked: true }])
    mocks.findFirst.mockResolvedValue(null)
    mocks.findUnique.mockResolvedValue(null)
    mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: PREPARED_ID }))
    mocks.env.mockImplementation(() => { throw new Error('Native path must not load ambient legacy configuration') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('prepares from live native evidence despite held/empty DB cache, and persists SIGNING before exposing bytes', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ preparedPurchaseId: PREPARED_ID, txBytes: fixture.record.bytes,
      context: { soulOnChainId: fixture.snapshot.soulId, listingObjectId: fixture.snapshot.listingId,
        sellerKioskId: fixture.snapshot.sellerKioskId, agentAddress: fixture.snapshot.buyer,
        priceAtomic: '1000000', platformFeeAtomic: '25000', creatorRoyaltyAtomic: '25000', makerRoyaltyAtomic: '75000',
        sellerPayoutAtomic: '875000', totalAtomic: '1000000', digest: fixture.record.digest,
        expirationEpoch: '10', phase: 'SIGNING', recoveryRequired: false,
        expiresAt: new Date(NOW.getTime() + 600_000).toISOString() } })
    const data = mocks.create.mock.calls[0][0].data
    expect(data).toMatchObject({ agentMemberId: 'agent-1', soulOnChainId: fixture.snapshot.soulId,
      listingObjectId: fixture.snapshot.listingId, sellerKioskId: fixture.snapshot.sellerKioskId,
      agentAddress: fixture.snapshot.buyer, priceAtomic: '1000000', platformFeeAtomic: '25000',
      creatorRoyaltyAtomic: '25000', totalAtomic: '1000000', txBytesBase64: fixture.record.bytes,
      txBytesHash: stored().txBytesHash, operationRevision: 0,
      nativeOperation: { ...fixture.record, phase: 'SIGNING' } })
    expect(data.nativeOperation).toEqual(validateMarketBuyOperationRecord(data.nativeOperation))
    expect(mocks.preflight).toHaveBeenCalledTimes(1)
    expect(mocks.preflight).toHaveBeenCalledWith(fixture.record, true)
    expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0])
    expect(mocks.lock).toHaveBeenCalledTimes(1)
    expect(mocks.lock.mock.calls[0][1]).toBe(`native-agent-buy:${fixture.snapshot.soulId}:${fixture.snapshot.buyer}`)
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      soulOnChainId: fixture.snapshot.soulId, agentAddress: fixture.snapshot.buyer,
    }) }))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 1000, timeout: 30000 })
    noLegacy()
  })

  it('does not replace live price/listing/kiosk with stale nonempty DB hints', async () => {
    const old = await mocks.soul()
    mocks.soul.mockResolvedValue({ ...old, listingStatus: 'listed', listedPriceAtomic: '900000000', listingObjectOnChainId: bid(888) })
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect((await response.json()).context).toMatchObject({ priceAtomic: '1000000', listingObjectId: fixture.snapshot.listingId,
      sellerKioskId: fixture.snapshot.sellerKioskId, totalAtomic: '1000000' })
    noLegacy()
  })

  it.each([401, 403])('preserves auth failure %s without reading or storing', async status => {
    mocks.auth.mockResolvedValue({ error: Response.json({ error: 'Denied' }, { status }) })
    expect((await callRoute()).status).toBe(status)
    expect(mocks.soul).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); noNewTransaction()
  })
  it('preserves rate limiting and retry-after without entering a transaction', async () => {
    mocks.rate.mockReturnValue({ limited: true, retryAfterSeconds: 42 })
    const response = await callRoute()
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('42')
    expect(mocks.soul).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); noNewTransaction()
  })
  it('preserves not-found behavior', async () => {
    mocks.soul.mockResolvedValue(null)
    expect((await callRoute()).status).toBe(404); noNewTransaction()
  })
  it('refuses concurrent preparation when the database scope lock is occupied', async () => {
    mocks.lock.mockResolvedValue([{ locked: false }])
    expect((await callRoute()).status).toBe(409); expect(mocks.read).not.toHaveBeenCalled(); noNewTransaction()
  })
  it.each(['read', 'prepare', 'preflight'] as const)('does not persist or expose bytes when %s fails', async stage => {
    mocks[stage].mockRejectedValue(new NativeReceiveError('NATIVE_READ_SET_CHANGED', 'Retry verification', 409))
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks[stage]).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled(); noLegacy()
  })
  it.each(['writes', 'availability', 'soul', 'state', 'buyer'] as const)('rejects invalid observed %s before preparation', async field => {
    const snapshot = structuredClone(fixture.snapshot)
    if (field === 'writes') snapshot.release.writesEnabled = false
    else if (field === 'availability') snapshot.purchaseAvailable = false
    else if (field === 'soul') snapshot.soulId = bid(777)
    else if (field === 'state') snapshot.stateId = bid(777)
    else snapshot.buyer = bid(777)
    mocks.read.mockResolvedValue(snapshot)
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(await response.json()).not.toHaveProperty('txBytes'); noNewTransaction(); noLegacy()
  })
  it.each(['bytes', 'digest', 'price', 'state', 'buyer', 'writes', 'availability'] as const)('rejects malformed/substituted prepared %s with the real validator', async field => {
    const record = structuredClone(fixture.record)
    if (field === 'bytes') record.bytes = 'AQID'
    else if (field === 'digest') record.digest = fixture.snapshot.release.soulidityCallableDigest
    else if (field === 'price') record.snapshot.priceAtomic = '999999'
    else if (field === 'state') record.snapshot.stateId = bid(777)
    else if (field === 'buyer') record.snapshot.buyer = bid(777)
    else if (field === 'writes') record.snapshot.release.writesEnabled = false
    else record.snapshot.purchaseAvailable = false
    mocks.prepare.mockResolvedValue(record)
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks.preflight).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); noLegacy()
  })
  it.each(['creator', 'makerCreator', 'protocolFeeRecipient', 'ownershipEpoch'] as const)(
    'rejects a structurally valid prepared snapshot changing observed %s', async field => {
      const record = structuredClone(fixture.record)
      record.snapshot[field] = field === 'ownershipEpoch' ? '4' : bid(777)
      // These facts are not independent PTB inputs: snapshot equality must still
      // bind them to the previously observed on-chain quote.
      expect(validateMarketBuyOperationRecord(record)).toEqual(record)
      mocks.prepare.mockResolvedValue(record)
      const response = await callRoute()
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await response.json()).not.toHaveProperty('txBytes')
      expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.preflight).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })
  it.each(['SIGNING', 'SIGNED', 'FAILED'] as const)('does not expose an adapter-produced nonfresh %s record as a new prepare', async phase => {
    mocks.prepare.mockResolvedValue({ ...fixture.record, phase, signature: phase === 'SIGNED' ? 'external-signature' : null })
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.preflight).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([false, true])('reuses exposed in-flight bytes and original expiry, even when wall TTL expired=%s', async expired => {
    const existing = stored()
    if (expired) existing.expiresAt = new Date(NOW.getTime() - 1)
    mocks.findFirst.mockResolvedValue(existing)
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ preparedPurchaseId: existing.id, txBytes: existing.txBytesBase64,
      context: { recoveryRequired: true, expiresAt: existing.expiresAt.toISOString(), priceAtomic: existing.priceAtomic,
        listingObjectId: existing.listingObjectId, sellerKioskId: existing.sellerKioskId } })
    expect(mocks.read).not.toHaveBeenCalled(); noNewTransaction(); expect(mocks.update).not.toHaveBeenCalled(); noLegacy()
  })
  it.each(['soulOnChainId', 'agentAddress', 'listingObjectId', 'sellerKioskId', 'priceAtomic', 'txBytesBase64', 'txBytesHash'] as const)(
    'never exposes a corrupt or cross-scope saved row: %s', async field => {
      const existing = stored()
      existing[field] = field === 'priceAtomic' ? '9' : field === 'txBytesBase64' ? 'AQID' : field === 'txBytesHash' ? '0'.repeat(64) : bid(777)
      mocks.findFirst.mockResolvedValue(existing)
      const response = await callRoute()
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await response.json()).not.toHaveProperty('txBytes'); noNewTransaction(); expect(mocks.update).not.toHaveBeenCalled()
    })

  it('returns conflict on unique-byte race without querying or mutating inside the aborted SQL transaction', async () => {
    mocks.create.mockRejectedValue({ code: 'P2002' })
    const response = await callRoute()
    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ code: 'NATIVE_AGENT_PURCHASE_RECOVERY_REQUIRED' })
    expect(mocks.findUnique).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('retry after unique-byte race returns the winning row with unchanged expiry and fees', async () => {
    mocks.create.mockRejectedValueOnce({ code: 'P2002' })
    expect((await callRoute()).status).toBe(409)
    const winner = stored(); winner.expiresAt = new Date(NOW.getTime() - 1000)
    mocks.findFirst.mockResolvedValue(winner)
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ txBytes: winner.txBytesBase64, context: {
      recoveryRequired: true, expiresAt: winner.expiresAt.toISOString(), priceAtomic: '1000000',
      makerRoyaltyAtomic: '75000', totalAtomic: '1000000' } })
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('never gives another agent the same buyer scoped pending packet', async () => {
    mocks.findFirst.mockResolvedValue({ ...stored(), agentMemberId: 'other-agent' })
    const response = await callRoute()
    expect(response.status).toBe(409)
    expect(await response.json()).not.toHaveProperty('txBytes'); noNewTransaction()
  })
  it.each(['platformFeeAtomic', 'creatorRoyaltyAtomic', 'totalAtomic'] as const)('does not reuse saved economics with altered %s', async field => {
    const row = stored(); row[field] = '1'
    mocks.findFirst.mockResolvedValue(row)
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes'); noNewTransaction()
  })
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid saved operation revision %s', async operationRevision => {
    mocks.findFirst.mockResolvedValue({ ...stored(), operationRevision })
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes'); noNewTransaction()
  })
  it.each(['PREPARED', 'SIGNING', 'SIGNED', 'CANCELLED'] as const)('recovers externally exposed %s without treating local phase or TTL as absence proof', async phase => {
    const record: MarketBuyOperationRecord = { ...fixture.record, phase, signature: phase === 'SIGNED' ? 'saved-external-signature' : null }
    const row = stored(record); row.expiresAt = new Date(NOW.getTime() - 86400000)
    mocks.findFirst.mockResolvedValue(row)
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect((await response.json()).context).toMatchObject({ recoveryRequired: true, phase, expiresAt: row.expiresAt.toISOString() })
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); noNewTransaction()
  })
  it.each(['MISSING', 'PENDING', 'FAILED'] as const)('does not trust cached SUCCEEDED when actual query is %s', async state => {
    mocks.findFirst.mockResolvedValue(stored({ ...fixture.record, phase: 'SUCCEEDED', syncStatus: 'COMPLETE' }))
    mocks.query.mockResolvedValue(state)
    const response = await callRoute()
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.read).not.toHaveBeenCalled(); noNewTransaction()
  })
  it.each(['SUCCEEDED', 'FAILED'] as const)('requires matching historical proof before preparing after %s', async phase => {
    const previous: MarketBuyOperationRecord = { ...fixture.record, phase, ...(phase === 'SUCCEEDED' ? { syncStatus: 'COMPLETE' as const } : {}) }
    mocks.findFirst.mockResolvedValue(stored(previous)); mocks.query.mockResolvedValue(phase)
    const fresh = await marketBuyFixture({ balances: ['1100000'] })
    expect(fresh.record.digest).not.toBe(previous.digest)
    mocks.prepare.mockResolvedValue(fresh.record)
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(mocks.query).toHaveBeenCalledWith(previous)
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0])
    expect((await response.json()).txBytes).toBe(fresh.record.bytes)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('accepts checkpoint-validated retirement but never mutates the retired journal', async () => {
    const previous: MarketBuyOperationRecord = { ...fixture.record, phase: 'RETIRED', retirement: {
      priorPhase: 'SIGNING', checkpoint: marketCancelCheckpointFixture().evidence } }
    mocks.findFirst.mockResolvedValue(stored(previous))
    const fresh = await marketBuyFixture({ balances: ['1100000'] })
    mocks.prepare.mockResolvedValue(fresh.record)
    expect((await callRoute()).status).toBe(200)
    expect(mocks.query).toHaveBeenCalledWith(previous)
    expect(mocks.expiryCheckpoint).toHaveBeenCalledWith(previous)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each(['PENDING', 'checkpoint-error'] as const)('does not replace retired bytes when renewed evidence is %s', async result => {
    const previous: MarketBuyOperationRecord = { ...fixture.record, phase: 'RETIRED', retirement: {
      priorPhase: 'SIGNING', checkpoint: marketCancelCheckpointFixture().evidence } }
    mocks.findFirst.mockResolvedValue(stored(previous))
    if (result === 'PENDING') mocks.query.mockResolvedValue('PENDING')
    else mocks.expiryCheckpoint.mockRejectedValue(new Error('Checkpoint unavailable'))
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks.query).toHaveBeenCalledWith(previous); noNewTransaction()
  })
  it('rejects a renewed retirement checkpoint that does not exceed saved transaction expiration', async () => {
    const previous: MarketBuyOperationRecord = { ...fixture.record, phase: 'RETIRED', retirement: {
      priorPhase: 'SIGNING', checkpoint: marketCancelCheckpointFixture().evidence } }
    mocks.findFirst.mockResolvedValue(stored(previous))
    mocks.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture('10').evidence)
    const response = await callRoute()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes')
    expect(mocks.expiryCheckpoint).toHaveBeenCalledWith(previous); noNewTransaction()
  })
  it.each(['SUCCEEDED', 'FAILED'] as const)('permits a fresh packet after retired history is now proven %s without rewriting history', async state => {
    const previous: MarketBuyOperationRecord = { ...fixture.record, phase: 'RETIRED', retirement: {
      priorPhase: 'SIGNING', checkpoint: marketCancelCheckpointFixture().evidence } }
    mocks.findFirst.mockResolvedValue(stored(previous)); mocks.query.mockResolvedValue(state)
    const fresh = await marketBuyFixture({ balances: ['1100000'] })
    mocks.prepare.mockResolvedValue(fresh.record)
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect((await response.json()).txBytes).toBe(fresh.record.bytes)
    expect(mocks.query).toHaveBeenCalledWith(previous)
    expect(mocks.expiryCheckpoint).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('rejects fabricated retirement at the expiration epoch', async () => {
    mocks.findFirst.mockResolvedValue(stored({ ...fixture.record, phase: 'RETIRED', retirement: {
      priorPhase: 'SIGNING', checkpoint: marketCancelCheckpointFixture('10').evidence } }))
    expect((await callRoute()).status).toBeGreaterThanOrEqual(400)
    noNewTransaction()
  })
  it('does not return or store a packet after request abort during final preflight', async () => {
    const controller = new AbortController()
    mocks.preflight.mockImplementation(async () => { controller.abort() })
    const response = await callRoute(controller.signal)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty('txBytes'); expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.preflight).toHaveBeenCalledTimes(1)
  })
  it('does not expose exception internals or legacy-fallback on RPC failure', async () => {
    mocks.read.mockRejectedValue(new Error('secret-rpc-token: fixture-only-sensitive-detail'))
    const response = await callRoute()
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).not.toContain('secret-rpc-token')
    expect(mocks.read).toHaveBeenCalledTimes(1); noNewTransaction(); noLegacy()
  })
})
