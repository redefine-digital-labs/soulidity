import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulStatePublicBcs, SoulDetailStateBcs as D, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { createSoulAccessPlan, buildSoulAccessTransaction, parseSoulAccessPlan, parseSoulAccessRecord, assertSoulAccessAuthority,
  soulAccessPurchaseExpiry, type SoulAccessAction } from '../../web/lib/soulidity/soul-access-operation'
import { soulAccessFixtureState, soulAccessTransactionFixture, accessId } from './fixtures/soul-access-transaction'

afterEach(() => vi.restoreAllMocks())
const actions: SoulAccessAction[] = ['grant-issue', 'grant-revoke', 'grant-revoke-scope', 'paid-configure', 'paid-update', 'paid-delete', 'paid-purchase', 'paid-revoke']
describe('Soul access exact packet and historical transitions', () => {
  it.each(actions)('%s builds exact SDK bytes and proves historical output without current wallet/state', async action => {
    const f = await soulAccessTransactionFixture({ action })
    expect(parseSoulAccessRecord(f.record).packet.digest).toBe(f.record.packet.digest)
    await f.adapter.verifySignature(f.record)
    f.setAddress(null); f.read.mockRejectedValue(new Error('Current state must not be consulted'))
    const result = await f.adapter.query(f.record)
    expect(result.status).toBe('SUCCEEDED'); expect(result.checkpoint).toBe('42')
    expect(f.read).not.toHaveBeenCalled(); expect(f.getAddress).not.toHaveBeenCalled()
    expect(f.client.ledgerService.getObject.mock.calls.every(([request]) => request.version !== undefined)).toBe(true)
  })
  it.each(['absent', 'expired', 'stale'] as const)('grant issue replaces %s slot with correct count', async slot => {
    const f = await soulAccessTransactionFixture({ slot })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
    expect(f.plan.quote.scopeMask).toBe(4)
  })
  it.each(['absent', 'expired', 'stale'] as const)('purchase %s entry uses executed Clock and explicit renewal semantics', async entry => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase', entry })
    expect(f.plan.input.renew).toBe(entry === 'expired')
    expect((await f.adapter.query(f.record)).expiresAtMs).toBe('4100')
  })
  it('retains live finite expiry when renewing and accepts zero fee / zero duration', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase', duration: '0', feeBps: 0 })
    expect(f.plan.quote.feeAtomic).toBe('0'); expect((await f.adapter.query(f.record)).expiresAtMs).toBe('2000')
    expect(f.effects.V2!.changedObjects.some(([id]) => id === f.ids.buyer || id === f.ids.entry)).toBe(false)
  })
  it('proves a no-op paid update from exact asserted before bytes and absent child writes', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-update', price: '777', duration: '5000' })
    expect(f.effects.V2!.changedObjects.some(([id]) => id === f.ids.config)).toBe(false)
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it.each(['entry', 'buyer', 'config'])('does not treat a missing genuinely changed %s row as unchanged', async label => {
    const f = await soulAccessTransactionFixture({ action: label === 'config' ? 'paid-update' : 'paid-purchase', entry: 'absent' })
    f.effects.V2!.changedObjects = f.effects.V2!.changedObjects.filter(([id]) => id !== f.ids[label])
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
  it('revokes an entry while retaining other kinds in its buyer table', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-revoke', buyerSize: '2' })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
  })
  it('requires nested Table UID destruction when revoking its last entry', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-revoke' })
    expect((await f.adapter.query(f.record)).status).toBe('SUCCEEDED')
    expect(f.client.ledgerService.getObject.mock.calls.some(([request]) => request.objectId === f.ids.nestedTable)).toBe(false)
    f.change('nestedTable').idOperation = { $kind: 'None', None: true }
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_NESTED_TABLE_DELETION')
    f.effects.V2!.changedObjects = f.effects.V2!.changedObjects.filter(([id]) => id !== f.ids.nestedTable)
    await expect(f.adapter.query(f.record)).rejects.toThrow('HISTORY_CHANGE_MISSING')
  })
  it('queries missing / pending / chain failure without output proof', async () => {
    const f = await soulAccessTransactionFixture()
    f.setCheckpoint(undefined); expect((await f.adapter.query(f.record)).status).toBe('PENDING')
    f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
    expect((await f.adapter.query(f.record)).status).toBe('MISSING')
    f.setCheckpoint(42n); f.effects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
      ...f.effects.V2!, status: { Failure: { error: { InsufficientGas: true }, command: null } },
    } }).toBytes()).V2!.status
    expect((await f.adapter.query(f.record)).status).toBe('FAILED')
    expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
  })
  it('prepare/sign/broadcast recheck authority and broadcast only the stored signature bytes', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase' })
    const prepared = await f.adapter.prepare(f.plan)
    const signed = await f.adapter.sign(prepared)
    const record = { ...prepared, packet: { ...prepared.packet, phase: 'SIGNED' as const, signature: signed.signature } }
    await f.adapter.broadcast(record)
    expect(toBase64(f.client.core.executeTransaction.mock.calls[0][0].transaction)).toBe(prepared.packet.bytes)
    expect(f.client.core.executeTransaction.mock.calls[0][0].signatures).toEqual([signed.signature])
    f.setAddress(null); await expect(f.adapter.sign(prepared)).rejects.toThrow('WALLET_CHANGED')
  })
  it('rejects wallet byte replacement, changed fees, changed coin references and epoch expiration before sending', async () => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase' })
    const prepared = await f.adapter.prepare(f.plan)
    f.sign.mockResolvedValueOnce({ bytes: toBase64(new Uint8Array([1])), signature: f.record.packet.signature! })
    await expect(f.adapter.sign(prepared)).rejects.toThrow('WALLET_CHANGED_BYTES')
    const market = SoulPublicMarketConfigBcs.parse(fromBase64(f.observed.marketConfigBcs)); market.platform_fee_bps++
    f.read.mockResolvedValueOnce({ ...f.observed, marketConfigBcs: SoulPublicMarketConfigBcs.serialize(market).toBase64() })
    await expect(f.adapter.sign(prepared)).rejects.toThrow('TARGET_CHANGED')
    f.rows.get(`${f.plan.input.paymentCoins[0].objectId}:11`).version = 12n
    await expect(f.adapter.sign(prepared)).rejects.toThrow('PAYMENT_CHANGED')
    f.rows.get(`${f.plan.input.paymentCoins[0].objectId}:11`).version = 11n
    f.client.ledgerService.getEpoch.mockResolvedValueOnce({ response: { epoch: { epoch: 11n } } })
    await expect(f.adapter.sign(prepared)).rejects.toThrow('EXPIRED_QUERY_ONLY')
    f.client.ledgerService.getEpoch.mockResolvedValueOnce({ response: { epoch: { epoch: 8n } } })
    await expect(f.adapter.sign(prepared)).rejects.toThrow('EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
  it('rejects malicious PTB arguments or extra commands even when metadata is intact', async () => {
    const f = await soulAccessTransactionFixture()
    const extra = await f.packet(f.plan, data => { data.commands.push(structuredClone(data.commands[0])) })
    expect(() => parseSoulAccessRecord(extra)).toThrow('TEMPLATE_MISMATCH')
    const changed = await f.packet(f.plan, data => { const pure = data.inputs.find(row => row.Pure)!; pure.Pure!.bytes = bcs.u64().serialize(123).toBase64() })
    expect(() => parseSoulAccessRecord(changed)).toThrow('PURE_ARGUMENT_MISMATCH')
    const wrongMutable = await f.packet(f.plan, data => { data.inputs.find(row => row.Object?.SharedObject)!.Object!.SharedObject!.mutable = false })
    expect(() => parseSoulAccessRecord(wrongMutable)).toThrow('SHARED_REFERENCE_MISMATCH')
  })
  it.each([
    ['slot', (v: any) => { v.value.scope_mask = '15' }],
    ['grant', (v: any) => { v.soul_id = accessId(99999) }],
    ['newReverse', (v: any) => { v.value = accessId(99999) }],
    ['state', (v: any) => { v.active_grant_count = '2' }],
  ] as const)('rejects validly rehashed wrong grant %s output', async (label, mutate) => {
    const f = await soulAccessTransactionFixture(); f.rewrite(label, mutate)
    await expect(f.adapter.query(f.record)).rejects.toThrow('SOUL_ACCESS_HISTORY_')
  })
  it.each([
    ['entry', (v: any) => { v.value.expires_at_ms = '9999' }],
    ['buyer', (v: any) => { v.value.size = '2' }],
    ['paid', (v: any) => { v.entries.size = '7' }],
    ['price', (v: any) => { v.balance = '10000' }],
    ['fee', (v: any) => { v.balance = '250' }],
    ['coin0', (v: any) => { v.balance = '20000' }],
  ] as const)('rejects validly rehashed wrong paid %s output', async (label, mutate) => {
    const f = await soulAccessTransactionFixture({ action: 'paid-purchase', ...(label === 'buyer' ? { entry: 'absent' as const } : {}) }); f.rewrite(label, mutate)
    await expect(f.adapter.query(f.record)).rejects.toThrow('SOUL_ACCESS_HISTORY_')
  })
  it('rejects forged bytes with copied digest, missing deletion, unexpected writes and wrong readonly market', async () => {
    const f = await soulAccessTransactionFixture()
    const row = f.rows.get(`${f.ids.grant}:12`); row.bcs.value[40] ^= 1
    await expect(f.adapter.query(f.record)).rejects.toThrow()
    const g = await soulAccessTransactionFixture(); g.effects.V2!.changedObjects = g.effects.V2!.changedObjects.filter(([id]) => id !== g.ids.oldReverse)
    await expect(g.adapter.query(g.record)).rejects.toThrow('HISTORY_CHANGE_MISSING')
    const h = await soulAccessTransactionFixture(); h.add('extra', accessId(9999), `${h.deployment.originalPackageId}::grant::SoulGrant`, D.Grant,
      null, { id: accessId(9999), version: '1', soul_id: h.plan.soulId, grantee: h.grantee, issued_by: h.author,
        ownership_epoch_snapshot: '2', scope_mask: '1', expires_at_ms: null }, { AddressOwner: h.grantee })
    await expect(h.adapter.query(h.record)).rejects.toThrow('HISTORY_UNEXPECTED_EFFECT')
    const p = await soulAccessTransactionFixture({ action: 'paid-purchase' }); p.rewrite('market', v => { v.platform_fee_bps = 500 }, '11')
    await expect(p.adapter.query(p.record)).rejects.toThrow('HISTORY_MARKET_CHANGED')
  })
})

