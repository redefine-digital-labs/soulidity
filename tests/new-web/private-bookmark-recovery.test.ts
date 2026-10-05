import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeCdp } from '../helpers/chrome-cdp'
import { privateBookmarkRecoveryFixture } from './fixtures/private-bookmark-recovery'

// Real Chrome IndexedDB/Web Locks, using only existing Chrome + esbuild + Node.
// The isolated temporary profile never touches a user's browser or wallet.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, sessionId: string
let fixture: Awaited<ReturnType<typeof privateBookmarkRecoveryFixture>>
let connection: ReturnType<typeof chromeCdp> | undefined
let setupPhase = 'fixture'
let setupStopped = false
async function cleanupBrowser() {
  await connection?.close()
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  // Exact mkdtemp output only; no workspace or user profile is removed.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
async function checkSetup() {
  if (setupStopped) { await cleanupBrowser(); throw Error(`Browser startup cancelled at ${setupPhase}`) }
}
const cdp = (method: string, params: any = {}, session?: string) => {
  if (!connection) return Promise.reject(Error('Chrome connection not initialized'))
  return connection.call(method, params, session)
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true,
    returnByValue: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}

beforeAll(async () => {
  fixture = await privateBookmarkRecoveryFixture()
  await checkSetup()
  const entry = `import * as R from ${JSON.stringify(resolve(root, 'web/lib/bookmarks/private-bookmark-recovery.ts'))};
import * as W from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-single-operation.ts'))};
import * as C from ${JSON.stringify(resolve(root, 'web/lib/bookmarks/private-bookmark-crypto.ts'))};
import { toBase64, fromBase64, toHex } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject } from '@mysten/seal';
Object.assign(globalThis, { R, W, C, toBase64, fromBase64, toHex, sha256, EncryptedObject });`
  setupPhase = 'bundle'
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'recovery-browser-suite.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  await checkSetup()
  const script = bundle.outputFiles[0].contents
  setupPhase = 'HTTP server'
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(script) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  await checkSetup()
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local server unavailable')
  profile = await mkdtemp(join(tmpdir(), 'private-bookmark-idb-'))
  await checkSetup()
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw new Error('Real IndexedDB tests require installed Chrome/Chromium or CHROME_BIN; no mock fallback')
  setupPhase = 'spawn Chrome'
  chrome = spawn(executable, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  connection = chromeCdp(chrome, 'private-bookmark-recovery.test.ts')
  setupPhase = 'create/attach target'
  const { targetId } = await cdp('Target.createTarget', { url: `http://127.0.0.1:${address.port}` })
  await checkSetup()
  sessionId = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await checkSetup()
  for (let tries = 0; tries < 100; tries++) {
    await checkSetup()
    if (await run(() => Boolean((globalThis as any).R))) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const ready = await run(() => ({ ready: Boolean((globalThis as any).R && indexedDB && navigator.locks), errors: (globalThis as any).__bootErrors }))
  if (!ready.ready) throw new Error(`Isolated browser suite failed to load: ${JSON.stringify(ready.errors)}`)
  await checkSetup()
  setupPhase = 'ready'
}, 30000)

beforeEach(async () => {
  await run(async ({ record, paid, prepared, walrus }) => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-private-bookmark-recovery')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('blocked reset'))
    })
    const g = globalThis as any
    g.record = { ...record, ciphertext: new Uint8Array(record.ciphertext) }
    g.paid = { ...paid, ciphertext: new Uint8Array(paid.ciphertext) }
    g.prepared = { ...prepared, ciphertext: new Uint8Array(prepared.ciphertext) }
    g.walrus = walrus
    g.key = g.R.privateBookmarkRecoveryKey(g.record.context.scope, g.record.context.originalPackageId)
    g.store = g.R.browserPrivateBookmarkRecoveryStore()
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    // Raw keys deliberately permit corrupt/sentinel values so discovery tests
    // prove they never deserialize recovery ciphertext or assume key trust.
    g.seedScopeKeys = async (keys: IDBValidKey[], store = 'active') => {
      await g.store.read('fixture-database-initialization')
      await new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('soulidity-private-bookmark-recovery', 1)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result, tx = db.transaction(store, 'readwrite')
          tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => { db.close(); reject(tx.error) }
          for (const key of keys) tx.objectStore(store).put({ invalidCiphertextSentinel: true }, key)
        }
      })
    }
  }, { record: { ...fixture.record, ciphertext: [...fixture.record.ciphertext] },
    paid: { ...fixture.paid, ciphertext: [...fixture.paid.ciphertext] },
    prepared: { ...fixture.prepared, ciphertext: [...fixture.prepared.ciphertext] }, walrus: fixture.walrus })
})

