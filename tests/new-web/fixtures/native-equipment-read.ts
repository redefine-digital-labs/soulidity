import { bcs } from '@mysten/sui/bcs'
import { nativeCompleteReadFixture, completeId as id } from './native-complete-read'
import { nativeEquipmentPackFixture } from './native-equipment-pack'
import { EquipmentBaseItemBcs } from '../../../web/lib/animacraft/native-equipment'
import { EquipmentDefinitionsBcs, EquipmentStyleRowBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../../web/lib/animacraft/native-equipment-pack'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealIdBcs, EquipmentSealRegistryBcs,
  equipmentSealBinding } from '../../../web/lib/animacraft/native-equipment-seal'
import { completeReadHash, completeReadCertificationHash, completeReadRegistryHash } from '../../../web/lib/animacraft/native-complete-read-bcs'
import { readNativeEquipmentReadTarget, equipmentReadOwnedPricing, equipmentReadPackPricing } from '../../../web/lib/animacraft/native-equipment-read'

export function nativeEquipmentReadFixture(kind: 'base' | 'owned-base' | 'pack' = 'owned-base') {
  const f = nativeCompleteReadFixture(), h = (n: number) => Array(32).fill(n)
  f.objects.get(id(71)).package.linkage.push({ originalId: id(210), upgradedId: id(211), upgradedVersion: 1n })
  const StyleKey = bcs.struct('StyleKeyV8', { part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string() })
  const StyleField = bcs.struct('Field', { id: bcs.Address, name: StyleKey, value: EquipmentStyleRowBcs })
  let pack: ReturnType<typeof nativeEquipmentPackFixture> | undefined
  if (kind === 'pack') {
    pack = nativeEquipmentPackFixture()
    for (const [key, value] of pack.objects) if (!f.objects.has(key)) f.objects.set(key, value)
    f.objects.set(id(82), pack.objects.get(id(82)))
    for (const origin of pack.objects.get(id(71)).package.typeOrigins) {
      if (!f.objects.get(id(71)).package.typeOrigins.some((row: any) => row.moduleName === origin.moduleName && row.datatypeName === origin.datatypeName)) {
        f.objects.get(id(71)).package.typeOrigins.push(origin)
      }
    }
  }
  const key = { scope_kind: kind === 'pack' ? 1 : 0, scope_key: kind === 'pack' ? 'pack/winter' : 'maker/base',
    asset_key: kind === 'pack' ? 'body/pack-hat/snow' : 'body/hat/red' }
  f.registry.keys.push(key); f.registry.assets.size = '1'
  if (kind === 'pack') { f.registry.expected_pack_count = '1'; f.registry.pack_count = '1' }
  else { f.registry.expected_base_count = '1'; f.registry.base_count = '1' }
  f.registry.commitment = completeReadRegistryHash(f.registry)
  f.put(id(87), f.st('SealRegistryV8'), EquipmentSealRegistryBcs, f.registry)
  const aad = EquipmentSealIdBcs.serialize({ ...f.registry, ...key,
    domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2', schema_revision: '2' }).toBytes()
  const asset = { ...key, scope_commitment: h(kind === 'pack' ? 8 : 1), asset_content_commitment: h(kind === 'pack' ? 10 : 4),
    ciphertext_blob_id: f.blobId, ciphertext_sha256: h(3), ciphertext_blob_commitment: h(19),
    certification_commitment: h(1), seal_id: completeReadHash(aad) }
  asset.certification_commitment = completeReadCertificationHash(f.registry, asset)
  const sealBinding = equipmentSealBinding(f.registry, asset)
  const protectedAssetId = f.field(id(280), f.st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key,
    f.st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, asset)
  if (kind === 'base') f.set(id(81), EquipmentDefinitionsBcs, row => { row.item_assetization = false })
  f.set(f.styleId, StyleField, row => { row.value.protected = true; row.value.asset_blob_id = f.blobId; row.value.asset_sha256 = h(3) })
  if (pack) f.set(pack.packStyleId, bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }), row => {
    row.value.protected = true; row.value.asset_blob_id = f.blobId; row.value.asset_sha256 = h(3); row.value.seal_binding_commitment = sealBinding
  })
  f.editLoadout(loadout => {
    const slot = loadout.selections[0]!
    Object.assign(slot, { protected: true, asset_blob_id: f.blobId, asset_sha256: h(3), seal_binding_commitment: sealBinding,
      color_channel_key: 'tint', swatch_key: 'red' })
    if (kind === 'base') { slot.access_subject = id(83); slot.pricing_commitment = loadout.maker_access_commitment }
    if (kind === 'owned-base') slot.pricing_commitment = equipmentReadOwnedPricing(EquipmentBaseItemBcs.parse(f.objects.get(id(84)).contents.value))
    if (pack) Object.assign(slot, { item_key: 'pack-hat', style_key: 'snow', color_channel_key: 'pack-tint', swatch_key: 'snow',
      source_class: 1, source_definition_id: pack.releaseId, source_semantic_id: 'winter', access_subject: pack.passId,
      pricing_commitment: equipmentReadPackPricing(pack.release), asset_content_commitment: h(10) })
  })
  return { ...f, kind, pack, protectedAssetId, protectedAsset: asset, equipmentAad: aad,
    readEquipment: (selectionIndex = 0, signal?: AbortSignal) => readNativeEquipmentReadTarget(f.client, f.target,
      { soulId: id(12), stateId: id(14), selectionIndex }, signal) }
}
