import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { assertPublicCommunityDeployment, profileReadStep, readPublicCommunityPostDirectory,
  readPublicCommunityPost, readPublicCommunityCommentDirectory, readPublicCommunityComment,
  type PublicCommunityDeployment, type PublicCommunityDirectoryPage, type PublicCommunityPostSnapshot,
  type WalletProfileSnapshot } from '@soulidity/sdk'

export interface CommunityContributor {
  profile: WalletProfileSnapshot
  postCount: string
  commentCount: string
  acceptedCount: string
}
export interface CommunityContributionSnapshot {
  contributors: CommunityContributor[]
  scannedPosts: number
  observedPostCount: string
  status: 'PARTIAL' | 'COMPLETE_WINDOW' | 'LIMIT_REACHED'
  hasNewerEntries: boolean
  atomic: false
}
type Dependencies = {
  postDirectory?: typeof readPublicCommunityPostDirectory
  post?: typeof readPublicCommunityPost
  commentDirectory?: typeof readPublicCommunityCommentDirectory
  comment?: typeof readPublicCommunityComment
}
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error('COMMUNITY_CONTRIBUTION_' + code) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'ID_INVALID')
}
function u64(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX_U64, 'COUNT_INVALID')
}
function same(left: unknown, right: unknown) {
  check(JSON.stringify(left) === JSON.stringify(right), 'CHANGED_RETRY')
}
/** Read only registered public authors. An entire Post and all its comments
 * contribute together, after the final authority reread. Separate Posts are
 * independent observations, never a global checkpoint or a growth formula. */
