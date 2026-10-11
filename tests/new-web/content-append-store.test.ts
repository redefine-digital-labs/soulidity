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
import { contentAppendStoreFixture } from './fixtures/content-append-store'

// Real Chrome IndexedDB/Web Locks, isolated temporary profile and localhost.
// No mocked persistence, wallet, network signing, encryption or user browser.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, sessionId: string
let fixture: Awaited<ReturnType<typeof contentAppendStoreFixture>>, different: typeof fixture
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>()
function cdp(method: string, params: any = {}, session?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ;(chrome.stdio[3] as Duplex).write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`)
  })
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}, targetSession = sessionId): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true,
    returnByValue: true }, targetSession)
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}
beforeAll(async () => {
  fixture = await contentAppendStoreFixture(); different = await contentAppendStoreFixture({ intentJson: '{"operation":"append","other":true}' })
  const entry = `import * as S from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-store.ts'))};
import * as P from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-preparation.ts'))};
Object.assign(globalThis, { S, P });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'content-append-store-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  profile = await mkdtemp(join(tmpdir(), 'content-append-idb-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw Error('Real IndexedDB tests require installed Chrome/Chromium or CHROME_BIN')
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let buffered = ''
  ;(chrome.stdio[4] as Duplex).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const end = buffered.indexOf('\0'); if (end < 0) break
      const wire = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (!wire) continue
      const message = JSON.parse(wire), call = pending.get(message.id)
      if (call) { pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result) }
    }
  })
  chrome.on('error', error => { for (const call of pending.values()) call.reject(error); pending.clear() })
  chrome.on('exit', () => { for (const call of pending.values()) call.reject(Error('Isolated Chrome exited')); pending.clear() })
  const { targetId } = await cdp('Target.createTarget', { url: `http://127.0.0.1:${address.port}` })
  sessionId = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  for (let tries = 0; tries < 100; tries++) {
    if (await run(() => Boolean((globalThis as any).S))) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const ready = await run(() => ({ ready: Boolean((globalThis as any).S && indexedDB && navigator.locks), errors: (globalThis as any).__bootErrors }))
  if (!ready.ready) throw Error(`Browser suite failed to load: ${JSON.stringify(ready.errors)}`)
}, 30000)
beforeEach(async () => {
  await run(async ({ record, other }) => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-content-append')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('blocked reset'))
    })
    const g = globalThis as any
    g.record = { ...record, ciphertext: new Uint8Array(record.ciphertext) }; g.other = { ...other, ciphertext: new Uint8Array(other.ciphertext) }
    g.client = new Proxy({}, { get: () => { throw Error('Ed25519 verification must not access a network client') } })
    g.store = g.S.browserContentAppendStore(g.client); g.key = g.S.contentAppendStoreKey(g.record.scope)
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    g.raw = async (store: string, key: string, value?: unknown) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('soulidity-content-append')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, value === undefined ? 'readonly' : 'readwrite')
        const request = value === undefined ? tx.objectStore(store).get(key) : tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error)
      }) } finally { db.close() }
    }
  }, { record: { ...fixture, ciphertext: [...fixture.ciphertext] }, other: { ...different, ciphertext: [...different.ciphertext] } })
})
afterAll(async () => {
  if (chrome) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Exact isolated mkdtemp output, never a user profile or workspace path.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

it('creates a genuinely author-signed stage and verifies a fresh database read without network or localStorage', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const cold = await g.S.browserContentAppendStore(g.client).read(g.key)
    return { bytes: [...cold.ciphertext], signature: cold.authorSignature, fingerprint: g.P.contentAppendPreparationFingerprint(cold),
      expected: g.P.contentAppendPreparationFingerprint(g.record), localKeys: localStorage.length }
  })
  expect(result.bytes).toEqual([...fixture.ciphertext]); expect(result.signature).toBe(fixture.authorSignature)
  expect(result.fingerprint).toBe(result.expected); expect(result.localKeys).toBe(0)
})
it('cold export/import roundtrips canonical signed ciphertext without installing a stage until explicitly created', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const encoded = g.S.exportContentAppendPreparation(await g.store.read(g.key))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-content-append')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('cold reset blocked'))
    })
    const imported = await g.S.importContentAppendPreparation(encoded, g.client), before = await g.store.read(g.key)
    await g.S.browserContentAppendStore(g.client).create(g.key, imported)
    return { encoded, before, after: g.S.exportContentAppendPreparation(await g.store.read(g.key)) }
  })
  expect(result.before).toBeNull(); expect(result.after).toBe(result.encoded)
  expect(result.encoded).not.toMatch(/"dek"|"plaintext"|privateKey/)
})
it.each(['payload', 'raw-dek', 'signature', 'primary', 'recovery', 'scope'])('rejects tampered %s before create and when found in a cold database read', async problem => {
  const result = await run(async problem => {
    const g = globalThis as any, bad = structuredClone(g.record)
    if (problem === 'payload') bad.ciphertext[0] ^= 1
    if (problem === 'raw-dek') bad.dek = 'never-public'
    if (problem === 'signature') bad.authorSignature = g.other.authorSignature
    if (problem === 'primary') bad.sidecar.fileName = 'tampered.txt'
    if (problem === 'recovery') bad.recovery.nonce = 'ff'.repeat(16)
    if (problem === 'scope') bad.scope.intentJson = '{"changed":true}'
    const createError = await g.errorOf(() => g.store.create(g.key, bad)); const absent = await g.store.read(g.key)
    await g.raw('active', g.key, bad)
    return { createError, absent, readError: await g.errorOf(() => g.store.read(g.key)) }
  }, problem)
  expect(result.createError).toBeTruthy(); expect(result.absent).toBeNull(); expect(result.readError).toBeTruthy()
})
it('rejects a valid signed stage transplanted to another database key on both write and read', async () => {
  const result = await run(async () => {
    const g = globalThis as any, key = g.key + '-other'
    const create = await g.errorOf(() => g.store.create(key, g.record)); await g.store.read(g.key)
    await g.raw('active', key, g.record)
    return { create, read: await g.errorOf(() => g.store.read(key)) }
  })
  expect(result.create).toContain('KEY_MISMATCH'); expect(result.read).toContain('KEY_MISMATCH')
})
it('permits exact idempotent creation but refuses a different unresolved signed intent in the same slot', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record); await g.store.create(g.key, g.record)
    const error = await g.errorOf(() => g.store.create(g.key, g.other))
    return { error, same: g.P.contentAppendPreparationFingerprint(await g.store.read(g.key)) === g.P.contentAppendPreparationFingerprint(g.record) }
  })
  expect(result.error).toContain('UNRESOLVED_OPERATION'); expect(result.same).toBe(true)
})
it('serializes two concurrent real database creates without replacing the winning unresolved stage', async () => {
  const result = await run(async () => {
    const g = globalThis as any, other = g.S.browserContentAppendStore(g.client)
    const results = await Promise.allSettled([g.store.create(g.key, g.record), other.create(g.key, g.other)])
    return { states: results.map(r => r.status).sort(), error: (results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message,
      stored: Boolean(await g.store.read(g.key)) }
  })
  expect(result.states).toEqual(['fulfilled', 'rejected']); expect(result.error).toContain('UNRESOLVED_OPERATION'); expect(result.stored).toBe(true)
})
it('archives only an exact CAS stage and retains its signed ciphertext while leaving unrelated paid WAL untouched', async () => {
  const result = await run(async () => {
    const g = globalThis as any; localStorage.setItem('paid-wal-sentinel', 'immutable payment packet')
    await g.store.create(g.key, g.record)
    const error = await g.errorOf(() => g.store.archive(g.key, g.other)), preserved = await g.store.read(g.key)
    await g.store.archive(g.key, g.record)
    const archived = await g.raw('archive', `${g.key}:${g.P.contentAppendPreparationFingerprint(g.record)}`)
    return { error, preserved: Boolean(preserved), active: await g.store.read(g.key), archived: g.S.exportContentAppendPreparation(archived),
      expected: g.S.exportContentAppendPreparation(g.record), wal: localStorage.getItem('paid-wal-sentinel') }
  })
  expect(result.error).toContain('ARCHIVE_CAS_MISMATCH'); expect(result.preserved).toBe(true); expect(result.active).toBeNull()
  expect(result.archived).toBe(result.expected); expect(result.wal).toBe('immutable payment packet')
})
it('fails archive conflicts atomically without losing the unresolved stage', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const historyKey = `${g.key}:${g.P.contentAppendPreparationFingerprint(g.record)}`
    await g.raw('archive', historyKey, g.other)
    return { error: await g.errorOf(() => g.store.archive(g.key, g.record)), active: Boolean(await g.store.read(g.key)),
      preserved: g.P.contentAppendPreparationFingerprint(await g.raw('archive', historyKey)) === g.P.contentAppendPreparationFingerprint(g.other) }
  })
  expect(result.error).toContain('ARCHIVE_CONFLICT'); expect(result.active).toBe(true); expect(result.preserved).toBe(true)
})
it('cold archive retry is idempotent and preserves rebase, restore and paid WAL records', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    await g.raw('rebase', g.key, { history: 'retained ancestry' }); await g.raw('restore', g.key, { restore: 'retained evidence' })
    localStorage.setItem('paid-wal-sentinel', 'immutable packet')
    await g.store.archive(g.key, g.record)
    const cold = g.S.browserContentAppendStore(g.client)
    await cold.archive(g.key, g.record)
    const records = await cold.listArchived(g.record.scope)
    return { active: await cold.read(g.key), count: records.length, record: g.S.exportContentAppendPreparation(records[0]),
      expected: g.S.exportContentAppendPreparation(g.record), rebase: await g.raw('rebase', g.key),
      restore: await g.raw('restore', g.key), wal: localStorage.getItem('paid-wal-sentinel') }
  })
  expect(result.active).toBeNull(); expect(result.count).toBe(1); expect(result.record).toBe(result.expected)
  expect(result.rebase).toEqual({ history: 'retained ancestry' }); expect(result.restore).toEqual({ restore: 'retained evidence' })
  expect(result.wal).toBe('immutable packet')
})
it('rejects archiving an absent active record without its exact preexisting archive', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    return { error: await g.errorOf(() => g.store.archive(g.key, g.record)), records: await g.store.listArchived(g.record.scope) }
  })
  expect(result.error).toContain('ARCHIVE_CAS_MISMATCH'); expect(result.records).toEqual([])
})
it('rejects an old archive retry when a different active stage now occupies the same slot', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record); await g.store.archive(g.key, g.record)
    await g.store.create(g.key, g.other)
    const error = await g.errorOf(() => g.store.archive(g.key, g.record))
    return { error, active: g.S.exportContentAppendPreparation(await g.store.read(g.key)), expected: g.S.exportContentAppendPreparation(g.other),
      archived: (await g.store.listArchived(g.record.scope)).length }
  })
  expect(result.error).toContain('ARCHIVE_CAS_MISMATCH'); expect(result.active).toBe(result.expected); expect(result.archived).toBe(1)
})
it('rejects a conflicting archive even on an absent-active retry and preserves the conflicting row', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.read(g.key)
    const key = `${g.key}:${g.P.contentAppendPreparationFingerprint(g.record)}`
    await g.raw('archive', key, g.other)
    return { error: await g.errorOf(() => g.store.archive(g.key, g.record)),
      preserved: g.P.contentAppendPreparationFingerprint(await g.raw('archive', key)) === g.P.contentAppendPreparationFingerprint(g.other) }
  })
  expect(result.error).toContain('ARCHIVE_CONFLICT'); expect(result.preserved).toBe(true)
})
it('serializes concurrent archive retries into one durable archived record', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const cold = g.S.browserContentAppendStore(g.client)
    const results = await Promise.allSettled([g.store.archive(g.key, g.record), cold.archive(g.key, g.record)])
    return { statuses: results.map(r => r.status), active: await cold.read(g.key), count: (await cold.listArchived(g.record.scope)).length }
  })
  expect(result.statuses).toEqual(['fulfilled', 'fulfilled']); expect(result.active).toBeNull(); expect(result.count).toBe(1)
})
it.each(['abort', 'missing'])('reports %s archive readback after commit and permits exact cold retry', async failure => {
  const result = await run(async failure => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const original = IDBObjectStore.prototype.get, transaction = IDBDatabase.prototype.transaction, modes: unknown[] = []
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transaction.apply(this, args)
      if (args[1] === 'readwrite') modes.push(args[2]?.durability)
      if (failure === 'abort' && args[0] === 'archive' && args[1] === 'readonly') queueMicrotask(() => tx.abort())
      return tx
    }
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      return original.call(this, failure === 'missing' && this.name === 'archive' && this.transaction.mode === 'readonly' ? 'controlled-missing-readback' : key)
    }
    let error
    try { error = await g.errorOf(() => g.store.archive(g.key, g.record)) }
    finally { IDBObjectStore.prototype.get = original; IDBDatabase.prototype.transaction = transaction }
    const cold = g.S.browserContentAppendStore(g.client)
    const countBeforeRetry = (await cold.listArchived(g.record.scope)).length
    await cold.archive(g.key, g.record)
    return { error, modes, active: await cold.read(g.key), countBeforeRetry, countAfterRetry: (await cold.listArchived(g.record.scope)).length }
  }, failure)
  expect(result.error).toContain(failure === 'abort' ? 'READ_FAILED' : 'READBACK_MISMATCH')
  expect(result.modes).toEqual(['strict']); expect(result.active).toBeNull()
  expect(result.countBeforeRetry).toBe(1); expect(result.countAfterRetry).toBe(1)
})
it('honors genuine cross-instance Web Locks, fails busy, then allows reuse after release', async () => {
  const result = await run(async () => {
    const g = globalThis as any; let release!: () => void, entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const first = g.store.exclusive(g.key, async () => { entered(); await new Promise<void>(resolve => { release = resolve }) })
    await ready; let secondRan = false
    const error = await g.errorOf(() => g.S.browserContentAppendStore(g.client).exclusive(g.key, async () => { secondRan = true }))
    release(); await first
    const retry = await g.store.exclusive(g.key, async () => 'released')
    return { error, secondRan, retry }
  })
  expect(result.error).toContain('BUSY_IN_ANOTHER_TAB'); expect(result.secondRan).toBe(false); expect(result.retry).toBe('released')
})
it('blocks the same slot in a second actual Chrome tab and releases the cross-tab lock afterward', async () => {
  const url = await run(() => location.origin), { targetId } = await cdp('Target.createTarget', { url })
  const second = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  try {
    for (let tries = 0; tries < 100; tries++) {
      if (await run(() => Boolean((globalThis as any).S), {}, second)) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const key = await run(async () => {
      const g = globalThis as any; let entered!: () => void
      const ready = new Promise<void>(resolve => { entered = resolve })
      g.held = g.store.exclusive(g.key, async () => { entered(); await new Promise<void>(resolve => { g.release = resolve }) })
      await ready; return g.key
    })
    const error = await run(async key => {
      try { await (globalThis as any).S.browserContentAppendStore({}).exclusive(key, async () => 'unexpected'); return null }
      catch (error) { return (error as Error).message }
    }, key, second)
    expect(error).toContain('BUSY_IN_ANOTHER_TAB')
    await run(async () => { const g = globalThis as any; g.release(); await g.held })
    expect(await run(async key => (globalThis as any).S.browserContentAppendStore({}).exclusive(key, async () => 'released'), key, second)).toBe('released')
  } finally {
    await run(async () => { const g = globalThis as any; if (g.release) { g.release(); await g.held } })
    await cdp('Target.closeTarget', { targetId })
  }
})
it.each(['active', 'archive'])('stops on actual %s put quota failure without deleting recoverable data', async store => {
  const result = await run(async store => {
    const g = globalThis as any; if (store === 'archive') await g.store.create(g.key, g.record)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === store) throw new DOMException('controlled quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => store === 'archive' ? g.store.archive(g.key, g.record) : g.store.create(g.key, g.record)) }
    finally { IDBObjectStore.prototype.put = original }
    return { error, retained: Boolean(await g.store.read(g.key)) }
  }, store)
  expect(result.error).toContain('controlled quota'); expect(result.retained).toBe(store === 'archive')
})
it('requires strict durability and reports readback failure after a committed create without discarding the signed stage', async () => {
  const result = await run(async () => {
    const g = globalThis as any, original = IDBDatabase.prototype.transaction, modes: unknown[] = []
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args)
      if (args[1] === 'readwrite') modes.push(args[2]?.durability)
      if (args[1] === 'readonly') queueMicrotask(() => tx.abort())
      return tx
    }
    let error
    try { error = await g.errorOf(() => g.store.create(g.key, g.record)) }
    finally { IDBDatabase.prototype.transaction = original }
    return { error, modes, retained: Boolean(await g.store.read(g.key)) }
  })
  expect(result.error).toContain('READ_FAILED'); expect(result.modes).toEqual(['strict']); expect(result.retained).toBe(true)
})
it('refuses a mismatched post-commit readback while retaining the exact committed recovery record', async () => {
  const result = await run(async () => {
    const g = globalThis as any, original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      return original.call(this, this.transaction.mode === 'readonly' ? 'controlled-missing-readback' : key)
    }
    let error
    try { error = await g.errorOf(() => g.store.create(g.key, g.record)) }
    finally { IDBObjectStore.prototype.get = original }
    return { error, retained: g.P.contentAppendPreparationFingerprint(await g.store.read(g.key)) === g.P.contentAppendPreparationFingerprint(g.record) }
  })
  expect(result.error).toContain('READBACK_MISMATCH'); expect(result.retained).toBe(true)
})
it('rejects noncanonical or tampered signed export imports without creating an active record', async () => {
  const result = await run(async () => {
    const g = globalThis as any, encoded = g.S.exportContentAppendPreparation(g.record), errors: string[] = []
    for (const text of [encoded + '\n', encoded.replace('"schema":', '"extra":1,"schema":'),
      encoded.replace(g.record.authorSignature, g.other.authorSignature), encoded.replace('"ciphertext":"', '"ciphertext":" ')])
      errors.push(await g.errorOf(() => g.S.importContentAppendPreparation(text, g.client)))
    return { errors, active: await g.store.read(g.key) }
  })
  expect(result.errors.every(Boolean)).toBe(true); expect(result.active).toBeNull()
})
it('lists only the exact package/author/content scope and verifies each persisted stage', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record)
    const scope = g.record.scope, other = `0x${'f'.repeat(64)}`
    const listed = await g.store.list(scope)
    const outsiders = await Promise.all([
      g.store.list({ ...scope, originalPackageId: other }), g.store.list({ ...scope, author: other }), g.store.list({ ...scope, contentObjectId: other })])
    const bad = structuredClone(g.record); bad.authorSignature = g.other.authorSignature; await g.raw('active', g.key, bad)
    return { listed: listed.map((r: any) => g.P.contentAppendPreparationFingerprint(r)), expected: g.P.contentAppendPreparationFingerprint(g.record),
      outsiders, error: await g.errorOf(() => g.store.list(scope)) }
  })
  expect(result.listed).toEqual([result.expected]); expect(result.outsiders).toEqual([[], [], []]); expect(result.error).toBeTruthy()
})
it('lists multiple verified archives from one slot and excludes active records and other scopes', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.record); await g.store.archive(g.key, g.record)
    await g.store.create(g.key, g.other); await g.store.archive(g.key, g.other); await g.store.create(g.key, g.record)
    const s = g.record.scope, other = `0x${'f'.repeat(64)}`
    const listed = await g.store.listArchived(s)
    const outsiders = await Promise.all([g.store.listArchived({ ...s, originalPackageId: other }),
      g.store.listArchived({ ...s, author: other }), g.store.listArchived({ ...s, contentObjectId: other })])
    listed[0].ciphertext[0] ^= 1
    return { records: (await g.store.listArchived(s)).map((r: any) => g.S.exportContentAppendPreparation(r)).sort(),
      expected: [g.record, g.other].map((r: any) => g.S.exportContentAppendPreparation(r)).sort(),
      active: (await g.store.list(s)).length, outsiders }
  })
  expect(result.records).toEqual(result.expected); expect(result.active).toBe(1); expect(result.outsiders).toEqual([[], [], []])
})
it.each(['base-key', 'suffix', 'signature', 'ciphertext'])('rejects %s archive corruption during listing without deleting it', async problem => {
  const result = await run(async problem => {
    const g = globalThis as any; await g.store.read(g.key)
    const record = structuredClone(g.record), fingerprint = g.P.contentAppendPreparationFingerprint(record)
    const key = problem === 'base-key' ? `${g.key}-wrong:${fingerprint}` : `${g.key}:${problem === 'suffix' ? '0'.repeat(64) : fingerprint}`
    if (problem === 'signature') record.authorSignature = g.other.authorSignature
    if (problem === 'ciphertext') record.ciphertext[0] ^= 1
    await g.raw('archive', key, record)
    return { error: await g.errorOf(() => g.store.listArchived(g.record.scope)), preserved: Boolean(await g.raw('archive', key)) }
  }, problem)
  if (problem === 'base-key' || problem === 'suffix') expect(result.error).toContain('KEY_MISMATCH')
  else expect(result.error).toBeTruthy()
  expect(result.preserved).toBe(true)
})
it.each(['active', 'archive'])('fails an oversized %s key list explicitly before attempting value reads', async store => {
  const result = await run(async store => {
    const g = globalThis as any; await g.store.read(g.key)
    const s = g.record.scope, prefix = `content-append:${s.originalPackageId}:${s.author}:${s.contentObjectId}:`
    for (let i = 0; i < 33; i++) await g.raw(store, `${prefix}1:slot-${i}`, { invalid: true })
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function () { throw Error('List budget must be checked before values') }
    try { return await g.errorOf(() => store === 'active' ? g.store.list(s) : g.store.listArchived(s)) } finally { IDBObjectStore.prototype.get = original }
  }, store)
  expect(result).toContain('LIST_BUDGET_EXCEEDED')
})
