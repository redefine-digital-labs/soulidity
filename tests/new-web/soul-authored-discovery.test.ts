import { afterEach, expect, it, vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'
import * as reader from '../../packages/soulidity-sdk/src/soul-public-read'
import { createSoulAuthoredDiscovery } from '../../packages/soulidity-sdk/src/soul-authored-discovery'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1))
function setup(pages: Array<{ ids: number[]; more: boolean }>, maxPages = 20) {
  const fetcher = vi.fn<typeof fetch>()
  pages.forEach((page, i) => fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: { chainIdentifier: genesis,
    checkpoint: { sequenceNumber: 100, query: { objects: { nodes: page.ids.map(n => ({ address: id(n) })),
      pageInfo: { hasNextPage: page.more, endCursor: page.ids.length ? `opaque:${i}` : null } } } } } }))))
  const deployment = { originalPackageId: id(90), chainIdentifier: '01010101' }, creator = id(91)
  const read = vi.spyOn(reader, 'readSoulPublicSnapshot').mockImplementation(async ({ stateId }) => ({
    stateId, soulId: stateId, creator, currentOwner: id(99), kioskId: id(98), name: stateId, description: '', imageUrl: '',
    provenanceKind: 1, originRef: null, creatorRoyaltyBps: 500, ownershipEpoch: '0', collectionId: null,
    listedIndividually: false, contentId: id(97), createdAtMs: BigInt(stateId).toString(),
    publicPreview: { schema: 'soulidity.soul-public-preview.v1', tags: ['oc'], previewImages: [] }, stateVersion: '1', stateDigest: genesis,
  }))
  const options = { client: {} as reader.SoulPublicReadClient, deployment, creator,
    discovery: { endpoint: 'https://graphql.example.com/graphql', pageSize: 50, maxPages, maxObjects: 1000, timeoutMs: 1000, fetch: fetcher } }
  return { fetcher, deployment, read, options, scan: createSoulAuthoredDiscovery(options) }
}
afterEach(() => vi.restoreAllMocks())