afterAll(async () => {
  setupStopped = true
  if (setupPhase !== 'ready') console.error(`Browser setup stopped at ${setupPhase}; ${connection?.diagnostics() ?? 'Chrome not started'}`)
  await cleanupBrowser()
})

it('persists exact encrypted bytes through genuine IndexedDB and a fresh store instance', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const read = await g.R.browserPrivateBookmarkRecoveryStore().read(g.key)
    return { bytes: [...read.ciphertext], fingerprint: g.R.privateBookmarkRecoveryFingerprint(read),
      expected: g.R.privateBookmarkRecoveryFingerprint(g.record), entries: localStorage.length }
  })
  expect(result.bytes).toEqual([...fixture.record.ciphertext]); expect(result.fingerprint).toBe(result.expected)
  expect(result.entries).toBe(0)
})

it('serializes simultaneous CAS transactions and rejects the stale writer without losing committed bytes', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const next = { ...g.record, sequence: 1, paymentStarted: true }
    const other = g.R.browserPrivateBookmarkRecoveryStore()
    const results = await Promise.allSettled([g.store.replace(g.key, g.record, next), other.replace(g.key, g.record, next)])
    return { states: results.map(r => r.status), error: (results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message,
      saved: { sequence: (await g.store.read(g.key)).sequence, paymentStarted: (await g.store.read(g.key)).paymentStarted } }
  })
  expect(result.states.sort()).toEqual(['fulfilled', 'rejected']); expect(result.error).toContain('CAS_CONFLICT')
  expect(result.saved).toEqual({ sequence: 1, paymentStarted: true })
})

it('rejects payment marker reversal, frozen intent replacement, sequence skip and wrong expected record', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const marker = { ...g.record, sequence: 1, paymentStarted: true }; await g.store.replace(g.key, g.record, marker)
    return {
      marker: await g.errorOf(() => g.store.replace(g.key, marker, { ...marker, sequence: 2, paymentStarted: false })),
      sequence: await g.errorOf(() => g.store.replace(g.key, marker, { ...marker, sequence: 3 })),
      frozen: await g.errorOf(() => g.store.replace(g.key, marker, { ...marker, sequence: 2, uploadConfig: { ...marker.uploadConfig, storageEpochs: 4 } })),
      stale: await g.errorOf(() => g.store.replace(g.key, g.record, { ...g.record, sequence: 1 })),
      saved: (await g.store.read(g.key)).paymentStarted,
    }
  })
  expect(result.marker).toContain('PAYMENT_MARKER_REVERSED'); expect(result.sequence).toContain('SEQUENCE_MISMATCH')
  expect(result.frozen).toContain('FROZEN_INTENT_CHANGED'); expect(result.stale).toContain('CAS_CONFLICT'); expect(result.saved).toBe(true)
})

it('archives ciphertext atomically and keeps history accessible without an active slot', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record); await g.store.archive(g.key, g.record)
    const archived = await g.store.archived(g.key, g.record.context.requestId)
    return { active: await g.store.read(g.key), archived: { status: archived.status, sequence: archived.sequence,
      bytes: [...archived.ciphertext] } }
  })
  expect(result.active).toBeNull(); expect(result.archived.status).toBe('ARCHIVED'); expect(result.archived.sequence).toBe(1)
  expect(result.archived.bytes).toEqual([...fixture.record.ciphertext])
})

it('retains the active record when an actual archive transaction aborts on quota failure', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'archive') throw new DOMException('controlled quota failure', 'QuotaExceededError')
      return put.apply(this, args)
    }
    let error: string | null
    try { error = await g.errorOf(() => g.store.archive(g.key, g.record)) }
    finally { IDBObjectStore.prototype.put = put }
    return { error, active: g.R.privateBookmarkRecoveryFingerprint(await g.store.read(g.key)),
      expected: g.R.privateBookmarkRecoveryFingerprint(g.record), archived: await g.store.archived(g.key, g.record.context.requestId) }
  })
  expect(result.error).toContain('controlled quota'); expect(result.active).toBe(result.expected); expect(result.archived).toBeNull()
})

it('does not overwrite different archived payment evidence or delete the active record on conflict', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record); await g.store.archive(g.key, g.record)
    const original = await g.store.archived(g.key, g.record.context.requestId)
    const other = { ...g.record, paymentStarted: true }
    await g.store.replace(g.key, null, other)
    const error = await g.errorOf(() => g.store.archive(g.key, other))
    return { error, activeMarker: (await g.store.read(g.key)).paymentStarted,
      sameArchive: g.R.privateBookmarkRecoveryFingerprint(await g.store.archived(g.key, g.record.context.requestId)) === g.R.privateBookmarkRecoveryFingerprint(original) }
  })
  expect(result.error).toContain('ARCHIVE_CONFLICT'); expect(result.activeMarker).toBe(true); expect(result.sameArchive).toBe(true)
})

