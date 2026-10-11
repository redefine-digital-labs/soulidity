import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { privateLoadoutRecoveryFixture } from './fixtures/private-loadout-recovery'

// Real Chrome IndexedDB/Web Locks, using only existing Chrome + esbuild + Node.
// The isolated temporary profile never touches a user's browser or wallet.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, sessionId: string
let fixture: Awaited<ReturnType<typeof privateLoadoutRecoveryFixture>>
let nextId = 0, pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>()
function cdp(method: string, params: any = {}, session?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ;(chrome.stdio[3] as Duplex).write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`)
  })
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true,
    returnByValue: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}

beforeAll(async () => {
  fixture = await privateLoadoutRecoveryFixture()
  const entry = `import * as R from ${JSON.stringify(resolve(root, 'web/lib/animacraft/private-loadout-recovery.ts'))};
import * as W from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-single-operation.ts'))};
import * as C from ${JSON.stringify(resolve(root, 'web/lib/animacraft/private-loadout-crypto.ts'))};
import { toBase64, fromBase64, toHex } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
Object.assign(globalThis, { R, W, C, toBase64, fromBase64, toHex, sha256 });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'recovery-browser-suite.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  const script = bundle.outputFiles[0].contents
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(script) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local server unavailable')
  profile = await mkdtemp(join(tmpdir(), 'private-loadout-idb-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw new Error('Real IndexedDB tests require installed Chrome/Chromium or CHROME_BIN; no mock fallback')
  chrome = spawn(executable, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let buffered = ''
  ;(chrome.stdio[4] as Duplex).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const end = buffered.indexOf('\0'); if (end < 0) break
      const wire = buffered.slice(0, end); buffered = buffered.slice(end + 1)
      if (!wire) continue
      const message = JSON.parse(wire), call = pending.get(message.id)
      if (call) { pending.delete(message.id); if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result) }
    }
  })
  chrome.on('error', error => { for (const call of pending.values()) call.reject(error); pending.clear() })
  chrome.on('exit', () => { for (const call of pending.values()) call.reject(new Error('Isolated Chrome exited')); pending.clear() })
  const { targetId } = await cdp('Target.createTarget', { url: `http://127.0.0.1:${address.port}` })
  sessionId = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  for (let tries = 0; tries < 100; tries++) {
    if (await run(() => Boolean((globalThis as any).R))) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const ready = await run(() => ({ ready: Boolean((globalThis as any).R && indexedDB && navigator.locks), errors: (globalThis as any).__bootErrors }))
  if (!ready.ready) throw new Error(`Isolated browser suite failed to load: ${JSON.stringify(ready.errors)}`)
}, 30000)

beforeEach(async () => {
  await run(async ({ record, paid, walrus }) => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-private-loadout-recovery')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('blocked reset'))
    })
    const g = globalThis as any
    g.record = { ...record, ciphertext: new Uint8Array(record.ciphertext) }
    g.paid = { ...paid, ciphertext: new Uint8Array(paid.ciphertext) }
    g.walrus = walrus
    g.key = g.R.privateLoadoutRecoveryKey(g.record.context.scope, g.record.context.originalPackageId)
    g.store = g.R.browserPrivateLoadoutRecoveryStore()
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    // Raw keys deliberately permit corrupt/sentinel values so discovery tests
    // prove they never deserialize recovery ciphertext or assume key trust.
    g.seedScopeKeys = async (keys: IDBValidKey[], store = 'active') => {
      await g.store.read('fixture-database-initialization')
      await new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('soulidity-private-loadout-recovery', 1)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result, tx = db.transaction(store, 'readwrite')
          tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => { db.close(); reject(tx.error) }
          for (const key of keys) tx.objectStore(store).put({ invalidCiphertextSentinel: true }, key)
        }
      })
    }
  }, { record: { ...fixture.record, ciphertext: [...fixture.record.ciphertext] },
    paid: { ...fixture.paid, ciphertext: [...fixture.paid.ciphertext] }, walrus: fixture.walrus })
})

afterAll(async () => {
  if (chrome) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Exact mkdtemp output only; no workspace or user profile is removed.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

it('persists exact encrypted bytes through genuine IndexedDB and a fresh store instance', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const read = await g.R.browserPrivateLoadoutRecoveryStore().read(g.key)
    return { bytes: [...read.ciphertext], fingerprint: g.R.privateLoadoutRecoveryFingerprint(read),
      expected: g.R.privateLoadoutRecoveryFingerprint(g.record), entries: localStorage.length }
  })
  expect(result.bytes).toEqual([...fixture.record.ciphertext]); expect(result.fingerprint).toBe(result.expected)
  expect(result.entries).toBe(0)
})

