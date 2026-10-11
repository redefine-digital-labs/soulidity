import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {deriveDynamicFieldID,normalizeStructTag,toBase64} from '@mysten/sui/utils'
import type {NativeMarketListSnapshot} from './market-list-types'
import {EquipmentReadSet,readNativeEquipment} from './native-equipment'
import {selectedSoulEquipmentPlan} from './native-selected-soul-sale'
import {buildSelectedAnimacraftSoulSaleV8Tx} from '@soulidity/sdk'
import {readNativeMarketSnapshot} from './native-market'
import {attestNativeMarketLinkedTypes,NativeBuyOwnerKeyBcs,NativeBuyPolicyBcs,NativeBuyRegistrationBcs,
  NativeBuyRegistryBcs,type NativeMarketBuyTarget} from './native-market-buy-snapshot'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs} from './native-market-cancel-snapshot'
import {attestNativeReceiveTarget,decodeNativeBcs,NativeReceiveError,receiveId,type NativeReceiveTarget} from './native-receive'

function check(value:unknown,message:string):asserts value {
  if(!value)throw new NativeReceiveError('NATIVE_MARKET_LIST_INVALID',message)
}

/** One mutable readset covers LIST and atomic CANCEL→LIST preparation. No new
 * seller Kiosk is possible: the cap must control the current Soul's Kiosk. */
