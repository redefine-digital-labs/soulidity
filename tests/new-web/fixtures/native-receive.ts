import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase58, normalizeStructTag } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(3))
const V = bcs.vector(bcs.u8()); const A = bcs.Address; const U = bcs.u64(); const S = bcs.string(); const B = bcs.bool()
/** Raw framework Field<Wrapper<kiosk::Item>, ID>, followed by its child. */
export function fixtureKioskItem(objects: Map<string, any>, kioskId: string, itemId: string) {
  const item = objects.get(itemId), fieldId = deriveKioskItemFieldId(kioskId, itemId)
  objects.set(fieldId, { objectId: fieldId, version: item.version, digest: item.digest,
    previousTransaction: item.previousTransaction, objectType: KIOSK_ITEM_FIELD_TYPE,
    owner: { kind: 2, address: kioskId }, contents: { value: KioskItemFieldBcs.serialize({
      id: fieldId, name: { name: { id: itemId } }, value: itemId }).toBytes() } })
  item.owner = { kind: 2, address: fieldId }
  return fieldId
}
export function nativeReceiveFixture() {
  const target = { protocolConfigId: id(1), coreOriginalPackageId: id(2), outputOriginalPackageId: id(3), outputCallablePackageId: id(4), soulidityCallablePackageId: id(5), soulidityOriginalPackageId: id(6), outputCallableDigest: digest, soulidityCallableDigest: digest,
    expectedNativeBinding: { soulOriginalType: `${id(6)}::soul::Soul`, soulDefiningType: `${id(6)}::soul::Soul`, mintWitnessOriginalType: `${id(6)}::animacraft_v8_binding::MintBindingWitnessV8`, mintWitnessDefiningType: `${id(7)}::animacraft_v8_binding::MintBindingWitnessV8`, ownerWitnessOriginalType: `${id(6)}::animacraft_v8_binding::SoulOwnerWitnessV8`, ownerWitnessDefiningType: `${id(7)}::animacraft_v8_binding::SoulOwnerWitnessV8` } }
  const input = { rootId: id(10), signer: id(11), txDigest: digest, soulOnChainId: id(12), contentSidecars: [{ kind: 0, name: 'soul', versionIndex: 0, sidecar: null }] }
  const name = bcs.struct('TypeName', { name: S })
  const slot = bcs.struct('Slot', { config_id: A, soul_original: name, soul_defining: name, mint_original: name, mint_defining: name, owner_original: name, owner_defining: name })
  const keyType = `${id(2)}::protocol_config_v8::SoulidityBindingSlotKeyV8`
  const dynamicField = { $kind: 'DynamicField', fieldId: deriveDynamicFieldID(id(1), keyType, new Uint8Array([0])), value: { type: `${id(2)}::protocol_config_v8::SoulidityBindingV8`, bcs: slot.serialize({ config_id: id(1), ...Object.fromEntries(['soul_original','soul_defining','mint_original','mint_defining','owner_original','owner_defining'].map((key, index) => [key, { name: Object.values(target.expectedNativeBinding)[index].slice(2) }])) } as never).toBytes() } }
  const objects = new Map<string, any>()
  const pkg = (objectId: string, originalId: string, rows: string[][]) => ({ objectId, version: 1n, digest, owner: { kind: 4 }, package: { storageId: objectId, originalId, version: 1n, typeOrigins: rows.map(([moduleName, datatypeName, packageId]) => ({ moduleName, datatypeName, packageId })), modules: [...new Set(rows.map(row => row[0]))].map(name => ({ name, contents: new Uint8Array([161,28,235,11,7]) })), linkage: [] } })
  objects.set(id(5), pkg(id(5), id(6), [['soul','Soul',id(6)],['soul','SoulState',id(6)],['animacraft_v8_binding','MintBindingWitnessV8',id(7)],['animacraft_v8_binding','SoulOwnerWitnessV8',id(7)],['market','SoulMintedToKiosk',id(6)],['content','ContentVersionAppended',id(6)]]))
  objects.get(id(5)).package.linkage.push({ originalId: id(3), upgradedId: id(4), upgradedVersion: 1n })
  objects.get(id(5)).package.typeOrigins.push({moduleName:'content',datatypeName:'SoulContent',packageId:id(6)})
  objects.set(id(4), pkg(id(4), id(3), [['output_v8','NativeSoulBoundV8',id(3)],['output_v8','NativeSoulBindingV8',id(3)]]))
  objects.get(id(4)).package.typeOrigins.push({ moduleName: 'output_v8', datatypeName: 'CompleteOutputV8', packageId: id(3) })
  const changes: any[] = []; const events: any[] = []
  const put = (objectId: string, type: string, shape: any, fields: any, immutable = false) => {
    objects.set(objectId, { objectId, version: 2n, digest, previousTransaction: digest, objectType: normalizeStructTag(type), owner: immutable ? { kind: 4 } : { kind: 3, version: 2n }, contents: { value: bcs.struct('Fixture', shape).serialize(fields).toBytes() } })
    changes.push({ objectId, idOperation: 'Created', outputVersion: '2', outputDigest: digest })
  }
  const event = (type: string, shape: any, fields: any) => events.push({ eventType: type, bcs: bcs.struct('Event', shape).serialize(fields).toBytes() })
  const bound = { binding_id:id(13), soul_id:id(12), soul_state_id:id(14), root_id:id(10), output_id:id(15), receipt_id:id(16), original_holder:id(11), authorization_commitment:Array(32).fill(1) }
  event(`${id(3)}::output_v8::NativeSoulBoundV8`, { binding_id:A,soul_id:A,soul_state_id:A,root_id:A,output_id:A,receipt_id:A,original_holder:A,authorization_commitment:V }, bound)
  event(`${id(6)}::market::SoulMintedToKiosk`, { soul_id:A,state_id:A,content_id:A,kiosk_id:A,owner:A,provenance_kind:bcs.u8() }, { soul_id:id(12),state_id:id(14),content_id:id(17),kiosk_id:id(18),owner:id(11),provenance_kind:3 })
  const rightsShape = { origin:bcs.u8(),creator:A,creator_confirmed:B,evidence_certified:B,certification_catalog_id:bcs.option(A),certification_binding_commitment:bcs.option(V),evidence_locator:S,evidence_blob_id:S,evidence_sha256:V,terms_commitment:V,soul_creator_royalty_bps:bcs.u16(),maker_source_royalty_bps:bcs.u16(),maker_resale_royalty_bps:bcs.u16(),commitment:V }
  const rights = { origin:0,creator:id(11),creator_confirmed:true,evidence_certified:false,certification_catalog_id:null,certification_binding_commitment:null,evidence_locator:'',evidence_blob_id:'',evidence_sha256:[],terms_commitment:[],soul_creator_royalty_bps:0,maker_source_royalty_bps:0,maker_resale_royalty_bps:0,commitment:[] }
  put(id(13),`${id(3)}::output_v8::NativeSoulBindingV8`,{ id:A,version:U,protocol_config_id:A,soul_registry_id:A,soul_id:A,soul_state_id:A,root_id:A,maker_version:U,root_content_commitment:V,maker_creator:A,maker_treasury_id:A,original_holder:A,output_id:A,receipt_id:A,output_key:S,output_policy_commitment:V,recipe_commitment:V,render_commitment:V,output_commitment:V,receipt_commitment:V,rights:bcs.struct('Rights',rightsShape),authorization_commitment:V },{ id:id(13),version:'8',protocol_config_id:id(1),soul_registry_id:id(19),soul_id:id(12),soul_state_id:id(14),root_id:id(10),maker_version:'1',root_content_commitment:[],maker_creator:id(11),maker_treasury_id:id(20),original_holder:id(11),output_id:id(15),receipt_id:id(16),output_key:'main',output_policy_commitment:[],recipe_commitment:[],render_commitment:[],output_commitment:[],receipt_commitment:[],rights,authorization_commitment:bound.authorization_commitment },true)
  const table = bcs.struct('Table',{id:A,size:U}); const t = {id:id(21),size:'0'}
  put(id(17),`${id(6)}::content::SoulContent`,{id:A,version:U,soul_id:A,items:table,count_by_kind:table,active:table},{id:id(17),version:'1',soul_id:id(12),items:t,count_by_kind:t,active:t})
  put(id(14),`${id(6)}::soul::SoulState`,{id:A,version:U,soul_id:A,creator:A,creator_royalty_bps:bcs.u16(),current_owner:A,current_kiosk_id:A,ownership_epoch:U,grant_capacity:U,active_grants:table,active_grant_ids:table,active_grant_count:U,content_id:bcs.option(A),config_ext:table,collection_id:bcs.option(A),access_list_id:bcs.option(A),is_listed:B},{id:id(14),version:'1',soul_id:id(12),creator:id(11),creator_royalty_bps:0,current_owner:id(11),current_kiosk_id:id(18),ownership_epoch:'0',grant_capacity:'1',active_grants:t,active_grant_ids:t,active_grant_count:'0',content_id:id(17),config_ext:t,collection_id:null,access_list_id:null,is_listed:false})
  const dfId = deriveDynamicFieldID(id(14),'u8',new Uint8Array([9]))
  put(dfId,'0x2::dynamic_field::Field<u8,0x2::object::ID>',{id:A,name:bcs.u8(),value:A},{id:dfId,name:9,value:id(13)})
  objects.get(dfId).owner = { kind: 2, address: id(14) }
  put(id(12),`${id(6)}::soul::Soul`,{id:A,version:U,name:S,description:S,image_url:S,provenance_kind:bcs.u8(),origin_ref:bcs.option(S),creator:A},{id:id(12),version:'1',name:'Soul',description:'',image_url:'walrus://test',provenance_kind:3,origin_ref:null,creator:id(11)})
  const itemFieldId = fixtureKioskItem(objects, id(18), id(12))
  changes.push({ objectId: itemFieldId, idOperation: 'Created', outputVersion: '2', outputDigest: digest })
  for (const change of changes) {
    const owner = objects.get(change.objectId).owner
    Object.assign(change, { inputState: 'DoesNotExist', inputVersion: null, inputDigest: null, inputOwner: null,
      outputState: 'ObjectWrite', outputOwner: owner.kind === 2 ? { $kind: 'ObjectOwner', ObjectOwner: owner.address }
        : owner.kind === 3 ? { $kind: 'Shared', Shared: { initialSharedVersion: '2' } } : { $kind: 'Immutable', Immutable: true } })
  }
  event(`${id(6)}::content::ContentVersionAppended`,{content_id:A,soul_id:A,kind:bcs.u32(),kind_name:S,name:S,version_index:U,is_public:B,download_policy:bcs.u8(),grant_scope_mask:U,read_mode_mask:U,op_mask:U,seal_encrypted:B,blob_object_id:A,created_at_ms:U},{content_id:id(17),soul_id:id(12),kind:0,kind_name:'SOUL_DOC',name:'soul',version_index:'0',is_public:true,download_policy:0,grant_scope_mask:'0',read_mode_mask:'1',op_mask:'0',seal_encrypted:false,blob_object_id:id(22),created_at_ms:'1'})
  const tx:any = {digest,status:{success:true},effects:{transactionDigest:digest,changedObjects:changes},events,transaction:{sender:id(11),inputs:[id(10),id(1),id(19)].map(objectId => ({Object:{SharedObject:{objectId}}})),commands:[{MoveCall:{package:id(5),module:'market',function:'mint_animacraft_v8_in_personal_kiosk',arguments:Array.from({length:16},(_,i)=>({Input:i===6?0:i===7?1:2}))}}]}}
  const calls:any[]=[]
  const client = {
    core: { getChainIdentifier: async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' }), getDynamicField: async () => ({ dynamicField }), getTransaction: async () => ({ Transaction: tx }) },
    ledgerService: { getObject: async (request: any) => { calls.push(request); return { response: { object: objects.get(request.objectId) } } } },
  } as unknown as SuiGrpcClient
  return {target,input,client,objects,tx,dynamicField,calls,dfId,itemFieldId}
}
