import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { COMMUNITY_DOCUMENT_MAX_BYTES } from '../../packages/soulidity-sdk/src/community-document'
import { buildAcceptPublicCommunityAnswerTx, buildCreatePublicCommunityCommentTx,
  buildCreatePublicCommunityPostTx } from '../../packages/soulidity-sdk/src/community-posts-write'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const blobBytes = Uint8Array.from({ length: 32 }, (_, index) => index * 7 + 1)
const hashBytes = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
const intent = () => ({
  deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3),
    chainIdentifier: '01010101' }, registryId: id(4) },
  owner: id(10), authorId: id(11), postId: id(12), commentId: id(13), expectedRevision: '0',
  postType: 'log' as const, channel: 'general' as const,
  document: { blobObjectId: id(14), blobId: toBase64(blobBytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    sha256: [...hashBytes].map(value => value.toString(16).padStart(2, '0')).join(''), byteLength: '1234' },
})
type Data = ReturnType<Transaction['getData']>
function pure(tx: Data, index: number) { return fromBase64(tx.inputs[index].Pure!.bytes) }
function call(tx: Data, name: string, length: number) {
  expect(tx.sender).toBe(id(10))
  expect(tx.commands).toHaveLength(1)
  expect(tx.inputs).toHaveLength(length)
  expect(tx.commands[0].MoveCall).toMatchObject({ package: id(2), module: 'community_posts', function: name, typeArguments: [] })
  expect(tx.commands[0].MoveCall!.arguments.map(value => value.Input)).toEqual(Array.from({ length }, (_, index) => index))
  expect(tx.inputs.slice(0, 2).map(value => value.UnresolvedObject?.objectId)).toEqual([id(4), id(3)])
  // A Blob commitment is passed as a pure ID, never as a storage certificate object.
  expect(tx.inputs.filter(value => value.UnresolvedObject?.objectId === id(14))).toHaveLength(0)
}
function ref(tx: Data, offset: number, byteLength = '1234') {
  expect(bcs.Address.parse(pure(tx, offset))).toBe(id(14))
  expect(bcs.vector(bcs.u8()).parse(pure(tx, offset + 1))).toEqual([...blobBytes])
  expect(bcs.vector(bcs.u8()).parse(pure(tx, offset + 2))).toEqual([...hashBytes])
  expect(bcs.u64().parse(pure(tx, offset + 3))).toBe(byteLength)
}
it.each(['log', 'question', 'knowledge'] as const)('maps %s and both channels to the exact create_post ABI', postType => {
  for (const channel of ['general', 'questions'] as const) {
    const tx = buildCreatePublicCommunityPostTx({ ...intent(), postType, channel }).getData()
    call(tx, 'create_post', 10)
    expect(bcs.Address.parse(pure(tx, 2))).toBe(id(11))
    expect(bcs.u8().parse(pure(tx, 3))).toBe(['log', 'question', 'knowledge'].indexOf(postType))
    expect(bcs.u8().parse(pure(tx, 4))).toBe(channel === 'general' ? 0 : 1)
    ref(tx, 5)
    expect(tx.inputs[9].UnresolvedObject?.objectId).toBe(id(6))
  }
})
it('builds exactly the create_comment ABI including parent, pure author and clock', () => {
  const tx = buildCreatePublicCommunityCommentTx(intent()).getData()
  call(tx, 'create_comment', 9)
  expect(tx.inputs[2].UnresolvedObject?.objectId).toBe(id(12))
  expect(bcs.Address.parse(pure(tx, 3))).toBe(id(11))
  ref(tx, 4)
  expect(tx.inputs[8].UnresolvedObject?.objectId).toBe(id(6))
})
it.each(['0', '9007199254740993', '18446744073709551615'])('builds accept_answer with exact revision %s and no clock', expectedRevision => {
  const tx = buildAcceptPublicCommunityAnswerTx({ ...intent(), expectedRevision }).getData()
  call(tx, 'accept_answer', 6)
  expect(tx.inputs.slice(2, 4).map(value => value.UnresolvedObject?.objectId)).toEqual([id(12), id(13)])
  expect(bcs.Address.parse(pure(tx, 4))).toBe(id(11))
  expect(bcs.u64().parse(pure(tx, 5))).toBe(expectedRevision)
})
it.each(['-1', '01', '+1', '1.0', ' 1', '1 ', '', '18446744073709551616', 1, 1n, null, undefined])('rejects noncanonical/out-of-range revision %s', expectedRevision => {
  expect(() => buildAcceptPublicCommunityAnswerTx({ ...intent(), expectedRevision: expectedRevision as any })).toThrow('REVISION_INVALID')
})
it.each(['owner', 'authorId', 'postId', 'commentId'] as const)('rejects noncanonical %s before Sui normalization', field => {
  for (const invalid of [id(0), '0x1', id(15).toUpperCase(), '0x' + 'G'.repeat(64), null, 1]) {
    const input = { ...intent(), [field]: invalid }
    expect(() => buildAcceptPublicCommunityAnswerTx(input as any)).toThrow('INVALID_ID')
    if (field !== 'commentId') expect(() => buildCreatePublicCommunityCommentTx(input as any)).toThrow('INVALID_ID')
    if (field === 'owner' || field === 'authorId') expect(() => buildCreatePublicCommunityPostTx(input as any)).toThrow('INVALID_ID')
  }
})
it.each(['originalPackageId', 'callablePackageId', 'registryId'] as const)('validates deployment profile %s', field => {
  const input = intent(); input.deployment.profile[field] = '0x1'
  for (const build of [buildCreatePublicCommunityPostTx, buildCreatePublicCommunityCommentTx, buildAcceptPublicCommunityAnswerTx]) {
    expect(() => build(input)).toThrow('INVALID_ID')
  }
})
it('rejects aliased registries and malformed network selection', () => {
  const input = intent(); input.deployment.registryId = input.deployment.profile.registryId
  expect(() => buildCreatePublicCommunityPostTx(input)).toThrow('NAMESPACE_MISMATCH')
  input.deployment.registryId = id(4); input.deployment.profile.chainIdentifier = 'invalid'
  expect(() => buildCreatePublicCommunityPostTx(input)).toThrow('INVALID_CHAIN')
})
it.each([0, 1, 2, 'toString', 'constructor', '', 'Question', null, true])('rejects unknown post type %s', postType => {
  expect(() => buildCreatePublicCommunityPostTx({ ...intent(), postType: postType as any })).toThrow('POST_TYPE_INVALID')
})
it.each([0, 1, 'toString', 'constructor', '', 'General', null, true])('rejects unknown channel %s', channel => {
  expect(() => buildCreatePublicCommunityPostTx({ ...intent(), channel: channel as any })).toThrow('CHANNEL_INVALID')
})
it.each([
  ['blobObjectId', id(0)], ['blobObjectId', '0x1'],
  ['blobId', 'A'.repeat(42)], ['blobId', 'A'.repeat(44)], ['blobId', 'A'.repeat(42) + 'B'],
  ['blobId', '='.repeat(43)], ['blobId', '+'.repeat(43)], ['blobId', null],
  ['sha256', 'AA'.repeat(32)], ['sha256', '0x' + 'aa'.repeat(32)], ['sha256', 'aa'.repeat(31)],
  ['sha256', ['aa'.repeat(32)]], ['sha256', null],
  ['byteLength', '0'], ['byteLength', '01'], ['byteLength', '-1'], ['byteLength', '1.1'],
  ['byteLength', 1234], ['byteLength', '18446744073709551616'], ['byteLength', null],
])('rejects malformed document %s=%s for both write paths', (field, value) => {
  const input = intent(); (input.document as any)[field as string] = value
  expect(() => buildCreatePublicCommunityPostTx(input)).toThrow()
  expect(() => buildCreatePublicCommunityCommentTx(input)).toThrow()
})
it.each(['1', String(COMMUNITY_DOCUMENT_MAX_BYTES)])('retains positive document boundary %s exactly', byteLength => {
  const input = intent(); input.document.byteLength = byteLength
  ref(buildCreatePublicCommunityPostTx(input).getData(), 5, byteLength)
  ref(buildCreatePublicCommunityCommentTx(input).getData(), 4, byteLength)
})
it.each([String(COMMUNITY_DOCUMENT_MAX_BYTES + 1), '18446744073709551615'])('rejects a document beyond the reader limit %s', byteLength => {
  const input = intent(); input.document.byteLength = byteLength
  expect(() => buildCreatePublicCommunityPostTx(input)).toThrow('DOCUMENT_BYTE_LIMIT')
  expect(() => buildCreatePublicCommunityCommentTx(input)).toThrow('DOCUMENT_BYTE_LIMIT')
})
it('captures caller values without mutating inputs or retaining mutable reference bytes', () => {
  const input = intent(), before = structuredClone(input)
  const tx = buildCreatePublicCommunityPostTx(input)
  expect(input).toEqual(before)
  input.document.blobId = 'A'.repeat(43); input.document.sha256 = '00'.repeat(32)
  input.deployment.profile.callablePackageId = id(20); input.owner = id(21)
  call(tx.getData(), 'create_post', 10); ref(tx.getData(), 5)
})