export function createCommunityContributionDiscovery(params: {
  client: SuiGrpcClient; deployment: PublicCommunityDeployment; signal?: AbortSignal
  maxPosts?: number; maxCommentsPerPost?: number
}, dependencies: Dependencies = {}) {
  const deployment = assertPublicCommunityDeployment(params.deployment), { client, signal: outer } = params
  const maxPosts = params.maxPosts ?? 3000, maxCommentsPerPost = params.maxCommentsPerPost ?? 10000
  check(Number.isInteger(maxPosts) && maxPosts >= 1 && maxPosts <= 3000
    && Number.isInteger(maxCommentsPerPost) && maxCommentsPerPost >= 1 && maxCommentsPerPost <= 10000, 'LIMIT_INVALID')
  const postDirectory = dependencies.postDirectory ?? readPublicCommunityPostDirectory
  const readPost = dependencies.post ?? readPublicCommunityPost
  const commentDirectory = dependencies.commentDirectory ?? readPublicCommunityCommentDirectory
  const readComment = dependencies.comment ?? readPublicCommunityComment
  let cursor = '0', upperBound: string | undefined, observedPostCount = '0'
  let pending: PublicCommunityDirectoryPage | null = null, ended = false, limited = false, busy = false
  const posts = new Set<string>(), comments = new Set<string>(), contributors = new Map<string, CommunityContributor>()
  function snapshot(): CommunityContributionSnapshot {
    return { contributors: structuredClone([...contributors.values()]), scannedPosts: posts.size, observedPostCount,
      status: ended ? 'COMPLETE_WINDOW' : limited || posts.size >= maxPosts ? 'LIMIT_REACHED' : 'PARTIAL',
      hasNewerEntries: upperBound !== undefined && BigInt(observedPostCount) > BigInt(upperBound), atomic: false }
  }
  function observe(count: string) {
    u64(count)
    if (BigInt(count) > BigInt(observedPostCount)) observedPostCount = count
  }
  function registered(profile: WalletProfileSnapshot) {
    id(profile.id); id(profile.owner)
    check(profile.registryId === deployment.profile.registryId, 'AUTHOR_REGISTRY_MISMATCH')
  }
  function directory(page: PublicCommunityDirectoryPage, start: string, expectedUpper: string | undefined, limit: number) {
    u64(page.observedCount); u64(page.upperBound)
    check(expectedUpper === undefined || page.upperBound === expectedUpper, 'DIRECTORY_WINDOW_MISMATCH')
    const end = BigInt(start) + BigInt(page.entries.length), upper = BigInt(page.upperBound)
    const expectedEnd = BigInt(start) + BigInt(limit) < upper ? BigInt(start) + BigInt(limit) : upper
    check(BigInt(start) <= upper && upper <= BigInt(page.observedCount) && end === expectedEnd
      && page.nextIndex === (end < upper ? String(end) : null)
      && page.partial === (BigInt(start) !== 0n || end < BigInt(page.observedCount)), 'DIRECTORY_CURSOR_MISMATCH')
    page.entries.forEach((entry, offset) => {
      id(entry.id)
      check(entry.index === String(BigInt(start) + BigInt(offset)), 'DIRECTORY_INDEX_MISMATCH')
    })
    check(new Set(page.entries.map(entry => entry.id)).size === page.entries.length, 'DUPLICATE')
  }
  function postIdentity(post: PublicCommunityPostSnapshot, postId: string, index: string) {
    check(post.id === postId && post.index === index && post.registryId === deployment.registryId
      && post.profileRegistryId === deployment.profile.registryId, 'POST_IDENTITY_MISMATCH')
    registered(post.author); u64(post.commentCount); u64(post.observedPostCount)
    check(BigInt(post.observedPostCount) >= BigInt(upperBound!) && BigInt(index) < BigInt(post.observedPostCount), 'POST_COUNT_MISMATCH')
  }
  return { snapshot, async next(): Promise<CommunityContributionSnapshot> {
    check(!busy, 'BUSY'); outer?.throwIfAborted()
    if (ended || limited || posts.size >= maxPosts) return snapshot()
    busy = true
    const attempt = new AbortController()
    const timer = setTimeout(() => attempt.abort(new Error('COMMUNITY_CONTRIBUTION_TIMEOUT')), 120000)
    const signal = outer ? AbortSignal.any([attempt.signal, outer]) : attempt.signal
    try {
      if (!pending) {
        const page = structuredClone(await profileReadStep(signal, () => postDirectory({ client, deployment,
          startIndex: cursor, upperBound, limit: 1, signal })))
        directory(page, cursor, upperBound, 1)
        check(page.entries.every(entry => !posts.has(entry.id)), 'DUPLICATE')
        pending = page; upperBound = page.upperBound; observe(page.observedCount)
      }
      const page = pending
      if (page.entries.length === 0) { ended = true; pending = null; return snapshot() }
      const entry = page.entries[0]
      const post = structuredClone(await profileReadStep(signal, () => readPost({ client, deployment, postId: entry.id, signal })))
      postIdentity(post, entry.id, entry.index); observe(post.observedPostCount)
      if (BigInt(post.commentCount) > BigInt(maxCommentsPerPost)) { limited = true; return snapshot() }
      const staged = new Map<string, CommunityContributor>(), stagedComments = new Set<string>()
      const credit = (profile: WalletProfileSnapshot, field: 'postCount' | 'commentCount' | 'acceptedCount') => {
        registered(profile)
        const existing = staged.get(profile.id), committed = contributors.get(profile.id)
        if (existing) same(existing.profile, profile)
        if (committed) check(committed.profile.owner === profile.owner && committed.profile.registryId === profile.registryId, 'AUTHOR_CHANGED')
        const row = existing ?? { profile: structuredClone(profile), postCount: '0', commentCount: '0', acceptedCount: '0' }
        row[field] = String(BigInt(row[field]) + 1n); staged.set(profile.id, row)
      }
      credit(post.author, 'postCount')
      let commentCursor = '0', acceptedFound = post.acceptedComment === null
      while (BigInt(commentCursor) < BigInt(post.commentCount)) {
        const commentPage = structuredClone(await profileReadStep(signal, () => commentDirectory({ client, deployment,
          postId: post.id, startIndex: commentCursor, upperBound: post.commentCount, limit: 200, signal })))
        directory(commentPage, commentCursor, post.commentCount, 200)
        check(commentPage.postId === post.id && commentPage.postVersion === post.objectVersion
          && commentPage.postDigest === post.objectDigest && commentPage.observedCount === post.commentCount
          && commentPage.registryVersion === post.registryVersion && commentPage.registryDigest === post.registryDigest, 'CHANGED_RETRY')
        for (let offset = 0; offset < commentPage.entries.length; offset += 4) {
          const batch = commentPage.entries.slice(offset, offset + 4)
          const values = await Promise.all(batch.map(item => profileReadStep(signal, async () => structuredClone(
            await readComment({ client, deployment, postId: post.id, commentId: item.id, signal })))))
          values.forEach((value, index) => {
            same(value.post, post)
            const comment = value.comment, expected = batch[index]
            check(comment.id === expected.id && comment.index === expected.index && comment.postId === post.id
              && comment.registryId === deployment.registryId && comment.profileRegistryId === deployment.profile.registryId, 'COMMENT_IDENTITY_MISMATCH')
            check(!comments.has(comment.id) && !stagedComments.has(comment.id) && !posts.has(comment.id)
              && comment.id !== post.id, 'DUPLICATE')
            stagedComments.add(comment.id); credit(comment.author, 'commentCount')
            const accepted = post.acceptedComment?.id === comment.id
            check(value.accepted === accepted, 'ACCEPTED_MISMATCH')
            if (accepted) { same(comment, post.acceptedComment); credit(comment.author, 'acceptedCount'); acceptedFound = true }
          })
        }
        commentCursor = commentPage.nextIndex ?? post.commentCount
      }
      check(stagedComments.size === Number(BigInt(post.commentCount)) && acceptedFound, 'COMMENT_COUNT_MISMATCH')
      const after = await profileReadStep(signal, () => readPost({ client, deployment, postId: post.id, signal }))
      same(after, post); signal.throwIfAborted()
      // Nothing below awaits: a failed Post never contributes partial counts.
      for (const [profileId, delta] of staged) {
        const previous = contributors.get(profileId)
        contributors.set(profileId, { profile: structuredClone(delta.profile),
          postCount: String(BigInt(previous?.postCount ?? '0') + BigInt(delta.postCount)),
          commentCount: String(BigInt(previous?.commentCount ?? '0') + BigInt(delta.commentCount)),
          acceptedCount: String(BigInt(previous?.acceptedCount ?? '0') + BigInt(delta.acceptedCount)) })
      }
      posts.add(post.id); stagedComments.forEach(commentId => comments.add(commentId))
      ended = page.nextIndex === null; cursor = page.nextIndex ?? upperBound!; pending = null
      return snapshot()
    } finally { attempt.abort(); clearTimeout(timer); busy = false }
  } }
}
