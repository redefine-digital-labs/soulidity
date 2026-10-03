import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { createHash } from 'node:crypto'
import { nativeVisibilityCommitment, type NativeVisibilityToken } from '../../web/lib/animacraft/native-visibility'
import { nativeRenderSourceFixture, nativeRenderSource500Fixture } from './fixtures/native-render-source'
import { NativeRenderReadSet, readNativeRenderSource } from '../../web/lib/animacraft/native-render-source'
import { createBrowserNativeReadSession } from '../../web/lib/animacraft/browser-native-artwork'
import { artworkWire } from './fixtures/browser-native-artwork'
import { packId as id } from './fixtures/native-equipment-pack'
import { EquipmentMakerBcs, EquipmentBaseRegistryBcs, EquipmentStyleRowBcs, EquipmentAssetRowBcs,
  EquipmentColorRowBcs, EquipmentTrackRowBcs, EquipmentExternalProductBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentPackStyleKeyBcs, EquipmentPackStyleBcs, EquipmentPackReleaseBcs } from '../../web/lib/animacraft/native-equipment-pack'

const S = bcs.string(); const A = bcs.Address
const BaseStyleField = bcs.struct('Field', { id: A, name: EquipmentPackStyleKeyBcs, value: EquipmentStyleRowBcs })
const PackStyleField = bcs.struct('Field', { id: A, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs })
const AssetField = bcs.struct('Field', { id: A, name: bcs.struct('AssetKeyV2', { asset_id: S }), value: EquipmentAssetRowBcs })
const ColorField = bcs.struct('Field', { id: A, name: bcs.struct('ColorKeyV8', { channel_key: S }), value: EquipmentColorRowBcs })
const TrackField = bcs.struct('Field', { id: A, name: bcs.struct('TrackKeyV8', { key: S }), value: EquipmentTrackRowBcs })

it.each(['part', 'track'] as const)('rejects missing Pack-owned %s before reading colliding Base definitions', async scope => {
  const f = nativeRenderSourceFixture()
  f.set(f.packStyleId, PackStyleField, row => { row.value.definition_sources[scope] = 2 })
  // Missing Base rows cannot mask the exact finalized definition requirement.
  f.objects.delete(f.partId); f.objects.delete(f.trackId); f.objects.delete(f.colorId)
  await expect(f.readRender([f.packSelection])).rejects.toThrow('Pack definitions missing')
  expect(f.requests.some(request => [f.partId, f.trackId, f.colorId].includes(request.objectId))).toBe(false)
})