it('enforces strict commit durability and does not permit replacing a paid receipt', async () => {
  const result = await run(async () => {
    const g = globalThis as any, original = IDBDatabase.prototype.transaction, modes: unknown[] = []
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') modes.push(args[2]?.durability)
      return original.apply(this, args)
    }
    let error: string | null
    try {
      await g.store.replace(g.key, null, g.paid)
      const changed = { ...g.paid, sequence: 1, storage: { ...g.paid.storage, quoteId: 'different' } }
      error = await g.errorOf(() => g.store.replace(g.key, g.paid, changed))
    } finally { IDBDatabase.prototype.transaction = original }
    return { modes, error, quote: (await g.store.read(g.key)).storage.quoteId }
  })
  expect(result.modes).toEqual(['strict']); expect(result.error).toContain('PAID_RECEIPT_REPLACED')
  expect(result.quote).toBe(fixture.paid.storage!.quoteId)
})

it('honors real cross-instance Web Locks and fails busy without entering the second workflow', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    let release!: () => void, entered!: () => void
    const firstEntered = new Promise<void>(resolve => { entered = resolve })
    const first = g.store.exclusive(g.key, async () => { entered(); await new Promise<void>(resolve => { release = resolve }) })
    await firstEntered
    let secondRan = false
    const error = await g.errorOf(() => g.R.browserPrivateBookmarkRecoveryStore().exclusive(g.key, async () => { secondRan = true }))
    release(); await first
    return { error, secondRan }
  })
  expect(result.error).toContain('BUSY_IN_ANOTHER_TAB'); expect(result.secondRan).toBe(false)
})

it('exports/imports real AES+Seal ciphertext without private fields and decrypts the recovered bytes exactly', async () => {
  const result = await run(async () => {
    const g = globalThis as any, encoded = g.R.exportPrivateBookmarkRecovery(g.record)
    const parsed = g.R.parsePrivateBookmarkRecoveryExport(encoded, g.record.context.scope, g.record.context.originalPackageId)
    const imported = await g.R.importPrivateBookmarkRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId)
    const repeated = await g.R.importPrivateBookmarkRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId)
    return { encoded, bytes: [...imported.ciphertext], same: g.R.privateBookmarkRecoveryFingerprint(imported) === g.R.privateBookmarkRecoveryFingerprint(repeated),
      parsedStatus: parsed.record.status, walrus: parsed.walrus }
  })
  expect(result.encoded).not.toContain(fixture.soulId)
  expect(result.encoded).not.toMatch(/"action"|"entries"|"receipts"|"dek"|privateKey|plaintextHash/)
  expect(result.same).toBe(true); expect(result.walrus).toBeNull(); expect(result.parsedStatus).toBe('ACTIVE')
  expect(await fixture.decrypt(new Uint8Array(result.bytes))).toEqual(fixture.library)
})

it('exports matching immutable payment packets and imports both stores without initiating payment', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateBookmarkWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateBookmarkRecovery(g.paid)
    localStorage.clear()
    const restored = await g.R.importPrivateBookmarkRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId)
    const saved = g.W.readWalrusSingleRecord(walrusKey)
    return { bytes: [...restored.ciphertext], marker: restored.paymentStarted, storage: restored.storage,
      register: saved.register.bytes, certify: saved.certify.bytes }
  })
  expect(result.marker).toBe(true); expect(result.storage).toEqual(fixture.paid.storage)
  expect(result.register).toBe(fixture.walrus.register!.bytes); expect(result.certify).toBe(fixture.walrus.certify!.bytes)
})

it('refuses export when a payment marker or paid receipt has lost its WAL', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    return [await g.errorOf(() => g.R.exportPrivateBookmarkRecovery({ ...g.record, paymentStarted: true })),
      await g.errorOf(() => g.R.exportPrivateBookmarkRecovery(g.paid))]
  })
  expect(result.every(message => message?.includes('PAYMENT_RECOVERY_MISSING'))).toBe(true)
})

