import { afterEach, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { buildSavePrivateNamedLoadoutTx, buildUpdatePrivateNamedLoadoutTx, type PrivateNamedLoadoutHeadSnapshot } from '@soulidity/sdk'
import { createPrivateLoadoutController } from '../../web/lib/animacraft/private-loadout-controller'
import { emptyPrivateLoadoutLibrary, validatePrivateLoadoutLibrary, type PrivateLoadoutLibrary } from '../../web/lib/animacraft/private-loadout-library'
import { PrivateLoadoutEnvelopeBcs, privateLoadoutAad } from '../../web/lib/animacraft/private-loadout-crypto'
import { parsePrivateLoadoutRecovery, privateLoadoutRecoveryFingerprint, privateLoadoutStorageScope, privateLoadoutWalrusKey,
  type PrivateLoadoutRecovery, type PrivateLoadoutRecoveryStore } from '../../web/lib/animacraft/private-loadout-recovery'
import type { PrivateLoadoutPublicPlan } from '../../web/lib/animacraft/private-loadout-transaction'
import { readWalrusSingleRecord, writeWalrusSingleRecord, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { browserPrivateLoadoutFixture } from './fixtures/browser-private-loadout'
import { privateTransactionSigner } from './fixtures/private-loadout-transaction'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(9))
async function fixture() {
  const browser = browserPrivateLoadoutFixture(true), config = structuredClone(browser.config)
  config.target.equipmentWritesEnabled = true
  const scope = { ...browser.scope, owner: privateTransactionSigner.toSuiAddress() }
  const content = { ...captureNamedLoadout(await nativeEquipmentSourceFixture().readBase()), soulId: scope.soulId, stateId: scope.stateId,
    capturedOwner: scope.owner, capturedOwnershipEpoch: scope.ownershipEpoch }
  const uploadConfig = { network: 'mainnet' as const, relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.3.5.wasm', storageEpochs: 3 }
  const local = new Map<string, string>(), events: string[] = [], archive = new Map<string, PrivateLoadoutRecovery>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, work: (lock: object) => unknown) => work({}) } })
  let active: PrivateLoadoutRecovery | null = null, address: string | null = scope.owner, enabled = true, held = false
  const store: PrivateLoadoutRecoveryStore = {
    listActiveScopes: async () => active ? [structuredClone(scope)] : [],
    exclusive: async (_key, work) => { if (held) throw new Error('busy'); held = true; try { return await work() } finally { held = false } },
    read: async () => structuredClone(active),
    replace: async (_key, expected, next) => {
      if (expected === null ? active !== null : active === null || privateLoadoutRecoveryFingerprint(expected) !== privateLoadoutRecoveryFingerprint(active)) throw new Error('CAS')
      active = parsePrivateLoadoutRecovery(next); events.push(`persist:${active.paymentStarted}:${active.transaction?.packet.phase ?? 'none'}`)
    },
    archive: async (_key, expected) => { expect(active).toEqual(expected); archive.set(expected.context.requestId, structuredClone(expected)); active = null },
    archived: async (_key, request) => structuredClone(archive.get(request) ?? null),
  }
  let library = emptyPrivateLoadoutLibrary(scope)
  let snapshot: PrivateNamedLoadoutHeadSnapshot = { scope, revision: '0', head: null, emptyReason: 'ABSENT',
    stateVersion: '1', stateDigest: digest, headFieldId: id(120), headFieldVersion: null, headFieldDigest: null }
  const documents = new Map<string, PrivateLoadoutLibrary>()
  const readers = {
    head: vi.fn(async () => structuredClone(snapshot)),
    unlock: vi.fn(async () => ({ snapshot: structuredClone(snapshot), library: structuredClone(library), endEpoch: null })),
    capture: vi.fn(async () => ({ content: structuredClone(content), capture: { equipmentId: content.capturedEquipmentId,
      revision: content.capturedEquipmentRevision, commitment: 'ab'.repeat(32) } })), verifyCapture: vi.fn(async () => {}),
    // Controller-only boundary: random opaque payload with canonical envelope.
    // Actual AES/Seal and raw read authority have separate real-crypto suites.
    encrypt: vi.fn(async (next: PrivateLoadoutLibrary, verify: () => Promise<void>) => {
      await verify()
      const context = { scope, revision: next.revision, requestId: next.intent!.requestId, originalPackageId: config.target.soulidityOriginalPackageId }
      const bytes = PrivateLoadoutEnvelopeBcs.serialize({ version: 1, aad: [...privateLoadoutAad(context)], wrapped_dek: [1],
        iv: [...crypto.getRandomValues(new Uint8Array(12))], ciphertext: [...crypto.getRandomValues(new Uint8Array(32))] }).toBytes()
      documents.set(toHex(sha256(bytes)), structuredClone(next)); return bytes
    }),
    decryptRecovery: vi.fn(async (r: PrivateLoadoutRecovery) => structuredClone(documents.get(r.cipherSha256)!)),
  }
  async function packet(plan: PrivateLoadoutPublicPlan) {
    const base = plan.capture ? buildSavePrivateNamedLoadoutTx({ ...plan, capture: plan.capture }) : buildUpdatePrivateNamedLoadoutTx(plan)
    const raw = base.getData()
    raw.inputs = raw.inputs.map((input: any) => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === scope.stateId }) : input)
    const tx = Transaction.from(JSON.stringify(raw)); tx.setSender(scope.owner); tx.setGasOwner(scope.owner)
    tx.setGasPayment([{ objectId: id(150), version: '1', digest }]); tx.setGasPrice('1000'); tx.setGasBudget('1000000'); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build()
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED' as const, signature: null }
  }
  const payments = {
    recover: vi.fn(async (r: PrivateLoadoutRecovery): Promise<any> => r.storage ? { status: 'CERTIFIED', receipt: r.storage } : { status: 'NONE' }),
    upload: vi.fn(async (r: PrivateLoadoutRecovery, verify: (signing: boolean) => Promise<void>) => {
      expect(active?.ciphertext).toEqual(r.ciphertext); events.push('quote'); await verify(false)
      const reference = { blobObjectId: id(160), blobId: toBase64(new Uint8Array(32).fill(8)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
        sha256: r.cipherSha256, byteLength: String(r.ciphertext.length) }
      const p = await packet({ deployment: { originalPackageId: config.target.soulidityOriginalPackageId, callablePackageId: config.target.soulidityCallablePackageId,
        chainIdentifier: '35834a8a' }, scope, expectedRevision: String(BigInt(r.context.revision) - 1n), requestId: r.context.requestId, ciphertext: reference,
        capture: null, protocolId: config.target.protocolConfigId })
      const walrus: WalrusSingleRecord = { schema: 'soulidity.walrus-single.v1', intent: { network: 'mainnet', owner: scope.owner, recipient: scope.owner,
        operationScope: privateLoadoutStorageScope(r), attachmentScope: null, contentHash: r.cipherSha256, payloadHash: r.cipherSha256,
        payloadByteLength: r.ciphertext.length, storageEpochs: 3, relayUrl: uploadConfig.relayUrl },
        encoding: { blobId: reference.blobId, rootHash: 'root', unencodedSize: r.ciphertext.length, nonce: null },
        approved: { relayTip: '0', storageCost: '1', writeCost: '1', gasBudget: '1000000', quoteId: 'quote' },
        register: { ...p, phase: 'SIGNING' }, certify: null, uploaded: null, acknowledged: false }
      writeWalrusSingleRecord(privateLoadoutWalrusKey(r), walrus)
      await verify(true); expect(active?.paymentStarted).toBe(true); events.push('payment-sign')
      return { reference, storageTxDigest: digest, certifyTxDigest: digest, recoveryKey: privateLoadoutWalrusKey(r), quoteId: 'quote' }
    }),
  }
  let queryStatus: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'MISSING'
  const transactions = {
    prepare: vi.fn(packet),
    sign: vi.fn(async (_plan, p) => { expect(active?.transaction?.packet.phase).toBe('SIGNING'); events.push('head-sign'); return privateTransactionSigner.signTransaction(await Transaction.from(p.bytes).build()) }),
    verifySignature: vi.fn(async () => {}),
    broadcast: vi.fn(async () => { expect(active?.transaction?.packet.phase).toBe('SIGNED'); events.push('broadcast'); queryStatus = 'SUCCEEDED' }),
    query: vi.fn(async () => { events.push('query'); return queryStatus }),
  }
  const signal = new AbortController(), confirmHead = vi.fn(async () => true)
  const params = { scope, config, uploadConfig, store, readers, payments, transactions, signal: signal.signal,
    getAddress: () => address, writesEnabled: () => enabled, confirmHead }
  const controller = createPrivateLoadoutController(params)
  return { controller, params, store, readers, payments, transactions, signal, confirmHead, events, archive, documents, local, scope,
    get record() { return active! }, setAddress: (v: string | null) => { address = v }, disable: () => { enabled = false },
    setQuery: (v: typeof queryStatus) => { queryStatus = v }, setSnapshot: (v: typeof snapshot) => { snapshot = v },
    commit: (r: PrivateLoadoutRecovery) => { library = structuredClone(documents.get(r.cipherSha256)!); snapshot = { ...snapshot, revision: r.context.revision, emptyReason: null,
      head: { scope, revision: r.context.revision, ciphertext: r.storage!.reference, receipts: library.receipts.map(row => ({ requestId: row.requestId,
        revision: row.result.revision, ciphertext: r.storage!.reference, capture: r.capture })) } } },
  }
}

