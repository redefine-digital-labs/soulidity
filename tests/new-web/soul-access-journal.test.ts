// Domain bytes/authority are independently tested by soul-access-operation.
// This suite isolates actual Storage + the cross-deployment coordinator.
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
vi.mock('../../web/lib/soulidity/soul-access-plan', () => ({
  parseSoulAccessPlan: (p: unknown) => structuredClone(p),
  soulAccessKey: (p: any) => `soulidity.soul-access:${['chainIdentifier', 'originalPackageId', 'callablePackageId', 'marketConfigId', 'kindRegistryId'].map(k => p.deployment[k]).join(':')}:${p.soulId}:${p.author}`,
}))
vi.mock('../../web/lib/soulidity/soul-access-operation', () => ({ parseSoulAccessRecord: (r: unknown) => structuredClone(r) }))
import { runSoulAccess } from '../../web/lib/soulidity/soul-access-runner'
import { browserSoulAccessStore } from '../../web/lib/soulidity/soul-access-store'
import { soulAccessKey, type SoulAccessRecord, type SoulAccessPlan } from '../../web/lib/soulidity/soul-access-plan'

const plan = (): SoulAccessPlan => ({ deployment: { chainIdentifier: 'chain', originalPackageId: 'original',
  callablePackageId: 'callable', marketConfigId: 'market', kindRegistryId: 'registry', paymentCoinType: 'USDC' },
  soulId: 'soul', author: 'alice', action: 'paid-purchase' }) as SoulAccessPlan
const receipt = (p = plan(), digest = 'current'): SoulAccessRecord => ({ schema: 'soulidity.soul-access.v1', plan: p,
  packet: { bytes: `exact-${digest}`, digest, expirationEpoch: '1', phase: 'PREPARED', signature: null } })
function fixture() {
  const store = browserSoulAccessStore(), completed = new Set<string>(), oldResult = { status: 'MISSING' }, events: string[] = []
  const adapter = {
    prepare: vi.fn(async (p: SoulAccessPlan) => { events.push('prepare'); return receipt(p) }),
    query: vi.fn(async (r: SoulAccessRecord) => { events.push(`query:${r.packet.digest}`)
      return r.packet.digest === 'old' ? { ...oldResult } : { status: completed.has(r.packet.digest) ? 'SUCCEEDED' : 'MISSING' } }),
    preflight: vi.fn(async () => {}), sign: vi.fn(async (r: SoulAccessRecord) => ({ bytes: r.packet.bytes, signature: 'signature' })),
    verifySignature: vi.fn(async () => {}), broadcast: vi.fn(async (r: SoulAccessRecord) => { completed.add(r.packet.digest) }),
  }
  async function install(r: SoulAccessRecord) {
    const key = soulAccessKey(r.plan)
    await store.exclusive(key, async () => {
      store.write(key, { ...r, packet: { ...r.packet, phase: 'PREPARED', signature: null } })
      if (r.packet.phase === 'SIGNING' || r.packet.phase === 'SIGNED') store.write(key, { ...r, packet: { ...r.packet, phase: 'SIGNING', signature: null } })
      if (r.packet.phase !== 'PREPARED') store.write(key, r)
    })
  }
  const run = (p = plan(), options: any = {}) => runSoulAccess({ plan: p, store, adapter: adapter as any, startNew: true, ...options })
  return { store, adapter, oldResult, events, install, run }
}
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://access.example.test' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('navigator', dom.window.navigator)
  localStorage.clear()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(key)) return work(null)
      held.add(key); try { return await work({ name: key }) } finally { held.delete(key) }
    },
  } })
})
afterEach(() => { vi.restoreAllMocks(); dom.window.close(); vi.unstubAllGlobals() })

