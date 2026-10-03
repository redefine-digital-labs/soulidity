import { beforeEach, expect, it, vi } from 'vitest'
import { createCommunityPublishController } from '../../web/lib/community/publish-controller'
import { createPublicCommunityPublishIntent, publicCommunityPublishCommitment } from '../../packages/soulidity-sdk/src/community-publish-intent'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(), runPublicCommunityPublishOperation: mocks.run }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
beforeEach(() => vi.clearAllMocks())
async function fixture() {
  const intent = createPublicCommunityPublishIntent({ deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) },
    owner: id(5), authorId: id(7), operationId: 'a'.repeat(32), kind: 'post', postType: 0, channel: 0,
    document: { schema: 'soulidity.public-post.v1', title: 'Title', content: 'Body', tags: [] } })
  const c = await publicCommunityPublishCommitment(intent), events: string[] = []
  let journal: any = null, operation: any = null, owner: string | null = intent.owner
  const lease = { read: async () => structuredClone(journal), write: vi.fn(async (r: any) => { events.push(r.receipt ? 'receipt' : 'intent'); journal = structuredClone(r) }),
    archive: vi.fn(async () => { events.push('archive'); journal = null }) }
  const journals = { inspect: async () => structuredClone(journal), exclusive: async (_i: any, work: any) => work(lease) }
  const operations = { read: () => structuredClone(operation), write: (_k: string, r: any) => { operation = structuredClone(r) }, exclusive: async (_k: string, work: any) => work() }
  const uploaded = { blobId: 'A'.repeat(43), blobObjectId: id(9), contentHash: c.contentHash, blobUrl: 'https://storage.example/v1/blobs/test', recoveryKey: 'storage-key', certifyTxDigest: 'storage-digest' }
  const uploads = { recover: vi.fn(async () => ({ status: 'NONE' } as any)), upload: vi.fn(async () => { events.push('upload'); return uploaded }),
    acknowledge: vi.fn(async () => { events.push('ack') }) }
  const transaction = { prepare: vi.fn(async (i: any, receipt: any) => { events.push('prepare'); return { intent: i, receipt, phase: 'PREPARED' } as any }), adapter: {} as any }
  const result = vi.fn(async () => { events.push('result'); return { kind: 'post' as const, postId: id(11), commentId: null, digest: 'digest' } })
  mocks.run.mockImplementation(async (p: any) => {
    events.push('run'); const record = { ...(p.prepared ?? p.store.read('key')), phase: 'SUCCEEDED' }
    p.store.write('key', record); return record
  })
  const controller = createCommunityPublishController({ client: { core: {} } as any, config: { deployment: intent.deployment,
    storage: { chainIdentifier: '35834a8a', blobType: `${id(12)}::blob::Blob`, aggregatorUrl: 'https://storage.example' } },
    getAddress: () => owner, writesEnabled: () => true, sign: vi.fn(), journals, operations, uploads },
  { profile: vi.fn(async () => ({ id: intent.authorId, owner: intent.owner }) as any), transaction, result })
  return { intent, controller, events, lease, uploads, uploaded, transaction, result,
    journal: () => journal, operation: () => operation, disconnect: () => { owner = null } }
}
it('persists before paying and archives only after exact result readback', async () => {
  const f = await fixture()
  expect((await f.controller.run({ intent: f.intent, mode: 'start' })).status).toBe('published')
  expect(f.events).toEqual(['intent', 'upload', 'receipt', 'ack', 'prepare', 'run', 'result', 'archive'])
  const args = f.uploads.upload.mock.calls[0] as any[]
  expect(await args[0].text()).toBe(JSON.stringify(f.intent.document))
  expect(args[1]).toContain(f.intent.operationId)
})
it('never pays if parent journal persistence fails', async () => {
  const f = await fixture(); f.lease.write.mockRejectedValueOnce(new Error('quota'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('quota')
  expect(f.uploads.recover).not.toHaveBeenCalled(); expect(f.uploads.upload).not.toHaveBeenCalled()
})
it('retains receipt before noticing wallet change during upload', async () => {
  const f = await fixture(); f.uploads.upload.mockImplementation(async () => { f.disconnect(); return f.uploaded })
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('RECONNECT_PREPARING_WALLET')
  expect(f.journal().receipt.reference.blobObjectId).toBe(f.uploaded.blobObjectId)
  expect(f.transaction.prepare).not.toHaveBeenCalled()
})
it('reuses certified upload rather than paying twice after a lost parent receipt', async () => {
  const f = await fixture(); f.uploads.recover.mockResolvedValue({ status: 'CERTIFIED', result: f.uploaded })
  await f.controller.run({ intent: f.intent, mode: 'start' })
  expect(f.uploads.upload).not.toHaveBeenCalled(); expect(f.transaction.prepare).toHaveBeenCalledOnce()
})
it('query inspects paid recovery without starting uploads or transactions', async () => {
  const f = await fixture(); f.uploads.upload.mockRejectedValueOnce(new Error('offline'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('offline')
  f.disconnect(); f.uploads.upload.mockClear()
  expect((await f.controller.run({ intent: f.intent, mode: 'query' })).status).toBe('pending')
  expect(f.uploads.upload).not.toHaveBeenCalled(); expect(f.transaction.prepare).not.toHaveBeenCalled()
})
it('does not acknowledge an upload whose parent receipt could not be persisted', async () => {
  const f = await fixture(), original = f.lease.write.getMockImplementation()!
  f.lease.write.mockImplementation(async r => { if (r.receipt) throw new Error('receipt quota'); return original(r) })
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('receipt quota')
  expect(f.uploads.acknowledge).not.toHaveBeenCalled(); expect(f.transaction.prepare).not.toHaveBeenCalled()
})
it('retains parent and exact business operation if result readback is unavailable', async () => {
  const f = await fixture(); f.result.mockRejectedValueOnce(new Error('historical object unavailable'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('historical object unavailable')
  expect(f.journal()).not.toBeNull(); expect(f.lease.archive).not.toHaveBeenCalled()
  f.disconnect()
  expect((await f.controller.run({ intent: f.intent, mode: 'query' })).status).toBe('published')
  expect(f.uploads.upload).toHaveBeenCalledOnce(); expect(f.transaction.prepare).toHaveBeenCalledOnce()
  expect(mocks.run.mock.calls.at(-1)![0].queryOnly).toBe(true)
})
it('retries child acknowledgement after parent receipt was already saved', async () => {
  const f = await fixture(); f.uploads.acknowledge.mockRejectedValueOnce(new Error('ack failed'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('ack failed')
  expect(f.journal().receipt).not.toBeNull()
  f.uploads.recover.mockResolvedValue({ status: 'CERTIFIED', result: f.uploaded })
  expect((await f.controller.run({ intent: f.intent, mode: 'resume' })).status).toBe('published')
  expect(f.uploads.upload).toHaveBeenCalledOnce(); expect(f.uploads.acknowledge).toHaveBeenCalledTimes(2)
})
it('rejects a recovered upload that conflicts with the frozen receipt', async () => {
  const f = await fixture(); f.uploads.acknowledge.mockRejectedValueOnce(new Error('ack failed'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('ack failed')
  f.uploads.recover.mockResolvedValue({ status: 'CERTIFIED', result: { ...f.uploaded, blobObjectId: id(99) } })
  await expect(f.controller.run({ intent: f.intent, mode: 'resume' })).rejects.toThrow('RECOVERED_UPLOAD_MISMATCH')
  expect(f.transaction.prepare).not.toHaveBeenCalled()
})
it('does not rebuild an unknown business operation', async () => {
  const f = await fixture()
  mocks.run.mockImplementation(async p => { const r = { ...p.prepared, phase: 'SIGNED' }; p.store.write('key', r); return r })
  expect((await f.controller.run({ intent: f.intent, mode: 'start' })).status).toBe('pending')
  mocks.run.mockImplementation(async p => p.store.read('key'))
  await f.controller.run({ intent: f.intent, mode: 'resume' })
  expect(f.uploads.upload).toHaveBeenCalledOnce(); expect(f.transaction.prepare).toHaveBeenCalledOnce()
  expect(f.lease.archive).not.toHaveBeenCalled()
})
it('refuses cancellation while upload result remains unknown', async () => {
  const f = await fixture(); f.uploads.upload.mockRejectedValue(new Error('offline'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('offline')
  f.uploads.recover.mockResolvedValue({ status: 'UNKNOWN' })
  await expect(f.controller.run({ intent: f.intent, mode: 'cancel' })).rejects.toThrow('UPLOAD_UNRESOLVED')
  expect(f.lease.archive).not.toHaveBeenCalled()
})
it('archives resolved unpublished work and rejects replacement by another draft', async () => {
  const f = await fixture(); f.uploads.upload.mockRejectedValueOnce(new Error('offline'))
  await expect(f.controller.run({ intent: f.intent, mode: 'start' })).rejects.toThrow('offline')
  const other = structuredClone(f.intent); other.operationId = 'b'.repeat(32)
  await expect(f.controller.run({ intent: other, mode: 'start' })).rejects.toThrow('FROZEN_OPERATION_REQUIRED')
  expect((await f.controller.run({ intent: f.intent, mode: 'cancel' })).status).toBe('archived')
})
