import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { CollectionPublicListingBcs, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { collectionBuyFixture, cid } from './fixtures/collection-buy'
import { parseCollectionBuyPlan, type CollectionBuyPlan } from '../../web/lib/collections/collection-buy-plan'
import { parseCollectionBuyRecord } from '../../web/lib/collections/collection-buy-operation'
import { collectionCommandHash } from '../../web/lib/collections/collection-command-plan'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

// Native isolated Chrome tabs, localStorage and Web Locks. The actual buy
// parser, journal and EVERY operation-adapter method run inside Chrome. Node
// creates real public PTBs/signatures with fixture-only keys; Chrome receives
// public packets and controlled raw RPC/checkpoint evidence, never a key.
// This does not execute Move, connect a live wallet, or send a live payment.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, origin: string, payload: any
let primary: string, secondary: string, secondaryTarget: string
let nextId = 0
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cdp(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { calls.delete(id); reject(Error(`Chrome command timed out: ${method}`)) }, 15000)
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
  if (typeof value === 'bigint') return { $fixtureBigint: String(value) }
  if (value instanceof Uint8Array) return { $fixtureBytes: [...value] }
  if (Array.isArray(value)) return value.map(wire)
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, wire(entry)])) : value
}
async function ready(session: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await run(() => Boolean((globalThis as any).J && (globalThis as any).T && (globalThis as any).P), {}, session)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error(`Chrome bundle unavailable: ${JSON.stringify(await run(() => (globalThis as any).__bootErrors, {}, session))}`)
}
async function freshSecondary() {
  if (secondaryTarget) await cdp('Target.closeTarget', { targetId: secondaryTarget })
  const { targetId } = await cdp('Target.createTarget', { url: `${origin}/cold` }); secondaryTarget = targetId
  secondary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId; await ready(secondary)
}
function variant(base: CollectionBuyPlan, kind: 'listing' | 'callable' | 'market') {
  const p = structuredClone(base), oldId = kind === 'listing' ? p.request.listingId : kind === 'callable' ? p.target.callablePackageId : p.target.marketConfigId
  const nextId = cid(kind === 'listing' ? 7001 : kind === 'callable' ? 7002 : 7003), row = p.objects.find(row => row.objectId === oldId)!
  const raw = bcs.Object.parse(fromBase64(row.bcs))
  if (kind === 'callable') { raw.data.Package!.id = nextId; p.target.callablePackageId = nextId }
  else if (kind === 'listing') {
    const listing = CollectionPublicListingBcs.parse(raw.data.Move!.contents); listing.id = nextId
    raw.data.Move!.contents = CollectionPublicListingBcs.serialize(listing).toBytes()
    p.request.listingId = nextId; p.expected.listingBcs = toBase64(raw.data.Move!.contents)
  } else {
    const market = SoulPublicMarketConfigBcs.parse(raw.data.Move!.contents); market.id = nextId
    raw.data.Move!.contents = SoulPublicMarketConfigBcs.serialize(market).toBytes()
    p.target.marketConfigId = nextId; p.expected.marketBcs = toBase64(raw.data.Move!.contents)
  }
  const bytes = bcs.Object.serialize(raw).toBytes(); row.objectId = nextId; row.bcs = toBase64(bytes); row.digest = collectionCommandHash('Object', bytes)
  if (kind === 'callable') p.target.callableDigest = row.digest
  return parseCollectionBuyPlan(p)
}
async function initialize(session: string, landed: string[] = [], index = 0) {
  await run(({ encoded, landed, index }) => {
    const revive = (value: any): any => {
      if (value && typeof value === 'object' && '$fixtureBigint' in value) return BigInt(value.$fixtureBigint)
      if (value && typeof value === 'object' && '$fixtureBytes' in value) return new Uint8Array(value.$fixtureBytes)
      if (Array.isArray(value)) return value.map(revive)
      return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry)])) : value
    }
    const g = globalThis as any, input = revive(encoded)
    g.samples = input.samples; g.variants = input.variants; g.selected = index; g.record = g.samples[index].prepared
    g.key = g.J.collectionBuyKey(g.record.plan); g.store = g.J.browserCollectionBuyStore(); g.landed = new Set(landed)
    g.counts = { prepare: 0, sign: 0, verify: 0, broadcast: 0, query: 0, sent: 0, wallet: 0, currentReads: 0, historicalReads: 0, checkpointReads: 0 }
    g.unknownBroadcast = false; g.holdPreflight = false; g.preflightEntered = false; g.stopPreflight = false; g.epoch = 9n
    g.address = g.record.plan.author
    const sample = () => g.samples[g.selected]
    g.client = {
      core: {
        getChainIdentifier: async () => ({ chainIdentifier: input.genesis }),
        getProtocolConfig: async () => ({ protocolConfig: { attributes: { max_tx_size_bytes: '131072', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384' } } }),
        resolveTransactionPlugin: () => async (data: any, _options: unknown, next: () => Promise<void>) => {
          const expected = g.X.Transaction.from(g.U.fromBase64(sample().prepared.packet.bytes)).getData()
          data.inputs = data.inputs.map((value: any) => {
            if (!value.UnresolvedObject) return value
            const original = expected.inputs.find((row: any) => row.Object?.SharedObject?.objectId === value.UnresolvedObject.objectId)
            if (!original) throw Error('Unexpected unresolved fixture object')
            return structuredClone(original)
          })
          data.gasData = structuredClone(expected.gasData); await next()
        },
        executeTransaction: async ({ transaction, signatures }: { transaction: Uint8Array; signatures: string[] }) => {
          const row = g.samples.find((row: any) => row.signed.packet.bytes === g.U.toBase64(transaction))
          if (!row || signatures.length !== 1 || signatures[0] !== row.signed.packet.signature) throw Error('Unexpected public fixture transaction')
          g.counts.sent++; g.landed.add(row.signed.packet.digest)
          if (g.unknownBroadcast) throw Error('CONTROLLED_LOST_ACKNOWLEDGEMENT')
          return {}
        },
      },
      ledgerService: {
        getServiceInfo: async () => ({ response: { chainId: input.genesis } }),
        getEpoch: async () => ({ response: { epoch: { epoch: g.epoch } } }),
        batchGetObjects: async ({ requests }: { requests: Array<{ objectId: string }> }) => {
          g.counts.currentReads += requests.length
          return { response: { objects: requests.map(({ objectId }) => {
            const row = sample().current.find((row: any) => row.objectId === objectId)
            return { result: row ? { oneofKind: 'object', object: structuredClone(row) } : { oneofKind: 'error', error: { code: 5 } } }
          }) } }
        },
        getTransaction: async ({ digest }: { digest: string }) => {
          const row = g.samples.find((row: any) => row.signed.packet.digest === digest)
          if (!row || !g.landed.has(digest)) throw Object.assign(Error('not found'), { code: 'NOT_FOUND' })
          g.historicalSample = row; return structuredClone(row.ledger)
        },
        getCheckpoint: async () => { g.counts.checkpointReads++; return { response: { checkpoint: structuredClone(g.historicalSample.checkpoint) } } },
        getObject: async ({ objectId, version }: { objectId: string; version: bigint }) => {
          g.counts.historicalReads++
          const row = g.historicalSample?.rows.find((row: any) => row.objectId === objectId && row.version === version)
          if (!row) throw Error('Unexpected exact historical object')
          return { response: { object: structuredClone(row) } }
        },
      },
      stateService: { listOwnedObjects: async () => ({ response: { objects: sample().prepared.plan.paymentCoinIds.map((objectId: string) => ({ objectId })) } }) },
      transactionExecutionService: { simulateTransaction: async (input: any) => ({ response: { transaction: {
        transaction: { bcs: { value: new Uint8Array(input.transaction.bcs.value) } }, effects: { status: { success: true } } } } }) },
    }
    g.actual = g.T.createCollectionBuyAdapter({ client: g.client, getAddress: () => g.address,
      sign: async (tx: any) => {
        const bytes = g.U.toBase64(await tx.build()), row = g.samples.find((row: any) => row.signed.packet.bytes === bytes)
        if (!row) throw Error('No real fixture signature for changed bytes')
        g.counts.wallet++; return { bytes, signature: row.signed.packet.signature }
      },
      preflight: async () => {
        if (g.holdPreflight) { g.preflightEntered = true; await new Promise<void>(resolve => { g.releasePreflight = resolve }); g.holdPreflight = false }
        if (g.stopPreflight) throw Error('CONTROLLED_STOP_BEFORE_SIGNATURE')
      },
      // No read override: actual assertCollectionBuyCurrent reads the full raw
      // object graph and repeats every relationship/quote check in Chrome.
    })
    g.adapter = Object.fromEntries(['prepare', 'sign', 'verifySignature', 'broadcast', 'query', 'preflight'].map(method => [method, async (...args: any[]) => {
      if (method !== 'preflight') g.counts[method === 'verifySignature' ? 'verify' : method]++
      return g.actual[method](...args)
    }]))
    g.seed = async (phase: string, sampleIndex = g.selected) => {
      const sample = g.samples[sampleIndex], key = g.J.collectionBuyKey(sample.prepared.plan)
      await g.store.exclusive(key, async () => {
        g.store.write(key, sample.prepared)
        if (phase !== 'PREPARED') g.store.write(key, { ...sample.prepared, packet: { ...sample.prepared.packet, phase: 'SIGNING' } })
        if (phase === 'SIGNED') { await g.actual.verifySignature(sample.signed); g.store.write(key, sample.signed) }
      }); return g.store.read(key)
    }
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    globalThis.fetch = async () => { throw Error('No live browser RPC or HTTP API is permitted by this test fixture') }
  }, { encoded: payload, landed, index }, session)
}

beforeAll(async () => {
  const samples: any[] = []
  for (const options of [{ price: '1000001' }, { price: '1000002' }, { newKiosk: true, price: '1000001' }]) {
    const f = await collectionBuyFixture(options), prepared = await f.adapter.prepare(f.plan)
    expect(prepared.packet.bytes).toBe(f.record.packet.bytes); parseCollectionBuyRecord(f.record)
    const current = f.plan.objects.map(row => {
      const value = f.rows.get(`${row.objectId}:${row.version}`)
      expect(value, 'Fixture must retain every exact prepared object version').toBeTruthy(); return value
    })
    samples.push({ prepared, signed: f.record, ledger: await f.client.ledgerService.getTransaction(), checkpoint: f.evidence.checkpoint,
      rows: [...f.rows.values()], current })
  }
  payload = wire({ samples, genesis: MAINNET_GENESIS_DIGEST,
    variants: Object.fromEntries((['listing', 'callable', 'market'] as const).map(kind => [kind, variant(samples[0].prepared.plan, kind)])) })
  const entry = `import * as J from ${JSON.stringify(resolve(root, 'web/lib/collections/collection-buy-journal.ts'))};
import * as T from ${JSON.stringify(resolve(root, 'web/lib/collections/collection-buy-operation.ts'))};
import * as P from ${JSON.stringify(resolve(root, 'web/lib/collections/collection-buy-plan.ts'))};
import * as X from '@mysten/sui/transactions'; import * as U from '@mysten/sui/utils';
Object.assign(globalThis, { J, T, P, X, U });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'collection-buy-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  origin = `http://127.0.0.1:${address.port}`; profile = await mkdtemp(join(tmpdir(), 'collection-buy-chrome-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
  if (!executable || !existsSync(executable)) throw Error('This suite requires installed Chrome/Chromium or CHROME_BIN')
  chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let buffered = ''
  ;(chrome.stdio[4] as Duplex).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const end = buffered.indexOf('\0'); if (end < 0) break
      const wire = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (!wire) continue
      const message = JSON.parse(wire), call = calls.get(message.id)
      if (call) { calls.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result) }
    }
  })
  const rejectPending = (error: Error) => { for (const call of calls.values()) { clearTimeout(call.timer); call.reject(error) } calls.clear() }
  chrome.on('error', rejectPending); chrome.on('exit', () => rejectPending(Error('Isolated Chrome exited')))
  const { targetId } = await cdp('Target.createTarget', { url: origin }); primary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId; await ready(primary)
}, 30000)
beforeEach(async () => { await run(() => localStorage.clear()); await initialize(primary) })
afterEach(async () => {
  if (primary) expect(await run(() => (globalThis as any).__bootErrors)).toEqual([])
  if (secondary) expect(await run(() => (globalThis as any).__bootErrors, {}, secondary)).toEqual([])
})
afterAll(async () => {
  if (chrome) { const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited } }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Only this exact isolated mkdtemp result; never an existing user profile.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

it.each([0, 2])('cold real tab discovers and verifies exact signed bytes for Kiosk sample %s without volatile state', async index => {
  await initialize(primary, [], index)
  const saved = await run(async () => { const g = globalThis as any; return { record: await g.seed('SIGNED'), key: g.key } })
  await freshSecondary()
  const cold = await run(({ record, key }) => { const g = globalThis as any, store = g.J.browserCollectionBuyStore()
    return { found: store.discover(record.plan.request.collectionId), read: store.read(key), locks: Boolean(navigator.locks), volatile: g.record ?? null }
  }, saved, secondary)
  expect(cold.locks).toBe(true); expect(cold.volatile).toBeNull(); expect(cold.found).toEqual([saved.record]); expect(cold.read).toEqual(saved.record)
  await initialize(secondary, [], index)
  expect(await run(async () => { const g = globalThis as any; await g.actual.verifySignature(g.store.read(g.key)); return g.store.read(g.key).plan.quote }, {}, secondary)).toEqual(saved.record.plan.quote)
})
it.each([0, 2])('lost acknowledgement: cold sample %s confirms the original through checkpoint and historical objects without repaying', async index => {
  await initialize(primary, [], index)
  const uncertain = await run(async () => {
    const g = globalThis as any; g.unknownBroadcast = true
    const prepared = await g.J.prepareCollectionBuy({ plan: g.record.plan, store: g.store, adapter: g.adapter })
    const error = await g.errorOf(() => g.J.runCollectionBuy({ record: prepared, store: g.store, adapter: g.adapter, mode: 'resume' }))
    return { error, record: g.store.read(g.key), counts: g.counts }
  })
  expect(uncertain.error).toBe('CONTROLLED_LOST_ACKNOWLEDGEMENT'); expect(uncertain.record.packet.phase).toBe('SIGNED')
  expect(uncertain.counts).toMatchObject({ prepare: 1, sign: 1, wallet: 1, broadcast: 1, sent: 1 }); expect(uncertain.counts.currentReads).toBeGreaterThan(0)
  await freshSecondary(); await initialize(secondary, [uncertain.record.packet.digest], index)
  const recovered = await run(async () => { const g = globalThis as any
    const result = await g.J.runCollectionBuy({ record: g.store.read(g.key), store: g.store, adapter: g.adapter, mode: 'query' })
    const resumed = await g.J.runCollectionBuy({ record: result.record, store: g.store, adapter: g.adapter, mode: 'resume' })
    return { result, resumed, counts: g.counts }
  }, {}, secondary)
  expect(recovered.result.status).toBe('SUCCEEDED'); expect(recovered.result.checkpoint).toBe('42')
  expect(recovered.resumed.record.packet).toEqual({ ...uncertain.record.packet, phase: 'SUCCEEDED' })
  expect(recovered.result.receipt).toMatchObject({ buyerAddress: uncertain.record.plan.author, totalPaymentAtomic: uncertain.record.plan.quote.buyerTotalAtomic })
  expect(recovered.counts).toMatchObject({ prepare: 0, sign: 0, wallet: 0, broadcast: 0, sent: 0, query: 2 })
  expect(recovered.counts.historicalReads).toBeGreaterThan(0); expect(recovered.counts.checkpointReads).toBeGreaterThan(0)
})
it.each(['listing', 'callable', 'market'])('two real tabs share one lock across %s changes and cannot open a second preparation', async kind => {
  await freshSecondary(); await initialize(secondary)
  await run(() => { const g = globalThis as any; g.holdPreflight = true; g.stopPreflight = true
    g.inFlight = g.errorOf(() => g.J.prepareCollectionBuy({ plan: g.record.plan, store: g.store, adapter: g.adapter })) })
  await expect.poll(() => run(() => (globalThis as any).preflightEntered)).toBe(true)
  try {
    const second = await run(async ({ kind }) => { const g = globalThis as any, plan = g.variants[kind], locks = await navigator.locks.query()
      const error = await g.errorOf(() => g.J.prepareCollectionBuy({ plan, store: g.store, adapter: g.adapter }))
      return { error, names: locks.held?.map(lock => lock.name), sameKey: g.J.collectionBuyKey(plan) === g.key, counts: g.counts }
    }, { kind }, secondary)
    expect(second.sameKey).toBe(true); expect(second.error).toContain('JOURNAL_BUSY'); expect(second.names).toContain(await run(() => (globalThis as any).key))
    expect(second.counts).toMatchObject({ prepare: 0, sign: 0, sent: 0 })
  } finally { await run(async () => { const g = globalThis as any; g.releasePreflight(); await g.inFlight }) }
})
it.each(['listing', 'callable', 'market'])('released lock does not allow an unknown signed purchase to be replaced by a different %s', async kind => {
  const original = await run(async () => { const g = globalThis as any; return g.seed('SIGNED') })
  await freshSecondary(); await initialize(secondary)
  const blocked = await run(async ({ kind }) => { const g = globalThis as any, before = localStorage.getItem(g.key)
    const error = await g.errorOf(() => g.J.prepareCollectionBuy({ plan: g.variants[kind], store: g.store, adapter: g.adapter }))
    return { error, record: g.store.read(g.key), unchanged: before === localStorage.getItem(g.key), counts: g.counts }
  }, { kind }, secondary)
  expect(blocked.error).toContain('RECOVERY_REQUIRED'); expect(blocked.record).toEqual(original); expect(blocked.unchanged).toBe(true)
  expect(blocked.counts).toMatchObject({ prepare: 0, sign: 0, wallet: 0, sent: 0, query: 1 })
})
it.each(['SIGNING', 'SIGNED'])('never cancels or expires away unresolved %s; current epoch blocks resume but not historical query', async phase => {
  const result = await run(async ({ phase }) => {
    const g = globalThis as any, original = await g.seed(phase), before = localStorage.getItem(g.key), now = Date.now
    Date.now = () => 4102444800000; g.epoch = 1000n
    try {
      const query = await g.J.runCollectionBuy({ record: original, store: g.store, adapter: g.adapter, mode: 'query' })
      const cancel = await g.errorOf(() => g.J.runCollectionBuy({ record: original, store: g.store, adapter: g.adapter, mode: 'cancel-unsigned' }))
      const resume = await g.errorOf(() => g.J.runCollectionBuy({ record: original, store: g.store, adapter: g.adapter, mode: 'resume' }))
      return { original, query, cancel, resume, unchanged: localStorage.getItem(g.key) === before,
        records: g.store.discover(original.plan.request.collectionId), counts: g.counts }
    } finally { Date.now = now }
  }, { phase })
  expect(result.query.status).toBe('MISSING'); expect(result.cancel).toContain('CANNOT_CANCEL_UNKNOWN_SIGNATURE'); expect(result.resume).toContain('EXPIRED_QUERY_ONLY')
  expect(result.records).toEqual([result.original]); expect(result.unchanged).toBe(true); expect(result.counts).toMatchObject({ prepare: 0, sign: 0, wallet: 0, sent: 0 })
})
it('explicit unsigned cancellation survives a cold tab with the same retained exact bytes', async () => {
  const cancelled = await run(async () => { const g = globalThis as any, record = await g.seed('PREPARED')
    return g.J.runCollectionBuy({ record, store: g.store, adapter: g.adapter, mode: 'cancel-unsigned' }) })
  expect(cancelled.record.packet.phase).toBe('CANCELLED'); expect(cancelled.record.packet.signature).toBeNull()
  await freshSecondary(); await initialize(secondary)
  const cold = await run(() => { const g = globalThis as any; return { record: g.store.read(g.key), counts: g.counts } }, {}, secondary)
  expect(cold.record).toEqual(cancelled.record); expect(cold.counts).toMatchObject({ prepare: 0, sign: 0, sent: 0 })
})
it('terminal receipt is archived before a fresh price intent and remains exportable/queryable without changing its head', async () => {
  const saved = await run(async () => { const g = globalThis as any
    const prepared = await g.J.prepareCollectionBuy({ plan: g.record.plan, store: g.store, adapter: g.adapter })
    const completed = await g.J.runCollectionBuy({ record: prepared, store: g.store, adapter: g.adapter, mode: 'resume' })
    g.selected = 1
    const next = await g.J.prepareCollectionBuy({ plan: g.samples[1].prepared.plan, store: g.store, adapter: g.adapter })
    return { completed, next, history: g.store.history(g.key) }
  })
  expect(saved.completed.status).toBe('SUCCEEDED'); expect(saved.next.packet.phase).toBe('PREPARED')
  expect(saved.history).toEqual([saved.completed.record]); expect(saved.next.plan.quote.priceAtomic).toBe('1000002')
  await freshSecondary(); await initialize(secondary, [saved.completed.record.packet.digest], 1)
  const cold = await run(async () => { const g = globalThis as any, before = localStorage.getItem(g.key), archived = g.store.history(g.key)[0], archiveBefore = JSON.stringify(g.store.history(g.key))
    const exported = g.T.parseCollectionBuyRecord(JSON.parse(await new Blob([JSON.stringify(archived)], { type: 'application/json' }).text()))
    await g.actual.verifySignature(exported)
    const result = await g.J.runCollectionBuy({ record: exported, store: g.store, adapter: g.adapter, mode: 'query' })
    const resumeError = await g.errorOf(() => g.J.runCollectionBuy({ record: exported, store: g.store, adapter: g.adapter, mode: 'resume' }))
    const cancelError = await g.errorOf(() => g.J.runCollectionBuy({ record: exported, store: g.store, adapter: g.adapter, mode: 'cancel-unsigned' }))
    return { exported, result, resumeError, cancelError, head: g.store.read(g.key), unchanged: before === localStorage.getItem(g.key), archiveUnchanged: archiveBefore === JSON.stringify(g.store.history(g.key)), counts: g.counts }
  }, {}, secondary)
  expect(cold.exported).toEqual(saved.completed.record); expect(cold.result.status).toBe('SUCCEEDED'); expect(cold.head).toEqual(saved.next); expect(cold.unchanged).toBe(true); expect(cold.archiveUnchanged).toBe(true)
  expect(cold.resumeError).toContain('ARCHIVED_PACKET_QUERY_ONLY'); expect(cold.cancelError).toContain('ARCHIVED_PACKET_QUERY_ONLY')
  expect(cold.counts).toMatchObject({ prepare: 0, sign: 0, wallet: 0, sent: 0 }); expect(cold.counts.historicalReads).toBeGreaterThan(0)
})
it('cancelled unsigned receipt is archived, not deleted, when a new quote is explicitly prepared', async () => {
  const saved = await run(async () => { const g = globalThis as any, prepared = await g.seed('PREPARED')
    const cancelled = await g.J.runCollectionBuy({ record: prepared, store: g.store, adapter: g.adapter, mode: 'cancel-unsigned' })
    g.selected = 1
    const next = await g.J.prepareCollectionBuy({ plan: g.samples[1].prepared.plan, store: g.store, adapter: g.adapter })
    return { cancelled, next, history: g.store.history(g.key), counts: g.counts }
  })
  expect(saved.cancelled.record.packet.phase).toBe('CANCELLED'); expect(saved.history).toEqual([saved.cancelled.record])
  expect(saved.counts).toMatchObject({ sign: 0, wallet: 0, sent: 0 })
  await freshSecondary(); await initialize(secondary, [], 1)
  const recovered = await run(async () => { const g = globalThis as any, before = localStorage.getItem(g.key), archiveBefore = JSON.stringify(g.store.history(g.key))
    const exported = g.T.parseCollectionBuyRecord(JSON.parse(JSON.stringify(g.store.history(g.key)[0])))
    const result = await g.J.runCollectionBuy({ record: exported, store: g.store, adapter: g.adapter, mode: 'query' })
    return { exported, result, unchanged: before === localStorage.getItem(g.key), archiveUnchanged: archiveBefore === JSON.stringify(g.store.history(g.key)) }
  }, {}, secondary)
  expect(recovered.exported).toEqual(saved.cancelled.record); expect(recovered.result.status).toBe('MISSING'); expect(recovered.unchanged).toBe(true); expect(recovered.archiveUnchanged).toBe(true)
})
it('real parser and signature checks reject changed quote/bytes/signature without replacing the shared head', async () => {
  const result = await run(async () => { const g = globalThis as any, original = await g.seed('SIGNED'), before = localStorage.getItem(g.key)
    const quote = structuredClone(original); quote.plan.quote.buyerTotalAtomic = '1'
    const badQuote = await g.errorOf(() => g.J.importCollectionBuy({ input: quote, collectionId: original.plan.request.collectionId, store: g.store, adapter: g.adapter }))
    const signature = structuredClone(original); signature.packet.signature = g.U.toBase64(new Uint8Array(97))
    const badSignature = await g.errorOf(() => g.actual.verifySignature(signature))
    const bytes = structuredClone(original); const tx = g.X.Transaction.from(g.U.fromBase64(bytes.packet.bytes)); tx.setGasBudget(2)
    bytes.packet.bytes = g.U.toBase64(await tx.build())
    const badBytes = await g.errorOf(() => g.T.parseCollectionBuyRecord(bytes))
    return { badQuote, badSignature, badBytes, unchanged: before === localStorage.getItem(g.key), counts: g.counts }
  })
  expect(result.badQuote).toBeTruthy(); expect(result.badSignature).toBeTruthy(); expect(result.badBytes).toBeTruthy(); expect(result.unchanged).toBe(true)
  expect(result.counts).toMatchObject({ prepare: 0, sign: 0, wallet: 0, sent: 0 })
})