it('lists only matching active public scope keys without reading ciphertext, other owners, or archives', async () => {
  const result = await run(async () => {
    const g = globalThis as any, r = g.record, s = r.context.scope, pkg = r.context.originalPackageId
    const key = (scope: any, p = pkg) => g.R.privateLoadoutRecoveryKey(scope, p), other = `0x${'f'.repeat(64)}`
    await g.seedScopeKeys(['10', '2', '0', '18446744073709551615'].map(ownershipEpoch => key({ ...s, ownershipEpoch })))
    // More than the cap outside this exact tuple must not affect this query.
    await g.seedScopeKeys(Array.from({ length: 150 }, (_, n) => key({ ...s, owner: other, ownershipEpoch: String(n) })))
    await g.seedScopeKeys([key({ ...s, soulId: other }), key({ ...s, stateId: other }), key(s, other), 42, [g.key]])
    await g.seedScopeKeys([key({ ...s, ownershipEpoch: '3' })], 'archive')
    const proto = IDBObjectStore.prototype, methods = ['get', 'getAll', 'openCursor', 'getAllKeys'] as const
    const saved = methods.map(method => proto[method])
    let scopes
    try {
      for (const method of methods) (proto as any)[method] = () => { throw Error('Values or unbounded keys must not be loaded') }
      scopes = await g.R.browserPrivateLoadoutRecoveryStore().listActiveScopes(pkg, s.soulId, s.stateId, s.owner)
    } finally { methods.forEach((method, i) => { (proto as any)[method] = saved[i] }) }
    return scopes
  })
  expect(result).toEqual(['0', '2', '10', '18446744073709551615'].map(ownershipEpoch => ({ ...fixture.record.context.scope, ownershipEpoch })))
  expect(JSON.stringify(result)).not.toMatch(/ciphertext|entries|name|requestId/)
})

it('omits genuinely archived operations from active scope discovery', async () => {
  const result = await run(async () => {
    const g = globalThis as any, c = g.record.context, s = c.scope
    await g.store.replace(g.key, null, g.record)
    const before = await g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner)
    await g.store.archive(g.key, g.record)
    return { before, after: await g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner),
      retained: Boolean(await g.store.archived(g.key, c.requestId)) }
  })
  expect(result.before).toEqual([fixture.record.context.scope]); expect(result.after).toEqual([]); expect(result.retained).toBe(true)
})

it.each(['', '01', '-1', '1.0', '18446744073709551616', '2:extra', '2\uffff', '\uffffextra'])('rejects malformed active epoch key %j without returning a partial list', async epoch => {
  const result = await run(async epoch => {
    const g = globalThis as any, c = g.record.context, s = c.scope
    const prefix = g.R.privateLoadoutRecoveryKey({ ...s, ownershipEpoch: '0' }, c.originalPackageId).slice(0, -1)
    await g.seedScopeKeys([`${prefix}0`, `${prefix}${epoch}`])
    return g.errorOf(() => g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner))
  }, epoch)
  expect(result).toContain('SCOPE_INVALID')
})

it('enforces the active-scope cap with an explicit error instead of truncating recovery choices', async () => {
  const result = await run(async () => {
    const g = globalThis as any, c = g.record.context, s = c.scope, limit = g.R.PRIVATE_LOADOUT_ACTIVE_SCOPE_LIMIT
    const key = (epoch: number) => g.R.privateLoadoutRecoveryKey({ ...s, ownershipEpoch: String(epoch) }, c.originalPackageId)
    await g.seedScopeKeys(Array.from({ length: limit }, (_, n) => key(n)))
    const scopes = await g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner)
    await g.seedScopeKeys([key(limit)])
    const error = await g.errorOf(() => g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner))
    return { count: scopes.length, limit, error }
  })
  expect(result.limit).toBe(128); expect(result.count).toBe(result.limit); expect(result.error).toContain('TOO_MANY_ACTIVE_SCOPES')
})

it.each([0, 1, 2, 3])('validates canonical discovery argument %s before opening IndexedDB', async field => {
  const result = await run(async field => {
    const g = globalThis as any, c = g.record.context, s = c.scope, args = [c.originalPackageId, s.soulId, s.stateId, s.owner]
    args[field] = '0x1'; const original = indexedDB.open
    indexedDB.open = () => { throw Error('Unexpected database access') }
    try { return await g.errorOf(() => g.store.listActiveScopes(...args)) } finally { indexedDB.open = original }
  }, field)
  expect(result).toContain(field === 0 ? 'PACKAGE_INVALID' : 'SCOPE_INVALID')
})

