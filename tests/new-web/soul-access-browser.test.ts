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
import { SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { soulAccessTransactionFixture, accessId } from './fixtures/soul-access-transaction'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

// Isolated Chrome, native localStorage/Web Locks, actual access parsers, journal
// runner, signature verification and historical query. Node builds/signs fixture
// PTBs with a test-only key; only public packets and controlled RPC evidence enter
// Chrome. This is not live-wallet, mainnet payment or live authority acceptance.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, origin: string, payload: any
let primary: string, secondary: string, secondaryTarget: string
let nextId = 0
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cdp(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { calls.delete(id); reject(Error(`Chrome command timed out: ${method}`)) }, 10000)
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
    if (await run(() => Boolean((globalThis as any).S && (globalThis as any).R && (globalThis as any).T), {}, session)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw Error(`Chrome bundle unavailable: ${JSON.stringify(await run(() => (globalThis as any).__bootErrors, {}, session))}`)
}
async function freshSecondary() {
  if (secondaryTarget) await cdp('Target.closeTarget', { targetId: secondaryTarget })
  const { targetId } = await cdp('Target.createTarget', { url: `${origin}/cold` }); secondaryTarget = targetId
  secondary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await ready(secondary)
}
async function initialize(session: string, landed: string[] = []) {
  await run(({ encoded, landed }) => {
    const revive = (value: any): any => {
      if (value && typeof value === 'object' && '$fixtureBigint' in value) return BigInt(value.$fixtureBigint)
      if (value && typeof value === 'object' && '$fixtureBytes' in value) return new Uint8Array(value.$fixtureBytes)
      if (Array.isArray(value)) return value.map(revive)
      return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry)])) : value
    }
    const g = globalThis as any, input = revive(encoded)
    g.samples = input.samples; g.record = input.samples[0].prepared; g.key = g.T.soulAccessKey(g.record.plan)
    g.store = g.S.browserSoulAccessStore(); g.landed = new Set(landed)
    g.counts = { prepare: 0, sign: 0, verify: 0, broadcast: 0, query: 0, historicalReads: 0 }
    g.unknownBroadcast = false; g.stopBeforeSign = false; g.holdPreflight = false; g.preflightEntered = false
    g.client = {
      core: { getChainIdentifier: async () => ({ chainIdentifier: input.genesis }) },
      ledgerService: {
        getTransaction: async ({ digest }: { digest: string }) => {
          const sample = g.samples.find((row: any) => row.signed.packet.digest === digest)
          if (!sample?.ledger || !g.landed.has(digest)) throw Object.assign(Error('not found'), { code: 'NOT_FOUND' })
          g.historicalSample = sample; return structuredClone(sample.ledger)
        },
        getObject: async ({ objectId, version }: { objectId: string; version: bigint }) => {
          g.counts.historicalReads++
          const row = g.historicalSample?.rows.find((candidate: any) => candidate.objectId === objectId && candidate.version === version)
          if (!row) throw Error('Unexpected historical object read')
          return { response: { object: structuredClone(row) } }
        },
      },
    }
    g.evidence = g.T.createSoulAccessAdapter({ client: g.client, getAddress: () => null,
      sign: async () => { throw Error('No browser wallet signer') }, preflight: async () => { throw Error('No live authority preflight') } })
    g.adapter = {
      prepare: async (plan: any) => {
        g.counts.prepare++
        const sample = g.samples.find((row: any) => g.T.soulAccessSame(row.prepared.plan, plan))
        if (!sample) throw Error('Unknown test intent')
        return structuredClone(sample.prepared)
      },
      query: async (record: any) => { g.counts.query++; return g.evidence.query(record) },
      preflight: async () => {
        if (g.holdPreflight) {
          g.preflightEntered = true; await new Promise<void>(resolve => { g.releasePreflight = resolve }); g.holdPreflight = false
        }
        if (g.stopBeforeSign) throw Error('CONTROLLED_STOP_BEFORE_SIGN')
      },
      sign: async (record: any) => {
        g.counts.sign++
        const signed = g.samples.find((row: any) => row.signed.packet.bytes === record.packet.bytes)?.signed
        if (!signed) throw Error('No fixture signature for changed transaction bytes')
        return { bytes: signed.packet.bytes, signature: signed.packet.signature }
      },
      verifySignature: async (record: any) => { g.counts.verify++; await g.evidence.verifySignature(record) },
      broadcast: async (record: any) => {
        g.counts.broadcast++; g.T.parseSoulAccessRecord(record); g.landed.add(record.packet.digest)
        if (g.unknownBroadcast) throw Error('CONTROLLED_LOST_ACKNOWLEDGEMENT')
      },
    }
    g.seed = async (phase: string, index = 0) => {
      const sample = g.samples[index], key = g.T.soulAccessKey(sample.prepared.plan)
      await g.store.exclusive(key, async () => {
        g.store.write(key, sample.prepared)
        if (phase !== 'PREPARED') g.store.write(key, { ...sample.prepared, packet: { ...sample.prepared.packet, phase: 'SIGNING' } })
        if (phase === 'SIGNED') { await g.evidence.verifySignature(sample.signed); g.store.write(key, sample.signed) }
      })
      return g.store.read(key)
    }
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    globalThis.fetch = async () => { throw Error('No external browser RPC or owned HTTP API in this suite') }
  }, { encoded: payload, landed }, session)
}

