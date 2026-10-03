import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readMyWalletProfile, readPublicCommunityComment, profileReadStep,
  createPublicCommunityAcceptIntent, type PublicCommunityAcceptIntent } from '@soulidity/sdk'

export type CommunityAcceptanceCheck = PublicCommunityAcceptIntent
type Dependencies = { profile?: typeof readMyWalletProfile; comment?: typeof readPublicCommunityComment }
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_ACCEPT_${code}`) }
/** Chain-only authority. Accepting an answer does not upload or require storage
 * availability. The question author may accept their own comment, as before. */
export async function assertCommunityAcceptanceReady(params: {
  client: SuiGrpcClient; intent: CommunityAcceptanceCheck; signing: boolean; signal?: AbortSignal
}, dependencies: Dependencies = {}) {
  const intent = createPublicCommunityAcceptIntent(params.intent), { client, signing } = params
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const profile = dependencies.profile ?? readMyWalletProfile
  const readAuthor = () => profileReadStep(signal, () => profile({ client: client.core, deployment: intent.deployment.profile, owner: intent.owner, signal }))
  const before = await readAuthor()
  check(before?.id === intent.authorId && before.owner === intent.owner, 'AUTHOR_CHANGED')
  const snapshot = await profileReadStep(signal, () => (dependencies.comment ?? readPublicCommunityComment)({
    client, deployment: intent.deployment, postId: intent.postId, commentId: intent.commentId, signal }))
  const { post, comment } = snapshot
  check(post.id === intent.postId && comment.id === intent.commentId && comment.postId === post.id
    && post.registryId === intent.deployment.registryId && comment.registryId === intent.deployment.registryId
    && post.profileRegistryId === intent.deployment.profile.registryId
    && comment.profileRegistryId === intent.deployment.profile.registryId, 'PARENT_MISMATCH')
  check(post.postType === 'question' && post.author.id === intent.authorId && post.author.owner === intent.owner, 'QUESTION_AUTHOR_REQUIRED')
  if (signing) {
    check(post.acceptanceRevision === intent.expectedRevision, 'REVISION_CHANGED_RELOAD_REQUIRED')
    check(post.acceptanceRevision !== '18446744073709551615' || post.acceptedComment?.id === comment.id, 'REVISION_EXHAUSTED')
  }
  const after = await readAuthor()
  check(JSON.stringify(after) === JSON.stringify(before), 'AUTHOR_CHANGED')
  signal.throwIfAborted()
  return snapshot
}
