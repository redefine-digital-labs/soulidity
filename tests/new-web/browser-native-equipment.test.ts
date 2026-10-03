import { afterEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { readBrowserNativeEquipment, parseBrowserEquipmentQuery } from '../../web/lib/animacraft/browser-native-equipment'
import { validEquipmentCursor, equipmentUtf8, equipmentBytesEqual } from '../../web/lib/animacraft/native-equipment-bytes'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentBaseItemBcs } from '../../web/lib/animacraft/native-equipment'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { nativeEquipmentFixture } from './fixtures/native-equipment'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'
import { nativeEquipmentSealFixture } from './fixtures/native-equipment-seal'
import { equipmentOperationFixture } from './fixtures/equipment-operation'
import { createEquipmentOperationAdapter } from '../../web/lib/animacraft/equipment-operation-adapter'
import { runEquipmentOperation, type EquipmentOperationRecord } from '../../web/lib/animacraft/equipment-operation'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const params = (query = '') => ({ soulId: id(12), stateId: id(14), query: new URLSearchParams(query) })
const dependencies = (fixture: ReturnType<typeof nativeEquipmentFixture>) => ({ target: () => fixture.target, client: () => fixture.client })
afterEach(() => vi.unstubAllGlobals())

it.each(['base', 'pack', 'protected'] as const)('runs the actual %s equipment/source chain read without Buffer or owned API calls', async kind => {
  const fixture = kind === 'pack' ? nativeEquipmentPackFixture()
    : kind === 'protected' ? nativeEquipmentSealFixture() : nativeEquipmentSourceFixture()
  const query = kind === 'pack' ? `source=1&pack=1&packPass=${id(201)}` : `source=1&inventory=base&item=${id(84)}`
  const fetch = vi.fn(() => { throw new Error('No owned API or ciphertext fetch permitted') })
  vi.stubGlobal('fetch', fetch)
  const originalBuffer = globalThis.Buffer
  let result
  try {
    Object.assign(globalThis, { Buffer: undefined })
    result = await readBrowserNativeEquipment(params(query), dependencies(fixture))
  } finally { Object.assign(globalThis, { Buffer: originalBuffer }) }
  expect(result.status).toBe('BOUND')
  expect(result.owner).toBe(id(11))
  expect(result.source?.currentProtocol).toBe(true)
  expect(result.source?.styles[0].style_key).toBe('red')
  if (kind === 'pack') expect(result.source?.pack?.selected?.styles[0].style_key).toBe('snow')
  if (kind === 'protected') expect(result.source?.protectedBase).toMatchObject({ available: true, entries: [{ proof: { sealRegistryId: id(87) } }] })
  expect(fetch).not.toHaveBeenCalled()
})

it('returns genuine absence only after exact native identity verification', async () => {
  const f = nativeEquipmentFixture(); f.objects.delete(f.pointerId)
  expect(await readBrowserNativeEquipment(params(), dependencies(f))).toMatchObject({ status: 'NOT_CREATED', equipment: null, owner: id(11) })
})
it.each(['state-link', 'custody', 'release', 'transient', 'changed'])('preserves the actual %s rejection, not a fabricated inventory', async failure => {
  const f = nativeEquipmentFixture()
  if (failure === 'state-link') f.set(id(14), NativeSoulStateBcs, value => { value.soul_id = id(999) })
  if (failure === 'custody') f.objects.get(id(84)).owner.address = id(999)
  if (failure === 'release') f.target.runtime.callableDigest = 'wrong'
  if (failure === 'transient') (f.client.ledgerService as any).batchGetObjects = async () => ({ response: {
    objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }],
  } })
  if (failure === 'changed') {
    const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
    vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation(async request => {
      if (request.objectId === id(14) && request.readMask?.paths.length === 3) f.objects.get(id(14)).version++
      return get(request)
    })
  }
  await expect(readBrowserNativeEquipment(params(), dependencies(f))).rejects.toThrow()
})

