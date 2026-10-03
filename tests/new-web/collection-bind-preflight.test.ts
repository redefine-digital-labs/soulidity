import { afterEach, expect, it, vi } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { preflightCollectionBindTarget } from '../../packages/soulidity-sdk/src/collection-bind-preflight'
import { SoulPublicCollectionBcs, SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/soul-public-listing'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1)), digest = toBase58(new Uint8Array(32).fill(2))
const MAX = '18446744073709551615'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Real preflight -> canonical root reader -> actual gRPC client's raw BCS
 * transport. No Collection detail DTO, Profile, owned Right or Listing exists. */
function fixture(options: { current?: string; max?: string | null; sold?: boolean; tradeable?: boolean } = {}) {
  const deployment = { originalPackageId: id(1), chainIdentifier: '01010101', marketConfigId: id(2),
    paymentCoinType: SOUL_PUBLIC_USDC_TYPE, kioskRegistryId: id(3), personalKioskTypePackageId: id(4) }
  const walletAddress = id(10), collection = { id: id(20), version: '1', creator: walletAddress, extra_royalty_bps: 500,
    tradeable: options.tradeable ?? true, current_holder: options.sold ? id(11) : walletAddress,
    current_holder_kiosk_id: id(21), right_id: id(22), max_supply: options.max ?? null, current_supply: options.current ?? '0' }
  const raw = { objectId: collection.id, objectType: normalizeStructTag(`${deployment.originalPackageId}::collection::SoulCollection`),
    version: 2n, digest, owner: { kind: 3, version: 1n } as { kind: number; version?: bigint; address?: string },
    contents: { value: SoulPublicCollectionBcs.serialize(collection).toBytes() } }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: genesis })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation((async (args: { requests: Array<{ objectId: string }> }) => ({ response: {
    objects: args.requests.map(request => ({ result: request.objectId === collection.id
      ? { oneofKind: 'object', object: structuredClone(raw) } : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const fetcher = vi.fn(() => { throw new Error('HTTP business API must not be called') }); vi.stubGlobal('fetch', fetcher)
  const abort = new AbortController(), params = { client, deployment, walletAddress, collectionId: collection.id, signal: abort.signal }
  const put = () => { raw.contents.value = SoulPublicCollectionBcs.serialize(collection).toBytes() }
  return { params, deployment, collection, raw, client, chain, batch, fetcher, abort, put }
}

it.each([{ sold: false, tradeable: true }, { sold: true, tradeable: true }, { sold: true, tradeable: false }])(
  'creator binding remains available with sold=$sold / Right tradeable=$tradeable and needs no global scan', async options => {
    const f = fixture(options), result = await preflightCollectionBindTarget(f.params)
    expect(result).toEqual({ collectionId: f.collection.id, creatorAddress: f.collection.creator, walletAddress: f.params.walletAddress,
      currentSupply: '0', maxSupply: null, collectionVersion: '2', collectionDigest: digest, notTransactionAuthorization: true })
    expect(Object.isFrozen(result)).toBe(true); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.chain).toHaveBeenCalledOnce()
    expect(f.batch.mock.calls.map(([args]) => args.requests.map(request => request.objectId))).toEqual([[f.collection.id], [f.collection.id]])
  })
it('an acquired Right holder is not the creator even when it owns the current holder Kiosk', async () => {
  const f = fixture({ sold: true }); f.params.walletAddress = f.collection.current_holder
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('Only the collection creator')
  expect(f.batch).toHaveBeenCalledTimes(2)
})
it.each([
  { current: '9007199254740992', max: '9007199254740993' },
  { current: '18446744073709551614', max: MAX },
  { current: '18446744073709551614', max: null },
])('preserves exact one-slot capacity above Number.MAX_SAFE_INTEGER: %j', async options => {
  const f = fixture(options), result = await preflightCollectionBindTarget(f.params)
  expect(result.currentSupply).toBe(options.current); expect(result.maxSupply).toBe(options.max)
})
it.each([
  { current: '9007199254740993', max: '9007199254740993' },
  { current: MAX, max: MAX }, { current: MAX, max: null },
])('rejects full or u64-exhausted capacity before any payment: %j', async options => {
  const f = fixture(options)
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('Collection at maximum capacity')
  expect(f.fetcher).not.toHaveBeenCalled()
})
it.each(['walletAddress', 'collectionId'] as const)('invalid %s fails before any chain request', async field => {
  for (const invalid of ['', '0x1', id(0), id(12).toUpperCase(), null, undefined]) {
    const f = fixture(); Object.assign(f.params, { [field]: invalid })
    await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('COLLECTION_BIND_INVALID_ID')
    expect(f.chain).not.toHaveBeenCalled(); expect(f.batch).not.toHaveBeenCalled()
  }
})
it.each(['originalPackageId', 'chainIdentifier', 'marketConfigId', 'paymentCoinType', 'kioskRegistryId', 'personalKioskTypePackageId'] as const)(
  'requires the complete selected deployment field %s before RPC', async field => {
    const f = fixture(); delete (f.params.deployment as any)[field]
    await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('DEPLOYMENT_INVALID')
    expect(f.chain).not.toHaveBeenCalled()
  })
it('a wrong chain is a read failure, never creator absence or spare capacity', async () => {
  const f = fixture(); f.chain.mockResolvedValueOnce({ chainIdentifier: digest })
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('WRONG_CHAIN'); expect(f.batch).not.toHaveBeenCalled()
})
it.each(['type', 'objectId', 'version', 'digest', 'owner', 'birth', 'suffix', 'collectionId', 'zero-cap', 'over-cap', 'alias', 'schema'] as const)(
  'raw Collection %s corruption fails closed', async failure => {
    const f = fixture()
    if (failure === 'type') f.raw.objectType = `${id(99)}::collection::SoulCollection`
    if (failure === 'objectId') f.raw.objectId = id(99)
    if (failure === 'version') f.raw.version = 0n
    if (failure === 'digest') f.raw.digest = 'invalid'
    if (failure === 'owner') f.raw.owner = { kind: 1, address: f.params.walletAddress }
    if (failure === 'birth') f.raw.owner.version = 3n
    if (failure === 'suffix') f.raw.contents.value = new Uint8Array([...f.raw.contents.value, 0])
    if (failure === 'collectionId') { f.collection.id = id(99); f.put() }
    if (failure === 'zero-cap') { f.collection.max_supply = '0'; f.put() }
    if (failure === 'over-cap') { f.collection.current_supply = '2'; f.collection.max_supply = '1'; f.put() }
    if (failure === 'alias') { f.collection.right_id = f.collection.id; f.put() }
    if (failure === 'schema') { f.collection.version = '2'; f.put() }
    await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled()
  })
it.each([5, 7, 13, 14])('gRPC code %s cannot be reported as a verified empty Collection', async code => {
  const f = fixture(); f.batch.mockResolvedValueOnce({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } } as any)
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it.each(['contents', 'version', 'digest', 'owner'] as const)('a %s change on the final root read requires an explicit retry', async changed => {
  const f = fixture(), original = f.batch.getMockImplementation()!; let calls = 0
  f.batch.mockImplementation(((...args: any[]) => {
    if (++calls === 2) {
      if (changed === 'contents') { f.collection.current_supply = '1'; f.put() }
      if (changed === 'version') f.raw.version++
      if (changed === 'digest') f.raw.digest = toBase58(new Uint8Array(32).fill(3))
      if (changed === 'owner') f.raw.owner.version = 2n
    }
    return original(...args as Parameters<typeof original>)
  }) as any)
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('CHANGED_RETRY')
  expect((await preflightCollectionBindTarget(f.params)).currentSupply).toBe(changed === 'contents' ? '1' : '0')
})
it('captures wallet, Collection, client and complete deployment before awaiting chain identity', async () => {
  const f = fixture(), before = structuredClone(f.deployment), pending = preflightCollectionBindTarget(f.params)
  f.params.walletAddress = id(99); f.params.collectionId = id(98); f.params.client = {} as SuiGrpcClient
  f.params.deployment.originalPackageId = id(97); f.params.deployment.marketConfigId = id(96)
  const result = await pending
  expect(result).toMatchObject({ collectionId: id(20), walletAddress: id(10) })
  expect(f.batch.mock.calls[0][0].requests[0].objectId).toBe(id(20)); expect(before.originalPackageId).toBe(id(1))
})
it('already-cancelled preflight cannot start any RPC', async () => {
  const f = fixture(); f.abort.abort(new Error('draft replaced'))
  await expect(preflightCollectionBindTarget(f.params)).rejects.toThrow('draft replaced'); expect(f.chain).not.toHaveBeenCalled()
})
it('caller cancellation bounds an uncooperative raw RPC and discards its late result', async () => {
  const f = fixture(); let finish!: (value: any) => void
  f.batch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
  const work = preflightCollectionBindTarget(f.params), failed = expect(work).rejects.toThrow('draft replaced')
  await vi.waitFor(() => expect(f.batch).toHaveBeenCalledOnce()); f.abort.abort(new Error('draft replaced')); await failed
  finish({ response: { objects: [{ result: { oneofKind: 'object', object: f.raw } }] } }); await Promise.resolve()
  expect(f.batch).toHaveBeenCalledOnce()
})
it('raw-reader deadline still bounds requests when the caller lifetime has no deadline', async () => {
  const f = fixture(), deadline = new AbortController(), original = AbortSignal.timeout
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 25000 ? deadline.signal : original(ms))
  f.batch.mockImplementationOnce(() => new Promise(() => {}) as any)
  const work = preflightCollectionBindTarget(f.params), failed = expect(work).rejects.toThrow('read timed out')
  await vi.waitFor(() => expect(f.batch).toHaveBeenCalledOnce()); deadline.abort(new Error('read timed out')); await failed
  expect(f.abort.signal.aborted).toBe(false)
})
