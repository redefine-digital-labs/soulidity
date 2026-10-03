import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'
import { ChainObjectDiscoveryError, createChainObjectDiscovery, type ChainObjectDiscoveryOptions } from '../../packages/soulidity-sdk/src/chain-object-discovery'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
// Official mainnet GraphQL observed 2026-09-10. This fixture is not a live-read or BCS proof.
const genesis = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'
const endpoint = 'https://graphql.example.com/graphql'
function options(overrides: Partial<ChainObjectDiscoveryOptions> = {}): ChainObjectDiscoveryOptions {
  return { endpoint, expectedChainIdentifier: '35834a8a', scope: { packageId: id(42), type: `${id(42)}::soul::SoulState` },
    pageSize: 2, maxPages: 4, maxObjects: 8, timeoutMs: 1000, ...overrides }
}
function page(ids = [id(1), id(2)], more = true, cursor: string | null = 'opaque:first', checkpoint = 321042093) {
  return { data: { chainIdentifier: genesis, checkpoint: { sequenceNumber: checkpoint,
    query: { objects: { nodes: ids.map(address => ({ address })), pageInfo: { hasNextPage: more, endCursor: cursor } } } } } }
}
const response = (value: unknown = page()) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const body = (fetcher: ReturnType<typeof vi.fn>, index: number) => JSON.parse(fetcher.mock.calls[index][1].body)
function sequence(...values: unknown[]) {
  const fetcher = vi.fn<typeof fetch>()
  for (const value of values) fetcher.mockImplementationOnce(async () => response(value))
  return fetcher
}
async function rejectPage(value: unknown, code = 'RESPONSE_INVALID') {
  const fetcher = sequence(value)
  await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
}
afterEach(() => vi.useRealTimers())

