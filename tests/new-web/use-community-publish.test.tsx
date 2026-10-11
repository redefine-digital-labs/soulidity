// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPublicCommunityPublishIntent, PublicCommunityPublishPersistenceError, publicCommunityPublishOperationKey } from '@soulidity/sdk'
import { CommunityJournalPersistenceError, communityPublishLane } from '../../web/lib/community/publish-journal'
import { useCommunityPublish, type CommunityPublishTarget } from '../../web/lib/hooks/use-community-publish'

const f = vi.hoisted(() => ({ auth: {} as any, config: {} as any, writes: true, parents: new Map<string, any>(), operations: new Map<string, any>(),
  run: vi.fn(), inspect: vi.fn(), sign: vi.fn(), approve: vi.fn(), uuid: vi.fn(), params: null as any, writeFlag: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/components/upload/upload-cost-review', () => ({ useUploadCostReview: () => ({ requestUploadCostApproval: f.approve }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient: {}, getWalletAddress: () => f.auth.walletAddress, signTransaction: f.sign }) }))
vi.mock('../../web/lib/community/publish-config', () => ({ getBrowserCommunityPublishReadConfig: () => structuredClone(f.config),
  getBrowserCommunityPublishWritesEnabled: () => f.writeFlag() }))
vi.mock('../../web/lib/community/publish-browser-controller', () => ({ createBrowserCommunityPublishController: (params: any) => {
  f.params = params; return { inspect: f.inspect, run: f.run }
} }))
vi.mock('../../web/lib/community/publish-operation-client', () => ({ browserPublicCommunityPublishOperationStore: () => ({
  read: (key: string) => f.operations.get(key) ?? null,
}) }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const owner = id(8), authorId = id(7), postId = id(9)
let root: Root, host: HTMLDivElement, hook: ReturnType<typeof useCommunityPublish>
function Harness({ target }: { target: CommunityPublishTarget }) { hook = useCommunityPublish(target); return null }
async function render(target: CommunityPublishTarget = { kind: 'post' }) {
  await act(async () => { root.render(<Harness target={target} />); await Promise.resolve() })
}
async function execute(work: () => Promise<unknown>) {
  let result: any, failure: any
  await act(async () => { try { result = await work() } catch (error) { failure = error } })
  return { result, failure }
}
function journal(target: CommunityPublishTarget = { kind: 'post' }) {
  return { schema: 'soulidity.community-publish-journal.v1' as const, receipt: null, intent: createPublicCommunityPublishIntent({
    deployment: f.config.deployment, owner, authorId, operationId: 'a'.repeat(32),
    ...(target.kind === 'post' ? { kind: 'post' as const, postType: 1, channel: 1, document: { schema: 'soulidity.public-post.v1' as const, title: 'Frozen', content: 'Body', tags: [] } }
      : { ...target, document: { schema: 'soulidity.public-comment.v1' as const, content: 'Frozen reply' } }),
  } as any) }
}
function put(value = journal()) { f.parents.set(communityPublishLane(value.intent), value); return value }
function operation(parent = journal(), phase = 'SIGNED') {
  return { schema: 'soulidity.community-publish-operation.v1', intent: parent.intent, receipt: parent.receipt, phase,
    bytes: 'saved bytes', digest: 'digest', expirationEpoch: '10', signature: phase === 'SIGNED' ? 'signature' : null } as any
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.auth = { walletAddress: owner, profile: { id: authorId, owner }, loading: false, profileError: null }
  f.config = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '4c78adac' }, registryId: id(4) } }
  f.parents.clear(); f.operations.clear(); f.writes = true
  f.writeFlag.mockReset().mockImplementation(() => f.writes)
  f.uuid.mockReset().mockReturnValue('11111111-1111-1111-1111-111111111111'); vi.stubGlobal('crypto', { randomUUID: f.uuid })
  f.approve.mockReset().mockResolvedValue(true)
  f.inspect.mockReset().mockImplementation(async intent => f.parents.get(communityPublishLane(intent)) ?? null)
  f.run.mockReset().mockImplementation(async ({ intent, mode }) => {
    if (mode === 'start') f.parents.set(communityPublishLane(intent), { schema: 'soulidity.community-publish-journal.v1', intent, receipt: null })
    return { status: 'pending' }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('mount inspects without creating a draft or operation ID and read/query ignore the write flag', async () => {
  const saved = put(); f.writes = false; f.auth.profile = null; f.auth.profileError = 'offline'
  await render(); expect(hook.pending).toEqual(saved)
  expect(f.uuid).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.writeFlag).not.toHaveBeenCalled()
  await execute(() => hook.query())
  expect(f.run).toHaveBeenCalledWith({ intent: saved.intent, mode: 'query' }); expect(f.writeFlag).not.toHaveBeenCalled()
})
it.each([{ kind: 'post' }, { kind: 'comment', postId }] as const)('normalizes and freezes the explicit $kind payload with registered author', async target => {
  await render(target)
  const payload = { title: ' Title ', content: ' Body ', tags: [' a ', 'a', 'B'], postType: 2 as const, channel: 1 as const }
  const { failure } = await execute(() => { const promise = hook.publish(payload); payload.content = 'changed'; return promise })
  expect(failure).toBeUndefined(); expect(f.uuid).toHaveBeenCalledTimes(1)
  const intent = f.run.mock.calls[0][0].intent
  expect(intent).toMatchObject({ owner, authorId, operationId: '1'.repeat(32), document: { content: 'Body' } })
  if (target.kind === 'post') expect(intent).toMatchObject({ postType: 2, channel: 1, document: { title: 'Title', tags: ['a', 'B'] } })
  else expect(intent).toMatchObject({ postId, document: { schema: 'soulidity.public-comment.v1' } })
})
it.each(['resume', 'cancel', 'archive'] as const)('%s retains frozen author/document without a usable current profile', async action => {
  const saved = put(); f.auth.profile = null; f.auth.profileError = 'offline'; await render()
  expect((await execute(() => hook[action]())).failure).toBeUndefined()
  expect(f.run).toHaveBeenCalledWith({ intent: saved.intent, mode: action }); expect(f.uuid).not.toHaveBeenCalled()
})
it.each(['profile', 'owner', 'loading', 'error', 'pending'])('blocks new paid publication for %s', async variant => {
  if (variant === 'profile') f.auth.profile = null
  if (variant === 'owner') f.auth.profile.owner = id(99)
  if (variant === 'loading') f.auth.loading = true
  if (variant === 'error') f.auth.profileError = 'offline'
  if (variant === 'pending') put()
  await render(); expect((await execute(() => hook.publish({ title: 'T', content: 'B' }))).failure).toBeInstanceOf(Error)
  expect(f.run).not.toHaveBeenCalled()
})
it('exports both parent and exact signed operation, and retains result after parent archival', async () => {
  const parent = put(), child = operation(parent); f.operations.set(publicCommunityPublishOperationKey(parent.intent), child)
  await render(); expect(JSON.parse(hook.recoveryExport!)).toMatchObject({ journal: parent, operation: child })
  const result = { kind: 'post', postId: id(30), commentId: null, digest: 'digest' }
  f.run.mockImplementationOnce(async () => { f.parents.clear(); return { status: 'published', result } })
  await execute(() => hook.query()); expect(hook.pending).toBeNull(); expect(hook.result).toEqual(result)
  expect(JSON.parse(hook.recoveryExport!)).toMatchObject({ journal: null, operation: child })
})
it('retains stronger emergency operation and parent evidence across older storage reads', async () => {
  const parent = put(), child = operation(parent), receiptParent = { ...parent, receipt: { evidence: 'paid' } } as any
  f.operations.set(publicCommunityPublishOperationKey(parent.intent), operation(parent, 'SIGNING'))
  await render()
  f.run.mockRejectedValueOnce(new PublicCommunityPublishPersistenceError(child, new Error('quota')))
  await execute(() => hook.resume())
  f.run.mockRejectedValueOnce(new PublicCommunityPublishPersistenceError(operation(parent, 'SIGNING'), new Error('quota')))
  await execute(() => hook.query())
  f.run.mockRejectedValueOnce(new CommunityJournalPersistenceError(receiptParent, new Error('quota')))
  await execute(() => hook.query())
  expect(JSON.parse(hook.recoveryExport!).emergency).toEqual({ journal: receiptParent, operation: child })
})
it.each(['wallet', 'parent', 'release', 'unmount'] as const)('revokes upload writes/signing and suppresses late results on %s change', async change => {
  const saved = put(journal({ kind: 'comment', postId })); await render({ kind: 'comment', postId })
  let finish!: (value: any) => void
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let pending!: Promise<unknown>; const old = hook
  await act(async () => { pending = old.resume(); await Promise.resolve(); await Promise.resolve() })
  const captured = f.params
  if (change === 'wallet') f.auth.walletAddress = id(99)
  if (change === 'release') f.config.deployment.profile.callablePackageId = id(99)
  if (change === 'unmount') await act(async () => root.unmount())
  else await render({ kind: 'comment', postId: change === 'parent' ? id(99) : postId })
  expect(captured.getAddress()).toBeNull(); expect(captured.writesEnabled()).toBe(false)
  await act(async () => { finish({ status: 'published', result: { kind: 'comment', postId, commentId: id(30), digest: 'digest' } }); await pending })
  if (change !== 'unmount') { expect(hook.result).toBeNull(); expect(hook.pending).toBeNull() }
  expect((await execute(() => old.resume())).failure).toMatchObject({ message: 'Publication context changed' })
  expect(saved.intent.postId).toBe(postId)
})
it('retains late emergency signatures only for their original scope', async () => {
  const parent = put(), child = operation(parent); await render()
  let fail!: (error: unknown) => void, pending!: Promise<unknown>
  f.run.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await act(async () => { pending = hook.resume().catch(error => error); await Promise.resolve(); await Promise.resolve() })
  f.auth.walletAddress = id(99); await render()
  await act(async () => { fail(new PublicCommunityPublishPersistenceError(child, new Error('quota'))); await pending })
  expect(hook.recoveryExport).toBeNull()
  f.auth.walletAddress = owner; await render()
  expect(JSON.parse(hook.recoveryExport!).emergency.operation).toEqual(child)
})
it('release changes revoke writes before rerender and quote approval cannot authorize a changed scope', async () => {
  await render(); const captured = f.params
  let approve!: (value: boolean) => void
  f.approve.mockImplementationOnce(() => new Promise(resolve => { approve = resolve }))
  const quote = captured.confirmQuote({})
  f.config.deployment.profile.callablePackageId = id(99)
  expect(captured.writesEnabled()).toBe(false); expect(captured.getAddress()).toBeNull()
  approve(true); expect(await quote).toBe(false)
})
it('scope round trips never restore authority to old callbacks and concurrent runs are rejected', async () => {
  put(); await render(); const old = hook
  let finish!: (value: any) => void, pending!: Promise<unknown>
  f.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { pending = old.resume(); await Promise.resolve(); await Promise.resolve() })
  expect((await execute(() => hook.query())).failure).toMatchObject({ message: 'Publication operation is already running' })
  const captured = f.params
  f.auth.walletAddress = id(99); await render(); f.auth.walletAddress = owner; await render()
  expect(captured.writesEnabled()).toBe(false); expect(captured.getAddress()).toBeNull()
  await act(async () => { finish({ status: 'published', result: { kind: 'post', postId: id(30), commentId: null, digest: 'digest' } }); await pending })
  expect(hook.result).toBeNull()
  expect((await execute(() => old.resume())).failure).toMatchObject({ message: 'Publication context changed' })
})
it('keeps emergency export available when even the post-failure storage read fails', async () => {
  const parent = put(), child = operation(parent); await render()
  f.run.mockImplementationOnce(async () => {
    f.inspect.mockRejectedValue(new Error('storage unavailable'))
    throw new PublicCommunityPublishPersistenceError(child, new Error('quota'))
  })
  await execute(() => hook.resume())
  expect(JSON.parse(hook.recoveryExport!).emergency.operation).toEqual(child)
  expect(hook.error).toContain('NOT_PERSISTED'); expect(hook.busy).toBe(false)
})
