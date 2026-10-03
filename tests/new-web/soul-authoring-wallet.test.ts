import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { authoringZeroFileVerifierFixture, authoringPaidCoverVerifierFixture } from './fixtures/soul-authoring-verifier'
import { createSoulAuthoringWallet } from '../../web/lib/soulidity/soul-authoring-wallet'
import { createSoulAuthoringPacketParser, type SoulAuthoringPacketRecord } from '../../web/lib/soulidity/soul-authoring-packet'
import { createWalrusBatchRecord, walrusBatchRecordHash, type WalrusBatchStore } from '../../web/lib/upload/walrus-batch-store'
import type { SoulAuthoringPacketJournal } from '../../web/lib/soulidity/soul-authoring-journal'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'

afterEach(() => vi.restoreAllMocks())
// Real composer, full history verifier and Ed25519 signatures. Only RPC/SDK
// resolution, wallet UI and disk are controlled; not Move/network acceptance.
async function fixture(paid = false) {
  const cover = paid ? await authoringPaidCoverVerifierFixture() : null
  if (cover) cover.w.base.systemSpy.mockResolvedValue({ id: cover.w.base.systemId, version: '2',
    package_id: cover.w.base.certifyPackage, new_package_id: null })
  const f = cover ? { ...cover, record: cover.consume, client: cover.w.transport,
    signer: Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)) } : await authoringZeroFileVerifierFixture()
  const original = Transaction.from(f.record.packet.bytes).getData()
  const parser = createSoulAuthoringPacketParser(f.p)
  let head: SoulAuthoringPacketRecord | null = cover ? structuredClone(f.record) : null, locked = false, executed = false
  let upload = cover ? structuredClone(cover.upload) : createWalrusBatchRecord(f.p.preparation)
  const events: string[] = []
  const journal: SoulAuthoringPacketJournal = {
    exclusive: async (_key, work) => { if (locked) throw Error('BUSY'); locked = true; try { return await work() } finally { locked = false } },
    history: async () => cover ? [{ ...structuredClone(cover.register), packet: { ...cover.register.packet, phase: 'SUCCEEDED' } }] : [], read: async () => structuredClone(head),
    write: async (_key, next) => { if (!locked) throw Error('LOCK_REQUIRED'); head = parser.parse(next); events.push(`saved:${next.packet.phase}`) },
  }
  const uploads: WalrusBatchStore = {
    exclusive: async (_key, work) => work(), read: async () => structuredClone(upload),
    create: async () => { throw Error('Unexpected new upload') },
    compareAndSwap: vi.fn(async (_key, expected, next) => {
      if (walrusBatchRecordHash(upload) !== expected) throw Error('CAS changed')
      upload = structuredClone(next); events.push('accepted')
    }),
    archive: async () => { throw Error('Unexpected archive') }, readArchive: async () => null,
  }
  const sign = vi.fn(async (tx: Transaction) => { events.push('sign'); return f.signer.signTransaction(await tx.build()) })
  const approve = vi.fn(async () => { events.push('approve'); return true })
  const execute = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
    if (toBase64(transaction) !== f.record.packet.bytes) throw Error('Fixture transaction differs')
    events.push('broadcast'); executed = true; return {} as any
  })
  const simulate = vi.fn(async (input: any) => ({ response: { transaction: {
    transaction: { bcs: { value: input.transaction.bcs.value } }, effects: { status: { success: true } },
  } } }))
  const transport = f.client as any, get = transport.ledgerService.getTransaction.getMockImplementation()
  transport.ledgerService.getTransaction.mockImplementation(async (input: any) => {
    if (!executed && input.digest === f.record.packet.digest) throw Object.assign(Error('Not found'), { code: 'NOT_FOUND' })
    return get(input)
  })
  transport.ledgerService.getEpoch = vi.fn(async () => ({ response: { epoch: { epoch: BigInt(f.record.packet.expirationEpoch) - 1n } } }))
  transport.transactionExecutionService = { simulateTransaction: simulate }
  transport.core = {
    executeTransaction: execute,
    getProtocolConfig: vi.fn(async () => ({ protocolConfig: { attributes: {
      max_tx_size_bytes: '131072', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384',
    } } })),
    resolveTransactionPlugin: () => async (data: any, _options: any, next: () => Promise<void>) => {
      data.inputs = data.inputs.map((input: any) => {
        if (!input.UnresolvedObject) return input
        const objectId = input.UnresolvedObject.objectId
        const found = original.inputs.find(i => i.Object?.SharedObject?.objectId === objectId || i.Object?.ImmOrOwnedObject?.objectId === objectId)
        if (!found) throw Error('Unexpected fixture object'); return structuredClone(found)
      })
      data.gasData = structuredClone(original.gasData)
      await next()
    },
  }
  const lifetime = { signal: f.controller.signal, getAddress: vi.fn(() => f.p.manifest.request.author), isCurrent: vi.fn(() => true) }
  const walrus = cover?.w.base.walrus ?? { reset: vi.fn() } as any // zero-file registration must never touch node storage
  const wallet = createSoulAuthoringWallet({ client: transport, walrus, preparation: f.p, lifetime,
    getTarget: () => f.p.manifest.request.target, authoring: { read: async () => structuredClone(f.p) }, uploads, journal, sign, approve })
  return { ...f, wallet, journal, uploads, lifetime, events, sign, approve, execute, simulate, transport,
    head: () => head, setHead: (r: SoulAuthoringPacketRecord) => { head = r }, stored: () => upload,
    run: () => wallet.run(f.record.plan.step), setExecuted: (value: boolean) => { executed = value } }
}
it('constructs, persists, approves, signs exact bytes and accepts real historical registration without a second payment', async () => {
  const f = await fixture(), result = await f.run()
  expect(result.status).toBe('SUCCEEDED'); expect(f.head()?.packet.phase).toBe('SUCCEEDED')
  expect(f.stored().registration?.packet.digest).toBe(f.record.packet.digest)
  expect(f.events.indexOf('saved:SIGNING')).toBeLessThan(f.events.indexOf('approve'))
  expect(f.events.indexOf('saved:SIGNED')).toBeLessThan(f.events.indexOf('broadcast'))
  expect(f.events.indexOf('broadcast')).toBeLessThan(f.events.indexOf('accepted'))
  await f.run(); expect(f.sign).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1)
})
it('declined exact-packet approval never invokes a wallet or broadcaster', async () => {
  const f = await fixture(); f.approve.mockResolvedValue(false)
  await expect(f.run()).rejects.toThrow('USER_DECLINED_PACKET')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  expect(f.head()?.packet.bytes).toBe(f.record.packet.bytes)
})
it.each(['SIGNING', 'SIGNED'] as const)('retires %s only after a later checkpoint and another exact query, retaining proof/signature', async phase => {
  const f = await fixture(), packet = { ...f.record.packet, phase,
    signature: phase === 'SIGNED' ? (await f.signer.signTransaction(fromBase64(f.record.packet.bytes))).signature : null }
  f.setHead({ ...f.record, packet })
  const expiry = marketCancelCheckpointFixture(String(BigInt(packet.expirationEpoch) + 1n))
  const order: string[] = []
  f.transport.ledgerService.getCheckpoint.mockImplementation(async () => { order.push('checkpoint'); return { response: { checkpoint: expiry.checkpoint } } })
  f.transport.ledgerService.getTransaction.mockImplementation(async () => { order.push('query'); throw Object.assign(Error('not found'), { code: 'NOT_FOUND' }) })
  const result = await f.wallet.run(f.record.plan.step, { retireExpired: true, expectedPacket: packet })
  expect(order).toEqual(['query', 'checkpoint', 'query'])
  expect(result.record.packet).toEqual({ ...packet, phase: 'RETIRED' })
  expect(result.record.retirement).toEqual({ priorPhase: phase, checkpoint: expiry.evidence })
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); expect(f.approve).not.toHaveBeenCalled()
  order.length = 0
  expect(await f.wallet.query(result.record)).toEqual({ status: 'MISSING' })
  expect(order).toEqual(['checkpoint', 'query'])
  f.transport.ledgerService.getTransaction.mockResolvedValueOnce({ response: { transaction: {} } })
  await expect(f.wallet.query(result.record)).rejects.toThrow('RETIRED_TRANSACTION_FOUND')
})
it('a failed query after the expiry checkpoint keeps the original packet active', async () => {
  const f = await fixture(), before = { ...f.record, packet: { ...f.record.packet, phase: 'SIGNING' as const, signature: null } }
  f.setHead(before)
  const expiry = marketCancelCheckpointFixture(String(BigInt(before.packet.expirationEpoch) + 1n))
  f.transport.ledgerService.getCheckpoint.mockResolvedValue({ response: { checkpoint: expiry.checkpoint } })
  f.transport.ledgerService.getTransaction.mockRejectedValueOnce(Object.assign(Error('missing'), { code: 'NOT_FOUND' }))
    .mockRejectedValueOnce(Error('network unavailable'))
  await expect(f.wallet.run(f.record.plan.step, { retireExpired: true })).rejects.toThrow('network unavailable')
  expect(f.head()).toEqual(before); expect(f.execute).not.toHaveBeenCalled()
})
it('resumes the exact paid cover certification using SDK reconstruction and accepts real full consumption proof', async () => {
  const f = await fixture(true), result = await f.run()
  expect(result.status).toBe('SUCCEEDED')
  expect(f.stored().consumptions.map(c => c.indices)).toEqual([[0]])
  expect(f.sign).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1)
  await f.run(); expect(f.sign).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1)
})
it('rejects a wallet response with different bytes', async () => {
  const f = await fixture()
  f.sign.mockImplementation(async () => ({ bytes: 'AQ==', signature: 'AQ==' }))
  await expect(f.run()).rejects.toThrow('WALLET_CHANGED_BYTES')
  expect(f.execute).not.toHaveBeenCalled(); expect(f.head()?.packet.phase).toBe('SIGNING')
})
it('rechecks wallet generation after the approval dialog', async () => {
  const f = await fixture(); f.approve.mockImplementation(async () => { f.lifetime.isCurrent.mockReturnValue(false); return true })
  await expect(f.run()).rejects.toThrow('LIFETIME_CHANGED')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it('rejects additional business commands before asking for approval or signature', async () => {
  const f = await fixture(), tx = Transaction.from(f.record.packet.bytes)
  tx.moveCall({ target: '0x2::fixture::unexpected' })
  const bytes = TransactionDataBuilder.restore(tx.getData()).build(), record = structuredClone(f.record)
  record.packet = { ...record.packet, phase: 'PREPARED', signature: null, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
  f.setHead(record)
  await expect(f.run()).rejects.toThrow('WHOLE_TRANSACTION_TEMPLATE_MISMATCH')
  expect(f.approve).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('rejects unsuccessful exact-byte simulation before signing', async () => {
  const f = await fixture()
  f.simulate.mockImplementation(async (input: any) => ({ response: { transaction: {
    transaction: { bcs: { value: input.transaction.bcs.value } }, effects: { status: { success: false } },
  } } }))
  await expect(f.run()).rejects.toThrow('EXACT_SIMULATION_REJECTED')
  expect(f.sign).not.toHaveBeenCalled()
})
it('recovers a lost broadcast response by query, then durably accepts without signing again', async () => {
  const f = await fixture(), send = f.execute.getMockImplementation()!
  f.execute.mockImplementationOnce(async input => { await send(input); throw Error('Lost response') })
  await expect(f.run()).rejects.toThrow('Lost response')
  expect(f.head()?.packet.phase).toBe('SIGNED')
  await f.run(); expect(f.sign).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1)
  expect(f.stored().registration).not.toBe(null)
})
it('keeps a pure historical query available after disconnect without accepting or broadcasting', async () => {
  const f = await fixture(); f.setHead(f.record); f.setExecuted(true); f.lifetime.getAddress.mockReturnValue('disconnected')
  expect((await f.wallet.query(f.record)).status).toBe('SUCCEEDED')
  expect(f.stored().registration).toBe(null); expect(f.sign).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
