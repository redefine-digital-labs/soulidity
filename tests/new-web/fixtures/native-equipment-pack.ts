import { bcs } from '@mysten/sui/bcs'
import { vi } from 'vitest'
import { nativeEquipmentSourceFixture } from './native-equipment-source'
import { readNativeEquipment } from '../../../web/lib/animacraft/native-equipment'
import { EquipmentColorRowBcs, EquipmentMakerBcs, EquipmentPackRegistryBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentPackPassBcs, EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs,
  EquipmentPackAdmissionBcs, equipmentPackPassCommitment, type EquipmentPackQuery } from '../../../web/lib/animacraft/native-equipment-pack'
import { NativePackDefinitionsBcs, NativePackDefinitionsKeyBcs, nativePackDefinitionsCommitment,
  type NativePackDefinitions } from '../../../web/lib/animacraft/native-pack-definitions'
import { nativeVisibilityCommitment } from '../../../web/lib/animacraft/native-visibility'
export const packId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const id = packId; const h = (n: number) => Array(32).fill(n)
export function nativeEquipmentPackFixture() {
  const f = nativeEquipmentSourceFixture(); const rt = f.runtimeType
  for (const datatypeName of ['PackPassV8','PackReleaseV8','PackStyleV8','PackStyleKeyV8','PackAdmissionRecordV8','PackDefinitionsKeyV8','PackDefinitionsV8']) {
    f.objects.get(id(71)).package.typeOrigins.push({ moduleName: 'runtime_v8', datatypeName, packageId: id(70) })
  }
  const passId = id(201); const releaseId = id(202); const stylesId = id(203)
  const pass = { id: passId, version: '8', release_id: releaseId, root_id: id(10), root_version: '1',
    root_content_commitment: h(1), release_content_commitment: h(8), holder: id(11), paid_atomic: '0', issued_at_ms: '12', commitment: h(0) }
  pass.commitment = equipmentPackPassCommitment(pass)
  f.put(passId, rt('PackPassV8'), EquipmentPackPassBcs, pass, 1, id(11))
  const release = { id: releaseId, version: '8', root_id: id(10), root_version: '1', root_content_commitment: h(1),
    creator: id(11), owner: id(31), control_epoch: '9', admin_cap_id: id(204), treasury_id: id(205), semantic_pack_id: 'winter',
    manifest_blob_id: 'manifest', manifest_sha256: h(9), content_commitment: h(8), lifecycle: 2, access_kind: 0,
    access_price_atomic: '0', complete_mode: 0, complete_price_atomic: '0', complete_free_quota_per_wallet: '0', complete_total_cap: '0',
    expected_style_count: '1', observed_style_count: '1', expected_style_commitment: h(8), rolling_style_commitment: h(8),
    protected_style_count: '0', pass_count: '1', total_complete_count: '0', styles: { id: stylesId, size: '1' },
    complete_by_wallet: { id: id(206), size: '0' } }
  const coin = EquipmentMakerBcs.parse(f.objects.get(id(10)).contents.value).economics.payment_coin_type
  f.put(releaseId, `${rt('PackReleaseV8')}<${coin}>`, EquipmentPackReleaseBcs, release)
  const key = { part_key: 'body', item_key: 'pack-hat', style_key: 'snow' }
  const style = { index: '0', definition_sources: { part: 1, track: 1, color: 1 },
    ...key, layer_track_key: 'front', color_channel_key: 'pack-tint', default_swatch_key: 'snow',
    asset_blob_id: 'pack-blob', asset_sha256: h(9), asset_content_commitment: h(10), protected: false,
    seal_binding_commitment: [], style_commitment: h(11) }
  const styleId = f.field(stylesId, rt('PackStyleKeyV8'), EquipmentPackStyleKeyBcs, key, rt('PackStyleV8'), EquipmentPackStyleBcs, style)
  const ColorKey = bcs.struct('ColorKeyV8', { channel_key: bcs.string() })
  const colorId = f.field(id(85), f.ct('base_registry_v8','ColorKeyV8'), ColorKey, { channel_key: 'pack-tint' },
    f.ct('base_registry_v8','ColorChannelRowV2'), EquipmentColorRowBcs, { sequence: '1', key: 'pack-tint', label: 'Pack tint',
      default_swatch_key: 'snow', swatches: [{ key: 'snow', label: 'Snow', rgba: 4294967295, stops: [] },
        { key: 'gold', label: 'Gold', rgba: 4294902015, stops: [] }] })
  const admissionId = f.field(id(92), '0x2::object::ID', bcs.Address, releaseId, rt('PackAdmissionRecordV8'), EquipmentPackAdmissionBcs,
    { release_id: releaseId, semantic_pack_id: 'winter', release_content_commitment: h(8), admitted_revision: '1', admission_state: 0 })
  const semanticId = f.field(id(93), '0x1::string::String', bcs.string(), 'winter', '0x2::object::ID', bcs.Address, releaseId)
  f.set(id(82), EquipmentPackRegistryBcs, v => { v.revision = '1'; v.release_count = '1'; v.releases.size = '1'; v.semantic_releases.size = '1' })
  const passHint = { objectId: passId, type: rt('PackPassV8'), owner: { $kind: 'AddressOwner' as const, AddressOwner: id(11) } }
  const styleHint = { $kind: 'DynamicField' as const, fieldId: styleId,
    type: `0x2::dynamic_field::Field<${rt('PackStyleKeyV8')},${rt('PackStyleV8')}>`,
    name: { type: rt('PackStyleKeyV8'), bcs: EquipmentPackStyleKeyBcs.serialize(key).toBytes() }, valueType: rt('PackStyleV8') }
  const listPasses = vi.fn(async (_query?: unknown) => ({ objects: [passHint], hasNextPage: false, cursor: null as string | null }))
  const listStyles = vi.fn(async (_query?: unknown) => ({ dynamicFields: [styleHint], hasNextPage: false, cursor: null as string | null }))
  ;(f.client.core as any).listOwnedObjects = listPasses
  ;(f.client.core as any).listDynamicFields = listStyles
  const readPack = (query: EquipmentPackQuery = { passId }) => readNativeEquipment(f.client, f.target,
    { soulId: id(12), stateId: id(14), source: { pack: query } })
  const addOwnedColor = (attach = false) => {
    const definitions: NativePackDefinitions = { version: '8', release_id: releaseId,
      release_content_commitment: release.content_commitment, commitment: [], rows: {
        semantic_pack_id: 'winter', tracks: [], parts: [], rules: [], visibility: ([1, 2] as const).map(subject => ({
          subject, definition_source: 2, part_key: 'body', item_key: 'pack-hat', style_key: subject === 1 ? null : 'snow',
          visibility_tokens: [], visibility_commitment: nativeVisibilityCommitment({ level: subject === 1 ? 'ITEM' : 'STYLE',
            partKey: 'body', itemKey: 'pack-hat', styleKey: subject === 1 ? null : 'snow',
            definitionSource: 2, definitionSourceKey: 'winter' }, []),
        })),
        colors: [{ sequence: '0', key: 'pack-tint', label: 'Owned tint', default_swatch_key: 'violet',
          swatches: [{ key: 'violet', label: 'Owned violet', rgba: 0x8000ffff,
            stops: [{ offset_ppm: '0', rgba: 0x8000ffff }, { offset_ppm: '1000000', rgba: 0xffffffff }] }] }],
      } }
    definitions.commitment = nativePackDefinitionsCommitment(definitions)
    const definitionId = f.field(releaseId, rt('PackDefinitionsKeyV8'), NativePackDefinitionsKeyBcs, { dummy_field: false },
      rt('PackDefinitionsV8'), NativePackDefinitionsBcs, definitions)
    f.set(styleId, bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }), row => {
      row.value.definition_sources.color = 2; row.value.default_swatch_key = 'violet'
    })
    if (attach) f.editLoadout(row => { row.attached_pack_definitions.push({ release_id: releaseId, definition_commitment: definitions.commitment }) })
    return { definitionId, definitions }
  }
  return { ...f, passId, releaseId, stylesId, packStyleId: styleId, colorId, admissionId, semanticId,
    pass, release, packStyle: style, passHint, styleHint, listPasses, listStyles, readPack, addOwnedColor }
}