it('reads 500 distinct selected definitions and 256 tracks in bounded exact-ID batches', async () => {
  const f = nativeRenderSource500Fixture(), reads = new NativeRenderReadSet(f.client)
  const batch = vi.spyOn(f.client.ledgerService, 'batchGetObjects')
  const source = await readNativeRenderSource(f.client, f.target, f.renderInput, { readSet: reads })
  await reads.verify()
  expect(source.layers).toHaveLength(500)
  expect(new Set(source.layers.map(row => row.selection.part_key)).size).toBe(500)
  const calls = batch.mock.calls.map(([request]) => request.requests!.length)
  expect(Math.max(...calls)).toBeLessThanOrEqual(50)
  expect(calls.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(2756 * 2)
  expect(batch.mock.calls.length + f.requests.length).toBeLessThan(500)
})

it.each(['missing', 'order', 'not-found', 'unavailable', 'type', 'owner'])('settles every same-microtask caller on batch %s failure', async problem => {
  const f = nativeRenderSourceFixture(), reads = new NativeRenderReadSet(f.client)
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  vi.spyOn(f.client.ledgerService, 'batchGetObjects').mockImplementation((async (request: Parameters<typeof original>[0]) => {
    const response = structuredClone(await original(request))
    const entries = response.response.objects
    if (problem === 'missing') entries.pop()
    if (problem === 'order') entries.reverse()
    if (problem === 'not-found' || problem === 'unavailable') entries[0] = { result: { oneofKind: 'error', error: { code: problem === 'not-found' ? 5 : 14 } } } as any
    if (problem === 'type') (entries[0].result as any).object.objectType = '0x2::wrong::Row'
    if (problem === 'owner') (entries[0].result as any).object.owner.address = id(999)
    return response
  }) as unknown as typeof original)
  const results = await Promise.allSettled([f.partId, f.itemRowId].map(objectId =>
    reads.read(objectId, f.objects.get(objectId).objectType, 2, id(85))))
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
})
it.each(['type', 'parent'])('never reuses a same-ID response to bypass a conflicting %s expectation', async conflict => {
  const f = nativeRenderSourceFixture(), reads = new NativeRenderReadSet(f.client), row = f.objects.get(f.partId)
  const outcomes = await Promise.allSettled([reads.read(f.partId, row.objectType, 2, id(85)),
    reads.read(f.partId, conflict === 'type' ? '0x2::wrong::Row' : row.objectType, 2, conflict === 'parent' ? id(999) : id(85))])
  expect(outcomes.map(result => result.status)).toEqual(['rejected', 'rejected'])
})
it('rejects all 101 queued callers if the second bounded batch fails', async () => {
  const f = nativeRenderSourceFixture(), reads = new NativeRenderReadSet(f.client)
  const original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  let count = 0
  const batch = vi.spyOn(f.client.ledgerService, 'batchGetObjects').mockImplementation((async (request: Parameters<typeof original>[0]) => {
    if (++count === 2) throw new Error('second batch failed')
    return original(request)
  }) as unknown as typeof original)
  const results = await Promise.allSettled(Array.from({ length: 101 }, () => reads.read(f.partId, f.objects.get(f.partId).objectType, 2, id(85))))
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  expect(batch.mock.calls.map(([request]) => request.requests!.length)).toEqual([50, 50])
})
it('captures direct root.accept in its final read set', async () => {
  const f = nativeRenderSourceFixture(), reads = new NativeRenderReadSet(f.client), row = f.objects.get(id(10))
  reads.accept(structuredClone(row), id(10), row.objectType, 3)
  row.version += 1n
  await expect(reads.verify()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
})
it.each([false, true])('verifies at most eight 50-ID batches concurrently, fully settling a failed round=%s', async fail => {
  const f = nativeRenderSourceFixture(), reads = new NativeRenderReadSet(f.client), original = f.client.ledgerService.batchGetObjects.bind(f.client.ledgerService)
  for (let index = 0; index < 401; index++) {
    const row = { ...structuredClone(f.objects.get(f.partId)), objectId: id(1000 + index) }
    f.objects.set(row.objectId, row); reads.accept(row, row.objectId, row.objectType, 2, id(85))
  }
  let active = 0, peak = 0, finished = 0, calls = 0
  vi.spyOn(f.client.ledgerService, 'batchGetObjects').mockImplementation((async (request: Parameters<typeof original>[0]) => {
    const ordinal = ++calls; active++; peak = Math.max(peak, active)
    expect(request.requests!.length).toBeLessThanOrEqual(50)
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (fail && ordinal === 1) throw Error('verification failed')
      return await original(request)
    } finally { active--; finished++ }
  }) as unknown as typeof original)
  if (fail) await expect(reads.verify()).rejects.toThrow('verification failed')
  else await reads.verify()
  expect(peak).toBe(8); expect(active).toBe(0); expect(finished).toBe(fail ? 8 : 9)
})
it('settles every queued browser read when aborted before its microtask dispatch', async () => {
  const f = artworkWire(nativeRenderSourceFixture()), abort = new AbortController()
  const session = createBrowserNativeReadSession(f.client, abort.signal), reads = new NativeRenderReadSet(session.client)
  const pending = [f.partId, f.itemRowId].map(objectId => reads.read(objectId, f.objects.get(objectId).objectType, 2, id(85)))
  abort.abort(new Error('render cancelled'))
  const results = await Promise.allSettled(pending)
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
  expect(f.batch).not.toHaveBeenCalled()
})

it.each(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity', 'linear-dodge'].map((mode, code) => [code, mode] as const))
('decodes original Base blend code %s as %s from exact BCS', async (code, mode) => {
  const f = nativeRenderSourceFixture()
  f.set(f.styleId, BaseStyleField, row => { row.value.blend_mode = code })
  const { layers } = await f.readRender()
  expect(layers[0].blendMode).toBe(mode)
})

it('reads exact Base, Pack and External content without inventory pages or current purchase gates', async () => {
  const f = nativeRenderSourceFixture()
  const list = vi.fn(async () => { throw Error('discovery unavailable') })
  ;(f.client.core as any).listOwnedObjects = list; (f.client.core as any).listDynamicFields = list
  for (const objectId of [f.passId, f.accessId, id(83), id(84), f.external.itemId, id(82), f.admissionId, f.semanticId, f.indexId]) f.objects.delete(objectId)
  f.set(id(10), EquipmentMakerBcs, root => { root.lifecycle = 2 })
  f.set(f.releaseId, EquipmentPackReleaseBcs, release => {
    release.lifecycle = 4; release.pass_count = '0'; release.complete_mode = 3
    release.complete_total_cap = '1'; release.total_complete_count = '1'
  })
  f.set(f.external.productId, EquipmentExternalProductBcs, product => { product.lifecycle = 2 })
  const result = await f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' },
    { ...f.externalSelection, selection_index: '2' }])
  expect(result.authority).toBe('CONTENT_ONLY'); expect(list).not.toHaveBeenCalled()
  expect(result.layers).toMatchObject([
    { selectionIndex: 0, asset: { assetId: 'hat', blobId: 'blob', byteLength: 100, mediaType: 'image/png' }, swatch: { key: 'red' } },
    { selectionIndex: 1, asset: null, pack: { id: f.releaseId }, swatch: { key: 'gold' } },
    { selectionIndex: 2, asset: { assetId: f.product.id, blobId: 'external-blob', byteLength: 100 }, swatch: null },
  ])
  expect(f.requests.some(request => [f.passId, id(83), id(82)].includes(request.objectId))).toBe(false)
})

