import { expect, it, vi } from 'vitest'
import { publicCommunityPublishCommitment, type PublicCommunityPublishIntent } from '../../packages/soulidity-sdk/src/community-publish-intent'
import { assertCommunityPublicationReady } from '../../web/lib/community/publication-preflight'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
async function fixture(kind: 'post' | 'comment' = 'post') {
  const deployment = { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) }
  const common = { deployment, owner: id(5), authorId: id(7), operationId: 'a'.repeat(32) }
  const intent: PublicCommunityPublishIntent = kind === 'post'
    ? { ...common, kind, postType: 0, channel: 0, document: { schema: 'soulidity.public-post.v1', title: 'Title', content: 'Body', tags: [] } }
    : { ...common, kind, postId: id(8), document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
  const c = await publicCommunityPublishCommitment(intent)
  const receipt = { schema: 'soulidity.community-upload.v1' as const, intentHash: c.intentHash,
    reference: { blobObjectId: id(9), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
  const config = { deployment, storage: { chainIdentifier: '35834a8a', blobType: `${id(10)}::blob::Blob`, aggregatorUrl: 'https://storage.example' } }
  const author = { id: id(7), owner: id(5), revision: '1' }, parent = { id: id(8), registryId: id(4), profileRegistryId: id(3), objectVersion: '1' }
  const profile = vi.fn(async () => structuredClone(author) as any)
  const post = vi.fn(async () => structuredClone(parent) as any)
  const reset = vi.fn(), state = vi.fn(async () => ({ committee: { epoch: 9 } }))
  const walrus = vi.fn(() => ({ reset, getBlobType: async () => config.storage.blobType, systemState: state }) as any)
  const document = vi.fn(async (input: any) => {
    await input.freshWalrusState(input.signal)
    return { document: structuredClone(c.intent.document), storageEndEpoch: 10 }
  })
  return { params: { client: { core: {} } as any, config, intent, receipt }, author, parent,
    profile, post, document, state, reset, walrus, dependencies: { profile, post, document, walrus } }
}
it.each(['post', 'comment'] as const)('checks certified %s, author and parent without a wallet operation', async kind => {
  const f = await fixture(kind)
  await assertCommunityPublicationReady(f.params, f.dependencies)
  expect(f.profile).toHaveBeenCalledTimes(2)
  expect(f.post).toHaveBeenCalledTimes(kind === 'post' ? 0 : 2)
  expect(f.reset).toHaveBeenCalledTimes(2)
  expect(f.walrus).toHaveBeenCalledWith(f.params.client)
})
it.each(['missing', 'wrong-owner', 'wrong-id'])('rejects %s author before content reads', async mode => {
  const f = await fixture()
  f.profile.mockResolvedValue(mode === 'missing' ? null : { ...f.author, [mode === 'wrong-owner' ? 'owner' : 'id']: id(99) })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('AUTHOR_CHANGED')
  expect(f.document).not.toHaveBeenCalled()
})
it('rejects author drift during download', async () => {
  const f = await fixture(), original = f.document.getMockImplementation()!
  f.document.mockImplementation(async input => { f.author.revision = '2'; return original(input) })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('AUTHOR_CHANGED')
})
it.each(['id', 'registryId', 'profileRegistryId'])('rejects mismatched parent %s', async field => {
  const f = await fixture('comment'); (f.parent as any)[field] = id(99)
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('PARENT_MISMATCH')
})
it('rejects parent drift during download', async () => {
  const f = await fixture('comment'), original = f.document.getMockImplementation()!
  f.document.mockImplementation(async input => { f.parent.objectVersion = '2'; return original(input) })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('PARENT_CHANGED_RETRY')
})
it('rejects storage expiring during final identity reread', async () => {
  const f = await fixture(); f.state.mockResolvedValueOnce({ committee: { epoch: 9 } }).mockResolvedValue({ committee: { epoch: 10 } })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('STORAGE_EXPIRED_OR_INVALID')
})
it('rejects epoch regression after the certified document read', async () => {
  const f = await fixture(); f.state.mockResolvedValueOnce({ committee: { epoch: 9 } }).mockResolvedValue({ committee: { epoch: 8 } })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('WALRUS_EPOCH_REGRESSION')
})
it('propagates certification or transport failure, never treating receipt as proof', async () => {
  const f = await fixture(); f.document.mockRejectedValue(new Error('uncertified'))
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('uncertified')
})
it('rejects downloaded content differing from frozen document', async () => {
  const f = await fixture(); f.document.mockResolvedValue({ document: { ...f.params.intent.document, content: 'Other' }, storageEndEpoch: 10 })
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow('DOCUMENT_MISMATCH')
})
it('captures mutable caller intent/receipt/config before awaits', async () => {
  const f = await fixture(), original = f.document.getMockImplementation()!
  f.document.mockImplementation(async input => {
    f.params.intent.document.content = 'Other'; f.params.receipt.reference.sha256 = '0'.repeat(64)
    f.params.config.storage.aggregatorUrl = 'https://other.example'
    return original(input)
  })
  await assertCommunityPublicationReady(f.params, f.dependencies)
  expect(f.document.mock.calls[0][0].storage.aggregatorUrl).toBe('https://storage.example')
})
it.each(['receipt', 'release', 'storage-chain'])('rejects mismatched %s before reads', async field => {
  const f = await fixture()
  if (field === 'receipt') f.params.receipt.intentHash = '0'.repeat(64)
  else if (field === 'storage-chain') f.params.config.storage.chainIdentifier = '4c78adac'
  else f.params.config = { ...f.params.config, deployment: { ...f.params.config.deployment, registryId: id(99) } }
  await expect(assertCommunityPublicationReady(f.params, f.dependencies)).rejects.toThrow()
  expect(f.profile).not.toHaveBeenCalled()
})
it('honors prior cancellation without reading', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort(new Error('cancelled'))
  await expect(assertCommunityPublicationReady({ ...f.params, signal: controller.signal }, f.dependencies)).rejects.toThrow('cancelled')
  expect(f.profile).not.toHaveBeenCalled()
})