it.each(['owner', 'registry', 'package', 'relay', 'epochs', 'hash', 'length', 'attachment', 'extra-private-field'])(
  'rejects transplanted or incompatible recovery %s before either store changes', async problem => {
    const result = await run(async problem => {
      const g = globalThis as any, walrusKey = g.R.privateBookmarkWalrusKey(g.paid)
      g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
      const wire = JSON.parse(g.R.exportPrivateBookmarkRecovery(g.paid)); localStorage.clear()
      let scope = g.paid.context.scope, pkg = g.paid.context.originalPackageId
      if (problem === 'owner') scope = { ...scope, owner: `0x${'f'.repeat(64)}` }
      if (problem === 'registry') scope = { ...scope, registryId: `0x${'f'.repeat(64)}` }
      if (problem === 'package') pkg = `0x${'f'.repeat(64)}`
      if (problem === 'relay') wire.walrus.intent.relayUrl = 'https://other.example.com'
      if (problem === 'epochs') wire.walrus.intent.storageEpochs++
      if (problem === 'hash') wire.walrus.intent.payloadHash = 'ff'.repeat(32)
      if (problem === 'length') wire.walrus.intent.payloadByteLength++
      if (problem === 'attachment') wire.walrus.intent.attachmentScope = 'private-action'
      if (problem === 'extra-private-field') wire.walrus.intent.name = 'secret'
      const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(JSON.stringify(wire), g.store, scope, pkg))
      return { error, count: localStorage.length, active: await g.store.read(g.key) }
    }, problem)
    expect(result.error).toBeTruthy(); expect(result.count).toBe(0); expect(result.active).toBeNull()
  })

it('parses an archived backup without installing it as an active operation', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record); await g.store.archive(g.key, g.record)
    const archived = await g.store.archived(g.key, g.record.context.requestId)
    const encoded = g.R.exportPrivateBookmarkRecovery(archived)
    const parsed = g.R.parsePrivateBookmarkRecoveryExport(encoded, archived.context.scope, archived.context.originalPackageId)
    const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, g.store, archived.context.scope, archived.context.originalPackageId))
    return { status: parsed.record.status, error, active: await g.store.read(g.key) }
  })
  expect(result.status).toBe('ARCHIVED'); expect(result.error).toContain('ARCHIVED_REBASE_REQUIRED'); expect(result.active).toBeNull()
})

it('rejects competing local public payment evidence and preserves it verbatim', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateBookmarkWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateBookmarkRecovery(g.paid), different = structuredClone(g.walrus)
    different.approved.quoteId = 'different-approved-quote'; g.W.writeWalrusSingleRecord(walrusKey, different)
    const prior = localStorage.getItem(walrusKey)
    const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId))
    return { error, same: localStorage.getItem(walrusKey) === prior, active: await g.store.read(g.key) }
  })
  expect(result.error).toContain('EXISTING_PAYMENT'); expect(result.same).toBe(true); expect(result.active).toBeNull()
})

it('will not import an old unpaid backup over an active payment marker', async () => {
  const result = await run(async () => {
    const g = globalThis as any, encoded = g.R.exportPrivateBookmarkRecovery(g.record)
    await g.store.replace(g.key, null, g.record)
    const marker = { ...g.record, sequence: 1, paymentStarted: true }; await g.store.replace(g.key, g.record, marker)
    const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId))
    return { error, marker: (await g.store.read(g.key)).paymentStarted, sequence: (await g.store.read(g.key)).sequence }
  })
  expect(result.error).toContain('EXISTING_OPERATION'); expect(result.marker).toBe(true); expect(result.sequence).toBe(1)
})

it('recovers idempotently when IndexedDB fails after a successful public WAL import', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateBookmarkWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateBookmarkRecovery(g.paid); localStorage.clear()
    const faulty = { ...g.store, replace: async () => { throw new Error('controlled IDB write failure') } }
    const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, faulty, g.paid.context.scope, g.paid.context.originalPackageId))
    const preserved = localStorage.getItem(walrusKey)
    const imported = await g.R.importPrivateBookmarkRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId)
    return { error, preserved: !!preserved, same: localStorage.getItem(walrusKey) === preserved, marker: imported.paymentStarted }
  })
  expect(result.error).toContain('controlled IDB'); expect(result.preserved).toBe(true); expect(result.same).toBe(true); expect(result.marker).toBe(true)
})

it.each(['record', 'config', 'deployment', 'storage-config', 'upload-config', 'context', 'scope', 'storage', 'reference', 'transaction', 'plan', 'packet'])(
  'rejects extra private fields at exact public boundary %s', async field => {
    const error = await run(async field => {
      const g = globalThis as any, r = structuredClone(g.prepared)
      const targets: Record<string, any> = { record: r, config: r.config, deployment: r.config.deployment,
        'storage-config': r.config.storage, 'upload-config': r.uploadConfig, context: r.context, scope: r.context.scope,
        storage: r.storage, reference: r.storage.reference, transaction: r.transaction, plan: r.transaction.plan, packet: r.transaction.packet }
      targets[field].privateIntent = { action: 'set', soulId: `0x${'f'.repeat(64)}`, bookmarked: true }
      return g.errorOf(() => g.R.parsePrivateBookmarkRecovery(r))
    }, field)
    expect(error).toBeTruthy()
  })

