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
import { contentMutationTransactionFixture } from './fixtures/content-mutation-transaction'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

// Isolated real Chrome: native Storage/Web Locks and the actual transaction
// parser, signature verifier, runner and historical query reader. Fixture keys
// stay in Node; only public signed bytes and controlled RPC evidence enter the
// browser. This is not wallet, mainnet execution or quorum acceptance.
const root = fileURLToPath(new URL('../../', import.meta.url))
let chrome: ChildProcess, server: Server, profile: string, origin: string
let primary: string, secondary: string, secondaryTarget: string, payload: any
let nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cdp(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Chrome command timed out: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    ;(chrome.stdio[3] as Duplex).write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
  })
}
async function run<T>(fn: (value: any) => T | Promise<T>, value: any = {}, session = primary): Promise<T> {
  const result = await cdp('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(value)})`, awaitPromise: true,
    returnByValue: true }, session)
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
  const { targetId } = await cdp('Target.createTarget', { url: `${origin}/cold` })
  secondaryTarget = targetId
  secondary = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await ready(secondary)
  return secondary
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
    g.samples = input.samples; g.record = input.samples[0].prepared; g.key = g.T.contentMutationKey(g.record.plan)
    g.store = g.S.browserContentMutationStore(); g.landed = new Set(landed)
    g.counts = { prepare: 0, sign: 0, verify: 0, broadcast: 0, query: 0, historicalReads: 0 }
    g.unknownBroadcast = false; g.stopBeforeSign = false
    g.client = {
      core: { getChainIdentifier: async () => ({ chainIdentifier: input.genesis }) },
      ledgerService: {
        getTransaction: async ({ digest }: { digest: string }) => {
          const sample = g.samples.find((row: any) => row.signed.packet.digest === digest)
          if (!sample || !g.landed.has(digest)) throw Object.assign(Error('not found'), { code: 'NOT_FOUND' })
          return structuredClone(sample.ledger)
        },
        getObject: async ({ objectId, version }: { objectId: string; version: bigint }) => {
          g.counts.historicalReads++
          const row = g.samples.flatMap((sample: any) => sample.rows).find((candidate: any) => candidate.objectId === objectId && candidate.version === version)
          if (!row) throw Error('Unexpected historical object read')
          return { response: { object: structuredClone(row) } }
        },
      },
    }
    g.evidence = g.T.createContentMutationAdapter({ client: g.client, getAddress: () => null,
      sign: async () => { throw Error('No browser wallet signer') }, preflight: async () => { throw Error('No live authority preflight') } })
    g.adapter = {
      prepare: async (plan: any) => {
        g.counts.prepare++
        const sample = g.samples.find((row: any) => JSON.stringify(row.prepared.plan) === JSON.stringify(plan))
        if (!sample) throw Error('Unknown test intent')
        return structuredClone(sample.prepared)
      },
      query: async (record: any) => { g.counts.query++; return g.evidence.query(record) },
      preflight: async () => { if (g.stopBeforeSign) throw Error('CONTROLLED_STOP_BEFORE_SIGN') },
      sign: async (record: any) => {
        g.counts.sign++
        const signed = g.samples.find((row: any) => row.signed.packet.bytes === record.packet.bytes)?.signed
        if (!signed) throw Error('No signature for changed transaction bytes')
        return { bytes: signed.packet.bytes, signature: signed.packet.signature }
      },
      verifySignature: async (record: any) => { g.counts.verify++; await g.evidence.verifySignature(record) },
      broadcast: async (record: any) => {
        g.counts.broadcast++; g.T.parseContentMutationRecord(record); g.landed.add(record.packet.digest)
        if (g.unknownBroadcast) throw Error('CONTROLLED_LOST_ACKNOWLEDGEMENT')
      },
    }
    g.errorOf = async (work: () => unknown) => { try { await work(); return null } catch (error) { return (error as Error).message } }
    globalThis.fetch = async () => { throw Error('No external browser RPC or owned HTTP API in this suite') }
  }, { encoded: payload, landed }, session)
}

beforeAll(async () => {
  const samples = []
  for (const action of ['delete', 'set-active'] as const) {
    const fixture = await contentMutationTransactionFixture({ action })
    const prepared = await fixture.adapter.prepare(fixture.plan)
    expect(prepared.packet.bytes).toBe(fixture.record.packet.bytes)
    samples.push({ prepared, signed: fixture.record,
      ledger: await fixture.raw.client.ledgerService.getTransaction({ digest: fixture.record.packet.digest }), rows: [...fixture.rows.values()] })
  }
  payload = wire({ samples, genesis: MAINNET_GENESIS_DIGEST })
  const entry = `import * as S from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-mutation-store.ts'))};
import * as R from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-mutation-runner.ts'))};
import * as T from ${JSON.stringify(resolve(root, 'web/lib/soulidity/content-mutation-transaction.ts'))};
Object.assign(globalThis, { S, R, T });`
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve(root, 'web'), sourcefile: 'content-mutation-browser.ts' },
    bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, alias: { '@': resolve(root, 'web') } })
  server = createServer((request, response) => {
    if (request.url === '/suite.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].contents) }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><script>globalThis.__bootErrors=[];addEventListener("error",e=>__bootErrors.push(e.message));addEventListener("unhandledrejection",e=>__bootErrors.push(String(e.reason)))</script><script type="module" src="/suite.js"></script>') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Local server unavailable')
  origin = `http://127.0.0.1:${address.port}`
  profile = await mkdtemp(join(tmpdir(), 'content-mutation-chrome-'))
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
      const message = JSON.parse(wire), call = pending.get(message.id)
      if (call) { pending.delete(message.id); clearTimeout(call.timer)
        if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result) }
    }
  })
  const rejectPending = (error: Error) => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error) } pending.clear() }
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
  // Exact mkdtemp output created above; never a user profile or workspace path.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  vi.restoreAllMocks()
})

