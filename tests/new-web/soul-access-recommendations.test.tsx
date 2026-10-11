// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { AgentGrantRecommendations } from '../../web/components/souls/agent-grant-recommendations'

const h = vi.hoisted(() => ({ account: null as any, wallet: null as any, client: null as any, user: null as any,
  config: null as any, body: null as any, proof: null as any,
  headers: vi.fn(), fetch: vi.fn(), read: vi.fn(), issue: vi.fn(), invalidate: vi.fn(), authorized: vi.fn(),
}))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }), useSuiClient: () => h.client }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ getAuthHeaders: h.headers, user: h.user }) }))
vi.mock('../../web/lib/hooks/use-grant', () => ({ useGrant: () => ({ issueGrant: h.issue }) }))
vi.mock('../../web/lib/soulidity/browser-content-write-state', () => ({
  getBrowserContentWriteConfig: () => { if (!h.config) throw Error('native config unavailable'); return h.config },
  readBrowserContentWriteState: (...args: any[]) => h.read(...args),
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const target = (n = 5) => ({ memberId: `member-${n}`, address: id(n), displayName: `Agent ${n}` })
const response = (body = structuredClone(h.body), ok = true, status = 200) => ({ ok, status, json: vi.fn().mockResolvedValue(body) })
const row = (n = 5, scope = '8', currentEpoch = true, unexpiredAtObservation = true) => ({ slot: { grantee: id(n), scope_mask: scope }, currentEpoch, unexpiredAtObservation })
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { resolve, promise } }
let host: HTMLDivElement, root: Root, props: any
const render = () => act(async () => { root.render(<AgentGrantRecommendations {...props} />) })
const button = () => host.querySelector('button')!
const click = () => act(async () => { button().click() })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  h.account = { address: id(4) }; h.wallet = {}; h.client = { grpc: {} }; h.user = { id: 'current-user' }
  h.config = { target: { originalPackageId: id(10), callablePackageId: id(11) } }
  h.body = { targets: [target()] }; h.proof = { snapshot: { currentOwner: id(4), grants: [] } }
  h.headers.mockReset().mockResolvedValue({ Authorization: 'private account session' })
  h.fetch.mockReset().mockImplementation(async () => response())
  h.read.mockReset().mockImplementation(async () => structuredClone(h.proof))
  h.issue.mockReset().mockResolvedValue(undefined)
  props = { soul: { onChainId: id(1), stateOnChainId: id(2), contentOnChainId: id(3), activeGrants: [] },
    role: 'owner', kindScopeMask: 8, kindLabel: 'assets', pendingAction: null, onAuthorized: h.authorized }
  vi.stubGlobal('fetch', h.fetch)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses private results as address suggestions only and attests current native scopes before display', async () => {
  h.body = { targets: [{ ...target(), desiredScopeMask: 15, isNewGrantee: false }], currentCapacity: 0, activeGrantCount: 99999 }
  await render()
  expect(h.fetch).toHaveBeenCalledWith(`/api/souls/${id(1)}/auto-grant-targets?scopeMask=8`, expect.objectContaining({
    cache: 'no-store', headers: { Authorization: 'private account session' }, signal: expect.any(AbortSignal),
  }))
  expect(h.read.mock.calls[0][0]).toMatchObject({ config: h.config, soulId: id(1), stateId: id(2), contentId: id(3), viewerAddress: id(4) })
  expect(h.read.mock.calls[0][1].client()).toBe(h.client.grpc)
  expect(host.textContent).toContain('Agent 5'); await click()
  expect(h.issue).toHaveBeenCalledWith(id(5), null, 8)
})
it.each([1, 2, 4, 8])('includes exact scopeMask=%i in private discovery and explicit issue', async mask => {
  props.kindScopeMask = mask; await render(); await click()
  expect(h.fetch.mock.calls[0][0]).toContain(`?scopeMask=${mask}`); expect(h.issue).toHaveBeenCalledWith(id(5), null, mask)
})
it.each(['covered', 'superset', 'expired', 'old-epoch', 'different-scope'])('filters only a current live covered scope: %s', async mode => {
  h.proof.snapshot.grants = [row(5, mode === 'superset' ? '15' : mode === 'different-scope' ? '1' : '8', mode !== 'old-epoch', mode !== 'expired')]
  await render()
  expect(host.textContent?.includes('Agent 5')).toBe(!['covered', 'superset'].includes(mode)); expect(h.issue).not.toHaveBeenCalled()
})
it('ignores stale public page grant hints when current raw proof says the scope is missing', async () => {
  props.soul.activeGrants = [{ granteeAddress: id(5), scopeMask: 15 }]
  await render(); expect(host.textContent).toContain('Agent 5')
})
it.each(['address', 'member', 'name', 'duplicate', 'missing-targets', 'oversize'])('surfaces malformed %s suggestions without reaching signing', async mode => {
  if (mode === 'address') h.body.targets[0].address = '0x1234'
  if (mode === 'member') h.body.targets[0].memberId = 3
  if (mode === 'name') h.body.targets[0].displayName = { name: 'not a name' }
  if (mode === 'duplicate') h.body.targets.push(target())
  if (mode === 'missing-targets') h.body = {}
  if (mode === 'oversize') h.body.targets = Array.from({ length: 10001 }, () => target())
  await render(); expect(host.textContent).toMatch(/Invalid private agent|Duplicate private agent/)
  expect(h.read).not.toHaveBeenCalled(); expect(h.issue).not.toHaveBeenCalled(); expect(host.querySelector('button')).toBeNull()
})
it.each([404, 403, 500])('keeps private discovery HTTP %i visible instead of claiming no agents', async status => {
  h.fetch.mockResolvedValue(response({ error: `discovery HTTP ${status}` }, false, status))
  await render(); expect(host.textContent).toContain(`discovery HTTP ${status}`); expect(h.read).not.toHaveBeenCalled(); expect(h.issue).not.toHaveBeenCalled()
})
it.each(['headers', 'fetch', 'json', 'raw', 'owner', 'disconnected'])('surfaces %s failure and keeps recommendations fail-closed', async mode => {
  if (mode === 'headers') h.headers.mockRejectedValue(Error('headers unavailable'))
  if (mode === 'fetch') h.fetch.mockRejectedValue(Error('fetch unavailable'))
  if (mode === 'json') h.fetch.mockResolvedValue({ ok: true, json: () => Promise.reject(Error('json unavailable')) })
  if (mode === 'raw') h.read.mockRejectedValue(Error('raw proof unavailable'))
  if (mode === 'owner') h.proof.snapshot.currentOwner = id(30)
  if (mode === 'disconnected') h.account = null
  await render(); expect(host.textContent).toMatch(/unavailable|current owner|Connect the owner wallet/)
  expect(host.querySelector('button')).toBeNull(); expect(h.issue).not.toHaveBeenCalled()
})
it('successful authorization invalidates detail and current raw scope prevents stale private suggestions from reappearing', async () => {
  h.issue.mockImplementation(async () => { h.proof.snapshot.grants = [row()] })
  await render(); await click()
  expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['soul'] }); expect(h.authorized).toHaveBeenCalledOnce()
  expect(h.fetch).toHaveBeenCalledTimes(2); expect(h.read).toHaveBeenCalledTimes(2)
  expect(host.textContent).not.toContain('Agent 5'); expect(h.issue).toHaveBeenCalledOnce()
})
it('same-tick authorize clicks share one explicit pending operation', async () => {
  const wait = deferred(); h.issue.mockImplementationOnce(() => wait.promise); await render()
  await act(async () => { const control = button(); control.click(); control.click() })
  expect(h.issue).toHaveBeenCalledOnce(); expect(button().disabled).toBe(true)
  await act(async () => { wait.resolve(undefined) })
})
it('shows authorization failure without discarding the suggested address', async () => {
  h.issue.mockRejectedValue(Error('exact grant transaction is pending'))
  await render(); await click(); expect(host.textContent).toContain('exact grant transaction is pending'); expect(host.textContent).toContain('Agent 5')
  expect(h.invalidate).not.toHaveBeenCalled(); expect(h.authorized).not.toHaveBeenCalled()
})
it('refreshes on the append-to-idle edge and never automatically authorizes', async () => {
  await render(); const calls = h.fetch.mock.calls.length
  props.pendingAction = 'append'; await render(); expect(h.fetch).toHaveBeenCalledTimes(calls)
  props.pendingAction = null; await render(); expect(h.fetch).toHaveBeenCalledTimes(calls + 1); expect(h.issue).not.toHaveBeenCalled()
})
it.each(['visitor', 'grantee'])('does not fetch private account suggestions for the %s role', async role => {
  props.role = role; await render(); expect(host.textContent).toBe(''); expect(h.headers).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled()
})
const identities = ['wallet', 'account', 'client', 'user', 'soul', 'away-and-back', 'configuration'] as const
async function changeIdentity(mode: typeof identities[number]) {
  if (mode === 'wallet') h.wallet = {}
  else if (mode === 'account') h.account = { address: id(4) }
  else if (mode === 'client') h.client = { grpc: {} }
  else if (mode === 'user') h.user = { id: 'another-user' }
  else if (mode === 'soul') props.soul = { ...props.soul, onChainId: id(30) }
  else if (mode === 'configuration') h.config = { target: { originalPackageId: id(10), callablePackageId: id(30) } }
  else {
    const originalAccount = h.account, originalWallet = h.wallet, originalUser = h.user
    h.account = { address: id(4) }; h.wallet = {}; h.user = { id: 'away-user' }; await render()
    h.account = originalAccount; h.wallet = originalWallet; h.user = originalUser
  }
  await render()
}
it.each(identities.flatMap(identity => ['headers', 'fetch', 'json', 'raw', 'issue'].map(stage => ({ identity, stage }))))(
  'drops old $stage completion after $identity changes without replacing current suggestions', async ({ identity, stage }) => {
    const wait = deferred(), oldBody = { targets: [target(5)] }; let oldSignal: AbortSignal | undefined
    if (stage === 'headers') h.headers.mockImplementationOnce(() => wait.promise)
    if (stage === 'fetch') h.fetch.mockImplementationOnce((_url, input) => { oldSignal = input.signal; return wait.promise })
    if (stage === 'json') h.fetch.mockImplementationOnce((_url, input) => { oldSignal = input.signal; return { ok: true, json: () => wait.promise } })
    if (stage === 'raw') h.read.mockImplementationOnce(input => { oldSignal = input.signal; return wait.promise })
    if (stage === 'issue') h.issue.mockImplementationOnce(() => wait.promise)
    await render(); if (stage === 'issue') await click()
    h.body = { targets: [target(6)] }; await changeIdentity(identity)
    expect(host.textContent).toContain('Agent 6'); if (oldSignal) expect(oldSignal.aborted).toBe(true)
    await act(async () => { wait.resolve(stage === 'headers' ? { Authorization: 'old account' } : stage === 'fetch'
      ? response(oldBody) : stage === 'json' ? oldBody : stage === 'raw' ? h.proof : undefined) })
    expect(host.textContent).toContain('Agent 6'); expect(host.textContent).not.toContain('Agent 5')
    expect(h.invalidate).not.toHaveBeenCalled(); expect(h.authorized).not.toHaveBeenCalled()
    if (stage !== 'issue') expect(h.issue).not.toHaveBeenCalled()
  },
)
