import { describe, expect, it } from 'vitest'
import { createPublicCommunityPublishIntent, publicCommunityPublishCommitment, publicCommunityPublishKey,
  validatePublicCommunityUploadReceipt, type PublicCommunityPublishIntent } from '../../packages/soulidity-sdk/src/community-publish-intent'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const intent = (): PublicCommunityPublishIntent => ({
  deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '35834a8a' }, registryId: id(4) },
  owner: id(5), authorId: id(6), operationId: 'a'.repeat(32), kind: 'post', postType: 1, channel: 1,
  document: { schema: 'soulidity.public-post.v1', title: 'Question', content: 'Body', tags: ['A', 'a'] },
})
async function receipt(i = intent()) {
  const c = await publicCommunityPublishCommitment(i)
  return { schema: 'soulidity.community-upload.v1' as const, intentHash: c.intentHash,
    reference: { blobObjectId: id(7), blobId: 'A'.repeat(43), sha256: c.contentHash, byteLength: String(c.bytes.length) } }
}
describe('frozen community publication intent', () => {
  it('captures document before awaits and rejects mutation of the caller draft', async () => {
    const source = intent(), pending = publicCommunityPublishCommitment(source)
    source.document.content = 'changed'
    const result = await pending
    expect(result.intent.document.content).toBe('Body')
    expect(new TextDecoder().decode(result.bytes)).toContain('Body')
  })
  it('canonicalizes property ordering but not published text', async () => {
    const i = intent(), reordered = Object.fromEntries(Object.entries(i).reverse()) as PublicCommunityPublishIntent
    expect((await publicCommunityPublishCommitment(i)).intentHash).toBe((await publicCommunityPublishCommitment(reordered)).intentHash)
    i.document.content = ' Body '
    expect(() => createPublicCommunityPublishIntent(i)).toThrow('NONCANONICAL')
  })
  it('validates exact receipt content without claiming certification', async () => {
    const r = await receipt()
    expect(await validatePublicCommunityUploadReceipt(intent(), r)).toEqual(r)
  })
  it.each(['owner', 'authorId', 'operationId', 'document', 'deployment', 'postType', 'channel'])('binds receipt to %s', async field => {
    const i = intent(), r = await receipt(i)
    if (field === 'owner' || field === 'authorId') i[field] = id(8)
    else if (field === 'operationId') i.operationId = 'b'.repeat(32)
    else if (field === 'document') i.document.content = 'Different'
    else if (field === 'deployment') i.deployment.profile.callablePackageId = id(9)
    else if (i.kind === 'post' && field === 'postType') i.postType = 0
    else if (i.kind === 'post') i.channel = 0
    await expect(validatePublicCommunityUploadReceipt(i, r)).rejects.toThrow('SCOPE_MISMATCH')
  })
  it.each(['sha256', 'byteLength'])('rejects receipt %s mismatch', async field => {
    const r = await receipt()
    if (field === 'sha256') r.reference.sha256 = '0'.repeat(64)
    else r.reference.byteLength = '1'
    await expect(validatePublicCommunityUploadReceipt(intent(), r)).rejects.toThrow('CONTENT_MISMATCH')
  })
  it.each(['originalPackageId', 'registryId', 'chainIdentifier', 'communityRegistry'])('binds deployment %s', async field => {
    const i = intent(), r = await receipt(i)
    if (field === 'communityRegistry') i.deployment.registryId = id(10)
    else if (field === 'chainIdentifier') i.deployment.profile.chainIdentifier = '4c78adac'
    else if (field === 'originalPackageId') i.deployment.profile.originalPackageId = id(10)
    else i.deployment.profile.registryId = id(10)
    await expect(validatePublicCommunityUploadReceipt(i, r)).rejects.toThrow('SCOPE_MISMATCH')
  })
  it('binds comment parent and prevents post document substitution', async () => {
    const { deployment, owner, authorId, operationId } = intent()
    const i: PublicCommunityPublishIntent = { deployment, owner, authorId, operationId, kind: 'comment', postId: id(8),
      document: { schema: 'soulidity.public-comment.v1', content: 'Reply' } }
    const r = await receipt(i)
    await expect(validatePublicCommunityUploadReceipt(i, await receipt())).rejects.toThrow('SCOPE_MISMATCH')
    i.postId = id(9)
    await expect(validatePublicCommunityUploadReceipt(i, r)).rejects.toThrow('SCOPE_MISMATCH')
    expect(() => createPublicCommunityPublishIntent({ ...i, document: intent().document } as PublicCommunityPublishIntent)).toThrow('COMMENT_INVALID')
  })
  it('keys exact release, wallet and distinct logical publications', () => {
    const i = intent(), key = publicCommunityPublishKey(i)
    i.operationId = 'b'.repeat(32); expect(publicCommunityPublishKey(i)).not.toBe(key)
    i.operationId = 'a'.repeat(32); i.deployment.profile.callablePackageId = id(9)
    expect(publicCommunityPublishKey(i)).not.toBe(key)
  })
  it.each([
    { extra: 'secret' }, { operationId: '' }, { owner: '0x5' }, { postType: 3 }, { channel: 2 },
    { document: { schema: 'soulidity.public-comment.v1', content: 'wrong' } },
  ])('rejects invalid intent %j', change => {
    expect(() => createPublicCommunityPublishIntent({ ...intent(), ...change } as PublicCommunityPublishIntent)).toThrow()
  })
  it('rejects hidden fields in release and receipt', async () => {
    const i = intent()
    Object.assign(i.deployment.profile, { secret: 'not public' })
    expect(() => createPublicCommunityPublishIntent(i)).toThrow('FIELDS_INVALID')
    const r = await receipt(); Object.assign(r.reference, { private: true })
    await expect(validatePublicCommunityUploadReceipt(intent(), r)).rejects.toThrow('FIELDS_INVALID')
  })
})
