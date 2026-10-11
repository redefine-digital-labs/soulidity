import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import type { PublicCommunityDocumentRef } from './community-document-read'
import { assertWalletProfileDeployment, readWalletProfile,
  type WalletProfileDeployment, type WalletProfileReadClient, type WalletProfileSnapshot } from './wallet-profile'

export interface PublicCommunityDeployment { profile: WalletProfileDeployment; registryId: string }
export interface PublicCommunityReadClient {
  core: WalletProfileReadClient
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject'>
}
export interface PublicCommunityCommentSnapshot {
  id: string; registryId: string; profileRegistryId: string; postId: string
  author: WalletProfileSnapshot; index: string; document: PublicCommunityDocumentRef
  createdAtMs: string; objectVersion: string; objectDigest: string
}
export interface PublicCommunityPostSnapshot {
  id: string; registryId: string; profileRegistryId: string; author: WalletProfileSnapshot
  index: string; postType: 'log' | 'question' | 'knowledge'; channel: 'general' | 'questions'
  document: PublicCommunityDocumentRef; createdAtMs: string; updatedAtMs: string
  commentCount: string; commentsByIndexId: string; acceptedComment: PublicCommunityCommentSnapshot | null
  acceptanceRevision: string; objectVersion: string; objectDigest: string
  registryVersion: string; registryDigest: string; observedPostCount: string
}
const MAX_U64 = 18446744073709551615n
const TableBcs = bcs.struct('CommunityTable', { id: bcs.Address, size: bcs.u64() })
export const PublicDocumentRefV1Bcs = bcs.struct('PublicDocumentRefV1', {
  blob_object_id: bcs.Address, blob_id: bcs.vector(bcs.u8()), sha256: bcs.vector(bcs.u8()), byte_length: bcs.u64(),
})
export const CommunityRegistryV1Bcs = bcs.struct('CommunityRegistryV1', {
  id: bcs.Address, version: bcs.u64(), post_count: bcs.u64(), by_index: TableBcs,
})
export const PostV1Bcs = bcs.struct('PostV1', {
  id: bcs.Address, version: bcs.u64(), registry_id: bcs.Address, profile_registry_id: bcs.Address,
  author: bcs.Address, author_owner: bcs.Address, index: bcs.u64(), post_type: bcs.u8(), channel: bcs.u8(),
  document: PublicDocumentRefV1Bcs, created_at_ms: bcs.u64(), updated_at_ms: bcs.u64(), comment_count: bcs.u64(),
  comments_by_index: TableBcs, accepted_comment_id: bcs.option(bcs.Address), acceptance_revision: bcs.u64(),
})
export const CommentV1Bcs = bcs.struct('CommentV1', {
  id: bcs.Address, version: bcs.u64(), registry_id: bcs.Address, profile_registry_id: bcs.Address,
  post_id: bcs.Address, author: bcs.Address, author_owner: bcs.Address, index: bcs.u64(),
  document: PublicDocumentRefV1Bcs, created_at_ms: bcs.u64(),
})
const IndexFieldBcs = bcs.struct('CommunityIndexField', { id: bcs.Address, name: bcs.u64(), value: bcs.Address })
type Raw = NonNullable<Awaited<ReturnType<PublicCommunityReadClient['ledgerService']['getObject']>>['response']['object']>
type Post = ReturnType<typeof PostV1Bcs.parse>
type Registry = ReturnType<typeof CommunityRegistryV1Bcs.parse>
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'COMMUNITY_INVALID_ID')
}
function distinct(values: string[]) {
  values.forEach(id); check(new Set(values).size === values.length, 'COMMUNITY_NAMESPACE_MISMATCH')
}
export function assertPublicCommunityDeployment(input: PublicCommunityDeployment): PublicCommunityDeployment {
  const value = structuredClone(input)
  check(value && typeof value === 'object', 'COMMUNITY_DEPLOYMENT_REQUIRED')
  const profile = assertWalletProfileDeployment(value.profile)
  distinct([value.registryId, profile.registryId])
  return { profile, registryId: value.registryId }
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'COMMUNITY_INVALID_DIGEST')
}
function bytes(raw: Raw | undefined, objectId: string, type: string) {
  check(raw?.objectId === objectId && raw.objectType === type && typeof raw.version === 'bigint'
    && raw.version > 0n && raw.version <= MAX_U64, 'COMMUNITY_OBJECT_IDENTITY_MISMATCH')
  digest(raw.digest)
  check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0
    && raw.contents.value.length <= 2048, 'COMMUNITY_OBJECT_CONTENT_INVALID')
  return raw.contents.value
}
function shared(raw: Raw) {
  check(raw.owner?.kind === 3 && typeof raw.owner.version === 'bigint'
    && raw.owner.version > 0n && raw.owner.version <= raw.version!, 'COMMUNITY_OBJECT_NOT_SHARED')
}
function exact(original: Uint8Array, serialized: Uint8Array) {
  check(toBase64(original) === toBase64(serialized), 'COMMUNITY_NONCANONICAL_BCS')
}
function stamp(raw: Raw) {
  return `${raw.version}:${raw.digest}:${raw.owner?.kind}:${raw.owner?.version}:${toBase64(raw.contents!.value!)}`
}
async function object(client: PublicCommunityReadClient, objectId: string, signal: AbortSignal): Promise<Raw> {
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
    readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
  check(response.object, 'COMMUNITY_OBJECT_RESPONSE_MISSING')
  // Capture transport-owned bytes before another awaited operation.
  return structuredClone(response.object)
}
async function registry(client: PublicCommunityReadClient, deployment: PublicCommunityDeployment, signal: AbortSignal) {
  const raw = await object(client, deployment.registryId, signal)
  const content = bytes(raw, deployment.registryId, `${deployment.profile.originalPackageId}::community_posts::CommunityRegistryV1`)
  shared(raw)
  const value = CommunityRegistryV1Bcs.parse(content); exact(content, CommunityRegistryV1Bcs.serialize(value).toBytes())
  check(value.id === deployment.registryId && value.version === '1', 'COMMUNITY_REGISTRY_MISMATCH')
  distinct([value.id, deployment.profile.registryId, value.by_index.id])
  check(value.post_count === value.by_index.size, 'COMMUNITY_REGISTRY_COUNT_MISMATCH')
  return { raw, value }
}
async function membership(client: PublicCommunityReadClient, parent: string, index: string, expected: string, signal: AbortSignal) {
  check(await indexEntry(client, parent, index, signal) === expected, 'COMMUNITY_FIELD_CONTENT_MISMATCH')
}
async function indexEntry(client: PublicCommunityReadClient, parent: string, index: string, signal: AbortSignal) {
  const fieldId = deriveDynamicFieldID(parent, 'u64', bcs.u64().serialize(index).toBytes())
  const raw = await object(client, fieldId, signal)
  const content = bytes(raw, fieldId, normalizeStructTag('0x2::dynamic_field::Field<u64,0x2::object::ID>'))
  check(raw.owner?.kind === 2 && raw.owner.address === parent, 'COMMUNITY_FIELD_OWNER_MISMATCH')
  const field = IndexFieldBcs.parse(content); exact(content, IndexFieldBcs.serialize(field).toBytes())
  check(field.id === fieldId && field.name === index, 'COMMUNITY_FIELD_CONTENT_MISMATCH')
  id(field.value)
  return field.value
}
function document(value: ReturnType<typeof PublicDocumentRefV1Bcs.parse>): PublicCommunityDocumentRef {
  id(value.blob_object_id)
  check(value.blob_id.length === 32 && value.sha256.length === 32 && BigInt(value.byte_length) > 0n, 'COMMUNITY_DOCUMENT_REF_INVALID')
  return { blobObjectId: value.blob_object_id, blobId: toBase64(new Uint8Array(value.blob_id)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    sha256: toHex(new Uint8Array(value.sha256)), byteLength: value.byte_length }
}
async function author(client: PublicCommunityReadClient, deployment: PublicCommunityDeployment, profileId: string, owner: string, signal: AbortSignal) {
  id(profileId); id(owner)
  const profile = await readWalletProfile({ client: client.core, deployment: deployment.profile, profileId, signal })
  check(profile.owner === owner, 'COMMUNITY_AUTHOR_OWNER_MISMATCH')
  return profile
}
async function post(client: PublicCommunityReadClient, deployment: PublicCommunityDeployment, root: Registry, postId: string, signal: AbortSignal) {
  const raw = await object(client, postId, signal)
  const content = bytes(raw, postId, `${deployment.profile.originalPackageId}::community_posts::PostV1`); shared(raw)
  const value = PostV1Bcs.parse(content); exact(content, PostV1Bcs.serialize(value).toBytes())
  check(value.id === postId && value.version === '1' && value.registry_id === root.id
    && value.profile_registry_id === deployment.profile.registryId, 'COMMUNITY_POST_IDENTITY_MISMATCH')
  distinct([root.id, deployment.profile.registryId, root.by_index.id, postId, value.comments_by_index.id, value.author])
  check(BigInt(value.index) < BigInt(root.post_count) && value.comment_count === value.comments_by_index.size,
    'COMMUNITY_POST_COUNT_MISMATCH')
  check(value.post_type <= 2 && value.channel <= 1, 'COMMUNITY_POST_CATEGORY_INVALID')
  check(BigInt(value.updated_at_ms) >= BigInt(value.created_at_ms)
    && (value.comment_count !== '0' || value.created_at_ms === value.updated_at_ms), 'COMMUNITY_POST_TIME_INVALID')
  check(value.accepted_comment_id === null ? value.acceptance_revision === '0'
    : value.post_type === 1 && value.acceptance_revision !== '0' && value.comment_count !== '0', 'COMMUNITY_ACCEPTANCE_INVALID')
  document(value.document)
  await membership(client, root.by_index.id, value.index, postId, signal)
  return { raw, value }
}
async function comment(client: PublicCommunityReadClient, deployment: PublicCommunityDeployment, root: Registry,
  parent: Post, commentId: string, signal: AbortSignal): Promise<PublicCommunityCommentSnapshot> {
  id(commentId)
  const raw = await object(client, commentId, signal)
  const content = bytes(raw, commentId, `${deployment.profile.originalPackageId}::community_posts::CommentV1`)
  check(raw.owner?.kind === 4, 'COMMUNITY_COMMENT_NOT_IMMUTABLE')
  const value = CommentV1Bcs.parse(content); exact(content, CommentV1Bcs.serialize(value).toBytes())
  check(value.id === commentId && value.version === '1' && value.registry_id === root.id
    && value.profile_registry_id === deployment.profile.registryId && value.post_id === parent.id,
  'COMMUNITY_COMMENT_IDENTITY_MISMATCH')
  distinct([root.id, deployment.profile.registryId, root.by_index.id, parent.id, parent.comments_by_index.id, value.author, commentId])
  check(BigInt(value.index) < BigInt(parent.comment_count), 'COMMUNITY_COMMENT_INDEX_OUT_OF_RANGE')
  check(BigInt(value.created_at_ms) >= BigInt(parent.created_at_ms) && BigInt(value.created_at_ms) <= BigInt(parent.updated_at_ms)
    && (BigInt(value.index) + 1n !== BigInt(parent.comment_count) || value.created_at_ms === parent.updated_at_ms),
    'COMMUNITY_COMMENT_TIME_INVALID')
  const ref = document(value.document)
  await membership(client, parent.comments_by_index.id, value.index, commentId, signal)
  return { id: value.id, registryId: value.registry_id, profileRegistryId: value.profile_registry_id, postId: value.post_id,
    author: await author(client, deployment, value.author, value.author_owner, signal), index: value.index,
    document: ref, createdAtMs: value.created_at_ms, objectVersion: String(raw.version), objectDigest: raw.digest! }
}
type ReadParams = { client: PublicCommunityReadClient; deployment: PublicCommunityDeployment; postId: string; signal?: AbortSignal }
async function read(params: ReadParams, requestedCommentId?: string) {
  const deployment = assertPublicCommunityDeployment(params.deployment)
  const { client, postId } = params; id(postId); if (requestedCommentId !== undefined) id(requestedCommentId)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier({ signal }))
  digest(chainIdentifier)
  check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === deployment.profile.chainIdentifier, 'COMMUNITY_WRONG_CHAIN')
  const start = await registry(client, deployment, signal)
  const entry = await post(client, deployment, start.value, postId, signal), value = entry.value
  const identity = await author(client, deployment, value.author, value.author_owner, signal)
  const requested = requestedCommentId ? await comment(client, deployment, start.value, value, requestedCommentId, signal) : null
  const accepted = value.accepted_comment_id === null ? null : value.accepted_comment_id === requested?.id ? requested
    : await comment(client, deployment, start.value, value, value.accepted_comment_id, signal)
  const endPost = await post(client, deployment, start.value, postId, signal)
  const end = await registry(client, deployment, signal)
  check(stamp(entry.raw) === stamp(endPost.raw) && stamp(start.raw) === stamp(end.raw), 'COMMUNITY_CHANGED_RETRY')
  signal.throwIfAborted()
  const snapshot: PublicCommunityPostSnapshot = { id: postId, registryId: value.registry_id, profileRegistryId: value.profile_registry_id,
    author: identity, index: value.index, postType: (['log', 'question', 'knowledge'] as const)[value.post_type],
    channel: (['general', 'questions'] as const)[value.channel], document: document(value.document),
    createdAtMs: value.created_at_ms, updatedAtMs: value.updated_at_ms, commentCount: value.comment_count,
    commentsByIndexId: value.comments_by_index.id, acceptedComment: accepted, acceptanceRevision: value.acceptance_revision,
    objectVersion: String(entry.raw.version), objectDigest: entry.raw.digest!, registryVersion: String(start.raw.version),
    registryDigest: start.raw.digest!, observedPostCount: start.value.post_count }
  return { post: snapshot, comment: requested }
}
/** Exact-ID bounded read. This verifies chain references, not Walrus availability or document bytes. */
export async function readPublicCommunityPost(params: ReadParams): Promise<PublicCommunityPostSnapshot> {
  return (await read(params)).post
}
/** Includes the verified parent authority; acceptance is derived only from that Post. */
export async function readPublicCommunityComment(params: ReadParams & { commentId: string }): Promise<{
  comment: PublicCommunityCommentSnapshot; post: PublicCommunityPostSnapshot; accepted: boolean
}> {
  const result = await read(params, params.commentId)
  return { comment: result.comment!, post: result.post, accepted: result.post.acceptedComment?.id === result.comment!.id }
}