it.each([
  'owner=0x1', 'state=0x1', 'equipment=0x1', 'inventory=other', 'cursor=YQ==',
  'inventory=base&cursor=YQ', 'inventory=base&cursor=%20YQ==', 'inventory=base&cursor=%%%25',
  'inventory=base&inventory=external', 'source=0', 'source=1&source=1', 'styleStart=0',
  'source=1&styleStart=501', 'source=1&styleStart=-1', 'source=1&styleStart=01', 'source=1&styleStart=1.5',
  'source=1&styleStart=0&styleStart=1', `item=${id(84)}`, `inventory=base&item=${id(84)}&cursor=YQ==`,
  'pack=1', 'source=1&pack=0', `source=1&packPass=${id(201)}`, `source=1&pack=1&packPass=${id(201)}&packCursor=YQ==`,
  'source=1&pack=1&packStyleCursor=YQ==', `source=1&pack=1&packPass=${id(201)}&packPart=body`,
  `source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat&packStyle=a/b`,
  `source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat&packStyle=red&packStyleCursor=YQ==`,
  'source=1&pack=1&pack=1', 'source=1&packCursor=YQ==', 'source=1&pack=1&packCursor=bad',
  'source=1&pack=1&packPass=0x1', `source=1&pack=1&packPass=${id(0)}`,
  `source=1&pack=1&packPass=${id(201)}&packPass=${id(201)}`,
  `source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat`,
  `source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat&packStyle=`,
  `source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat&packStyle=${'a'.repeat(129)}`,
  'inventory=base&item=0x1', `inventory=base&item=${id(0)}`, `inventory=base&item=${id(84)}&item=${id(84)}`,
  'inventory=base&cursor=YQ==&cursor=Yg==',
])('rejects bounded/authority query violation before any read: %s', async query => {
  const target = vi.fn(), client = vi.fn()
  await expect(readBrowserNativeEquipment(params(query), { target, client })).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_BAD_QUERY' })
  expect(target).not.toHaveBeenCalled(); expect(client).not.toHaveBeenCalled()
})

it('preserves exact pagination and selected item/Pack query mapping', () => {
  expect(parseBrowserEquipmentQuery(new URLSearchParams('source=1&styleStart=50&inventory=external&cursor=bmV4dA==')))
    .toEqual({ source: { styleStart: 50 }, inventory: { kind: 'external', cursor: 'bmV4dA==' } })
  expect(parseBrowserEquipmentQuery(new URLSearchParams(`source=1&pack=1&packPass=${id(201)}&packPart=body&packItem=hat&packStyle=red`)))
    .toEqual({ source: { pack: { passId: id(201), style: { partKey: 'body', itemKey: 'hat', styleKey: 'red' } } } })
  expect(parseBrowserEquipmentQuery(new URLSearchParams(`inventory=base&item=${id(84)}`)))
    .toEqual({ inventory: { kind: 'base', itemId: id(84) } })
  expect(parseBrowserEquipmentQuery(new URLSearchParams('source=1&pack=1&packCursor=bmV4dA==')))
    .toEqual({ source: { pack: { cursor: 'bmV4dA==' } } })
  expect(parseBrowserEquipmentQuery(new URLSearchParams(`source=1&pack=1&packPass=${id(201)}&packStyleCursor=bmV4dA==`)))
    .toEqual({ source: { pack: { passId: id(201), styleCursor: 'bmV4dA==' } } })
})

it('snapshots source queries and deployment before the first asynchronous read', async () => {
  const f = nativeEquipmentSourceFixture(), input = params(`source=1&inventory=base&item=${id(84)}`)
  const pending = readBrowserNativeEquipment(input, dependencies(f))
  input.query.set('item', id(999)); f.target.runtime.callableDigest = 'changed-after-start'
  expect((await pending).inventory?.objects[0].item.id).toBe(id(84))
})

it('uses exact saved references locally without a library/API lookup and rejects stale captured owner', async () => {
  const f = nativeEquipmentSourceFixture(), content = captureNamedLoadout(await f.readBase())
  const listing = vi.fn(() => { throw new Error('No inventory scan for exact loadout') })
  ;(f.client.core as any).listOwnedObjects = listing
  f.objects.delete(f.indexId)
  const result = await readBrowserNativeEquipment({ ...params(), loadoutContent: content }, dependencies(f))
  expect(result.source?.styles[0].style_key).toBe('red'); expect(listing).not.toHaveBeenCalled()
  await expect(readBrowserNativeEquipment({ ...params(), loadoutContent: { ...content, capturedOwner: id(999) } }, dependencies(f)))
    .rejects.toMatchObject({ code: 'NAMED_LOADOUT_EQUIPMENT_CHANGED' })
  f.set(id(84), EquipmentBaseItemBcs, value => { value.holder = id(999) })
  await expect(readBrowserNativeEquipment({ ...params(), loadoutContent: content }, dependencies(f))).rejects.toThrow()
})

it.each(['owner', 'epoch', 'state', 'soul', 'unknown', 'hash', 'query-mix'])('rejects changed/malformed saved reference %s', async change => {
  const f = nativeEquipmentSourceFixture(), content: any = captureNamedLoadout(await f.readBase())
  const input = { ...params(), loadoutContent: content }
  if (change === 'owner') content.capturedOwner = id(999)
  if (change === 'epoch') content.capturedOwnershipEpoch = '2'
  if (change === 'state') content.stateId = id(999)
  if (change === 'soul') content.soulId = id(999)
  if (change === 'unknown') content.proof = { authority: 'caller' }
  if (change === 'hash') content.slots[0].assetContentCommitment = '00'
  if (change === 'query-mix') input.query.set('source', '1')
  const client = vi.fn(() => f.client)
  await expect(readBrowserNativeEquipment(input, { ...dependencies(f), client })).rejects.toThrow()
  if (change !== 'owner' && change !== 'epoch') expect(client).not.toHaveBeenCalled()
})

