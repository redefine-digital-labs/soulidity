import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { privateBookmarkRecoveryFixture } from './fixtures/private-bookmark-recovery'
import { bookmarkCryptoFixture } from './fixtures/private-bookmark-crypto'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions'
import { buildCommitPrivateWalletBookmarksTx } from '@soulidity/sdk'
import { fromBase64, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { parsePrivateBookmarkRecovery, privateBookmarkWalrusKey } from '../../web/lib/bookmarks/private-bookmark-recovery'

// Native IndexedDB and Web Locks in separate actual Chrome documents. Only
// public metadata and real AES/Seal ciphertext enter Chrome; no plaintext,
// local test key, user profile, wallet or external RPC does. Controller query
// statuses below are deliberately injected: these tests prove durable recovery
// orchestration, NOT signatures, ledger finality or mainnet payment authority.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, origin: string
let primary: string, secondary: string, secondaryTarget: string | null = null
let fixture: Awaited<ReturnType<typeof privateBookmarkRecoveryFixture>>, payload: any
let nextId = 0
const requests: string[] = []
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cdp(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { calls.delete(id); reject(Error(`Chrome command timed out: ${method}`)) }, method === 'Browser.close' ? 2000 : 10000)
    calls.set(id, { resolve, reject, timer })
    ;(chrome.stdio[3] as Duplex).write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
  })
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}, session = primary): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true, returnByValue: true }, session)
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value as T
}
function wire(value: any): any {
  if (value instanceof Uint8Array) return { $fixtureBytes: [...value] }
  if (Array.isArray(value)) return value.map(wire)
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, wire(entry)])) : value
}
async function ready(session: string, oldNonce?: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (await run(old => { const g = globalThis as any; return Boolean(g.R && g.C && g.W && indexedDB && navigator.locks && g.bootNonce !== old) }, oldNonce, session)) return
    } catch (error) {
      if (!/context|navigat/i.test(String(error))) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error(`Chrome bundle unavailable: ${JSON.stringify(await run(() => (globalThis as any).__bootErrors, {}, session))}`)
}
async function freshSecondary() {
  if (secondaryTarget) await cdp('Target.closeTarget', { targetId: secondaryTarget })
  const { targetId } = await cdp('Target.createTarget', { url: `${origin}/second` }); secondaryTarget = targetId
  secondary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await ready(secondary)
}
async function initialize(session: string) {
  await run(encoded => {
    const revive = (value: any): any => {
      if (value && typeof value === 'object' && '$fixtureBytes' in value) return new Uint8Array(value.$fixtureBytes)
      if (Array.isArray(value)) return value.map(revive)
      return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry)])) : value
    }
    const g = globalThis as any, data = revive(encoded)
    g.record = data.record; g.paid = data.paid; g.prepared = data.prepared; g.signed = data.signed; g.walrus = data.walrus
    g.key = g.R.privateBookmarkRecoveryKey(g.record.context.scope, g.record.context.originalPackageId)
    g.store = g.R.browserPrivateBookmarkRecoveryStore()
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
  }, payload, session)
}
async function reloadPrimary() {
  const nonce = await run(() => (globalThis as any).bootNonce)
  await cdp('Page.enable', {}, primary); await cdp('Page.reload', { ignoreCache: true }, primary)
  await ready(primary, nonce)
}

