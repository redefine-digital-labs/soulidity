import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { batchDurableFixture } from './fixtures/walrus-batch-durable'
import { createWalrusBatchRecord } from '../../web/lib/upload/walrus-batch-store'
import { exportWalrusBatchPreparation, prepareWalrusBatch, walrusBatchPreparationHash } from '../../web/lib/upload/walrus-batch-preparation'
import { soulAuthoringUploadScope, type SoulAuthoringRequest } from '../../web/lib/soulidity/soul-authoring-manifest'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { soulAuthoringPlan } from '../../web/lib/soulidity/soul-authoring-runner'
import { SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/index'

// Actual isolated Chrome IndexedDB, strict transactions and cross-tab Locks.
// Prepared AES/WASM bytes and public parent packets originate in the controlled
// Node fixture. Browser receives no fixture encryption/signing keys or network.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, origin: string, primary: string, secondary: string
let initial: any, stages: any[], completed: any, alternate: any, authoring: any, authorPackets: any[]
let id = 0
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cdp(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const callId = ++id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { calls.delete(callId); reject(Error(`Chrome command timed out: ${method}`)) }, 15000)
    calls.set(callId, { resolve, reject, timer })
    ;(chrome.stdio[3] as Duplex).write(`${JSON.stringify({ id: callId, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
  })
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}, session = primary): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true, returnByValue: true }, session)
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}
function wire(record: any) { return { ...record, preparation: JSON.parse(exportWalrusBatchPreparation(record.preparation)) } }
async function ready(session: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await run(() => Boolean((globalThis as any).S && (globalThis as any).P), {}, session)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error(`Browser bundle unavailable: ${JSON.stringify(await run(() => (globalThis as any).__bootErrors, {}, session))}`)
}
beforeAll(async () => {
  const fixture = await batchDurableFixture({ files: 2 })
  initial = wire(createWalrusBatchRecord(fixture.preparation))
  await fixture.register(); await fixture.adapter.completeUploads(); await fixture.consume([0, 1])
  stages = fixture.memory.checkpoints.map(wire); completed = wire(fixture.memory.get())
  alternate = wire(createWalrusBatchRecord((await batchDurableFixture({ files: 2 })).preparation))
  const oid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const request: SoulAuthoringRequest = { schema: 'soulidity.soul-authoring-request.v1',
    author: fixture.preparation.manifest.scope.owner, operationId: '1'.repeat(32), storageEpochs: 5,
    target: { chainIdentifier: '35834a8a', originalPackageId: oid(1), callablePackageId: oid(10),
      callableDigest: toBase58(new Uint8Array(32).fill(7)), marketConfigId: oid(11), kioskRegistryId: oid(12),
      personalKioskTypePackageId: oid(13), paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: oid(14),
      kioskPackageId: oid(15), kindRegistryId: oid(16), soulTransferPolicyId: oid(17), blobBaseUrl: 'https://aggregator.example.com' },
    collection: { name: 'Empty collection', description: 'Creation recovery fixture',
      image: { kind: 'URL', url: 'https://images.example.com/cover.png' }, extraRoyaltyBps: 0,
      tradeable: true, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }, bindCollectionId: null, mints: [] }
  const preparation = await prepareWalrusBatch({ scope: soulAuthoringUploadScope(request), files: [], storageEpochs: 5,
    client: {} as any, protector: null, lifetime: { signal: new AbortController().signal, getAddress: () => request.author, isCurrent: () => true } })
  authoring = { schema: 'soulidity.soul-authoring-preparation.v1', preparation: JSON.parse(exportWalrusBatchPreparation(preparation)),
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(preparation),
      sealContext: null, sidecars: [] } }
  authorPackets = []
  for (const number of [1, 2]) {
    const tx = new Transaction(); tx.setSender(request.author); tx.setGasOwner(request.author)
    tx.setGasBudget(100000); tx.setGasPrice(1); tx.setExpiration({ Epoch: '10' })
    tx.setGasPayment([{ objectId: oid(900), version: '1', digest: toBase58(new Uint8Array(32).fill(9)) }])
    tx.moveCall({ target: `${request.target.callablePackageId}::test::storage_only_packet`, arguments: [tx.pure.u64(number)] })
    const bytes = await tx.build()
    authorPackets.push({ schema: 'soulidity.soul-authoring-packet.v1', plan: soulAuthoringPlan(authoring, {
      kind: 'REGISTER', kiosk: { kind: 'EXISTING', kioskId: oid(80), capId: oid(81) } }),
    packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null } })
  }
  vi.restoreAllMocks()
  const bundle = await build({ stdin: { contents: `import * as S from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-batch-store.ts'))};
import * as P from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-batch-preparation.ts'))};
import * as A from ${JSON.stringify(resolve(root, 'web/lib/soulidity/soul-authoring-store.ts'))};
import * as J from ${JSON.stringify(resolve(root, 'web/lib/soulidity/soul-authoring-journal.ts'))}; Object.assign(globalThis,{S,P,A,J});`,
  sourcefile: 'walrus-batch-store-browser.ts', resolveDir: resolve(root, 'web') }, bundle: true, platform: 'browser', format: 'esm', write: false,
  target: 'es2022', logLevel: 'silent', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local test server unavailable')
  origin = `http://127.0.0.1:${address.port}`; profile = await mkdtemp(join(tmpdir(), 'walrus-batch-idb-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw Error('Actual IndexedDB tests require installed Chrome/Chromium or CHROME_BIN')
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let buffered = ''
  ;(chrome.stdio[4] as Duplex).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const end = buffered.indexOf('\0'); if (end < 0) break
      const raw = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (!raw) continue
      const message = JSON.parse(raw), call = calls.get(message.id)
      if (call) { calls.delete(message.id); clearTimeout(call.timer); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result) }
    }
  })
  chrome.on('error', error => { for (const call of calls.values()) { clearTimeout(call.timer); call.reject(error) } calls.clear() })
  chrome.on('exit', () => { for (const call of calls.values()) { clearTimeout(call.timer); call.reject(Error('Isolated Chrome exited')) } calls.clear() })
  for (const name of ['primary', 'secondary']) {
    const { targetId } = await cdp('Target.createTarget', { url: `${origin}/${name}` })
    const session = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
    if (name === 'primary') primary = session; else secondary = session
    await ready(session)
  }
}, 30000)
beforeEach(async () => {
  await run(async (input) => {
    const g = globalThis as any
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('soulidity-walrus-batch'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => reject(Error('blocked test reset')) })
    const decode = (record: any) => ({ ...record, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(record.preparation)) })
    g.initial = decode(input.initial); g.alternate = decode(input.alternate); g.stages = input.stages.map(decode); g.completed = decode(input.completed)
    g.store = g.S.browserWalrusBatchStore(); g.key = g.S.walrusBatchStoreKey(g.initial.preparation.manifest.scope)
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    g.install = async () => {
      await g.store.create(g.key, g.initial)
      let previous = g.initial
      for (const next of g.stages) { await g.store.compareAndSwap(g.key, g.S.walrusBatchRecordHash(previous), next); previous = next }
    }
    g.raw = async (store: string, key: string, value?: unknown) => {
      const db = await g.S.openWalrusBatchDatabase()
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, value === undefined ? 'readonly' : 'readwrite')
        const request = value === undefined ? tx.objectStore(store).get(key) : tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error)
      }) } finally { db.close() }
    }
  }, { initial, alternate, stages, completed })
})
afterAll(async () => {
  if (chrome) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})
