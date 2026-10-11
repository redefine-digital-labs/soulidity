import { beforeEach, describe, expect, it, vi } from 'vitest'
import { marketBuyFixture, bid } from './fixtures/market-buy-operation'

const mocks = vi.hoisted(() => ({ client: vi.fn(), target: vi.fn(), buyTarget: vi.fn(), snapshot: vi.fn(), adapter: vi.fn() }))
vi.mock('@/lib/animacraft/native-receive', () => ({ createNativeReceiveClient: mocks.client, readNativeReceiveTarget: mocks.target }))
vi.mock('@/lib/animacraft/native-market-buy-snapshot', () => ({ readNativeMarketBuyTarget: mocks.buyTarget, readNativeMarketBuySnapshot: mocks.snapshot }))
vi.mock('@/lib/animacraft/market-buy-operation-adapter', () => ({ createMarketBuyOperationAdapter: mocks.adapter }))
import { createNativeAgentPurchaseServices } from '../../web/lib/animacraft/native-agent-purchase-services'

describe('native agent services reuse the human reader and transaction adapter', () => {
  let fixture: Awaited<ReturnType<typeof marketBuyFixture>>
  const client = { ledgerService: {} }
  const target = { exact: 'current-native-release' }
  const buyTarget = { exact: 'current-native-market' }
  beforeEach(async () => {
    vi.resetAllMocks()
    fixture = await marketBuyFixture()
    mocks.client.mockReturnValue(client)
    mocks.target.mockReturnValue(target)
    mocks.buyTarget.mockReturnValue(buyTarget)
    mocks.snapshot.mockResolvedValue(structuredClone(fixture.snapshot))
    mocks.adapter.mockImplementation(input => ({ historicalQuery: 'adapter-owned', ...input }))
  })
  const scope = (value: typeof fixture) => ({ soulId: value.snapshot.soulId,
    stateId: value.snapshot.stateId, listingId: value.snapshot.listingId, buyer: value.snapshot.buyer })

  it('constructs historical recovery without reading new-purchase target settings', () => {
    const service = createNativeAgentPurchaseServices(scope(fixture))
    expect(service.adapter).toMatchObject({ client, historicalQuery: 'adapter-owned' })
    expect(mocks.target).not.toHaveBeenCalled()
    expect(mocks.buyTarget).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('passes the same strict reader, observed snapshot and bound buyer into the shared adapter', async () => {
    const abort = new AbortController()
    const sync = vi.fn()
    const service = createNativeAgentPurchaseServices(scope(fixture), abort.signal, fixture.snapshot, sync)
    const config = mocks.adapter.mock.calls[0][0]
    expect(config.observed).toBe(fixture.snapshot)
    expect(config.read).toBe(service.read)
    expect(config.sync).toBe(sync)
    expect(config.getAddress()).toBe(fixture.snapshot.buyer)
    expect(await service.read()).toEqual(fixture.snapshot)
    expect(mocks.client).toHaveBeenCalledWith(abort.signal)
    expect(mocks.buyTarget).toHaveBeenCalledWith(target)
    expect(mocks.snapshot).toHaveBeenCalledWith(client, target, buyTarget, scope(fixture), abort.signal)
    abort.abort()
    expect(config.getAddress()).toBeNull()
  })

  it('never signs or silently syncs on the server when those boundaries are not configured', async () => {
    createNativeAgentPurchaseServices(scope(fixture))
    const config = mocks.adapter.mock.calls[0][0]
    await expect(config.sign()).rejects.toThrow('bound external wallet')
    await expect(config.sync()).rejects.toThrow('not configured')
  })

  it('freezes request scope against later caller mutation and uses a verified retry listing hint', async () => {
    const input = scope(fixture)
    const service = createNativeAgentPurchaseServices(input)
    input.buyer = bid(100)
    input.soulId = bid(101)
    await service.read(bid(102))
    expect(mocks.snapshot.mock.calls[0][3]).toEqual({ ...scope(fixture), listingId: bid(102) })
    expect(mocks.adapter.mock.calls[0][0].getAddress()).toBe(fixture.snapshot.buyer)
  })

  it.each(['soulId', 'stateId', 'buyer'] as const)('rejects a reader response for another %s', async key => {
    const service = createNativeAgentPurchaseServices(scope(fixture))
    mocks.snapshot.mockResolvedValue({ ...fixture.snapshot, [key]: bid(120) })
    await expect(service.read()).rejects.toThrow('scope mismatch')
  })

  it('rejects a malformed reader snapshot rather than exposing an unchecked quote', async () => {
    const service = createNativeAgentPurchaseServices(scope(fixture))
    mocks.snapshot.mockResolvedValue({ ...fixture.snapshot, priceAtomic: '-1' })
    await expect(service.read()).rejects.toThrow()
  })

  it('stops before target/RPC reads when the request has been aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const service = createNativeAgentPurchaseServices(scope(fixture), abort.signal)
    await expect(service.read()).rejects.toThrow()
    expect(mocks.target).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('does not return a late snapshot after the request aborts', async () => {
    const abort = new AbortController()
    const service = createNativeAgentPurchaseServices(scope(fixture), abort.signal)
    mocks.snapshot.mockImplementation(async () => { abort.abort(); return fixture.snapshot })
    await expect(service.read()).rejects.toThrow()
  })
})
