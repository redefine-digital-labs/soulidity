import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { assertWalletProfileDeployment, readMyWalletProfile, readWalletProfile,
  type WalletProfileDeployment, type WalletProfileReadClient, type WalletProfileSnapshot } from './wallet-profile'

export interface WalletSocialDeployment {
  profile: WalletProfileDeployment
  registryId: string
}
export interface WalletSocialReadClient {
  core: WalletProfileReadClient
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject'>
}
export interface WalletFollowSnapshot {
  target: WalletProfileSnapshot
  viewer: WalletProfileSnapshot | null
  following: boolean
  edgeRevision: string
  followerCount: string
  followingCount: string
  registryVersion: string
  registryDigest: string
}
const MAX_U64 = 18446744073709551615n
const ID_TYPE = normalizeStructTag('0x2::object::ID')
const TableBcs = bcs.struct('SocialTable', { id: bcs.Address, size: bcs.u64() })
export const SocialRegistryV1Bcs = bcs.struct('SocialRegistryV1', {
  id: bcs.Address, version: bcs.u64(), counts: TableBcs, edges: TableBcs,
})
export const FollowCountsV1Bcs = bcs.struct('FollowCountsV1', { follower_count: bcs.u64(), following_count: bcs.u64() })
export const FollowKeyV1Bcs = bcs.struct('FollowKeyV1', { follower: bcs.Address, following: bcs.Address })
export const FollowEdgeV1Bcs = bcs.struct('FollowEdgeV1', { following: bcs.bool(), revision: bcs.u64() })
const CountsFieldBcs = bcs.struct('CountsField', { id: bcs.Address, name: bcs.Address, value: FollowCountsV1Bcs })
const EdgeFieldBcs = bcs.struct('EdgeField', { id: bcs.Address, name: FollowKeyV1Bcs, value: FollowEdgeV1Bcs })
type LedgerObject = NonNullable<Awaited<ReturnType<WalletSocialReadClient['ledgerService']['getObject']>>['response']['object']>

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'SOCIAL_INVALID_ID')
}
function u64(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX_U64, 'SOCIAL_INVALID_U64')
}
export function assertWalletSocialDeployment(input: WalletSocialDeployment): WalletSocialDeployment {
  const value = structuredClone(input)
  const profile = assertWalletProfileDeployment(value?.profile)
  id(value.registryId)
  check(value.registryId !== profile.registryId, 'SOCIAL_REGISTRIES_MUST_DIFFER')
  return { profile, registryId: value.registryId }
}
function rawBytes(value: LedgerObject | undefined, objectId: string, type: string) {
  check(value?.objectId === objectId && value.objectType === type
    && typeof value.version === 'bigint' && value.version > 0n && value.version <= MAX_U64,
  'SOCIAL_OBJECT_IDENTITY_MISMATCH')
  check(typeof value.digest === 'string' && fromBase58(value.digest).length === 32
    && toBase58(fromBase58(value.digest)) === value.digest, 'SOCIAL_OBJECT_DIGEST_INVALID')
  check(value.contents?.value instanceof Uint8Array && value.contents.value.length > 0
    && value.contents.value.length <= 2048, 'SOCIAL_OBJECT_CONTENT_INVALID')
  return value.contents.value
}
async function object(client: WalletSocialReadClient, objectId: string, signal: AbortSignal, optional = false) {
  try {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    check(response.object, 'SOCIAL_OBJECT_RESPONSE_MISSING')
    return response.object
  } catch (error) {
    // Core.getObject currently erases per-object gRPC error codes. Read the
    // single raw RPC instead: only its exact NOT_FOUND status means no row.
    if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
    throw error
  }
}
async function registry(client: WalletSocialReadClient, deployment: WalletSocialDeployment, signal: AbortSignal) {
  const raw = await object(client, deployment.registryId, signal)
  const bytes = rawBytes(raw!, deployment.registryId, `${deployment.profile.originalPackageId}::social::SocialRegistryV1`)
  check(raw!.owner?.kind === 3 && typeof raw!.owner.version === 'bigint' && raw!.owner.version > 0n
    && raw!.owner.version <= MAX_U64, 'SOCIAL_REGISTRY_NOT_SHARED')
  const value = SocialRegistryV1Bcs.parse(bytes)
  check(toBase64(SocialRegistryV1Bcs.serialize(value).toBytes()) === toBase64(bytes)
    && value.id === deployment.registryId && value.version === '1', 'SOCIAL_REGISTRY_CONTENT_MISMATCH')
  id(value.counts.id); id(value.edges.id)
  const count = BigInt(value.counts.size), edges = BigInt(value.edges.size)
  check(new Set([value.id, value.counts.id, value.edges.id]).size === 3
    && (edges === 0n ? count === 0n : count >= 2n && count <= 2n * edges && edges <= count * (count - 1n)),
  'SOCIAL_REGISTRY_TABLE_MISMATCH')
  return { ...value, objectVersion: String(raw!.version), objectDigest: raw!.digest!, bytes: toBase64(bytes) }
}
async function counts(client: WalletSocialReadClient, deployment: WalletSocialDeployment, parent: string,
  profileId: string, signal: AbortSignal) {
  const fieldId = deriveDynamicFieldID(parent, ID_TYPE, bcs.Address.serialize(profileId).toBytes())
  const raw = await object(client, fieldId, signal, true)
  if (!raw) return { follower_count: '0', following_count: '0', exists: false }
  const bytes = rawBytes(raw, fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${ID_TYPE},${deployment.profile.originalPackageId}::social::FollowCountsV1>`))
  check(raw.owner?.kind === 2 && raw.owner.address === parent, 'SOCIAL_FIELD_OWNER_MISMATCH')
  const field = CountsFieldBcs.parse(bytes)
  check(toBase64(CountsFieldBcs.serialize(field).toBytes()) === toBase64(bytes)
    && field.id === fieldId && field.name === profileId, 'SOCIAL_FIELD_CONTENT_MISMATCH')
  return { ...field.value, exists: true }
}
async function edge(client: WalletSocialReadClient, deployment: WalletSocialDeployment, parent: string,
  follower: string, following: string, signal: AbortSignal) {
  const nameType = `${deployment.profile.originalPackageId}::social::FollowKeyV1`
  const key = { follower, following }, fieldId = deriveDynamicFieldID(parent, nameType, FollowKeyV1Bcs.serialize(key).toBytes())
  const raw = await object(client, fieldId, signal, true)
  if (!raw) return { following: false, revision: '0' }
  const bytes = rawBytes(raw, fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${nameType},${deployment.profile.originalPackageId}::social::FollowEdgeV1>`))
  check(raw.owner?.kind === 2 && raw.owner.address === parent, 'SOCIAL_FIELD_OWNER_MISMATCH')
  const field = EdgeFieldBcs.parse(bytes)
  check(toBase64(EdgeFieldBcs.serialize(field).toBytes()) === toBase64(bytes)
    && field.id === fieldId && field.name.follower === follower && field.name.following === following,
  'SOCIAL_FIELD_CONTENT_MISMATCH')
  check(BigInt(field.value.revision) > 0n && field.value.following === (BigInt(field.value.revision) % 2n === 1n),
    'SOCIAL_EDGE_REVISION_MISMATCH')
  return field.value
}

