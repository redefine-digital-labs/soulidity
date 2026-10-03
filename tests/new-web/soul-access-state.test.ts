import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { readSoulAccessState, prepareSoulAccessPlan, selectSoulAccessPaymentCoins, readSoulAccessPaymentCoin,
  SoulAccessCoinBcs } from '../../web/lib/soulidity/soul-access-operation'
import { soulAccessRawFixture } from './fixtures/soul-access-raw'
import { accessId, soulAccessTransactionFixture } from './fixtures/soul-access-transaction'

afterEach(() => vi.restoreAllMocks())
describe('Soul access raw observation and coin authority', () => {
  it('reads raw owner grants, exact buyer table and typed MarketConfigV2 without account APIs', async () => {
    const f = soulAccessRawFixture(), state = await readSoulAccessState({ ...f.params, kind: 3, granteeAddress: f.raw.grantSlot.grantee })
    expect(state.snapshot.currentOwner).toBe(f.params.author); expect(state.snapshot.grants).toHaveLength(1)
    expect(state.snapshot.paidAccessEntries).toHaveLength(2); expect(state.buyerTableBcs).not.toBeNull()
    expect(Object.isFrozen(state)).toBe(true)
    const plan = await prepareSoulAccessPlan({ ...f.params, request: { action: 'grant-issue', granteeAddress: f.raw.grantSlot.grantee, scopeMask: 4, expiresAtMs: '3000' } })
    expect(plan.quote.scopeMask).toBe(13); expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('rejects wrong roots, package family and incorrect market version', async () => {
    const f = soulAccessRawFixture()
    await expect(readSoulAccessState({ ...f.params, stateId: accessId(99999) })).rejects.toThrow('ROOT_POINTER_MISMATCH')
    f.packageRow.package.typeOrigins[0].packageId = accessId(99999)
    await expect(readSoulAccessState(f.params)).rejects.toThrow('PACKAGE_TYPE_ORIGIN_MISMATCH')
    f.packageRow.package.typeOrigins[0].packageId = f.deployment.originalPackageId; f.market.version = '1'
    await expect(readSoulAccessState(f.params)).rejects.toThrow('RAW_SNAPSHOT_MISMATCH')
  })
  it('prepares owner paid config and purchase against raw read + verified coins only', async () => {
    const f = soulAccessRawFixture()
    const update = await prepareSoulAccessPlan({ ...f.params, request: { action: 'paid-update', kind: 3, priceAtomic: '9007199254740993', durationMs: '0' } })
    expect(update.quote.priceAtomic).toBe('9007199254740993')
    f.raw.paidConfig.price_atomic = '10001'; f.raw.paidConfig.duration_ms = '3000'; f.raw.putPaidConfig()
    const author = f.raw.grantSlot.grantee, id = accessId(8800)
    f.extras.set(id, { objectId: id, objectType: normalizeStructTag(`0x2::coin::Coin<${f.deployment.paymentCoinType}>`),
      version: 7n, digest: toBase58(new Uint8Array(32).fill(4)), owner: { kind: 1, address: author },
      contents: { value: SoulAccessCoinBcs.serialize({ id, balance: '20000' }).toBytes() } })
    f.listOwned.mockResolvedValue({ response: { objects: [{ objectId: id }] } } as never)
    const purchase = await prepareSoulAccessPlan({ ...f.params, author, request: { action: 'paid-purchase', kind: 3, renew: true } })
    expect(purchase.quote.totalAtomic).toBe('10252'); expect(purchase.input.paymentCoins[0].version).toBe('7')
    expect(f.raw.execute).not.toHaveBeenCalled()
  })
  it('coin read rejects wrong custody, currency and malformed content', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase' }), coin = f.plan.input.paymentCoins[0]
    const params = { client: f.client as never, author: f.author, paymentCoinType: f.deployment.paymentCoinType, objectId: coin.objectId }
    expect(await readSoulAccessPaymentCoin(params)).toEqual(coin)
    const row = f.rows.get(`${coin.objectId}:11`), oldType = row.objectType
    row.owner.address = accessId(7777); await expect(readSoulAccessPaymentCoin(params)).rejects.toThrow('CURRENT_OBJECT_MISMATCH')
    row.owner.address = f.author; row.objectType = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
    await expect(readSoulAccessPaymentCoin(params)).rejects.toThrow('CURRENT_OBJECT_MISMATCH')
    row.objectType = oldType; row.contents.value = new Uint8Array([...row.contents.value, 0])
    await expect(readSoulAccessPaymentCoin(params)).rejects.toThrow('NONCANONICAL_BCS')
  })
  it('bounded coin discovery skips zero, verifies hints, and rejects duplicate/cursor loops', async () => {
    const f = soulAccessRawFixture(), author = f.params.author
    for (const [i, balance] of ['0', '6000', '7000'].entries()) {
      const id = accessId(8800 + i)
      f.extras.set(id, { objectId: id, objectType: normalizeStructTag(`0x2::coin::Coin<${f.deployment.paymentCoinType}>`), version: 1n,
        digest: toBase58(new Uint8Array(32).fill(i + 3)), owner: { kind: 1, address: author }, contents: { value: SoulAccessCoinBcs.serialize({ id, balance }).toBytes() } })
    }
    const input = { client: f.client, author, deployment: f.deployment, totalAtomic: '10000' }
    f.listOwned.mockResolvedValueOnce({ response: { objects: [0, 1, 2].map(i => ({ objectId: accessId(8800 + i) })) } } as never)
    expect((await selectSoulAccessPaymentCoins(input)).map(c => c.balance)).toEqual(['7000', '6000'])
    f.listOwned.mockResolvedValueOnce({ response: { objects: [{ objectId: accessId(8800) }, { objectId: accessId(8800) }] } } as never)
    await expect(selectSoulAccessPaymentCoins(input)).rejects.toThrow('PAYMENT_DISCOVERY_DUPLICATE')
    f.listOwned.mockResolvedValue({ response: { objects: [], nextPageToken: new Uint8Array([1]) } } as never)
    await expect(selectSoulAccessPaymentCoins(input)).rejects.toThrow('PAYMENT_DISCOVERY_CURSOR')
  })
})
