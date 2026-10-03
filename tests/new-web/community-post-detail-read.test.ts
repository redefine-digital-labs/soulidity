import { expect, it, vi } from 'vitest'
import { readBrowserCommunityPostDetail } from '../../web/lib/community/post-detail-read'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture(count = 5) {
  const config = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) },
    storage: { blobType: `${id(8)}::blob::Blob`, chainIdentifier: '35834a8a', aggregatorUrl: 'https://storage.example' }, voteRegistryId: id(9) }
  const snapshot = { id: id(7), objectVersion: '1', objectDigest: 'digest', commentCount: String(count) }
  const parent = { post: snapshot, document: { title: 'Title' }, votes: { score: '-9007199254740993' }, storageEndEpoch: 20, authorStorageEndEpoch: 20 }
  const entries = Array.from({ length: Math.min(200, count) }, (_, index) => ({ id: id(100 + index), index: String(index) }))
  const post = vi.fn(async () => structuredClone(parent) as any)
  const directory = vi.fn(async () => ({ entries, postId: snapshot.id, postVersion: '1', postDigest: 'digest', observedCount: String(count),
    upperBound: String(count), nextIndex: count > 200 ? '200' : null, partial: count > 200 }) as any)
  let active = 0, peak = 0
  const comment = vi.fn(async (input: any) => {
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--
    return { post: structuredClone(snapshot), comment: { id: input.commentId, index: entries.find(e => e.id === input.commentId)!.index },
      document: { content: 'Reply' }, storageEndEpoch: 20, authorStorageEndEpoch: 20 } as any
  })
  const postState = vi.fn(async () => structuredClone(snapshot) as any)
  const systemState = vi.fn(async () => ({ committee: { epoch: 19 } }))
  const walrus = vi.fn(() => ({ reset: vi.fn(), getBlobType: () => config.storage.blobType, systemState }) as any)
  return { params: { client: {} as any, config, postId: snapshot.id, viewerAddress: id(5) }, snapshot, post, directory, comment, postState, systemState,
    dependencies: { post, directory, comment, postState, walrus }, peak: () => peak }
}
it('hydrates creation order with bounded parallelism and exact score', async () => {
  const f = fixture(), result = await readBrowserCommunityPostDetail(f.params, f.dependencies)
  expect(result.comments.map(c => c.comment.index)).toEqual(['0', '1', '2', '3', '4'])
  expect(f.peak()).toBe(4); expect(result.votes.score).toBe('-9007199254740993'); expect(result.atomic).toBe(false)
  expect(f.directory).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }))
})
it('retains earliest200 limit and exposes partial coverage', async () => {
  const f = fixture(201), result = await readBrowserCommunityPostDetail(f.params, f.dependencies)
  expect(result.comments).toHaveLength(200)
  expect(result.commentWindow).toEqual({ shown: 200, total: '201', partial: true, nextIndex: '200', upperBound: '201' })
})
it('returns genuine empty comments without fabricating a read failure', async () => {
  const f = fixture(0), result = await readBrowserCommunityPostDetail(f.params, f.dependencies)
  expect(result.comments).toEqual([]); expect(f.comment).not.toHaveBeenCalled()
})
it.each(['postVersion', 'postDigest', 'observedCount'])('rejects directory %s drift', async field => {
  const f = fixture(), original = f.directory.getMockImplementation()!
  f.directory.mockImplementation(async () => ({ ...await original(), [field]: 'changed' }))
  await expect(readBrowserCommunityPostDetail(f.params, f.dependencies)).rejects.toThrow('POST_CHANGED_RETRY')
  expect(f.comment).not.toHaveBeenCalled()
})
it.each(['parent', 'id', 'index'])('rejects hydrated comment %s substitution', async field => {
  const f = fixture(), original = f.comment.getMockImplementation()!
  f.comment.mockImplementation(async input => {
    const row = await original(input)
    if (field === 'parent') row.post.objectVersion = '2'
    else row.comment[field] = 'other'
    return row
  })
  await expect(readBrowserCommunityPostDetail(f.params, f.dependencies)).rejects.toThrow()
})
it('cancels hanging siblings when one comment fails and never returns a partial success', async () => {
  const f = fixture(), observed: AbortSignal[] = []
  f.comment.mockImplementation(async input => {
    observed.push(input.signal)
    if (observed.length === 1) throw new Error('download failed')
    return new Promise(() => {})
  })
  await expect(readBrowserCommunityPostDetail(f.params, f.dependencies)).rejects.toThrow('download failed')
  expect(observed.every(s => s.aborted)).toBe(true); expect(f.comment).toHaveBeenCalledTimes(4)
})
it('rejects a final changed Post or expired content after comment hydration', async () => {
  const f = fixture(); f.postState.mockResolvedValueOnce({ ...f.snapshot, objectVersion: '2' })
  await expect(readBrowserCommunityPostDetail(f.params, f.dependencies)).rejects.toThrow('POST_CHANGED_RETRY')
  f.systemState.mockResolvedValue({ committee: { epoch: 20 } })
  await expect(readBrowserCommunityPostDetail(f.params, f.dependencies)).rejects.toThrow('STORAGE_EXPIRED')
})
it('captures release and viewer before async work', async () => {
  const f = fixture(), original = f.post.getMockImplementation()!
  f.post.mockImplementation(async () => { f.params.config.deployment.registryId = id(99); f.params.viewerAddress = id(98); return original() })
  await readBrowserCommunityPostDetail(f.params, f.dependencies)
  expect(f.directory.mock.calls[0][0].deployment.registryId).toBe(id(4))
  expect(f.post.mock.calls[0][0].viewerAddress).toBe(id(5))
})
