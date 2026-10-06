import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeCdp } from '../helpers/chrome-cdp'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'

// Actual isolated Chrome IndexedDB, with locally signed/encrypted preparations.
// This tests durable import only: no network, payment finality or chain execution.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, sessionId: string
let fixture: Awaited<ReturnType<typeof contentAppendRebaseFixture>>
let alternate: Awaited<ReturnType<typeof fixture.nextRecord>>, second: Awaited<ReturnType<typeof fixture.advance>>
let connection: ReturnType<typeof chromeCdp> | undefined
let setupPhase = 'fixture'
let setupStopped = false
async function cleanupBrowser() {
  await connection?.close()
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  // Only this suite's exact isolated mkdtemp profile, never a user/workspace path.
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
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}
beforeAll(async () => {
  fixture = await contentAppendRebaseFixture()
  await checkSetup()
  alternate = await fixture.nextRecord({ rebase: { ...fixture.rebase, nonce: 'cd'.repeat(16) } })
  await checkSetup()
  second = await fixture.advance()
  await checkSetup()
  const entry = `import * as S from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-store.ts'))};
import * as P from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-preparation.ts'))};
import * as R from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-rebase-store.ts'))};
import * as E from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-rebase-evidence.ts'))};
import * as T from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-restore-store.ts'))};
import * as C from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-restore.ts'))};
import * as W from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-single-operation.ts'))};
import * as Q from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-completion.ts'))};
import * as X from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-recovery.ts'))};
Object.assign(globalThis, { S, P, R, E, T, C, W, Q, X });`
  setupPhase = 'bundle'
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'content-append-restore-store-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  await checkSetup()
  setupPhase = 'HTTP server'
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  await checkSetup()
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  profile = await mkdtemp(join(tmpdir(), 'content-append-restore-idb-'))
  await checkSetup()
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw Error('Real IndexedDB tests require installed Chrome/Chromium or CHROME_BIN')
  setupPhase = 'spawn Chrome'
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  connection = chromeCdp(chrome, 'content-append-restore-store.test.ts')
  setupPhase = 'Chrome CDP startup'
  await connection.ready()
  await checkSetup()
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
  if (!ready.ready) throw Error(`Browser suite failed to load: ${JSON.stringify(ready.errors)}`)
  await checkSetup()
  setupPhase = 'ready'
}, 30000)
beforeEach(async () => {
  await run(async ({ previous, next, alternate, second, link, alternateLink, secondLink }) => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-content-append')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('blocked reset'))
    })
    const g = globalThis as any
    for (const [key, value] of Object.entries({ previous, next, alternate, second })) {
      const r = value as any; g[key] = { ...r, ciphertext: new Uint8Array(r.ciphertext) }
    }
    Object.assign(g, { link, alternateLink, secondLink })
    g.client = new Proxy({}, { get: () => { throw Error('Ed25519 verification must not access a network client') } })
    g.store = g.S.browserContentAppendStore(g.client); g.transitions = g.R.browserContentAppendRebaseStore(g.client)
    g.key = g.S.contentAppendStoreKey(g.previous.scope)
    g.fingerprint = g.P.contentAppendPreparationFingerprint
    g.linkKey = `${g.key}:${g.fingerprint(g.previous)}`
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    g.raw = async (store: string, key: string, value?: unknown, remove = false) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('soulidity-content-append')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, value === undefined && !remove ? 'readonly' : 'readwrite')
        const request = remove ? tx.objectStore(store).delete(key) : value === undefined ? tx.objectStore(store).get(key) : tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error)
      }) } finally { db.close() }
    }
    g.restore = g.T.browserContentAppendRestoreStore(g.client)
    g.bundle = { record: g.next, payment: g.link.nextPayment, history: [g.link], pending: g.secondLink, additionalPayments: [] }
    g.scope = { originalPackageId: g.next.scope.originalPackageId, author: g.next.scope.author, contentObjectId: g.next.scope.contentObjectId }
    g.marker = () => g.restore.read(g.key)
    g.restoreStatus = async () => ({ marker: await g.marker(), active: await g.store.read(g.key),
      history: await g.raw('rebase', g.linkKey) ?? null,
      pending: await g.raw('rebase', `${g.key}:${g.fingerprint(g.next)}`) ?? null })
    await g.store.read(g.key)
    // Only chain identity and transaction observations are injected. Adoption
    // itself uses actual IDB, localStorage and nested browser Web Locks.
    g.paymentEntries = [...new Map([g.link.previousPayment, g.link.nextPayment, g.secondLink.nextPayment]
      .map((payment: any) => [g.W.walrusSingleKey(payment.intent), payment])).entries()]
    g.observe = []; g.lockObservations = []
    g.adopt = (bundle = g.bundle) => g.C.restoreContentAppend({ bundle, client: g.client,
      getAddress: () => g.next.scope.author, signal: new AbortController().signal }, {
      chain: async () => { g.observe.push('chain') },
      query: async (_execution: any, packet: any) => {
        g.observe.push(`query:${packet.digest}`)
        g.lockObservations.push((await navigator.locks.query()).held?.map(lock => lock.name).sort())
        return { status: 'SUCCEEDED' }
      },
    })

  }, { previous: { ...fixture.previous, ciphertext: [...fixture.previous.ciphertext] },
    next: { ...fixture.next, ciphertext: [...fixture.next.ciphertext] }, alternate: { ...alternate, ciphertext: [...alternate.ciphertext] },
    second: { ...second.record, ciphertext: [...second.record.ciphertext] }, link: fixture.link,
    alternateLink: fixture.linkFor(alternate), secondLink: second.link })
})
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => {
  setupStopped = true
  if (setupPhase !== 'ready') console.error(`Browser setup stopped at ${setupPhase}; ${connection?.diagnostics() ?? 'Chrome not started'}`)
  await cleanupBrowser()
  vi.restoreAllMocks()
})