export interface PublicCommunityDirectoryEntry { id: string; index: string }
export interface PublicCommunityDirectoryPage {
  entries: PublicCommunityDirectoryEntry[]
  /** Current on-chain count; may exceed an earlier page's captured upperBound. */
  observedCount: string
  /** Pass unchanged with the same deployment/parent to keep the creation-order window. */
  upperBound: string
  nextIndex: string | null
  /** This page alone does not cover all currently observed directory entries. */
  partial: boolean
  registryVersion: string
  registryDigest: string
}
export interface PublicCommunityDirectoryParams {
  client: PublicCommunityReadClient; deployment: PublicCommunityDeployment
  startIndex?: string; upperBound?: string; limit?: number; signal?: AbortSignal
}
function requireU64(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= MAX_U64, 'COMMUNITY_INVALID_U64')
}
function directoryParams(params: PublicCommunityDirectoryParams, maximum: number) {
  const deployment = assertPublicCommunityDeployment(params.deployment)
  const { client, startIndex = '0', upperBound, limit = maximum } = params
  requireU64(startIndex); if (upperBound !== undefined) requireU64(upperBound)
  check(Number.isInteger(limit) && limit >= 1 && limit <= maximum, 'COMMUNITY_INVALID_PAGE_LIMIT')
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  return { deployment, client, startIndex, upperBound, limit, signal }
}
async function directoryChain(client: PublicCommunityReadClient, deployment: PublicCommunityDeployment, signal: AbortSignal) {
  const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier({ signal }))
  digest(chainIdentifier)
  check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === deployment.profile.chainIdentifier, 'COMMUNITY_WRONG_CHAIN')
}
async function directoryEntries(client: PublicCommunityReadClient, tableId: string, observedCount: string,
  startIndex: string, requestedUpperBound: string | undefined, limit: number, reserved: string[], signal: AbortSignal) {
  const start = BigInt(startIndex), upperBound = requestedUpperBound ?? observedCount
  const upper = BigInt(upperBound), count = BigInt(observedCount)
  check(start <= upper && upper <= count, 'COMMUNITY_PAGE_OUT_OF_RANGE')
  const end = start + BigInt(limit) < upper ? start + BigInt(limit) : upper
  const entries: PublicCommunityDirectoryEntry[] = []
  // Fixed-size concurrency keeps a 200-comment directory from spawning 200 RPCs.
  for (let offset = start; offset < end; offset += 8n) {
    const indices: bigint[] = []
    for (let index = offset; index < end && index < offset + 8n; index++) indices.push(index)
    entries.push(...await Promise.all(indices.map(async index => ({ index: String(index),
      id: await indexEntry(client, tableId, String(index), signal) }))))
  }
  check(new Set(entries.map(entry => entry.id)).size === entries.length, 'COMMUNITY_DUPLICATE_DIRECTORY_ENTRY')
  check(entries.every(entry => !reserved.includes(entry.id)), 'COMMUNITY_NAMESPACE_MISMATCH')
  signal.throwIfAborted()
  return { entries, observedCount, upperBound, nextIndex: end < upper ? String(end) : null,
    partial: start !== 0n || end < count }
}

