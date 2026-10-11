import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeReceiveFixture } from './native-receive'
import { NativeSoulBindingBcs } from '../../../web/lib/animacraft/native-receive'
import { readNativeEquipment, EquipmentLoadoutBcs, EquipmentBindingFieldBcs, EquipmentPointerBcs,
  EquipmentBaseItemBcs, equipmentCommitment } from '../../../web/lib/animacraft/native-equipment'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const hash = (n: number) => Array(32).fill(n)
export function nativeEquipmentFixture() {
  const f = nativeReceiveFixture()
  const target = { ...f.target, runtime: { originalPackageId: id(70), callablePackageId: id(71), callableDigest: f.target.outputCallableDigest } }
  const runtimeType = (name: string) => `${id(70)}::runtime_v8::${name}`
  const put = (objectId: string, type: string, schema: any, value: any, kind = 3, address?: string) => {
    f.objects.set(objectId, { objectId, objectType: type, version: 2n, digest: f.target.outputCallableDigest,
      owner: { kind, address }, contents: { value: schema.serialize(value).toBytes() } })
  }
  const set = (objectId: string, schema: any, change: (value: any) => void) => {
    const obj = f.objects.get(objectId); const value = schema.parse(obj.contents.value)
    change(value); obj.contents.value = schema.serialize(value).toBytes()
  }
  f.objects.set(id(71), { objectId: id(71), version: 1n, digest: target.runtime.callableDigest, owner: { kind: 4 },
    package: { storageId: id(71), originalId: id(70), version: 1n, modules: [{ name: 'runtime_v8', contents: new Uint8Array([1,2,3,4,5]) }],
      typeOrigins: ['MakerLoadoutV8', 'SoulEquipmentKeyV8', 'SoulEquipmentBindingV8', 'OwnedBaseItemV8', 'OwnedExternalItemV8']
        .map(datatypeName => ({ moduleName: 'runtime_v8', datatypeName, packageId: id(70) })), linkage: [] } })
  for (const parent of [id(4), id(5)]) f.objects.get(parent).package.linkage.push({ originalId: id(70), upgradedId: id(71), upgradedVersion: 1n })
  set(id(13), NativeSoulBindingBcs, v => { v.root_content_commitment = hash(1) })
  const pointerId = deriveDynamicFieldID(id(14), 'u8', new Uint8Array([10]))
  const keyType = runtimeType('SoulEquipmentKeyV8')
  const bindingId = deriveDynamicFieldID(id(80), keyType, new Uint8Array([0]))
  const loadout = { id: id(80), version: '8', root_id: id(10), root_version: '1', root_content_commitment: hash(1),
    definition_registry_id: id(81), pack_registry_id: id(82), maker_access_pass_id: id(83), maker_access_commitment: hash(2),
    holder: id(11), revision: '1', selection_count: '1', commitment: hash(0),
    attached_pack_definitions: [],
    definition_slots: [{ source_definition_id: id(10), part_key: 'body', profile_commitment: hash(1), start: '0', capacity: '1' }], selections: [{
      selection_index: '0', part_key: 'body', item_key: 'hat', style_key: 'red', color_channel_key: null,
      swatch_key: null, layer_track_key: 'front', asset_blob_id: 'blob', asset_sha256: hash(3), asset_content_commitment: hash(4),
      source_class: 0, source_definition_id: id(10), source_semantic_id: '', access_subject: id(84), source_epoch: '0',
      pricing_commitment: hash(5), protected: false, seal_binding_commitment: [],
    }] }
  loadout.commitment = [...Buffer.from(equipmentCommitment(loadout), 'hex')]
  put(id(80), runtimeType('MakerLoadoutV8'), EquipmentLoadoutBcs, loadout)
  put(pointerId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', EquipmentPointerBcs,
    { id: pointerId, name: 10, value: id(80) }, 2, id(14))
  put(bindingId, `0x2::dynamic_field::Field<${keyType},${runtimeType('SoulEquipmentBindingV8')}>`, EquipmentBindingFieldBcs,
    { id: bindingId, name: { dummy_field: false }, value: { soul_id: id(12), soul_state_id: id(14), holder: id(11), ownership_epoch: '0', protocol_config_id: id(1) } }, 2, id(80))
  put(id(84), runtimeType('OwnedBaseItemV8'), EquipmentBaseItemBcs, { id: id(84), version: '8', root_id: id(10), root_version: '1',
    root_content_commitment: hash(1), definition_registry_id: id(81), pack_registry_id: id(82), base_registry_id: id(85),
    part_key: 'body', item_key: 'hat', item_payload_commitment: hash(4), holder: id(11), ownership_epoch: '0', transferable: true,
    equip_lock: { loadout_id: id(80), equip_revision: '1', selection_index: '0' } }, 1, id(11))
  ;(f.client.ledgerService as any).batchGetObjects = async ({ requests }: any) => ({ response: { objects: requests.map(({ objectId }: any) => ({
    result: f.objects.has(objectId) ? { oneofKind: 'object', object: f.objects.get(objectId) }
      : { oneofKind: 'error', error: { code: 5, message: 'not found' } },
  })) } })
  const read = (inventory?: { kind: 'base' | 'external'; cursor?: string }) => readNativeEquipment(f.client, target,
    { soulId: id(12), stateId: id(14), inventory })
  const editLoadout = (change: (value: any) => void) => set(id(80), EquipmentLoadoutBcs, v => {
    change(v); v.commitment = [...Buffer.from(equipmentCommitment(v), 'hex')]
  })
  return { ...f, target, read, set, put, pointerId, bindingId, editLoadout, runtimeType }
}
