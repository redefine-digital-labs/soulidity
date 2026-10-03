import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeEquipmentPackFixture, packId as id } from './native-equipment-pack'
import { EquipmentLoadoutBcs, EquipmentSelectionBcs } from '../../../web/lib/animacraft/native-equipment'
import { EquipmentAssetRowBcs, EquipmentExternalProductBcs, EquipmentPartRowBcs, EquipmentItemRowBcs, EquipmentStyleRowBcs, EquipmentTrackRowBcs, EquipmentColorRowBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { readNativeRenderSource } from '../../../web/lib/animacraft/native-render-source'
import { nativeVisibilityCommitment, type NativeVisibilityToken, type NativeVisibilityLevel } from '../../../web/lib/animacraft/native-visibility'

export type RenderSelectionFixture = ReturnType<typeof EquipmentSelectionBcs.parse>
export function renderSelectionFixture(overrides: Partial<RenderSelectionFixture> = {}): RenderSelectionFixture {
  return { selection_index: '0', part_key: 'body', item_key: 'hat', style_key: 'red', color_channel_key: null,
    swatch_key: null, layer_track_key: 'front', asset_blob_id: 'blob', asset_sha256: Array(32).fill(3),
    asset_content_commitment: Array(32).fill(4), source_class: 0, source_definition_id: id(10), source_semantic_id: '',
    access_subject: id(83), source_epoch: '0', pricing_commitment: Array(32).fill(1), protected: false,
    seal_binding_commitment: [], ...overrides }
}
export function nativeRenderSourceFixture() {
  const f = nativeEquipmentPackFixture()
  for (const datatypeName of ['AssetKeyV2', 'AssetRowV2', 'PartKeyV8', 'PartRowV2']) f.objects.get(id(72)).package.typeOrigins.push({
    moduleName: 'base_registry_v8', datatypeName, packageId: id(2),
  })
  const assetKey = bcs.struct('AssetKeyV2', { asset_id: bcs.string() })
  const assetId = f.field(id(85), f.ct('base_registry_v8', 'AssetKeyV2'), assetKey, { asset_id: 'hat' },
    f.ct('base_registry_v8', 'AssetRowV2'), EquipmentAssetRowBcs,
    { sequence: '1', asset_id: 'hat', kind: 'style', media_type: 'image/png', byte_length: '100', sha256: f.style.asset_sha256 })
  const baseSelection = { ...EquipmentLoadoutBcs.parse(f.objects.get(id(80)).contents.value).selections[0]!,
    color_channel_key: 'tint', swatch_key: 'red' }
  const partKey = bcs.struct('PartKeyV8', { key: bcs.string() })
  const itemKey = bcs.struct('ItemKeyV8', { part_key: bcs.string(), item_key: bcs.string() })
  const styleKey = bcs.struct('StyleKeyV8', { part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string() })
  const partId = f.field(id(85), f.ct('base_registry_v8', 'PartKeyV8'), partKey, { key: 'body' },
    f.ct('base_registry_v8', 'PartRowV2'), EquipmentPartRowBcs, { sequence: '0', key: 'body', label: 'Body', kind: 0,
      render_order: '0', menu_order: '0', visible: true, required: false, slot_mode: 1, capacity: '3', track_keys: ['front'],
      visibility_tokens: [], visibility_commitment: nativeVisibilityCommitment({ level: 'PART', partKey: 'body', itemKey: null, styleKey: null }, []),
      payload_commitment: Array(32).fill(1) })
  const itemRowId = deriveDynamicFieldID(id(85), f.ct('base_registry_v8', 'ItemKeyV8'), itemKey.serialize({ part_key: 'body', item_key: 'hat' }).toBytes())
  function setVisibility(level: NativeVisibilityLevel, tokens: NativeVisibilityToken[], commitment?: number[]) {
    const schema = level === 'PART' ? EquipmentPartRowBcs : level === 'ITEM' ? EquipmentItemRowBcs : EquipmentStyleRowBcs
    const name = level === 'PART' ? partKey : level === 'ITEM' ? itemKey : styleKey
    f.set(level === 'PART' ? partId : level === 'ITEM' ? itemRowId : f.styleId,
      bcs.struct('Field', { id: bcs.Address, name, value: schema }), row => {
        row.value.visibility_tokens = tokens
        row.value.visibility_commitment = commitment ?? nativeVisibilityCommitment({ level, partKey: 'body',
          itemKey: level === 'PART' ? null : 'hat', styleKey: level === 'STYLE' ? 'red' : null }, tokens)
      })
  }
  setVisibility('ITEM', []); setVisibility('STYLE', [])
  const packSelection: RenderSelectionFixture = { ...baseSelection, source_class: 1, source_definition_id: f.releaseId,
    source_semantic_id: f.release.semantic_pack_id, access_subject: f.passId, source_epoch: '0',
    part_key: f.packStyle.part_key, item_key: f.packStyle.item_key, style_key: f.packStyle.style_key,
    layer_track_key: f.packStyle.layer_track_key, color_channel_key: f.packStyle.color_channel_key,
    swatch_key: 'gold', asset_blob_id: f.packStyle.asset_blob_id, asset_sha256: f.packStyle.asset_sha256,
    asset_content_commitment: f.packStyle.asset_content_commitment }
  const external = f.addExternal()
  const product = EquipmentExternalProductBcs.parse(f.objects.get(external.productId).contents.value)
  const externalSelection: RenderSelectionFixture = { ...baseSelection, source_class: 2,
    source_definition_id: product.id, source_semantic_id: '', access_subject: external.itemId,
    part_key: product.part_key, item_key: product.item_key, style_key: product.style_key,
    layer_track_key: product.layer_track_key, color_channel_key: null, swatch_key: null,
    asset_blob_id: product.asset_blob_id, asset_sha256: product.asset_sha256, asset_content_commitment: product.asset_content_commitment }
  const baseColorId = deriveDynamicFieldID(id(85), f.ct('base_registry_v8', 'ColorKeyV8'),
    bcs.struct('ColorKeyV8', { channel_key: bcs.string() }).serialize({ channel_key: 'tint' }).toBytes())
  const requests: Array<{ objectId: string; paths: string[] }> = []
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    requests.push({ objectId: request.objectId, paths: request.readMask.paths }); return original(request)
  }
  const read = (selections: Array<RenderSelectionFixture | null> = [baseSelection]) => readNativeRenderSource(f.client, f.target,
    { rootId: id(10), makerVersion: '1', rootCommitment: Array(32).fill(1), selections })
  return { ...f, readRender: read, assetId, baseColorId, external, product,
    baseSelection, packSelection, externalSelection, requests, partId, itemRowId, setVisibility }
}