it('keeps sparse original slot indices and independent same-channel exact swatches', async () => {
  const f = nativeRenderSourceFixture()
  f.set(f.baseColorId, ColorField, row => { row.value.swatches.push({ key: 'blue', label: 'Blue', rgba: 65535,
    stops: [{ offset_ppm: '0', rgba: 255 }, { offset_ppm: '500000', rgba: 65535 }, { offset_ppm: '1000000', rgba: 4294967295 }] }) })
  const result = await f.readRender([null, { ...f.baseSelection, selection_index: '1' }, null,
    { ...f.baseSelection, selection_index: '3', swatch_key: 'blue' }])
  expect(result.layers.map(layer => layer.selectionIndex)).toEqual([1, 3])
  expect(result.layers.map(layer => layer.swatch)).toEqual([
    { key: 'red', rgba: '#ff0000ff', stops: [] },
    { key: 'blue', rgba: '#0000ffff', stops: [{ offset: 0, rgba: '#000000ff' },
      { offset: 0.5, rgba: '#0000ffff' }, { offset: 1, rgba: '#ffffffff' }] },
  ])
  expect(f.requests.filter(row => row.objectId === f.baseColorId && row.paths.includes('contents'))).toHaveLength(1)
})

it('decodes fixed-point author transforms, opacity, blend, display and track order exactly', async () => {
  const f = nativeRenderSourceFixture()
  f.set(f.styleId, BaseStyleField, row => {
    row.value.transform = { x_milli: { negative: true, magnitude: '8125' }, y_milli: { negative: false, magnitude: '1234' },
      scale_ppm: '1250000', rotation_millidegrees: { negative: true, magnitude: '45500' } }
    row.value.opacity_ppm = '375000'; row.value.blend_mode = 2; row.value.display_order = '17'
  })
  f.set(f.trackId, TrackField, row => { row.value.render_order = '31' })
  const { layers } = await f.readRender()
  expect(layers[0]).toMatchObject({ transform: { x: -8.125, y: 1.234, scale: 1.25, rotation: -45.5 },
    opacity: 0.375, blendMode: 'screen', displayOrder: 17, trackOrder: 31 })
  for (const selection of [f.packSelection, f.externalSelection]) {
    expect((await f.readRender([selection])).layers[0]).toMatchObject({ transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      opacity: 1, blendMode: 'normal', displayOrder: 0, trackOrder: 31 })
  }
})

