// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicCommunityAcceptPersistenceError, publicCommunityAcceptOperationKey } from '@soulidity/sdk'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useCommunityAccept } from '../../web/lib/hooks/use-community-accept'

const f = vi.hoisted(() => ({ grpc:{},wallet:{name:"wallet-a"},account:{address:"fixture"} as any,auth: {} as any, deployment: {} as any, records: new Map<string, any>(),
  run: vi.fn(), prepare: vi.fn(), sign: vi.fn(), lock: vi.fn(), writes: vi.fn(), readConfig: vi.fn(), clientParams: null as any }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(), runPublicCommunityAcceptOperation: (...args: any[]) => f.run(...args) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient:f.grpc,walletAccount:f.account,currentWallet:f.wallet, getWalletAddress: () => f.auth.walletAddress, signTransaction: f.sign }) }))
vi.mock('../../web/lib/community/accept-config', () => ({ getBrowserCommunityAcceptDeployment: () => f.readConfig(), getBrowserCommunityAcceptWritesEnabled: () => f.writes() }))
vi.mock('../../web/lib/community/accept-operation-client', () => ({
  browserPublicCommunityAcceptOperationStore: () => ({ read: (key: string) => f.records.get(key) ?? null,
    write: (key: string, value: any) => f.records.set(key, value), exclusive: f.lock }),
  createPublicCommunityAcceptOperationClient: (params: any) => { f.clientParams = params; return { prepare: f.prepare, adapter: {} } },
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const owner = id(8), authorId = id(7), postId = id(6), commentId = id(9)
let root: Root, host: HTMLDivElement, queryClient: QueryClient, operation: ReturnType<typeof useCommunityAccept>, post: any
function saved(phase = 'SIGNED') {
  return { schema: 'soulidity.community-accept-operation.v1', intent: { deployment: structuredClone(f.deployment), owner, authorId,
    postId, expectedRevision: '18446744073709551614', commentId }, phase, bytes: 'exact bytes', digest: 'digest', expirationEpoch: '10',
    signature: phase === 'PREPARED' || phase === 'SIGNING' ? null : 'signature' } as any
}
function put(record = saved()) { f.records.set(publicCommunityAcceptOperationKey(record.intent), record) }
function Harness({ target }: { target: string }) { operation = useCommunityAccept(target); return null }
async function render(target = postId) {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness target={target} /></QueryClientProvider>))
}
async function execute(work: () => Promise<unknown>) {
  let result: unknown, failure: unknown
  await act(async () => { try { result = await work() } catch (error) { failure = error } })
  return { result, failure }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.deployment = { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) }
  f.auth = { walletAddress: owner, loading: false, profileError: null }
  post = { id: postId, postType: 'question', author: { id: authorId, owner }, registryId: id(4), profileRegistryId: id(3), acceptanceRevision: '18446744073709551614' }
  f.records.clear(); f.writes.mockReset().mockReturnValue(true)
  f.readConfig.mockReset().mockImplementation(() => structuredClone(f.deployment))
  f.prepare.mockReset().mockImplementation(async intent => ({ ...saved('PREPARED'), intent }))
  f.lock.mockReset().mockImplementation(async (_key, work) => work())
  f.run.mockReset().mockImplementation(async args => args.store.exclusive(publicCommunityAcceptOperationKey(args.intent), async () => {
    const key = publicCommunityAcceptOperationKey(args.intent)
    const value = args.prepared ? { ...args.prepared, phase: 'SIGNED', signature: 'signature' } : args.store.read(key)
    args.store.write(key, value); return value
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => { await act(async () => root.unmount()); queryClient.clear(); host.remove(); vi.unstubAllGlobals() })
it('inspects without writes, then freezes answer/revision before waiting for a lock', async () => {
  await render(); expect(f.writes).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled()
  f.lock.mockImplementationOnce(async (_key, work) => { post.acceptanceRevision = '0'; post.author.id = id(99); return work() })
  expect((await execute(() => operation.accept(post, commentId))).failure).toBeUndefined()
  expect(f.prepare.mock.calls[0][0]).toMatchObject({ owner, authorId, postId, commentId, expectedRevision: '18446744073709551614' })
  expect(f.lock).toHaveBeenCalledTimes(1); expect(operation.record?.phase).toBe('SIGNED')
})
it('query/resume/cancel reuse durable intent despite profile failure and disabled writes', async () => {
  put(saved('PREPARED')); f.auth.profileError = 'offline'; f.writes.mockReturnValue(false); await render()
  await execute(() => operation.query()); await execute(() => operation.resume()); await execute(() => operation.cancel())
  expect(f.run.mock.calls.map(([args]) => [args.queryOnly, args.cancelUnsigned])).toEqual([[true, false], [false, false], [false, true]])
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled()
})
it.each(['notQuestion', 'notAuthor', 'wrongPost', 'wrongRegistry', 'wrongProfileRegistry', 'loading', 'profileError', 'pending'])('rejects new acceptance: %s', async kind => {
  if (kind === 'notQuestion') post.postType = 'log'
  if (kind === 'notAuthor') post.author.owner = id(99)
  if (kind === 'wrongPost') post.id = id(99)
  if (kind === 'wrongRegistry') post.registryId = id(99)
  if (kind === 'wrongProfileRegistry') post.profileRegistryId = id(99)
  if (kind === 'loading') f.auth.loading = true
  if (kind === 'profileError') f.auth.profileError = 'offline'
  if (kind === 'pending') put(saved('SIGNING'))
  await render(); expect((await execute(() => operation.accept(post, commentId))).failure).toBeInstanceOf(Error)
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
})
it('retains strongest signature even if the saved record remains SIGNING', async () => {
  put(saved('SIGNING'))
  f.run.mockRejectedValueOnce(new PublicCommunityAcceptPersistenceError(saved('SIGNED'), new Error('quota')))
    .mockRejectedValueOnce(new PublicCommunityAcceptPersistenceError(saved('SIGNING'), new Error('quota again')))
  await render(); await execute(() => operation.resume()); await execute(() => operation.resume()); await execute(() => operation.query())
  expect(JSON.parse(operation.recoveryExport!)).toMatchObject({ phase: 'SIGNED', signature: 'signature' })
  expect(operation.record?.phase).toBe('SIGNING')
})
it.each(['wallet', 'post', 'release', 'ABA'])('rejects stale callbacks/results after %s change', async change => {
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); const old = operation; let pending!: Promise<unknown>
  await act(async () => { pending = old.accept(post, commentId); await Promise.resolve() })
  const oldClient = f.clientParams
  if (change === 'wallet' || change === 'ABA') f.auth.walletAddress = id(99)
  if (change === 'release') f.deployment.profile.callablePackageId = id(99)
  await render(change === 'post' ? id(99) : postId)
  if (change === 'ABA') { f.auth.walletAddress = owner; await render() }
  expect(oldClient.getAddress()).toBeNull(); expect(oldClient.writesEnabled()).toBe(false)
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => { finish(saved('SUCCEEDED')); await pending })
  expect(operation.record).toBeNull(); expect(invalidate).not.toHaveBeenCalled()
  expect((await execute(() => old.resume())).failure).toMatchObject({ message: 'Acceptance context changed' })
})
it('revokes write authority on release drift without a rerender', async () => {
  await render(); const captured = f.clientParams
  expect(captured.writesEnabled()).toBe(true)
  f.deployment.profile.callablePackageId = id(99)
  expect(captured.getAddress()).toBeNull(); expect(captured.writesEnabled()).toBe(false)
})
it('invalidates only current detail after confirmed execution and blocks concurrent actions', async () => {
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); let pending!: Promise<unknown>
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  await act(async () => { pending = operation.accept(post, commentId); await Promise.resolve() })
  expect((await execute(() => operation.query())).failure).toMatchObject({ message: 'Acceptance operation is already running' })
  await act(async () => { finish(saved('SUCCEEDED')); await pending })
  const predicate = invalidate.mock.calls[0][0]?.predicate!
  const key = ['community-chain-post', { deployment: f.deployment }, postId, owner]
  expect(predicate({ queryKey: key } as any)).toBe(true)
  expect(predicate({ queryKey: [...key.slice(0, 3), id(99)] } as any)).toBe(false)
  expect(predicate({ queryKey: ['community-chain-post', { deployment: {} }, postId, owner] } as any)).toBe(false)
  expect(operation.busy).toBe(false)
})
it('shows configuration/storage inspection errors without preparing a transaction', async () => {
  f.readConfig.mockImplementation(() => { throw new Error('missing registry') }); await render()
  expect(operation.error).toBe('missing registry'); expect(f.prepare).not.toHaveBeenCalled()
})
