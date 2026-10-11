import { assertPublicCommunityDeployment, type PublicCommunityDeployment } from './community-posts-read'
import { encodePublicCommunityDocument, validatePublicCommunityDocument, type PublicPostDocument, type PublicCommentDocument } from './community-document'
import { assertPublicCommunityDocumentRef, type PublicCommunityDocumentRef } from './community-document-read'
import { toHex } from '@mysten/sui/utils'

type Common = { deployment: PublicCommunityDeployment; owner: string; authorId: string; operationId: string }
/** One explicitly started publication. Identical text may be published again,
 * but retrying an uncertain operation must retain this ID and frozen document. */
export type PublicCommunityPublishIntent = Common & (
  | { kind: 'post'; postType: 0 | 1 | 2; channel: 0 | 1; document: PublicPostDocument }
  | { kind: 'comment'; postId: string; document: PublicCommentDocument }
)
export interface PublicCommunityUploadReceipt {
  schema: 'soulidity.community-upload.v1'; intentHash: string; reference: PublicCommunityDocumentRef
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`COMMUNITY_PUBLISH_${message}`) }
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'FIELDS_INVALID')
}
function id(value: unknown) { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'ID_INVALID') }
export function createPublicCommunityPublishIntent(input: PublicCommunityPublishIntent): PublicCommunityPublishIntent {
  const value = structuredClone(input)
  check(value?.kind === 'post' || value?.kind === 'comment', 'KIND_INVALID')
  fields(value, ['deployment', 'owner', 'authorId', 'operationId', 'kind', 'document',
    ...(value.kind === 'post' ? ['postType', 'channel'] : ['postId'])])
  fields(value.deployment, ['profile', 'registryId'])
  fields(value.deployment.profile, ['originalPackageId', 'callablePackageId', 'registryId', 'chainIdentifier'])
  const deployment = assertPublicCommunityDeployment(value.deployment)
  id(value.owner); id(value.authorId)
  check(typeof value.operationId === 'string' && /^[0-9a-f]{32}$/.test(value.operationId), 'OPERATION_ID_INVALID')
  const document = validatePublicCommunityDocument(value.document)
  const common = { deployment, owner: value.owner, authorId: value.authorId, operationId: value.operationId }
  if (value.kind === 'post') {
    check(document.schema === 'soulidity.public-post.v1' && [0, 1, 2].includes(value.postType)
      && [0, 1].includes(value.channel), 'POST_INVALID')
    return { ...common, kind: 'post', postType: value.postType, channel: value.channel, document }
  }
  id(value.postId)
  check(document.schema === 'soulidity.public-comment.v1', 'COMMENT_INVALID')
  return { ...common, kind: 'comment', postId: value.postId, document }
}
export function publicCommunityPublishKey(input: PublicCommunityPublishIntent): string {
  const i = createPublicCommunityPublishIntent(input), p = i.deployment.profile
  return ['soulidity.community-publish.v1', p.chainIdentifier, p.originalPackageId, p.callablePackageId,
    p.registryId, i.deployment.registryId, i.owner, i.operationId].join(':')
}
/** Stable canonical bytes bind release, author, parent/type/channel and document
 * BEFORE any paid upload. A hash/receipt is not a storage certificate or auth. */
export async function publicCommunityPublishCommitment(input: PublicCommunityPublishIntent) {
  const intent = createPublicCommunityPublishIntent(input)
  const bytes = encodePublicCommunityDocument(intent.document)
  // The community codec already bounds the document at 1 MiB. Profile metadata
  // has a different 64 KiB limit and cannot hash this document or its envelope.
  const hash = async (value: Uint8Array) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))))
  return { intent, bytes, intentHash: await hash(new TextEncoder().encode(JSON.stringify(intent))),
    contentHash: await hash(bytes) }
}
export async function validatePublicCommunityUploadReceipt(input: PublicCommunityPublishIntent, receipt: PublicCommunityUploadReceipt) {
  const saved = structuredClone(receipt)
  fields(saved, ['schema', 'intentHash', 'reference'])
  fields(saved.reference, ['blobObjectId', 'blobId', 'sha256', 'byteLength'])
  const commitment = await publicCommunityPublishCommitment(input)
  check(saved.schema === 'soulidity.community-upload.v1' && saved.intentHash === commitment.intentHash, 'RECEIPT_SCOPE_MISMATCH')
  const reference = assertPublicCommunityDocumentRef(saved.reference)
  check(reference.sha256 === commitment.contentHash && reference.byteLength === String(commitment.bytes.length), 'RECEIPT_CONTENT_MISMATCH')
  return { schema: saved.schema, intentHash: saved.intentHash, reference }
}
