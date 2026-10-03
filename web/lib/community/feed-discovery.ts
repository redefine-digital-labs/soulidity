import { createBrowserCommunityPostDiscovery } from './public-post-discovery'
import { readBrowserCommunityPostWithVotes } from './public-post-vote-read'

export type ChainFeedRow = Awaited<ReturnType<typeof readBrowserCommunityPostWithVotes>>
export type CommunityFeedFilters = { sort?: string; channel?: string; timeRange?: string; type?: string; tag?: string; authorId?: string }
/** Counts cover all committed rows, never just a selected channel/top30. */
export function countCommunityChannels(rows: readonly ChainFeedRow[]) {
  let general = 0n, questions = 0n
  for (const row of rows) {
    if (row.post.channel === 'general') general++
    else if (row.post.channel === 'questions') questions++
    else throw new Error('COMMUNITY_CHANNEL_INVALID')
  }
  return { general: String(general), questions: String(questions) }
}
const periods: Record<string, bigint> = { past_hour: 3600000n, today: 86400000n, this_week: 604800000n, this_month: 2592000000n }
/** Sort only the observed scan window, never round chain counters or pretend a
 * partial scan is the global top. Time windows preserve the original rolling rules. */
export function selectCommunityFeed(rows: readonly ChainFeedRow[], filters: CommunityFeedFilters, now: number): ChainFeedRow[] {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('COMMUNITY_FEED_TIME_INVALID')
  const sort = filters.sort || 'latest'
  if (!['latest', 'popular', 'discussed'].includes(sort) || filters.channel && !['general', 'questions'].includes(filters.channel)
    || filters.type && !['log', 'question', 'knowledge'].includes(filters.type)
    || filters.timeRange && !Object.hasOwn(periods, filters.timeRange)) throw new Error('COMMUNITY_FEED_FILTER_INVALID')
  if (filters.authorId && (!/^0x[0-9a-f]{64}$/.test(filters.authorId) || /^0x0+$/.test(filters.authorId))) throw new Error('COMMUNITY_FEED_AUTHOR_INVALID')
  const cutoff = filters.timeRange ? BigInt(now) - periods[filters.timeRange] : null
  const compare = (a: bigint, b: bigint) => a > b ? -1 : a < b ? 1 : 0
  return rows.filter(row => (!filters.authorId || row.post.author.id === filters.authorId) && (!filters.channel || row.post.channel === filters.channel)
    && (!filters.type || row.post.postType === filters.type) && (!filters.tag || row.document.tags.includes(filters.tag))
    && (cutoff === null || BigInt(row.post.createdAtMs) >= cutoff))
    .sort((a, b) => {
      const primary = sort === 'popular' ? compare(BigInt(a.votes.score), BigInt(b.votes.score))
        : sort === 'discussed' ? compare(BigInt(a.post.commentCount), BigInt(b.post.commentCount)) : 0
      return primary || compare(BigInt(a.post.createdAtMs), BigInt(b.post.createdAtMs)) || compare(BigInt(a.post.index), BigInt(b.post.index))
    }).slice(0, 30)
}

/** Reuse the existing atomic-page/cancel/retry scanner. Vote-enriched rows only
 * become visible when that scanner has committed their complete page. */
export function createCommunityFeedDiscovery(params: Parameters<typeof readBrowserCommunityPostWithVotes>[0] extends infer P
  ? Omit<P, 'postId'> & { maxPosts?: number } : never,
  dependencies: { scan?: typeof createBrowserCommunityPostDiscovery; read?: typeof readBrowserCommunityPostWithVotes } = {}) {
  const config = structuredClone(params.config), viewerAddress = params.viewerAddress ?? null
  const staged = new Map<string, ChainFeedRow>()
  const scan = (dependencies.scan ?? createBrowserCommunityPostDiscovery)({ client: params.client, config,
    signal: params.signal, maxPosts: params.maxPosts }, { post: async input => {
      const row = await (dependencies.read ?? readBrowserCommunityPostWithVotes)({ ...input, config, viewerAddress })
      input.signal?.throwIfAborted()
      // The scanner separately authenticates ID/index/registries before commit.
      staged.set(row.post.id, structuredClone(row))
      return row
    } })
  function snapshot() {
    const value = scan.snapshot()
    const items = value.items.map(row => {
      const enriched = staged.get(row.post.id)
      if (!enriched || JSON.stringify(enriched.post) !== JSON.stringify(row.post)) throw new Error('COMMUNITY_FEED_SNAPSHOT_MISMATCH')
      return structuredClone(enriched)
    })
    return { ...value, items }
  }
  return { snapshot, async next() { await scan.next(); return snapshot() } }
}