/** Public shared counts and a viewer's edge, all from the same registry version.
 * Missing profiles/errors are not zero counts. A changed root demands a fresh
 * read rather than mixing two-sided counts from concurrent transactions. */
export async function readWalletFollowState(params: {
  client: WalletSocialReadClient; deployment: WalletSocialDeployment
  targetProfileId: string; viewerAddress?: string | null; signal?: AbortSignal
}): Promise<WalletFollowSnapshot> {
  const deployment = assertWalletSocialDeployment(params.deployment)
  const { client, targetProfileId, viewerAddress = null } = params
  id(targetProfileId); if (viewerAddress !== null) id(viewerAddress)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  const target = await readWalletProfile({ client: client.core, deployment: deployment.profile, profileId: targetProfileId, signal })
  const viewer = viewerAddress === target.owner ? target : viewerAddress ? await readMyWalletProfile({
    client: client.core, deployment: deployment.profile, owner: viewerAddress, signal }) : null
  const start = await registry(client, deployment, signal)
  const targetCounts = await counts(client, deployment, start.counts.id, target.id, signal)
  const relation = viewer && viewer.id !== target.id ? await edge(client, deployment, start.edges.id, viewer.id, target.id, signal)
    : { following: false, revision: '0' }
  if (relation.revision !== '0') {
    const viewerCounts = await counts(client, deployment, start.counts.id, viewer!.id, signal)
    check(targetCounts.exists && viewerCounts.exists
      && (!relation.following || (BigInt(targetCounts.follower_count) > 0n && BigInt(viewerCounts.following_count) > 0n)),
    'SOCIAL_EDGE_COUNTS_MISMATCH')
  }
  const end = await registry(client, deployment, signal)
  check(start.objectVersion === end.objectVersion && start.objectDigest === end.objectDigest && start.bytes === end.bytes,
    'SOCIAL_CHANGED_RETRY')
  check(BigInt(targetCounts.follower_count) < BigInt(start.counts.size) || targetCounts.follower_count === '0', 'SOCIAL_COUNTS_OUT_OF_RANGE')
  check(BigInt(targetCounts.following_count) < BigInt(start.counts.size) || targetCounts.following_count === '0', 'SOCIAL_COUNTS_OUT_OF_RANGE')
  signal.throwIfAborted()
  return { target, viewer, following: relation.following, edgeRevision: relation.revision,
    followerCount: targetCounts.follower_count, followingCount: targetCounts.following_count,
    registryVersion: start.objectVersion, registryDigest: start.objectDigest }
}

export function buildSetWalletFollowTx(params: {
  deployment: WalletSocialDeployment; owner: string; actorId: string; targetId: string; targetOwner: string
  expectedRevision: string; following: boolean
}): Transaction {
  const deployment = assertWalletSocialDeployment(params.deployment)
  id(params.owner); id(params.actorId); id(params.targetId); id(params.targetOwner); u64(params.expectedRevision)
  check(params.actorId !== params.targetId && params.owner !== params.targetOwner, 'SOCIAL_CANNOT_FOLLOW_SELF')
  check(typeof params.following === 'boolean', 'SOCIAL_DESIRED_STATE_REQUIRED')
  const tx = new Transaction(); tx.setSender(params.owner)
  tx.moveCall({ target: `${deployment.profile.callablePackageId}::social::set_follow`, arguments: [
    tx.object(deployment.registryId), tx.object(deployment.profile.registryId), tx.pure.id(params.actorId),
    tx.pure.id(params.targetId), tx.pure.address(params.targetOwner), tx.pure.u64(params.expectedRevision), tx.pure.bool(params.following),
  ] })
  return tx
}
