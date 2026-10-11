import { expect, it, vi } from 'vitest'
import { assertCommunityAcceptanceReady } from '../../web/lib/community/accept-preflight'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture() {
  const intent = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) },
    owner: id(5), authorId: id(7), postId: id(8), commentId: id(9), expectedRevision: '9007199254740993' }
  const author = { id: intent.authorId, owner: intent.owner, revision: '1' }
  const post = { id: intent.postId, registryId: id(4), profileRegistryId: id(3), author: { ...author }, postType: 'question', acceptanceRevision: intent.expectedRevision, acceptedComment: null as any }
  const comment = { id: intent.commentId, postId: intent.postId, registryId: id(4), profileRegistryId: id(3), author: { ...author } }
  const profile = vi.fn(async () => structuredClone(author) as any)
  const read = vi.fn(async () => ({ post: structuredClone(post), comment: structuredClone(comment), accepted: false }) as any)
  return { intent, author, post, comment, profile, read, params: { client: { core: {} } as any, intent, signing: true }, dependencies: { profile, comment: read } }
}
it('allows author to accept their own same-post comment with exact large revision', async () => {
  const f = fixture(); await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).resolves.toMatchObject({ comment: { id: f.intent.commentId } })
  expect(f.profile).toHaveBeenCalledTimes(2)
})
it.each(['post', 'parent', 'comment-registry', 'profile-registry'])('rejects wrong %s membership', async field => {
  const f = fixture()
  if (field === 'post') f.post.id = id(99)
  if (field === 'parent') f.comment.postId = id(99)
  if (field === 'comment-registry') f.comment.registryId = id(99)
  if (field === 'profile-registry') f.post.profileRegistryId = id(99)
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).rejects.toThrow('PARENT_MISMATCH')
})
it.each(['non-question', 'other-author', 'other-owner'])('rejects %s acceptance', async field => {
  const f = fixture()
  if (field === 'non-question') f.post.postType = 'log'
  if (field === 'other-author') f.post.author.id = id(99)
  if (field === 'other-owner') f.post.author.owner = id(99)
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).rejects.toThrow('QUESTION_AUTHOR_REQUIRED')
})
it('rejects stale preparation but does not reinterpret an already signed CAS intent', async () => {
  const f = fixture(); f.post.acceptanceRevision = '9007199254740994'
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).rejects.toThrow('REVISION_CHANGED')
  await expect(assertCommunityAcceptanceReady({ ...f.params, signing: false }, f.dependencies)).resolves.toBeTruthy()
})
it('allows exhausted-revision same-answer no-op but rejects replacement', async () => {
  const f = fixture(); f.intent.expectedRevision = f.post.acceptanceRevision = '18446744073709551615'
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).rejects.toThrow('REVISION_EXHAUSTED')
  f.post.acceptedComment = { id: f.intent.commentId }
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).resolves.toBeTruthy()
})
it('rejects identity changing during the Post read', async () => {
  const f = fixture(), original = f.read.getMockImplementation()!
  f.read.mockImplementation(async () => { f.author.revision = '2'; return original() })
  await expect(assertCommunityAcceptanceReady(f.params, f.dependencies)).rejects.toThrow('AUTHOR_CHANGED')
})
it('captures mutable caller intent before awaits', async () => {
  const f = fixture(), original = f.profile.getMockImplementation()!
  f.profile.mockImplementation(async () => { f.intent.commentId = id(99); return original() })
  await assertCommunityAcceptanceReady(f.params, f.dependencies)
  expect(f.read.mock.calls[0][0].commentId).toBe(id(9))
})
