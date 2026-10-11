import { beforeEach, expect, it, vi } from 'vitest'
import { fromBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { createHash } from 'node:crypto'
import type { PublicProfileOperation, PublicProfileOperationAdapter, PublicProfileOperationStore } from '@soulidity/sdk'
import { createProfileSaveController, type ProfileSaveDraft, type ProfileDraftStore, type ProfileSaveTransport } from '../../web/lib/profile/profile-save-controller'
import { publicProfileOperationFixture, profileId, profileSigner } from './fixtures/public-profile-operation'

const mock = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), client: vi.fn() }))
vi.mock('@soulidity/sdk', async importOriginal => ({ ...await importOriginal<object>(),
  readMyWalletProfile: mock.read, preparePublicProfileSave: mock.prepare }))
vi.mock('../../web/lib/profile/profile-operation-client', () => ({ createPublicProfileOperationClient: mock.client }))
beforeEach(() => { vi.clearAllMocks() })

async function setup() {
  const f = await publicProfileOperationFixture()
  let draft: ProfileSaveDraft | null = null, operation: PublicProfileOperation | null = null
  let owner = f.intent.owner, locked = false, complete = false
  const events: string[] = [], archives: ProfileSaveDraft[] = []
  const operations: PublicProfileOperationStore = {
    exclusive: vi.fn(async (_key, work) => {
      if (locked) throw new Error('busy')
      locked = true; events.push('lock')
      try { return await work() } finally { locked = false; events.push('unlock') }
    }),
    read: () => structuredClone(operation),
    write: (_key, value) => { expect(locked).toBe(true); operation = structuredClone(value); events.push(`operation:${value.phase}`) },
  }
  const drafts: ProfileDraftStore = {
    read: () => structuredClone(draft),
    write: vi.fn((_key, value) => { expect(locked).toBe(true); draft = structuredClone(value); events.push(value.metadataReceipt ? 'receipt' : value.coverReceipt ? 'cover-receipt' : 'draft') }),
    archive: vi.fn((_key, value) => { archives.push(structuredClone(value)); draft = null; events.push('archive') }),
  }
  const result = { blobId: f.receipt.reference.blobId, blobObjectId: f.receipt.reference.blobObjectId,
    contentHash: f.receipt.reference.sha256, blobUrl: `https://agg.example/v1/blobs/${f.receipt.reference.blobId}`,
    recoveryKey: 'upload-key', certifyTxDigest: f.record.digest }
  const uploads: ProfileSaveTransport = {
    recover: vi.fn(async () => { events.push('recover'); return { status: 'NONE' } }),
    upload: vi.fn(async () => { expect(locked).toBe(true); expect(draft).not.toBeNull(); events.push('upload'); return result }),
    acknowledge: vi.fn(async () => { expect(draft?.metadataReceipt || draft?.coverReceipt).toBeTruthy(); events.push('ack') }),
  }
  const adapter: PublicProfileOperationAdapter = {
    query: vi.fn(async () => { events.push('query'); return complete ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async () => { if (owner !== f.intent.owner) throw new Error('wallet-changed') }),
    sign: vi.fn(async record => { events.push('sign'); return profileSigner.signTransaction(fromBase64(record.bytes)) }),
    verifySignature: async record => { await verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.intent.owner }) },
    broadcast: vi.fn(async () => { events.push('broadcast'); complete = true }),
  }
  mock.client.mockReturnValue({ adapter, prepare: vi.fn(async () => structuredClone(f.record)) })
  mock.read.mockImplementation(async () => ({ id: f.intent.expected!.profileId, revision: '0' }))
  mock.prepare.mockImplementation(async args => {
    events.push('prepare')
    if (!args.receipt) await args.upload(new TextEncoder().encode('json'))
    await args.persistReceipt(f.receipt)
    return { status: 'prepared', intent: f.intent, receipt: f.receipt, transaction: f.tx }
  })
  let cachedCover: File | null = null
  const covers = { read: vi.fn(async () => cachedCover), write: vi.fn(async (_key: string, file: File) => { cachedCover = file; events.push('cover-cached') }) }
  const controller = createProfileSaveController({ config: { deployment: f.intent.deployment,
    storage: { aggregatorUrl: 'https://agg.example', blobType: `${profileId(7)}::blob::Blob` }, writesEnabled: true },
    client: { core: {} } as any, getAddress: () => owner, sign: vi.fn(), operations, drafts, uploads, covers })
  const run = (mode: 'save' | 'resume' | 'query' | 'discard' = 'save', coverFile?: File | null) => controller.run({ intent: f.intent, mode, coverFile })
  return { ...f, controller, run, operations, drafts, uploads, covers, adapter, result, events, archives,
    draft: () => draft, operation: () => operation, setDraft: (value: ProfileSaveDraft | null) => { draft = value },
    setOperation: (value: PublicProfileOperation | null) => { operation = value },
    switchWallet: () => { owner = profileId(999) }, complete: () => { complete = true } }
}
it('one outer lease spans draft, paid upload receipt, exact signed packet and final archive', async () => {
  const f = await setup()
  expect((await f.run()).status).toBe('saved')
  expect(f.operations.exclusive).toHaveBeenCalledOnce()
  expect(f.events.indexOf('draft')).toBeLessThan(f.events.indexOf('upload'))
  expect(f.events.indexOf('receipt')).toBeLessThan(f.events.indexOf('ack'))
  expect(f.events.indexOf('operation:PREPARED')).toBeLessThan(f.events.indexOf('sign'))
  expect(f.events.indexOf('operation:SIGNED')).toBeLessThan(f.events.indexOf('broadcast'))
  expect(f.operation()?.phase).toBe('SUCCEEDED'); expect(f.archives).toHaveLength(1)
})
it('an unknown previous signature blocks every new paid action and query never prompts', async () => {
  const f = await setup(); f.setOperation({ ...f.record, phase: 'SIGNING' })
  expect((await f.run()).status).toBe('pending')
  expect((await f.run('query')).status).toBe('pending')
  expect(f.uploads.recover).not.toHaveBeenCalled(); expect(f.uploads.upload).not.toHaveBeenCalled()
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('can resume an orphaned operation without rebuilding or uploading a draft', async () => {
  const f = await setup(); f.setOperation(f.record)
  expect((await f.run('resume')).status).toBe('saved')
  expect(f.uploads.upload).not.toHaveBeenCalled(); expect(f.adapter.sign).toHaveBeenCalledOnce()
})
it('a certified previous operation does not permanently disable a later Save', async () => {
  const f = await setup(); f.setOperation({ ...f.record, phase: 'SUCCEEDED' }); f.complete()
  expect((await f.run()).status).toBe('saved')
  expect(f.uploads.upload).toHaveBeenCalledOnce()
  expect(f.events.indexOf('query')).toBeLessThan(f.events.indexOf('upload'))
})
it('freeze failure and stale chain revision both stop before paying', async () => {
  const f = await setup(); vi.mocked(f.drafts.write).mockImplementationOnce(() => { throw new Error('quota') })
  await expect(f.run()).rejects.toThrow('PROFILE_DRAFT_NOT_PERSISTED')
  expect(f.uploads.upload).not.toHaveBeenCalled()
  mock.read.mockResolvedValueOnce({ id: f.intent.expected!.profileId, revision: '1' })
  await expect(f.run()).rejects.toThrow('PROFILE_CHANGED_RELOAD_REQUIRED')
  expect(f.uploads.upload).not.toHaveBeenCalled()
})
it('retains paid metadata on wallet switch before any profile signature', async () => {
  const f = await setup()
  vi.mocked(f.uploads.upload).mockImplementationOnce(async () => { f.switchWallet(); return f.result })
  await expect(f.run()).rejects.toThrow('PROFILE_RECONNECT_PREPARING_WALLET')
  expect(f.draft()?.metadataReceipt).toEqual(f.receipt)
  expect(f.uploads.acknowledge).toHaveBeenCalledOnce(); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('receipt persistence failure never acknowledges or opens a profile prompt', async () => {
  const f = await setup()
  f.drafts.write = (key, draft) => { if (draft.metadataReceipt) throw new Error('quota'); f.setDraft(structuredClone(draft)) }
  await expect(f.run()).rejects.toThrow('PROFILE_DRAFT_NOT_PERSISTED')
  expect(f.uploads.acknowledge).not.toHaveBeenCalled(); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('old success cannot intercept resume or query of a different new draft', async () => {
  const f = await setup(); f.setOperation({ ...f.record, phase: 'SUCCEEDED' }); f.complete()
  const second = { ...f.intent, handle: 'second_save' }
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('new-upload-unknown'))
  await expect(f.controller.run({ intent: second, mode: 'save' })).rejects.toThrow('new-upload-unknown')
  expect((await f.controller.run({ intent: second, mode: 'query' })).status).toBe('pending')
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('resumed-new-upload'))
  await expect(f.controller.run({ intent: second, mode: 'resume' })).rejects.toThrow('resumed-new-upload')
  expect(f.draft()?.intent.handle).toBe('second_save')
})
it('queries a frozen draft without upload/sign or accepting changed form edits', async () => {
  const f = await setup(); vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('cancelled'))
  await expect(f.run()).rejects.toThrow('cancelled')
  expect((await f.run('query')).status).toBe('pending')
  await expect(f.controller.run({ intent: { ...f.intent, handle: 'other' }, mode: 'save' })).rejects.toThrow('PROFILE_FROZEN_SAVE_RECOVERY_REQUIRED')
  expect(f.uploads.upload).toHaveBeenCalledOnce(); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('explicit resume passes the same frozen scope/source to the query-first upload WAL', async () => {
  const f = await setup(); vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('unknown-broadcast'))
  await expect(f.run()).rejects.toThrow('unknown-broadcast')
  const firstScope = vi.mocked(f.uploads.upload).mock.calls[0][1]
  vi.mocked(f.uploads.recover).mockResolvedValue({ status: 'UNKNOWN' })
  await f.run('query'); expect(f.uploads.upload).toHaveBeenCalledOnce()
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('WALRUS_TRANSACTION_PENDING'))
  await expect(f.run('resume')).rejects.toThrow('WALRUS_TRANSACTION_PENDING')
  expect(vi.mocked(f.uploads.upload).mock.calls[1][1]).toBe(firstScope)
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('a normal 65537-byte cover hashes independently of the 64KiB JSON limit', async () => {
  const f = await setup(), file = new File([new Uint8Array(65537)], 'cover.png', { type: 'image/png' })
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('cover-upload-reached'))
  await expect(f.run('save', file)).rejects.toThrow('cover-upload-reached')
  expect(f.draft()?.cover?.byteLength).toBe(65537)
})
it('reselecting a different cover cannot upload and the certified original resumes without a File', async () => {
  const f = await setup(), file = new File(['original'], 'cover.png', { type: 'image/png' })
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('unknown'))
  await expect(f.run('save', file)).rejects.toThrow('unknown')
  await expect(f.run('resume', new File(['different'], 'cover.png', { type: 'image/png' }))).rejects.toThrow('PROFILE_RESELECT_MATCHING_COVER')
  const cover = { ...f.result, contentHash: createHash('sha256').update('original').digest('hex') }
  vi.mocked(f.uploads.recover).mockResolvedValueOnce({ status: 'CERTIFIED', result: cover })
  mock.prepare.mockRejectedValueOnce(new Error('stop-after-cover-recovery'))
  await expect(f.run('resume')).rejects.toThrow('stop-after-cover-recovery')
  expect(f.draft()?.coverReceipt).toEqual(cover); expect(f.uploads.upload).toHaveBeenCalledOnce()
})
it('will not archive signed unknown transactions or unfinished uploads', async () => {
  const f = await setup(); f.setOperation({ ...f.record, phase: 'SIGNING' })
  await expect(f.run('discard')).rejects.toThrow('PROFILE_OPERATION_CANNOT_DISCARD_SIGNED')
  f.setOperation(null); vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('upload-unknown'))
  await expect(f.run()).rejects.toThrow('upload-unknown')
  vi.mocked(f.uploads.recover).mockResolvedValueOnce({ status: 'UNKNOWN' })
  await expect(f.run('discard')).rejects.toThrow('PROFILE_UPLOAD_UNRESOLVED_CANNOT_DISCARD')
  expect(f.archives).toHaveLength(0)
})
it('persists cropped bytes before payment and resumes the same bytes without a reselected File', async () => {
  const f = await setup(), file = new File(['cropped'], 'cover.png', { type: 'image/png' })
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('interrupted'))
  await expect(f.run('save', file)).rejects.toThrow('interrupted')
  expect(f.covers.write).toHaveBeenCalledOnce()
  expect(f.events.indexOf('cover-cached')).toBeGreaterThan(f.events.indexOf('draft'))
  vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('same-file-resumed'))
  await expect(f.run('resume')).rejects.toThrow('same-file-resumed')
  expect(vi.mocked(f.uploads.upload).mock.calls[1][0]).toBe(file)
})
it('cover cache quota/readback failures stop before a storage transaction', async () => {
  const f = await setup(), file = new File(['cropped'], 'cover.png', { type: 'image/png' })
  f.covers.write.mockRejectedValueOnce(new Error('idb-quota'))
  await expect(f.run('save', file)).rejects.toThrow('idb-quota')
  f.covers.read.mockResolvedValueOnce(null)
  await expect(f.run('resume', file)).rejects.toThrow('PROFILE_COVER_RECOVERY_PERSISTENCE_FAILED')
  expect(f.uploads.upload).not.toHaveBeenCalled()
})
it('archives a declined unsigned upload without deleting its paid receipt log', async () => {
  const f = await setup(); vi.mocked(f.uploads.upload).mockRejectedValueOnce(new Error('declined'))
  await expect(f.run()).rejects.toThrow('declined')
  expect((await f.run('discard')).status).toBe('archived')
  expect(f.archives).toHaveLength(1); expect(f.draft()).toBeNull()
})
it('rejects a concurrent controller before any second paid upload', async () => {
  const f = await setup(); let release!: () => void
  vi.mocked(f.uploads.upload).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return f.result })
  const first = f.run()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(f.run()).rejects.toThrow('busy')
  release(); await first
  expect(f.uploads.upload).toHaveBeenCalledOnce()
})
