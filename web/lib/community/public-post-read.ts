import { WalrusClient } from '@mysten/walrus'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertPublicCommunityDeployment, readPublicCommunityPost, readPublicCommunityComment,
  readPublicCommunityDocument, profileReadStep, type PublicCommunityDeployment,
  type PublicCommunityStorageTarget } from '@soulidity/sdk'
import { getBrowserProfileReadConfig } from '@/lib/profile/profile-config'
import { readPublicCommunityIdentity } from './public-profile-read'

export interface BrowserCommunityReadConfig {
  deployment: PublicCommunityDeployment
  storage: PublicCommunityStorageTarget
}
/** Exact new-release registry; missing configuration is not an empty feed. */
export function getBrowserCommunityReadConfig(): BrowserCommunityReadConfig {
  const profile = getBrowserProfileReadConfig()
  const deployment = assertPublicCommunityDeployment({ profile: profile.deployment,
    registryId: process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID ?? '' })
  return { deployment, storage: { ...profile.storage, chainIdentifier: deployment.profile.chainIdentifier } }
}
type Dependencies = {
  post?: typeof readPublicCommunityPost
  comment?: typeof readPublicCommunityComment
  document?: typeof readPublicCommunityDocument
  identity?: typeof readPublicCommunityIdentity
  walrus?: (client: SuiGrpcClient) => Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'>
}
type Params = { client: SuiGrpcClient; config: BrowserCommunityReadConfig; postId: string; signal?: AbortSignal }
function capture(params: Params, dependencies: Dependencies) {
  const config = structuredClone(params.config), { client, postId } = params
  config.deployment = assertPublicCommunityDeployment(config.deployment)
  if (config.storage.chainIdentifier !== config.deployment.profile.chainIdentifier) throw new Error('COMMUNITY_STORAGE_CHAIN_MISMATCH')
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000)
  signal.throwIfAborted()
  // Same client as the chain reader; no separate endpoint, cached upload epoch,
  // wallet prompt, Seal key or business API is used for public content.
  let walrus: Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'> | undefined
  const freshWalrusState = async (currentSignal: AbortSignal) => {
    currentSignal.throwIfAborted()
    walrus ??= dependencies.walrus?.(client) ?? new WalrusClient({ suiClient: client, network: 'mainnet' })
    walrus.reset()
    const blobType = await profileReadStep(currentSignal, async () => walrus!.getBlobType())
    const state = await profileReadStep(currentSignal, () => walrus!.systemState())
    return { blobType, epoch: state.committee.epoch }
  }
  return { client, config, postId, signal, freshWalrusState }
}
function unchanged(before: unknown, after: unknown) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('COMMUNITY_CONTENT_CHANGED_RETRY')
}
async function currentAuthorStorage(p:ReturnType<typeof capture>, endEpoch:number, contentEndEpoch:number) {
  const state=await p.freshWalrusState(p.signal)
  if(state.blobType!==p.config.storage.blobType||!Number.isInteger(state.epoch)||state.epoch<0||state.epoch>0xffff_ffff
    ||!Number.isInteger(endEpoch)||endEpoch>0xffff_ffff||endEpoch<=state.epoch) throw new Error('COMMUNITY_AUTHOR_STORAGE_EXPIRED_OR_INVALID')
  if(!Number.isInteger(contentEndEpoch)||contentEndEpoch>0xffff_ffff||contentEndEpoch<=state.epoch)
    throw new Error('COMMUNITY_CONTENT_STORAGE_EXPIRED_OR_INVALID')
}
/** Read the real Post authority, certified public document, then that authority
 * again. A stale count/accepted answer/author is never combined with fresh text.
 * This is a read primitive, not feed discovery or a mutation/recovery controller. */
export async function readBrowserCommunityPost(params: Params, dependencies: Dependencies = {}) {
  const p = capture(params, dependencies), read = dependencies.post ?? readPublicCommunityPost
  const documentRead = dependencies.document ?? readPublicCommunityDocument
  const input = { client:p.client, deployment:p.config.deployment, postId:p.postId, signal:p.signal }
  const post = await profileReadStep(p.signal, () => read(input))
  const content = await profileReadStep(p.signal, () => documentRead({ client:p.client, reference:post.document,
    storage:p.config.storage, freshWalrusState:p.freshWalrusState, kind:'post', signal:p.signal }))
  const author = await profileReadStep(p.signal, () => (dependencies.identity ?? readPublicCommunityIdentity)({
    client:p.client.core, spaceId:post.author.id,
    config:{deployment:p.config.deployment.profile,storage:p.config.storage},signal:p.signal }))
  unchanged(post.author, author.profile)
  await currentAuthorStorage(p,author.storageEndEpoch,content.storageEndEpoch)
  const after = await profileReadStep(p.signal, () => read(input))
  unchanged(post, after)
  if (content.document.schema !== 'soulidity.public-post.v1') throw new Error('COMMUNITY_CONTENT_KIND_MISMATCH')
  p.signal.throwIfAborted()
  return { post, document:content.document, storageEndEpoch:content.storageEndEpoch,
    authorMetadata:author.metadata,authorStorageEndEpoch:author.storageEndEpoch }
}
export async function readBrowserCommunityComment(params: Params & { commentId:string }, dependencies: Dependencies = {}) {
  const commentId = params.commentId, p = capture(params, dependencies)
  const read = dependencies.comment ?? readPublicCommunityComment, documentRead = dependencies.document ?? readPublicCommunityDocument
  const input = { client:p.client, deployment:p.config.deployment, postId:p.postId, commentId, signal:p.signal }
  const snapshot = await profileReadStep(p.signal, () => read(input))
  const content = await profileReadStep(p.signal, () => documentRead({ client:p.client, reference:snapshot.comment.document,
    storage:p.config.storage, freshWalrusState:p.freshWalrusState, kind:'comment', signal:p.signal }))
  const author = await profileReadStep(p.signal, () => (dependencies.identity ?? readPublicCommunityIdentity)({
    client:p.client.core, spaceId:snapshot.comment.author.id,
    config:{deployment:p.config.deployment.profile,storage:p.config.storage},signal:p.signal }))
  unchanged(snapshot.comment.author, author.profile)
  await currentAuthorStorage(p,author.storageEndEpoch,content.storageEndEpoch)
  const after = await profileReadStep(p.signal, () => read(input))
  unchanged(snapshot, after)
  if (content.document.schema !== 'soulidity.public-comment.v1') throw new Error('COMMUNITY_CONTENT_KIND_MISMATCH')
  p.signal.throwIfAborted()
  return { ...snapshot, document:content.document, storageEndEpoch:content.storageEndEpoch,
    authorMetadata:author.metadata,authorStorageEndEpoch:author.storageEndEpoch }
}
