import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, fromHex } from '@mysten/sui/utils'
import { COMMUNITY_DOCUMENT_MAX_BYTES } from './community-document'
import { assertPublicCommunityDocumentRef, type PublicCommunityDocumentRef } from './community-document-read'
import { assertPublicCommunityDeployment, type PublicCommunityDeployment,
  type PublicCommunityPostSnapshot } from './community-posts-read'

interface PublicCommunityAuthorIntent {
  deployment: PublicCommunityDeployment
  owner: string
  authorId: string
}
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`COMMUNITY_WRITE_${code}`)
}
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
function author(params: PublicCommunityAuthorIntent) {
  const deployment = assertPublicCommunityDeployment(params.deployment)
  id(params.owner); id(params.authorId)
  return deployment
}
function document(input: PublicCommunityDocumentRef) {
  // The shared reference validator checks canonical base64url, IDs and positive
  // u64 length; require a string hash explicitly before its regex validation.
  check(input && typeof input.sha256 === 'string', 'DOCUMENT_HASH_INVALID')
  const ref = assertPublicCommunityDocumentRef(input)
  check(BigInt(ref.byteLength) <= BigInt(COMMUNITY_DOCUMENT_MAX_BYTES), 'DOCUMENT_BYTE_LIMIT')
  return ref
}
function documentArgs(tx: Transaction, ref: PublicCommunityDocumentRef) {
  return [tx.pure.id(ref.blobObjectId),
    tx.pure.vector('u8', [...fromBase64(ref.blobId.replaceAll('-', '+').replaceAll('_', '/') + '=')]),
    tx.pure.vector('u8', [...fromHex(ref.sha256)]), tx.pure.u64(ref.byteLength)]
}

/** Build only: the caller must authenticate the certified, unexpired Walrus
 * Blob and exact public-post document bytes before signing. A valid reference
 * is a commitment, not proof of storage, authorship or deployment identity. */
export function buildCreatePublicCommunityPostTx(params: PublicCommunityAuthorIntent & {
  postType: PublicCommunityPostSnapshot['postType']
  channel: PublicCommunityPostSnapshot['channel']
  document: PublicCommunityDocumentRef
}): Transaction {
  const deployment = author(params), ref = document(params.document)
  check(params.postType === 'log' || params.postType === 'question' || params.postType === 'knowledge', 'POST_TYPE_INVALID')
  check(params.channel === 'general' || params.channel === 'questions', 'CHANNEL_INVALID')
  const postType = params.postType === 'log' ? 0 : params.postType === 'question' ? 1 : 2
  const tx = new Transaction(); tx.setSender(params.owner)
  tx.moveCall({ target: `${deployment.profile.callablePackageId}::community_posts::create_post`, arguments: [
    tx.object(deployment.registryId), tx.object(deployment.profile.registryId), tx.pure.id(params.authorId),
    tx.pure.u8(postType), tx.pure.u8(params.channel === 'general' ? 0 : 1), ...documentArgs(tx, ref), tx.object('0x6'),
  ] })
  return tx
}

/** Same storage verification requirement as post creation, for the exact
 * public-comment schema. Parent membership/author authority are enforced by Move. */
export function buildCreatePublicCommunityCommentTx(params: PublicCommunityAuthorIntent & {
  postId: string; document: PublicCommunityDocumentRef
}): Transaction {
  const deployment = author(params), ref = document(params.document)
  id(params.postId)
  const tx = new Transaction(); tx.setSender(params.owner)
  tx.moveCall({ target: `${deployment.profile.callablePackageId}::community_posts::create_comment`, arguments: [
    tx.object(deployment.registryId), tx.object(deployment.profile.registryId), tx.object(params.postId),
    tx.pure.id(params.authorId), ...documentArgs(tx, ref), tx.object('0x6'),
  ] })
  return tx
}

/** Explicit desired answer plus the observed CAS revision. Move checks author,
 * question type and parent membership. MAX_U64 remains legal for its idempotent
 * same-answer path; changing an exhausted revision is rejected on chain. */
export function buildAcceptPublicCommunityAnswerTx(params: PublicCommunityAuthorIntent & {
  postId: string; commentId: string; expectedRevision: string
}): Transaction {
  const deployment = author(params)
  id(params.postId); id(params.commentId)
  check(typeof params.expectedRevision === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(params.expectedRevision)
    && BigInt(params.expectedRevision) <= MAX_U64, 'REVISION_INVALID')
  const tx = new Transaction(); tx.setSender(params.owner)
  tx.moveCall({ target: `${deployment.profile.callablePackageId}::community_posts::accept_answer`, arguments: [
    tx.object(deployment.registryId), tx.object(deployment.profile.registryId), tx.object(params.postId),
    tx.object(params.commentId), tx.pure.id(params.authorId), tx.pure.u64(params.expectedRevision),
  ] })
  return tx
}
