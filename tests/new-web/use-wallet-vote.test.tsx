// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicCommunityVotePersistenceError, publicCommunityVoteOperationKey } from '@soulidity/sdk'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useWalletVoteOperation, useWalletVoteStatus } from '../../web/lib/hooks/use-wallet-vote'

const f = vi.hoisted(() => ({ grpc:{},wallet:{name:"wallet-a"},account:{address:"fixture"} as any,auth: {} as any, snapshot: {} as any, deployment: {} as any, records: new Map<string, any>(),
  read: vi.fn(), run: vi.fn(), prepare: vi.fn(), sign: vi.fn(), lock: vi.fn(), writeConfig: vi.fn(), readConfig: vi.fn(),
  createClient: vi.fn(), writesEnabled: false, clientParams: null as any }))
vi.mock('@soulidity/sdk', async importOriginal => ({ ...await importOriginal<any>(),
  readPublicCommunityVotes: (...args: any[]) => f.read(...args), runPublicCommunityVoteOperation: (...args: any[]) => f.run(...args) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient:f.grpc,walletAccount:f.account,currentWallet:f.wallet,
  getWalletAddress: () => f.auth.walletAddress, signTransaction: f.sign }) }))
vi.mock('../../web/lib/community/vote-config', () => ({
  getBrowserVoteReadConfig: () => f.readConfig(), getBrowserVoteConfig: () => f.writeConfig(),
}))
vi.mock('../../web/lib/community/vote-operation-client', () => ({
  browserPublicCommunityVoteOperationStore: () => ({ read: (key: string) => f.records.get(key) ?? null,
    write: (key: string, value: any) => f.records.set(key, value), exclusive: f.lock }),
  createPublicCommunityVoteOperationClient: (...args: any[]) => f.createClient(...args),
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const owner = id(8), actorId = id(7), postId = id(6)
let root: Root, host: HTMLDivElement, queryClient: QueryClient
let operation: ReturnType<typeof useWalletVoteOperation>, status: ReturnType<typeof useWalletVoteStatus>
function saved(phase = 'SIGNED', desired: 0 | 1 | 2 = 1) {
  return { schema: 'soulidity.community-vote-operation.v1', intent: { deployment: structuredClone(f.deployment), owner, actorId,
    postId, expectedRevision: '2', desired }, phase, bytes: 'exact bytes', digest: 'digest', expirationEpoch: '10',
    signature: phase === 'PREPARED' || phase === 'SIGNING' ? null : 'signature' } as any
}
function put(record = saved()) { f.records.set(publicCommunityVoteOperationKey(record.intent), record) }
function Harness({ target, readTarget }: { target: string; readTarget: string | null }) {
  operation = useWalletVoteOperation(target); status = useWalletVoteStatus(readTarget)
  return null
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function render(target = postId, readTarget: string | null = target) {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness target={target} readTarget={readTarget} /></QueryClientProvider>))
  await flush(); await flush()
}
async function execute(work: () => Promise<unknown>) {
  let result: unknown, failure: unknown
  await act(async () => { try { result = await work() } catch (error) { failure = error } }); await flush()
  return { result, failure }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.deployment = { community: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) }, registryId: id(20) }
  f.auth = { walletAddress: owner, loading: false, profileError: null }
  f.snapshot = { viewer: { id: actorId, owner }, viewerAddress: owner, post: { id: postId, registryId: id(4), profileRegistryId: id(3) },
    state: 0, revision: '2', upCount: '18446744073709551615', downCount: '0', score: '18446744073709551615' }
  f.records.clear(); f.writesEnabled = true
  f.readConfig.mockReset().mockImplementation(() => ({ deployment: structuredClone(f.deployment) }))
  f.writeConfig.mockReset().mockImplementation(() => ({ deployment: structuredClone(f.deployment), writesEnabled: f.writesEnabled }))
  f.read.mockReset().mockImplementation(async () => structuredClone(f.snapshot))
  f.createClient.mockReset().mockImplementation(params => { f.clientParams = params; return { prepare: f.prepare, adapter: {} } })
  f.prepare.mockReset().mockImplementation(async intent => ({ ...saved('PREPARED'), intent }))
  f.lock.mockReset().mockImplementation(async (_key, work) => work())
  f.run.mockReset().mockImplementation(async args => args.store.exclusive(publicCommunityVoteOperationKey(args.intent), async () => {
    const value = args.prepared ? { ...args.prepared, phase: 'SIGNED', signature: 'signature' } : args.store.read(publicCommunityVoteOperationKey(args.intent))
    args.store.write(publicCommunityVoteOperationKey(args.intent), value); return value
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); queryClient.clear(); host.remove(); vi.unstubAllGlobals() })
it('reads exact votes with lossless counts while writes are disabled and never asks for storage/Walrus config', async () => {
  f.writesEnabled = false; await render()
  expect(status.data?.score).toBe('18446744073709551615')
  expect(f.read.mock.calls[0][0]).toMatchObject({ postId, viewerAddress: owner, deployment: f.deployment })
  expect(f.writeConfig).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
})
it('null target does not read and errors are visible without a fabricated zero', async () => {
  await render(postId, null); expect(f.read).not.toHaveBeenCalled()
  f.read.mockRejectedValue(new Error('RPC unavailable')); await render()
  expect(status.error?.message).toBe('RPC unavailable'); expect(status.data).toBeUndefined()
  expect(f.prepare).not.toHaveBeenCalled()
})
it.each([0, 1, 2] as const)('freezes desired %s and revision under one WebLock without optimistic counts', async desired => {
  await render(); const { failure } = await execute(() => operation.setVote(f.snapshot, desired))
  expect(failure).toBeUndefined()
  expect(f.prepare.mock.calls[0][0]).toMatchObject({ owner, actorId, postId, expectedRevision: '2', desired, deployment: f.deployment })
  expect(f.lock).toHaveBeenCalledTimes(1)
  expect(operation.record?.phase).toBe('SIGNED'); expect(status.data?.state).toBe(0)
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.clientParams.getAddress()).toBe(owner); expect(f.clientParams.sign).toEqual(expect.any(Function))
})
it('queries/resumes/cancels durable intent without requiring a fresh profile or preparing replacement', async () => {
  put(saved('PREPARED')); f.auth.profileError = 'offline'; await render()
  await execute(() => operation.query()); await execute(() => operation.resume()); await execute(() => operation.cancel())
  expect(f.run.mock.calls.map(([args]) => [args.queryOnly, args.cancelUnsigned])).toEqual([[true, false], [false, false], [false, true]])
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.writeConfig).not.toHaveBeenCalled()
})
it.each(['unregistered', 'wrongOwner', 'wrongWallet', 'wrongPost', 'wrongRegistry', 'loading', 'profileError', 'pending'])('blocks new intent for %s', async variant => {
  if (variant === 'unregistered') f.snapshot.viewer = null
  if (variant === 'wrongOwner') f.snapshot.viewer.owner = id(99)
  if (variant === 'wrongWallet') f.snapshot.viewerAddress = id(99)
  if (variant === 'wrongPost') f.snapshot.post.id = id(99)
  if (variant === 'wrongRegistry') f.snapshot.post.registryId = id(99)
  if (variant === 'loading') f.auth.loading = true
  if (variant === 'profileError') f.auth.profileError = 'offline'
  if (variant === 'pending') put(saved('SIGNING'))
  await render(); expect((await execute(() => operation.setVote(f.snapshot, 1))).failure).toBeInstanceOf(Error)
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
})
it('retains strongest verified signature through persistence failure and older saved queries', async () => {
  put(saved('SIGNING'))
  f.run.mockRejectedValueOnce(new PublicCommunityVotePersistenceError(saved('SIGNED'), new Error('quota')))
    .mockRejectedValueOnce(new PublicCommunityVotePersistenceError(saved('SIGNING'), new Error('quota again')))
  await render(); await execute(() => operation.resume()); await execute(() => operation.resume()); await execute(() => operation.query())
  expect(JSON.parse(operation.recoveryExport!)).toMatchObject({ phase: 'SIGNED', signature: 'signature' })
  expect(operation.record?.phase).toBe('SIGNING'); expect(f.prepare).not.toHaveBeenCalled()
})
it('retains an unpersisted signature when a feed card unmounts and remounts in the same app session', async () => {
  put(saved('SIGNING'))
  f.run.mockRejectedValueOnce(new PublicCommunityVotePersistenceError(saved('SIGNED'), new Error('quota')))
  await render(); await execute(() => operation.resume())
  await act(async () => root.unmount()); root = createRoot(host)
  await render()
  expect(JSON.parse(operation.recoveryExport!)).toMatchObject({ phase: 'SIGNED', signature: 'signature' })
  expect(operation.record?.phase).toBe('SIGNING')
  f.auth.walletAddress = id(99); await render(); expect(operation.recoveryExport).toBeNull()
})
it('still exports the scoped emergency signature after remount when durable storage is unreadable', async () => {
  put(saved('SIGNING'))
  f.run.mockRejectedValueOnce(new PublicCommunityVotePersistenceError(saved('SIGNED'), new Error('quota')))
  await render(); await execute(() => operation.resume())
  await act(async () => root.unmount()); root = createRoot(host)
  const unreadable = vi.spyOn(f.records, 'get').mockImplementation(() => { throw new Error('storage blocked') })
  try {
    await render(); expect(operation.error).toBe('storage blocked')
    expect(JSON.parse(operation.recoveryExport!)).toMatchObject({ phase: 'SIGNED', signature: 'signature' })
    f.auth.walletAddress = id(99); await render(); expect(operation.recoveryExport).toBeNull()
  } finally { unreadable.mockRestore() }
})
it.each(['wallet', 'post', 'release', 'ABA'] as const)('isolates late results, cache invalidation, and stale callbacks after %s change', async change => {
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); const old = operation; let running!: Promise<unknown>
  await act(async () => { running = old.setVote(f.snapshot, 1); await Promise.resolve() })
  if (change === 'wallet' || change === 'ABA') f.auth.walletAddress = id(99)
  if (change === 'release') f.deployment.community.profile.callablePackageId = id(99)
  await render(change === 'post' ? id(99) : postId)
  if (change === 'ABA') { f.auth.walletAddress = owner; await render() }
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => { finish(saved('SUCCEEDED')); await running })
  expect(operation.record).toBeNull(); expect(operation.recoveryExport).toBeNull(); expect(invalidate).not.toHaveBeenCalled()
  expect((await execute(() => old.resume())).failure).toMatchObject({ message: 'Vote context changed' })
})
it('retains a late failed-persistence signature privately for its old scope when switching back', async () => {
  let fail!: (error: unknown) => void
  put(saved('SIGNING')); f.run.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await render(); let running!: Promise<unknown>
  await act(async () => { running = operation.resume().catch(error => error); await Promise.resolve() })
  f.auth.walletAddress = id(99); await render()
  await act(async () => { fail(new PublicCommunityVotePersistenceError(saved('SIGNED'), new Error('quota'))); await running })
  expect(operation.recoveryExport).toBeNull()
  f.auth.walletAddress = owner; await render()
  expect(JSON.parse(operation.recoveryExport!)).toMatchObject({ phase: 'SIGNED', signature: 'signature' })
})
it('release changes invalidate write authority even before a rerender', async () => {
  await render(); const callback = f.clientParams.writesEnabled
  expect(callback()).toBe(true)
  f.deployment.community.profile.callablePackageId = id(99)
  expect(callback).toThrow('Vote release changed')
})
it('revokes the captured signing address when the Post changes during preparation', async () => {
  let finish!: () => void
  await render(); const captured = f.clientParams
  f.prepare.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { finish = resolve })
    if (captured.getAddress() !== owner) throw new Error('stale preparing wallet')
    f.sign(); return saved('PREPARED')
  })
  let pending!: Promise<unknown>
  await act(async () => { pending = operation.setVote(f.snapshot, 1).catch(error => error); await Promise.resolve() })
  await render(id(99)); expect(captured.getAddress()).toBeNull()
  await act(async () => { finish(); expect(await pending).toMatchObject({ message: 'stale preparing wallet' }) })
  expect(f.sign).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
})
it('refreshes only the exact query after a confirmed result and prevents concurrent local runs', async () => {
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); let running!: Promise<unknown>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => { running = operation.setVote(f.snapshot, 1); await Promise.resolve() })
  expect((await execute(() => operation.query())).failure).toMatchObject({ message: 'Vote operation is already running' })
  await act(async () => { finish(saved('SUCCEEDED')); await running })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vote-status', f.deployment, postId, owner] })
  expect(operation.busy).toBe(false)
})
it.each(['account','wallet','client'])('revokes direct old signers on same-owner %s replacement',async change=>{
  await render();const old=f.clientParams
  if(change==='account')f.account={...f.account}
  if(change==='wallet')f.wallet={name:'replacement'}
  if(change==='client')f.grpc={}
  await render()
  expect(old.getAddress()).toBeNull();expect(()=>old.sign({})).toThrow('Vote context changed')
  expect(f.sign).not.toHaveBeenCalled()
  const transaction={current:true};f.sign.mockResolvedValueOnce({signature:'current-signature'})
  await expect(f.clientParams.sign(transaction)).resolves.toEqual({signature:'current-signature'})
  expect(f.sign).toHaveBeenCalledWith(transaction)
})