export async function readNativeMarketListSnapshot(client:SuiGrpcClient,target:NativeReceiveTarget,marketTarget:NativeMarketBuyTarget,
  input:{soulId:string;stateId:string;listingId?:string|null;kioskCapId?:string|null},signal?:AbortSignal,readSet?:EquipmentReadSet):Promise<NativeMarketListSnapshot> {
  const pin=structuredClone(target),config=structuredClone(marketTarget),request=structuredClone(input)
  for(const value of [config.marketConfigV2Id,config.kioskRegistryId,config.soulTransferPolicyId,config.kioskPackageId])receiveId(value)
  if(request.kioskCapId!=null)receiveId(request.kioskCapId)
  signal?.throwIfAborted()
  const reads=readSet??new EquipmentReadSet(client)
  const types=await attestNativeReceiveTarget(client,pin,{market:true}),linked=await attestNativeMarketLinkedTypes(client,pin,config)
  const market=await readNativeMarketSnapshot(client,pin,{soulId:request.soulId,stateId:request.stateId,
    listingId:request.listingId,marketConfigId:config.marketConfigV2Id},signal,reads)
  const equipmentId=await reads.pointer(market.stateId)
  const registry=decodeNativeBcs(NativeBuyRegistryBcs,await reads.read(config.kioskRegistryId,linked.registry,3))
  check(registry.id===config.kioskRegistryId && registry.version==='1','Kiosk registry mismatch')
  // Whole-release trading readiness, not an additional rule in the LIST ABI.
  // Cancellation receipt recovery deliberately does not consult this policy.
  const policy=decodeNativeBcs(NativeBuyPolicyBcs,await reads.read(config.soulTransferPolicyId,
    `0x2::transfer_policy::TransferPolicy<${types.soulType}>`,3))
  const rules=policy.rules.contents.map((row:{name:string})=>normalizeStructTag(row.name.startsWith('0x')?row.name:`0x${row.name}`))
  check(policy.id===config.soulTransferPolicyId && rules.length===3 && new Set(rules).size===3
    && linked.rules.every(rule=>rules.includes(normalizeStructTag(rule))),'Soul policy must contain exactly the three native rules')
  const kiosk=decodeNativeBcs(NativeCancelKioskBcs,await reads.read(market.kioskId,'0x2::kiosk::Kiosk',3))
  check(kiosk.id===market.kioskId && kiosk.owner===market.owner,'Current Kiosk mismatch')
  const registrationId=deriveDynamicFieldID(config.kioskRegistryId,linked.ownerKey,NativeBuyOwnerKeyBcs.serialize({owner:market.owner}).toBytes())
  const registration=await reads.optional(registrationId,`0x2::dynamic_field::Field<${linked.ownerKey},${linked.registration}>`,2,config.kioskRegistryId)
  const readCap=async(capId:string)=>{
    const cap=decodeNativeBcs(NativeCancelPersonalKioskCapBcs,await reads.read(receiveId(capId),linked.cap,1,market.owner))
    check(cap.id===capId && cap.cap,'Current PersonalKioskCap mismatch')
    receiveId(cap.cap.id);receiveId(cap.cap.for)
    return cap.cap.for===market.kioskId
  }
  let kioskCapId:string|undefined
  if(registration!==null) {
    const row=decodeNativeBcs(NativeBuyRegistrationBcs,registration)
    check(row.id===registrationId && row.name.owner===market.owner && row.value.version==='1'
      && row.value.kiosk_id===market.kioskId,'Current Kiosk registration mismatch')
    kioskCapId=receiveId(row.value.kiosk_cap_id)
    check(!request.kioskCapId || request.kioskCapId===kioskCapId,'Cap hint differs from current registration')
    check(await readCap(kioskCapId),'Registered cap controls another Kiosk')
  } else if(request.kioskCapId) {
    check(await readCap(request.kioskCapId),'Cap hint controls another Kiosk')
    kioskCapId=request.kioskCapId
  } else {
    let cursor:Uint8Array|undefined
    const seenCursors=new Set<string>(),candidates=new Set<string>()
    for(let page=0;;page++) {
      signal?.throwIfAborted();check(page<100,'Owned-cap scan exceeds bounded pages')
      const {response}=await client.stateService.listOwnedObjects({owner:market.owner,objectType:linked.cap,pageSize:50,pageToken:cursor,
        readMask:{paths:['object_id','owner','object_type']}})
      check(Array.isArray(response.objects) && response.objects.length<=50,'Owned-cap response exceeds requested page size')
      for(const row of response.objects) {
        const capId=receiveId(row.objectId)
        check(!candidates.has(capId) && row.owner?.kind===1 && row.owner.address===market.owner
          && row.objectType && normalizeStructTag(row.objectType)===normalizeStructTag(linked.cap),'Owned-cap scan identity mismatch')
        candidates.add(capId)
      }
      cursor=response.nextPageToken
      check(cursor===undefined || (cursor instanceof Uint8Array && cursor.length<=4096),'Owned-cap cursor exceeds bounded size')
      // gRPC uses either an absent token or empty bytes to mark the final page.
      if(!cursor?.length)break
      const key=toBase64(cursor);check(!seenCursors.has(key),'Repeated owned-cap cursor');seenCursors.add(key)
    }
    const sorted=[...candidates].sort()
    for(let offset=0;offset<sorted.length;offset+=16) {
      const ids=sorted.slice(offset,offset+16),batch=await Promise.allSettled(ids.map(readCap))
      for(let index=0;index<batch.length;index++) {
        const result=batch[index]
        if(result.status==='rejected')throw result.reason
        if(result.value && !kioskCapId)kioskCapId=ids[index]
      }
    }
  }
  check(kioskCapId,'No owner cap for the current Soul Kiosk')
  let equipmentSale:NativeMarketListSnapshot['equipmentSale']
  if(equipmentId!==null) {
    signal?.throwIfAborted()
    const equipment=await readNativeEquipment(client,pin,{soulId:market.soulId,stateId:market.stateId,update:true},reads)
    signal?.throwIfAborted()
    check(market.listing===null && !equipment.listed && market.soulId===equipment.soulId && market.stateId===equipment.stateId
      && market.owner===equipment.owner && market.ownershipEpoch===equipment.ownershipEpoch
      && market.bindingId===equipment.provenanceBindingId && equipmentId===equipment.equipment?.loadout.id,
    'Selected Soul custody/equipment changed')
    const plan=selectedSoulEquipmentPlan(equipment)
    check(plan,'Complete selected Soul equipment plan required')
    // Structural validation only: the user's actual price is frozen by the journal.
    buildSelectedAnimacraftSoulSaleV8Tx([{target:{...config,soulidityCallablePackageId:pin.soulidityCallablePackageId},
      soulStateId:market.stateId,provenanceBindingId:market.bindingId,currentKioskId:market.kioskId,
      currentKioskCapOnChainId:kioskCapId,priceAtomic:1n,equipment:plan}])
    equipmentSale={...plan,runtimeCallableDigest:equipment.release.runtimeCallableDigest,
      writesEnabled:equipment.release.writesEnabled===true}
  }
  await reads.verify();signal?.throwIfAborted()
  const ready=market.secondaryEnabled && market.nativeFeePolicyValid
  return {schema:'native-market-list-v1',soulId:market.soulId,stateId:market.stateId,bindingId:market.bindingId,
    owner:market.owner,kioskId:market.kioskId,kioskCapId,ownershipEpoch:market.ownershipEpoch,
    creator:market.creator,makerCreator:market.makerCreator,soulCreatorRoyaltyBps:market.soulCreatorRoyaltyBps,
    makerSourceRoyaltyBps:market.makerSourceRoyaltyBps,protocolFeeRecipient:market.protocolFeeRecipient,
    listed:market.listing!==null,listingId:market.listing?.id??null,priceAtomic:market.listing?.priceAtomic??null,equipmentId,
    ...(equipmentSale?{equipmentSale}:{}),
    listAvailable:ready && market.listing===null,repriceAvailable:ready && market.listing!==null && equipmentId===null,
    release:{network:'mainnet',protocolConfigId:pin.protocolConfigId,soulidityOriginalPackageId:pin.soulidityOriginalPackageId,
      soulidityCallablePackageId:pin.soulidityCallablePackageId,soulidityCallableDigest:pin.soulidityCallableDigest,
      ...config,writesEnabled:pin.marketWritesEnabled===true}}
}
