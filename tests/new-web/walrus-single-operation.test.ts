import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { executeWalrusSinglePacket, parseWalrusSingleRecord, queryWalrusSinglePacket,
  readWalrusSingleRecord, walrusSingleKey, withWalrusSingleLock, writeWalrusSingleRecord,
  type WalrusSingleRecord, type WalrusSinglePacket, type WalrusSingleExecution } from '../../web/lib/upload/walrus-single-operation'

// Actual canonical Sui TransactionData/Effects and Ed25519 verification. Only
// browser persistence and read/broadcast transport boundaries are simulated.
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(33))
const owner = signer.toSuiAddress(), digest = toBase58(new Uint8Array(32).fill(3))
class Store implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}
let store: Store
beforeEach(() => {
  store = new Store()
  vi.stubGlobal('window', { localStorage: store })
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_key, _opts, fn) => fn({ name: _key })) } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function transaction(amount = 1n) {
  const tx = new Transaction()
  tx.setSender(owner); tx.setGasOwner(owner); tx.setGasPrice(1000); tx.setGasBudget(1000000)
  tx.setGasPayment([{ objectId: id(90), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
  const coin = tx.splitCoins(tx.gas, [tx.pure.u64(amount)])
  tx.transferObjects([coin], tx.pure.address(id(91)))
  return tx
}
function initial(): WalrusSingleRecord {
  return { schema: 'soulidity.walrus-single.v1', intent: { network: 'mainnet', owner, recipient: owner,
    operationScope: 'profile:stable-intent', attachmentScope: null, contentHash: 'a'.repeat(64), payloadHash: 'a'.repeat(64),
    payloadByteLength: 10, storageEpochs: 3, relayUrl: 'https://upload-relay.mainnet.walrus.space' },
  encoding: { blobId: 'blob', rootHash: 'root', unencodedSize: 10, nonce: null }, uploaded: null,
  approved: { relayTip: '1', storageCost: '2', writeCost: '3', gasBudget: '2000000', quoteId: 'quote' },
  register: null, certify: null, acknowledged: false }
}
async function fixture(phase?: WalrusSinglePacket['phase']) {
  const record = initial(), key = walrusSingleKey(record.intent), events: string[] = []
  let currentOwner: string | null = owner, epoch = 9n, final = false, success = true, checkpoint: bigint | undefined = 0n
  let packet: WalrusSinglePacket | null = null
  const raw = await transaction().build()
  if (phase) {
    packet = { bytes: toBase64(raw), digest: TransactionDataBuilder.getDigestFromBytes(raw), expirationEpoch: '10', phase,
      signature: ['SIGNED', 'SUCCEEDED', 'FAILED'].includes(phase) ? (await signer.signTransaction(raw)).signature : null }
    record.register = packet; writeWalrusSingleRecord(key, record)
  }
  function effects(p: WalrusSinglePacket) {
    return bcs.TransactionEffects.serialize({ V2: {
      status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: 0 } },
      executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: p.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
      changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
    } }).toBytes()
  }
  const client = {
    core: {
      getChainIdentifier: vi.fn(async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' })),
      executeTransaction: vi.fn(async ({ transaction: bytes }: { transaction: Uint8Array }) => {
        events.push('broadcast')
        const saved = readWalrusSingleRecord(key)!.register!
        expect(saved.phase).toBe('SIGNED'); expect(saved.signature).not.toBeNull(); expect(saved.bytes).toBe(toBase64(bytes))
        packet = saved; final = true; return {}
      }),
    },
    ledgerService: {
      getEpoch: vi.fn(async () => ({ response: { epoch: { epoch } } })),
      getTransaction: vi.fn(async () => {
        events.push('query')
        if (!final) throw { code: 'NOT_FOUND' }
        const p = packet!
        return { response: { transaction: { digest: p.digest, transaction: { digest: p.digest, bcs: { value: fromBase64(p.bytes) } },
          effects: { bcs: { value: effects(p) }, status: { success } }, checkpoint } } }
      }),
    },
  }
  const sign = vi.fn(async (tx: Transaction) => {
    events.push('sign')
    const bytes = await tx.build()
    expect(readWalrusSingleRecord(key)?.register?.phase).toBe('SIGNING')
    expect(readWalrusSingleRecord(key)?.register?.bytes).toBe(toBase64(bytes))
    return signer.signTransaction(bytes)
  })
  const execution: WalrusSingleExecution = { client: client as any, getAddress: () => currentOwner, sign }
  const build = vi.fn(async () => { events.push('build'); return transaction() })
  const run = () => executeWalrusSinglePacket({ execution, key, record: readWalrusSingleRecord(key) ?? record, stage: 'register', gasBudget: 1000000n, build })
  return { record, key, packet, client, execution, sign, build, run, events,
    setFinal: (value = true) => { final = value }, setSuccess: (value: boolean) => { success = value },
    setEpoch: (value: bigint) => { epoch = value }, setOwner: (value: string | null) => { currentOwner = value },
    setCheckpoint: (value: bigint | undefined) => { checkpoint = value } }
}
it('persists exact bytes before sign and verified signature before broadcast, retaining final packet', async () => {
  const f = await fixture(); const result = await f.run()
  expect(f.events).toEqual(['build', 'sign', 'broadcast', 'query'])
  expect(result.register?.phase).toBe('SUCCEEDED'); expect(readWalrusSingleRecord(f.key)).toEqual(result)
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
})
it.each([1, 2, 3])('live authority rejection at write checkpoint %s stops later signing/broadcast and retains exact stage', async rejectedAt => {
  const f = await fixture(); let calls = 0
  f.execution.beforeWrite = vi.fn(async () => { if (++calls === rejectedAt) throw Error('AUTHORITY_CHANGED') })
  await expect(f.run()).rejects.toThrow('AUTHORITY_CHANGED')
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(f.sign).toHaveBeenCalledTimes(rejectedAt === 3 ? 1 : 0)
  const packet = readWalrusSingleRecord(f.key)?.register
  if (rejectedAt === 1) { expect(packet).toBeUndefined(); expect(f.build).not.toHaveBeenCalled() }
  if (rejectedAt === 2) expect(packet?.phase).toBe('PREPARED')
  if (rejectedAt === 3) { expect(packet?.phase).toBe('SIGNED'); expect(packet?.signature).not.toBeNull() }
})
it('checks current authority before rebroadcasting an existing signed packet', async () => {
  const f = await fixture('SIGNED'), saved = readWalrusSingleRecord(f.key)
  f.execution.beforeWrite = vi.fn(async () => { throw Error('GRANT_REVOKED') })
  await expect(f.run()).rejects.toThrow('GRANT_REVOKED')
  expect(f.events).toEqual(['query']); expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(readWalrusSingleRecord(f.key)).toEqual(saved)
})
it.each([true, false])('terminal query (success=%s) never needs current write authority', async success => {
  const f = await fixture('SIGNED'); f.setFinal(); f.setSuccess(success); f.setOwner(null)
  f.execution.beforeWrite = vi.fn(async () => { throw Error('GRANT_REVOKED') })
  if (success) expect((await f.run()).register?.phase).toBe('SUCCEEDED')
  else await expect(f.run()).rejects.toThrow('FAILED_NO_AUTOMATIC_REPLACEMENT')
  expect(f.execution.beforeWrite).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(f.events).toEqual(['query'])
})
it.each(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED'] as const)('queries %s before any new work and never signs a confirmed digest', async phase => {
  const f = await fixture(phase); f.setFinal()
  expect((await f.run()).register?.phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['query']); expect(f.build).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('rebroadcasts the verified same signed packet without signing again after MISSING', async () => {
  const f = await fixture('SIGNED'); await f.run()
  expect(f.events).toEqual(['query', 'build', 'broadcast', 'query'])
  expect(f.sign).not.toHaveBeenCalled()
  expect(toBase64(f.client.core.executeTransaction.mock.calls[0][0].transaction)).toBe(f.packet!.bytes)
})
it('unknown broadcast survives reload and queries the same digest without another sign or payment', async () => {
  const f = await fixture()
  f.client.core.executeTransaction.mockRejectedValueOnce(new Error('connection lost'))
  await expect(f.run()).rejects.toThrow('connection lost')
  const saved = readWalrusSingleRecord(f.key)!
  expect(saved.register?.phase).toBe('SIGNED')
  // Transport may have accepted the original packet even though its reply was lost.
  const reloaded = await fixture('SIGNED'); reloaded.setFinal(); await reloaded.run()
  expect(reloaded.sign).not.toHaveBeenCalled(); expect(reloaded.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(saved.register!.bytes).toBe(reloaded.packet!.bytes)
})
it.each(['storage write', 'readback mismatch'] as const)('fails before signing when %s prevents durable bytes', async mode => {
  const f = await fixture()
  if (mode === 'storage write') vi.spyOn(store, 'setItem').mockImplementation(() => { throw new Error('quota') })
  else vi.spyOn(store, 'getItem').mockReturnValue(null)
  await expect(f.run()).rejects.toThrow()
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('a SIGNED persistence failure prevents broadcast even after a valid wallet signature', async () => {
  const f = await fixture(), original = store.setItem.bind(store)
  vi.spyOn(store, 'setItem').mockImplementation((key, value) => {
    if (JSON.parse(value).register?.phase === 'SIGNED') throw new Error('quota after sign')
    original(key, value)
  })
  await expect(f.run()).rejects.toThrow('quota after sign'); expect(f.sign).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(readWalrusSingleRecord(f.key)?.register?.phase).toBe('SIGNING')
})
it.each(['wrong bytes', 'wrong signer'] as const)('rejects %s before persisting a signature or broadcasting', async mode => {
  const f = await fixture()
  f.sign.mockImplementation(async () => mode === 'wrong bytes'
    ? signer.signTransaction(await transaction(2n).build())
    : Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(34)).signTransaction(await transaction().build()))
  await expect(f.run()).rejects.toThrow(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(readWalrusSingleRecord(f.key)?.register?.signature).toBeNull()
})
it.each([null, id(9)])('refuses disconnected/different wallet %s before build', async address => {
  const f = await fixture(); f.setOwner(address)
  await expect(f.run()).rejects.toThrow('RECONNECT'); expect(f.build).not.toHaveBeenCalled()
})
it('checks wallet again after async epoch lookup immediately before broadcast', async () => {
  const f = await fixture('SIGNED')
  f.client.ledgerService.getEpoch.mockImplementationOnce(async () => ({ response: { epoch: { epoch: 9n } } }))
    .mockImplementationOnce(async () => { f.setOwner(null); return { response: { epoch: { epoch: 9n } } } })
  await expect(f.run()).rejects.toThrow('RECONNECT'); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('expired MISSING remains query-only and is never replaced', async () => {
  const f = await fixture('SIGNED'); f.setEpoch(11n)
  await expect(f.run()).rejects.toThrow('EXPIRED_QUERY_ONLY')
  expect(readWalrusSingleRecord(f.key)?.register).toEqual(f.packet); expect(f.sign).not.toHaveBeenCalled()
})
it('expired but confirmed still recovers read-only with no wallet', async () => {
  const f = await fixture('SIGNED'); f.setEpoch(11n); f.setOwner(null); f.setFinal()
  expect((await f.run()).register?.phase).toBe('SUCCEEDED'); expect(f.build).not.toHaveBeenCalled()
})
it('MISSING with a different current SDK graph cannot sign or rebroadcast', async () => {
  const f = await fixture('SIGNED'); f.build.mockResolvedValue(transaction(99n))
  await expect(f.run()).rejects.toThrow('TEMPLATE_CHANGED_QUERY_ONLY'); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it.each(['gas', 'expiration'] as const)('rehashed saved packet cannot expand approved %s', async field => {
  const f = await fixture('PREPARED'), tx = transaction()
  if (field === 'gas') tx.setGasBudget(9999999); else tx.setExpiration({ Epoch: '9999' })
  const bytes = await tx.build(), r = f.record
  r.register = { ...r.register!, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
    expirationEpoch: field === 'expiration' ? '9999' : '10' }
  writeWalrusSingleRecord(f.key, r)
  await expect(f.run()).rejects.toThrow(field === 'gas' ? 'APPROVED_GAS_EXCEEDED' : 'EXPIRATION_OUTSIDE')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('confirmed failure is retained without replacement or another signature', async () => {
  const f = await fixture('SIGNED'); f.setFinal(); f.setSuccess(false)
  await expect(f.run()).rejects.toThrow('FAILED_NO_AUTOMATIC_REPLACEMENT')
  expect(readWalrusSingleRecord(f.key)?.register?.phase).toBe('FAILED'); expect(f.sign).not.toHaveBeenCalled()
})
it('uncheckpointed response is pending, not a new broadcast opportunity', async () => {
  const f = await fixture('SIGNED'); f.setFinal(); f.setCheckpoint(undefined)
  await expect(f.run()).rejects.toThrow('TRANSACTION_PENDING'); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('RPC failures are not MISSING', async () => {
  const f = await fixture('SIGNED'); f.client.ledgerService.getTransaction.mockRejectedValue(new Error('RPC offline'))
  await expect(f.run()).rejects.toThrow('RPC offline'); expect(f.build).not.toHaveBeenCalled()
})
it('wrong chain cannot sign, broadcast or approve a packet', async () => {
  const f = await fixture(); f.client.core.getChainIdentifier.mockResolvedValue({ chainIdentifier: digest })
  await expect(f.run()).rejects.toThrow('WRONG_CHAIN'); expect(f.sign).not.toHaveBeenCalled()
})
it('rejects forged digest before query or sign', async () => {
  const f = await fixture('SIGNED'); f.record.register!.digest = digest
  expect(() => parseWalrusSingleRecord(f.record)).toThrow('BYTES_MISMATCH')
})
it('missing WebLocks and competing tab both fail closed', async () => {
  await expect(withWalrusSingleLock('test', async () => 1)).resolves.toBe(1)
  vi.stubGlobal('navigator', { locks: { request: async (_: unknown, __: unknown, fn: (lock: null) => unknown) => fn(null) } })
  await expect(withWalrusSingleLock('test', async () => 1)).rejects.toThrow('BUSY')
  vi.stubGlobal('navigator', {})
  await expect(withWalrusSingleLock('test', async () => 1)).rejects.toThrow('REQUIRES_STORAGE_AND_LOCKS')
})
it('corrupt records are neither silently ignored nor TTL-deleted', async () => {
  const f = await fixture('SIGNED'); store.setItem(f.key, '{broken')
  expect(() => readWalrusSingleRecord(f.key)).toThrow(); expect(store.getItem(f.key)).toBe('{broken')
})
it('scope key is deterministic and separates business target, wallet and network', () => {
  const intent = initial().intent, key = walrusSingleKey(intent)
  expect(walrusSingleKey(structuredClone(intent))).toBe(key)
  expect(walrusSingleKey({ ...intent, operationScope: 'profile:other-intent' })).not.toBe(key)
  expect(walrusSingleKey({ ...intent, owner: id(8) })).not.toBe(key)
  expect(walrusSingleKey({ ...intent, network: 'testnet' })).not.toBe(key)
})
it('late wallet response after timeout cannot broadcast', async () => {
  const f = await fixture(); vi.useFakeTimers()
  let resolve!: (value: Awaited<ReturnType<typeof signer.signTransaction>>) => void
  f.sign.mockImplementation(() => new Promise(r => { resolve = r }))
  const promise = expect(f.run()).rejects.toThrow('UNKNOWN_RETRY_SAME_OPERATION')
  await vi.advanceTimersByTimeAsync(120001); await promise
  resolve(await signer.signTransaction(await transaction().build())); await Promise.resolve()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(readWalrusSingleRecord(f.key)?.register?.phase).toBe('SIGNING')
})