it('discovers shared states, filters actual creator rather than holder, and does not call the first page complete', async () => {
  const f = setup([{ ids: [1, 2], more: true }, { ids: [3], more: false }])
  const original = f.read.getMockImplementation()!
  f.read.mockImplementation(async args => ({ ...await original(args), ...(args.stateId === id(2) ? { creator: id(92), currentOwner: id(91) } : {}) }))
  const first = await f.scan.next(), last = await f.scan.next()
  expect(first.souls.map(s => s.soulId)).toEqual([id(1)]); expect(first.candidateStatus).toBe('PARTIAL')
  expect(last.souls.map(s => s.soulId)).toEqual([id(3), id(1)])
  expect(last).toMatchObject({ authoredCount: 2, verifiedCandidates: 3, candidateStatus: 'COMPLETE', readConsistency: 'PER_ASSET_CURRENT_READ_SET' })
  const requests = f.fetcher.mock.calls.map(([, args]) => JSON.parse(args!.body as string))
  expect(requests[0].variables.filter).toEqual({ type: `${id(90)}::soul::SoulState`, ownerKind: 'SHARED' })
  expect(requests[1].variables).toMatchObject({ checkpoint: 100, after: 'opaque:0' })
  await expect(f.scan.next()).rejects.toThrow('SOUL_AUTHORED_SCAN_ENDED')
})
it('sorts exact u64 times and limits only the display, never stops scanning after twelve matches', async () => {
  const f = setup([{ ids: Array.from({ length: 13 }, (_, i) => i + 1), more: true }, { ids: [14], more: false }])
  const original = f.read.getMockImplementation()!
  f.read.mockImplementation(async args => ({ ...await original(args), createdAtMs: String(18446744073709550000n + BigInt(args.stateId)) }))
  expect((await f.scan.next()).souls).toHaveLength(12)
  const result = await f.scan.next()
  expect(result).toMatchObject({ authoredCount: 14, verifiedCandidates: 14, candidateStatus: 'COMPLETE' })
  expect(result.souls.map(s => s.soulId)).toEqual(Array.from({ length: 12 }, (_, i) => id(14 - i)))
  expect(Object.isFrozen(result.souls[0].publicPreview.tags)).toBe(true)
})
it('retains a failed terminal candidate page for raw retry without losing it or repeating GraphQL', async () => {
  const f = setup([{ ids: [1, 2], more: false }]), original = f.read.getMockImplementation()!
  let failing = true
  f.read.mockImplementation(async args => { if (failing && args.stateId === id(2)) throw new Error('raw missing'); return original(args) })
  await expect(f.scan.next()).rejects.toThrow('raw missing')
  failing = false
  const result = await f.scan.next()
  expect(result).toMatchObject({ verifiedCandidates: 2, authoredCount: 2, candidateStatus: 'COMPLETE' })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
  expect(f.read.mock.calls.map(([args]) => args.stateId)).toEqual([id(1), id(2), id(1), id(2)])
})
it('keeps prior display snapshots unchanged across later failures and explicit same-page retry', async () => {
  const f = setup([{ ids: [1], more: true }, { ids: [2], more: false }])
  const first = await f.scan.next(); f.read.mockRejectedValueOnce(new Error('RPC down'))
  await expect(f.scan.next()).rejects.toThrow('RPC down')
  expect(first).toMatchObject({ authoredCount: 1, verifiedCandidates: 1, candidateStatus: 'PARTIAL' })
  expect((await f.scan.next()).souls.map(s => s.soulId)).toEqual([id(2), id(1)])
  expect(first.souls.map(s => s.soulId)).toEqual([id(1)])
})
it('a configured limit is not complete and cannot silently restart', async () => {
  const f = setup([{ ids: [1], more: true }], 1)
  expect((await f.scan.next()).candidateStatus).toBe('LIMIT_REACHED')
  await expect(f.scan.next()).rejects.toThrow('SOUL_AUTHORED_SCAN_ENDED')
})
it('complete empty discovery is distinct from a failed raw read', async () => {
  const f = setup([{ ids: [], more: false }])
  expect(await f.scan.next()).toMatchObject({ candidateStatus: 'COMPLETE', souls: [], authoredCount: 0, verifiedCandidates: 0 })
  expect(f.read).not.toHaveBeenCalled()
})
it('snapshots creator/deployment before awaiting and rejects overlapping page work', async () => {
  const f = setup([{ ids: [1], more: false }]), original = f.read.getMockImplementation()!
  let release!: () => void
  f.read.mockImplementation(async args => { await new Promise<void>(resolve => { release = resolve }); return original(args) })
  f.options.creator = id(92); f.deployment.originalPackageId = id(93)
  const reading = f.scan.next()
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1))
  await expect(f.scan.next()).rejects.toThrow('SOUL_AUTHORED_BUSY')
  release()
  expect((await reading).authoredCount).toBe(1)
  expect(f.read.mock.calls[0][0].deployment.originalPackageId).toBe(id(90))
})
it('cancellation never commits a partially read page and retry uses the same candidates', async () => {
  const f = setup([{ ids: [1], more: false }]), controller = new AbortController(), original = f.read.getMockImplementation()!
  f.read.mockImplementationOnce(async args => { controller.abort(new Error('cancelled')); return original(args) })
  await expect(f.scan.next({ signal: controller.signal })).rejects.toThrow('cancelled')
  expect((await f.scan.next()).verifiedCandidates).toBe(1)
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('limits raw concurrency to four and ignores old worker results after a failed page is retried', async () => {
  const f = setup([{ ids: [1, 2, 3, 4, 5], more: false }]), original = f.read.getMockImplementation()!
  let firstAttempt = true, fail!: () => void
  const late: Array<() => void> = []
  f.read.mockImplementation(async args => {
    if (!firstAttempt) return original(args)
    if (args.stateId === id(1)) await new Promise<void>((_, reject) => { fail = () => reject(new Error('first attempt failed')) })
    else await new Promise<void>(resolve => { late.push(resolve) })
    return { ...await original(args), name: 'stale attempt', createdAtMs: '18446744073709551615' }
  })
  const reading = f.scan.next()
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(4))
  expect(f.read.mock.calls.map(([args]) => args.stateId)).toEqual([id(1), id(2), id(3), id(4)])
  fail(); await expect(reading).rejects.toThrow('first attempt failed')
  firstAttempt = false
  const current = await f.scan.next()
  for (const resolve of late) resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(current.souls.map(s => s.soulId)).toEqual([id(5), id(4), id(3), id(2), id(1)])
  expect(current.souls.every(s => s.name !== 'stale attempt')).toBe(true)
  expect(current).toMatchObject({ verifiedCandidates: 5, authoredCount: 5 })
  expect(f.read).toHaveBeenCalledTimes(9)
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('rejects malformed creator before any network access', () => {
  const f = setup([])
  expect(() => createSoulAuthoredDiscovery({ ...f.options, creator: '0x0' })).toThrow('SOUL_AUTHORED_CREATOR_INVALID')
  expect(f.fetcher).not.toHaveBeenCalled()
})