beforeAll(async () => {
  fixture = await privateBookmarkRecoveryFixture()
  // A separate real local test key signs only its own fixture wallet's exact
  // SDK packet. Re-encrypt to its matching owner scope; never retag ciphertext.
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(97))
  const cryptoFixture = await bookmarkCryptoFixture({ scope: { ...fixture.record.context.scope, owner: signer.toSuiAddress() },
    originalPackageId: fixture.record.context.originalPackageId, chainIdentifier: fixture.record.context.chainIdentifier })
  const signed = structuredClone(fixture.prepared)
  signed.context = cryptoFixture.context; signed.ciphertext = await cryptoFixture.encryptBytes(); signed.cipherSha256 = toHex(sha256(signed.ciphertext))
  signed.storage!.reference = { ...signed.storage!.reference, sha256: signed.cipherSha256, byteLength: String(signed.ciphertext.length) }
  signed.storage!.recoveryKey = privateBookmarkWalrusKey(signed)
  signed.transaction!.plan = { ...signed.transaction!.plan, scope: signed.context.scope, ciphertext: signed.storage!.reference }
  const raw = new TransactionDataBuilder(buildCommitPrivateWalletBookmarksTx(signed.transaction!.plan).getData())
  const oldPacket = TransactionDataBuilder.fromBytes(fromBase64(fixture.prepared.transaction!.packet.bytes))
  raw.gasData = { ...oldPacket.gasData, owner: signed.context.scope.owner }
  raw.expiration = oldPacket.expiration
  raw.inputs = raw.inputs.map(input => input.UnresolvedObject
    ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: true }) : input)
  const bytes = raw.build(), signature = await signer.signTransaction(bytes)
  signed.transaction!.packet = { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10',
    phase: 'SIGNED', signature: signature.signature }
  payload = wire({ record: fixture.record, paid: fixture.paid, prepared: fixture.prepared, signed: parsePrivateBookmarkRecovery(signed), walrus: fixture.walrus })
  const entry = `import * as R from ${JSON.stringify(resolve(root, 'web/lib/bookmarks/private-bookmark-recovery.ts'))};
import * as C from ${JSON.stringify(resolve(root, 'web/lib/bookmarks/private-bookmark-controller.ts'))};
import * as W from ${JSON.stringify(resolve(root, 'web/lib/upload/walrus-single-operation.ts'))};
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { fromBase64 } from '@mysten/sui/utils';
Object.assign(globalThis, { R, C, W, verifyTransactionSignature, fromBase64, bootNonce: crypto.randomUUID(), outbound: [] });
globalThis.fetch = async (...args) => { globalThis.outbound.push(String(args[0])); throw Error('External requests forbidden in isolated recovery suite'); };`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'private-bookmark-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('Content-Security-Policy', "connect-src 'none'; img-src 'none'")
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  origin = `http://127.0.0.1:${address.port}`; profile = await mkdtemp(join(tmpdir(), 'private-bookmark-browser-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw Error('This suite requires actual Chrome/Chromium or CHROME_BIN; no mock fallback')
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let buffered = ''
  ;(chrome.stdio[4] as Duplex).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const end = buffered.indexOf('\0'); if (end < 0) break
      const message = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (!message) continue
      const parsed = JSON.parse(message), call = calls.get(parsed.id)
      if (call) { calls.delete(parsed.id); clearTimeout(call.timer)
        if (parsed.error) call.reject(Error(parsed.error.message)); else call.resolve(parsed.result) }
    }
  })
  const rejectPending = (error: Error) => { for (const call of calls.values()) { clearTimeout(call.timer); call.reject(error) } calls.clear() }
  chrome.on('error', rejectPending); chrome.on('exit', () => rejectPending(Error('Isolated Chrome exited')))
  const { targetId } = await cdp('Target.createTarget', { url: origin })
  primary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await ready(primary)
}, 30000)
beforeEach(async () => {
  if (secondaryTarget) { await cdp('Target.closeTarget', { targetId: secondaryTarget }); secondaryTarget = null }
  await run(async () => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('soulidity-private-bookmark-recovery')
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('isolated database reset blocked'))
    })
  })
  await initialize(primary)
})
afterAll(async () => {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Only this test's exact mkdtemp result; never a user profile or workspace.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

it('a cold second document reads exact durable ciphertext without receiving a plaintext library', async () => {
  const seeded = await run(async () => {
    const g = globalThis as any; await g.store.replace(g.key, null, g.record)
    return { key: g.key, fingerprint: g.R.privateBookmarkRecoveryFingerprint(g.record) }
  })
  await freshSecondary()
  const cold = await run(async ({ key }) => {
    const g = globalThis as any, record = await g.R.browserPrivateBookmarkRecoveryStore().read(key)
    return { bytes: [...record.ciphertext], fingerprint: g.R.privateBookmarkRecoveryFingerprint(record),
      volatile: { record: g.record ?? null, library: g.library ?? null, wallet: g.wallet ?? null }, outbound: g.outbound }
  }, seeded, secondary)
  expect(cold.bytes).toEqual([...fixture.record.ciphertext]); expect(cold.fingerprint).toBe(seeded.fingerprint)
  expect(cold.volatile).toEqual({ record: null, library: null, wallet: null }); expect(cold.outbound).toEqual([])
  expect(await fixture.decrypt(new Uint8Array(cold.bytes))).toEqual(fixture.library)
})

it('actual two-tab Web Locks refuse a second workflow while preserving the first operation', async () => {
  await freshSecondary(); await initialize(secondary)
  await run(async () => {
    const g = globalThis as any; g.entered = false
    g.holding = g.store.exclusive(g.key, async () => {
      await g.store.replace(g.key, null, g.record); g.entered = true
      await new Promise<void>(resolve => { g.release = resolve })
    })
    while (!g.entered) await new Promise(resolve => setTimeout(resolve, 0))
  })
  const contender = await run(async () => {
    const g = globalThis as any; let entered = false
    const error = await g.errorOf(() => g.store.exclusive(g.key, async () => { entered = true }))
    return { error, entered, held: (await navigator.locks.query()).held?.map(lock => lock.name),
      fingerprint: g.R.privateBookmarkRecoveryFingerprint(await g.store.read(g.key)) }
  }, {}, secondary)
  expect(contender.error).toContain('BUSY_IN_ANOTHER_TAB'); expect(contender.entered).toBe(false)
  const released = await run(async () => { const g = globalThis as any; g.release(); await g.holding; return g.R.privateBookmarkRecoveryFingerprint(await g.store.read(g.key)) })
  expect(contender.fingerprint).toBe(released)
  expect(contender.held).toContain(await run(() => (globalThis as any).key))
  expect(await run(async () => { const g = globalThis as any; return g.store.exclusive(g.key, async () => 'entered after release') }, {}, secondary)).toBe('entered after release')
})

it('closing a lock-holding document releases its native lock but does not erase committed recovery', async () => {
  await freshSecondary(); await initialize(secondary)
  await run(async () => {
    const g = globalThis as any; g.entered = false
    g.holding = g.store.exclusive(g.key, async () => { await g.store.replace(g.key, null, g.record); g.entered = true; await new Promise(() => {}) })
    while (!g.entered) await new Promise(resolve => setTimeout(resolve, 0))
  }, {}, secondary)
  expect(await run(async () => { const g = globalThis as any; return g.errorOf(() => g.store.exclusive(g.key, async () => {})) })).toContain('BUSY_IN_ANOTHER_TAB')
  await cdp('Target.closeTarget', { targetId: secondaryTarget }); secondaryTarget = null
  // Target-close acknowledgement precedes native lock-owner teardown. Observe
  // release without entering/retrying any mutation; never assume synchronous
  // browser-process cleanup from a CDP acknowledgement.
  await run(async () => {
    const g = globalThis as any
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await navigator.locks.query()).held?.some(lock => lock.name === g.key)) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error('Native lock was not released after isolated document teardown')
  })
  const result = await run(async () => {
    const g = globalThis as any
    return g.store.exclusive(g.key, async () => ({ fingerprint: g.R.privateBookmarkRecoveryFingerprint(await g.store.read(g.key)),
      expected: g.R.privateBookmarkRecoveryFingerprint(g.record) }))
  })
  expect(result.fingerprint).toBe(result.expected)
})

