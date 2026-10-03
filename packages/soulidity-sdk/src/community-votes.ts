import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { readMyWalletProfile, type WalletProfileSnapshot } from './wallet-profile'
import { assertPublicCommunityDeployment, readPublicCommunityPost,
  type PublicCommunityDeployment, type PublicCommunityReadClient, type PublicCommunityPostSnapshot } from './community-posts-read'

export interface PublicCommunityVotesDeployment { community: PublicCommunityDeployment; registryId: string }
export interface PublicCommunityVotesSnapshot {
  post: PublicCommunityPostSnapshot; viewer: WalletProfileSnapshot | null
  /** Null means anonymous; a non-null address with null viewer means no registered profile. */
  viewerAddress: string | null
  upCount: string; downCount: string; score: string; state: 0 | 1 | 2; revision: string
  registryVersion: string; registryDigest: string
}
const MAX_U64 = 18446744073709551615n
const ID_TYPE = normalizeStructTag('0x2::object::ID')
const TableBcs = bcs.struct('VoteTable', { id: bcs.Address, size: bcs.u64() })
export const VoteRegistryV1Bcs = bcs.struct('VoteRegistryV1', {
  id: bcs.Address, version: bcs.u64(), counts: TableBcs, edges: TableBcs,
})
export const VoteCountsV1Bcs = bcs.struct('VoteCountsV1', { up_count: bcs.u64(), down_count: bcs.u64() })
export const VoteKeyV1Bcs = bcs.struct('VoteKeyV1', { actor: bcs.Address, post: bcs.Address })
export const VoteEdgeV1Bcs = bcs.struct('VoteEdgeV1', { state: bcs.u8(), revision: bcs.u64() })
const CountsFieldBcs = bcs.struct('VoteCountsField', { id: bcs.Address, name: bcs.Address, value: VoteCountsV1Bcs })
const EdgeFieldBcs = bcs.struct('VoteEdgeField', { id: bcs.Address, name: VoteKeyV1Bcs, value: VoteEdgeV1Bcs })
type Raw = NonNullable<Awaited<ReturnType<PublicCommunityReadClient['ledgerService']['getObject']>>['response']['object']>
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`COMMUNITY_VOTES_${message}`) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
function distinct(values: string[]) {
  values.forEach(id); check(new Set(values).size === values.length, 'NAMESPACE_MISMATCH')
}
export function assertPublicCommunityVotesDeployment(input: PublicCommunityVotesDeployment): PublicCommunityVotesDeployment {
  const value = structuredClone(input)
  check(value && typeof value === 'object', 'DEPLOYMENT_REQUIRED')
  const community = assertPublicCommunityDeployment(value.community)
  distinct([value.registryId, community.registryId, community.profile.registryId])
  return { community, registryId: value.registryId }
}
/** Builds one explicit desired-state command, never an on-chain toggle. The
 * caller must freeze these semantics before resolving/signing transaction bytes. */