it('stages a verified encrypted bundle durably without creating active/history/pending or payment WAL', async () => {
  const r = await run(async () => {
    const g = globalThis as any
    await g.restore.stage(g.bundle)
    return { ...await g.restoreStatus(), local: localStorage.length }
  })
  expect(r.marker.record.ciphertext).toEqual(Object.fromEntries(fixture.next.ciphertext.entries()))
  expect(r.marker.history).toEqual([fixture.link]); expect(r.marker.pending).toEqual(second.link)
  expect(r.active).toBeNull(); expect(r.history).toBeNull(); expect(r.pending).toBeNull(); expect(r.local).toBe(0)
})
it('cold read/list preserve the signed bundle and isolate author, content and release scopes', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const cold = g.T.browserContentAppendRestoreStore(g.client)
    const matches = await cold.list(g.scope), isolated = []
    for (const key of ['author', 'contentObjectId', 'originalPackageId']) isolated.push((await cold.list({ ...g.scope, [key]: `0x${'ef'.repeat(32)}` })).length)
    return { count: matches.length, exact: g.T.contentAppendRestoreFingerprint(await cold.read(g.key)) === g.T.contentAppendRestoreFingerprint(g.bundle), isolated }
  })
  expect(r).toEqual({ count: 1, exact: true, isolated: [0, 0, 0] })
})
it('complete atomically installs active plus both completed history and pending edge, then removes only the marker', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const original = IDBDatabase.prototype.transaction, writes: any[] = []
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (args[1] === 'readwrite') writes.push({ stores: args[0], durability: args[2]?.durability })
      return Reflect.apply(original, this, args)
    }
    try { await g.restore.complete(g.bundle) } finally { IDBDatabase.prototype.transaction = original }
    const s = await g.restoreStatus(), cold = g.R.browserContentAppendRebaseStore(g.client)
    return { marker: s.marker, active: g.fingerprint(s.active), expected: g.fingerprint(g.next),
      history: await cold.history(s.active), pending: await cold.pending(s.active), writes,
      compact: !Object.hasOwn(s.history.previous, 'ciphertext') && !Object.hasOwn(s.pending.next, 'ciphertext'), local: localStorage.length }
  })
  expect(r.marker).toBeNull(); expect(r.active).toBe(r.expected)
  expect(r.history).toEqual([fixture.link]); expect(r.pending).toEqual(second.link)
  expect(r.writes).toEqual([{ stores: ['restore', 'active', 'rebase'], durability: 'strict' }]); expect(r.compact).toBe(true); expect(r.local).toBe(0)
})
it('same bundle staging is idempotent, including an identical existing active and matching edges', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.store.create(g.key, g.next)
    await g.raw('rebase', g.linkKey, g.link)
    await g.restore.stage(g.bundle); await g.restore.stage(structuredClone(g.bundle))
    return { same: g.T.contentAppendRestoreFingerprint(await g.marker()) === g.T.contentAppendRestoreFingerprint(g.bundle), active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.next) }
  })
  expect(r.same).toBe(true); expect(r.active).toBe(r.expected)
})
it('complete cannot activate an imported bundle without a durable marker', async () => {
  const r = await run(async () => { const g = globalThis as any; return { error: await g.errorOf(() => g.restore.complete(g.bundle)), ...await g.restoreStatus() } })
  expect(r.error).toContain('DURABLE_MARKER_REQUIRED'); expect(r.marker).toBeNull(); expect(r.active).toBeNull(); expect(r.history).toBeNull(); expect(r.pending).toBeNull()
})
it.each(['stage', 'complete'])('%s refuses a different signed active and preserves the staged bundle', async method => {
  const r = await run(async method => {
    const g = globalThis as any; await g.restore.stage(g.bundle); await g.store.create(g.key, g.previous)
    return { error: await g.errorOf(() => g.restore[method](g.bundle)), active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous), same: g.T.contentAppendRestoreFingerprint(await g.marker()) === g.T.contentAppendRestoreFingerprint(g.bundle) }
  }, method)
  expect(r.error).toContain('ACTIVE_CONFLICT'); expect(r.active).toBe(r.expected); expect(r.same).toBe(true)
})
it.each(['stage', 'complete'])('%s refuses a different valid bundle rather than overwriting its pending import', async method => {
  const r = await run(async method => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const error = await g.errorOf(() => g.restore[method]({ ...g.bundle, pending: null }))
    return { error, same: g.T.contentAppendRestoreFingerprint(await g.marker()) === g.T.contentAppendRestoreFingerprint(g.bundle), active: await g.store.read(g.key) }
  }, method)
  expect(r.error).toContain('RESTORE_CONFLICT'); expect(r.same).toBe(true); expect(r.active).toBeNull()
})
it.each(['stage', 'complete'])('%s refuses a different independently signed history edge without overwriting either record', async method => {
  const r = await run(async method => {
    const g = globalThis as any; await g.restore.stage(g.bundle); await g.raw('rebase', g.linkKey, g.alternateLink)
    return { error: await g.errorOf(() => g.restore[method](g.bundle)), existing: await g.raw('rebase', g.linkKey), marker: Boolean(await g.marker()), active: await g.store.read(g.key) }
  }, method)
  expect(r.error).toContain('HISTORY_CONFLICT'); expect(r.existing).toEqual(fixture.linkFor(alternate)); expect(r.marker).toBe(true); expect(r.active).toBeNull()
})
it.each(['stage', 'complete'])('%s includes additional signed packets in the durable marker fingerprint and CAS', async method => {
  const certify = { ...await fixture.packet(57), phase: 'SIGNED' }
  const r = await run(async ({ method, certify }) => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const changed = { ...g.bundle, additionalPayments: [{ ...g.link.previousPayment, certify }] }
    const originalFingerprint = g.T.contentAppendRestoreFingerprint(g.bundle)
    const changedFingerprint = g.T.contentAppendRestoreFingerprint(changed)
    const error = await g.errorOf(() => g.restore[method](changed))
    const cold = g.T.browserContentAppendRestoreStore(g.client), marker = await cold.read(g.key)
    return { error, originalFingerprint, changedFingerprint, actualFingerprint: g.T.contentAppendRestoreFingerprint(marker),
      extras: marker.additionalPayments, active: await g.store.read(g.key) }
  }, { method, certify })
  expect(r.error).toContain('RESTORE_CONFLICT'); expect(r.changedFingerprint).not.toBe(r.originalFingerprint)
  expect(r.actualFingerprint).toBe(r.originalFingerprint); expect(r.extras).toEqual([]); expect(r.active).toBeNull()
})
it('actual completion coordinator archives under slot and ancestor WAL locks and preserves advanced packets, ancestry and pending export', async () => {
  const certify = { ...await fixture.packet(58), phase: 'SIGNED' }
  const r = await run(async ({ certify }) => {
    const g = globalThis as any
    await g.adopt()
    const advanced = { ...g.link.previousPayment, certify }, ancestorKey = g.W.walrusSingleKey(advanced.intent)
    g.W.writeWalrusSingleRecord(ancestorKey, advanced)
    const before = [...Array(localStorage.length)].map((_, n) => { const key = localStorage.key(n)!; return [key, localStorage.getItem(key)] }).sort()
    const observed: any[] = []
    // Only the already-proved chain query boundary is injected. The actual
    // completion coordinator, bundle verification/export, IndexedDB archive,
    // localStorage journals and all Web Locks below are production code.
    const query = async ({ record, payment }: any) => {
      observed.push({ digest: payment?.certify?.digest ?? null,
        held: (await navigator.locks.query()).held?.map(lock => lock.name).sort() })
      const key = g.W.walrusSingleKey(payment.intent), done = payment.certify?.digest === certify.digest
      return { recovery: { status: done ? 'CERTIFIED' : 'SOURCE_REQUIRED', record: payment, recoveryKey: key },
        historical: done ? { certifyDigest: certify.digest, versionIndex: record.scope.versionIndex,
          blobObjectId: payment.uploaded.blobObjectId } : null,
        current: null, currentStatus: done ? 'CHANGED' : 'NOT_CONFIRMED', currentReason: done ? 'Controlled later transfer observation' : null }
    }
    const params = { record: g.next, client: g.client, signal: new AbortController().signal, getAddress: () => g.next.scope.author }
    const finished = await g.Q.finishContentAppendCompletion(params, { query })
    const text = await g.X.exportContentAppendRecovery(g.next, g.client), imported = await g.X.importContentAppendRecovery(text, g.client)
    const retry = await g.Q.finishContentAppendCompletion(params, { query })
    const archive = await g.store.listArchived(g.scope), after = [...Array(localStorage.length)]
      .map((_, n) => { const key = localStorage.key(n)!; return [key, localStorage.getItem(key)] }).sort()
    const archivedActive = await g.store.read(g.key)
    // A newer signed head may be created after completion; retrying the old
    // finish must not remove it, even though the old receipt remains final.
    await g.store.create(g.key, g.alternate)
    const conflict = await g.errorOf(() => g.Q.finishContentAppendCompletion(params, { query }))
    return { completed: finished.completed?.result.historical?.certifyDigest, retry: retry.completed?.result.historical?.certifyDigest,
      currentStatus: finished.completed?.result.currentStatus, archivedActive,
      archived: archive.map((record: any) => g.fingerprint(record)), expected: g.fingerprint(g.next),
      exportedHead: g.fingerprint(imported.record), exportedHistory: imported.history, exportedPending: imported.pending,
      extras: imported.additionalPayments, localSame: JSON.stringify(before) === JSON.stringify(after),
      observed, expectedLocks: [`soulidity:${g.key}`, ...g.paymentEntries.map(([key]: any) => key)].sort(),
      conflict, active: g.fingerprint(await g.store.read(g.key)), alternate: g.fingerprint(g.alternate) }
  }, { certify })
  expect(r.completed).toBe(certify.digest); expect(r.retry).toBe(certify.digest); expect(r.currentStatus).toBe('CHANGED')
  expect(r.archivedActive).toBeNull(); expect(r.archived).toEqual([r.expected]); expect(r.exportedHead).toBe(r.expected)
  expect(r.exportedHistory).toEqual([fixture.link]); expect(r.exportedPending).toEqual(second.link)
  expect(r.extras).toEqual([{ ...fixture.link.previousPayment, certify }]); expect(r.localSame).toBe(true)
  expect(r.observed.some((row: any) => row.digest === certify.digest)).toBe(true)
  expect(r.observed.every((row: any) => JSON.stringify(row.held) === JSON.stringify(r.expectedLocks))).toBe(true)
  expect(r.conflict).toContain('ACTIVE_CHANGED'); expect(r.active).toBe(r.alternate)
})
it.each(['stage', 'complete'])('%s rejects an unadvertised local pending edge instead of silently omitting it', async method => {
  const r = await run(async method => {
    const g = globalThis as any, bundle = { ...g.bundle, pending: null }
    await g.restore.stage(bundle); await g.raw('rebase', `${g.key}:${g.fingerprint(g.next)}`, g.secondLink)
    return { error: await g.errorOf(() => g.restore[method](bundle)), pending: await g.raw('rebase', `${g.key}:${g.fingerprint(g.next)}`), marker: Boolean(await g.marker()), active: await g.store.read(g.key) }
  }, method)
  expect(r.error).toContain('PENDING_CONFLICT'); expect(r.pending).toEqual(second.link); expect(r.marker).toBe(true); expect(r.active).toBeNull()
})