it('reports an aborted scope cursor read without changing an active encrypted operation', async () => {
  const result = await run(async () => {
    const g = globalThis as any, c = g.record.context, s = c.scope
    await g.store.replace(g.key, null, g.record)
    const original = IDBObjectStore.prototype.openKeyCursor
    IDBObjectStore.prototype.openKeyCursor = function (...args: Parameters<IDBObjectStore['openKeyCursor']>) {
      const request = original.apply(this, args); this.transaction.abort(); return request
    }
    let error
    try { error = await g.errorOf(() => g.store.listActiveScopes(c.originalPackageId, s.soulId, s.stateId, s.owner)) }
    finally { IDBObjectStore.prototype.openKeyCursor = original }
    return { error, same: g.R.privateLoadoutRecoveryFingerprint(await g.store.read(g.key)) === g.R.privateLoadoutRecoveryFingerprint(g.record) }
  })
  expect(result.error).toContain('SCOPE_READ_FAILED'); expect(result.same).toBe(true)
})

it('serializes simultaneous CAS transactions and rejects the stale writer without losing committed bytes', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record)
    const next = { ...g.record, sequence: 1, paymentStarted: true }
    const other = g.R.browserPrivateLoadoutRecoveryStore()
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
    return { error, active: g.R.privateLoadoutRecoveryFingerprint(await g.store.read(g.key)),
      expected: g.R.privateLoadoutRecoveryFingerprint(g.record), archived: await g.store.archived(g.key, g.record.context.requestId) }
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
      sameArchive: g.R.privateLoadoutRecoveryFingerprint(await g.store.archived(g.key, g.record.context.requestId)) === g.R.privateLoadoutRecoveryFingerprint(original) }
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
    const error = await g.errorOf(() => g.R.browserPrivateLoadoutRecoveryStore().exclusive(g.key, async () => { secondRan = true }))
    release(); await first
    return { error, secondRan }
  })
  expect(result.error).toContain('BUSY_IN_ANOTHER_TAB'); expect(result.secondRan).toBe(false)
})

it('exports/imports real AES+Seal ciphertext without private fields and decrypts the recovered bytes exactly', async () => {
  const result = await run(async () => {
    const g = globalThis as any, encoded = g.R.exportPrivateLoadoutRecovery(g.record)
    const parsed = g.R.parsePrivateLoadoutRecoveryExport(encoded, g.record.context.scope, g.record.context.originalPackageId)
    const imported = await g.R.importPrivateLoadoutRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId)
    const repeated = await g.R.importPrivateLoadoutRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId)
    return { encoded, bytes: [...imported.ciphertext], same: g.R.privateLoadoutRecoveryFingerprint(imported) === g.R.privateLoadoutRecoveryFingerprint(repeated),
      parsedStatus: parsed.record.status, walrus: parsed.walrus }
  })
  expect(result.encoded).not.toContain(fixture.secretName)
  expect(result.encoded).not.toMatch(/"action"|"entries"|"receipts"|"dek"|privateKey|plaintextHash/)
  expect(result.same).toBe(true); expect(result.walrus).toBeNull(); expect(result.parsedStatus).toBe('ACTIVE')
  expect(await fixture.decrypt(new Uint8Array(result.bytes))).toEqual(fixture.library)
})

it('exports matching immutable payment packets and imports both stores without initiating payment', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateLoadoutWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateLoadoutRecovery(g.paid)
    localStorage.clear()
    const restored = await g.R.importPrivateLoadoutRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId)
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
    return [await g.errorOf(() => g.R.exportPrivateLoadoutRecovery({ ...g.record, paymentStarted: true })),
      await g.errorOf(() => g.R.exportPrivateLoadoutRecovery(g.paid))]
  })
  expect(result.every(message => message?.includes('PAYMENT_RECOVERY_MISSING'))).toBe(true)
})