it('independent tab transactions enforce CAS even when callers skip the outer workflow lock', async () => {
  await run(async () => { const g = globalThis as any; await g.store.replace(g.key, null, g.record) })
  await freshSecondary(); await initialize(secondary)
  const mutate = async () => {
    const g = globalThis as any, next = { ...g.record, sequence: 1, paymentStarted: true }
    return g.errorOf(() => g.store.replace(g.key, g.record, next))
  }
  const results = await Promise.all([run(mutate), run(mutate, {}, secondary)])
  expect(results.filter(result => result === null)).toHaveLength(1)
  expect(results.find(result => result !== null)).toContain('CAS_CONFLICT')
  const saved = await run(async () => { const g = globalThis as any; const r = await g.store.read(g.key); return { sequence: r.sequence, paymentStarted: r.paymentStarted, bytes: [...r.ciphertext] } })
  expect(saved).toMatchObject({ sequence: 1, paymentStarted: true }); expect(saved.bytes).toEqual([...fixture.record.ciphertext])
})

it('a real page reload loses all volatile inputs while retaining paid ciphertext, public WAL and frozen head bytes', async () => {
  const before = await run(async () => {
    const g = globalThis as any, record = structuredClone(g.prepared)
    record.transaction.packet.phase = 'SIGNING'
    await g.store.replace(g.key, null, record)
    const walrusKey = g.R.privateBookmarkWalrusKey(record); g.W.writeWalrusSingleRecord(walrusKey, g.walrus)
    return { key: g.key, walrusKey, fingerprint: g.R.privateBookmarkRecoveryFingerprint(record), bytes: record.transaction.packet.bytes }
  })
  await reloadPrimary()
  const after = await run(async ({ key, walrusKey }) => {
    const g = globalThis as any, r = await g.R.browserPrivateBookmarkRecoveryStore().read(key)
    return { volatile: g.record ?? null, fingerprint: g.R.privateBookmarkRecoveryFingerprint(r), bytes: r.transaction.packet.bytes,
      phase: r.transaction.packet.phase, walrus: g.W.readWalrusSingleRecord(walrusKey), outbound: g.outbound }
  }, before)
  expect(after.volatile).toBeNull(); expect(after.fingerprint).toBe(before.fingerprint); expect(after.bytes).toBe(before.bytes)
  expect(after.phase).toBe('SIGNING'); expect(after.walrus).toEqual(fixture.walrus); expect(after.outbound).toEqual([])
})