it.each(['restore.put', 'rebase.put', 'active.put', 'restore.delete'])('failure at %s aborts the transaction without losing the original encrypted marker', async point => {
  const r = await run(async point => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const [store, method] = point.split('.'), proto = IDBObjectStore.prototype as any, original = proto[method]
    proto[method] = function (...args: any[]) {
      if (this.name === store) throw new DOMException('Injected storage failure', 'QuotaExceededError')
      return Reflect.apply(original, this, args)
    }
    let error
    try { error = await g.errorOf(() => g.restore[point === 'restore.put' ? 'stage' : 'complete'](g.bundle)) } finally { proto[method] = original }
    const s = await g.restoreStatus()
    return { error, same: g.T.contentAppendRestoreFingerprint(s.marker) === g.T.contentAppendRestoreFingerprint(g.bundle), active: s.active, history: s.history, pending: s.pending }
  }, point)
  expect(r.error).toContain('Injected storage failure'); expect(r.same).toBe(true)
  expect(r.active).toBeNull(); expect(r.history).toBeNull(); expect(r.pending).toBeNull()
})
it.each(['restore', 'active', 'rebase'])('an aborted %s precondition read retains the staged bundle and writes no partial state', async store => {
  const r = await run(async store => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (...args: any[]) {
      const request = Reflect.apply(original, this, args)
      if (this.name === store && this.transaction.mode === 'readwrite') queueMicrotask(() => { try { this.transaction.abort() } catch {} })
      return request
    }
    let error
    try { error = await g.errorOf(() => g.restore.complete(g.bundle)) } finally { IDBObjectStore.prototype.get = original }
    const s = await g.restoreStatus()
    return { error, same: g.T.contentAppendRestoreFingerprint(s.marker) === g.T.contentAppendRestoreFingerprint(g.bundle), active: s.active, history: s.history, pending: s.pending }
  }, store)
  expect(r.error).toBeTruthy(); expect(r.same).toBe(true); expect(r.active).toBeNull(); expect(r.history).toBeNull(); expect(r.pending).toBeNull()
})
it.each(['stage', 'complete'])('%s post-commit readback interruption is visible and cold recovery still finds all committed data', async phase => {
  const r = await run(async phase => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const original = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      const tx = Reflect.apply(original, this, args)
      if (args[1] === 'readonly') queueMicrotask(() => tx.abort())
      return tx
    }
    let error
    try { error = await g.errorOf(() => g.restore[phase](g.bundle)) } finally { IDBDatabase.prototype.transaction = original }
    const s = await g.restoreStatus()
    return { error, marker: s.marker !== null, active: s.active && g.fingerprint(s.active), expected: g.fingerprint(g.next), history: s.history, pending: s.pending }
  }, phase)
  expect(r.error).toContain('READ_FAILED')
  if (phase === 'stage') { expect(r.marker).toBe(true); expect(r.active).toBeNull(); expect(r.history).toBeNull(); expect(r.pending).toBeNull() }
  else { expect(r.marker).toBe(false); expect(r.active).toBe(r.expected); expect(r.history).toEqual(fixture.link); expect(r.pending).toEqual(second.link) }
})
it('list cursor interruption fails visibly without deleting the durable import', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const original = IDBObjectStore.prototype.openKeyCursor
    IDBObjectStore.prototype.openKeyCursor = function (...args: any[]) {
      const request = Reflect.apply(original, this, args); queueMicrotask(() => this.transaction.abort()); return request
    }
    let error
    try { error = await g.errorOf(() => g.restore.list(g.scope)) } finally { IDBObjectStore.prototype.openKeyCursor = original }
    return { error, count: (await g.T.browserContentAppendRestoreStore(g.client).list(g.scope)).length }
  })
  expect(r.error).toContain('LIST_FAILED'); expect(r.count).toBe(1)
})
it('cold reads reject corrupted signed material and wrong-key transplants rather than treating them as empty', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const corrupted = structuredClone(g.bundle); corrupted.record.ciphertext[0] ^= 1
    await g.raw('restore', g.key, corrupted)
    const corrupt = await g.errorOf(() => g.restore.read(g.key))
    await g.raw('restore', g.key, g.bundle)
    const other = `${g.key}-other`; await g.raw('restore', other, g.bundle)
    return { corrupt, wrongKey: await g.errorOf(() => g.restore.read(other)), original: Boolean(await g.marker()) }
  })
  expect(r.corrupt).toBeTruthy(); expect(r.wrongKey).toContain('KEY_MISMATCH'); expect(r.original).toBe(true)
})
it('list refuses overflow rather than truncating and leaves every staged record intact', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    for (let n = 0; n < 16; n++) await g.raw('restore', `${g.key}-${n}`, g.bundle)
    const error = await g.errorOf(() => g.restore.list(g.scope))
    return { error, original: Boolean(await g.marker()), last: Boolean(await g.raw('restore', `${g.key}-15`)) }
  })
  expect(r.error).toContain('LIST_LIMIT'); expect(r.original).toBe(true); expect(r.last).toBe(true)
})
it('database version 3 upgrades existing stores in place and retains pre-existing active and archive entries', async () => {
  const r = await run(async () => {
    const g = globalThis as any
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('soulidity-content-append'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('soulidity-content-append', 2)
      r.onupgradeneeded = () => { for (const s of ['active', 'archive', 'rebase']) r.result.createObjectStore(s) }
      r.onsuccess = () => { r.result.close(); resolve() }; r.onerror = () => reject(r.error)
    })
    await g.raw('active', g.key, g.next); await g.raw('archive', 'sentinel', { retained: true })
    await g.restore.stage(g.bundle)
    const db = await g.S.openContentAppendDatabase(), version = db.version, stores = [...db.objectStoreNames]; db.close()
    return { version, stores, active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.next), archive: await g.raw('archive', 'sentinel'), marker: Boolean(await g.marker()) }
  })
  expect(r.version).toBe(3); expect(r.stores).toEqual(['active', 'archive', 'rebase', 'restore'])
  expect(r.active).toBe(r.expected); expect(r.archive).toEqual({ retained: true }); expect(r.marker).toBe(true)
})