it('protected Base/Pack retain content identity without requesting or claiming decryption authority', async () => {
  const f = nativeRenderSourceFixture()
  f.set(f.styleId, BaseStyleField, row => { row.value.protected = true })
  f.set(f.packStyleId, PackStyleField, row => { row.value.protected = true; row.value.seal_binding_commitment = Array(32).fill(8) })
  const result = await f.readRender([{ ...f.baseSelection, protected: true, seal_binding_commitment: Array(32).fill(7) },
    { ...f.packSelection, protected: true, seal_binding_commitment: Array(32).fill(8), selection_index: '1' }])
  expect(result.authority).toBe('CONTENT_ONLY'); expect(result.layers.map(layer => layer.protected)).toEqual([true, true])
  expect(result.layers[1].selection.seal_binding_commitment).toEqual(Array(32).fill(8))
})

it.each(['root-id', 'root-hash', 'base-seal', 'type-origin', 'core-linkage', 'base-custody', 'style-parent',
  'style-key', 'style-row-id', 'style-hash', 'style-payload', 'style-color', 'asset-id', 'asset-hash', 'asset-key',
  'pack-root', 'pack-custody', 'pack-coin', 'pack-id', 'pack-style-key', 'pack-style-hash', 'pack-style-parent',
  'external-id', 'external-root', 'external-hash', 'external-custody', 'track-key', 'track-parent', 'color-key', 'color-parent'])
('rejects content-source %s mismatch', async problem => {
  const f = nativeRenderSourceFixture()
  if (problem === 'root-id') f.set(id(10), EquipmentMakerBcs, value => { value.id = id(999) })
  if (problem === 'root-hash') f.set(id(10), EquipmentMakerBcs, value => { value.content.content_commitment = Array(32).fill(9) })
  if (problem === 'base-seal') f.set(id(85), EquipmentBaseRegistryBcs, value => { value.sealed_commitments.aggregate = Array(32).fill(9) })
  if (problem === 'type-origin') f.objects.get(id(72)).package.typeOrigins.find((value: any) => value.datatypeName === 'StyleRowV2').packageId = id(999)
  if (problem === 'core-linkage') f.objects.get(id(71)).package.linkage.at(-1).upgradedId = id(999)
  if (problem === 'base-custody') f.objects.get(id(85)).owner.kind = 1
  if (problem === 'style-parent') f.objects.get(f.styleId).owner.address = id(999)
  if (problem === 'style-key') f.set(f.styleId, BaseStyleField, row => { row.name.style_key = 'other' })
  if (problem === 'style-row-id') f.set(f.styleId, BaseStyleField, row => { row.id = id(999) })
  if (problem === 'style-hash') f.set(f.styleId, BaseStyleField, row => { row.value.asset_sha256 = Array(32).fill(99) })
  if (problem === 'style-payload') f.set(f.styleId, BaseStyleField, row => { row.value.payload_commitment = Array(32).fill(99) })
  if (problem === 'style-color') f.set(f.styleId, BaseStyleField, row => { row.value.color_channel_key = 'other' })
  if (problem === 'asset-id') f.set(f.assetId, AssetField, row => { row.value.asset_id = 'other' })
  if (problem === 'asset-hash') f.set(f.assetId, AssetField, row => { row.value.sha256 = Array(32).fill(99) })
  if (problem === 'asset-key') f.set(f.assetId, AssetField, row => { row.name.asset_id = 'other' })
  if (problem === 'pack-root') f.set(f.releaseId, EquipmentPackReleaseBcs, value => { value.root_id = id(999) })
  if (problem === 'pack-custody') f.objects.get(f.releaseId).owner.kind = 1
  if (problem === 'pack-coin') f.objects.get(f.releaseId).objectType = `${f.runtimeType('PackReleaseV8')}<0x2::other::Coin>`
  if (problem === 'pack-id') f.set(f.releaseId, EquipmentPackReleaseBcs, value => { value.id = id(999) })
  if (problem === 'pack-style-key') f.set(f.packStyleId, PackStyleField, row => { row.value.style_key = 'other' })
  if (problem === 'pack-style-hash') f.set(f.packStyleId, PackStyleField, row => { row.value.asset_sha256 = Array(32).fill(99) })
  if (problem === 'pack-style-parent') f.objects.get(f.packStyleId).owner.address = id(999)
  if (problem === 'external-id') f.set(f.product.id, EquipmentExternalProductBcs, value => { value.id = id(999) })
  if (problem === 'external-root') f.set(f.product.id, EquipmentExternalProductBcs, value => { value.root_id = id(999) })
  if (problem === 'external-hash') f.set(f.product.id, EquipmentExternalProductBcs, value => { value.asset_sha256 = Array(32).fill(99) })
  if (problem === 'external-custody') f.objects.get(f.product.id).owner.kind = 1
  if (problem === 'track-key') f.set(f.trackId, TrackField, row => { row.value.key = 'other' })
  if (problem === 'track-parent') f.objects.get(f.trackId).owner.address = id(999)
  if (problem === 'color-key') f.set(f.baseColorId, ColorField, row => { row.value.key = 'other' })
  if (problem === 'color-parent') f.objects.get(f.baseColorId).owner.address = id(999)
  await expect(f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' },
    { ...f.externalSelection, selection_index: '2' }])).rejects.toThrow()
})