it.each(['owner', 'epoch', 'package', 'relay', 'epochs', 'hash', 'length', 'attachment', 'extra-private-field'])(
  'rejects transplanted or incompatible recovery %s before either store changes', async problem => {
    const result = await run(async problem => {
      const g = globalThis as any, walrusKey = g.R.privateLoadoutWalrusKey(g.paid)
      g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
      const wire = JSON.parse(g.R.exportPrivateLoadoutRecovery(g.paid)); localStorage.clear()
      let scope = g.paid.context.scope, pkg = g.paid.context.originalPackageId
      if (problem === 'owner') scope = { ...scope, owner: `0x${'f'.repeat(64)}` }
      if (problem === 'epoch') scope = { ...scope, ownershipEpoch: '999' }
      if (problem === 'package') pkg = `0x${'f'.repeat(64)}`
      if (problem === 'relay') wire.walrus.intent.relayUrl = 'https://other.example.com'
      if (problem === 'epochs') wire.walrus.intent.storageEpochs++
      if (problem === 'hash') wire.walrus.intent.payloadHash = 'ff'.repeat(32)
      if (problem === 'length') wire.walrus.intent.payloadByteLength++
      if (problem === 'attachment') wire.walrus.intent.attachmentScope = 'private-action'
      if (problem === 'extra-private-field') wire.walrus.intent.name = 'secret'
      const error = await g.errorOf(() => g.R.importPrivateLoadoutRecovery(JSON.stringify(wire), g.store, scope, pkg))
      return { error, count: localStorage.length, active: await g.store.read(g.key) }
    }, problem)
    expect(result.error).toBeTruthy(); expect(result.count).toBe(0); expect(result.active).toBeNull()
  })

it('parses an archived backup without installing it as an active operation', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.store.replace(g.key, null, g.record); await g.store.archive(g.key, g.record)
    const archived = await g.store.archived(g.key, g.record.context.requestId)
    const encoded = g.R.exportPrivateLoadoutRecovery(archived)
    const parsed = g.R.parsePrivateLoadoutRecoveryExport(encoded, archived.context.scope, archived.context.originalPackageId)
    const error = await g.errorOf(() => g.R.importPrivateLoadoutRecovery(encoded, g.store, archived.context.scope, archived.context.originalPackageId))
    return { status: parsed.record.status, error, active: await g.store.read(g.key) }
  })
  expect(result.status).toBe('ARCHIVED'); expect(result.error).toContain('ARCHIVED_REBASE_REQUIRED'); expect(result.active).toBeNull()
})

it('rejects competing local public payment evidence and preserves it verbatim', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateLoadoutWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateLoadoutRecovery(g.paid), different = structuredClone(g.walrus)
    different.approved.quoteId = 'different-approved-quote'; g.W.writeWalrusSingleRecord(walrusKey, different)
    const prior = localStorage.getItem(walrusKey)
    const error = await g.errorOf(() => g.R.importPrivateLoadoutRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId))
    return { error, same: localStorage.getItem(walrusKey) === prior, active: await g.store.read(g.key) }
  })
  expect(result.error).toContain('EXISTING_PAYMENT'); expect(result.same).toBe(true); expect(result.active).toBeNull()
})

it('will not import an old unpaid backup over an active payment marker', async () => {
  const result = await run(async () => {
    const g = globalThis as any, encoded = g.R.exportPrivateLoadoutRecovery(g.record)
    await g.store.replace(g.key, null, g.record)
    const marker = { ...g.record, sequence: 1, paymentStarted: true }; await g.store.replace(g.key, g.record, marker)
    const error = await g.errorOf(() => g.R.importPrivateLoadoutRecovery(encoded, g.store, g.record.context.scope, g.record.context.originalPackageId))
    return { error, marker: (await g.store.read(g.key)).paymentStarted, sequence: (await g.store.read(g.key)).sequence }
  })
  expect(result.error).toContain('EXISTING_OPERATION'); expect(result.marker).toBe(true); expect(result.sequence).toBe(1)
})

it('recovers idempotently when IndexedDB fails after a successful public WAL import', async () => {
  const result = await run(async () => {
    const g = globalThis as any, walrusKey = g.R.privateLoadoutWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    const encoded = g.R.exportPrivateLoadoutRecovery(g.paid); localStorage.clear()
    const faulty = { ...g.store, replace: async () => { throw new Error('controlled IDB write failure') } }
    const error = await g.errorOf(() => g.R.importPrivateLoadoutRecovery(encoded, faulty, g.paid.context.scope, g.paid.context.originalPackageId))
    const preserved = localStorage.getItem(walrusKey)
    const imported = await g.R.importPrivateLoadoutRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId)
    return { error, preserved: !!preserved, same: localStorage.getItem(walrusKey) === preserved, marker: imported.paymentStarted }
  })
  expect(result.error).toContain('controlled IDB'); expect(result.preserved).toBe(true); expect(result.same).toBe(true); expect(result.marker).toBe(true)
})