export function buildSetPublicCommunityVoteTx(params:{
  deployment:PublicCommunityVotesDeployment;owner:string;actorId:string;postId:string
  expectedRevision:string;desired:0|1|2
}):Transaction {
  const deployment=assertPublicCommunityVotesDeployment(params.deployment)
  id(params.owner);id(params.actorId);id(params.postId)
  check(typeof params.expectedRevision==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(params.expectedRevision)
    &&BigInt(params.expectedRevision)<=MAX_U64,'REVISION_INVALID')
  check(params.desired===0||params.desired===1||params.desired===2,'DESIRED_INVALID')
  const tx=new Transaction();tx.setSender(params.owner)
  tx.moveCall({target:`${deployment.community.profile.callablePackageId}::community_votes::set_vote`,arguments:[
    tx.object(deployment.registryId),tx.object(deployment.community.registryId),
    tx.object(deployment.community.profile.registryId),tx.object(params.postId),
    tx.pure.id(params.actorId),tx.pure.u64(params.expectedRevision),tx.pure.u8(params.desired),
  ]})
  return tx
}
function bytes(raw: Raw, objectId: string, type: string) {
  check(raw.objectId === objectId && raw.objectType === type && typeof raw.version === 'bigint'
    && raw.version > 0n && raw.version <= MAX_U64, 'OBJECT_IDENTITY_MISMATCH')
  check(typeof raw.digest === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw.digest)
    && fromBase58(raw.digest).length === 32 && toBase58(fromBase58(raw.digest)) === raw.digest, 'DIGEST_INVALID')
  check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= 2048, 'CONTENT_INVALID')
  return raw.contents.value
}
function exact(original: Uint8Array, serialized: Uint8Array) {
  check(toBase64(original) === toBase64(serialized), 'NONCANONICAL_BCS')
}
async function object(client: PublicCommunityReadClient, objectId: string, signal: AbortSignal, optional = false): Promise<Raw | null> {
  try {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }, { abort: signal }))
    check(response.object, 'OBJECT_RESPONSE_MISSING')
    return structuredClone(response.object)
  } catch (error) {
    // An abort reason may itself carry a NOT_FOUND code; cancellation never means absence.
    signal.throwIfAborted()
    if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
    throw error
  }
}
async function registry(client: PublicCommunityReadClient, deployment: PublicCommunityVotesDeployment, post: PublicCommunityPostSnapshot, signal: AbortSignal) {
  const raw = (await object(client, deployment.registryId, signal))!
  const content = bytes(raw, deployment.registryId, `${deployment.community.profile.originalPackageId}::community_votes::VoteRegistryV1`)
  check(raw.owner?.kind === 3 && typeof raw.owner.version === 'bigint' && raw.owner.version > 0n
    && raw.owner.version <= raw.version!, 'REGISTRY_NOT_SHARED')
  const value = VoteRegistryV1Bcs.parse(content); exact(content, VoteRegistryV1Bcs.serialize(value).toBytes())
  check(value.id === deployment.registryId && value.version === '1', 'REGISTRY_CONTENT_MISMATCH')
  distinct([value.id, value.counts.id, value.edges.id, deployment.community.registryId,
    deployment.community.profile.registryId, post.id, post.commentsByIndexId, post.author.id])
  const counts = BigInt(value.counts.size), edges = BigInt(value.edges.size)
  check((edges === 0n ? counts === 0n : counts > 0n && counts <= edges)
    && counts <= BigInt(post.observedPostCount), 'REGISTRY_COUNTS_MISMATCH')
  return { value, stamp: `${raw.version}:${raw.digest}:${raw.owner.version}:${toBase64(content)}`,
    objectVersion: String(raw.version), objectDigest: raw.digest! }
}
async function counts(client: PublicCommunityReadClient, deployment: PublicCommunityVotesDeployment, parent: string, postId: string, signal: AbortSignal) {
  const fieldId = deriveDynamicFieldID(parent, ID_TYPE, bcs.Address.serialize(postId).toBytes())
  const raw = await object(client, fieldId, signal, true)
  if (!raw) return { up_count: '0', down_count: '0', exists: false }
  const content = bytes(raw, fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${ID_TYPE},${deployment.community.profile.originalPackageId}::community_votes::VoteCountsV1>`))
  check(raw.owner?.kind === 2 && raw.owner.address === parent, 'FIELD_OWNER_MISMATCH')
  const field = CountsFieldBcs.parse(content); exact(content, CountsFieldBcs.serialize(field).toBytes())
  check(field.id === fieldId && field.name === postId, 'FIELD_CONTENT_MISMATCH')
  return { ...field.value, exists: true }
}
async function edge(client: PublicCommunityReadClient, deployment: PublicCommunityVotesDeployment, parent: string, actor: string, postId: string, signal: AbortSignal) {
  const nameType = `${deployment.community.profile.originalPackageId}::community_votes::VoteKeyV1`
  const key = { actor, post: postId }, fieldId = deriveDynamicFieldID(parent, nameType, VoteKeyV1Bcs.serialize(key).toBytes())
  const raw = await object(client, fieldId, signal, true)
  if (!raw) return { state: 0, revision: '0' }
  const content = bytes(raw, fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${nameType},${deployment.community.profile.originalPackageId}::community_votes::VoteEdgeV1>`))
  check(raw.owner?.kind === 2 && raw.owner.address === parent, 'FIELD_OWNER_MISMATCH')
  const field = EdgeFieldBcs.parse(content); exact(content, EdgeFieldBcs.serialize(field).toBytes())
  check(field.id === fieldId && field.name.actor === actor && field.name.post === postId, 'FIELD_CONTENT_MISMATCH')
  check(field.value.state <= 2 && field.value.revision !== '0'
    && (field.value.state !== 0 || BigInt(field.value.revision) >= 2n), 'EDGE_STATE_INVALID')
  return field.value
}