it.each(['root', 'base', 'base-style', 'asset', 'pack', 'pack-style', 'product', 'track', 'color'])
('refuses a stale render readset after mutable %s changes', async kind => {
  const f = nativeRenderSourceFixture()
  const target = ({ root: id(10), base: id(85), 'base-style': f.styleId, asset: f.assetId, pack: f.releaseId,
    'pack-style': f.packStyleId, product: f.product.id, track: f.trackId, color: f.baseColorId })[kind as 'root']
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    const result = await original(request)
    return request.objectId === target && request.readMask.paths.length === 3
      ? { response: { object: { ...result.response.object, version: 999n } } } : result
  }
  await expect(f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' },
    { ...f.externalSelection, selection_index: '2' }])).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
})

it.each(['Base', 'Pack', 'External'])('missing exact %s content never falls back to another source or a page', async kind => {
  const f = nativeRenderSourceFixture()
  const [objectId, selection] = kind === 'Base' ? [f.styleId, f.baseSelection] as const
    : kind === 'Pack' ? [f.packStyleId, f.packSelection] as const : [f.product.id, f.externalSelection] as const
  f.objects.delete(objectId)
  await expect(f.readRender([selection])).rejects.toThrow()
  expect(f.listPasses).not.toHaveBeenCalled(); expect(f.listStyles).not.toHaveBeenCalled()
})

it('rejects missing, unexpected, ambiguous or invalid exact swatches rather than selecting a default', async () => {
  for (const choice of [null, 'missing']) {
    const f = nativeRenderSourceFixture()
    await expect(f.readRender([{ ...f.baseSelection, swatch_key: choice }])).rejects.toThrow('swatch mismatch')
  }
  const f = nativeRenderSourceFixture()
  f.set(f.baseColorId, ColorField, row => { row.value.swatches.push(row.value.swatches[0]) })
  await expect(f.readRender()).rejects.toThrow('swatch mismatch')
  await expect(f.readRender([{ ...f.externalSelection, swatch_key: 'red' }])).rejects.toMatchObject({ code: 'NATIVE_RENDER_SOURCE_INVALID' })
})

it('rejects a changed Pack Seal binding and an External nondefault swatch even when Core knows that color', async () => {
  const f = nativeRenderSourceFixture()
  f.set(f.packStyleId, PackStyleField, row => { row.value.protected = true; row.value.seal_binding_commitment = Array(32).fill(8) })
  await expect(f.readRender([{ ...f.packSelection, protected: true, seal_binding_commitment: Array(32).fill(9) }])).rejects.toThrow('Seal binding mismatch')
  f.set(f.baseColorId, ColorField, row => { row.value.swatches.push({ key: 'blue', label: 'Blue', rgba: 65535, stops: [] }) })
  f.set(f.product.id, EquipmentExternalProductBcs, product => { product.color_channel_key = 'tint'; product.default_swatch_key = 'red' })
  const selected = { ...f.externalSelection, color_channel_key: 'tint', swatch_key: 'red' }
  expect((await f.readRender([selected])).layers[0].swatch?.key).toBe('red')
  await expect(f.readRender([{ ...selected, swatch_key: 'blue' }])).rejects.toThrow('External render selection mismatch')
})

