import { afterEach, expect, it, vi } from 'vitest'
import { createCommunityContributionDiscovery } from '../../web/lib/community/contribution-discovery'

const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
afterEach(() => vi.useRealTimers())
function fixture(counts = [3, 0]) {
  const deployment = { profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) }
  const profile = (n: number) => ({ id: id(20 + n), registryId: id(3), owner: id(40 + n), revision: '1', handle: 'profile' + n,
    objectVersion: '1', objectDigest: 'profile-digest', createdAtMs: '1', updatedAtMs: '1', metadata: { blobObjectId: id(60 + n), blobId: 'blob', sha256: 'hash', byteLength: 1 } })
  const posts: any[] = [], comments: any[][] = []
  for (let n = 0; n < counts.length; n++) {
    const post: any = { id: id(100 + n), registryId: id(4), profileRegistryId: id(3), author: profile(0), index: String(n),
      postType: 'question', channel: 'questions', document: { blobObjectId: id(300 + n) }, createdAtMs: '1', updatedAtMs: '2',
      commentCount: String(counts[n]), commentsByIndexId: id(400 + n), acceptedComment: null, acceptanceRevision: '0',
      objectVersion: '2', objectDigest: 'post-digest', registryVersion: '1', registryDigest: 'registry-digest', observedPostCount: String(counts.length) }
    const replies = Array.from({ length: counts[n] }, (_, index) => ({ id: id(1000 + n * 20000 + index), index: String(index),
      postId: post.id, registryId: id(4), profileRegistryId: id(3), author: profile(index % 2), document: { blobObjectId: id(50000 + index) },
      createdAtMs: '2', objectVersion: '1', objectDigest: 'comment-digest' }))
    if (replies.length) { post.acceptedComment = structuredClone(replies[replies.length - 1]); post.acceptanceRevision = '1' }
    posts.push(post); comments.push(replies)
  }
  const directory = vi.fn(async (input: any) => {
    const index = Number(input.startIndex), upper = input.upperBound ?? String(posts.length)
    return { entries: index < Number(upper) ? [{ id: posts[index].id, index: String(index) }] : [], observedCount: String(posts.length),
      upperBound: upper, nextIndex: index + 1 < Number(upper) ? String(index + 1) : null,
      partial: index !== 0 || index + 1 < posts.length, registryVersion: '1', registryDigest: 'registry-digest' }
  })
  const readPost = vi.fn(async (input: any) => structuredClone(posts.find(post => post.id === input.postId)!))
  const commentDirectory = vi.fn(async (input: any) => {
    const post = posts.find(post => post.id === input.postId)!, replies = comments[Number(post.index)]
    const start = Number(input.startIndex), end = Math.min(start + input.limit, replies.length)
    return { entries: replies.slice(start, end).map(({ id, index }) => ({ id, index })), observedCount: String(replies.length),
      upperBound: input.upperBound, nextIndex: end < replies.length ? String(end) : null, partial: start !== 0 || end < replies.length,
      registryVersion: post.registryVersion, registryDigest: post.registryDigest, postId: post.id, postVersion: post.objectVersion, postDigest: post.objectDigest }
  })
  const readComment = vi.fn(async (input: any) => {
    const post = posts.find(post => post.id === input.postId)!, comment = comments[Number(post.index)].find(comment => comment.id === input.commentId)!
    return structuredClone({ post, comment, accepted: post.acceptedComment?.id === comment.id })
  })
  const params = { client: {} as any, deployment }, deps = { postDirectory: directory, post: readPost, commentDirectory, comment: readComment }
  return { params, deps, posts, comments, profile, directory, readPost, commentDirectory, readComment,
    make: (extra = {}) => createCommunityContributionDiscovery({ ...params, ...extra }, deps) }
}
it('counts registered authors, each comment and the one accepted answer using detached lossless records', async () => {
  const f = fixture(), scan = f.make()
  const first = await scan.next()
  expect(first).toMatchObject({ scannedPosts: 1, observedPostCount: '2', status: 'PARTIAL', atomic: false })
  expect(first.contributors).toEqual([
    { profile: f.profile(0), postCount: '1', commentCount: '2', acceptedCount: '1' },
    { profile: f.profile(1), postCount: '0', commentCount: '1', acceptedCount: '0' },
  ])
  first.contributors[0].postCount = '999'; first.contributors[0].profile.owner = id(99)
  const complete = await scan.next()
  expect(complete.status).toBe('COMPLETE_WINDOW'); expect(complete.contributors[0]).toMatchObject({ postCount: '2', commentCount: '2', acceptedCount: '1' })
  expect(complete.contributors[0].profile.owner).toBe(f.profile(0).owner)
  expect(f.directory.mock.calls[1][0]).toMatchObject({ startIndex: '1', upperBound: '2', limit: 1 })
  await scan.next(); expect(f.directory).toHaveBeenCalledTimes(2)
})
it('scans beyond the detail first200 window and caps concurrent Comment reads at four', async () => {
  const f = fixture([205]), original = f.readComment.getMockImplementation()!
  let active = 0, peak = 0
  f.readComment.mockImplementation(async input => { active++; peak = Math.max(peak, active); await Promise.resolve(); const value = await original(input); active--; return value })
  const result = await f.make().next()
  expect(peak).toBe(4); expect(f.readComment).toHaveBeenCalledTimes(205)
  expect(f.commentDirectory.mock.calls.map(([input]) => input.startIndex)).toEqual(['0', '200'])
  expect(result.status).toBe('COMPLETE_WINDOW')
  expect(result.contributors[0]).toMatchObject({ postCount: '1', commentCount: '103', acceptedCount: '1' })
  expect(result.contributors[1].commentCount).toBe('102')
})
it('commits no partial Post when a later Comment batch fails, then retries the same frozen Post cursor', async () => {
  const f = fixture([6]), original = f.readComment.getMockImplementation()!, scan = f.make()
  let fail = true
  f.readComment.mockImplementation(async input => { if (fail && input.commentId === f.comments[0][5].id) throw new Error('comment unavailable'); return original(input) })
  await expect(scan.next()).rejects.toThrow('comment unavailable')
  expect(scan.snapshot()).toMatchObject({ contributors: [], scannedPosts: 0, status: 'PARTIAL' })
  fail = false; const result = await scan.next()
  expect(f.directory).toHaveBeenCalledOnce(); expect(result.contributors[0].commentCount).toBe('3'); expect(result.scannedPosts).toBe(1)
})
it.each(['objectVersion', 'acceptanceRevision', 'author', 'registryDigest', 'document'])('rejects full final Post authority drift: %s', async field => {
  const f = fixture([0]), initial = structuredClone(f.posts[0]), changed = structuredClone(initial), scan = f.make()
  if (field === 'author') changed.author = { ...changed.author, revision: '2' }
  else if (field === 'document') changed.document = { blobObjectId: id(999) }
  else changed[field] = 'changed'
  f.readPost.mockResolvedValueOnce(initial).mockResolvedValueOnce(changed)
  await expect(scan.next()).rejects.toThrow('CHANGED_RETRY'); expect(scan.snapshot().contributors).toEqual([])
  expect((await scan.next()).scannedPosts).toBe(1); expect(f.directory).toHaveBeenCalledOnce()
})
it.each(['id', 'index', 'registryId', 'profileRegistryId'])('rejects wrong Post %s before contribution', async field => {
  const f = fixture([0]), scan = f.make(); f.posts[0][field] = 'wrong'
  await expect(scan.next()).rejects.toThrow(); expect(scan.snapshot().scannedPosts).toBe(0)
})
it.each(['id', 'index', 'postId', 'registryId', 'profileRegistryId', 'author-registry', 'accepted', 'post-snapshot'])('rejects wrong Comment evidence: %s', async field => {
  const f = fixture([1]), original = f.readComment.getMockImplementation()!, scan = f.make()
  f.readComment.mockImplementation(async input => {
    const value = await original(input)
    if (field === 'author-registry') value.comment.author.registryId = id(99)
    else if (field === 'accepted') value.accepted = false
    else if (field === 'post-snapshot') value.post.acceptanceRevision = '2'
    else (value.comment as any)[field] = 'wrong'
    return value
  })
  await expect(scan.next()).rejects.toThrow(); expect(scan.snapshot().contributors).toEqual([])
})
it.each(['wrong-index', 'wrong-next', 'short-page', 'upper', 'count', 'partial'])('rejects malformed Post directory %s', async mutation => {
  const f = fixture(), original = f.directory.getMockImplementation()!, scan = f.make()
  f.directory.mockImplementation(async input => {
    const page = await original(input)
    if (mutation === 'wrong-index') page.entries[0].index = '7'
    if (mutation === 'wrong-next') page.nextIndex = null
    if (mutation === 'short-page') page.entries = []
    if (mutation === 'upper') page.upperBound = '3'
    if (mutation === 'count') page.observedCount = '00'
    if (mutation === 'partial') page.partial = false
    return page
  })
  await expect(scan.next()).rejects.toThrow(); expect(scan.snapshot().scannedPosts).toBe(0)
})
it('rejects duplicate Comment IDs across pages and wrong directory Post authority', async () => {
  const f = fixture([201]), original = f.commentDirectory.getMockImplementation()!, scan = f.make()
  f.commentDirectory.mockImplementation(async input => {
    const page = await original(input)
    if (input.startIndex === '200') page.entries[0].id = f.comments[0][0].id
    return page
  })
  await expect(scan.next()).rejects.toThrow(); expect(scan.snapshot().contributors).toEqual([])
  f.commentDirectory.mockImplementation(async input => ({ ...await original(input), postVersion: '9' }))
  await expect(scan.next()).rejects.toThrow('CHANGED_RETRY'); expect(scan.snapshot().contributors).toEqual([])
})
it('does not credit or claim completeness for an oversized Post', async () => {
  const f = fixture([0, 5]), scan = f.make({ maxCommentsPerPost: 4 })
  await scan.next(); const result = await scan.next()
  expect(result).toMatchObject({ status: 'LIMIT_REACHED', scannedPosts: 1 })
  expect(result.contributors[0]).toMatchObject({ postCount: '1', commentCount: '0', acceptedCount: '0' })
  expect(f.readComment).not.toHaveBeenCalled(); await scan.next(); expect(f.directory).toHaveBeenCalledTimes(2)
})
it('exposes bounded Post limit without scanning or claiming the rest', async () => {
  const f = fixture([0, 0]), scan = f.make({ maxPosts: 1 })
  expect((await scan.next()).status).toBe('LIMIT_REACHED'); await scan.next(); expect(f.directory).toHaveBeenCalledOnce()
})
it('distinguishes a genuinely empty frozen directory and newly observed entries', async () => {
  const empty = fixture([]); expect(await empty.make().next()).toMatchObject({ contributors: [], scannedPosts: 0, status: 'COMPLETE_WINDOW' })
  const f = fixture([0, 0]), scan = f.make(); await scan.next()
  f.posts[1].observedPostCount = '3'
  expect(await scan.next()).toMatchObject({ status: 'COMPLETE_WINDOW', hasNewerEntries: true, observedPostCount: '3' })
})
it('captures deployment before reads and refuses a repeated Post ID without altering prior counts', async () => {
  const f = fixture([0, 0]), scan = f.make(); f.params.deployment.registryId = id(99)
  await scan.next(); expect(f.directory.mock.calls[0][0].deployment.registryId).toBe(id(4))
  f.posts[1].id = f.posts[0].id
  await expect(scan.next()).rejects.toThrow('DUPLICATE'); expect(scan.snapshot().contributors[0].postCount).toBe('1')
})
it('cancels failed Comment siblings before an immediate retry can start', async () => {
  const f = fixture([4]), scan = f.make(), signals: AbortSignal[] = []; let active = 0, peak = 0
  f.readComment.mockImplementation(async input => {
    signals.push(input.signal); active++; peak = Math.max(peak, active)
    if (input.commentId === f.comments[0][0].id) { active--; throw new Error('batch failure') }
    return new Promise((_, reject) => input.signal.addEventListener('abort', () => { active--; reject(input.signal.reason) }, { once: true }))
  })
  await expect(scan.next()).rejects.toThrow('batch failure'); expect(signals.every(signal => signal.aborted)).toBe(true); expect(active).toBe(0)
  await expect(scan.next()).rejects.toThrow('batch failure'); expect(peak).toBeLessThanOrEqual(4); expect(scan.snapshot().contributors).toEqual([])
})
it('blocks concurrent next and ignores a late transport result after cancellation', async () => {
  const f = fixture([0]), controller = new AbortController(), scan = f.make({ signal: controller.signal })
  let finish!: (value: any) => void
  f.directory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = scan.next().catch(error => error)
  await vi.waitFor(() => expect(finish).toBeDefined()); await expect(scan.next()).rejects.toThrow('BUSY')
  controller.abort(); expect(await pending).toBeInstanceOf(Error)
  finish({ entries: [], upperBound: '0', observedCount: '0', nextIndex: null, partial: false }); await Promise.resolve()
  expect(scan.snapshot()).toMatchObject({ contributors: [], scannedPosts: 0, status: 'PARTIAL' })
  await expect(scan.next()).rejects.toThrow(); expect(f.readPost).not.toHaveBeenCalled()
})
it('bounds an ignored cancellation transport at 120 seconds and retains the Post for retry', async () => {
  vi.useFakeTimers(); const f = fixture([1]), scan = f.make()
  f.readComment.mockImplementationOnce(() => new Promise(() => {}))
  const pending = scan.next().catch(error => error)
  await vi.advanceTimersByTimeAsync(120001)
  expect((await pending).message).toContain('TIMEOUT'); expect(scan.snapshot().contributors).toEqual([])
  expect((await scan.next()).status).toBe('COMPLETE_WINDOW'); expect(f.directory).toHaveBeenCalledOnce()
})
it.each([{ maxPosts: 0 }, { maxPosts: 3001 }, { maxCommentsPerPost: 0 }, { maxCommentsPerPost: 10001 }, { maxCommentsPerPost: 1.5 }])('rejects invalid resource bounds %s before any reads', options => {
  const f = fixture(); expect(() => f.make(options)).toThrow('LIMIT_INVALID'); expect(f.directory).not.toHaveBeenCalled()
})