describe('Soul access frozen quote', () => {
  it('unions only live scopes and counts expired same-epoch slots before replacement', () => {
    for (const slot of [undefined, 'expired', 'stale', 'absent'] as const) {
      const f = soulAccessFixtureState({ slot }); f.state.grant_capacity = f.state.active_grant_count
      f.observed.stateBcs = SoulStatePublicBcs.serialize(f.state).toBase64()
      const p = createSoulAccessPlan({ state: f.observed, request: f.request })
      expect(p.quote.scopeMask).toBe(slot === undefined ? 13 : 4); expect(p.quote.capacity).toBe('1')
      expect(Object.isFrozen(p.input)).toBe(true)
    }
  })
  it('supports exact u64 amounts, catches overflow, rejects implicit renew and lifetime repurchase', () => {
    expect(soulAccessPurchaseExpiry('0', null, '1000')).toBe('1000')
    expect(soulAccessPurchaseExpiry('9007199254740993', null, '1000')).toBe('9007199254741993')
    expect(() => soulAccessPurchaseExpiry('18446744073709551615', null, '1')).toThrow('EXPIRY_OVERFLOW')
    const f = soulAccessFixtureState({ action: 'paid-purchase' }); f.request.renew = false
    expect(() => createSoulAccessPlan({ state: f.observed, request: f.request })).toThrow('EXPLICIT_RENEWAL_REQUIRED')
    const g = soulAccessFixtureState({ action: 'paid-purchase', entry: 'lifetime' })
    expect(() => createSoulAccessPlan({ state: g.observed, request: g.request })).toThrow('ALREADY_HAS_LIFETIME_ACCESS')
  })
  it('rejects quote and persisted expected-slot tampering', async () => {
    const f = await soulAccessTransactionFixture(), p = structuredClone(f.plan); p.quote.scopeMask = 4
    expect(() => parseSoulAccessPlan(p)).toThrow('QUOTE_MISMATCH')
    const slot = D.GrantSlot.parse(fromBase64(p.expected.grantSlotBcs!)); slot.grantee = accessId(999)
    p.expected.grantSlotBcs = D.GrantSlot.serialize(slot).toBase64()
    expect(() => parseSoulAccessPlan(p)).toThrow('GRANT_SLOT_INVALID')
  })
  it('allows unrelated state changes but rejects target/counter drift', async () => {
    const f = await soulAccessTransactionFixture(), changed = structuredClone(f.observed)
    const raw = SoulStatePublicBcs.parse(fromBase64(changed.stateBcs)); raw.is_listed = true; changed.stateBcs = SoulStatePublicBcs.serialize(raw).toBase64()
    expect(() => assertSoulAccessAuthority(f.plan, changed)).not.toThrow()
    changed.snapshot.activeGrantCount = '2'
    expect(() => assertSoulAccessAuthority(f.plan, changed)).toThrow('GRANT_COUNTS_CHANGED')
  })
})