/** Counts and the viewer's desired vote state from a stable registry/Post read.
 * This is trusted RPC evidence, not an independent quorum or Walrus proof. */
export async function readPublicCommunityVotes(params: {
  client: PublicCommunityReadClient; deployment: PublicCommunityVotesDeployment
  postId: string; viewerAddress?: string | null; signal?: AbortSignal
}): Promise<PublicCommunityVotesSnapshot> {
  const deployment = assertPublicCommunityVotesDeployment(params.deployment)
  const { client, postId, viewerAddress = null } = params
  id(postId); if (viewerAddress !== null) id(viewerAddress)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const readPost = () => readPublicCommunityPost({ client, deployment: deployment.community, postId, signal })
  const post = await readPost()
  const readViewer = () => viewerAddress === null ? Promise.resolve(null) : readMyWalletProfile({ client: client.core,
    deployment: deployment.community.profile, owner: viewerAddress, signal })
  const viewer = await readViewer()
  const start = await registry(client, deployment, post, signal)
  if (viewer) distinct([viewer.id, start.value.id, start.value.counts.id, start.value.edges.id,
    deployment.community.registryId, deployment.community.profile.registryId, post.id, post.commentsByIndexId])
  const total = await counts(client, deployment, start.value.counts.id, postId, signal)
  const vote = viewer ? await edge(client, deployment, start.value.edges.id, viewer.id, postId, signal) : { state: 0, revision: '0' }
  const numberOfCounts = BigInt(start.value.counts.size), numberOfEdges = BigInt(start.value.edges.size)
  check(total.exists ? numberOfCounts > 0n : numberOfCounts < BigInt(post.observedPostCount), 'COUNTS_MEMBERSHIP_MISMATCH')
  check(BigInt(total.up_count) + BigInt(total.down_count) <= numberOfEdges, 'COUNTS_OUT_OF_RANGE')
  check(vote.revision === '0' || (total.exists && numberOfEdges > 0n
    && (vote.state !== 1 || total.up_count !== '0') && (vote.state !== 2 || total.down_count !== '0')), 'EDGE_COUNTS_MISMATCH')
  const afterPost = await readPost()
  const afterViewer = await readViewer()
  const end = await registry(client, deployment, afterPost, signal)
  check(start.stamp === end.stamp && JSON.stringify(post) === JSON.stringify(afterPost)
    && JSON.stringify(viewer) === JSON.stringify(afterViewer), 'CHANGED_RETRY')
  signal.throwIfAborted()
  return { post, viewer, viewerAddress, upCount: total.up_count, downCount: total.down_count,
    score: String(BigInt(total.up_count) - BigInt(total.down_count)), state: vote.state as 0 | 1 | 2, revision: vote.revision,
    registryVersion: start.objectVersion, registryDigest: start.objectDigest }
}