describe('explicit release-scoped candidate discovery', () => {
  it('binds opaque pagination to one checkpoint and reports IDs only, never asset authority', async () => {
    const cursor = 'opaque/+==:不可解析'
    const fetcher = sequence(page([id(1), id(2)], true, cursor), page([id(3)], false, 'opaque:last'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    const first = await scan.next(), last = await scan.next()
    expect(first).toEqual({ ids: [id(1), id(2)], source: { endpoint, chainIdentifier: '35834a8a', checkpoint: 321042093,
      scope: options().scope, authority: 'CANDIDATE_IDS_ONLY' },
    page: { status: 'PARTIAL', hasNextPage: true, endCursor: cursor, pagesRead: 1, objectsRead: 2 } })
    expect(last.page).toEqual({ status: 'COMPLETE', hasNextPage: false, endCursor: 'opaque:last', pagesRead: 2, objectsRead: 3 })
    expect(body(fetcher, 0).variables).toEqual({ checkpoint: null, filter: { type: options().scope.type }, first: 2, after: null })
    expect(body(fetcher, 1).variables).toEqual({ checkpoint: 321042093, filter: { type: options().scope.type }, first: 2, after: cursor })
    expect(body(fetcher, 0).query).toContain('checkpoint(sequenceNumber:$checkpoint)')
    expect(body(fetcher, 0).query).toContain('query { objects(')
    expect(fetcher.mock.calls[0]).toEqual([endpoint, expect.objectContaining({ method: 'POST', mode: 'cors', credentials: 'omit',
      cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json' } })])
    await expect(scan.next()).rejects.toMatchObject({ code: 'COMPLETE' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.ids)).toBe(true)
    expect(Object.isFrozen(first.source.scope)).toBe(true)
    expect(Object.isFrozen(first.page)).toBe(true)
  })
  it.each(['ADDRESS', 'OBJECT', 'SHARED', 'IMMUTABLE'] as const)('uses exact %s owner filter, not creator inference', async kind => {
    const owner = kind === 'ADDRESS' || kind === 'OBJECT' ? { kind, address: id(9) } : { kind }
    const fetcher = sequence(page([], false, null))
    const out = await createChainObjectDiscovery(options({ fetch: fetcher, scope: { ...options().scope, owner } })).next()
    expect(body(fetcher, 0).variables.filter).toEqual({ type: options().scope.type, ownerKind: kind,
      ...(kind === 'ADDRESS' || kind === 'OBJECT' ? { owner: id(9) } : {}) })
    expect(out.page.status).toBe('COMPLETE')
    expect(Object.isFrozen(out.source.scope.owner)).toBe(true)
  })
  it('accepts an exact generic type but no package-wide query', async () => {
    const fetcher = sequence(page([], false, null))
    const scope = { packageId: id(2), type: `${id(2)}::coin::Coin<${id(2)}::sui::SUI>` }
    await createChainObjectDiscovery(options({ fetch: fetcher, scope })).next()
    expect(body(fetcher, 0).variables.filter).toEqual({ type: scope.type })
  })
  it('does not hardcode an official host or pathname for an explicit credential-free provider', async () => {
    const fetcher = sequence(page([], false, null)), configuredEndpoint = 'https://sui.provider.example/v2/mainnet'
    const out = await createChainObjectDiscovery(options({ fetch: fetcher, endpoint: configuredEndpoint })).next()
    expect(out.source.endpoint).toBe(configuredEndpoint)
    expect(fetcher.mock.calls[0][0]).toBe(configuredEndpoint)
  })
  it.each([
    ['missing URL', { endpoint: undefined }], ['http', { endpoint: 'http://graphql.example.com/graphql' }],
    ['userinfo', { endpoint: 'https://user:secret@graphql.example.com/graphql' }],
    ['query key', { endpoint: `${endpoint}?apiKey=secret` }], ['fragment', { endpoint: `${endpoint}#secret` }],
    ['relative', { endpoint: '/graphql' }], ['loopback', { endpoint: 'https://127.0.0.1/graphql' }],
    ['local', { endpoint: 'https://service.local/graphql' }], ['noncanonical URL', { endpoint: 'https://GRAPHQL.example.com/graphql' }],
    ['missing chain', { expectedChainIdentifier: undefined }], ['base58 is not release tuple', { expectedChainIdentifier: genesis }],
    ['upper hex', { expectedChainIdentifier: '35834A8A' }], ['short chain', { expectedChainIdentifier: '3583' }],
    ['zero page size', { pageSize: 0 }], ['51 page size', { pageSize: 51 }], ['float page size', { pageSize: 1.5 }],
    ['zero max pages', { maxPages: 0 }], ['unbounded pages', { maxPages: 201 }],
    ['zero objects', { maxObjects: 0 }], ['unbounded objects', { maxObjects: 10001 }],
    ['zero timeout', { timeoutMs: 0 }], ['unbounded timeout', { timeoutMs: 40001 }],
  ])('rejects invalid config %s before any fetch', (_name, override) => {
    const fetcher = vi.fn()
    expect(() => createChainObjectDiscovery(options({ fetch: fetcher, ...override } as Partial<ChainObjectDiscoveryOptions>)))
      .toThrow(ChainObjectDiscoveryError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { ...options().scope, packageId: id(43) }, { ...options().scope, packageId: '0x2' },
    { ...options().scope, type: id(42) }, { ...options().scope, type: `${id(42)}::soul` },
    { ...options().scope, type: `${id(42)}::soul::SoulState<wat>` },
    { ...options().scope, type: `${id(42)}::soul::SoulState<@named/pkg::foo::Bar>` },
    { ...options().scope, type: `${id(42)}::soul::SoulState<0x2::sui::SUI>` },
    { ...options().scope, type: `${id(42)}::soul::SoulState;query` },
    { ...options().scope, creator: id(9) }, { ...options().scope, owner: { kind: 'ADDRESS' } },
    { ...options().scope, owner: { kind: 'SHARED', address: id(9) } },
    { ...options().scope, owner: { kind: 'CREATOR', address: id(9) } },
    { ...options().scope, owner: { kind: 'OBJECT', address: '0x9' } },
    { ...options().scope, owner: { kind: 'OBJECT', address: id(9), hidden: true } },
  ])('rejects widened or malformed release scope %#', scope => {
    expect(() => createChainObjectDiscovery(options({ scope: scope as ChainObjectDiscoveryOptions['scope'] })))
      .toThrow(ChainObjectDiscoveryError)
  })
  it('snapshots caller config before async work and freezes returned nested owner', async () => {
    let resolve!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>(() => new Promise(done => { resolve = done }))
    const config = options({ fetch: fetcher, scope: { ...options().scope, owner: { kind: 'ADDRESS', address: id(9) } } })
    const scan = createChainObjectDiscovery(config), result = scan.next()
    config.scope.type = `${id(42)}::soul::Other`
    ;(config.scope.owner as { address: string }).address = id(10)
    config.endpoint = 'https://other.example.com/graphql'
    config.expectedChainIdentifier = '00000000'
    resolve(response(page([], false, null)))
    const out = await result
    expect(out.source.endpoint).toBe(endpoint)
    expect(out.source.scope.type).toBe(options().scope.type)
    expect(out.source.scope.owner).toEqual({ kind: 'ADDRESS', address: id(9) })
  })
})

describe('bounded snapshot progress', () => {
  it.each([
    { maxPages: 1, maxObjects: 8 }, { maxPages: 4, maxObjects: 2 },
  ])('explicit limits report incomplete, not successful completion (%j)', async limits => {
    const fetcher = sequence(page())
    const scan = createChainObjectDiscovery(options({ fetch: fetcher, ...limits }))
    expect((await scan.next()).page).toMatchObject({ status: 'LIMIT_REACHED', hasNextPage: true })
    await expect(scan.next()).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('shrinks the last requested page to remaining object budget without silently truncating data', async () => {
    const fetcher = sequence(page(), page([id(3)], true, 'last'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher, maxObjects: 3 }))
    await scan.next()
    expect((await scan.next()).page).toMatchObject({ status: 'LIMIT_REACHED', objectsRead: 3 })
    expect(body(fetcher, 1).variables.first).toBe(1)
  })
  it('reports complete if the provider reaches actual end exactly at a configured bound', async () => {
    const fetcher = sequence(page([id(1), id(2)], false))
    expect((await createChainObjectDiscovery(options({ fetch: fetcher, maxPages: 1 })).next()).page.status).toBe('COMPLETE')
  })
  it('rejects a changed checkpoint and permits explicit retry of the unchanged old cursor', async () => {
    const fetcher = sequence(page(), page([id(3)], false, 'next', 321042094), page([id(3)], false, 'next'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await scan.next()
    await expect(scan.next()).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' })
    const recovered = await scan.next()
    expect(body(fetcher, 2)).toEqual(body(fetcher, 1))
    expect(recovered.page).toMatchObject({ pagesRead: 2, objectsRead: 3, status: 'COMPLETE' })
  })
  it('rejects in-page duplicate IDs atomically', async () => rejectPage(page([id(1), id(1)]), 'DUPLICATE_ID'))
  it('rejects previously committed IDs even when the cursor changes', async () => {
    const fetcher = sequence(page(), page([id(3), id(1)], false, 'different'), page([id(3)], false, 'different'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await scan.next()
    await expect(scan.next()).rejects.toMatchObject({ code: 'DUPLICATE_ID' })
    expect((await scan.next()).ids).toEqual([id(3)])
  })
  it('rejects cursor cycles even with otherwise distinct object IDs', async () => {
    const fetcher = sequence(page([id(1)], true, 'a'), page([id(2)], true, 'b'), page([id(3)], true, 'a'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await scan.next(); await scan.next()
    await expect(scan.next()).rejects.toMatchObject({ code: 'CURSOR_NOT_ADVANCING' })
  })
  it.each([
    page([], true, null), page([], false, 'nonempty-cursor'), page([id(1)], true, null),
  ])('rejects no-progress pagination %#', async value => rejectPage(value, 'CURSOR_NOT_ADVANCING'))
})

describe('failure is visible and never manufactures an empty or restarted scan', () => {
  it.each([429, 500, 503])('preserves HTTP %i as a failure without any automatic retry', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret server detail', { status }))
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code: 'HTTP', httpStatus: status })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([null, page().data])('rejects HTTP200 errors even with partial data (%#)', async data => {
    await rejectPage({ data, errors: [{ message: 'cursor expired; secret internal text' }] }, 'GRAPHQL')
  })
  it('does not reset or merge after an expired cursor and does not leak server messages', async () => {
    const fetcher = sequence(page(), { data: null, errors: [{ message: 'expired: private upstream details' }] }, page([id(3)], false, 'next'))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await scan.next()
    await expect(scan.next()).rejects.toMatchObject({ code: 'GRAPHQL', message: 'GraphQL reported discovery errors; no page was accepted' })
    await scan.next()
    expect(body(fetcher, 2)).toEqual(body(fetcher, 1))
    expect(body(fetcher, 2).variables.checkpoint).toBe(321042093)
  })
  it.each(['35834a8a', 'not-base58', toBase58(new Uint8Array(31)), toBase58(new Uint8Array(32))])('rejects wrong or malformed chain identity %#', async chainIdentifier => {
    const value = page(); value.data.chainIdentifier = chainIdentifier
    await rejectPage(value, 'WRONG_CHAIN')
  })
  it.each([
    null, [], {}, { errors: 'bad' }, { data: null }, { data: { chainIdentifier: genesis, checkpoint: null } },
  ])('rejects malformed GraphQL response %#', async value => rejectPage(value))
  it.each([-1, 0.5, '321042093', Number.MAX_SAFE_INTEGER + 1, null])('rejects malformed checkpoint %j', async sequenceNumber => {
    const value: any = page(); value.data.checkpoint.sequenceNumber = sequenceNumber
    await rejectPage(value)
  })
  it.each([
    (o: any) => { o.nodes = null }, (o: any) => { o.nodes = [{ address: id(1) }, { address: id(2) }, { address: id(3) }] },
    (o: any) => { o.nodes[0].address = '0x1' }, (o: any) => { o.nodes[0].address = id(0) },
    (o: any) => { o.nodes[0].address = `0x${'A'.repeat(64)}` }, (o: any) => { o.nodes[0] = null },
    (o: any) => { o.pageInfo = null }, (o: any) => { o.pageInfo.hasNextPage = 'false' },
    (o: any) => { delete o.pageInfo.endCursor }, (o: any) => { o.pageInfo.endCursor = '' },
    (o: any) => { o.pageInfo.endCursor = 'x'.repeat(4097) },
  ])('rejects malformed bounded object page %#', async mutate => {
    const value = page(); mutate(value.data.checkpoint.query.objects)
    await rejectPage(value)
  })
  it.each(['{truncated', new Uint8Array([255, 254])])('rejects invalid UTF8/JSON %#', async data => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(data))
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
  it.each([undefined, '1', '131073'])('bounds streamed bytes even with missing/false Content-Length (%s)', async length => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(131073), { headers: length ? { 'content-length': length } : {} }))
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })
  it('rejects an absent body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null))
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
  it('sanitizes transport errors and retries from the unchanged first-page checkpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('secret URL')).mockResolvedValueOnce(response(page([], false, null)))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await expect(scan.next()).rejects.toMatchObject({ code: 'TRANSPORT', message: 'GraphQL discovery transport failed; no page was accepted' })
    await scan.next()
    expect(body(fetcher, 1)).toEqual(body(fetcher, 0))
  })
})

describe('cancellation and concurrency', () => {
  it.each([
    ['non-success HTTP', { status: 503 }, 'HTTP'],
    ['oversized declared body', { headers: { 'content-length': '131073' } }, 'RESPONSE_TOO_LARGE'],
  ] as const)('cancels an unread %s body without committing pagination', async (_name, init, code) => {
    const cancel = vi.fn()
    const unread = new ReadableStream<Uint8Array>({ cancel })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(unread, init))
      .mockResolvedValueOnce(response(page([], false, null)))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    await expect(scan.next()).rejects.toMatchObject({ code })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect((await scan.next()).page).toMatchObject({ pagesRead: 1, objectsRead: 0 })
    expect(body(fetcher, 1)).toEqual(body(fetcher, 0))
  })
  it.each(['TIMEOUT', 'ABORTED'] as const)('cancels a late Response after %s even when fetch ignores abort', async code => {
    vi.useFakeTimers()
    let resolve!: (value: Response) => void
    const cancel = vi.fn(), controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValueOnce(response(page([], false, null)))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher, timeoutMs: 20 }))
    const first = scan.next({ signal: controller.signal }), rejected = expect(first).rejects.toMatchObject({ code })
    if (code === 'TIMEOUT') await vi.advanceTimersByTimeAsync(20)
    else controller.abort()
    await rejected
    // The prior HTTP request resolves only after a retry has already succeeded.
    expect((await scan.next()).page).toMatchObject({ pagesRead: 1, objectsRead: 0, status: 'COMPLETE' })
    const lateBody = new ReadableStream<Uint8Array>({ cancel }), read = vi.spyOn(lateBody, 'getReader')
    resolve(new Response(lateBody))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
    expect(body(fetcher, 1)).toEqual(body(fetcher, 0))
    await expect(scan.next()).rejects.toMatchObject({ code: 'COMPLETE' })
  })
  it('preserves the HTTP error even when response-body cancellation itself rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cleanup failure')))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 503 }))
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next()).rejects.toMatchObject({ code: 'HTTP', httpStatus: 503 })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('rejects an already-cancelled call without fetch', async () => {
    const fetcher = vi.fn(), controller = new AbortController(); controller.abort()
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not miss an abort fired synchronously inside a transport ignoring the signal', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(() => { controller.abort(); return new Promise(() => {}) })
    await expect(createChainObjectDiscovery(options({ fetch: fetcher })).next({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('bounds a hung transport, rejects concurrent next, and never accepts its late page', async () => {
    vi.useFakeTimers()
    let resolve!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValueOnce(response(page([], false, null)))
    const scan = createChainObjectDiscovery(options({ fetch: fetcher, timeoutMs: 20 }))
    const first = scan.next(), rejected = expect(first).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(scan.next()).rejects.toMatchObject({ code: 'BUSY' })
    await vi.advanceTimersByTimeAsync(20); await rejected
    resolve(response(page()))
    const next = await scan.next()
    expect(body(fetcher, 1)).toEqual(body(fetcher, 0))
    expect(next.page).toMatchObject({ objectsRead: 0, pagesRead: 1, status: 'COMPLETE' })
  })
  it('aborts a body stream and retains the same retry cursor', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(response(page([], false, null)))
    const controller = new AbortController(), scan = createChainObjectDiscovery(options({ fetch: fetcher }))
    const first = scan.next({ signal: controller.signal })
    const rejected = expect(first).rejects.toMatchObject({ code: 'ABORTED' })
    await Promise.resolve(); await Promise.resolve(); controller.abort()
    await rejected
    expect(cancelled).toBe(true)
    await scan.next()
    expect(body(fetcher, 1)).toEqual(body(fetcher, 0))
  })
  it('applies the deadline to an endless body, not only response headers', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream))
    const result = createChainObjectDiscovery(options({ fetch: fetcher, timeoutMs: 20 })).next()
    const rejected = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20); await rejected
    expect(cancelled).toBe(true)
  })
})
