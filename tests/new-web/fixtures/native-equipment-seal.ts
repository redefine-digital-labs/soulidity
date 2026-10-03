import { nativeEquipmentSourceFixture } from './native-equipment-source'
import { EquipmentStyleRowBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealRegistryBcs, EquipmentSealPolicyBcs,
  equipmentSealId } from '../../../web/lib/animacraft/native-equipment-seal'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { bcs } from '@mysten/sui/bcs'
const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
const h = (n: number) => Array(32).fill(n)
export function nativeEquipmentSealFixture() {
  const f = nativeEquipmentSourceFixture()
  const type = (name: string) => `${id(201)}::seal_v8::${name}`
  for (const objectId of [id(5),id(71)]) f.objects.get(objectId).package.linkage.push({
    originalId: id(201), upgradedId: id(202), upgradedVersion: 2n,
  })
  f.objects.set(id(202), { objectId: id(202), version: 2n, digest: f.target.outputCallableDigest, owner: { kind: 4 },
    package: { storageId: id(202), originalId: id(201), version: 2n,
      modules: [{ name: 'seal_v8', contents: new Uint8Array([1,2,3,4,5]) }], linkage: [],
      typeOrigins: ['SealRegistryV8','SealPolicyConfigV8','ProtectedAssetKeyV8','ProtectedAssetV8','SealCallableMarkerV8','SealSetupInstallWitnessV2']
        .map(datatypeName => ({ moduleName: 'seal_v8', datatypeName, packageId: id(201) })) } })
  const StyleField = bcs.struct('Field', { id: bcs.Address,
    name: bcs.struct('StyleKeyV8', { part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string() }), value: EquipmentStyleRowBcs })
  const editStyle = (change: (value: any) => void) => f.set(f.styleId,StyleField,v => change(v.value))
  editStyle(v => { v.protected = true })
  const key = { scope_kind: 0, scope_key: 'maker/base', asset_key: 'body/hat/red' }
  const registry = { id: id(87), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: h(1),
    catalog_id: id(32), product_binding_commitment: h(1), policy_config_id: id(203), policy_commitment: h(2),
    expected_base_count: '1', expected_pack_count: '0', expected_complete_count: '0', base_count: '1', pack_count: '0', complete_count: '0',
    base_commitment: h(3), pack_commitment: h(4), complete_commitment: h(5), revision: '1', commitment: h(6), sealed: true,
    keys: [key], assets: { id: id(204), size: '1' }, runtime_revision: '0', runtime_keys: [], runtime_assets: { id: id(205), size: '0' } }
  const policy = { id: id(203), version: '8', protocol_config_id: id(1), protocol_config_revision: '1', catalog_id: id(32),
    product_binding_commitment: h(1), seal_original_package_id: id(201), seal_callable_package_id: id(201),
    seal_binding_commitment: h(7), seal_authority_id: id(206), call_cap_set_commitment: h(2), role: 1, finalized: true,
    key_servers: [{ key_server_id: id(207), weight: 1 }], threshold: 1, cipher_suite: 'fixture', key_derivation: 'fixture',
    ciphertext_format: 'fixture', max_plaintext_bytes: '1048576', key_server_set_commitment: h(8), encryption_policy_commitment: h(9),
    commitment: h(2), config_commitment: h(10) }
  const asset = { ...key, scope_commitment: h(1), asset_content_commitment: h(4), ciphertext_blob_id: 'blob', ciphertext_sha256: h(3),
    ciphertext_blob_commitment: h(11), certification_commitment: h(12), seal_id: equipmentSealId(registry,key.asset_key) }
  f.put(id(87),type('SealRegistryV8'),EquipmentSealRegistryBcs,registry)
  f.put(id(203),type('SealPolicyConfigV8'),EquipmentSealPolicyBcs,policy)
  const putAsset = (parent: string, value = asset) => f.field(parent,type('ProtectedAssetKeyV8'),EquipmentProtectedKeyBcs,
    key,type('ProtectedAssetV8'),EquipmentProtectedAssetBcs,value)
  const assetId = putAsset(id(204))
  const runtimeAssetId = deriveDynamicFieldID(id(205),type('ProtectedAssetKeyV8'),EquipmentProtectedKeyBcs.serialize(key).toBytes())
  return { ...f, type, key, registry, policy, asset, assetId, runtimeAssetId, putAsset, editStyle }
}
