import { afterEach, expect, it, vi } from 'vitest'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase58, toBase64 } from '@mysten/sui/utils'
import { deriveMintContentObjectId } from '../../packages/soulidity-sdk/src/index'
import { soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { createSoulAuthoringPacketParser, type SoulAuthoringPacketRecord, type SoulAuthoringStep } from '../../web/lib/soulidity/soul-authoring-packet'
import { runSoulAuthoringPacket, type SoulAuthoringPacketAdapter } from '../../web/lib/soulidity/soul-authoring-runner'
import type { SoulAuthoringPacketJournal } from '../../web/lib/soulidity/soul-authoring-journal'
import type { SoulAuthoringPreparation } from '../../web/lib/soulidity/soul-authoring-store'
import { assertPublicMutationTransition, publicMutationFrozen, type PublicMutationQuery } from '../../web/lib/sui/public-mutation-journal'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
const kiosk = { kind: 'EXISTING' as const, kioskId: id(80), capId: id(81) }
const register: SoulAuthoringStep = { kind: 'REGISTER', kiosk }
const mint = (...mintIndices: number[]): SoulAuthoringStep => ({ kind: 'MINT', chunk: {
  mintIndices, includePublicFiles: true, collectionObjectId: id(70), kiosk } })
// This isolates durable coordinator ordering. Real tx bytes/signatures and
// real encrypted preparation are used; business proofs/network are controlled.
async function fixture(emptyCover?: 'FILE' | 'URL') {
  const f = await soulAuthoringManifestFixture(r => {
    r.collection = { name: 'Two Souls', description: 'Ordered chunks', image: r.mints[0].image, extraRoyaltyBps: 0,
      tradeable: true, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }
    if (emptyCover) {
      if (emptyCover === 'FILE') r.collection.image = { kind: 'FILE', fileIndex: 0 }
      r.mints = []; return
    }
    const second = structuredClone(r.mints[0]); second.mintNonce = '7'.repeat(32)
    second.contentObjectId = deriveMintContentObjectId({ ...r.target, author: r.author, mintNonce: fromHex(second.mintNonce) })
    second.slots.forEach(s => { s.fileIndex += 2 }); r.mints.push(second)
  })
  const preparation: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', manifest: f.manifest, preparation: f.preparation }
  const domain = createSoulAuthoringPacketParser(preparation), events: string[] = []
  let head: SoulAuthoringPacketRecord | null = null, locked = false, attempt = 0
  const past: SoulAuthoringPacketRecord[] = [], results = new Map<string, PublicMutationQuery>()
  const store: SoulAuthoringPacketJournal = {
    exclusive: async (_key, work) => { if (locked) throw Error('BUSY'); locked = true; try { return await work() } finally { locked = false } },
    read: vi.fn(async () => { events.push('read'); return structuredClone(head) }),
    history: vi.fn(async () => structuredClone(past)),
    write: vi.fn(async (_key, value) => {
      if (!locked) throw Error('NO_LOCK'); const next = domain.parse(value)
      if (head) {
        if (publicMutationFrozen(head) === publicMutationFrozen(next)) assertPublicMutationTransition(head, next, 'TEST')
        else { if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(head.packet.phase)) throw Error('RECOVERY_REQUIRED'); past.push(head) }
      }
      head = structuredClone(next); events.push(`saved:${head.packet.phase}`)
    }),
  }
  const adapter: SoulAuthoringPacketAdapter = {
    prepare: vi.fn(async plan => {
      events.push('prepare'); const tx = new Transaction()
      tx.setSender(f.request.author); tx.setGasOwner(f.request.author); tx.setGasBudget(100000); tx.setGasPrice(1)
      tx.setGasPayment([{ objectId: id(900), version: '1', digest: toBase58(new Uint8Array(32).fill(9)) }]); tx.setExpiration({ Epoch: '10' })
      tx.moveCall({ target: `${f.request.target.callablePackageId}::test::controlled_packet`, arguments: [tx.pure.u64(++attempt)] })
      const bytes = await tx.build()
      return domain.parse({ schema: 'soulidity.soul-authoring-packet.v1', plan, packet: { bytes: toBase64(bytes),
        digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null } })
    }),
    query: vi.fn(async (r): Promise<PublicMutationQuery> => { events.push('query'); return structuredClone(results.get(r.packet.digest) ?? { status: 'MISSING' }) }),
    preflight: vi.fn(async () => { events.push('preflight') }),
    sign: vi.fn(async r => { events.push('sign'); return f.signer.signTransaction(fromBase64(r.packet.bytes)) }),
    verifySignature: vi.fn(async r => { if (!r.packet.signature || !await f.signer.getPublicKey().verifyTransaction(fromBase64(r.packet.bytes), r.packet.signature)) throw Error('BAD_SIGNATURE') }),
    broadcast: vi.fn(async r => { events.push('broadcast'); results.set(r.packet.digest, { status: 'SUCCEEDED', checkpoint: '12' }) }),
  }
  const lifetime = { signal: f.controller.signal, getAddress: f.params.wallet.getAddress, isCurrent: () => true }
  const run = (step: SoulAuthoringStep = register, options: Partial<Parameters<typeof runSoulAuthoringPacket>[0]> = {}) =>
    runSoulAuthoringPacket({ preparation, step, store, adapter, lifetime, ...options })
  return { ...f, preparation, domain, store, adapter, results, events, run, head: () => head, past, locked: () => locked }
}
it('persists every exact packet phase and readback before signing/broadcast; cold success does not resend', async () => {
  const f = await fixture(), result = await f.run()
  expect(result.status).toBe('SUCCEEDED'); expect(f.head()?.packet.phase).toBe('SUCCEEDED')
  expect(f.events.indexOf('saved:SIGNING')).toBeLessThan(f.events.indexOf('sign'))
  expect(f.events.indexOf('saved:SIGNED')).toBeLessThan(f.events.indexOf('broadcast'))
  await f.run(); expect(f.adapter.prepare).toHaveBeenCalledTimes(1); expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it('retirement preserves exact unsigned packet and proof, then explicit replacement archives it', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(Error('wallet interrupted'))
  await expect(f.run()).rejects.toThrow('wallet interrupted')
  const before = f.head()!, checkpoint = marketCancelCheckpointFixture('11').evidence
  f.adapter.retire = vi.fn(async record => ({ ...record, packet: { ...record.packet, phase: 'RETIRED' },
    retirement: { priorPhase: 'SIGNING', checkpoint } }))
  const retired = await f.run(register, { retireExpired: true, expectedPacket: before.packet })
  expect(retired.record.packet).toEqual({ ...before.packet, phase: 'RETIRED' })
  expect(retired.record.retirement?.checkpoint).toEqual(checkpoint)
  expect(f.adapter.prepare).toHaveBeenCalledOnce()
  await f.run(register, { startNew: true, expectedPacket: before.packet })
  expect(f.past[0].packet.phase).toBe('RETIRED')
  expect(f.past[0].retirement?.checkpoint).toEqual(checkpoint)
  expect(f.head()!.packet.digest).not.toBe(before.packet.digest)
})
it.each(['PENDING', 'SUCCEEDED', 'FAILED'] as const)('retirement cannot replace %s', async status => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(Error('interrupted'))
  await expect(f.run()).rejects.toThrow()
  f.results.set(f.head()!.packet.digest, { status, checkpoint: '12' })
  f.adapter.retire = vi.fn()
  await expect(f.run(register, { retireExpired: true })).rejects.toThrow('RETIREMENT_NOT_ALLOWED')
  expect(f.adapter.retire).not.toHaveBeenCalled(); expect(f.adapter.prepare).toHaveBeenCalledOnce()
})
it('retirement without domain evidence adapter is refused', async () => {
  const f = await fixture()
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(Error('interrupted'))
  await expect(f.run()).rejects.toThrow()
  await expect(f.run(register, { retireExpired: true })).rejects.toThrow('RETIREMENT_NOT_ALLOWED')
  expect(f.head()!.packet.phase).toBe('SIGNING')
})
it('rejected signature resumes the same bytes, never generates another packet', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockRejectedValueOnce(Error('rejected'))
  await expect(f.run()).rejects.toThrow('rejected')
  const bytes = f.head()!.packet.bytes; expect(f.head()?.packet.phase).toBe('SIGNING')
  await f.run(); expect(f.head()?.packet.bytes).toBe(bytes); expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
})
it('unknown broadcast is recovered by history query without another sign or send', async () => {
  const f = await fixture(); vi.mocked(f.adapter.broadcast).mockImplementationOnce(async r => {
    f.results.set(r.packet.digest, { status: 'SUCCEEDED', checkpoint: '12' }); throw Error('response lost')
  })
  await expect(f.run()).rejects.toThrow('response lost'); expect(f.head()?.packet.phase).toBe('SIGNED')
  await f.run(); expect(f.head()?.packet.phase).toBe('SUCCEEDED')
  expect(f.adapter.sign).toHaveBeenCalledTimes(1); expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'])('an asynchronous %s write failure prevents broadcast', async phase => {
  const f = await fixture(), write = f.store.write
  f.store.write = async (key, value) => { await Promise.resolve(); if (value.packet.phase === phase) throw Error('disk failed'); await write(key, value) }
  await expect(f.run()).rejects.toThrow('disk failed'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  if (phase !== 'SIGNED') expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('does not unlock or broadcast while an uncancellable durable write is delayed beyond a network timeout', async () => {
  const f = await fixture(), write = f.store.write
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  f.store.write = async (key, value) => { if (value.packet.phase === 'SIGNED') { entered(); await gate } await write(key, value) }
  const pending = f.run(); await reached
  vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(31000)
  expect(f.locked()).toBe(true); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  await expect(f.run()).rejects.toThrow('BUSY')
  vi.useRealTimers(); release(); await pending; expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it.each([false, true])('holds the parent lock during delayed upload preparation (abort=%s)', async abort => {
  const f = await fixture(), prepare = f.adapter.prepare
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  f.adapter.prepare = async plan => { entered(); await gate; return prepare(plan) }
  vi.useFakeTimers()
  const pending = f.run(), observed = pending.catch(error => error)
  await reached
  if (abort) f.controller.abort(Error('Stopped during durable preparation'))
  await vi.advanceTimersByTimeAsync(31000)
  expect(f.locked()).toBe(true); expect(f.head()).toBe(null)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  if (!abort) await expect(f.run()).rejects.toThrow('BUSY')
  release(); const result = await observed
  expect(f.locked()).toBe(false)
  if (abort) { expect(result).toBeInstanceOf(Error); expect(f.head()).toBe(null); expect(f.adapter.sign).not.toHaveBeenCalled() }
  else expect(result.status).toBe('SUCCEEDED')
})
it.each(['sign', 'broadcast'] as const)('does not abandon a delayed %s continuation and release its parent lock', async method => {
  const f = await fixture(), original = f.adapter[method]
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  if (method === 'sign') f.adapter.sign = async record => { entered(); await gate; return f.signer.signTransaction(fromBase64(record.packet.bytes)) }
  else f.adapter.broadcast = async record => { entered(); await gate; await original(record) }
  vi.useFakeTimers(); const pending = f.run(), observed = pending.catch(error => error); await reached
  await vi.advanceTimersByTimeAsync(31000)
  expect(f.locked()).toBe(true); expect(f.head()?.packet.phase).toBe(method === 'sign' ? 'SIGNING' : 'SIGNED')
  await expect(f.run()).rejects.toThrow('BUSY')
  release(); const result = await observed
  expect(result.status).toBe('SUCCEEDED'); expect(f.locked()).toBe(false)
})
it('registration and consecutive mint chunks advance with history; a completed chunk cannot mint again', async () => {
  const f = await fixture(); await f.run(); await f.run(mint(0), { startNew: true }); await f.run(mint(1), { startNew: true })
  expect(f.past).toHaveLength(2); expect(f.adapter.prepare).toHaveBeenCalledTimes(3)
  await expect(f.run(mint(0), { startNew: true })).rejects.toThrow('MINT_ALREADY_COMPLETED')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(3)
})
it('an empty Collection with an uploaded cover certifies once without fabricating a Soul mint', async () => {
  const f = await fixture('FILE'); await f.run(); await f.run(mint(), { startNew: true })
  expect(f.head()?.plan.step).toEqual(mint())
  await expect(f.run(mint(), { startNew: true })).rejects.toThrow('PUBLIC_FILES_ALREADY_CONSUMED')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(2)
})
it('an empty Collection using a URL has no invented certify/mint stage', async () => {
  const f = await fixture('URL'); await f.run()
  await expect(f.run(mint(), { startNew: true })).rejects.toThrow('MINT_INDICES')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
})
it('does not mint before registration, skip a mint index, or re-register a successful operation', async () => {
  const f = await fixture()
  await expect(f.run(mint(0))).rejects.toThrow('REGISTER_PROOF_REQUIRED'); expect(f.adapter.prepare).not.toHaveBeenCalled()
  await f.run()
  await expect(f.run(mint(1), { startNew: true })).rejects.toThrow('OUT_OF_ORDER')
  await expect(f.run(register, { startNew: true })).rejects.toThrow('REGISTER_ALREADY_COMPLETED')
})
it('pending registration cannot be replaced with a mint packet, even with startNew', async () => {
  const f = await fixture(); vi.mocked(f.adapter.broadcast).mockImplementation(async r => { f.results.set(r.packet.digest, { status: 'PENDING' }) })
  await f.run(); await expect(f.run(mint(0), { startNew: true })).rejects.toThrow('RECOVERY_REQUIRED')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
})
it('historical success requires reproof before a subsequent chunk', async () => {
  const f = await fixture(); await f.run(); const digest = f.head()!.packet.digest
  await f.run(mint(0), { startNew: true }); f.results.set(digest, { status: 'MISSING' })
  await expect(f.run(mint(1), { startNew: true })).rejects.toThrow('HISTORY_UNCONFIRMED')
  expect(f.adapter.prepare).toHaveBeenCalledTimes(2)
})
it('rejects altered wallet bytes and false signatures before durable SIGNED/broadcast', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockResolvedValueOnce({ bytes: 'changed', signature: 'AQ==' })
  await expect(f.run()).rejects.toThrow('WALLET_CHANGED_BYTES')
  vi.mocked(f.adapter.sign).mockImplementationOnce(async r => ({ bytes: r.packet.bytes, signature: 'AQ==' }))
  await expect(f.run()).rejects.toThrow(); expect(f.head()?.packet.phase).toBe('SIGNING'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('fails closed on transport errors, missing checkpoint, or wallet generation drift', async () => {
  const f = await fixture(); vi.mocked(f.adapter.query).mockRejectedValueOnce(Error('offline'))
  await expect(f.run()).rejects.toThrow('offline'); expect(f.adapter.sign).not.toHaveBeenCalled()
  vi.mocked(f.adapter.query).mockResolvedValueOnce({ status: 'SUCCEEDED' })
  await expect(f.run()).rejects.toThrow('CHECKPOINT_REQUIRED'); expect(f.adapter.sign).not.toHaveBeenCalled()
  await expect(f.run(register, { lifetime: { signal: f.controller.signal, getAddress: () => null, isCurrent: () => false } })).rejects.toThrow('LIFETIME_CHANGED')
})
it.each(['binding', 'expiration', 'sender', 'phase', 'signature'])('packet parsing rejects %s drift', async variant => {
  const f = await fixture(); vi.mocked(f.adapter.query).mockRejectedValueOnce(Error('stop'))
  await expect(f.run()).rejects.toThrow('stop'); const r = structuredClone(f.head()!)
  if (variant === 'binding') r.plan.manifestHash = '0'.repeat(64)
  if (variant === 'expiration') r.packet.expirationEpoch = '11'
  if (variant === 'sender') { const tx = Transaction.from(r.packet.bytes); tx.setSender(id(99)); const bytes = await tx.build(); r.packet.bytes = toBase64(bytes); r.packet.digest = TransactionDataBuilder.getDigestFromBytes(bytes) }
  if (variant === 'phase') r.packet.phase = 'ACCEPTED' as any
  if (variant === 'signature') r.packet.phase = 'SIGNED'
  expect(() => f.domain.parse(r)).toThrow()
})
