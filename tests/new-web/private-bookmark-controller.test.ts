import { afterEach, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { buildCommitPrivateWalletBookmarksTx, type PrivateWalletBookmarksHeadSnapshot } from '@soulidity/sdk'
import { createPrivateBookmarkController } from '../../web/lib/bookmarks/private-bookmark-controller'
import { emptyPrivateBookmarkLibrary, preparePrivateBookmarkMutation, validatePrivateBookmarkLibrary, type PrivateBookmarkLibrary } from '../../web/lib/bookmarks/private-bookmark-library'
import { PrivateBookmarkEnvelopeBcs, privateBookmarkAad } from '../../web/lib/bookmarks/private-bookmark-crypto'
import { parsePrivateBookmarkRecovery, privateBookmarkRecoveryFingerprint, privateBookmarkStorageScope, privateBookmarkWalrusKey,
  type PrivateBookmarkRecovery, type PrivateBookmarkRecoveryStore } from '../../web/lib/bookmarks/private-bookmark-recovery'
import type { PrivateBookmarkPublicPlan } from '../../web/lib/bookmarks/private-bookmark-transaction'
import { readWalrusSingleRecord, writeWalrusSingleRecord, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
const privateTransactionSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(19))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(9))
async function fixture() {
  const scope = { registryId: id(42), owner: privateTransactionSigner.toSuiAddress() }
  const config = { deployment: { originalPackageId: id(40), callablePackageId: id(41), callableDigest: digest, chainIdentifier: '35834a8a' },
    registryId: scope.registryId, writesEnabled: true, storage: { blobType: `${id(45)}::blob::Blob`, aggregatorUrl: 'https://aggregator.example.com' },
    sealConfig: { threshold: 1, ttlMin: 10, serverConfigs: [{ objectId: id(700), weight: 1, aggregatorUrl: 'https://key-one.example.com' }] } }
  const uploadConfig = { network: 'mainnet' as const, relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.3.5.wasm', storageEpochs: 3 }
  const local = new Map<string, string>(), events: string[] = [], archive = new Map<string, PrivateBookmarkRecovery>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, work: (lock: object) => unknown) => work({}) } })
  let active: PrivateBookmarkRecovery | null = null, address: string | null = scope.owner, enabled = true, held = false
  const store: PrivateBookmarkRecoveryStore = {
    exclusive: async (_key, work) => { if (held) throw new Error('busy'); held = true; try { return await work() } finally { held = false } },
    read: async () => structuredClone(active),
    replace: async (_key, expected, next) => {
      if (expected === null ? active !== null : active === null || privateBookmarkRecoveryFingerprint(expected) !== privateBookmarkRecoveryFingerprint(active)) throw new Error('CAS')
      active = parsePrivateBookmarkRecovery(next); events.push(`persist:${active.paymentStarted}:${active.transaction?.packet.phase ?? 'none'}`)
    },
    archive: async (_key, expected) => { expect(active).toEqual(expected); archive.set(expected.context.requestId, { ...structuredClone(expected), sequence: expected.sequence + 1, status: 'ARCHIVED' }); active = null },
    archived: async (_key, request) => structuredClone(archive.get(request) ?? null),
  }
  let library = emptyPrivateBookmarkLibrary(scope)
  let snapshot: PrivateWalletBookmarksHeadSnapshot = { scope, revision: '0', head: null, emptyReason: 'ABSENT',
    registryVersion: '1', registryDigest: digest, headFieldId: id(120), headFieldVersion: null, headFieldDigest: null }
  const documents = new Map<string, PrivateBookmarkLibrary>()
  const readers = {
    head: vi.fn(async () => structuredClone(snapshot)),
    unlock: vi.fn(async () => ({ snapshot: structuredClone(snapshot), library: structuredClone(library), endEpoch: null })),
    // Controller-only boundary: random opaque payload with canonical envelope.
    // Actual AES/Seal and raw read authority have separate real-crypto suites.
    encrypt: vi.fn(async (next: PrivateBookmarkLibrary, verify: () => Promise<void>) => {
      await verify()
      const context = { scope, revision: next.revision, requestId: next.intent!.requestId, originalPackageId: config.deployment.originalPackageId, chainIdentifier: config.deployment.chainIdentifier }
      const bytes = PrivateBookmarkEnvelopeBcs.serialize({ version: 1, aad: [...privateBookmarkAad(context)], wrapped_dek: [1],
        iv: [...crypto.getRandomValues(new Uint8Array(12))], ciphertext: [...crypto.getRandomValues(new Uint8Array(32))] }).toBytes()
      documents.set(toHex(sha256(bytes)), structuredClone(next)); return bytes
    }),
    decryptRecovery: vi.fn(async (r: PrivateBookmarkRecovery) => structuredClone(documents.get(r.cipherSha256)!)),
  }
  async function packet(plan: PrivateBookmarkPublicPlan) {
    const base = buildCommitPrivateWalletBookmarksTx(plan)
    const raw = base.getData()
    raw.inputs = raw.inputs.map((input: any) => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === scope.registryId }) : input)
    const tx = Transaction.from(JSON.stringify(raw)); tx.setSender(scope.owner); tx.setGasOwner(scope.owner)
    tx.setGasPayment([{ objectId: id(150), version: '1', digest }]); tx.setGasPrice('1000'); tx.setGasBudget('1000000'); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build()
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED' as const, signature: null }
  }
  const payments = {
    recover: vi.fn(async (r: PrivateBookmarkRecovery): Promise<any> => r.storage ? { status: 'CERTIFIED', receipt: r.storage } : { status: 'NONE' }),
    upload: vi.fn(async (r: PrivateBookmarkRecovery, verify: (signing: boolean) => Promise<void>) => {
      expect(active?.ciphertext).toEqual(r.ciphertext); events.push('quote'); await verify(false)
      const reference = { blobObjectId: id(160), blobId: toBase64(new Uint8Array(32).fill(8)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
        sha256: r.cipherSha256, byteLength: String(r.ciphertext.length) }
      const p = await packet({ deployment: config.deployment, scope, expectedRevision: String(BigInt(r.context.revision) - 1n), requestId: r.context.requestId, ciphertext: reference })
      const walrus: WalrusSingleRecord = { schema: 'soulidity.walrus-single.v1', intent: { network: 'mainnet', owner: scope.owner, recipient: scope.owner,
        operationScope: privateBookmarkStorageScope(r), attachmentScope: null, contentHash: r.cipherSha256, payloadHash: r.cipherSha256,
        payloadByteLength: r.ciphertext.length, storageEpochs: 3, relayUrl: uploadConfig.relayUrl },
        encoding: { blobId: reference.blobId, rootHash: 'root', unencodedSize: r.ciphertext.length, nonce: null },
        approved: { relayTip: '0', storageCost: '1', writeCost: '1', gasBudget: '1000000', quoteId: 'quote' },
        register: { ...p, phase: 'SIGNING' }, certify: null, uploaded: null, acknowledged: false }
      writeWalrusSingleRecord(privateBookmarkWalrusKey(r), walrus)
      await verify(true); expect(active?.paymentStarted).toBe(true); events.push('payment-sign')
      return { reference, storageTxDigest: digest, certifyTxDigest: digest, recoveryKey: privateBookmarkWalrusKey(r), quoteId: 'quote' }
    }),
  }
  let queryStatus: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'MISSING'
  const transactions = {
    prepare: vi.fn(packet), preflight: vi.fn(async () => {}),
    sign: vi.fn(async (_plan, p) => { expect(active?.transaction?.packet.phase).toBe('SIGNING'); events.push('head-sign'); return privateTransactionSigner.signTransaction(await Transaction.from(p.bytes).build()) }),
    verifySignature: vi.fn(async () => {}),
    broadcast: vi.fn(async () => { expect(active?.transaction?.packet.phase).toBe('SIGNED'); events.push('broadcast'); queryStatus = 'SUCCEEDED' }),
    query: vi.fn(async () => { events.push('query'); return queryStatus }),
  }
  const signal = new AbortController(), confirmHead = vi.fn(async () => true)
  const params = { scope, config, uploadConfig, store, readers, payments, transactions, signal: signal.signal,
    getAddress: () => address, writesEnabled: () => enabled, confirmHead }
  const controller = createPrivateBookmarkController(params)
  return { controller, params, store, readers, payments, transactions, signal, confirmHead, events, archive, documents, local, scope,
    get record() { return active! }, setAddress: (v: string | null) => { address = v }, disable: () => { enabled = false },
    setQuery: (v: typeof queryStatus) => { queryStatus = v }, setSnapshot: (v: typeof snapshot) => { snapshot = v },
    commit: (r: PrivateBookmarkRecovery) => { library = structuredClone(documents.get(r.cipherSha256)!); snapshot = { ...snapshot, revision: r.context.revision, emptyReason: null,
      head: { scope, revision: r.context.revision, ciphertext: r.storage!.reference, receipts: library.receipts.map(row => ({ requestId: row.requestId,
        revision: row.result.revision, ciphertext: r.storage!.reference })) } } },
  }
}

