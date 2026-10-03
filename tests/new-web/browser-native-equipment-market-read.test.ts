import { afterEach, expect, it, vi } from 'vitest'
import { nativeEquipmentMarketAuthorityFixture } from './fixtures/native-equipment-market-authority'
import { EquipmentBaseItemBcs } from '../../web/lib/animacraft/native-equipment'
import { getBrowserNativeEquipmentMarketConfig, readBrowserOwnedEquipmentMarket, readBrowserEquipmentMarketListing,
  type BrowserNativeEquipmentMarketConfig } from '../../web/lib/animacraft/browser-native-equipment-market-read'
import { readNativeReceiveTarget } from '../../web/lib/animacraft/native-receive'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
function fixture() {
  const f = nativeEquipmentMarketAuthorityFixture()
  f.set(id(84), EquipmentBaseItemBcs, item => { item.equip_lock = null })
  const config: BrowserNativeEquipmentMarketConfig = { target: { ...f.target, equipmentMarket: f.marketPin } }
  const env = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: f.target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: f.target.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(config.target) }
  const input = { rootId: f.rootId, itemId: id(84), kind: 'base' as const, owner: id(11), config }
  return { ...f, config, env, input }
}

it('uses the one public receive target and freezes the exact equipment Market pin without enabling writes', () => {
  const f = fixture()
  Object.entries(f.env).forEach(([key, value]) => vi.stubEnv(key, value))
  const config = getBrowserNativeEquipmentMarketConfig()
  expect(config.target.equipmentMarket).toEqual(f.marketPin)
  expect(Object.isFrozen(config.target.equipmentMarket)).toBe(true)
  expect(config.target.marketWritesEnabled).not.toBe(true)
})

it.each(['extra', 'no Runtime', 'bad digest', 'bad replacement', 'package alias', 'replacement alias'])('rejects malformed release configuration: %s', problem => {
  const f = fixture(), target = structuredClone(f.config.target)
  if (problem === 'extra') Object.assign(target.equipmentMarket, { fallback: id(990) })
  if (problem === 'no Runtime') delete target.runtime
  if (problem === 'bad digest') target.equipmentMarket.callableDigest = 'bad'
  if (problem === 'bad replacement') target.equipmentMarket.replacementId = '0x1'
  if (problem === 'package alias') target.equipmentMarket.callablePackageId = target.outputCallablePackageId
  if (problem === 'replacement alias') target.equipmentMarket.replacementId = target.protocolConfigId
  expect(() => readNativeReceiveTarget({ ...f.env, NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(target) })).toThrow('configuration')
})

it('does not invent an equipment Market pin from the existing Soul Market config or private env', async () => {
  const f = fixture(), client = vi.fn(() => f.client)
  const missing = { ...f.config.target }; delete (missing as any).equipmentMarket
  vi.stubEnv('ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(f.config.target))
  await expect(readBrowserOwnedEquipmentMarket({ ...f.input, config: { target: missing } as never }, { client })).rejects.toThrow('pin is unavailable')
  expect(client).not.toHaveBeenCalled()
})

it('runs actual BCS authority and owned-instance reads through bounded browser RPC', async () => {
  const f = fixture(), calls: any[] = []
  const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject = (function (p: any, options: any) {
    calls.push(options); return get(p)
  }) as never
  const result = await readBrowserOwnedEquipmentMarket(f.input, { client: () => f.client })
  expect(result).toMatchObject({ owner: id(11), listAvailable: true,
    target: { marketCallablePackageId: f.marketPin.callablePackageId }, asset: { item: { id: id(84) } } })
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(options => options.abort instanceof AbortSignal)).toBe(true)
})

it('captures caller selection/config and does not reread changed env after starting', async () => {
  const f = fixture()
  const pending = readBrowserOwnedEquipmentMarket(f.input, { client: () => f.client })
  f.input.itemId = id(991); f.input.config.target.equipmentMarket.callablePackageId = id(992)
  vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', '{}')
  expect((await pending).asset.item.id).toBe(id(84))
})

it('propagates missing listing evidence without treating it as a canceled or empty listing', async () => {
  const f = fixture()
  await expect(readBrowserEquipmentMarketListing({ rootId: f.rootId, listingId: id(990), config: f.config },
    { client: () => f.client })).rejects.toThrow()
})

it('aborts an uncooperative pending RPC without waiting for a connection timeout', async () => {
  const f = fixture(), controller = new AbortController()
  f.client.core.getChainIdentifier = (() => new Promise(() => {})) as never
  const pending = readBrowserOwnedEquipmentMarket({ ...f.input, signal: controller.signal }, { client: () => f.client })
  controller.abort()
  await expect(pending).rejects.toThrow()
})

it.each(['unexpected field', 'invalid id', 'unsupported kind', 'pre-aborted'])('rejects %s before creating a client', async problem => {
  const f = fixture(), client = vi.fn(() => f.client), controller = new AbortController()
  if (problem === 'unexpected field') Object.assign(f.input, { sellerOverride: id(999) })
  if (problem === 'invalid id') f.input.itemId = '0x1'
  if (problem === 'unsupported kind') f.input.kind = 'physical' as never
  if (problem === 'pre-aborted') { controller.abort(); Object.assign(f.input, { signal: controller.signal }) }
  await expect(readBrowserOwnedEquipmentMarket(f.input, { client })).rejects.toThrow()
  expect(client).not.toHaveBeenCalled()
})