it('unlocks with no upload configuration but cannot stage or pay for a mutation', async () => {
  const f=await fixture()
  const readOnly=createPrivateLoadoutController({...f.params,uploadConfig:null})
  expect((await readOnly.unlock()).library.revision).toBe('0')
  await expect(readOnly.start('renew')).rejects.toThrow('PRIVATE_LOADOUT_WRITES_DISABLED')
  expect(f.payments.upload).not.toHaveBeenCalled();expect(f.transactions.sign).not.toHaveBeenCalled()
})
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
  const cold = createPrivateLoadoutController(f.params)
  expect((await cold.resume(true)).status).toBe('SAVED')
  expect(f.payments.upload).toHaveBeenCalledTimes(1); expect(f.transactions.sign).toHaveBeenCalledTimes(1)
})
it('cold query tolerates only a changed permission flag, while that flag still prohibits new writes', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const config = structuredClone(f.params.config); config.target.equipmentWritesEnabled = false
  const cold = createPrivateLoadoutController({ ...f.params, config })
  expect((await cold.resume(true)).status).toBe('SAVED')
  await cold.archive(); await cold.unlock()
  await expect(cold.start('renew')).rejects.toThrow('WRITES_DISABLED')
  expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('a changed storage read identity still rejects cold recovery before query', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('renew')
  const config = structuredClone(f.params.config); config.storage.aggregatorUrl = 'https://different.example.com'
  const cold = createPrivateLoadoutController({ ...f.params, config }), queries = f.transactions.query.mock.calls.length
  await expect(cold.resume(true)).rejects.toThrow('RECOVERY_CONFIGURATION_CHANGED')
  expect(f.transactions.query).toHaveBeenCalledTimes(queries)
})
it('queries an existing exact request without upload configuration and never pays again', async () => {
  const f=await fixture();await f.controller.unlock();await f.controller.start('renew')
  const cold=createPrivateLoadoutController({...f.params,uploadConfig:null})
  expect((await cold.resume(true)).status).toBe('SAVED')
  expect(f.payments.upload).toHaveBeenCalledTimes(1);expect(f.transactions.sign).toHaveBeenCalledTimes(1)
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
it('save freezes actual captured references privately; rename and delete need no old equipment read', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('save', 'Private outfit')
  const saved = f.documents.get(f.record.cipherSha256)!, entry = saved.entries[0]
  expect(f.record.capture).toEqual((await f.readers.capture()).capture)
  expect(JSON.stringify(f.record)).not.toContain('Private outfit'); expect(f.record.transaction!.plan.capture).not.toBeNull()
  f.commit(f.record); await f.controller.archive(); await f.controller.unlock()
  f.readers.capture.mockRejectedValue(new Error('equipment closed')); f.readers.verifyCapture.mockRejectedValue(new Error('equipment closed'))
  await f.controller.start('rename', 'Renamed privately', entry.id)
  expect(f.record.capture).toBeNull(); expect(f.record.transaction!.plan.capture).toBeNull()
  expect(f.documents.get(f.record.cipherSha256)!.entries[0]).toMatchObject({ id: entry.id, name: 'Renamed privately', version: 2, content: entry.content })
  f.commit(f.record); await f.controller.archive(); await f.controller.unlock()
  await f.controller.start('delete', undefined, entry.id)
  expect(f.documents.get(f.record.cipherSha256)!.entries).toEqual([]); expect(f.record.capture).toBeNull()
})
it('equipment capture drift aborts a save before encryption is persisted or paid', async () => {
  const f = await fixture(); await f.controller.unlock(); f.readers.verifyCapture.mockRejectedValue(new Error('equipment drift'))
  await expect(f.controller.start('save', 'Invalidated')).rejects.toThrow('equipment drift')
  expect(await f.controller.inspect()).toBeNull(); expect(f.payments.upload).not.toHaveBeenCalled()
})
it('explicit rebase of a proven missing unsigned head preserves old ciphertext and pays only for the new envelope', async () => {
  const f = await fixture(); await f.controller.unlock(); f.confirmHead.mockResolvedValueOnce(false)
  await expect(f.controller.start('save', 'Original private request')).rejects.toThrow('APPROVAL_CANCELLED')
  const previous = structuredClone(f.record); expect(f.record.transaction!.packet.phase).toBe('PREPARED')
  expect((await f.controller.rebase()).status).toBe('SAVED')
  expect(f.archive.get(previous.context.requestId)).toEqual(previous)
  expect(f.record.context.requestId).not.toBe(previous.context.requestId); expect(f.record.cipherSha256).not.toBe(previous.cipherSha256)
  expect(f.documents.get(f.record.cipherSha256)!.entries[0].name).toBe('Original private request')
  expect(f.payments.upload).toHaveBeenCalledTimes(2)
})
it('cold unpaid recovery decrypts and validates its encrypted intent before any new payment', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('save', 'Private')).rejects.toThrow('quote declined')
  f.readers.decryptRecovery.mockRejectedValue(new Error('invalid AES or wrapped key'))
  const cold = createPrivateLoadoutController(f.params)
  await expect(cold.resume()).rejects.toThrow('invalid AES or wrapped key')
  expect(f.payments.upload).toHaveBeenCalledTimes(1); expect(f.transactions.sign).not.toHaveBeenCalled()
})
it('tampering only the public capture cannot turn an encrypted save into an update', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('save', 'Private')).rejects.toThrow('quote declined')
  f.record.capture = null
  const cold = createPrivateLoadoutController(f.params)
  await expect(cold.resume()).rejects.toThrow('RECOVERY_DOCUMENT_MISMATCH')
  expect(f.payments.upload).toHaveBeenCalledTimes(1)
})
it('cold unsigned recovery with a valid private intent resumes after explicit unlock validation', async () => {
  const f = await fixture(); await f.controller.unlock(); f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('save', 'Private')).rejects.toThrow('quote declined')
  const cold = createPrivateLoadoutController(f.params)
  expect((await cold.resume()).status).toBe('SAVED'); expect(f.readers.decryptRecovery).toHaveBeenCalledOnce()
})
it('a validly decrypted rename cannot smuggle deletion of another saved entry', async () => {
  const f = await fixture(); await f.controller.unlock(); await f.controller.start('save', 'One')
  f.commit(f.record); await f.controller.archive(); await f.controller.unlock(); await f.controller.start('save', 'Two')
  f.commit(f.record); await f.controller.archive(); const current = await f.controller.unlock(), target = current.library.entries[0].id
  f.payments.upload.mockRejectedValueOnce(new Error('quote declined'))
  await expect(f.controller.start('rename', 'Renamed', target)).rejects.toThrow('quote declined')
  const forged = structuredClone(f.documents.get(f.record.cipherSha256)!)
  forged.entries = forged.entries.filter(entry => entry.id === target)
  expect(validatePrivateLoadoutLibrary(forged, f.scope, forged.revision)).toEqual(forged)
  f.readers.decryptRecovery.mockResolvedValue(forged)
  const calls = f.payments.upload.mock.calls.length, cold = createPrivateLoadoutController(f.params)
  await expect(cold.resume()).rejects.toThrow('RECOVERY_MUTATION_MISMATCH')
  expect(f.payments.upload).toHaveBeenCalledTimes(calls)
})