it.each(['root', 'encoding', 'uploaded', 'approved', 'register', 'certify'])(
  'rejects private additions to the nested public Walrus journal %s before import', async field => {
    const result = await run(async field => {
      const g = globalThis as any, key = g.R.privateBookmarkWalrusKey(g.paid)
      g.W.writeWalrusSingleRecord(key, g.walrus)
      const wire = JSON.parse(g.R.exportPrivateBookmarkRecovery(g.paid)); localStorage.clear()
      ;(field === 'root' ? wire.walrus : wire.walrus[field]).privateIntent = 'do not persist this intent'
      const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(JSON.stringify(wire), g.store, g.paid.context.scope, g.paid.context.originalPackageId))
      return { error, walrus: localStorage.length, active: await g.store.read(g.key) }
    }, field)
    expect(result.error).toBeTruthy(); expect(result.walrus).toBe(0); expect(result.active).toBeNull()
  })

it.each(['sequence', 'status', 'payment', 'schema', 'release-package', 'release-registry', 'release-chain',
  'context-owner', 'context-registry', 'context-revision', 'context-request', 'cipher-hash', 'cipher-empty',
  'envelope-version', 'envelope-iv', 'envelope-aad', 'envelope-trailing'])(
  'rejects malformed record or hash-consistent envelope transplant %s', async problem => {
    const error = await run(async problem => {
      const g = globalThis as any, r = structuredClone(g.record), other = `0x${'f'.repeat(64)}`
      if (problem === 'sequence') r.sequence = Number.MAX_SAFE_INTEGER + 1
      if (problem === 'status') r.status = 'SAVED'
      if (problem === 'payment') r.paymentStarted = 1
      if (problem === 'schema') r.schema = 'soulidity.private-loadout-recovery.v1'
      if (problem === 'release-package') r.config.deployment.originalPackageId = other
      if (problem === 'release-registry') r.config.registryId = other
      if (problem === 'release-chain') r.context.chainIdentifier = '00000001'
      if (problem === 'context-owner') r.context.scope.owner = other
      if (problem === 'context-registry') r.context.scope.registryId = other
      if (problem === 'context-revision') r.context.revision = '2'
      if (problem === 'context-request') r.context.requestId = 'ff'.repeat(32)
      if (problem === 'cipher-hash') r.cipherSha256 = 'ff'.repeat(32)
      if (problem === 'cipher-empty') r.ciphertext = new Uint8Array()
      if (problem.startsWith('envelope-')) {
        const envelope = g.C.PrivateBookmarkEnvelopeBcs.parse(r.ciphertext)
        if (problem === 'envelope-version') envelope.version = 2
        if (problem === 'envelope-iv') envelope.iv.pop()
        if (problem === 'envelope-aad') envelope.aad[0] ^= 1
        r.ciphertext = g.C.PrivateBookmarkEnvelopeBcs.serialize(envelope).toBytes()
        if (problem === 'envelope-trailing') r.ciphertext = new Uint8Array([...r.ciphertext, 0])
        r.cipherSha256 = g.toHex(g.sha256(r.ciphertext))
      }
      return g.errorOf(() => g.R.parsePrivateBookmarkRecovery(r))
    }, problem)
    expect(error).toBeTruthy()
  })

it.each(['hash', 'length', 'key', 'quote', 'digest', 'payment-marker', 'completion'])(
  'rejects invalid paid storage commitment %s', async problem => {
    const error = await run(async problem => {
      const g = globalThis as any, r = structuredClone(g.paid)
      if (problem === 'hash') r.storage.reference.sha256 = 'ff'.repeat(32)
      if (problem === 'length') r.storage.reference.byteLength = String(r.ciphertext.length + 1)
      if (problem === 'key') r.storage.recoveryKey += ':other'
      if (problem === 'quote') r.storage.quoteId = ''
      if (problem === 'digest') r.storage.certifyTxDigest = '0'
      if (problem === 'payment-marker') r.paymentStarted = false
      if (problem === 'completion') { r.status = 'COMPLETE'; r.storage = null }
      return g.errorOf(() => g.R.parsePrivateBookmarkRecovery(r))
    }, problem)
    expect(error).toBeTruthy()
  })

it.each(['register-digest', 'certify-digest', 'register-phase', 'certify-phase', 'blob-id', 'blob-object', 'quote-id', 'recipient'])(
  'rejects transplanted paid Walrus receipt %s', async problem => {
    const error = await run(async problem => {
      const g = globalThis as any, w = structuredClone(g.walrus)
      if (problem === 'register-digest') w.register.digest = w.certify.digest
      if (problem === 'certify-digest') w.certify.digest = w.register.digest
      if (problem === 'register-phase') w.register.phase = 'PREPARED'
      if (problem === 'certify-phase') w.certify.phase = 'PREPARED'
      if (problem === 'blob-id') w.uploaded.blobId = 'A'.repeat(43)
      if (problem === 'blob-object') w.uploaded.blobObjectId = `0x${'f'.repeat(64)}`
      if (problem === 'quote-id') w.approved.quoteId = 'wrong quote'
      if (problem === 'recipient') w.intent.recipient = `0x${'f'.repeat(64)}`
      return g.errorOf(() => g.R.validatePrivateBookmarkPaymentRecovery(g.paid, w))
    }, problem)
    expect(error).toBeTruthy()
  })

