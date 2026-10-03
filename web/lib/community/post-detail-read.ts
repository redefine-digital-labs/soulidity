import { WalrusClient } from '@mysten/walrus'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readPublicCommunityCommentDirectory, readPublicCommunityPost, profileReadStep } from '@soulidity/sdk'
import { readBrowserCommunityPostWithVotes } from './public-post-vote-read'
import { readBrowserCommunityComment } from './public-post-read'

type PostParams = Parameters<typeof readBrowserCommunityPostWithVotes>[0]
type Dependencies = {
  post?: typeof readBrowserCommunityPostWithVotes; comment?: typeof readBrowserCommunityComment
  directory?: typeof readPublicCommunityCommentDirectory; postState?: typeof readPublicCommunityPost
  walrus?: (client: SuiGrpcClient) => Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'>
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`COMMUNITY_DETAIL_${message}`) }
function same(a: unknown, b: unknown) { check(JSON.stringify(a) === JSON.stringify(b), 'POST_CHANGED_RETRY') }
/** Original earliest-200 comment window, with certified content/author metadata.
 * No SQL IDs, invented actor classification or number-rounded counters. */
export async function readBrowserCommunityPostDetail(params: PostParams, dependencies: Dependencies = {}) {
  const config = structuredClone(params.config), { client, postId, viewerAddress } = params
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000), ...(params.signal ? [params.signal] : [])])
  try {
    const post = await profileReadStep(signal, () => (dependencies.post ?? readBrowserCommunityPostWithVotes)({ client, config, postId, viewerAddress, signal }))
    const directory = await profileReadStep(signal, () => (dependencies.directory ?? readPublicCommunityCommentDirectory)({
      client, deployment: config.deployment, postId, limit: 200, signal }))
    check(directory.postId === postId && directory.postVersion === post.post.objectVersion
      && directory.postDigest === post.post.objectDigest && directory.observedCount === post.post.commentCount, 'POST_CHANGED_RETRY')
    const comments: Awaited<ReturnType<typeof readBrowserCommunityComment>>[] = []
    // Batch order preserves original creation order. A failed member cancels its
    // siblings and commits no partly hydrated page to the caller.
    for (let offset = 0; offset < directory.entries.length; offset += 4) {
      const batch = await Promise.all(directory.entries.slice(offset, offset + 4).map(async entry => {
        const comment = await profileReadStep(signal, () => (dependencies.comment ?? readBrowserCommunityComment)({ client, config, postId, commentId: entry.id, signal }))
        same(comment.post, post.post)
        check(comment.comment.id === entry.id && comment.comment.index === entry.index, 'COMMENT_DIRECTORY_MISMATCH')
        return comment
      }))
      comments.push(...batch)
    }
    const latest = await profileReadStep(signal, () => (dependencies.postState ?? readPublicCommunityPost)({ client, deployment: config.deployment, postId, signal }))
    same(latest, post.post)
    const network = config.deployment.profile.chainIdentifier
    check(dependencies.walrus || network === '35834a8a' || network === '4c78adac', 'WALRUS_NETWORK_UNSUPPORTED')
    const walrus = dependencies.walrus?.(client) ?? new WalrusClient({ suiClient: client, network: network === '35834a8a' ? 'mainnet' : 'testnet' })
    walrus.reset()
    const blobType = await profileReadStep(signal, async () => walrus.getBlobType())
    const state = await profileReadStep(signal, () => walrus.systemState()), epoch = state.committee.epoch
    check(blobType === config.storage.blobType && Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffff_ffff, 'STORAGE_STATE_INVALID')
    for (const item of [post, ...comments]) {
      check([item.storageEndEpoch, item.authorStorageEndEpoch].every(end => Number.isInteger(end) && end <= 0xffff_ffff && end > epoch), 'STORAGE_EXPIRED')
    }
    signal.throwIfAborted()
    return { ...post, comments, commentWindow: { shown: comments.length, total: directory.observedCount,
      partial: directory.partial, nextIndex: directory.nextIndex, upperBound: directory.upperBound }, atomic: false as const }
  } finally { controller.abort() }
}
