import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {deriveDynamicFieldID,normalizeStructTag} from '@mysten/sui/utils'
import {profileReadStep} from '@soulidity/sdk'
import {EquipmentReadSet,EquipmentBaseItemBcs,EquipmentExternalItemBcs,EquipmentKeyBcs,EquipmentBindingFieldBcs,readNativeEquipment} from './native-equipment'
import {EquipmentExternalProductBcs} from './native-equipment-source-bcs'
import {readNativeSourceAuthority} from './native-source-authority'
import {createNativeReceiveClient,decodeNativeBcs,readNativeReceiveTarget,receiveId} from './native-receive'
import {boundedNativeMarketClient} from './browser-native-market-read'
import {validEquipmentCursor} from './native-equipment-bytes'
import {getBrowserNativeEquipmentMarketConfig,type BrowserNativeEquipmentMarketConfig} from './browser-native-equipment-market-read'
import {readEquipmentMarketOperationSnapshot,type EquipmentMarketReadRequest} from './equipment-market-operation-snapshot'
import type {EquipmentMarketOperationSnapshot} from './equipment-market-operation-types'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'

export interface OwnedEquipmentPage {
  owner:string;kind:'base'|'external';cursor:string|null;hasNextPage:boolean;
  rows:Array<{request:EquipmentMarketReadRequest;snapshot:EquipmentMarketOperationSnapshot}>;
  notAuthorization:true
}
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(`Wallet components: ${message}`)}

/** Wallet-wide discovery does not require a Soul or grant. Index rows supply IDs,
 * never custody authority. A failed page does not advance the caller's cursor. */
export async function readBrowserOwnedEquipmentPage(input:{owner:string;kind:'base'|'external';cursor?:string;signal?:AbortSignal},
  dependencies:{config?:()=>BrowserNativeEquipmentMarketConfig;client?:(signal:AbortSignal)=>SuiGrpcClient}={}):Promise<OwnedEquipmentPage>{
  const {signal:caller,...request}=input,{owner,kind,cursor}=structuredClone(request)
  receiveId(owner);check(kind==='base'||kind==='external','invalid instance kind')
  check(cursor===undefined||validEquipmentCursor(cursor),'invalid cursor')
  const config=structuredClone((dependencies.config??getBrowserNativeEquipmentMarketConfig)()),pin=config.target
  const target=readNativeReceiveTarget({NEXT_PUBLIC_SUI_NETWORK:'mainnet',NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:pin.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:pin.soulidityOriginalPackageId,NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON:JSON.stringify(pin)})
  check(target.equipmentMarket&&target.runtime,'exact market and Runtime release required')
  const signal=AbortSignal.any([AbortSignal.timeout(120000),...(caller?[caller]:[])]);signal.throwIfAborted()
  const client=boundedNativeMarketClient((dependencies.client??createNativeReceiveClient)(signal),signal),reads=new EquipmentReadSet(client,true)
  const {response}=await profileReadStep(signal,()=>client.ledgerService.getServiceInfo({}))
  check(response.chainId===MAINNET_GENESIS_DIGEST,'mainnet identity required')
  const authority=await profileReadStep(signal,()=>readNativeSourceAuthority(client,target)),type=authority.rt(kind==='base'?'OwnedBaseItemV8':'OwnedExternalItemV8')
  const page=await profileReadStep(signal,()=>client.core.listOwnedObjects({owner,type,limit:20,cursor}))
  check(page.objects.length<=20&&typeof page.hasNextPage==='boolean','invalid inventory page')
  check(!page.hasNextPage||typeof page.cursor==='string'&&validEquipmentCursor(page.cursor)&&page.cursor!==cursor,'nonadvancing inventory cursor')
  const seen=new Set<string>()
  for(const row of page.objects){const id=receiveId(row.objectId)
    check(!seen.has(id),'duplicate inventory instance');seen.add(id)
    check(normalizeStructTag(row.type)===normalizeStructTag(type)&&row.owner.$kind==='AddressOwner'&&row.owner.AddressOwner===owner,'index owner or type mismatch')}
  const rows:OwnedEquipmentPage['rows']=[];let position=0
  await Promise.all(Array.from({length:Math.min(4,page.objects.length)},async()=>{
    while(position<page.objects.length){
      signal.throwIfAborted();const index=position++,itemId=page.objects[index].objectId
      const bytes=await profileReadStep(signal,()=>reads.read(itemId,type,1,owner))
      const item=kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,bytes):decodeNativeBcs(EquipmentExternalItemBcs,bytes)
      check(item.id===itemId&&item.version==='8'&&item.holder===owner,'current instance identity mismatch')
      const rootId='root_id'in item?item.root_id:decodeNativeBcs(EquipmentExternalProductBcs,
        await profileReadStep(signal,()=>reads.read(item.product_id,authority.rt('ExternalItemProductV8'),3))).root_id
      receiveId(rootId)
      let equipmentScope:EquipmentMarketReadRequest['equipmentScope']
      if(item.equip_lock){
        const loadoutId=receiveId(item.equip_lock.loadout_id),keyType=authority.rt('SoulEquipmentKeyV8'),bindingType=authority.rt('SoulEquipmentBindingV8')
        const fieldId=deriveDynamicFieldID(loadoutId,keyType,EquipmentKeyBcs.serialize({dummy_field:false}).toBytes())
        const bindingBytes=await profileReadStep(signal,()=>reads.optional(fieldId,`0x2::dynamic_field::Field<${keyType},${bindingType}>`,2,loadoutId))
        // A plain Maker loadout is not a Soul binding. Keep it visible but locked.
        if(bindingBytes){const field=decodeNativeBcs(EquipmentBindingFieldBcs,bindingBytes),binding=field.value
          check(field.id===fieldId&&field.name.dummy_field===false&&binding.holder===owner&&binding.protocol_config_id===target.protocolConfigId,'equipment binding scope mismatch')
          const scope={soulId:receiveId(binding.soul_id),stateId:receiveId(binding.soul_state_id)}
          if(item.transferable)equipmentScope=scope
          else{
            // Display authentication is still required, but legitimate immutable
            // transfer restrictions are not a corrupt inventory page. Do not
            // construct a sale-removal plan for an instance that cannot sell.
            const bound=await profileReadStep(signal,()=>readNativeEquipment(client,target,scope,reads))
            check(bound.owner===owner&&bound.equipment?.loadout.id===loadoutId
              &&bound.equipment.instances.some(row=>row.kind===kind&&row.item.id===itemId),'nontransferable equipment binding mismatch')
          }
        }
      }
      const selected:EquipmentMarketReadRequest={actor:owner,rootId,itemId,kind,...(equipmentScope?{equipmentScope}:{})}
      // This proves product/root commitments, entitlement and the lock's reverse
      // Soul pointer/epoch/selection before offering its explicit removal scope.
      const snapshot=await profileReadStep(signal,()=>readEquipmentMarketOperationSnapshot(client,target,selected,signal,reads))
      rows[index]={request:selected,snapshot}
    }
  }))
  await profileReadStep(signal,()=>reads.verify());signal.throwIfAborted()
  return {owner,kind,rows,cursor:page.hasNextPage?page.cursor!:null,hasNextPage:page.hasNextPage,notAuthorization:true}
}
