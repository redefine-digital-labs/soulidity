import { afterEach, expect, it, vi } from 'vitest'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { createBrowserNativeReadSession } from '../../web/lib/animacraft/browser-native-artwork'
import { NativeRenderReadSet, readNativeRenderSource } from '../../web/lib/animacraft/native-render-source'
import { artworkWire } from './fixtures/browser-native-artwork'
import { nativeRenderSource500Fixture } from './fixtures/native-render-source'

const id = (index: number) => `0x${index.toString(16).padStart(64, '0')}`
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it('reads and finally verifies a real 500-slot source through the browser evidence session', async () => {
  const f = artworkWire(nativeRenderSource500Fixture())
  const session = createBrowserNativeReadSession(f.client, new AbortController().signal)
  const reads = new NativeRenderReadSet(session.client)
  const source = await readNativeRenderSource(session.client, f.target, f.renderInput, { readSet: reads })
  await reads.verify()
  await expect(session.finish(source)).resolves.toBe(source)
  expect(source.layers).toHaveLength(500)
  expect(source.selections).toEqual(f.selections)
  expect(f.batch.mock.calls.every(([request]) => request.requests!.length <= 50)).toBe(true)
  expect(new Set(f.batch.mock.calls.flatMap(([request]) => request.requests!.map(row => row.objectId))).size)
    .toBeGreaterThanOrEqual(2756)
  // Includes source verification, browser full-byte verification and replay of
  // every original batch; keep headroom within the unchanged 4096-call limit.
  expect(f.get.mock.calls.length + f.batch.mock.calls.length).toBeLessThan(1024)
  expect(f.execute).not.toHaveBeenCalled()
})

it('keeps a 500-slot read inside the deadline with simulated 50ms RPC latency and bounded concurrency', async () => {
  vi.useFakeTimers()
  const f = artworkWire(nativeRenderSource500Fixture())
  const get = f.get.getMockImplementation()!, batch = f.batch.getMockImplementation()!
  let active = 0, peak = 0
  async function delayed<T>(read: () => T) {
    active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 50)); return await read() }
    finally { active-- }
  }
  // This fixture supplies awaitable responses; the separate UnaryCall transport
  // regression covers reflection/headers, which this latency probe does not use.
  f.get.mockImplementation(((...args: Parameters<typeof get>) => delayed(() => get(...args))) as unknown as typeof get)
  f.batch.mockImplementation(((...args: Parameters<typeof batch>) => delayed(() => batch(...args))) as unknown as typeof batch)
  const session = createBrowserNativeReadSession(f.client, new AbortController().signal)
  const reads = new NativeRenderReadSet(session.client), started = Date.now()
  const pending = (async () => {
    const source = await readNativeRenderSource(session.client, f.target, f.renderInput, { readSet: reads })
    await reads.verify()
    await session.finish(source)
    return Date.now() - started
  })()
  const result = expect(pending).resolves.toBeLessThan(25000)
  await vi.advanceTimersByTimeAsync(25000)
  await result
  expect(active).toBe(0)
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(8)
})

function fixture(count: number) {
  const rows = new Map(Array.from({ length: count }, (_, index) => [id(index + 1), {
    objectId: id(index + 1), version: 1n, digest: '11111111111111111111111111111111',
    owner: { kind: 2, address: id(9999) }, objectType: '0x2::test::Object',
    contents: { value: new Uint8Array([1, 2, 3]) },
  }]))
  const get = vi.fn(async ({ objectId }: { objectId: string }) => ({ response: { object: structuredClone(rows.get(objectId)) } }))
  const batch = vi.fn(async ({ requests }: { requests: Array<{ objectId: string }> }) => ({ response: {
    objects: requests.map(({ objectId }) => ({ result: rows.has(objectId)
      ? { oneofKind: 'object' as const, object: structuredClone(rows.get(objectId)) }
      : { oneofKind: 'error' as const, error: { code: 5 } } })),
  } }))
  const controller = new AbortController()
  const client = { ledgerService: { getObject: get, batchGetObjects: batch }, core: {} } as unknown as SuiGrpcClient
  const session = createBrowserNativeReadSession(client, controller.signal)
  return { rows, get, batch, controller, session }
}