it('cold Chrome page discovers the real prepared transaction and reads identical bytes from native Storage', async () => {
  const saved = await run(async () => {
    const g = globalThis as any; await g.store.exclusive(g.key, async () => g.store.write(g.key, g.record))
    return { record: g.record, key: g.key }
  })
  await freshSecondary()
  const cold = await run(({ key, record }) => {
    const g = globalThis as any, store = g.S.browserContentMutationStore()
    return { found: store.discover({ soulId: record.plan.soulId, originalPackageId: record.plan.deployment.originalPackageId }),
      read: store.read(key), locks: Boolean(navigator.locks), volatileRecord: g.record ?? null }
  }, saved, secondary)
  expect(cold.locks).toBe(true); expect(cold.volatileRecord).toBeNull()
  expect(cold.found).toEqual([saved.record]); expect(cold.read).toEqual(saved.record)
})
it('native Web Locks exclude a second real tab for the entire open operation', async () => {
  await freshSecondary(); await initialize(secondary)
  await run(() => {
    const g = globalThis as any; g.lockEntered = false
    g.held = g.store.exclusive(g.key, async () => { g.lockEntered = true; await new Promise<void>(resolve => { g.release = resolve }) })
  })
  await expect.poll(() => run(() => (globalThis as any).lockEntered)).toBe(true)
  try {
    const result = await run(async () => {
      const g = globalThis as any, held = await navigator.locks.query(); let entered = false
      const error = await g.errorOf(() => g.store.exclusive(g.key, async () => { entered = true }))
      return { error, entered, names: held.held?.map(row => row.name), key: g.key }
    }, {}, secondary)
    expect(result.error).toContain('CONTENT_MUTATION_STORE_BUSY'); expect(result.entered).toBe(false); expect(result.names).toContain(result.key)
  } finally { await run(async () => { const g = globalThis as any; g.release(); await g.held }) }
  expect(await run(async () => { const g = globalThis as any; return g.store.exclusive(g.key, async () => 'acquired') }, {}, secondary)).toBe('acquired')
})
it('unknown broadcast keeps SIGNED; a cold page queries real historical evidence without preparing or signing again', async () => {
  const uncertain = await run(async () => {
    const g = globalThis as any; g.unknownBroadcast = true
    const error = await g.errorOf(() => g.R.runContentMutation({ plan: g.record.plan, store: g.store, adapter: g.adapter, startNew: true }))
    return { error, record: g.store.read(g.key), counts: g.counts }
  })
  expect(uncertain.error).toBe('CONTROLLED_LOST_ACKNOWLEDGEMENT'); expect(uncertain.record.packet.phase).toBe('SIGNED')
  expect(uncertain.counts).toMatchObject({ prepare: 1, sign: 1, broadcast: 1 })
  await freshSecondary(); await initialize(secondary, [uncertain.record.packet.digest])
  const recovered = await run(async () => {
    const g = globalThis as any, before = localStorage.getItem(g.key)
    const queried = await g.R.runContentMutation({ plan: g.record.plan, store: g.store, adapter: g.adapter, queryOnly: true })
    const unchanged = localStorage.getItem(g.key) === before
    const resumed = await g.R.runContentMutation({ plan: g.record.plan, store: g.store, adapter: g.adapter,
      expectedPacket: { bytes: g.record.packet.bytes, digest: g.record.packet.digest } })
    return { queried, unchanged, resumed, counts: g.counts }
  }, {}, secondary)
  expect(recovered.queried.status).toBe('SUCCEEDED'); expect(recovered.queried.checkpoint).toBe('42'); expect(recovered.unchanged).toBe(true)
  expect(recovered.resumed.record.packet).toEqual({ ...uncertain.record.packet, phase: 'SUCCEEDED' })
  expect(recovered.counts).toMatchObject({ prepare: 0, sign: 0, broadcast: 0, query: 2 }); expect(recovered.counts.historicalReads).toBeGreaterThan(0)
})
it('retains the exact terminal receipt before a new intent and reads both records from a cold page', async () => {
  const saved = await run(async () => {
    const g = globalThis as any
    const completed = await g.R.runContentMutation({ plan: g.record.plan, store: g.store, adapter: g.adapter, startNew: true })
    g.stopBeforeSign = true
    const error = await g.errorOf(() => g.R.runContentMutation({ plan: g.samples[1].prepared.plan, store: g.store, adapter: g.adapter, startNew: true }))
    return { completed: completed.record, error, next: g.store.read(g.key), history: g.store.history(g.key) }
  })
  expect(saved.error).toBe('CONTROLLED_STOP_BEFORE_SIGN'); expect(saved.next.packet.phase).toBe('PREPARED')
  expect(saved.next.plan.action).toBe('set-active'); expect(saved.history).toEqual([saved.completed])
  await freshSecondary(); await initialize(secondary, [saved.completed.packet.digest])
  const cold = await run(async () => {
    const g = globalThis as any, store = g.S.browserContentMutationStore(), before = localStorage.getItem(g.key), history = store.history(g.key)
    const proof = await g.evidence.query(history[0])
    return { history, current: store.read(g.key), proof, unchanged: localStorage.getItem(g.key) === before }
  }, {}, secondary)
  expect(cold.history).toEqual([saved.completed]); expect(cold.current).toEqual(saved.next)
  expect(cold.proof.status).toBe('SUCCEEDED'); expect(cold.unchanged).toBe(true)
})
