import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
// The parser/BCS trust boundary is covered by the transaction suite. These
// tests isolate actual browser Storage persistence, transitions and Web Locks.
vi.mock('../../web/lib/soulidity/content-mutation-transaction', () => ({
  contentMutationKey: (plan: any) => `soulidity.content-mutation:${['chainIdentifier', 'originalPackageId', 'callablePackageId', 'marketConfigId', 'kindRegistryId'].map(key => plan.deployment[key]).join(':')}:${plan.soulId}:${plan.author}`,
  parseContentMutationRecord: (input: any) => {
    const r = structuredClone(input), p = r?.packet
    if (r?.schema !== 'soulidity.content-mutation.v1' || !r.plan || !p || !p.bytes || !p.digest
      || !['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(p.phase)
      || p.phase === 'SIGNED' && !p.signature
      || ['PREPARED', 'SIGNING', 'CANCELLED'].includes(p.phase) && p.signature !== null) throw new Error('invalid record')
    return r
  },
}))
import { browserContentMutationStore, CONTENT_MUTATION_STORE_CHANGED } from '../../web/lib/soulidity/content-mutation-store'
import { contentMutationKey, type ContentMutationRecord } from '../../web/lib/soulidity/content-mutation-transaction'
import * as transactionBoundary from '../../web/lib/soulidity/content-mutation-transaction'

function fixture() {
  return { schema: 'soulidity.content-mutation.v1', plan: {
    deployment: { chainIdentifier: 'chain', originalPackageId: 'original', callablePackageId: 'callable', marketConfigId: 'market', kindRegistryId: 'registry' },
    soulId: 'soul', stateId: 'state', contentId: 'content', author: 'alice', ownershipEpoch: '1', kind: 3,
    action: 'delete', target: { name: 'sprite', versionIndex: '9007199254740993' }, expectedActive: null, grantId: null, expectedSlot: 'AA==',
  }, packet: { bytes: 'exact prepared bytes', digest: 'digest-one', expirationEpoch: '4', phase: 'PREPARED', signature: null } } as ContentMutationRecord
}
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://content.example.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('Storage', dom.window.Storage); vi.stubGlobal('localStorage', dom.window.localStorage)
  const locks = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn(async (key: string, _options: unknown, work: (lock: unknown) => Promise<unknown>) => {
      if (locks.has(key)) return work(null)
      locks.add(key)
      try { return await work({ name: key }) } finally { locks.delete(key) }
    }),
  } })
})
afterEach(() => { vi.restoreAllMocks(); dom.window.close(); vi.unstubAllGlobals() })
const phase = (r: ContentMutationRecord, value: ContentMutationRecord['packet']['phase']) => ({ ...r, packet: { ...r.packet, phase: value } })
it('restores exact public packet after reload, notifies writes and discovers disconnected authors', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore(), listener = vi.fn()
  window.addEventListener(CONTENT_MUTATION_STORE_CHANGED, listener)
  await store.exclusive(key, async () => store.write(key, record))
  expect(browserContentMutationStore().read(key)).toEqual(record)
  const scope = { deployment: record.plan.deployment, soulId: record.plan.soulId, author: null }
  expect(browserContentMutationStore().list(scope)).toEqual([record]); expect(listener).toHaveBeenCalledOnce()
  expect(store.list({ ...scope, author: 'bob' })).toEqual([])
  for (const field of Object.keys(scope.deployment)) {
    expect(store.list({ ...scope, deployment: { ...scope.deployment, [field]: 'another release' } })).toEqual([])
  }
})
it('requires a real held scope lock and excludes concurrent store instances', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), a = browserContentMutationStore(), b = browserContentMutationStore()
  expect(() => a.write(key, record)).toThrow('LOCK_REQUIRED')
  const work = vi.fn()
  await a.exclusive(key, async () => { await expect(b.exclusive(key, work)).rejects.toThrow('BUSY'); a.write(key, record) })
  expect(work).not.toHaveBeenCalled()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  expect(() => browserContentMutationStore()).toThrow('REQUIRES_STORAGE_AND_LOCKS')
})
it('discovers captured deployments and authors without requiring the current release or wallet', async () => {
  const record = fixture(), store = browserContentMutationStore()
  const records = [record, { ...record, plan: { ...record.plan, author: 'bob' } },
    { ...record, plan: { ...record.plan, deployment: { ...record.plan.deployment, callablePackageId: 'later-callable' } } }]
  for (const r of records) await store.exclusive(contentMutationKey(r.plan), async () => store.write(contentMutationKey(r.plan), r))
  expect(store.discover({ soulId: 'soul', originalPackageId: 'original' })).toHaveLength(3)
  expect(store.discover({ soulId: 'another', originalPackageId: 'original' })).toEqual([])
  expect(store.discover({ soulId: 'soul', originalPackageId: 'another' })).toEqual([])
  expect(store.list({ deployment: record.plan.deployment, soulId: 'soul', author: null })).toHaveLength(2)
  const foreign = { ...record.plan, soulId: 'foreign' }
  localStorage.setItem(contentMutationKey(foreign), '{broken unrelated entry')
  expect(store.discover({ soulId: 'soul', originalPackageId: 'original' })).toHaveLength(3)
  expect(store.list({ deployment: record.plan.deployment, soulId: 'soul', author: null })).toHaveLength(2)
})
it('rejects unsigned cancellation after SIGNING and preserves frozen bytes/plan/signature', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  await store.exclusive(key, async () => {
    store.write(key, record); store.write(key, phase(record, 'SIGNING'))
    expect(() => store.write(key, phase(record, 'CANCELLED'))).toThrow('INVALID_TRANSITION')
    expect(() => store.write(key, record)).toThrow('INVALID_TRANSITION')
    expect(() => store.write(key, { ...record, packet: { ...record.packet, bytes: 'different' } })).toThrow('RECOVERY_REQUIRED')
    expect(() => store.write(key, { ...record, plan: { ...record.plan, action: 'purge' } })).toThrow('RECOVERY_REQUIRED')
    const signed = { ...record, packet: { ...record.packet, phase: 'SIGNED' as const, signature: 'signature' } }
    store.write(key, signed)
    expect(() => store.write(key, { ...signed, packet: { ...signed.packet, signature: 'another' } })).toThrow('SIGNATURE_CHANGED')
    expect(store.read(key)).toEqual(signed)
  })
})
it('archives terminal receipts before replacement and preserves them through fresh stores', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  const completed = phase(record, 'SUCCEEDED'), next = { ...record, packet: { ...record.packet, bytes: 'next exact bytes', digest: 'digest-two' } }
  await store.exclusive(key, async () => { store.write(key, record); store.write(key, completed); store.write(key, next) })
  expect(browserContentMutationStore().history(key)).toEqual([completed]); expect(store.read(key)).toEqual(next)
})
it('keeps cancelled and successful lifecycle receipts when an explicitly retried unsigned packet has identical bytes', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  await store.exclusive(key, async () => {
    store.write(key, record); store.write(key, phase(record, 'CANCELLED')); store.write(key, record)
    store.write(key, phase(record, 'SUCCEEDED'))
    store.write(key, { ...record, packet: { ...record.packet, bytes: 'next', digest: 'next' } })
  })
  expect(store.history(key).map(r => r.packet.phase)).toEqual(['CANCELLED', 'SUCCEEDED'])
})
it.each(['archive', 'active'])('quota failure during %s replacement retains previous exact evidence', async step => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore(), completed = phase(record, 'FAILED')
  await store.exclusive(key, async () => { store.write(key, record); store.write(key, completed) })
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) {
    if ((step === 'archive') === name.includes(':history:')) throw new Error('quota')
    return original.call(this, name, value)
  })
  await expect(store.exclusive(key, async () => store.write(key, { ...record, packet: { ...record.packet, bytes: 'new', digest: 'new' } }))).rejects.toThrow('quota')
  expect(store.read(key)).toEqual(completed)
  expect(store.history(key)).toEqual(step === 'active' ? [completed] : [])
})
it('fails exact write-readback and preserves malformed records without automatic deletion', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {})
  await expect(store.exclusive(key, async () => store.write(key, record))).rejects.toThrow('PERSISTENCE_FAILED')
  expect(store.read(key)).toBeNull()
  localStorage.setItem(key, '{malformed'); expect(() => store.read(key)).toThrow(); expect(localStorage.getItem(key)).toBe('{malformed')
})
it('rejects misplaced scope and oversized input without writing', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  await expect(store.exclusive('wrong', async () => store.write('wrong', record))).rejects.toThrow('SCOPE_MISMATCH')
  await expect(store.exclusive(key, async () => store.write(key, { ...record, packet: { ...record.packet, bytes: 'x'.repeat(300001) } }))).rejects.toThrow('RECORD_SIZE')
  expect(localStorage.length).toBe(0)
})
it('reports corrupt matching discovery and history instead of hiding or overwriting their evidence', async () => {
  const record = fixture(), key = contentMutationKey(record.plan), store = browserContentMutationStore()
  localStorage.setItem(key, JSON.stringify({ ...record, plan: { ...record.plan, author: 'bob' } }))
  expect(() => store.discover({ soulId: 'soul', originalPackageId: 'original' })).toThrow('SCOPE_MISMATCH')
  localStorage.setItem(key, JSON.stringify(record))
  await store.exclusive(key, async () => store.write(key, phase(record, 'CANCELLED')))
  const archiveKey = `${key}:history:${record.packet.digest}:CANCELLED`
  const bad = JSON.stringify({ ...record, packet: { ...record.packet, phase: 'CANCELLED', bytes: 'conflicting bytes' } })
  localStorage.setItem(archiveKey, bad)
  await expect(store.exclusive(key, async () => store.write(key, record))).rejects.toThrow('ARCHIVE_CONFLICT')
  expect(localStorage.getItem(archiveKey)).toBe(bad); expect(store.read(key)?.packet.phase).toBe('CANCELLED')
})
it('connects real SDK bytes/parser, local Ed25519 signature and fresh browser stores through lost execution acknowledgement', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/soulidity/content-mutation-transaction')>('../../web/lib/soulidity/content-mutation-transaction')
  vi.spyOn(transactionBoundary, 'parseContentMutationRecord').mockImplementation(actual.parseContentMutationRecord)
  vi.spyOn(transactionBoundary, 'contentMutationKey').mockImplementation(actual.contentMutationKey)
  const [{ Ed25519Keypair }, { Transaction, TransactionDataBuilder }, { toBase58, toBase64, fromBase64 }, { verifyTransactionSignature }, { SoulContentSlotPublicBcs }, { runContentMutation }] = await Promise.all([
    import('@mysten/sui/keypairs/ed25519'), import('@mysten/sui/transactions'), import('@mysten/sui/utils'), import('@mysten/sui/verify'),
    import('@soulidity/sdk'), import('../../web/lib/soulidity/content-mutation-runner'),
  ])
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`, signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(23))
  const plan = { ...fixture().plan, deployment: { chainIdentifier: '35834a8a', originalPackageId: id(100), callablePackageId: id(101), marketConfigId: id(102), kindRegistryId: id(103) },
    soulId: id(104), stateId: id(105), contentId: id(106), author: signer.toSuiAddress(),
    expectedSlot: SoulContentSlotPublicBcs.serialize({ version: '1', kind: 3, blob_object_id: id(107), is_public: false, deleted: false, purged: false,
      download_policy: 1, grant_scope_mask: '8', read_mode_mask: '7', op_mask: '15', seal_encrypted: true, created_at_ms: '123' }).toBase64() }
  const data = actual.buildContentMutationTransaction(plan).getData()
  data.sender = plan.author; data.expiration = { $kind: 'Epoch', Epoch: '4' }
  data.gasData = { owner: plan.author, budget: '5000000', price: '1000', payment: [{ objectId: id(108), version: '2', digest: toBase58(new Uint8Array(32).fill(7)) }] }
  data.inputs = data.inputs.map(input => input.UnresolvedObject
    ? { $kind: 'Object' as const, Object: { $kind: 'SharedObject' as const, SharedObject: { objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === plan.contentId } } } : input)
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  const record = actual.parseContentMutationRecord({ ...fixture(), plan, packet: { ...fixture().packet, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) } })
  let executed = false
  const adapter = {
    prepare: vi.fn(async () => record), query: vi.fn(async () => ({ status: executed ? 'SUCCEEDED' as const : 'MISSING' as const })),
    preflight: vi.fn(async () => {}), sign: vi.fn(async (r: ContentMutationRecord) => signer.signTransaction(fromBase64(r.packet.bytes))),
    verifySignature: async (r: ContentMutationRecord) => { await verifyTransactionSignature(fromBase64(r.packet.bytes), r.packet.signature!, { address: plan.author }) },
    broadcast: vi.fn(async () => { executed = true; throw new Error('lost acknowledgement') }),
  }
  const key = contentMutationKey(plan)
  await expect(runContentMutation({ plan, adapter, store: browserContentMutationStore() })).rejects.toThrow('lost acknowledgement')
  const signed = browserContentMutationStore().read(key)!
  expect(signed.packet.phase).toBe('SIGNED'); expect(actual.parseContentMutationRecord(signed)).toEqual(signed)
  expect((await runContentMutation({ plan, adapter, store: browserContentMutationStore(), queryOnly: true })).status).toBe('SUCCEEDED')
  expect(browserContentMutationStore().read(key)?.packet.phase).toBe('SIGNED')
  expect((await runContentMutation({ plan, adapter, store: browserContentMutationStore() })).record.packet.phase).toBe('SUCCEEDED')
  expect(adapter.prepare).toHaveBeenCalledOnce(); expect(adapter.sign).toHaveBeenCalledOnce(); expect(adapter.broadcast).toHaveBeenCalledOnce()
})
