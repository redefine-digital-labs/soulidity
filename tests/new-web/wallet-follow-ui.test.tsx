// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletFollowPersistenceError } from '@soulidity/sdk'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { FollowButton } from '../../web/components/community/follow-button'
import { ProfileStatsPill } from '../../web/components/profile-stats-pill'

const f = vi.hoisted(() => ({ grpc:{},wallet:{name:"wallet-a"},account:{address:"fixture"} as any,auth: {} as any, snapshot: {} as any, record: null as any,
  read: vi.fn(), run: vi.fn(), prepare: vi.fn(), sign: vi.fn(), lock: vi.fn(),
  deployment: { profile: { originalPackageId: `0x${'1'.repeat(64)}`, callablePackageId: `0x${'2'.repeat(64)}`,
    registryId: `0x${'3'.repeat(64)}`, chainIdentifier: '01010101' }, registryId: `0x${'4'.repeat(64)}` } }))
vi.mock('@soulidity/sdk', async importOriginal => ({ ...await importOriginal<any>(),
  readWalletFollowState: (...args: any[]) => f.read(...args), runWalletFollowOperation: (...args: any[]) => f.run(...args) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient:f.grpc,walletAccount:f.account,currentWallet:f.wallet,
  getWalletAddress: () => f.auth.walletAddress, signTransaction: f.sign }) }))
vi.mock('../../web/lib/social/social-config', () => ({ getBrowserSocialConfig: () => ({ deployment: f.deployment, writesEnabled: true }) }))
vi.mock('../../web/lib/social/follow-operation-client', () => ({
  browserWalletFollowOperationStore: () => ({ read: () => f.record, write: (_key: string, value: any) => { f.record = value }, exclusive: f.lock }),
  createWalletFollowOperationClient: () => ({ prepare: f.prepare, adapter: {} }),
}))
vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }))
const owner = `0x${'5'.repeat(64)}`, actorId = `0x${'6'.repeat(64)}`, targetId = `0x${'7'.repeat(64)}`, targetOwner = `0x${'8'.repeat(64)}`
let root: Root, host: HTMLDivElement, queryClient: QueryClient
function saved(phase = 'SIGNED') {
  return { schema: 'soulidity.wallet-follow-operation.v1', intent: { deployment: f.deployment, owner, actorId,
    targetId, targetOwner, expectedRevision: '2', following: true }, phase, bytes: 'saved exact bytes', digest: 'digest', signature: 'sig' }
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function render(target = targetId) {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><FollowButton targetMemberId={target} /></QueryClientProvider>))
  await flush(); await flush()
}
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find(node => node.textContent === label)
  if (!found) throw new Error(`Missing button ${label}: ${host.textContent}`)
  return found
}
async function click(label: string) { await act(async () => button(label).click()); await flush() }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.auth = { walletAddress: owner, loading: false, profileError: null }
  f.snapshot = { target: { id: targetId, owner: targetOwner }, viewer: { id: actorId, owner }, following: false,
    edgeRevision: '2', followerCount: '0', followingCount: '0' }
  f.record = null; f.read.mockReset().mockImplementation(async () => f.snapshot)
  f.prepare.mockReset().mockImplementation(async intent => ({ ...saved('PREPARED'), intent, signature: null }))
  f.run.mockReset().mockImplementation(async args => { f.record = { ...args.prepared, phase: 'SIGNED' }; return f.record })
  f.lock.mockReset().mockImplementation(async (_key, work) => work())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); queryClient.clear(); host.remove(); vi.unstubAllGlobals() })