it.each(['SIGNING', 'SIGNED'])('a cold actual controller queries unknown %s and persists controlled success without decrypting, signing or paying', async phase => {
  const key = await run(async phase => {
    const g = globalThis as any, r = structuredClone(phase === 'SIGNED' ? g.signed : g.prepared)
    r.transaction.packet.phase = phase
    if (phase === 'SIGNED') await g.verifyTransactionSignature(g.fromBase64(r.transaction.packet.bytes), r.transaction.packet.signature,
      { address: r.context.scope.owner })
    const key = g.R.privateBookmarkRecoveryKey(r.context.scope, r.context.originalPackageId)
    await g.store.replace(key, null, r); return key
  }, phase)
  await freshSecondary()
  const result = await run(async key => {
    const g = globalThis as any, store = g.R.browserPrivateBookmarkRecoveryStore(), r = await store.read(key)
    const counts = { query: 0, head: 0, decrypt: 0, upload: 0, recover: 0, prepare: 0, sign: 0, broadcast: 0 }
    const forbidden = (name: keyof typeof counts) => async () => { counts[name]++; throw Error(`Forbidden ${name} in cold query`) }
    let status = 'PENDING'
    const controller = g.C.createPrivateBookmarkController({ scope: r.context.scope, config: { ...r.config, writesEnabled: false },
      uploadConfig: r.uploadConfig, store, signal: new AbortController().signal, getAddress: () => null, writesEnabled: () => false,
      confirmHead: forbidden('sign'), readers: { head: forbidden('head'), unlock: forbidden('decrypt'), encrypt: forbidden('decrypt'), decryptRecovery: forbidden('decrypt') },
      payments: { upload: forbidden('upload'), recover: forbidden('recover') },
      transactions: { prepare: forbidden('prepare'), preflight: forbidden('sign'), sign: forbidden('sign'), verifySignature: forbidden('sign'),
        broadcast: forbidden('broadcast'), query: async (_plan: unknown, packet: any) => {
          counts.query++; if (packet.bytes !== r.transaction.packet.bytes) throw Error('Frozen packet replaced'); return status
        } } })
    const pending = await controller.resume(true), retained = await store.read(key)
    status = 'SUCCEEDED'
    const saved = await controller.resume(true), reread = await store.read(key)
    return { pending: pending.status, retained: retained.transaction.packet.phase, saved: saved.status,
      final: reread.status, phase: reread.transaction.packet.phase, bytes: reread.transaction.packet.bytes,
      expected: r.transaction.packet.bytes, counts, outbound: g.outbound }
  }, key, secondary)
  expect(result).toMatchObject({ pending: 'PENDING', retained: phase, saved: 'SAVED', final: 'COMPLETE', phase: 'SUCCEEDED' })
  expect(result.bytes).toBe(result.expected)
  expect(result.counts).toEqual({ query: 2, head: 0, decrypt: 0, upload: 0, recover: 0, prepare: 0, sign: 0, broadcast: 0 })
  expect(result.outbound).toEqual([])
})

