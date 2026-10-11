import { expect, it, vi } from 'vitest'
import { createCommunityFeedDiscovery, selectCommunityFeed, countCommunityChannels } from '../../web/lib/community/feed-discovery'
import { createBrowserCommunityPostDiscovery } from '../../web/lib/community/public-post-discovery'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const row = (index: number, score = '0', count = '0', created = String(index)) => ({ post: { id: id(index + 10), index: String(index),
  createdAtMs: created, channel: 'general', postType: 'log', commentCount: count, registryId: id(4), profileRegistryId: id(3), observedPostCount: '2' },
  document: { tags: ['Tag'], title: 'title' }, votes: { score } } as any)
it('counts every committed channel before top30/filtering and does not invent News counts', () => {
  const rows = Array.from({ length: 45 }, (_, n) => row(n))
  for (let n = 0; n < 12; n++) rows[n].post.channel = 'questions'
  expect(countCommunityChannels(rows)).toEqual({ general: '33', questions: '12' })
  expect(selectCommunityFeed(rows, { channel: 'general' }, 100)).toHaveLength(30)
  expect(countCommunityChannels([])).toEqual({ general: '0', questions: '0' })
  rows[0].post.channel = 'news'; expect(() => countCommunityChannels(rows)).toThrow('CHANNEL_INVALID')
})
it('sorts signed full-u64 score/count without rounding; ties use newest creation/index', () => {
  const rows = [row(0, '-18446744073709551615', '18446744073709551615'), row(1, '9007199254740992', '2'), row(2, '9007199254740993', '1')]
  expect(selectCommunityFeed(rows, { sort: 'popular' }, 100).map(v => v.post.index)).toEqual(['2', '1', '0'])
  expect(selectCommunityFeed(rows, { sort: 'discussed' }, 100).map(v => v.post.index)).toEqual(['0', '1', '2'])
  expect(selectCommunityFeed([row(0), row(1)], { sort: 'popular' }, 100).map(v => v.post.index)).toEqual(['1', '0'])
  expect(rows[0].post.index).toBe('0')
})
it('preserves exact tag/type/channel and rolling inclusive time boundary before top30', () => {
  const now = 100000000, rows = [row(0, '0', '0', String(now - 3600000)), row(1, '0', '0', String(now - 3600001)), row(2, '0', '0', String(now))]
  rows[2].post.channel = 'questions'; rows[2].post.postType = 'question'
  expect(selectCommunityFeed(rows, { timeRange: 'past_hour', channel: 'general', tag: 'Tag', type: 'log' }, now).map(v => v.post.index)).toEqual(['0'])
  expect(selectCommunityFeed(rows, { tag: 'tag' }, now)).toEqual([])
  expect(selectCommunityFeed(Array.from({ length: 40 }, (_, n) => row(n)), {}, now)).toHaveLength(30)
})
it('filters registered author before selecting latest rows, not by current wallet or top30 overall', () => {
  const rows = Array.from({ length: 40 }, (_, n) => ({ ...row(n), post: { ...row(n).post, author: { id: n < 4 ? id(7) : id(8) } } }))
  expect(selectCommunityFeed(rows, { authorId: id(7) }, 100).map(value => value.post.index)).toEqual(['3', '2', '1', '0'])
  expect(() => selectCommunityFeed(rows, { authorId: 'sql-id' }, 100)).toThrow('AUTHOR_INVALID')
})
it.each([['past_hour', 3600000], ['today', 86400000], ['this_week', 604800000], ['this_month', 2592000000]] as const)('retains %s rolling window', (timeRange, period) => {
  const now = 3000000000
  expect(selectCommunityFeed([row(0, '0', '0', String(now - period)), row(1, '0', '0', String(now - period - 1))], { timeRange }, now)).toHaveLength(1)
})
it.each([{ sort: 'unknown' }, { channel: 'news' }, { timeRange: 'calendar_today' }, { type: 'private' }])('rejects unsupported filters rather than quietly changing meaning', filters => {
  expect(() => selectCommunityFeed([], filters, 0)).toThrow('FILTER_INVALID')
})
function fixture() {
  const config = { deployment: { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) },
    storage: { blobType: `${id(5)}::blob::Blob`, aggregatorUrl: 'https://public.example', chainIdentifier: '01010101' }, voteRegistryId: id(6) }
  const directory = vi.fn(async () => ({ entries: [{ id: id(10), index: '0' }, { id: id(11), index: '1' }], upperBound: '2', observedCount: '2', nextIndex: null, partial: false } as any))
  const read = vi.fn(async (input: any) => row(input.postId === id(10) ? 0 : 1, '9007199254740993'))
  const scan: typeof createBrowserCommunityPostDiscovery = (params, deps) => createBrowserCommunityPostDiscovery(params, { ...deps, directory })
  const params = { client: {} as any, config, viewerAddress: id(8) }
  return { params, directory, read, make: () => createCommunityFeedDiscovery(params, { scan, read }) }
}
it('enriches the existing real scanner with frozen viewer/config and detached committed vote rows', async () => {
  const f = fixture(), scan = f.make(); f.params.viewerAddress = id(99); f.params.config.voteRegistryId = id(99)
  const snapshot = await scan.next()
  expect(snapshot.status).toBe('COMPLETE_WINDOW'); expect(snapshot.items[0].votes.score).toBe('9007199254740993')
  expect(f.read.mock.calls[0][0]).toMatchObject({ viewerAddress: id(8), config: { voteRegistryId: id(6) } })
  snapshot.items[0].votes.score = 'tampered'; expect(scan.snapshot().items[0].votes.score).toBe('9007199254740993')
})
it('failed vote-enriched hydration commits no rows and retries the original directory page', async () => {
  const f = fixture(), scan = f.make(); f.read.mockRejectedValueOnce(new Error('votes unavailable'))
  await expect(scan.next()).rejects.toThrow('votes unavailable'); expect(scan.snapshot().items).toEqual([])
  expect((await scan.next()).scanned).toBe(2); expect(f.directory).toHaveBeenCalledOnce()
})