it('initial marker quota failure creates no active state and exact original bundle can be staged on retry', async () => {
  const r = await run(async () => {
    const g = globalThis as any, original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === 'restore') throw new DOMException('Initial marker quota failure', 'QuotaExceededError')
      return Reflect.apply(original, this, args)
    }
    let error
    try { error = await g.errorOf(() => g.restore.stage(g.bundle)) } finally { IDBObjectStore.prototype.put = original }
    const empty = await g.restoreStatus(); await g.restore.stage(g.bundle)
    return { error, empty, same: g.T.contentAppendRestoreFingerprint(await g.marker()) === g.T.contentAppendRestoreFingerprint(g.bundle) }
  })
  expect(r.error).toContain('Initial marker quota failure'); expect(r.empty).toEqual({ marker: null, active: null, history: null, pending: null }); expect(r.same).toBe(true)
})
it('database opening failure neither hides nor removes a previously durable import', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    const original = IDBFactory.prototype.open
    IDBFactory.prototype.open = function () { throw new DOMException('Injected open failure', 'UnknownError') }
    let error
    try { error = await g.errorOf(() => g.restore.complete(g.bundle)) } finally { IDBFactory.prototype.open = original }
    return { error, same: g.T.contentAppendRestoreFingerprint(await g.marker()) === g.T.contentAppendRestoreFingerprint(g.bundle), active: await g.store.read(g.key) }
  })
  expect(r.error).toContain('Injected open failure'); expect(r.same).toBe(true); expect(r.active).toBeNull()
})
it('malformed list scope fails explicitly rather than broadening the lookup or returning a fake empty page', async () => {
  const r = await run(async () => {
    const g = globalThis as any; await g.restore.stage(g.bundle)
    return { error: await g.errorOf(() => g.restore.list({ ...g.scope, author: '0x1' })), count: (await g.restore.list(g.scope)).length }
  })
  expect(r.error).toContain('LIST_SCOPE_INVALID'); expect(r.count).toBe(1)
})