it('binds a prepared head packet to the same owner, request, revision, release and paid ciphertext', async () => {
  const result = await run(async () => {
    const g = globalThis as any, valid = g.R.parsePrivateBookmarkRecovery(g.prepared)
    const errors: unknown[] = []
    for (const field of ['owner', 'request', 'revision', 'release', 'ciphertext']) {
      const r = structuredClone(g.prepared), p = r.transaction.plan
      if (field === 'owner') p.scope.owner = `0x${'f'.repeat(64)}`
      if (field === 'request') p.requestId = 'ff'.repeat(32)
      if (field === 'revision') p.expectedRevision = '1'
      if (field === 'release') p.deployment.callablePackageId = `0x${'f'.repeat(64)}`
      if (field === 'ciphertext') p.ciphertext.blobObjectId = `0x${'f'.repeat(64)}`
      errors.push(await g.errorOf(() => g.R.parsePrivateBookmarkRecovery(r)))
    }
    await g.store.replace(g.key, null, valid)
    const saved = await g.store.read(g.key)
    return { errors, bytes: saved.transaction.packet.bytes, expected: valid.transaction.packet.bytes }
  })
  expect(result.errors.every(Boolean)).toBe(true); expect(result.bytes).toBe(result.expected)
})

it('uses wallet/registry/package keys only and retains the exact slot through switch-away/back', async () => {
  const result = await run(async () => {
    const g = globalThis as any, r = g.record, scope = r.context.scope, pkg = r.context.originalPackageId, other = `0x${'f'.repeat(64)}`
    await g.store.replace(g.key, null, r)
    const keys = [g.key, g.R.privateBookmarkRecoveryKey({ ...scope, owner: other }, pkg),
      g.R.privateBookmarkRecoveryKey({ ...scope, registryId: other }, pkg), g.R.privateBookmarkRecoveryKey(scope, other)]
    const missing = await Promise.all(keys.slice(1).map(key => g.store.read(key)))
    const restored = await g.R.browserPrivateBookmarkRecoveryStore().read(g.key)
    return { keys, missing, same: g.R.privateBookmarkRecoveryFingerprint(restored) === g.R.privateBookmarkRecoveryFingerprint(r),
      operationScope: g.R.privateBookmarkStorageScope(r) }
  })
  expect(new Set(result.keys).size).toBe(4); expect(result.missing).toEqual([null, null, null]); expect(result.same).toBe(true)
  expect(result.keys[0]).toBe(`soulidity.private-bookmark.v1:${fixture.record.context.originalPackageId}:${fixture.record.context.scope.registryId}:${fixture.record.context.scope.owner}`)
  expect(result.operationScope).not.toContain(fixture.soulId)
  expect(result.operationScope).not.toMatch(/ownershipEpoch|capture|action|bookmarked/)
})

it.each(['package', 'id', 'threshold', 'services', 'indices', 'aad', 'size', 'shares', 'malformed'])(
  'deep-validates the actual Seal wrapper %s before importing either public journal', async problem => {
    const result = await run(async problem => {
      const g = globalThis as any, r = structuredClone(g.record)
      const envelope = g.C.PrivateBookmarkEnvelopeBcs.parse(r.ciphertext)
      const wrapped = g.EncryptedObject.parse(new Uint8Array(envelope.wrapped_dek))
      if (problem === 'package') wrapped.packageId = `0x${'f'.repeat(64)}`
      if (problem === 'id') wrapped.id = 'ff'.repeat(32)
      if (problem === 'threshold') wrapped.threshold = 1
      if (problem === 'services') wrapped.services[0][0] = `0x${'f'.repeat(64)}`
      if (problem === 'indices') wrapped.services[0][1] = 0
      if (problem === 'aad') wrapped.ciphertext.Aes256Gcm.aad[0] ^= 1
      if (problem === 'size') wrapped.ciphertext.Aes256Gcm.blob = new Uint8Array(49)
      if (problem === 'shares') wrapped.encryptedShares.BonehFranklinBLS12381.encryptedShares.pop()
      envelope.wrapped_dek = problem === 'malformed' ? [1] : [...g.EncryptedObject.serialize(wrapped).toBytes()]
      r.ciphertext = g.C.PrivateBookmarkEnvelopeBcs.serialize(envelope).toBytes(); r.cipherSha256 = g.toHex(g.sha256(r.ciphertext))
      const encoded = g.R.exportPrivateBookmarkRecovery(r)
      const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, g.store, r.context.scope, r.context.originalPackageId))
      return { error, active: await g.store.read(g.key), publicWal: localStorage.length }
    }, problem)
    expect(result.error).toBeTruthy(); expect(result.active).toBeNull(); expect(result.publicWal).toBe(0)
  })