it('stages opaque recovery before quote/payment, persists SIGNING and SIGNED before wallet/broadcast', async () => {
  const f = await fixture(); await f.controller.unlock()
  expect((await f.controller.start('renew')).status).toBe('SAVED')
  expect(f.events.indexOf('persist:false:none')).toBeLessThan(f.events.indexOf('quote'))
  expect(f.events.indexOf('persist:true:none')).toBeLessThan(f.events.indexOf('payment-sign'))
  expect(f.events.indexOf('persist:true:SIGNED')).toBeLessThan(f.events.indexOf('broadcast'))
  expect(JSON.stringify(f.record)).not.toContain('renew')
})
it('quote preflight does not require a nonexistent payment WAL, but signing requires it', async () => {
  const f = await fixture(); await f.controller.unlock()
  f.payments.upload.mockImplementationOnce(async (_r, verify) => { await verify(false); await verify(true); throw new Error('not reached') })
  await expect(f.controller.start('renew')).rejects.toThrow('PAYMENT_JOURNAL_NOT_DURABLE')
  expect(f.record.paymentStarted).toBe(false); expect(f.transactions.sign).not.toHaveBeenCalled()
})
it('cold query checks successful exact packet before closed gates, changed owner or current head', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  f.disable(); f.setAddress(null); f.readers.head.mockRejectedValue(new Error('ownership changed'))
  const cold = createPrivateBookmarkController(f.params)
  expect((await cold.resume(true)).status).toBe('SAVED')
  expect(f.payments.upload).toHaveBeenCalledTimes(1); expect(f.transactions.sign).toHaveBeenCalledTimes(1)
})
it('cold query tolerates only a changed permission flag, while that flag still prohibits new writes', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const config = structuredClone(f.params.config); config.writesEnabled = false
  const cold = createPrivateBookmarkController({ ...f.params, config })
  expect((await cold.resume(true)).status).toBe('SAVED')
  await cold.archive(); await cold.unlock()
  await expect(cold.start('renew')).rejects.toThrow('WRITES_DISABLED')
  expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('a changed storage read identity still rejects cold recovery before query', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const config = structuredClone(f.params.config); config.storage.aggregatorUrl = 'https://different.example.com'
  const cold = createPrivateBookmarkController({ ...f.params, config }), queries = f.transactions.query.mock.calls.length
  await expect(cold.resume(true)).rejects.toThrow('RECOVERY_CONFIGURATION_CHANGED')
  expect(f.transactions.query).toHaveBeenCalledTimes(queries)
})
it('unknown execution retains the same bytes and queries first without repeating payment', async () => {
  const f = await fixture(); await f.controller.unlock()
  f.transactions.broadcast.mockImplementationOnce(async () => { f.setQuery('PENDING'); throw new Error('connection lost') })
  await expect(f.controller.start('renew')).rejects.toThrow('connection lost')
  const bytes = f.record.transaction!.packet.bytes
  expect((await f.controller.resume()).status).toBe('PENDING')
  expect(f.record.transaction!.packet.bytes).toBe(bytes); expect(f.transactions.broadcast).toHaveBeenCalledTimes(1)
  expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('a declined head approval preserves certified storage and does not pay again', async () => {
  const f = await fixture(); await f.controller.unlock(); f.confirmHead.mockResolvedValueOnce(false)
  await expect(f.controller.start('renew')).rejects.toThrow('APPROVAL_CANCELLED')
  expect(f.record.storage).not.toBeNull(); expect(f.record.transaction?.packet.phase).toBe('PREPARED')
  expect((await f.controller.resume()).status).toBe('SAVED'); expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('paid WAL loss blocks repeat payment even on a cold retry', async () => {
  const f = await fixture(); await f.controller.unlock(); f.confirmHead.mockResolvedValueOnce(false)
  await expect(f.controller.start('renew')).rejects.toThrow('APPROVAL_CANCELLED')
  f.local.clear()
  await expect(f.controller.resume()).rejects.toThrow('PAYMENT_RECOVERY_MISSING')
  expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('requires durable IDB before paying and never logs a plaintext intent', async () => {
  const f = await fixture(); await f.controller.unlock(); f.store.replace = vi.fn(async () => { throw new Error('quota') })
  await expect(f.controller.start('renew')).rejects.toThrow('quota'); expect(f.payments.upload).not.toHaveBeenCalled()
})
it('rejects wallet changes and concurrent attempts before another payment', async () => {
  const f = await fixture(); await f.controller.unlock(); f.setAddress(null)
  await expect(f.controller.start('renew')).rejects.toThrow('WALLET_CHANGED'); expect(f.payments.upload).not.toHaveBeenCalled()
})
it('lock invalidates a pending unlock so a late read cannot repopulate private memory', async () => {
  const f = await fixture(), original = f.readers.unlock.getMockImplementation()!
  let finish!: () => void
  f.readers.unlock.mockImplementationOnce(async () => { await new Promise<void>(r => { finish = r }); return original() })
  const pending = f.controller.unlock(); f.controller.lock(); finish()
  await expect(pending).rejects.toThrow('READ_SUPERSEDED')
  expect(() => f.controller.view('id')).toThrow('UNLOCK_REQUIRED')
})
it('archives settled success without deleting its encrypted recovery', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const request = f.record.context.requestId
  expect((await f.controller.archive()).status).toBe('ARCHIVED')
  expect(await f.controller.inspect()).toBeNull(); expect(f.archive.get(request)?.ciphertext.length).toBeGreaterThan(0)
})
it('unknown signed attempts cannot be archived or rebased', async () => {
  const f = await fixture(); await f.controller.unlock()
  f.transactions.broadcast.mockImplementationOnce(async () => { f.setQuery('PENDING') })
  await f.controller.start('renew')
  await expect(f.controller.archive()).rejects.toThrow('QUERY_SIGNED_TRANSACTION_FIRST')
  await expect(f.controller.rebase()).rejects.toThrow('QUERY_SIGNED_TRANSACTION_FIRST')
})
it.each(['archive', 'rebase'] as const)('on-chain PENDING overrides local PREPARED for %s', async action => {
  const f = await fixture(); await f.controller.unlock(); f.confirmHead.mockResolvedValueOnce(false)
  await expect(f.controller.start('renew')).rejects.toThrow('APPROVAL_CANCELLED')
  expect(f.record.transaction!.packet.phase).toBe('PREPARED'); f.setQuery('PENDING')
  await expect(f.controller[action]()).rejects.toThrow('QUERY_SIGNED_TRANSACTION_FIRST')
  expect(f.payments.upload).toHaveBeenCalledTimes(1); expect(f.archive.size).toBe(0)
})
it('unconfirmed paid storage after head approval prevents a new head signature', async () => {
  const f = await fixture(); await f.controller.unlock()
  f.confirmHead.mockImplementationOnce(async () => { f.payments.recover.mockResolvedValue({ status: 'UNKNOWN' }); return true })
  await expect(f.controller.start('renew')).rejects.toThrow('STORAGE_NOT_CURRENTLY_CERTIFIED')
  expect(f.transactions.sign).not.toHaveBeenCalled()
})
it('unpaid staged encryption can be archived after a rejected quote', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('renew')).rejects.toThrow('quote declined')
  expect((await f.controller.archive()).status).toBe('ARCHIVED')
})
it('an exact cached committed document unlocks for renewal without downloading expired storage', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const record = structuredClone(f.record); f.commit(record); await f.controller.archive(); f.controller.lock()
  expect((await f.controller.unlockBackup(record)).library.revision).toBe('1')
  expect((await f.controller.start('renew')).status).toBe('SAVED')
  expect(f.record.context.revision).toBe('2'); expect(f.payments.upload).toHaveBeenCalledTimes(2)
})
it('an old encrypted backup cannot replace the current head', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const record = structuredClone(f.record)
  await expect(f.controller.unlockBackup(record)).rejects.toThrow('BACKUP_NOT_CURRENT')
})

it('explicit add/remove preserves newest-first entries, hides Soul IDs from every public journal, and skips noops', async () => {
  const f = await fixture(); await f.controller.unlock()
  expect(await f.controller.start('set', id(801), false)).toEqual({ status: 'UNCHANGED', record: null })
  expect(f.payments.upload).not.toHaveBeenCalled()
  for (const soul of [id(801), id(802)]) {
    expect((await f.controller.start('set', soul, true)).status).toBe('SAVED')
    expect(JSON.stringify(f.record)).not.toContain(soul)
    expect([...f.local.values()].join('')).not.toContain(soul)
    f.commit(f.record); await f.controller.archive(); await f.controller.unlock()
  }
  expect(await f.controller.start('set', id(801), true)).toEqual({ status: 'UNCHANGED', record: null })
  expect(f.payments.upload).toHaveBeenCalledTimes(2)
  await f.controller.start('set', id(801), false)
  expect(f.documents.get(f.record.cipherSha256)!.entries.map(row => row.soulId)).toEqual([id(802)])
  f.commit(f.record); await f.controller.archive(); await f.controller.unlock()
  await f.controller.start('set', id(801), true)
  expect(f.documents.get(f.record.cipherSha256)!.entries.map(row => row.soulId)).toEqual([id(801), id(802)])
})
it('a cold unpaid retry decrypts the frozen desired state before any new payment', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('set', id(803), true)).rejects.toThrow('quote declined')
  const cold = createPrivateBookmarkController(f.params)
  expect((await cold.resume()).status).toBe('SAVED')
  expect(f.readers.decryptRecovery).toHaveBeenCalledOnce()
  expect(f.documents.get(f.record.cipherSha256)!.intent).toMatchObject({ action: 'set', soulId: id(803), bookmarked: true })
})
it('invalid orphan decryption blocks the first payment on a cold retry', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('set', id(803), true)).rejects.toThrow('quote declined')
  f.readers.decryptRecovery.mockRejectedValue(new Error('invalid AES or wrapped key'))
  await expect(createPrivateBookmarkController(f.params).resume()).rejects.toThrow('invalid AES or wrapped key')
  expect(f.payments.upload).toHaveBeenCalledTimes(1); expect(f.transactions.sign).not.toHaveBeenCalled()
})
it('validly decrypted add cannot smuggle deletion of an existing private bookmark', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('set', id(811), true)
  f.commit(f.record); await f.controller.archive(); await f.controller.unlock(); f.setQuery('MISSING')
  f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('set', id(812), true)).rejects.toThrow('quote declined')
  const forged = structuredClone(f.documents.get(f.record.cipherSha256)!)
  forged.entries = forged.entries.filter(row => row.soulId === id(812))
  expect(validatePrivateBookmarkLibrary(forged, f.scope, forged.revision)).toEqual(forged)
  f.readers.decryptRecovery.mockResolvedValue(forged)
  await expect(createPrivateBookmarkController(f.params).resume()).rejects.toThrow('RECOVERY_MUTATION_MISMATCH')
  expect(f.payments.upload).toHaveBeenCalledTimes(2); expect(f.transactions.sign).toHaveBeenCalledTimes(1)
})
it('pre-sign explicit rebase preserves the old paid envelope and the original desired boolean', async () => {
  const f = await fixture(); await f.controller.unlock(); f.confirmHead.mockResolvedValueOnce(false)
  await expect(f.controller.start('set', id(820), true)).rejects.toThrow('APPROVAL_CANCELLED')
  const old = structuredClone(f.record)
  expect((await f.controller.rebase()).status).toBe('SAVED')
  expect(f.archive.get(old.context.requestId)).toEqual({ ...old, sequence: old.sequence + 1, status: 'ARCHIVED' })
  expect(f.record.context.requestId).not.toBe(old.context.requestId)
  expect(f.record.cipherSha256).not.toBe(old.cipherSha256)
  expect(f.documents.get(f.record.cipherSha256)!.intent).toMatchObject({ action: 'set', soulId: id(820), bookmarked: true })
})
it('a writer that resolves without retaining the staged bytes fails readback before payment', async () => {
  const f = await fixture(); await f.controller.unlock(); f.store.replace = vi.fn(async () => {})
  await expect(f.controller.start('renew')).rejects.toThrow('RECOVERY_READBACK_FAILED')
  expect(f.payments.upload).not.toHaveBeenCalled()
})
it('a lost archive cannot be reported complete or silently discard the only recovery copy', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const archive = f.store.archive
  f.store.archive = async (key, expected) => { await archive(key, expected); f.archive.clear() }
  await expect(f.controller.archive()).rejects.toThrow('RECOVERY_ARCHIVE_READBACK_FAILED')
})
it('concurrent mutation cannot start while the encrypted staging operation holds the lock', async () => {
  const f = await fixture(); await f.controller.unlock()
  const encrypt = f.readers.encrypt.getMockImplementation()!
  let finish!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  f.readers.encrypt.mockImplementationOnce(async (...args) => { entered(); await new Promise<void>(resolve => { finish = resolve }); return encrypt(...args) })
  const pending = f.controller.start('set', id(825), true); await started
  await expect(f.controller.start('set', id(826), true)).rejects.toThrow('busy')
  finish(); expect((await pending).status).toBe('SAVED'); expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('locking while encryption is pending prevents late staging and payment', async () => {
  const f = await fixture(); await f.controller.unlock()
  const encrypt = f.readers.encrypt.getMockImplementation()!
  let finish!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  f.readers.encrypt.mockImplementationOnce(async (...args) => { entered(); await new Promise<void>(resolve => { finish = resolve }); return encrypt(...args) })
  const pending = f.controller.start('renew'); await started; f.controller.lock(); finish()
  await expect(pending).rejects.toThrow('READ_SUPERSEDED')
  expect(await f.controller.inspect()).toBeNull(); expect(f.payments.upload).not.toHaveBeenCalled()
})
it('contradictory terminal evidence never overwrites a previously verified transaction result', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  f.setQuery('FAILED')
  await expect(f.controller.resume(true)).rejects.toThrow('TRANSACTION_RESULT_UNCONFIRMED')
  expect(f.record.transaction!.packet.phase).toBe('SUCCEEDED')
})
it('late public reconciliation after a wallet switch does not notify the replacement wallet UI', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const onRecord = vi.fn(), cold = createPrivateBookmarkController({ ...f.params, onRecord })
  f.setAddress(id(830)); expect((await cold.resume(true)).status).toBe('SAVED')
  expect(onRecord).not.toHaveBeenCalled()
})
it('manual lock during durable staging prevents later payment', async () => {
  const f = await fixture(); await f.controller.unlock()
  const replace = f.store.replace
  f.store.replace = async (...args) => { await replace(...args); if (args[1] === null) f.controller.lock() }
  await expect(f.controller.start('renew')).rejects.toThrow('READ_SUPERSEDED')
  expect(f.payments.upload).not.toHaveBeenCalled()
})
it('manual lock during cold decrypt cannot silently reopen private memory or pay', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('renew')).rejects.toThrow('quote declined')
  const cold = createPrivateBookmarkController(f.params), decrypt = f.readers.decryptRecovery.getMockImplementation()!
  f.readers.decryptRecovery.mockImplementationOnce(async record => { const value = await decrypt(record); cold.lock(); return value })
  f.payments.upload.mockClear()
  await expect(cold.resume()).rejects.toThrow('READ_SUPERSEDED')
  expect(f.payments.upload).not.toHaveBeenCalled(); expect(cold.readUnlocked()).toBeNull()
})
it('a verified save reuses its already-authorized plaintext only after the matching current head is read', async () => {
  const f = await fixture(); await f.controller.unlock()
  f.transactions.broadcast.mockImplementationOnce(async () => { f.commit(f.record); f.setQuery('SUCCEEDED') })
  expect((await f.controller.start('set', id(840), true)).status).toBe('SAVED')
  expect(f.controller.readUnlocked()?.library.entries.map(row => row.soulId)).toEqual([id(840)])
  expect(f.readers.unlock).toHaveBeenCalledTimes(1)
  f.controller.lock(); expect(f.controller.readUnlocked()).toBeNull()
})
it('historical success without its exact current head leaves the private library locked, not empty', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('set', id(841), true)
  expect(f.record.status).toBe('COMPLETE'); expect(f.controller.readUnlocked()).toBeNull()
})
it.each([false, true])('a late post-save head read cannot overwrite or clear a newer explicit unlock (failure=%s)', async fail => {
  const f = await fixture(); await f.controller.unlock()
  const read = f.readers.head.getMockImplementation()!
  let release!: () => void, entered!: () => void, captured = false
  const waiting = new Promise<void>(resolve => { entered = resolve })
  f.readers.head.mockImplementation(async () => {
    const value = await read()
    if (f.record?.status === 'COMPLETE' && !captured) {
      captured = true; entered(); await new Promise<void>(resolve => { release = resolve })
      if (fail) throw new Error('old head unavailable')
    }
    return value
  })
  f.transactions.broadcast.mockImplementationOnce(async () => { f.commit(f.record); f.setQuery('SUCCEEDED') })
  const pending = f.controller.start('renew'); await waiting
  const next = preparePrivateBookmarkMutation(f.documents.get(f.record.cipherSha256)!, { scope: f.scope, action: 'set', soulId: id(850),
    bookmarked: true, expectedRevision: '1', requestId: 'ef'.repeat(32), at: '2026-09-15T20:00:00.000Z' }).library
  const snapshot = await read(); snapshot.revision = next.revision
  snapshot.head = { scope: f.scope, revision: next.revision, ciphertext: f.record.storage!.reference,
    receipts: next.receipts.map(row => ({ requestId: row.requestId, revision: row.result.revision, ciphertext: f.record.storage!.reference })) }
  f.setSnapshot(snapshot); f.readers.unlock.mockResolvedValueOnce({ snapshot, library: next, endEpoch: null })
  expect((await f.controller.unlock()).library.revision).toBe('2')
  release(); expect((await pending).status).toBe('SAVED')
  expect(f.controller.readUnlocked()?.library.revision).toBe('2')
})