it('persists real encrypted payload buffers and recovers through a new store without localStorage or original Files', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const recovered = await g.S.browserWalrusBatchStore().read(g.key)
    return { hash: g.S.walrusBatchRecordHash(recovered), expected: g.S.walrusBatchRecordHash(g.initial),
      bytes: recovered.preparation.payloads.every((value: unknown) => value instanceof Uint8Array), localKeys: localStorage.length,
      exported: g.P.exportWalrusBatchPreparation(recovered.preparation), errors: g.__bootErrors }
  })
  expect(result.hash).toBe(result.expected); expect(result.bytes).toBe(true); expect(result.localKeys).toBe(0)
  expect(result.exported).not.toMatch(/"dek"|"plaintext"|Private soul document/); expect(result.errors).toEqual([])
})
it('rejects a different encrypted preparation in the same unresolved scope without replacing the old record', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const error = await g.errorOf(() => g.store.create(g.key, g.alternate))
    return { error, actual: g.S.walrusBatchRecordHash(await g.store.read(g.key)), expected: g.S.walrusBatchRecordHash(g.initial) }
  })
  expect(result.error).toContain('UNRESOLVED_OPERATION'); expect(result.actual).toBe(result.expected)
})
it('CAS keeps sequential per-file certificates and rejects a stale concurrent writer', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const old = g.S.walrusBatchRecordHash(g.initial)
    await g.store.compareAndSwap(g.key, old, g.stages[0])
    const error = await g.errorOf(() => g.store.compareAndSwap(g.key, old, g.stages[1]))
    await g.store.compareAndSwap(g.key, g.S.walrusBatchRecordHash(g.stages[0]), g.stages[1])
    return { error, certificates: (await g.store.read(g.key)).certificates.length }
  })
  expect(result.error).toContain('CAS_MISMATCH'); expect(result.certificates).toBe(1)
})
it('requires a durable initial record before accepting a restored paid checkpoint', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    return { create: await g.errorOf(() => g.store.create(g.key, g.completed)),
      update: await g.errorOf(() => g.store.compareAndSwap(g.key, g.S.walrusBatchRecordHash(g.initial), g.stages[0])), actual: await g.store.read(g.key) }
  })
  expect(result.create).toContain('INITIAL_RECORD_REQUIRED'); expect(result.update).toContain('CAS_MISSING_RECORD'); expect(result.actual).toBeNull()
})
it('retains the active record when strict IndexedDB put fails', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new DOMException('Injected quota failure', 'QuotaExceededError') }
    let error
    try { error = await g.errorOf(() => g.store.compareAndSwap(g.key, g.S.walrusBatchRecordHash(g.initial), g.stages[0])) }
    finally { IDBObjectStore.prototype.put = original }
    return { error, actual: g.S.walrusBatchRecordHash(await g.store.read(g.key)), expected: g.S.walrusBatchRecordHash(g.initial) }
  })
  expect(result.error).toContain('Injected quota failure'); expect(result.actual).toBe(result.expected)
})
it('readback failure never reports success or silently starts a replacement', async () => {
  const result = await run(async () => {
    const g = globalThis as any, original = IDBObjectStore.prototype.get; let calls = 0
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      if (++calls === 2) throw Error('Injected readback failure')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => g.store.create(g.key, g.initial)) } finally { IDBObjectStore.prototype.get = original }
    return { error, actual: g.S.walrusBatchRecordHash(await g.store.read(g.key)), expected: g.S.walrusBatchRecordHash(g.initial) }
  })
  expect(result.error).toContain('Injected readback failure'); expect(result.actual).toBe(result.expected)
})
it('corrupt persisted bytes are an explicit error, never a null/new operation', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const raw = await g.raw('active', g.key); raw.preparation.payloads[1][0] ^= 1; await g.raw('active', g.key, raw)
    return g.errorOf(() => g.store.read(g.key))
  })
  expect(result).toContain('PAYLOAD_MISMATCH')
})
it('native cross-tab lock excludes another uploader, then releases cleanly', async () => {
  const key = await run(() => {
    const g = globalThis as any
    g.held = g.store.exclusive(g.key, () => new Promise<void>(resolve => { g.releaseLock = resolve }))
    return g.key
  })
  for (let i = 0; i < 20; i++) { if (await run(() => Boolean((globalThis as any).releaseLock))) break; await new Promise(resolve => setTimeout(resolve, 10)) }
  const busy = await run(async ({ key }) => {
    const g = globalThis as any
    try { await g.S.browserWalrusBatchStore().exclusive(key, async () => 'wrong'); return null } catch (error) { return (error as Error).message }
  }, { key }, secondary)
  expect(busy).toContain('BUSY_IN_ANOTHER_TAB')
  await run(async () => { const g = globalThis as any; g.releaseLock(); await g.held; delete g.releaseLock })
  const next = await run(async ({ key }) => (globalThis as any).S.browserWalrusBatchStore().exclusive(key, async () => 'acquired'), { key }, secondary)
  expect(next).toBe('acquired')
})
it('archives only complete checkpoints and preserves exact ciphertext/parent history for cold queries', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.initial)
    const rejected = await g.errorOf(() => g.store.archive(g.key, g.S.walrusBatchRecordHash(g.initial)))
    let previous = g.initial
    for (const next of g.stages) { await g.store.compareAndSwap(g.key, g.S.walrusBatchRecordHash(previous), next); previous = next }
    const hash = g.S.walrusBatchRecordHash(previous), archiveKey = await g.store.archive(g.key, hash)
    return { rejected, head: await g.store.read(g.key), archived: g.S.walrusBatchRecordHash(await g.store.readArchive(archiveKey)), hash }
  })
  expect(result.rejected).toContain('ARCHIVE_COMPLETION_REQUIRED'); expect(result.head).toBeNull(); expect(result.archived).toBe(result.hash)
})
it('archive transaction failure leaves the original completed head recoverable', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.install()
    const hash = g.S.walrusBatchRecordHash(await g.store.read(g.key)), original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'archive') throw Error('Injected archive failure')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => g.store.archive(g.key, hash)) } finally { IDBObjectStore.prototype.put = original }
    return { error, actual: g.S.walrusBatchRecordHash(await g.store.read(g.key)), hash }
  })
  expect(result.error).toContain('Injected archive failure'); expect(result.actual).toBe(result.hash)
})
it('CAS rejects attempts to erase consumed history or rewrite the paid registration', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.install(); const previous = await g.store.read(g.key), hash = g.S.walrusBatchRecordHash(previous)
    const dropped = structuredClone(previous); dropped.revision++; dropped.consumptions = []
    const first = await g.errorOf(() => g.store.compareAndSwap(g.key, hash, dropped))
    const changed = structuredClone(previous); changed.revision++; changed.registration.blobs[0].version = '99'
    const second = await g.errorOf(() => g.store.compareAndSwap(g.key, hash, changed))
    return { first, second, actual: g.S.walrusBatchRecordHash(await g.store.read(g.key)), hash }
  })
  expect(result.first).toContain('CONSUMPTION_CANNOT_DISAPPEAR'); expect(result.second).toContain('REGISTER_ROOT_CANNOT_CHANGE'); expect(result.actual).toBe(result.hash)
})
it('atomically retains the author identity with uploader WAL; idempotent resume never resets its checkpoints', async () => {
  const result = await run(async input => {
    const g = globalThis as any, a = g.A.browserSoulAuthoringStore()
    const value = { ...input, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.preparation)) }
    const key = g.A.soulAuthoringStoreKey(value.manifest.request), batchKey = g.S.walrusBatchStoreKey(value.preparation.manifest.scope)
    await a.create(key, value)
    const initial = await g.store.read(batchKey), next = { ...initial, revision: 1 }
    await g.store.compareAndSwap(batchKey, g.S.walrusBatchRecordHash(initial), next)
    await a.create(key, value)
    const reopened = await g.A.browserSoulAuthoringStore().read(key)
    return { actual: g.A.soulAuthoringPreparationHash(reopened), expected: g.A.soulAuthoringPreparationHash(value),
      revision: (await g.store.read(batchKey)).revision }
  }, authoring)
  expect(result.actual).toBe(result.expected); expect(result.revision).toBe(1)
})
it('a failed parent write rolls back its upload row in the same native IDB transaction', async () => {
  const result = await run(async input => {
    const g = globalThis as any, a = g.A.browserSoulAuthoringStore()
    const value = { ...input, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.preparation)) }
    const key = g.A.soulAuthoringStoreKey(value.manifest.request), batchKey = g.S.walrusBatchStoreKey(value.preparation.manifest.scope)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'authoring') throw Error('Injected authoring disk failure')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => a.create(key, value)) } finally { IDBObjectStore.prototype.put = original }
    return { error, parent: await a.read(key), upload: await g.store.read(batchKey) }
  }, authoring)
  expect(result.error).toContain('Injected authoring disk failure'); expect(result.parent).toBeNull(); expect(result.upload).toBeNull()
})
it('cold authoring read reports a missing upload instead of permitting a fresh payment', async () => {
  const result = await run(async input => {
    const g = globalThis as any, a = g.A.browserSoulAuthoringStore()
    const value = { ...input, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.preparation)) }
    const key = g.A.soulAuthoringStoreKey(value.manifest.request), batchKey = g.S.walrusBatchStoreKey(value.preparation.manifest.scope)
    await a.create(key, value)
    const db = await g.S.openWalrusBatchDatabase()
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('active', 'readwrite'); tx.objectStore('active').delete(batchKey)
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    }) } finally { db.close() }
    return { read: await g.errorOf(() => a.read(key)), create: await g.errorOf(() => a.create(key, value)) }
  }, authoring)
  expect(result.read).toContain('UPLOAD_RECORD_MISSING'); expect(result.create).toContain('UPLOAD_RECORD_MISSING')
})
it('the author lane locks preparation and packet journals across actual browser tabs', async () => {
  try {
    await run(input => {
      const g = globalThis as any; g.authorKey = g.A.soulAuthoringStoreKey(input.manifest.request)
      g.authorEntered = false
      // Deliberately hold callback entry: CDP completion is not lock readiness.
      g.authorStart = new Promise<void>(resolve => { g.startAuthor = resolve })
      const held = new Promise<void>(resolve => { g.releaseAuthorLock = resolve })
      let entered!: () => void, failed!: (error: unknown) => void
      g.authorReady = new Promise<void>((resolve, reject) => { entered = resolve; failed = reject })
      g.authorLock = g.A.browserSoulAuthoringStore().exclusive(g.authorKey, async () => {
        await g.authorStart
        g.authorEntered = true; entered(); await held
      })
      void g.authorLock.catch(failed)
      return true
    }, authoring)
    expect(await run(() => (globalThis as any).authorEntered)).toBe(false)
    const entered = await run(async () => {
      const g = globalThis as any; g.startAuthor(); await g.authorReady; return g.authorEntered
    })
    expect(entered).toBe(true)
    const error = await run(async input => {
      const g = globalThis as any
      const value = { ...input, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.preparation)) }
      try { await g.J.browserSoulAuthoringPacketJournal(value).exclusive(`${g.A.soulAuthoringStoreKey(input.manifest.request)}:packets`, async () => true); return null }
      catch (error) { return (error as Error).message }
    }, authoring, secondary)
    expect(error).toContain('BUSY_IN_ANOTHER_TAB')
  } finally {
    // Release even if readiness, CDP, or an assertion fails, before the next test.
    await run(async () => { const g = globalThis as any; g.startAuthor?.(); g.releaseAuthorLock?.(); await g.authorLock })
  }
  expect(await run(async () => {
    const g = globalThis as any; return g.A.browserSoulAuthoringStore().exclusive(g.authorKey, async () => true)
  })).toBe(true)
})
it('packet journals require the durable parent, hold exact bytes and forbid replacing unknown signing packets', async () => {
  const result = await run(async input => {
    const g = globalThis as any, value = { ...input.authoring, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.authoring.preparation)) }
    const parentKey = g.A.soulAuthoringStoreKey(value.manifest.request), key = `${parentKey}:packets`, j = g.J.browserSoulAuthoringPacketJournal(value)
    const missing = await g.errorOf(() => j.read(key))
    await g.A.browserSoulAuthoringStore().create(parentKey, value)
    const unlocked = await g.errorOf(() => j.write(key, input.packets[0]))
    await j.exclusive(key, async () => {
      await j.write(key, input.packets[0]); await j.write(key, { ...input.packets[0], packet: { ...input.packets[0].packet, phase: 'SIGNING' } })
    })
    const replaced = await g.errorOf(() => j.exclusive(key, () => j.write(key, input.packets[1])))
    const reopened = await g.J.browserSoulAuthoringPacketJournal(value).read(key)
    return { missing, unlocked, replaced, phase: reopened.packet.phase, bytes: reopened.packet.bytes }
  }, { authoring, packets: authorPackets })
  expect(result.missing).toBeTruthy(); expect(result.unlocked).toContain('LOCK_REQUIRED'); expect(result.replaced).toContain('RECOVERY_REQUIRED')
  expect(result.phase).toBe('SIGNING'); expect(result.bytes).toBe(authorPackets[0].packet.bytes)
})
it('terminal packet replacement atomically preserves history; an archive failure leaves the previous head intact', async () => {
  const result = await run(async input => {
    const g = globalThis as any, value = { ...input.authoring, preparation: g.P.importWalrusBatchPreparation(JSON.stringify(input.authoring.preparation)) }
    const parentKey = g.A.soulAuthoringStoreKey(value.manifest.request), key = `${parentKey}:packets`, j = g.J.browserSoulAuthoringPacketJournal(value)
    await g.A.browserSoulAuthoringStore().create(parentKey, value)
    // Controlled terminal record: this tests storage only, not a chain proof.
    await j.exclusive(key, async () => {
      await j.write(key, input.packets[0]); await j.write(key, { ...input.packets[0], packet: { ...input.packets[0].packet, phase: 'FAILED' } })
    })
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'authoring-packets' && String(args[1]).includes(':history:')) throw Error('Injected packet archive failure')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => j.exclusive(key, () => j.write(key, input.packets[1]))) } finally { IDBObjectStore.prototype.put = original }
    const before = await j.read(key)
    await j.exclusive(key, () => j.write(key, input.packets[1]))
    const history = await j.history(key), after = await j.read(key)
    return { error, before, history, after }
  }, { authoring, packets: authorPackets })
  expect(result.error).toContain('Injected packet archive failure'); expect(result.before.packet.phase).toBe('FAILED')
  expect(result.history).toEqual([result.before]); expect(result.after).toEqual(authorPackets[1])
})