it('keeps invalid object hints and missing release configuration unavailable before network reads', async () => {
  const client = vi.fn(), target = vi.fn(() => { throw Object.assign(new Error('Release unavailable'), { code: 'NATIVE_RECEIVE_TARGET_UNAVAILABLE' }) })
  await expect(readBrowserNativeEquipment({ ...params(), soulId: 'legacy-db-uuid' }, { client, target })).rejects.toThrow()
  expect(target).not.toHaveBeenCalled()
  await expect(readBrowserNativeEquipment(params(), { client, target })).rejects.toMatchObject({ code: 'NATIVE_RECEIVE_TARGET_UNAVAILABLE' })
  expect(client).not.toHaveBeenCalled()
})

it('never turns a cancelled/hung node call into a successful late snapshot', async () => {
  const f = nativeEquipmentFixture(), controller = new AbortController()
  let resolve!: (value: any) => void
  ;(f.client.ledgerService as any).getServiceInfo = () => new Promise(done => { resolve = done })
  const pending = readBrowserNativeEquipment({ ...params(), signal: controller.signal }, dependencies(f))
  const rejection = expect(pending).rejects.toThrow('cancelled')
  await Promise.resolve(); await Promise.resolve()
  controller.abort(new Error('cancelled'))
  await rejection
  resolve?.({ response: { chainId: 'wrong-late-chain' } })
  await Promise.resolve()
})

it('keeps byte equality/UTF-8 and canonical cursor checks browser portable', () => {
  expect(equipmentBytesEqual(equipmentUtf8('猫'), new Uint8Array([231, 140, 171]))).toBe(true)
  expect(equipmentBytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
  for (const value of ['', 'YQ', 'YR==', ' YQ==', 'YQ===', '%%%']) expect(validEquipmentCursor(value)).toBe(false)
  expect(validEquipmentCursor('YQ==')).toBe(true)
})

it('bundles the direct service for a browser without Node builtins or server-only modules', async () => {
  const output = await build({ entryPoints: ['web/lib/animacraft/browser-native-equipment.ts'], bundle: true,
    platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent', tsconfig: 'web/tsconfig.json' })
  expect(output.outputFiles[0].text.length).toBeGreaterThan(1000)
  expect(Object.keys(output.metafile!.inputs).some(path => /(?:node:|server-only|prisma|named-loadout-store)/.test(path))).toBe(false)
})

it('query-only recovery verifies saved bytes/effects and direct chain readback without prepare/sign/broadcast', async () => {
  const f = nativeEquipmentFixture(), { record } = await equipmentOperationFixture()
  const effects = bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: '9',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: record.digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes()
  Object.assign(f.client.ledgerService, {
    getServiceInfo: vi.fn(async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } })),
    getTransaction: vi.fn(async () => ({ response: { transaction: {
      digest: record.digest, transaction: { digest: record.digest, bcs: { value: fromBase64(record.bytes) } },
      effects: { transactionDigest: record.digest, bcs: { value: effects }, status: { success: true } }, checkpoint: 1n,
    } } })),
  })
  const sign = vi.fn(), execute = vi.fn(), observed = vi.fn()
  Object.assign(f.client.core, { executeTransaction: execute })
  const read = vi.fn(() => readBrowserNativeEquipment(params(), dependencies(f)))
  const adapter = createEquipmentOperationAdapter({ client: f.client, read, getAddress: () => record.owner, sign, onSnapshot: observed })
  const prepare = vi.spyOn(adapter, 'prepare'), preflight = vi.spyOn(adapter, 'preflight'), broadcast = vi.spyOn(adapter, 'broadcast')
  let saved: EquipmentOperationRecord = { ...record, phase: 'SIGNING' }
  const result = await runEquipmentOperation({ soulId: record.soulId, owner: record.owner, queryOnly: true, adapter,
    store: { read: () => structuredClone(saved), write: (_key, value) => { saved = structuredClone(value) }, exclusive: async (_key, run) => run() } })
  expect(result.phase).toBe('SUCCEEDED'); expect(result.bytes).toBe(record.bytes)
  expect(read).toHaveBeenCalledExactlyOnceWith(undefined)
  expect(observed).toHaveBeenCalledWith(expect.objectContaining({ status: 'BOUND', soulId: id(12), stateId: id(14), owner: id(11) }))
  for (const writePath of [prepare, preflight, broadcast, sign, execute]) expect(writePath).not.toHaveBeenCalled()
})