it.each(['threshold', 'server', 'weight'])(
  'rejects a paid import whose public key configuration %s contradicts the wrapped key without installing WAL', async problem => {
    const result = await run(async problem => {
      const g = globalThis as any, key = g.R.privateBookmarkWalrusKey(g.paid)
      g.W.writeWalrusSingleRecord(key, g.walrus)
      const wire = JSON.parse(g.R.exportPrivateBookmarkRecovery(g.paid)); localStorage.clear()
      const config = wire.record.config.sealConfig
      if (problem === 'threshold') config.threshold = 1
      if (problem === 'server') config.serverConfigs[0].objectId = `0x${'f'.repeat(64)}`
      if (problem === 'weight') config.serverConfigs[0].weight = 1
      const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(JSON.stringify(wire), g.store, g.paid.context.scope, g.paid.context.originalPackageId))
      return { error, active: await g.store.read(g.key), publicWal: localStorage.length }
    }, problem)
    expect(result.error).toBeTruthy(); expect(result.active).toBeNull(); expect(result.publicWal).toBe(0)
  })

it.each(['empty-wrapper', 'oversized-wrapper', 'short-ciphertext', 'oversized-ciphertext'])(
  'rejects hash-consistent encrypted resource shape %s during synchronous record parsing', async problem => {
    const error = await run(async problem => {
      const g = globalThis as any, r = structuredClone(g.record), envelope = g.C.PrivateBookmarkEnvelopeBcs.parse(r.ciphertext)
      if (problem === 'empty-wrapper') envelope.wrapped_dek = []
      if (problem === 'oversized-wrapper') envelope.wrapped_dek = new Uint8Array(256 * 1024 + 1)
      if (problem === 'short-ciphertext') envelope.ciphertext = new Uint8Array(16)
      if (problem === 'oversized-ciphertext') envelope.ciphertext = new Uint8Array(8 * 1024 * 1024 + 17)
      r.ciphertext = g.C.PrivateBookmarkEnvelopeBcs.serialize(envelope, { maxSize: 16 * 1024 * 1024 }).toBytes()
      r.cipherSha256 = g.toHex(g.sha256(r.ciphertext))
      return g.errorOf(() => g.R.parsePrivateBookmarkRecovery(r))
    }, problem)
    expect(error).toContain('RECOVERY_ENVELOPE_INVALID')
  })

it('captures the expected import scope before asynchronous Seal validation', async () => {
  const result = await run(async () => {
    const g = globalThis as any, key = g.R.privateBookmarkWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(key, g.walrus)
    const encoded = g.R.exportPrivateBookmarkRecovery(g.paid); localStorage.clear()
    const scope = structuredClone(g.paid.context.scope)
    const pending = g.R.importPrivateBookmarkRecovery(encoded, g.store, scope, g.paid.context.originalPackageId)
    scope.owner = `0x${'f'.repeat(64)}`
    const error = await g.errorOf(() => pending)
    return { error, original: (await g.store.read(g.key))?.context.scope.owner,
      other: await g.store.read(g.R.privateBookmarkRecoveryKey(scope, g.paid.context.originalPackageId)),
      sameWal: JSON.stringify(g.W.readWalrusSingleRecord(key)) === JSON.stringify(g.walrus) }
  })
  expect(result.error).toBeNull(); expect(result.original).toBe(fixture.paid.context.scope.owner)
  expect(result.other).toBeNull(); expect(result.sameWal).toBe(true)
})

it.each(['schema', 'extra', 'base64', 'ciphertext-type'])(
  'rejects malformed export wire %s before locking or opening either journal', async problem => {
    const result = await run(async problem => {
      const g = globalThis as any, wire = JSON.parse(g.R.exportPrivateBookmarkRecovery(g.record))
      if (problem === 'schema') wire.schema = 'soulidity.private-loadout-recovery-export.v1'
      if (problem === 'extra') wire.privateIntent = 'secret'
      if (problem === 'base64') wire.record.ciphertext += '\n'
      if (problem === 'ciphertext-type') wire.record.ciphertext = [1, 2]
      let called = false
      const store = { ...g.store, exclusive: () => { called = true; throw Error('unexpected lock') } }
      const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(JSON.stringify(wire), store, g.record.context.scope, g.record.context.originalPackageId))
      return { error, called, count: localStorage.length }
    }, problem)
    expect(result.error).toBeTruthy(); expect(result.called).toBe(false); expect(result.count).toBe(0)
  })