it('rechecks 2756 exact source objects inside the unchanged 4096-call budget', async () => {
  const f = fixture(2756)
  for (const objectId of f.rows.keys()) await f.session.client.ledgerService.getObject({ objectId })
  const value = { visibility: { valid: false }, selections: [null, { selection_index: '1' }] }
  await expect(f.session.finish(value)).resolves.toBe(value)
  expect(f.get).toHaveBeenCalledTimes(2756)
  expect(f.batch).toHaveBeenCalledTimes(56)
  expect(f.batch.mock.calls.every(([request]) => request.requests.length <= 50)).toBe(true)
  expect(f.batch.mock.calls.flatMap(([request]) => request.requests.map(row => row.objectId)))
    .toEqual([...f.rows.keys()])
})

it.each(['bytes', 'owner', 'version', 'missing', 'wrong-order', 'short', 'error'])
('still refuses %s drift in final batched evidence', async problem => {
  const f = fixture(2)
  for (const objectId of f.rows.keys()) await f.session.client.ledgerService.getObject({ objectId })
  if (problem === 'bytes') f.rows.get(id(1))!.contents.value[0] = 9
  if (problem === 'owner') f.rows.get(id(1))!.owner.address = id(9998)
  if (problem === 'version') f.rows.get(id(1))!.version = 2n
  if (problem === 'missing') f.rows.delete(id(1))
  const original = f.batch.getMockImplementation()!
  if (['wrong-order', 'short', 'error'].includes(problem)) f.batch.mockImplementation(async request => {
    const result = await original(request)
    if (problem === 'wrong-order') result.response.objects.reverse()
    if (problem === 'short') result.response.objects.pop()
    if (problem === 'error') result.response.objects[0] = { result: { oneofKind: 'error', error: { code: 14 } } }
    return result
  })
  await expect(f.session.finish({})).rejects.toThrow()
})

it('replays original optional absence without recursively replaying its verification batches', async () => {
  const f = fixture(1)
  await f.session.client.ledgerService.batchGetObjects({ requests: [{ objectId: id(1) }, { objectId: id(2) }] })
  await f.session.finish({})
  expect(f.batch.mock.calls.map(([request]) => request.requests.length)).toEqual([2, 1, 2])
  f.rows.set(id(2), { ...structuredClone(f.rows.get(id(1))!), objectId: id(2) })
  await expect(f.session.finish({})).rejects.toThrow('optional evidence changed')
})

it('aborts an uncooperative final batch and does not accept its late result', async () => {
  const f = fixture(1)
  await f.session.client.ledgerService.getObject({ objectId: id(1) })
  f.batch.mockImplementation(() => new Promise(() => {}))
  const pending = f.session.finish({})
  f.controller.abort(new Error('cancelled'))
  await expect(pending).rejects.toThrow('cancelled')
})

it('settles all eight in-flight verification batches before rejecting and starts no later group', async () => {
  vi.useFakeTimers()
  const f = fixture(401)
  for (const objectId of f.rows.keys()) await f.session.client.ledgerService.getObject({ objectId })
  const original = f.batch.getMockImplementation()!
  let calls = 0, settled = false
  f.batch.mockImplementation(async request => {
    const first = calls++ === 0
    await new Promise(resolve => setTimeout(resolve, first ? 10 : 50))
    if (first) throw new Error('first batch unavailable')
    return original(request)
  })
  const pending = f.session.finish({}).finally(() => { settled = true })
  const result = expect(pending).rejects.toThrow('first batch unavailable')
  await vi.advanceTimersByTimeAsync(10)
  expect(settled).toBe(false)
  expect(f.batch).toHaveBeenCalledTimes(8)
  await vi.advanceTimersByTimeAsync(40)
  await result
  expect(f.batch).toHaveBeenCalledTimes(8)
})