it('a second tab cannot replace an unknown local payment with an imported stale backup', async () => {
  const encoded = await run(() => {
    const g = globalThis as any, key = g.R.privateBookmarkWalrusKey(g.paid)
    g.W.writeWalrusSingleRecord(key, g.walrus)
    const encoded = g.R.exportPrivateBookmarkRecovery(g.paid), uncertain = structuredClone(g.walrus)
    uncertain.approved.quoteId = 'another-unknown-payment'; g.W.writeWalrusSingleRecord(key, uncertain)
    return encoded
  })
  await freshSecondary(); await initialize(secondary)
  const result = await run(async encoded => {
    const g = globalThis as any, key = g.R.privateBookmarkWalrusKey(g.paid), before = localStorage.getItem(key)
    const error = await g.errorOf(() => g.R.importPrivateBookmarkRecovery(encoded, g.store, g.paid.context.scope, g.paid.context.originalPackageId))
    return { error, unchanged: before === localStorage.getItem(key), active: await g.store.read(g.key) }
  }, encoded, secondary)
  expect(result.error).toContain('EXISTING_PAYMENT'); expect(result.unchanged).toBe(true); expect(result.active).toBeNull()
})

it('atomic archive is visible from another document with exact ciphertext and no active slot', async () => {
  const saved = await run(async () => {
    const g = globalThis as any; await g.store.replace(g.key, null, g.record)
    await g.store.archive(g.key, g.record)
    return { key: g.key, requestId: g.record.context.requestId }
  })
  await freshSecondary()
  const result = await run(async ({ key, requestId }) => {
    const g = globalThis as any, store = g.R.browserPrivateBookmarkRecoveryStore(), archived = await store.archived(key, requestId)
    return { active: await store.read(key), status: archived.status, sequence: archived.sequence, bytes: [...archived.ciphertext], volatile: g.record ?? null }
  }, saved, secondary)
  expect(result).toMatchObject({ active: null, status: 'ARCHIVED', sequence: 1, volatile: null })
  expect(result.bytes).toEqual([...fixture.record.ciphertext])
})

it('persisted native stores and network requests contain no bookmarked Soul ID or private document fields', async () => {
  const result = await run(async () => {
    const g = globalThis as any; await g.store.replace(g.key, null, g.paid)
    g.W.writeWalrusSingleRecord(g.R.privateBookmarkWalrusKey(g.paid), g.walrus)
    const stores = await new Promise<any>((resolve, reject) => {
      const open = indexedDB.open('soulidity-private-bookmark-recovery', 1)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['active', 'archive'], 'readonly')
        const active = tx.objectStore('active').getAll(), archive = tx.objectStore('archive').getAll()
        const keys = tx.objectStore('active').getAllKeys()
        tx.onabort = () => { db.close(); reject(tx.error) }
        tx.oncomplete = () => { const value = { active: active.result, archive: archive.result, keys: keys.result }; db.close(); resolve(value) }
      }
    })
    const publicWal = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)] })
    return { stored: JSON.stringify({ stores, publicWal }), outbound: g.outbound, library: g.library ?? null }
  })
  expect(result.stored).not.toContain(fixture.soulId)
  expect(result.stored).not.toMatch(/"soulId"|"bookmarked"|"entries"|"requestHash"|"dek"|"privateKey"|"plaintext"/)
  expect(result.outbound).toEqual([]); expect(result.library).toBeNull()
  expect(requests.join('\n')).not.toContain(fixture.soulId)
})

it('wallet-scoped locks do not block an unrelated wallet while same-wallet state remains intact', async () => {
  await freshSecondary(); await initialize(secondary)
  await run(async () => {
    const g = globalThis as any; g.entered = false
    g.holding = g.store.exclusive(g.key, async () => { g.entered = true; await new Promise<void>(resolve => { g.release = resolve }) })
    while (!g.entered) await new Promise(resolve => setTimeout(resolve, 0))
  })
  const result = await run(async () => {
    const g = globalThis as any, scope = { ...g.record.context.scope, owner: `0x${'f'.repeat(64)}` }
    const otherKey = g.R.privateBookmarkRecoveryKey(scope, g.record.context.originalPackageId)
    return g.store.exclusive(otherKey, async () => ({ same: await g.store.read(g.key), other: await g.store.read(otherKey) }))
  }, {}, secondary)
  expect(result).toEqual({ same: null, other: null })
  await run(async () => { const g = globalThis as any; g.release(); await g.holding })
})
