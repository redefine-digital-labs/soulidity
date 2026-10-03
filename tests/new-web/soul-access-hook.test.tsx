// @vitest-environment jsdom
// Real React lifecycle; domain parsing/bytes, RPC evidence and the journal FSM
// are controlled boundaries here and exercised for real in their own suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useSoulAccessMutations } from '../../web/lib/hooks/use-soul-access-mutations'

const h = vi.hoisted(() => ({
  account: null as any, wallet: null as any, client: null as any, config: null as any,
  market: '', coin: '', asset: null as any, proof: null as any, observation: 'STILL_APPLIED',
  records: [] as any[], history: [] as any[], adapter: null as any,
  snapshot: vi.fn(), read: vi.fn(), prepare: vi.fn(), readState: vi.fn(), sign: vi.fn(), signed: vi.fn(),
  run: vi.fn(), query: vi.fn(), success: vi.fn(), discover: vi.fn(), historyRead: vi.fn(), write: vi.fn(),
}))
vi.mock('@mysten/dapp-kit', () => ({
  useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: h.sign }),
}))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(),
  getRequiredSoulidityEnv: (name: string) => name.endsWith('PAYMENT_COIN_TYPE') ? h.coin : h.market,
  readSoulPublicSnapshotBySoulId: (...args: any[]) => h.snapshot(...args),
}))
vi.mock('../../web/lib/soulidity/browser-content-write-state', () => ({
  getBrowserContentWriteConfig: () => { if (!h.config) throw Error('config unavailable'); return h.config },
  readBrowserContentWriteState: (...args: any[]) => h.read(...args),
}))
vi.mock('../../web/lib/soulidity/soul-access-plan', () => ({
  parseSoulAccessDeployment: (input: any) => structuredClone(input),
  parseSoulAccessPlan: (input: any) => structuredClone(input),
  soulAccessKey: (plan: any) => `${plan.deployment.callablePackageId}:${plan.soulId}:${plan.author}`,
  observeSoulAccessPlan: () => ({ status: h.observation }),
}))
vi.mock('../../web/lib/soulidity/soul-access-operation', () => ({
  parseSoulAccessRecord: (input: any) => structuredClone(input),
  createSoulAccessAdapter: (params: any) => {
    h.adapter = params
    return { query: h.query, preflight: (record: any) => params.preflight(record.plan), sign: params.sign }
  },
}))
vi.mock('../../web/lib/soulidity/soul-access-state', () => ({
  prepareSoulAccessPlan: (...args: any[]) => h.prepare(...args), readSoulAccessState: (...args: any[]) => h.readState(...args),
}))
vi.mock('../../web/lib/soulidity/soul-access-store', () => ({
  SOUL_ACCESS_STORE_CHANGED: 'test-soul-access-change',
  browserSoulAccessStore: () => ({ discover: h.discover, history: h.historyRead, write: h.write }),
}))
vi.mock('../../web/lib/soulidity/soul-access-runner', () => ({ runSoulAccess: (...args: any[]) => h.run(...args) }))

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const grant = () => ({ action: 'grant-issue' as const, granteeAddress: id(5), scopeMask: 8 })
function plan(action = 'paid-purchase'): any {
  return {
    deployment: { chainIdentifier: '35834a8a', originalPackageId: id(10), callablePackageId: id(11),
      kindRegistryId: id(13), marketConfigId: id(12), paymentCoinType: 'USDC' },
    soulId: id(1), stateId: id(2), contentId: id(3), paidAccessListId: id(6), author: id(4),
    currentOwner: id(7), ownershipEpoch: '2', capturedAtMs: '10', action, kind: action.startsWith('grant-') ? null : 3,
    granteeAddress: id(4), expected: { frozen: 'raw-bcs' }, input: { renew: false, paymentCoins: [] },
    quote: { scopeMask: 8, priceAtomic: '1000000', feeAtomic: '25000', totalAtomic: '1025000', feeRecipient: id(8), durationMs: '100' },
  }
}
function record(p = plan()): any {
  return { schema: 'soulidity.soul-access.v1', plan: p,
    packet: { bytes: 'original exact bytes', digest: 'original-digest', expirationEpoch: '12', phase: 'PREPARED', signature: null } }
}
let root: Root, host: HTMLDivElement, soul: any, current: ReturnType<typeof useSoulAccessMutations>
function Probe() { current = useSoulAccessMutations(soul, h.success); return null }
const render = () => act(async () => { root.render(<Probe />) })
const invoke = (fn: () => Promise<unknown>) => act(async () => { await fn() })
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { resolve, promise } }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  h.account = { address: id(4) }; h.wallet = {}; h.client = { grpc: {} }; h.market = id(12); h.coin = 'USDC'
  h.config = { target: { soulidityOriginalPackageId: id(10), soulidityCallablePackageId: id(11) }, kindRegistryId: id(13) }
  soul = { originalPackageId: id(10), onChainId: id(1), stateOnChainId: id(2), contentOnChainId: id(3), paidAccessListOnChainId: id(6) }
  h.asset = { stateId: id(2), contentId: id(3) }; h.proof = { snapshot: { paidAccessListId: id(6) } }
  h.records = []; h.history = []; h.adapter = null; h.observation = 'STILL_APPLIED'
  h.snapshot.mockReset().mockImplementation(async () => structuredClone(h.asset))
  h.read.mockReset().mockImplementation(async () => structuredClone(h.proof))
  h.prepare.mockReset().mockImplementation(async ({ deployment, soulId, stateId, contentId, paidAccessListId, author, request }) => ({
    ...plan(request.action), deployment, soulId, stateId, contentId, paidAccessListId, author,
  }))
  h.readState.mockReset().mockResolvedValue({ observed: true })
  h.sign.mockReset().mockResolvedValue({ bytes: 'original exact bytes', signature: 'signature' })
  h.run.mockReset().mockImplementation(async ({ plan: p }) => ({ record: record(p), status: 'SUCCEEDED', checkpoint: '9' }))
  h.query.mockReset().mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '9' })
  h.discover.mockReset().mockImplementation(() => h.records); h.historyRead.mockReset().mockImplementation(() => h.history)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No owned HTTP API') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('prepares a read-only quote from captured raw roots without a journal, runner or signature', async () => {
  await render(); let quote: any
  await invoke(async () => { quote = await current.prepare({ action: 'paid-purchase', kind: 3, renew: true }) })
  expect(h.snapshot).toHaveBeenCalledOnce(); expect(h.read).toHaveBeenCalledOnce(); expect(h.prepare).toHaveBeenCalledOnce()
  expect(h.prepare.mock.calls[0][0]).toMatchObject({ soulId: id(1), stateId: id(2), contentId: id(3), paidAccessListId: id(6), author: id(4),
    request: { action: 'paid-purchase', kind: 3, renew: true } })
  expect(quote.quote.totalAtomic).toBe('1025000'); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  expect(h.write).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(current.pending).toBe(false)
})
it('executes the exact supplied quote without preparing a replacement price or payment', async () => {
  const quote = plan(); await render(); await invoke(() => current.execute(quote))
  expect(h.run).toHaveBeenCalledOnce(); expect(h.run.mock.calls[0][0]).toMatchObject({ plan: quote, startNew: true })
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled()
  expect(h.success).toHaveBeenCalledOnce(); expect(current.status).toContain('confirmed at checkpoint 9')
})
it('rejects purchase mutate synchronously so a caller cannot skip explicit quote confirmation', async () => {
  await render(); expect(() => current.mutate({ action: 'paid-purchase', kind: 3 })).toThrow('explicitly confirm')
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('normal grant mutation prepares raw state then explicitly starts one journaled attempt', async () => {
  await render(); await invoke(() => current.mutate(grant()))
  expect(h.prepare).toHaveBeenCalledOnce(); expect(h.run.mock.calls[0][0]).toMatchObject({ startNew: true, plan: { action: 'grant-issue' } })
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
it.each(['original', 'state', 'content', 'paid-root'])('rejects a %s pointer/deployment mismatch before domain preparation', async mode => {
  if (mode === 'original') soul.originalPackageId = id(30)
  if (mode === 'state') h.asset.stateId = id(30)
  if (mode === 'content') h.asset.contentId = id(30)
  if (mode === 'paid-root') h.proof.snapshot.paidAccessListId = id(30)
  await render(); await invoke(async () => { await expect(current.prepare(grant())).rejects.toThrow(/changed/) })
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(current.error).toMatch(/changed/)
})
it.each(['soul', 'state', 'author'])('rejects an explicit quote for another %s before calling the runner', async mode => {
  const quote = plan(); quote[mode === 'soul' ? 'soulId' : mode === 'state' ? 'stateId' : 'author'] = id(30)
  await render(); await invoke(async () => { await expect(current.execute(quote)).rejects.toThrow('quote scope changed') })
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('preflight attests native Soul/State/Content roots with the recorded author and kind', async () => {
  h.run.mockImplementation(async input => {
    await input.adapter.preflight(record(input.plan)); return { record: record(input.plan), status: 'SUCCEEDED', checkpoint: '9' }
  })
  await render(); await invoke(() => current.execute(plan()))
  expect(h.read).toHaveBeenCalledOnce(); expect(h.read.mock.calls[0][0]).toMatchObject({ soulId: id(1), stateId: id(2), contentId: id(3), viewerAddress: id(4), kind: 3 })
  expect(h.read.mock.calls[0][1].client()).toBe(h.client.grpc)
})
it.each(['callable', 'market', 'registry', 'coin', 'paid-root', 'native-proof'])('preflight rejects changed %s before wallet signing', async mode => {
  const quote = plan()
  if (mode === 'callable') quote.deployment.callablePackageId = id(30)
  if (mode === 'market') quote.deployment.marketConfigId = id(30)
  if (mode === 'registry') quote.deployment.kindRegistryId = id(30)
  if (mode === 'coin') quote.deployment.paymentCoinType = 'OTHER'
  if (mode === 'paid-root') h.proof.snapshot.paidAccessListId = id(30)
  if (mode === 'native-proof') h.read.mockRejectedValue(Error('native target attestation failed'))
  h.run.mockImplementation(async input => { await input.adapter.preflight(record(input.plan)); await input.adapter.sign({}); throw Error('unexpected sign') })
  await render(); await invoke(async () => { await expect(current.execute(quote)).rejects.toThrow() })
  expect(h.sign).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(current.error).not.toBeNull()
})
it('preflight treats canonical persisted deployment field order as the same target', async () => {
  const quote = plan(); quote.deployment = Object.fromEntries(Object.entries(quote.deployment).sort(([a], [b]) => a.localeCompare(b)))
  h.run.mockImplementation(async input => { await input.adapter.preflight(record(input.plan)); return { record: record(input.plan), status: 'SUCCEEDED', checkpoint: '9' } })
  await render(); await invoke(() => current.execute(quote)); expect(h.read).toHaveBeenCalledOnce(); expect(current.error).toBeNull()
})

const identities = ['wallet', 'account', 'client', 'away-and-back', 'deployment', 'soul'] as const
async function changeIdentity(mode: typeof identities[number]) {
  if (mode === 'wallet') h.wallet = {}
  else if (mode === 'account') h.account = { address: id(4) }
  else if (mode === 'client') h.client = { grpc: {} }
  else if (mode === 'deployment') h.market = id(30)
  else if (mode === 'soul') soul = { ...soul, onChainId: id(30) }
  else {
    const originalAccount = h.account, originalWallet = h.wallet
    h.account = { address: id(5) }; h.wallet = {}; await render()
    h.account = originalAccount; h.wallet = originalWallet
  }
  await render()
}
it.each(identities.flatMap(identity => ['snapshot', 'raw-proof', 'plan', 'quote', 'preflight', 'sign'].map(stage => ({ identity, stage }))))(
  'drops a pending $stage response after $identity changes, including away/back to the original objects', async ({ identity, stage }) => {
    const wait = deferred(); let pending!: Promise<unknown>, capturedSignal: AbortSignal | undefined
    if (stage === 'snapshot') h.snapshot.mockImplementationOnce(input => { capturedSignal = input.signal; return wait.promise })
    if (stage === 'raw-proof') h.read.mockImplementationOnce(input => { capturedSignal = input.signal; return wait.promise })
    if (stage === 'plan' || stage === 'quote') h.prepare.mockImplementationOnce(input => { capturedSignal = input.signal; return wait.promise })
    if (stage === 'preflight' || stage === 'sign') {
      if (stage === 'sign') h.sign.mockImplementationOnce(() => wait.promise)
      else h.read.mockImplementationOnce(input => { capturedSignal = input.signal; return wait.promise })
      h.run.mockImplementation(async input => {
        await input.adapter.preflight(record(input.plan))
        const signed = await input.adapter.sign({ frozen: 'transaction' }); h.signed(signed)
        return { record: record(input.plan), status: 'SUCCEEDED', checkpoint: '9' }
      })
    }
    await render(); const initialIdentity = current.identityKey
    await act(async () => {
      pending = (stage === 'sign' || stage === 'preflight' ? current.execute(plan()) : stage === 'quote'
        ? current.prepare({ action: 'paid-purchase', kind: 3 }) : current.mutate(grant())).catch(error => error)
    })
    expect(current.pending).toBe(true); await changeIdentity(identity)
    expect(current.identityKey).not.toBe(initialIdentity); if (capturedSignal) expect(capturedSignal.aborted).toBe(true)
    await act(async () => {
      wait.resolve(stage === 'snapshot' ? h.asset : stage === 'raw-proof' || stage === 'preflight' ? h.proof : stage === 'sign'
        ? { bytes: 'original exact bytes', signature: 'late signature' } : plan('grant-issue'))
      expect(await pending).toBeInstanceOf(Error)
    })
    if (stage !== 'sign') { if (stage !== 'preflight') expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled() }
    else { expect(h.sign).toHaveBeenCalledOnce(); expect(h.signed).not.toHaveBeenCalled() }
    expect(h.success).not.toHaveBeenCalled(); expect(current.error).toBeNull(); expect(current.status).toBeNull(); expect(current.pending).toBe(false)
  },
)
it.each(identities.flatMap(identity => ['historical-query', 'current-observation'].map(stage => ({ identity, stage }))))(
  'does not publish a pending $stage into the new $identity scope', async ({ identity, stage }) => {
    const wait = deferred(); let pending!: Promise<unknown>
    if (stage === 'historical-query') h.query.mockImplementationOnce(() => wait.promise)
    else h.readState.mockImplementationOnce(() => wait.promise)
    await render(); await act(async () => { pending = current.query(record()).catch(error => error) })
    await changeIdentity(identity)
    await act(async () => { wait.resolve(stage === 'historical-query' ? { status: 'SUCCEEDED', checkpoint: '9' } : { observed: true }); expect(await pending).toBeInstanceOf(Error) })
    expect(current.status).toBeNull(); expect(current.currentObservation).toBeNull(); expect(current.error).toBeNull()
    if (stage === 'historical-query') expect(h.success).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
  },
)
it('detects runtime configuration mutation during a pending read even before a rerender', async () => {
  const wait = deferred(); let pending!: Promise<unknown>
  h.snapshot.mockImplementationOnce(() => wait.promise); await render()
  await act(async () => { pending = current.prepare(grant()).catch(error => error) })
  h.config.target.soulidityCallablePackageId = id(30)
  await act(async () => { wait.resolve(h.asset); expect(await pending).toBeInstanceOf(Error) })
  expect(h.read).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
})
it('rejects same-tick concurrent actions while preparation owns the local operation', async () => {
  const wait = deferred(); let pending!: Promise<unknown>
  h.snapshot.mockImplementationOnce(() => wait.promise); await render()
  await act(async () => { pending = current.prepare(grant()) })
  await expect(current.execute(plan())).rejects.toThrow('Another access operation is pending')
  await act(async () => { wait.resolve(h.asset); await pending })
  expect(h.run).not.toHaveBeenCalled(); expect(current.pending).toBe(false)
})
it('freezes request fields before the first asynchronous public snapshot', async () => {
  const wait = deferred(); let pending!: Promise<unknown>; const request = grant()
  h.snapshot.mockImplementationOnce(() => wait.promise); await render()
  await act(async () => { pending = current.mutate(request) })
  request.granteeAddress = id(30); request.scopeMask = 1
  await act(async () => { wait.resolve(h.asset); await pending })
  expect(h.prepare.mock.calls[0][0].request).toEqual(grant())
})
it('mount, storage events and manual refresh only discover receipts, never execute them', async () => {
  h.account = null; h.wallet = null; h.config = null; h.records = [record()]; h.history = [record()]
  await render()
  expect(h.discover).toHaveBeenCalledWith({ soulId: id(1), originalPackageId: id(10) })
  expect(current.records).toHaveLength(1); expect(current.history).toHaveLength(1)
  await act(async () => { window.dispatchEvent(new Event('storage')); window.dispatchEvent(new Event('test-soul-access-change')) })
  await invoke(() => current.refresh())
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
})
it('historical query works disconnected and without current deployment configuration, with no journal writes', async () => {
  h.account = null; h.wallet = null; h.config = null; const original = record()
  await render(); await invoke(() => current.query(original))
  expect(h.query).toHaveBeenCalledWith(original); expect(h.readState.mock.calls[0][0]).toMatchObject(original.plan)
  expect(h.readState.mock.calls[0][0].deployment).toEqual(original.plan.deployment)
  expect(current.status).toContain('confirmed at checkpoint 9'); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  expect(h.read).not.toHaveBeenCalled(); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
})
it.each(['STILL_APPLIED', 'LATER_ACCESS_CHANGED', 'OWNER_EPOCH_CHANGED', 'UNAVAILABLE'])('keeps historical success separate from current %s observation', async observation => {
  h.observation = observation; if (observation === 'UNAVAILABLE') h.readState.mockRejectedValue(Error('current RPC unavailable'))
  await render(); await invoke(() => current.query(record()))
  expect(current.status).toContain('confirmed at checkpoint 9'); expect(current.currentObservation).toContain(observation)
  expect(current.error).toBeNull(); expect(h.success).toHaveBeenCalledOnce(); expect(h.write).not.toHaveBeenCalled()
})
it.each(['resume', 'cancel'] as const)('%s passes the selected exact packet and frozen plan without startNew', async action => {
  const original = record(); if (action === 'cancel') { h.account = null; h.wallet = null; h.config = null }
  await render(); await invoke(() => current[action](original))
  expect(h.run.mock.calls[0][0]).toMatchObject({ plan: original.plan, cancelUnsigned: action === 'cancel',
    expectedPacket: { bytes: original.packet.bytes, digest: original.packet.digest } })
  expect(h.run.mock.calls[0][0].startNew).toBeUndefined(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled()
})
it('rejects recovery for a different Soul before reaching the runner', async () => {
  const original = record(); original.plan.soulId = id(30)
  await render(); await invoke(async () => { await expect(current.resume(original)).rejects.toThrow('Recovery Soul changed') })
  expect(h.run).not.toHaveBeenCalled()
})
it.each(['FAILED', 'PENDING', 'MISSING'])('surfaces %s execution without claiming success or hiding recovery', async status => {
  h.run.mockImplementation(async ({ plan: p }) => ({ record: record(p), status }))
  await render(); await invoke(async () => { await expect(current.execute(plan())).rejects.toThrow('use its recovery controls') })
  expect(current.error).toContain('use its recovery controls'); expect(current.pending).toBe(false); expect(h.success).not.toHaveBeenCalled()
})
it('manual discovery failure is visible and preserves already discovered public receipts', async () => {
  h.records = [record()]; await render(); h.discover.mockImplementationOnce(() => { throw Error('storage unavailable') })
  await invoke(async () => { await expect(current.refresh()).rejects.toThrow('storage unavailable') })
  expect(current.error).toBe('storage unavailable'); expect(current.records).toHaveLength(1)
})
it('a failed historical lookup is visible and does not turn an unknown digest into a fresh mutation', async () => {
  h.query.mockRejectedValue(Error('original historical evidence unavailable'))
  await render(); await invoke(async () => { await expect(current.query(record())).rejects.toThrow('historical evidence unavailable') })
  expect(current.error).toContain('historical evidence unavailable'); expect(current.status).toBeNull()
  expect(h.run).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
})