/** Actual distinct rows at the 500-selection/256-track limits, not 500 cache hits. */
export function nativeRenderSource500Fixture() {
  const f = nativeRenderSourceFixture()
  const keySchemas = {
    Part: bcs.struct('PartKeyV8', { key: bcs.string() }),
    Item: bcs.struct('ItemKeyV8', { part_key: bcs.string(), item_key: bcs.string() }),
    Style: bcs.struct('StyleKeyV8', { part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string() }),
    Asset: bcs.struct('AssetKeyV2', { asset_id: bcs.string() }),
    Track: bcs.struct('TrackKeyV8', { key: bcs.string() }),
    Color: bcs.struct('ColorKeyV8', { channel_key: bcs.string() }),
  }
  const schemas = { Part: EquipmentPartRowBcs, Item: EquipmentItemRowBcs, Style: EquipmentStyleRowBcs,
    Asset: EquipmentAssetRowBcs, Track: EquipmentTrackRowBcs, Color: EquipmentColorRowBcs }
  const ids = { Part: f.partId, Item: f.itemRowId, Style: f.styleId, Asset: f.assetId, Track: f.trackId, Color: f.baseColorId }
  const templates = Object.fromEntries(Object.keys(schemas).map(name => [name,
    bcs.struct('Field', { id: bcs.Address, name: keySchemas[name as keyof typeof schemas],
      value: schemas[name as keyof typeof schemas] }).parse(f.objects.get(ids[name as keyof typeof schemas]).contents.value).value]))
  function add(name: keyof typeof schemas, key: any, value: any) {
    return f.field(id(85), f.ct('base_registry_v8', `${name}Key${name === 'Asset' ? 'V2' : 'V8'}`), keySchemas[name], key,
      f.ct('base_registry_v8', name === 'Color' ? 'ColorChannelRowV2' : `${name}RowV2`), schemas[name], value)
  }
  for (let index = 0; index < 256; index++) add('Track', { key: `track${index}` }, { ...templates.Track, key: `track${index}`, render_order: String(index) })
  const selections = Array.from({ length: 500 }, (_, index) => {
    const partKey = `part${index}`, track = `track${index % 256}`, color = `color${index}`, assetId = `asset${index}`
    const visibility = (level: NativeVisibilityLevel) => ({ visibility_tokens: [], visibility_commitment:
      nativeVisibilityCommitment({ level, partKey, itemKey: level === 'PART' ? null : 'hat', styleKey: level === 'STYLE' ? 'red' : null }, []) })
    add('Part', { key: partKey }, { ...templates.Part, key: partKey, capacity: '1', track_keys: [track], ...visibility('PART') })
    add('Item', { part_key: partKey, item_key: 'hat' }, { ...templates.Item, part_key: partKey, ...visibility('ITEM') })
    add('Style', { part_key: partKey, item_key: 'hat', style_key: 'red' }, { ...templates.Style, part_key: partKey,
      track_key: track, color_channel_key: color, asset_id: assetId, ...visibility('STYLE') })
    add('Asset', { asset_id: assetId }, { ...templates.Asset, asset_id: assetId })
    add('Color', { channel_key: color }, { ...templates.Color, key: color })
    return { ...f.baseSelection, selection_index: String(index), part_key: partKey, layer_track_key: track, color_channel_key: color }
  })
  return { ...f, selections, renderInput: { rootId: id(10), makerVersion: '1', rootCommitment: Array(32).fill(1), selections } }
}