it('bounds slots and source values before returning a scene, and caches repeated exact rows', async () => {
  const f = nativeRenderSourceFixture()
  await expect(f.readRender([])).rejects.toThrow('slot count')
  await expect(f.readRender(Array.from({ length: 501 }, (_, index) => ({ ...f.baseSelection, selection_index: String(index) })))).rejects.toThrow('slot count')
  await expect(f.readRender([{ ...f.baseSelection, selection_index: '1' }])).rejects.toThrow('slot identity')
  const result = await f.readRender(Array.from({ length: 500 }, (_, index) => ({ ...f.baseSelection, selection_index: String(index) })))
  expect(result.layers).toHaveLength(500)
  for (const objectId of [f.styleId, f.assetId, f.baseColorId, f.trackId]) {
    expect(f.requests.filter(row => row.objectId === objectId && row.paths.includes('contents'))).toHaveLength(1)
    expect(f.requests.filter(row => row.objectId === objectId && row.paths.length === 3)).toHaveLength(1)
  }
})

it.each(['scale', 'negative-zero', 'offset', 'opacity', 'blend', 'track', 'asset-size', 'color-stop'])('rejects invalid exact numeric %s', async kind => {
  const f = nativeRenderSourceFixture()
  if (kind === 'scale') f.set(f.styleId, BaseStyleField, row => { row.value.transform.scale_ppm = '0' })
  if (kind === 'negative-zero') f.set(f.styleId, BaseStyleField, row => { row.value.transform.x_milli.negative = true })
  if (kind === 'offset') f.set(f.styleId, BaseStyleField, row => { row.value.transform.x_milli.magnitude = '8192001' })
  if (kind === 'opacity') f.set(f.styleId, BaseStyleField, row => { row.value.opacity_ppm = '1000001' })
  if (kind === 'blend') f.set(f.styleId, BaseStyleField, row => { row.value.blend_mode = 17 })
  if (kind === 'track') f.set(f.trackId, TrackField, row => { row.value.render_order = '9007199254740992' })
  if (kind === 'asset-size') f.set(f.assetId, AssetField, row => { row.value.byte_length = '8388609' })
  if (kind === 'color-stop') f.set(f.baseColorId, ColorField, row => { row.value.swatches[0].stops = [{ offset_ppm: '1000001', rgba: 0 }] })
  await expect(f.readRender()).rejects.toThrow()
})

it('settles all concurrent source reads before rejecting the failed batch', async () => {
  const f = nativeRenderSourceFixture(); f.objects.delete(f.styleId)
  let finish!: () => void; let entered!: () => void
  const blocked = new Promise<void>(resolve => { finish = resolve }); const started = new Promise<void>(resolve => { entered = resolve })
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    if (request.objectId === f.packStyleId) { entered(); await blocked }
    return original(request)
  }
  let settled = false
  const pending = f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' }]).finally(() => { settled = true })
  const rejection = expect(pending).rejects.toThrow()
  await started; expect(settled).toBe(false); finish(); await rejection; expect(settled).toBe(true)
})

const condition = (source = 1, sourceKey: string | null = null, style = 'red'): NativeVisibilityToken => ({ opcode: 0, arity: 0,
  selector: { source, source_key: sourceKey, part_key: 'body', item_key: 'hat', style_key: style } })

it('matches an independently hand-encoded subject-bound BCS commitment', () => {
  const text = (value: string) => [Buffer.byteLength(value), ...Buffer.from(value)]
  // Literal V1 field order and widths, independent of the production BCS schema.
  const raw = Uint8Array.from([...text('animacraft-fresh-v8/core/visibility-program/v1'),
    1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, ...text('body'), 1, ...text('hat'), 1, ...text('red'),
    2, 0, 1, 1, 0, ...text('body'), 1, ...text('hat'), 1, ...text('red'), 0, 0,
    1, 0, 1, 0])
  const expected = [...createHash('sha256').update(raw).digest()]
  const tokens = [condition(), { opcode: 1, selector: null, arity: 1 }]
  expect(nativeVisibilityCommitment({ level: 'STYLE', partKey: 'body', itemKey: 'hat', styleKey: 'red' }, tokens)).toEqual(expected)
  expect(nativeVisibilityCommitment({ level: 'STYLE', partKey: 'body', itemKey: 'hat', styleKey: 'other' }, tokens)).not.toEqual(expected)
})

