import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'

// Reuses the existing store suite's real Chrome/CDP/IndexedDB/Web Locks harness
// in a separate mkdtemp browser profile. Preparations have actual local Seal/AES
// and Ed25519 signatures. Payment/inspection in the shared fixture are explicitly
// offline evidence; this suite does not claim live retirement, payment or signing.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, sessionId: string
let fixture: Awaited<ReturnType<typeof contentAppendRebaseFixture>>
let alternate: Awaited<ReturnType<typeof fixture.nextRecord>>, second: Awaited<ReturnType<typeof fixture.advance>>
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>()
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
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}
beforeAll(async () => {
  fixture = await contentAppendRebaseFixture()
  alternate = await fixture.nextRecord({ rebase: { ...fixture.rebase, nonce: 'cd'.repeat(16) } })
  second = await fixture.advance()
  const entry = `import * as S from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-store.ts'))};
import * as P from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-preparation.ts'))};
import * as R from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-rebase-store.ts'))};
import * as E from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-rebase-evidence.ts'))};
import * as C from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-append-rebase.ts'))};
import * as W from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-single-operation.ts'))};
Object.assign(globalThis, { S, P, R, E, C, W });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'content-append-rebase-store-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  profile = await mkdtemp(join(tmpdir(), 'content-append-rebase-idb-'))
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
    if (await run(() => Boolean((globalThis as any).R))) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const ready = await run(() => ({ ready: Boolean((globalThis as any).R && indexedDB && navigator.locks), errors: (globalThis as any).__bootErrors }))
  if (!ready.ready) throw Error(`Browser suite failed to load: ${JSON.stringify(ready.errors)}`)
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
    await g.store.create(g.key, g.previous)
    // Connection tests inject only RPC observations/explicit gas confirmation.
    // The coordinator constructs its actual IDB stores, localStorage WAL and
    // Web Locks. Already-prepared links must never request another Seal rewrap.
    g.connect = async () => {
      g.oldPaymentKey = g.W.walrusSingleKey(g.link.previousPayment.intent)
      g.nextPaymentKey = g.W.walrusSingleKey(g.link.nextPayment.intent)
      g.W.writeWalrusSingleRecord(g.oldPaymentKey, g.link.previousPayment)
      await g.transitions.prepare(g.link, g.previous.ciphertext)
      const intent = JSON.parse(g.next.scope.intentJson), scope = g.next.scope
      const proof = { soulId: intent.soulId, stateId: intent.stateId, contentId: scope.contentObjectId,
        originalPackageId: scope.originalPackageId, callablePackageId: scope.callablePackageId, kindRegistryId: intent.kindRegistryId,
        snapshot: { currentOwner: scope.author, ownershipEpoch: intent.ownershipEpoch, grantCapacity: '1', activeGrantCount: '0', grants: [],
          kindDescriptors: [{ kind: scope.kind, deprecated: false, op_mask: '1', read_mode_mask: '15', requires_download_policy: true, default_grant_scope_mask: '1' }],
          contentVersions: Array.from({ length: Number(scope.versionIndex) }, (_, n) => ({ kind: scope.kind, name: scope.name, versionIndex: String(n) })) } }
      const controller = new AbortController()
      g.approvals = []; g.inspections = 0; g.reads = 0; g.rewraps = 0; g.signs = 0
      const noSign = async () => { g.signs++; throw Error('Pending transition cannot sign or decrypt again') }
      const params = { record: g.previous, config: { target: { soulidityOriginalPackageId: scope.originalPackageId,
        soulidityCallablePackageId: scope.callablePackageId }, kindRegistryId: intent.kindRegistryId },
        execution: { client: g.client, getAddress: () => scope.author, sign: noSign },
        wallet: { client: g.client, sealClient: g.client, signal: controller.signal, getAddress: () => scope.author, signPersonalMessage: noSign },
        signal: controller.signal, approveGas: async (request: unknown) => { g.approvals.push(request); return intent.rebase.certifyGasBudgetMist } }
      const dependencies = {
        read: async () => { g.reads++; return structuredClone(proof) },
        inspect: async ({ record }: any) => { g.inspections++; return { status: 'REBASE_AVAILABLE', record: structuredClone(record), ...structuredClone(g.link.inspection) } },
        rewrap: async () => { g.rewraps++; throw Error('Must resume the original prepared stamp') },
      }
      g.coordinate = () => g.S.browserContentAppendStore(g.client).exclusive(g.key,
        () => g.C.prepareContentAppendRebase(params, dependencies))
    }
  }, { previous: { ...fixture.previous, ciphertext: [...fixture.previous.ciphertext] },
    next: { ...fixture.next, ciphertext: [...fixture.next.ciphertext] }, alternate: { ...alternate, ciphertext: [...alternate.ciphertext] },
    second: { ...second.record, ciphertext: [...second.record.ciphertext] }, link: fixture.link,
    alternateLink: fixture.linkFor(alternate), secondLink: second.link })
})
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => {
  if (chrome) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Only this suite's exact isolated mkdtemp profile, never a user/workspace path.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  vi.restoreAllMocks()
})

it('prepare durably commits only the transition and leaves the original active preparation unchanged', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext)
    const active = await g.store.read(g.key), pending = await g.transitions.pending(g.previous)
    return { active: g.fingerprint(active), before: g.fingerprint(g.previous), pending, history: await g.transitions.history(g.previous), localKeys: localStorage.length }
  })
  expect(result.active).toBe(result.before); expect(result.pending).toEqual(fixture.link)
  expect(result.history).toEqual([]); expect(result.localKeys).toBe(0)
})
it('cold store instances resume the exact prepared transition then atomically activate its signed next record', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext)
    const cold = g.R.browserContentAppendRebaseStore(g.client), pending = await cold.pending(g.previous)
    await cold.activate(pending, g.previous.ciphertext)
    const active = await g.S.browserContentAppendStore(g.client).read(g.key)
    return { active: g.fingerprint(active), expected: g.fingerprint(g.next), history: await cold.history(active),
      oldPending: await cold.pending(g.previous), nextPending: await cold.pending(active) }
  })
  expect(result.active).toBe(result.expected); expect(result.history).toEqual([fixture.link])
  expect(result.oldPending).toEqual(fixture.link); expect(result.nextPending).toBeNull()
})
it('same transition prepare/activation is idempotent without resetting the active record or copying ciphertext into links', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext); await g.transitions.prepare(g.link, g.previous.ciphertext)
    await g.transitions.activate(g.link, g.previous.ciphertext); await g.transitions.activate(g.link, g.previous.ciphertext)
    const raw = await g.raw('rebase', g.linkKey), active = await g.raw('active', g.key)
    return { link: raw, bytes: [...active.ciphertext], active: g.fingerprint(active), expected: g.fingerprint(g.next),
      compact: !Object.hasOwn(raw.previous, 'ciphertext') && !Object.hasOwn(raw.next, 'ciphertext') }
  })
  expect(result.link).toEqual(fixture.link); expect(result.compact).toBe(true)
  expect(result.bytes).toEqual([...fixture.previous.ciphertext]); expect(result.active).toBe(result.expected)
})
it('activation without a previously committed transition cannot change the original active stage', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    return { error: await g.errorOf(() => g.transitions.activate(g.link, g.previous.ciphertext)),
      active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous), pending: await g.transitions.pending(g.previous) }
  })
  expect(result.error).toContain('TRANSITION_MISSING_OR_CHANGED'); expect(result.active).toBe(result.expected); expect(result.pending).toBeNull()
})
it('a different genuinely author-signed nonce cannot replace an already prepared transition', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext)
    const error = await g.errorOf(() => g.transitions.prepare(g.alternateLink, g.previous.ciphertext))
    const activate = await g.errorOf(() => g.transitions.activate(g.alternateLink, g.previous.ciphertext))
    return { error, activate, pending: await g.transitions.pending(g.previous), active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous) }
  })
  expect(result.error).toContain('TRANSITION_ALREADY_PREPARED'); expect(result.activate).toContain('TRANSITION_MISSING_OR_CHANGED')
  expect(result.pending).toEqual(fixture.link); expect(result.active).toBe(result.expected)
})
it('concurrent real IndexedDB preparations commit one winner and reject the competing nonce atomically', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    const settled = await Promise.allSettled([g.transitions.prepare(g.link, g.previous.ciphertext),
      g.R.browserContentAppendRebaseStore(g.client).prepare(g.alternateLink, g.previous.ciphertext)])
    const pending = await g.transitions.pending(g.previous)
    return { status: settled.map(r => r.status).sort(), error: (settled.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message,
      winner: JSON.stringify(pending), candidates: [JSON.stringify(g.link), JSON.stringify(g.alternateLink)],
      active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous) }
  })
  expect(result.status).toEqual(['fulfilled', 'rejected']); expect(result.error).toContain('TRANSITION_ALREADY_PREPARED')
  expect(result.candidates).toContain(result.winner); expect(result.active).toBe(result.expected)
})
it.each(['prepare', 'activate'] as const)('%s requires the exact active CAS predecessor, not another signed preparation in the same slot', async phase => {
  const result = await run(async phase => {
    const g = globalThis as any
    if (phase === 'activate') await g.transitions.prepare(g.link, g.previous.ciphertext)
    await g.raw('active', g.key, g.alternate)
    const error = await g.errorOf(() => g.transitions[phase](g.link, g.previous.ciphertext))
    return { error, active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.alternate) }
  }, phase)
  expect(result.error).toContain(phase === 'prepare' ? 'PREPARATION_CAS_MISMATCH' : 'ACTIVATION_CAS_MISMATCH')
  expect(result.active).toBe(result.expected)
})
it.each(['prepare', 'activate'] as const)('%s refuses a missing active record instead of resurrecting an attempt', async phase => {
  const result = await run(async phase => {
    const g = globalThis as any
    if (phase === 'activate') await g.transitions.prepare(g.link, g.previous.ciphertext)
    await g.raw('active', g.key, undefined, true)
    return { error: await g.errorOf(() => g.transitions[phase](g.link, g.previous.ciphertext)), active: await g.store.read(g.key) }
  }, phase)
  expect(result.error).toContain('ACTIVE_MISSING'); expect(result.active).toBeNull()
})
it('cold history walks two actual signed transitions in original chronological order', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext); await g.transitions.activate(g.link, g.previous.ciphertext)
    await g.transitions.prepare(g.secondLink, g.next.ciphertext); await g.transitions.activate(g.secondLink, g.next.ciphertext)
    const cold = g.R.browserContentAppendRebaseStore(g.client), active = await g.store.read(g.key)
    const history = await cold.history(active)
    await g.E.verifyContentAppendRebaseHistory(active, history, g.client)
    return { history, active: g.fingerprint(active), expected: g.fingerprint(g.second),
      old: await cold.pending(g.previous), middle: await cold.pending(g.next), latest: await cold.pending(g.second) }
  })
  expect(result.history).toEqual([fixture.link, second.link]); expect(result.active).toBe(result.expected)
  expect(result.old).toEqual(fixture.link); expect(result.middle).toEqual(second.link); expect(result.latest).toBeNull()
})
it('two transitions retain one active ciphertext and only compact encrypted/public evidence in the link store', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext); await g.transitions.activate(g.link, g.previous.ciphertext)
    await g.transitions.prepare(g.secondLink, g.next.ciphertext); await g.transitions.activate(g.secondLink, g.next.ciphertext)
    const db = await g.S.openContentAppendDatabase()
    try { return await new Promise<{ active: any[]; links: any[]; archiveCount: number }>((resolve, reject) => {
      const tx = db.transaction(['active', 'rebase', 'archive'], 'readonly')
      const active = tx.objectStore('active').getAll(), links = tx.objectStore('rebase').getAll(), archives = tx.objectStore('archive').count()
      tx.onabort = () => reject(tx.error)
      tx.oncomplete = () => resolve({ active: active.result.map(r => ({ ...r, ciphertext: [...r.ciphertext] })), links: links.result, archiveCount: archives.result })
    }) } finally { db.close() }
  })
  expect(result.active).toHaveLength(1); expect(result.active[0].ciphertext).toEqual([...fixture.previous.ciphertext])
  expect(result.links).toHaveLength(2); expect(result.archiveCount).toBe(0)
  for (const link of result.links) {
    expect(link.previous).not.toHaveProperty('ciphertext'); expect(link.next).not.toHaveProperty('ciphertext')
    expect(JSON.stringify(link)).not.toContain('private memory: not in any public recovery journal')
    expect(link).not.toHaveProperty('dek'); expect(link).not.toHaveProperty('plaintext')
  }
})
it('a lost earlier link makes cold history fail visibly instead of shortening the ancestry', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext); await g.transitions.activate(g.link, g.previous.ciphertext)
    await g.transitions.prepare(g.secondLink, g.next.ciphertext); await g.transitions.activate(g.secondLink, g.next.ciphertext)
    await g.raw('rebase', g.linkKey, undefined, true)
    return { error: await g.errorOf(() => g.R.browserContentAppendRebaseStore(g.client).history(g.second)),
      active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.second) }
  })
  expect(result.error).toContain('HISTORY_MISSING'); expect(result.active).toBe(result.expected)
})
it('an alternate signed link under the expected parent key is detected as a history fork', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    await g.transitions.prepare(g.link, g.previous.ciphertext); await g.transitions.activate(g.link, g.previous.ciphertext)
    await g.raw('rebase', g.linkKey, g.alternateLink)
    return { error: await g.errorOf(() => g.transitions.history(g.next)), active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.next) }
  })
  expect(result.error).toContain('HISTORY_FORK'); expect(result.active).toBe(result.expected)
})
it.each(['budget', 'signature', 'duplicate-ciphertext', 'paid-payload', 'inspection', 'next-scope'] as const)(
  'tampered %s is rejected before prepare and again on a cold persisted-link read', async mutation => {
    const result = await run(async mutation => {
      const g = globalThis as any, bad = structuredClone(g.link)
      if (mutation === 'budget') bad.nextPayment.approved.gasBudget = '2'
      if (mutation === 'signature') bad.next.authorSignature = g.previous.authorSignature
      if (mutation === 'duplicate-ciphertext') bad.next.ciphertext = new Uint8Array(g.previous.ciphertext)
      if (mutation === 'paid-payload') bad.previousPayment.intent.payloadHash = 'ab'.repeat(32)
      if (mutation === 'inspection') bad.inspection.blobVersion = '0'
      if (mutation === 'next-scope') bad.next.scope.versionIndex = '1'
      const prepare = await g.errorOf(() => g.transitions.prepare(bad, g.previous.ciphertext))
      const absent = await g.transitions.pending(g.previous)
      await g.raw('rebase', g.linkKey, bad)
      return { prepare, absent, cold: await g.errorOf(() => g.R.browserContentAppendRebaseStore(g.client).pending(g.previous)),
        active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous) }
    }, mutation)
    expect(result.prepare).toBeTruthy(); expect(result.absent).toBeNull(); expect(result.cold).toBeTruthy()
    expect(result.active).toBe(result.expected)
  },
)
it('mutating the source link after prepare cannot change the committed transition or active ciphertext', async () => {
  const result = await run(async () => {
    const g = globalThis as any, input = structuredClone(g.link), ciphertext = new Uint8Array(g.previous.ciphertext)
    const task = g.transitions.prepare(input, ciphertext)
    input.nextPayment.approved.quoteId = 'changed immediately after call'
    await task
    const pending = await g.transitions.pending(g.previous)
    return { pending, bytes: [...(await g.store.read(g.key)).ciphertext] }
  })
  expect(result.pending).toEqual(fixture.link); expect(result.bytes).toEqual([...fixture.previous.ciphertext])
})
it.each(['prepare', 'activate'] as const)('%s quota failure preserves both the recovery predecessor and previously committed evidence', async phase => {
  const result = await run(async phase => {
    const g = globalThis as any
    if (phase === 'activate') await g.transitions.prepare(g.link, g.previous.ciphertext)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === (phase === 'prepare' ? 'rebase' : 'active')) throw new DOMException('controlled rebase quota', 'QuotaExceededError')
      return original.apply(this, args)
    }
    let error
    try { error = await g.errorOf(() => g.transitions[phase](g.link, g.previous.ciphertext)) }
    finally { IDBObjectStore.prototype.put = original }
    return { error, pending: await g.transitions.pending(g.previous), active: g.fingerprint(await g.store.read(g.key)), expected: g.fingerprint(g.previous) }
  }, phase)
  expect(result.error).toContain('controlled rebase quota'); expect(result.active).toBe(result.expected)
  expect(result.pending).toEqual(phase === 'activate' ? fixture.link : null)
})
it.each(['prepare', 'activate'] as const)('%s reports post-commit readback interruption; a cold retry resumes the same committed transition', async phase => {
  const result = await run(async phase => {
    const g = globalThis as any
    if (phase === 'activate') await g.transitions.prepare(g.link, g.previous.ciphertext)
    const original = IDBDatabase.prototype.transaction, durability: unknown[] = []
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args)
      if (args[1] === 'readwrite') durability.push(args[2]?.durability)
      if (args[1] === 'readonly') queueMicrotask(() => tx.abort())
      return tx
    }
    let error
    try { error = await g.errorOf(() => g.transitions[phase](g.link, g.previous.ciphertext)) }
    finally { IDBDatabase.prototype.transaction = original }
    const cold = g.R.browserContentAppendRebaseStore(g.client)
    const pending = await cold.pending(g.previous)
    const beforeRetry = g.fingerprint(await g.store.read(g.key))
    if (phase === 'prepare') await cold.prepare(pending, g.previous.ciphertext)
    await cold.activate(pending, g.previous.ciphertext)
    return { error, durability, pending, beforeRetry, previous: g.fingerprint(g.previous), next: g.fingerprint(g.next),
      afterRetry: g.fingerprint(await g.store.read(g.key)) }
  }, phase)
  expect(result.error).toContain('READ_FAILED'); expect(result.durability).toEqual(['strict'])
  expect(result.pending).toEqual(fixture.link)
  expect(result.beforeRetry).toBe(phase === 'prepare' ? result.previous : result.next); expect(result.afterRetry).toBe(result.next)
})
it('store operations leave unrelated paid WAL bytes untouched: activation is not payment installation', async () => {
  const result = await run(async () => {
    const g = globalThis as any
    localStorage.setItem('paid-wal-sentinel', 'retained exact packet')
    await g.transitions.prepare(g.link, g.previous.ciphertext)
    await g.transitions.activate(g.link, g.previous.ciphertext)
    return { value: localStorage.getItem('paid-wal-sentinel'), length: localStorage.length }
  })
  expect(result).toEqual({ value: 'retained exact packet', length: 1 })
})

it('connected coordinator commits pending link, writes/readbacks actual localStorage WAL, then activates actual IndexedDB', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.connect()
    const trace: string[] = [], originalPut = IDBObjectStore.prototype.put
    const originalSet = Storage.prototype.setItem, originalGet = Storage.prototype.getItem
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'rebase') this.transaction.addEventListener('complete', () => trace.push('transition-committed'), { once: true })
      if (this.name === 'active') trace.push('active-put')
      return originalPut.apply(this, args)
    }
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === g.nextPaymentKey) trace.push('next-wal-write')
      return originalSet.call(this, key, value)
    }
    Storage.prototype.getItem = function (key: string) {
      const value = originalGet.call(this, key)
      if (key === g.nextPaymentKey && value !== null) trace.push('next-wal-readback')
      return value
    }
    let next
    try { next = await g.coordinate() }
    finally { IDBObjectStore.prototype.put = originalPut; Storage.prototype.setItem = originalSet; Storage.prototype.getItem = originalGet }
    return { trace, next: g.fingerprint(next), expected: g.fingerprint(g.next), active: g.fingerprint(await g.store.read(g.key)),
      payment: g.W.readWalrusSingleRecord(g.nextPaymentKey), originalPayment: g.W.readWalrusSingleRecord(g.oldPaymentKey),
      history: await g.transitions.history(next), approvals: g.approvals, reads: g.reads, inspections: g.inspections,
      rewraps: g.rewraps, signs: g.signs }
  })
  expect(result.trace).toEqual(expect.arrayContaining(['transition-committed', 'next-wal-write', 'next-wal-readback', 'active-put']))
  expect(result.trace.indexOf('transition-committed')).toBeLessThan(result.trace.indexOf('next-wal-write'))
  expect(result.trace.indexOf('next-wal-write')).toBeLessThan(result.trace.indexOf('next-wal-readback'))
  expect(result.trace.indexOf('next-wal-readback')).toBeLessThan(result.trace.indexOf('active-put'))
  expect(result.next).toBe(result.expected); expect(result.active).toBe(result.expected)
  expect(result.payment).toEqual(fixture.link.nextPayment); expect(result.originalPayment).toEqual(fixture.link.previousPayment)
  expect(result.history).toEqual([fixture.link]); expect(result.approvals).toHaveLength(1)
  expect(result.approvals[0]).toMatchObject({ alreadyPrepared: true, suggestedGasBudgetMist: '700000', nextVersion: '3' })
  // Pending activation is local recovery, not a new write authority check:
  // it also queries the transition's retained predecessor packet separately.
  expect(result.reads).toBe(1); expect(result.inspections).toBe(3); expect(result.rewraps).toBe(0); expect(result.signs).toBe(0)
})
it.each(['quota', 'nonpersistent-write'] as const)(
  'connected coordinator %s retains old active/same pending; cold retry installs exactly the same stamped next preparation', async failure => {
    const result = await run(async failure => {
      const g = globalThis as any; await g.connect()
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === g.nextPaymentKey) {
          if (failure === 'quota') throw new DOMException('controlled payment WAL quota', 'QuotaExceededError')
          return
        }
        return original.call(this, key, value)
      }
      let error
      try { error = await g.errorOf(() => g.coordinate()) }
      finally { Storage.prototype.setItem = original }
      const oldActive = g.fingerprint(await g.S.browserContentAppendStore(g.client).read(g.key))
      const pending = await g.R.browserContentAppendRebaseStore(g.client).pending(g.previous)
      const absentPayment = g.W.readWalrusSingleRecord(g.nextPaymentKey)
      // Each coordinator invocation reconstructs both stores/real locks and
      // reloads committed records; no in-memory new-link/DEK state is supplied.
      const next = await g.coordinate(), cold = g.R.browserContentAppendRebaseStore(g.client)
      return { error, oldActive, previous: g.fingerprint(g.previous), pending, absentPayment,
        next: g.fingerprint(next), expected: g.fingerprint(g.next), active: g.fingerprint(await g.store.read(g.key)),
        payment: g.W.readWalrusSingleRecord(g.nextPaymentKey), original: g.W.readWalrusSingleRecord(g.oldPaymentKey),
        history: await cold.history(next), approvals: g.approvals, rewraps: g.rewraps, signs: g.signs }
    }, failure)
    expect(result.error).toContain(failure === 'quota' ? 'controlled payment WAL quota' : 'WALRUS_JOURNAL_PERSISTENCE_FAILED')
    expect(result.oldActive).toBe(result.previous); expect(result.pending).toEqual(fixture.link); expect(result.absentPayment).toBeNull()
    expect(result.next).toBe(result.expected); expect(result.active).toBe(result.expected)
    expect(result.payment).toEqual(fixture.link.nextPayment); expect(result.original).toEqual(fixture.link.previousPayment)
    expect(result.history).toEqual([fixture.link]); expect(result.approvals).toHaveLength(2)
    expect(result.approvals.every((a: any) => a.alreadyPrepared && a.suggestedGasBudgetMist === '700000')).toBe(true)
    expect(result.rewraps).toBe(0); expect(result.signs).toBe(0)
  },
)