beforeAll(async () => {
  const samples: any[] = []
  for (const price of ['10001', '11001']) {
    const fixture = await soulAccessTransactionFixture({ action: 'paid-purchase', entry: 'absent', price })
    const prepared = await fixture.adapter.prepare(fixture.plan)
    expect(prepared.packet.bytes).toBe(fixture.record.packet.bytes)
    samples.push({ prepared, signed: fixture.record,
      ledger: await fixture.client.ledgerService.getTransaction(), rows: [...fixture.rows.values()] })
    if (price === '10001') {
      // Variants use the real builder/local fixture signer. They are valid
      // proposed packets, not claims of chain execution on a new deployment.
      for (const kind of ['callable', 'market']) {
        const plan = structuredClone(fixture.plan)
        if (kind === 'callable') plan.deployment.callablePackageId = accessId(7104)
        else {
          plan.deployment.marketConfigId = accessId(7100)
          plan.expected.marketConfigBcs = SoulPublicMarketConfigBcs.serialize({ ...fixture.market, id: accessId(7100) }).toBase64()
        }
        const signed = await fixture.packet(plan)
        samples.push({ variant: kind, signed, prepared: { ...signed, packet: { ...signed.packet, phase: 'PREPARED', signature: null } }, ledger: null, rows: [] })
      }
    }
  }
  // Original, callable variant, market variant, next same-key price intent.
  payload = wire({ samples, genesis: MAINNET_GENESIS_DIGEST })
  const entry = `import * as S from ${JSON.stringify(resolve(root, 'web/lib/soulidity/soul-access-store.ts'))};
import * as R from ${JSON.stringify(resolve(root, 'web/lib/soulidity/soul-access-runner.ts'))};
import * as T from ${JSON.stringify(resolve(root, 'web/lib/soulidity/soul-access-operation.ts'))};
Object.assign(globalThis, { S, R, T });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'soul-access-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  origin = `http://127.0.0.1:${address.port}`; profile = await mkdtemp(join(tmpdir(), 'soul-access-chrome-'))
  const executable = process.env.CHROME_BIN ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
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
      if (call) { calls.delete(message.id); clearTimeout(call.timer)
        if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result) }
    }
  })
  const rejectPending = (error: Error) => { for (const call of calls.values()) { clearTimeout(call.timer); call.reject(error) } calls.clear() }
  chrome.on('error', rejectPending); chrome.on('exit', () => rejectPending(Error('Isolated Chrome exited')))
  const { targetId } = await cdp('Target.createTarget', { url: origin })
  primary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await ready(primary)
}, 30000)
beforeEach(async () => { await run(() => localStorage.clear()); await initialize(primary) })
afterAll(async () => {
  if (chrome) {
    const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()))
    try { await cdp('Browser.close') } catch {}
    if (chrome.exitCode === null) { chrome.kill(); await exited }
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  // Exact isolated mkdtemp output only; never a user profile or workspace path.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

it('cold Chrome discovers the signed fixed purchase quote and verifies its exact public signature', async () => {
  const saved = await run(async () => { const g = globalThis as any; return { record: await g.seed('SIGNED'), key: g.key } })
  await freshSecondary()
  const cold = await run(({ record, key }) => {
    const g = globalThis as any, store = g.S.browserSoulAccessStore()
    return { found: store.discover({ soulId: record.plan.soulId, originalPackageId: record.plan.deployment.originalPackageId }),
      read: store.read(key), locks: Boolean(navigator.locks), volatileRecord: g.record ?? null }
  }, saved, secondary)
  expect(cold.locks).toBe(true); expect(cold.volatileRecord).toBeNull(); expect(cold.found).toEqual([saved.record]); expect(cold.read).toEqual(saved.record)
  await initialize(secondary)
  expect(await run(async () => { const g = globalThis as any; await g.evidence.verifySignature(g.store.read(g.key)); return g.store.read(g.key).plan.quote }, {}, secondary)).toEqual(saved.record.plan.quote)
})
it('lost broadcast acknowledgement remains SIGNED; cold query/resume confirms the original without preparing, signing or paying again', async () => {
  const uncertain = await run(async () => {
    const g = globalThis as any; g.unknownBroadcast = true
    const error = await g.errorOf(() => g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter, startNew: true }))
    return { error, record: g.store.read(g.key), counts: g.counts }
  })
  expect(uncertain.error).toBe('CONTROLLED_LOST_ACKNOWLEDGEMENT'); expect(uncertain.record.packet.phase).toBe('SIGNED')
  expect(uncertain.counts).toMatchObject({ prepare: 1, sign: 1, broadcast: 1 }); expect(uncertain.counts.verify).toBeGreaterThan(0)
  await freshSecondary(); await initialize(secondary, [uncertain.record.packet.digest])
  const recovered = await run(async () => {
    const g = globalThis as any, before = localStorage.getItem(g.key)
    const queried = await g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter, queryOnly: true })
    const unchanged = localStorage.getItem(g.key) === before
    const resumed = await g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter,
      expectedPacket: { bytes: g.record.packet.bytes, digest: g.record.packet.digest } })
    return { queried, unchanged, resumed, counts: g.counts }
  }, {}, secondary)
  expect(recovered.queried.status).toBe('SUCCEEDED'); expect(recovered.queried.checkpoint).toBe('42'); expect(recovered.unchanged).toBe(true)
  expect(recovered.resumed.record.packet).toEqual({ ...uncertain.record.packet, phase: 'SUCCEEDED' })
  expect(recovered.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0, query: 2 }); expect(recovered.counts.historicalReads).toBeGreaterThan(0)
})
it.each(['callable', 'market'])('two real tabs with different %s keys cannot prepare another payment while the shared operation lock is held', async variant => {
  await freshSecondary(); await initialize(secondary)
  await run(() => {
    const g = globalThis as any; g.holdPreflight = true; g.stopBeforeSign = true
    g.inFlight = g.errorOf(() => g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter, startNew: true }))
  })
  await expect.poll(() => run(() => (globalThis as any).preflightEntered)).toBe(true)
  try {
    const other = await run(async ({ variant }) => {
      const g = globalThis as any, sample = g.samples.find((s: any) => s.variant === variant), locks = await navigator.locks.query()
      const error = await g.errorOf(() => g.R.runSoulAccess({ plan: sample.prepared.plan, store: g.store, adapter: g.adapter, startNew: true }))
      return { error, counts: g.counts, distinctKey: g.T.soulAccessKey(sample.prepared.plan) !== g.key,
        newRecord: g.store.read(g.T.soulAccessKey(sample.prepared.plan)), names: locks.held?.map(lock => lock.name) }
    }, { variant }, secondary)
    expect(other.distinctKey).toBe(true); expect(other.error).toContain('SOUL_ACCESS_STORE_BUSY')
    expect(other.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0 }); expect(other.newRecord).toBeNull()
    expect(other.names.some((name: string) => name.startsWith('soulidity.soul-access-operation:'))).toBe(true)
  } finally { await run(async () => { const g = globalThis as any; g.releasePreflight(); await g.inFlight }) }
})
it.each(['callable', 'market'])('an old UNKNOWN signed purchase blocks a fresh %s-key payment after the lock is released', async variant => {
  const previous = await run(async () => { const g = globalThis as any; return g.seed('SIGNED') })
  await freshSecondary(); await initialize(secondary)
  const blocked = await run(async ({ variant }) => {
    const g = globalThis as any, sample = g.samples.find((s: any) => s.variant === variant), before = localStorage.getItem(g.key)
    const error = await g.errorOf(() => g.R.runSoulAccess({ plan: sample.prepared.plan, store: g.store, adapter: g.adapter, startNew: true }))
    return { error, counts: g.counts, previous: g.store.read(g.key), unchanged: before === localStorage.getItem(g.key),
      next: g.store.read(g.T.soulAccessKey(sample.prepared.plan)) }
  }, { variant }, secondary)
  expect(blocked.error).toContain('OTHER_DEPLOYMENT_RECOVERY_REQUIRED'); expect(blocked.previous).toEqual(previous); expect(blocked.unchanged).toBe(true)
  expect(blocked.next).toBeNull(); expect(blocked.counts).toMatchObject({ query: 1, prepare: 0, sign: 0, broadcast: 0 })
})
it('retains the confirmed payment receipt before another price intent; a cold page can query and export it without changing the new head', async () => {
  const saved = await run(async () => {
    const g = globalThis as any
    const completed = await g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter, startNew: true })
    g.stopBeforeSign = true
    const error = await g.errorOf(() => g.R.runSoulAccess({ plan: g.samples[3].prepared.plan, store: g.store, adapter: g.adapter, startNew: true }))
    return { completed: completed.record, error, next: g.store.read(g.key), history: g.store.history(g.key) }
  })
  expect(saved.error).toBe('CONTROLLED_STOP_BEFORE_SIGN'); expect(saved.next.packet.phase).toBe('PREPARED')
  expect(saved.next.plan.quote.priceAtomic).toBe('11001'); expect(saved.history).toEqual([saved.completed])
  await freshSecondary(); await initialize(secondary, [saved.completed.packet.digest])
  const cold = await run(async () => {
    const g = globalThis as any, before = localStorage.getItem(g.key), history = g.store.history(g.key)
    const result = await g.evidence.query(history[0])
    const exported = g.T.parseSoulAccessRecord(JSON.parse(await new Blob([JSON.stringify(history[0])], { type: 'application/json' }).text()))
    await g.evidence.verifySignature(exported)
    return { result, exported, current: g.store.read(g.key), unchanged: localStorage.getItem(g.key) === before, counts: g.counts }
  }, {}, secondary)
  expect(cold.result.status).toBe('SUCCEEDED'); expect(cold.exported).toEqual(saved.completed); expect(cold.current).toEqual(saved.next); expect(cold.unchanged).toBe(true)
  expect(cold.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0 })
})
it('only an intact PREPARED pre-sign journal can cancel, retaining the original bytes for cold inspection', async () => {
  const cancelled = await run(async () => {
    const g = globalThis as any; await g.seed('PREPARED')
    return g.R.runSoulAccess({ plan: g.record.plan, store: g.store, adapter: g.adapter, cancelUnsigned: true,
      expectedPacket: { bytes: g.record.packet.bytes, digest: g.record.packet.digest } })
  })
  expect(cancelled.status).toBe('MISSING'); expect(cancelled.record.packet.phase).toBe('CANCELLED'); expect(cancelled.record.packet.signature).toBeNull()
  await freshSecondary(); await initialize(secondary)
  const cold = await run(() => { const g = globalThis as any; return { record: g.store.read(g.key), counts: g.counts } }, {}, secondary)
  expect(cold.record).toEqual(cancelled.record); expect(cold.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0 })
})
it.each(['SIGNING', 'SIGNED'])('never cancels or TTL-discards an unresolved %s payment, even with the wall clock advanced far beyond expiry', async phase => {
  const result = await run(async ({ phase }) => {
    const g = globalThis as any, original = await g.seed(phase), before = localStorage.getItem(g.key), now = Date.now
    Date.now = () => 4102444800000
    try {
      const queried = await g.R.runSoulAccess({ plan: original.plan, store: g.store, adapter: g.adapter, queryOnly: true })
      const cancelError = await g.errorOf(() => g.R.runSoulAccess({ plan: original.plan, store: g.store, adapter: g.adapter, cancelUnsigned: true,
        expectedPacket: { bytes: original.packet.bytes, digest: original.packet.digest } }))
      return { original, queried, cancelError, unchanged: before === localStorage.getItem(g.key), records: g.store.discover({
        soulId: original.plan.soulId, originalPackageId: original.plan.deployment.originalPackageId }), counts: g.counts }
    } finally { Date.now = now }
  }, { phase })
  expect(result.queried.status).toBe('MISSING'); expect(result.cancelError).toContain('CANNOT_CANCEL_SIGNING')
  expect(result.unchanged).toBe(true); expect(result.records).toEqual([result.original]); expect(result.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0 })
})