it.each(['PART', 'ITEM', 'STYLE'] as const)('retains selected identity and reports false %s without silently selecting a replacement', async level => {
  const f = nativeRenderSourceFixture()
  f.setVisibility(level, [condition(), { opcode: 1, selector: null, arity: 1 }])
  const selected = [null, { ...f.baseSelection, selection_index: '1' }]
  const before = structuredClone(selected)
  const source = await f.readRender(selected)
  expect(source.visibility).toEqual({ valid: false, violations: [{ selectionIndex: 1, levels: [level] }] })
  expect(source.selectionIndexes).toEqual([1]); expect(source.selections).toEqual(before); expect(selected).toEqual(before)
  expect(source.layers[0].asset).not.toBeNull()
})

it('supports exact BASE, ANY, semantic Pack and External product selectors with the same keys', async () => {
  const f = nativeRenderSourceFixture()
  const variants = [f.baseSelection, f.packSelection, f.externalSelection]
  for (const [index, row] of variants.entries()) {
    f.setVisibility('PART', [{ opcode: 0, arity: 0, selector: { source: index + 1,
      source_key: index === 0 ? null : index === 1 ? row.source_semantic_id : row.source_definition_id,
      part_key: row.part_key, item_key: row.item_key, style_key: row.style_key } }])
    expect((await f.readRender([row])).visibility.valid).toBe(true)
    f.setVisibility('PART', [condition(0, null, row.style_key)])
    // ANY deliberately ignores concrete source while retaining the whole path.
    expect((await f.readRender([row])).visibility.valid).toBe(row.item_key === 'hat')
  }
  f.setVisibility('PART', [condition(1)])
  expect((await f.readRender([f.packSelection])).visibility.valid).toBe(false)
  expect((await f.readRender([f.externalSelection])).visibility.valid).toBe(false)
  f.setVisibility('STYLE', [{ opcode: 0, arity: 0, selector: { source: 2, source_key: f.packSelection.source_semantic_id,
    part_key: f.packSelection.part_key, item_key: f.packSelection.item_key, style_key: f.packSelection.style_key } }])
  const withPack = await f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' }])
  // Host condition still applies to both sources; BASE Style only to BASE.
  expect(withPack.layers[0].violations).toEqual([])
  expect(withPack.layers[1].violations).toEqual([])
  expect((await f.readRender([f.packSelection])).layers[0].violations).toEqual(['PART'])
})

it.each(['missing-part','missing-item','commitment','subject','underflow','unknown-op','arity','bad-source'] as const)
('rejects visibility %s rather than treating it as unconditional', async problem => {
  const f = nativeRenderSourceFixture()
  if (problem === 'missing-part') f.objects.delete(f.partId)
  if (problem === 'missing-item') f.objects.delete(f.itemRowId)
  if (problem === 'commitment') f.setVisibility('STYLE', [], Array(32).fill(7))
  if (problem === 'subject') f.setVisibility('STYLE', [], nativeVisibilityCommitment({ level: 'ITEM', partKey: 'body', itemKey: 'hat', styleKey: null }, []))
  const invalid = problem === 'underflow' ? [{ opcode: 1, selector: null, arity: 1 }]
    : problem === 'unknown-op' ? [{ opcode: 4, selector: null, arity: 1 }]
      : problem === 'arity' ? [{ ...condition(), arity: 1 }]
        : problem === 'bad-source' ? [condition(3, 'pack-name')] : null
  if (invalid) f.setVisibility('STYLE', invalid, Array(32).fill(7))
  await expect(f.readRender()).rejects.toThrow()
})

it('hidden metadata still rejects corrupted asset and exact source identity', async () => {
  const f = nativeRenderSourceFixture()
  f.setVisibility('STYLE', [condition(), { opcode: 1, selector: null, arity: 1 }])
  f.set(f.assetId, AssetField, row => { row.value.sha256 = Array(32).fill(0) })
  await expect(f.readRender()).rejects.toThrow('descriptor mismatch')
  await expect(f.readRender([{ ...f.baseSelection, source_definition_id: id(999) }])).rejects.toThrow('source mismatch')
})

it.each(['partId','itemRowId'] as const)('new %s condition read participates in the stable read set', async name => {
  const f = nativeRenderSourceFixture()
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    const result = await original(request)
    return request.objectId === f[name] && request.readMask.paths.length === 3
      ? { response: { object: { ...result.response.object, version: 999n } } } : result
  }
  await expect(f.readRender()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED', status: 409 })
})