it('actual restore service queries all packets then stages, installs every WAL key and atomically activates under real locks', async () => {
  const r = await run(async () => {
    const g = globalThis as any, put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem, get = Storage.prototype.getItem
    IDBObjectStore.prototype.put = function (...args: any[]) {
      g.observe.push(`idb:${this.name}`); return Reflect.apply(put, this, args)
    }
    Storage.prototype.setItem = function (...args: any[]) {
      if (g.paymentEntries.some(([key]: any) => key === args[0])) g.observe.push(`wal:${args[0]}`)
      return Reflect.apply(set, this, args)
    }
    Storage.prototype.getItem = function (...args: any[]) {
      if (g.paymentEntries.some(([key]: any) => key === args[0])) g.observe.push(`read:${args[0]}`)
      return Reflect.apply(get, this, args)
    }
    let active
    try { active = await g.adopt() } finally { IDBObjectStore.prototype.put = put; Storage.prototype.setItem = set; Storage.prototype.getItem = get }
    const expectedLocks = [`soulidity:${g.key}`, ...g.paymentEntries.map(([key]: any) => key)].sort()
    return { active: g.fingerprint(active), expected: g.fingerprint(g.next), marker: await g.marker(),
      history: await g.transitions.history(active), pending: await g.transitions.pending(active),
      walCount: g.paymentEntries.filter(([key, payment]: any) => JSON.stringify(g.W.readWalrusSingleRecord(key)) === JSON.stringify(payment)).length,
      expectedCount: g.paymentEntries.length, trace: g.observe, locks: g.lockObservations, expectedLocks }
  })
  expect(r.active).toBe(r.expected); expect(r.marker).toBeNull(); expect(r.history).toEqual([fixture.link]); expect(r.pending).toEqual(second.link)
  expect(r.expectedCount).toBe(3); expect(r.walCount).toBe(3)
  const stage = r.trace.indexOf('idb:restore'), active = r.trace.indexOf('idb:active')
  expect(stage).toBeGreaterThan(0)
  expect(r.trace.slice(0, stage).every((s: string) => s === 'chain' || s.startsWith('query:') || s.startsWith('read:'))).toBe(true)
  const writes = r.trace.map((s: string, n: number) => s.startsWith('wal:') ? n : -1).filter((n: number) => n >= 0)
  expect(writes).toHaveLength(3); expect(writes.every((n: number) => n > stage && n < active)).toBe(true)
  for (const n of writes) expect(r.trace.slice(n + 1, active)).toContain(r.trace[n].replace(/^wal:/, 'read:'))
  expect(r.locks.length).toBeGreaterThanOrEqual(3); for (const locks of r.locks) expect(locks).toEqual(r.expectedLocks)
})
it('actual service partial multi-key WAL failure leaves a discoverable marker; cold retry installs the same bundle without rewrapping', async () => {
  const r = await run(async () => {
    const g = globalThis as any, set = Storage.prototype.setItem; let writes = 0
    Storage.prototype.setItem = function (...args: any[]) {
      if (g.paymentEntries.some(([key]: any) => key === args[0]) && ++writes === 2) throw new DOMException('Second payment WAL quota failure', 'QuotaExceededError')
      return Reflect.apply(set, this, args)
    }
    let error
    try { error = await g.errorOf(() => g.adopt()) } finally { Storage.prototype.setItem = set }
    const cold = g.T.browserContentAppendRestoreStore(g.client), bundles = await cold.list(g.scope)
    const interrupted = { marker: bundles.length, active: await g.store.read(g.key), keys: g.paymentEntries.filter(([key]: any) => g.W.readWalrusSingleRecord(key)).length }
    const stamp = g.T.contentAppendRestoreFingerprint(bundles[0]), active = await g.adopt(bundles[0])
    return { error, interrupted, stamp, original: g.T.contentAppendRestoreFingerprint(g.bundle), active: g.fingerprint(active), expected: g.fingerprint(g.next),
      marker: await cold.read(g.key), count: g.paymentEntries.filter(([key]: any) => g.W.readWalrusSingleRecord(key)).length, pending: await g.transitions.pending(active) }
  })
  expect(r.error).toBeTruthy(); expect(r.interrupted).toEqual({ marker: 1, active: null, keys: 1 })
  expect(r.stamp).toBe(r.original); expect(r.active).toBe(r.expected); expect(r.marker).toBeNull(); expect(r.count).toBe(3); expect(r.pending).toEqual(second.link)
})
it('actual service rejects a conflicting same-key local packet before any marker or WAL mutation', async () => {
  const r = await run(async () => {
    const g = globalThis as any, [key, incoming] = g.paymentEntries[0]
    const local = structuredClone(incoming); local.approved.gasBudget = String(BigInt(local.approved.gasBudget) + 1n)
    g.W.writeWalrusSingleRecord(key, local)
    const before = localStorage.getItem(key), error = await g.errorOf(() => g.adopt())
    return { error, unchanged: localStorage.getItem(key) === before, marker: await g.marker(), active: await g.store.read(g.key),
      count: g.paymentEntries.filter(([k]: any) => g.W.readWalrusSingleRecord(k)).length, observations: g.observe }
  })
  expect(r.error).toContain('PAYMENT_CONFLICT'); expect(r.unchanged).toBe(true); expect(r.marker).toBeNull(); expect(r.active).toBeNull(); expect(r.count).toBe(1); expect(r.observations).toEqual([])
})