it.each(['SIGNED', 'SUCCEEDED', 'FAILED'])(
  'cannot replace the retained signature in phase %s', async phase => {
    const result = await run(async phase => {
      const g = globalThis as any, r = structuredClone(g.prepared)
      // Parser/CAS signatures only; cryptographic signature verification belongs
      // to the adapter's actual-key tests and is not asserted by this fixture.
      r.transaction.packet.phase = phase; r.transaction.packet.signature = 'AQ=='
      await g.store.replace(g.key, null, r)
      const next = structuredClone(r); next.sequence = 1; next.transaction.packet.signature = 'Ag=='
      const error = await g.errorOf(() => g.store.replace(g.key, r, next))
      return { error, signature: (await g.store.read(g.key)).transaction.packet.signature }
    }, phase)
    expect(result.error).toContain('RECOVERY_SIGNATURE_REPLACED'); expect(result.signature).toBe('AQ==')
  })

it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'])(
  'cannot move terminal phase %s back to a signable preparation', async phase => {
    const result = await run(async phase => {
      const g = globalThis as any, r = structuredClone(g.prepared)
      r.transaction.packet.phase = phase
      await g.store.replace(g.key, null, r)
      const next = structuredClone(r); next.sequence = 1; next.transaction.packet.phase = 'PREPARED'
      const error = await g.errorOf(() => g.store.replace(g.key, r, next))
      return { error, saved: (await g.store.read(g.key)).transaction.packet.phase }
    }, phase)
    expect(result.error).toContain('RECOVERY_PHASE_REVERSED'); expect(result.saved).toBe(phase)
  })

it.each(['SIGNING', 'SIGNED'])(
  'retains unknown %s packets instead of archiving away their active slot', async phase => {
    const result = await run(async phase => {
      const g = globalThis as any, r = structuredClone(g.prepared)
      r.transaction.packet.phase = phase; r.transaction.packet.signature = phase === 'SIGNED' ? 'AQ==' : null
      await g.store.replace(g.key, null, r)
      const error = await g.errorOf(() => g.store.archive(g.key, r))
      return { error, same: g.R.privateBookmarkRecoveryFingerprint(await g.store.read(g.key)) === g.R.privateBookmarkRecoveryFingerprint(r),
        archived: await g.store.archived(g.key, r.context.requestId) }
    }, phase)
    expect(result.error).toContain('RECOVERY_UNKNOWN_TRANSACTION'); expect(result.same).toBe(true); expect(result.archived).toBeNull()
  })

it('does not reverse COMPLETE into an active library operation', async () => {
  const result = await run(async () => {
    const g = globalThis as any, r = { ...g.paid, status: 'COMPLETE' }
    await g.store.replace(g.key, null, r)
    const error = await g.errorOf(() => g.store.replace(g.key, r, { ...r, sequence: 1, status: 'ACTIVE' }))
    return { error, status: (await g.store.read(g.key)).status }
  })
  expect(result.error).toContain('RECOVERY_COMPLETION_REVERSED'); expect(result.status).toBe('COMPLETE')
})

it('permits an explicitly recovered unsigned rejection and preserves bytes through later signing and completion', async () => {
  const result = await run(async () => {
    const g = globalThis as any; let current = structuredClone(g.prepared)
    await g.store.replace(g.key, null, current)
    for (const phase of ['SIGNING', 'PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED']) {
      const next = structuredClone(current); next.sequence++
      next.transaction.packet.phase = phase
      next.transaction.packet.signature = ['SIGNED', 'SUCCEEDED'].includes(phase) ? 'AQ==' : null
      await g.store.replace(g.key, current, next); current = next
    }
    const complete = { ...current, sequence: current.sequence + 1, status: 'COMPLETE' }
    await g.store.replace(g.key, current, complete); await g.store.archive(g.key, complete)
    const archived = await g.store.archived(g.key, complete.context.requestId)
    return { active: await g.store.read(g.key), phase: archived.transaction.packet.phase,
      bytes: archived.transaction.packet.bytes, signature: archived.transaction.packet.signature }
  })
  expect(result.active).toBeNull(); expect(result.phase).toBe('SUCCEEDED'); expect(result.signature).toBe('AQ==')
  expect(result.bytes).toBe(fixture.prepared.transaction!.packet.bytes)
})

it('fails an actual IndexedDB aborted read without reporting an empty library', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.replace(g.key, null, g.record)
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      const request = original.apply(this, args); this.transaction.abort(); return request
    }
    let error
    try { error = await g.errorOf(() => g.store.read(g.key)) } finally { IDBObjectStore.prototype.get = original }
    return { error, retained: (await g.store.read(g.key)).cipherSha256 }
  })
  expect(result.error).toContain('RECOVERY_READ_FAILED'); expect(result.retained).toBe(fixture.record.cipherSha256)
})