it('uses canonical registered IDs and desired CAS, retaining pending UI instead of claiming Following', async () => {
  await render(); await click('+ Follow')
  expect(f.prepare.mock.calls[0][0]).toMatchObject(saved().intent)
  expect(f.lock).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('transaction is not yet confirmed')
  expect(button('+ Follow').disabled).toBe(true)
  expect(host.textContent).not.toContain('Following')
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.read.mock.calls[0][0]).toMatchObject({ targetProfileId: targetId, viewerAddress: owner })
})
it('cold query and explicit resume use stored intent without preparing a replacement', async () => {
  f.record = saved(); f.run.mockImplementation(async () => f.record)
  await render(); await click('Check result')
  expect(f.run.mock.calls[0][0]).toMatchObject({ intent: saved().intent, queryOnly: true, cancelUnsigned: false })
  await click('Resume same transaction')
  expect(f.run.mock.calls[1][0]).toMatchObject({ intent: saved().intent, queryOnly: false, cancelUnsigned: false })
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('Cancel unsigned transaction')
})
it('only a PREPARED record exposes unsigned cancel; failures retain record and export', async () => {
  f.record = saved('PREPARED'); f.run.mockRejectedValueOnce(new Error('storage unavailable'))
  await render(); await click('Cancel unsigned transaction')
  expect(f.run.mock.calls[0][0]).toMatchObject({ cancelUnsigned: true })
  expect(host.textContent).toContain('storage unavailable')
  expect(host.querySelector('[aria-label="Pending follow transaction"]')).not.toBeNull()
  expect(button('Export recovery record')).toBeTruthy()
})
it('exports the verified signature after persistence failure, retaining it after a query of the older disk record', async () => {
  f.record = { ...saved('SIGNING'), signature: null }
  f.run.mockRejectedValueOnce(new WalletFollowPersistenceError(saved('SIGNED'), new Error('quota')))
    .mockRejectedValueOnce(new WalletFollowPersistenceError({ ...saved('SIGNING'), signature: null } as any, new Error('quota again')))
    .mockImplementation(async () => f.record)
  const create = vi.fn(() => 'blob:follow-recovery')
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await render(); await click('Resume same transaction'); await click('Resume same transaction'); await click('Check result')
  await click('Export recovery record')
  const exported: Blob = create.mock.calls[0][0]
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(exported)
  })
  expect(JSON.parse(content)).toMatchObject({ phase: 'SIGNED', signature: 'sig', bytes: 'saved exact bytes' })
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
  // The first transaction later confirms, then this same wallet/target starts
  // a distinct unfollow. Export must now describe the new pending transaction.
  f.record = saved('SUCCEEDED'); f.snapshot = { ...f.snapshot, following: true, edgeRevision: '3' }
  await click('Check result'); await flush()
  f.prepare.mockImplementationOnce(async intent => ({ ...saved('PREPARED'), intent,
    digest: 'next-digest', bytes: 'next exact bytes', signature: null }))
  f.run.mockImplementationOnce(async args => { f.record = { ...args.prepared, phase: 'SIGNED', signature: 'next-sig' }; return f.record })
  await click('Following'); await click('Export recovery record')
  const nextContent = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(create.mock.calls[1][0])
  })
  expect(JSON.parse(nextContent)).toMatchObject({ digest: 'next-digest', bytes: 'next exact bytes', signature: 'next-sig',
    intent: { following: false } })
  anchorClick.mockRestore()
})
it('read errors are visible, block new writes, and allow an explicit read retry', async () => {
  f.read.mockRejectedValue(new Error('RPC unavailable')); await render()
  expect(button('Follow state unavailable').disabled).toBe(true)
  expect(host.textContent).toContain('RPC unavailable')
  await click('Retry follow read'); expect(f.read.mock.calls.length).toBeGreaterThan(1)
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
})
it('a profile read failure retries the actual auth source, allowing the follow action to unlock', async () => {
  f.auth.profileError = 'Profile RPC unavailable'
  f.auth.refresh = vi.fn().mockImplementation(async () => { f.auth.profileError = null })
  await render(); expect(button('+ Follow').disabled).toBe(true)
  await click('Retry profile read'); await render()
  expect(f.auth.refresh).toHaveBeenCalledOnce()
  expect(button('+ Follow').disabled).toBe(false)
  expect(host.textContent).not.toContain('Profile RPC unavailable')
  expect(f.prepare).not.toHaveBeenCalled()
})
it('a stale CAS preflight offers read-only refresh, then uses the refreshed revision', async () => {
  f.prepare.mockRejectedValueOnce(new Error('FOLLOW_CHANGED_RELOAD_REQUIRED'))
  await render(); await click('+ Follow')
  expect(host.textContent).toContain('FOLLOW_CHANGED_RELOAD_REQUIRED')
  expect(f.run).not.toHaveBeenCalled()
  f.snapshot = { ...f.snapshot, following: true, edgeRevision: '3' }
  await click('Reload follow state'); await flush()
  expect(f.prepare).toHaveBeenCalledOnce()
  await click('Following')
  expect(f.prepare.mock.calls[1][0]).toMatchObject({ following: false, expectedRevision: '3' })
})
it('an unregistered viewer gets the original profile creation route and cannot manufacture an actor', async () => {
  f.snapshot.viewer = null; await render()
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/profile')
  expect(button('+ Follow').disabled).toBe(true)
  expect(f.prepare).not.toHaveBeenCalled()
})
it('wallet switching ignores the prior pending outcome and does not invalidate the new wallet', async () => {
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('+ Follow')
  f.auth.walletAddress = targetOwner; f.record = null; await render()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => finish(saved('SUCCEEDED')))
  expect(invalidate).not.toHaveBeenCalled()
  expect(host.querySelector('[aria-label="Follow profile"]')).toBeNull()
})
it('confirmed chain result refreshes actual state, without patching an optimistic count', async () => {
  f.run.mockImplementation(async args => {
    f.snapshot = { ...f.snapshot, following: true, edgeRevision: '3', followerCount: '1' }
    f.record = { ...args.prepared, phase: 'SUCCEEDED' }; return f.record
  })
  await render(); await click('+ Follow'); await flush()
  expect(button('Following').disabled).toBe(false)
  expect(host.querySelector('[aria-label="Pending follow transaction"]')).toBeNull()
  expect(f.read.mock.calls.length).toBeGreaterThan(1)
})
it('renders lossless u64 and unavailable counts without converting them to zero', async () => {
  await act(async () => root.render(<ProfileStatsPill kind="human" level={1} souls={0} posts={0} exp={0}
    followers="18446744073709551615" following="—" achievements={0} isEmpty={false} isOwner={false} joinedAt="2026-09-10" />))
  expect(host.textContent).toContain('18446744073709551615'); expect(host.textContent).toContain('—Following')
})
