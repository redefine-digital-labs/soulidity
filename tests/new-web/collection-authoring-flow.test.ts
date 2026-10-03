import { expect, it, vi } from 'vitest'
import { advanceCollectionAuthoring } from '../../web/lib/soulidity/collection-authoring-flow'

// Controller transport fixture only: receipt authenticity is provided by the
// production wallet verifier, not by these substituted outcomes.
function fixture(count: number) {
  let head: any = null, history: any[] = [], serial = 0, failAt: number | null = null
  const proofs = new Map<string, any>(), kiosk = { kind: 'EXISTING', kioskId: 'kiosk', capId: 'cap' }
  const preparation: any = { manifest: { request: { collection: { maxSupply: '100' }, mints: Array.from({ length: count }, () => ({})) } },
    preparation: { manifest: { files: Array.from({ length: count * 2 + 1 }, () => ({})) } } }
  const journal: any = { read: async () => head, history: async () => [...history].reverse() }
  const accept = vi.fn(async () => {})
  const query = vi.fn(async (r: any) => proofs.get(r.packet.digest))
  const run = vi.fn(async (step: any, options: any = {}) => {
    if (head && !options.startNew) { const p = proofs.get(head.packet.digest); if (p.status === 'SUCCEEDED') await accept(head); return { ...p, record: head } }
    if (head) {
      expect(options.expectedPacket).toMatchObject({ bytes: head.packet.bytes, digest: head.packet.digest })
      history.push(head)
    }
    const digest = `tx-${++serial}`, failed = step.kind === 'MINT' && step.chunk.mintIndices[0] === failAt
    head = { plan: { step }, packet: { digest, bytes: `bytes-${serial}`, phase: failed ? 'FAILED' : 'SUCCEEDED' } }
    const indices = step.kind === 'MINT' ? step.chunk.mintIndices : []
    const proof = failed ? { status: 'FAILED' } : { status: 'SUCCEEDED', receipt: {
      business: { transactionDigest: digest, stage: step.kind, collection: step.kind === 'REGISTER'
        ? { collectionId: 'collection', rightId: 'right', listingId: 'listing' } : null,
        mints: indices.map((mintIndex: number) => ({ mintIndex })) },
      consumption: step.kind === 'REGISTER' ? null : { indices: [...(step.chunk.includePublicFiles ? [0] : []), ...indices.flatMap((i: number) => [i * 2 + 1, i * 2 + 2])] },
    } }
    proofs.set(digest, proof); if (!failed) await accept(head)
    return { ...proof, record: head }
  })
  const progress = vi.fn(), resolveKiosk = vi.fn(async () => kiosk)
  const params: any = { preparation, journal, execution: { query, run, accept }, key: 'key', signal: new AbortController().signal,
    queryOnly: false, resolveKiosk, progress }
  return { params, run, query, accept, progress, resolveKiosk, proofs, head: () => head, history: () => history,
    fail: (index: number | null) => { failAt = index }, advance: (extra = {}) => advanceCollectionAuthoring({ ...params, ...extra }) }
}
it('launches all 23 rows in ordered original-size chunks, certifies public files only once and returns REGISTER Collection IDs', async () => {
  const f = fixture(23), result = await f.advance()
  expect(result.result).toMatchObject({ collectionOnChainId: 'collection', rightOnChainId: 'right', listingStatus: 'listed', soulCount: 23 })
  const minted = f.run.mock.calls.filter(([s, o]) => s.kind === 'MINT' && o?.startNew).map(([s]) => s.chunk)
  expect(minted.map(c => c.mintIndices.length)).toEqual([10, 10, 3])
  expect(minted.map(c => c.includePublicFiles)).toEqual([true, false, false])
  expect(minted.every(c => c.collectionObjectId === 'collection')).toBe(true)
  expect(f.progress).toHaveBeenLastCalledWith(23, 23)
})
it('empty Collection still certifies the cover before completion', async () => {
  const f = fixture(0), result = await f.advance()
  expect(result.result?.soulCount).toBe(0)
  expect(f.run.mock.calls.some(([s]) => s.kind === 'MINT' && s.chunk.mintIndices.length === 0 && s.chunk.includePublicFiles)).toBe(true)
})
it('failed second chunk stops; explicit retry preserves ten completed rows and original registration', async () => {
  const f = fixture(23); f.fail(10)
  expect((await f.advance()).pending?.status).toBe('FAILED')
  const failed = f.head(); f.fail(null)
  const result = await f.advance({ retryPacket: { ...failed.packet } })
  expect(result.result?.soulCount).toBe(23)
  const allocations = f.run.mock.calls.filter(([, o]) => o?.startNew).map(([s]) => s)
  expect(allocations.filter(s => s.kind === 'REGISTER')).toHaveLength(0)
  expect(allocations.filter(s => s.kind === 'MINT' && s.chunk.mintIndices[0] === 0)).toHaveLength(1)
})
it('query-only re-proves partial progress without accepting or signing another packet', async () => {
  const f = fixture(23); f.fail(10); await f.advance()
  f.run.mockClear(); f.accept.mockClear()
  const result = await f.advance({ queryOnly: true })
  expect(result.result).toBeNull(); expect(result.pending?.status).toBe('FAILED')
  expect(f.progress).toHaveBeenLastCalledWith(10, 23); expect(f.run).not.toHaveBeenCalled(); expect(f.accept).not.toHaveBeenCalled()
})
it('cold resume retains proved completed rows when the saved next chunk still fails', async () => {
  const f = fixture(23); f.fail(10); await f.advance()
  // A reopened page starts with no in-memory progress. Retained journal records,
  // not the previous hook state, must supply the ten already completed Souls.
  f.progress.mockClear(); f.run.mockClear()
  const result = await f.advance()
  expect(result.pending?.status).toBe('FAILED')
  expect(result.result).toBeNull()
  expect(f.progress).toHaveBeenLastCalledWith(10, 23)
  expect(f.run.mock.calls.every(([step]) => step.kind === 'MINT' && step.chunk.mintIndices[0] === 10)).toBe(true)
  const failed = f.head()
  f.progress.mockClear(); f.run.mockClear()
  const retry = await f.advance({ retryPacket: { ...failed.packet } })
  expect(retry.pending?.status).toBe('FAILED')
  expect(f.progress).toHaveBeenLastCalledWith(10, 23)
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.run.mock.calls[0][0].chunk.mintIndices).toEqual(Array.from({ length: 10 }, (_, i) => i + 10))
  // Once the remaining batch succeeds, continuation never rebuilds the first ten.
  f.fail(null); f.run.mockClear()
  expect((await f.advance({ retryPacket: { ...f.head().packet } })).result?.soulCount).toBe(23)
  expect(f.run.mock.calls.every(([step]) => step.kind === 'MINT' && step.chunk.mintIndices[0] >= 10)).toBe(true)
})
it('unknown current transaction is retained and cannot make Collection success', async () => {
  const f = fixture(1); f.fail(0); await f.advance()
  f.proofs.set(f.head().packet.digest, { status: 'MISSING' }); f.head().packet.phase = 'SIGNED'
  const result = await f.advance()
  expect(result.pending?.status).toBe('MISSING'); expect(result.result).toBeNull()
})
it('rejects contradictory historical success instead of skipping a completed chunk', async () => {
  const f = fixture(23); f.fail(10); await f.advance()
  const completed = f.history().find(r => r.plan.step.kind === 'MINT')
  f.proofs.set(completed.packet.digest, { status: 'MISSING' })
  await expect(f.advance()).rejects.toThrow('terminal history contradicts')
})
it('query-only rejects archived SUCCEEDED becoming FAILED', async () => {
  const f = fixture(23); f.fail(10); await f.advance()
  const completed = f.history().find(r => r.plan.step.kind === 'MINT')
  f.proofs.set(completed.packet.digest, { status: 'FAILED' })
  await expect(f.advance({ queryOnly: true })).rejects.toThrow('terminal history contradicts')
})