/** Bounded creation-order IDs only, not hydrated Posts or a complete sorted feed.
 * Missing rows fail. Supply upperBound from page one when continuing a scan. */
export async function readPublicCommunityPostDirectory(params: PublicCommunityDirectoryParams): Promise<PublicCommunityDirectoryPage> {
  const { deployment, client, startIndex, upperBound, limit, signal } = directoryParams(params, 30)
  await directoryChain(client, deployment, signal)
  const start = await registry(client, deployment, signal)
  const page = await directoryEntries(client, start.value.by_index.id, start.value.post_count, startIndex, upperBound,
    limit, [start.value.id, deployment.profile.registryId, start.value.by_index.id], signal)
  const end = await registry(client, deployment, signal)
  check(stamp(start.raw) === stamp(end.raw), 'COMMUNITY_CHANGED_RETRY')
  signal.throwIfAborted()
  return { ...page, registryVersion: String(start.raw.version), registryDigest: start.raw.digest! }
}

/** Bounded creation-order Comment IDs under a verified Post. No comment content
 * or independent accepted flag is inferred from directory membership. */
export async function readPublicCommunityCommentDirectory(params: PublicCommunityDirectoryParams & { postId: string }): Promise<
  PublicCommunityDirectoryPage & { postId: string; postVersion: string; postDigest: string }
> {
  const { deployment, client, startIndex, upperBound, limit, signal } = directoryParams(params, 200)
  const { postId } = params; id(postId)
  await directoryChain(client, deployment, signal)
  const start = await registry(client, deployment, signal)
  const entry = await post(client, deployment, start.value, postId, signal)
  await author(client, deployment, entry.value.author, entry.value.author_owner, signal)
  const page = await directoryEntries(client, entry.value.comments_by_index.id, entry.value.comment_count, startIndex, upperBound,
    limit, [start.value.id, deployment.profile.registryId, start.value.by_index.id, postId, entry.value.comments_by_index.id,
      entry.value.author], signal)
  const endPost = await post(client, deployment, start.value, postId, signal)
  const end = await registry(client, deployment, signal)
  check(stamp(start.raw) === stamp(end.raw) && stamp(entry.raw) === stamp(endPost.raw), 'COMMUNITY_CHANGED_RETRY')
  signal.throwIfAborted()
  return { ...page, registryVersion: String(start.raw.version), registryDigest: start.raw.digest!,
    postId, postVersion: String(entry.raw.version), postDigest: entry.raw.digest! }
}