it.each(['callablePackageId', 'marketConfigId', 'kindRegistryId'])('a changed %s cannot bypass an unknown signed payment', async field => {
  const f = fixture(), p = plan(); (p.deployment as any)[field] = 'earlier'
  const old = receipt(p, 'old'); old.packet.phase = 'SIGNED'; old.packet.signature = 'signature'; await f.install(old)
  await expect(f.run()).rejects.toThrow('OTHER_DEPLOYMENT_RECOVERY_REQUIRED')
  expect(f.adapter.query).toHaveBeenCalledExactlyOnceWith(old); expect(f.adapter.prepare).not.toHaveBeenCalled()
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.store.read(soulAccessKey(plan()))).toBeNull()
})
it.each(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED'])('does not trust foreign %s phase without actual finality', async phase => {
  const f = fixture(), p = plan(); p.deployment.callablePackageId = 'earlier'
  const old = receipt(p, 'old'); old.packet.phase = phase as any; old.packet.signature = phase === 'SIGNED' ? 'signature' : null; await f.install(old)
  await expect(f.run()).rejects.toThrow(phase === 'SUCCEEDED' || phase === 'FAILED' ? 'OTHER_DEPLOYMENT_RESULT_UNCONFIRMED' : 'OTHER_DEPLOYMENT_RECOVERY_REQUIRED'); expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it.each(['SUCCEEDED', 'FAILED'])('proves old payment %s before preparing a different deployment', async status => {
  const f = fixture(), p = plan(); p.deployment.callablePackageId = 'earlier'
  await f.install(receipt(p, 'old')); f.oldResult.status = status
  expect((await f.run()).status).toBe('SUCCEEDED'); expect(f.events.slice(0, 2)).toEqual(['query:old', 'prepare'])
  expect(f.adapter.sign).toHaveBeenCalledOnce(); expect(f.store.read(soulAccessKey(p))?.packet.digest).toBe('old')
})
it.each(['MISSING', 'PENDING'])('cancelled foreign preparation permits only a MISSING result, observed=%s', async status => {
  const f = fixture(), p = plan(); p.deployment.callablePackageId = 'earlier'
  const old = receipt(p, 'old'); old.packet.phase = 'CANCELLED'; await f.install(old); f.oldResult.status = status
  if (status === 'MISSING') expect((await f.run()).status).toBe('SUCCEEDED')
  else { await expect(f.run()).rejects.toThrow('OTHER_DEPLOYMENT_RECOVERY_REQUIRED'); expect(f.adapter.prepare).not.toHaveBeenCalled() }
})
it('old query outage preserves all stored evidence and never prepares a payment', async () => {
  const f = fixture(), p = plan(); p.deployment.callablePackageId = 'earlier'; await f.install(receipt(p, 'old'))
  const before = localStorage.getItem(soulAccessKey(p)); f.adapter.query.mockRejectedValue(Error('ledger unavailable'))
  await expect(f.run()).rejects.toThrow('ledger unavailable')
  expect(localStorage.getItem(soulAccessKey(p))).toBe(before); expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it('all changed-deployment writers use the same actual operation lock across store instances', async () => {
  const f = fixture(), a = plan(), b = plan(); b.deployment.callablePackageId = 'other'
  let release!: () => void, entered!: () => void
  const begun = new Promise<void>(resolve => { entered = resolve })
  f.adapter.prepare.mockImplementation(async p => { entered(); await new Promise<void>(resolve => { release = resolve }); return receipt(p) })
  const first = f.run(a); await begun
  await expect(f.run(b, { store: browserSoulAccessStore() })).rejects.toThrow('BUSY')
  release(); expect((await first).status).toBe('SUCCEEDED'); expect(f.adapter.prepare).toHaveBeenCalledOnce()
})
it.each(['chainIdentifier', 'originalPackageId', 'author', 'soulId'])('keeps genuinely separate %s scopes independent', async field => {
  const f = fixture(), p = plan()
  if (field in p.deployment) (p.deployment as any)[field] = 'elsewhere'; else (p as any)[field] = 'elsewhere'
  await f.install(receipt(p, 'old')); expect((await f.run()).status).toBe('SUCCEEDED')
  expect(f.adapter.query.mock.calls.every(([r]) => r.packet.digest !== 'old')).toBe(true)
})
it('pre-sign cancel can recover one namespace even when another namespace is unresolved', async () => {
  const f = fixture(), p = plan(); p.deployment.callablePackageId = 'earlier'
  await f.install(receipt(p, 'old')); const current = receipt(); await f.install(current)
  const result = await f.run(plan(), { startNew: false, cancelUnsigned: true,
    expectedPacket: { bytes: current.packet.bytes, digest: current.packet.digest } })
  expect(result.record.packet.phase).toBe('CANCELLED'); expect(f.adapter.sign).not.toHaveBeenCalled()
  expect(f.adapter.query.mock.calls.every(([r]) => r.packet.digest !== 'old')).toBe(true)
})
it('lost response keeps the signed bytes and resumes them after a cold store recreation', async () => {
  const f = fixture(), broadcast = f.adapter.broadcast
  f.adapter.broadcast = vi.fn(async r => { await broadcast(r); throw Error('lost response') })
  await expect(f.run()).rejects.toThrow('lost response')
  const original = f.store.read(soulAccessKey(plan()))!; expect(original.packet.phase).toBe('SIGNED')
  const result = await f.run(plan(), { store: browserSoulAccessStore(), startNew: false, expectedPacket: original.packet })
  expect(result.status).toBe('SUCCEEDED'); expect(result.record.packet.bytes).toBe(original.packet.bytes)
  expect(f.adapter.sign).toHaveBeenCalledOnce(); expect(f.adapter.prepare).toHaveBeenCalledOnce(); expect(f.adapter.broadcast).toHaveBeenCalledOnce()
})
