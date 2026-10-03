import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {deriveDynamicFieldID,normalizeStructTag,toBase64} from '@mysten/sui/utils'
import type {MarketBuySnapshot} from './market-buy-types'
import {readNativeMarketSnapshot} from './native-market'
import {EquipmentReadSet} from './native-equipment'
import {NativeCancelKioskBcs,NativeCancelPersonalKioskCapBcs} from './native-market-cancel-snapshot'
import {attestNativeReceiveTarget,decodeNativeBcs,NativeReceiveError,receiveId,type NativeReceiveTarget} from './native-receive'

const KIOSK_FAMILY='0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
const USDC_FAMILY='0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7'
const USDC_TYPE=`${USDC_FAMILY}::usdc::USDC`
const A=bcs.Address,U=bcs.u64()
export const NativeBuyRegistryBcs=bcs.struct('KioskRegistry',{id:A,version:U})
export const NativeBuyOwnerKeyBcs=bcs.struct('PersonalKioskOwnerKey',{owner:A})
export const NativeBuyRegistrationBcs=bcs.struct('Field',{id:A,name:NativeBuyOwnerKeyBcs,
  value:bcs.struct('PersonalKioskRegistration',{version:U,kiosk_id:A,kiosk_cap_id:A})})
export const NativeBuyPolicyBcs=bcs.struct('TransferPolicy',{id:A,balance:U,
  rules:bcs.struct('VecSet',{contents:bcs.vector(bcs.struct('TypeName',{name:bcs.string()}))})})
export interface NativeMarketBuyTarget {
  marketConfigV2Id:string;kioskRegistryId:string;soulTransferPolicyId:string;kioskPackageId:string;paymentCoinType:string
}
function check(value:unknown,message:string):asserts value {
  if(!value)throw new NativeReceiveError('NATIVE_MARKET_BUY_INVALID',message)
}
export function readNativeMarketBuyTarget(target:NativeReceiveTarget,env:Record<string,string|undefined>=process.env):NativeMarketBuyTarget {
  try {
    check(env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID?.trim()===target.soulidityOriginalPackageId,'V2 package mismatch')
    const config={marketConfigV2Id:receiveId(env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID?.trim()),
      kioskRegistryId:receiveId(env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID?.trim()),
      soulTransferPolicyId:receiveId(env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID?.trim()),
      kioskPackageId:receiveId(env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim()),
      paymentCoinType:env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE?.trim()??''}
    check(config.paymentCoinType===USDC_TYPE,'Actual native USDC required')
    return config
  } catch {throw new NativeReceiveError('NATIVE_MARKET_BUY_TARGET_UNAVAILABLE','Exact native Market target unavailable',503)}
}

export async function attestNativeMarketLinkedTypes(client:SuiGrpcClient,pin:NativeReceiveTarget,config:NativeMarketBuyTarget) {
  const read=async(id:string)=>{
    const {response}=await client.ledgerService.getObject({objectId:id,readMask:{paths:['object_id','version','digest','owner','package']}})
    const object=response.object,pkg=object?.package
    check(object?.objectId===id && object.owner?.kind===4 && object.version!==undefined && object.version>0n
      && pkg?.storageId===id && pkg.version===object.version,'Package evidence mismatch')
    return {object,pkg}
  }
  const native=await read(pin.soulidityCallablePackageId)
  check(native.object.digest===pin.soulidityCallableDigest && native.pkg.originalId===pin.soulidityOriginalPackageId,'Native release mismatch')
  const dependency=async(family:string)=>{
    const edges=native.pkg.linkage.filter(row=>row.originalId===family)
    check(edges.length===1,'Exactly one native dependency required')
    const linked=await read(receiveId(edges[0].upgradedId))
    check(linked.pkg.originalId===family && linked.pkg.version===edges[0].upgradedVersion,'Native dependency linkage mismatch')
    return linked
  }
  const kiosk=await dependency(KIOSK_FAMILY),usdc=await dependency(USDC_FAMILY)
  check(kiosk.object.objectId===config.kioskPackageId,'Configured Kiosk differs from native linkage')
  const origin=(pkg:typeof native.pkg,module:string,name:string)=>{
    const rows=pkg.typeOrigins.filter(row=>row.moduleName===module && row.datatypeName===name)
    check(rows.length===1 && pkg.modules.some(row=>row.name===module && row.contents && row.contents.length>4),'Exact linked type origin required')
    return `${receiveId(rows[0].packageId)}::${module}::${name}`
  }
  check(origin(usdc.pkg,'usdc','USDC')===USDC_TYPE && config.paymentCoinType===USDC_TYPE,'USDC type differs from native payment')
  const market=(name:string)=>{
    const type=origin(native.pkg,'market',name)
    check(type===`${pin.soulidityOriginalPackageId}::market::${name}`,'Fresh market type origin mismatch')
    return type
  }
  market('MarketConfigV2');market('SoulListing')
  return {registry:market('KioskRegistry'),ownerKey:market('PersonalKioskOwnerKey'),registration:market('PersonalKioskRegistration'),
    cap:origin(kiosk.pkg,'personal_kiosk','PersonalKioskCap'),rules:[origin(kiosk.pkg,'kiosk_lock_rule','Rule'),
      origin(kiosk.pkg,'personal_kiosk_rule','Rule'),`${origin(kiosk.pkg,'witness_rule','Rule')}<${market('SoulMarketProof')}>`]}
}

/** Buyer is an unauthenticated public lookup subject, not signing authority.
 * All mutable market, policy, registry and chosen custody rows share one readset. */
export async function readNativeMarketBuySnapshot(client:SuiGrpcClient,target:NativeReceiveTarget,buyTarget:NativeMarketBuyTarget,
  input:{soulId:string;stateId:string;listingId?:string|null;buyer:string},signal?:AbortSignal):Promise<MarketBuySnapshot> {
  const pin=structuredClone(target),config=structuredClone(buyTarget),request=structuredClone(input)
  const buyer=receiveId(request.buyer)
  for(const value of [config.marketConfigV2Id,config.kioskRegistryId,config.soulTransferPolicyId,config.kioskPackageId])receiveId(value)
  signal?.throwIfAborted()
  const reads=new EquipmentReadSet(client)
  const types=await attestNativeReceiveTarget(client,pin,{market:true}),linked=await attestNativeMarketLinkedTypes(client,pin,config)
  const market=await readNativeMarketSnapshot(client,pin,{soulId:request.soulId,stateId:request.stateId,
    listingId:request.listingId,marketConfigId:config.marketConfigV2Id},signal,reads)
  if(!market.listing)throw new NativeReceiveError('NATIVE_MARKET_BUY_LISTING_UNAVAILABLE','No active native listing',409)
  const registry=decodeNativeBcs(NativeBuyRegistryBcs,await reads.read(config.kioskRegistryId,linked.registry,3))
  check(registry.id===config.kioskRegistryId && registry.version==='1','Kiosk registry mismatch')
  const policy=decodeNativeBcs(NativeBuyPolicyBcs,await reads.read(config.soulTransferPolicyId,
    `0x2::transfer_policy::TransferPolicy<${types.soulType}>`,3))
  const rules=policy.rules.contents.map((row:{name:string})=>normalizeStructTag(row.name.startsWith('0x')?row.name:`0x${row.name}`))
  check(policy.id===config.soulTransferPolicyId && rules.length===3 && new Set(rules).size===3
    && linked.rules.every(rule=>rules.includes(normalizeStructTag(rule))),'Soul policy must contain exactly the three native rules')
  const sellerKiosk=decodeNativeBcs(NativeCancelKioskBcs,await reads.read(market.kioskId,'0x2::kiosk::Kiosk',3))
  check(sellerKiosk.id===market.kioskId && sellerKiosk.owner===market.owner,'Seller Kiosk mismatch')
  const registrationId=deriveDynamicFieldID(config.kioskRegistryId,linked.ownerKey,NativeBuyOwnerKeyBcs.serialize({owner:buyer}).toBytes())
  const registrationType=`0x2::dynamic_field::Field<${linked.ownerKey},${linked.registration}>`
  const bytes=await reads.optional(registrationId,registrationType,2,config.kioskRegistryId)
  const verifyCap=async(capId:string,kioskHint?:string)=>{
    const cap=decodeNativeBcs(NativeCancelPersonalKioskCapBcs,await reads.read(receiveId(capId),linked.cap,1,buyer))
    check(cap.id===capId && cap.cap && (!kioskHint || cap.cap.for===kioskHint),'Buyer PersonalKioskCap mismatch')
    receiveId(cap.cap.id)
    const kioskId=receiveId(cap.cap.for)
    const kiosk=decodeNativeBcs(NativeCancelKioskBcs,await reads.read(kioskId,'0x2::kiosk::Kiosk',3))
    check(kiosk.id===kioskId && kiosk.owner===buyer,'Buyer Kiosk mismatch')
    return {capId,kioskId}
  }
  let selected:{capId:string;kioskId:string}|null=null
  if(bytes!==null) {
    const row=decodeNativeBcs(NativeBuyRegistrationBcs,bytes)
    check(row.id===registrationId && row.name.owner===buyer && row.value.version==='1','Personal Kiosk registration mismatch')
    selected=await verifyCap(receiveId(row.value.kiosk_cap_id),receiveId(row.value.kiosk_id))
  } else {
    // Exhaust exact typed pages before choosing deterministically. RPC errors,
    // repeated cursors and partial scans must never mean "create a new Kiosk".
    let cursor:Uint8Array|undefined
    const seenCursors=new Set<string>(),candidateIds=new Set<string>()
    for(let page=0;;page++) {
      signal?.throwIfAborted()
      check(page<100,'Owned-cap scan exceeds bounded pages')
      const {response}=await client.stateService.listOwnedObjects({owner:buyer,objectType:linked.cap,pageSize:50,pageToken:cursor,
        readMask:{paths:['object_id','owner','object_type']}})
      check(Array.isArray(response.objects),'Owned-cap response missing')
      for(const row of response.objects) {
        const capId=receiveId(row.objectId)
        check(!candidateIds.has(capId) && row.owner?.kind===1 && row.owner.address===buyer
          && row.objectType && normalizeStructTag(row.objectType)===normalizeStructTag(linked.cap),'Owned-cap scan identity mismatch')
        candidateIds.add(capId)
      }
      cursor=response.nextPageToken
      if(!cursor?.length)break
      const key=toBase64(cursor)
      check(!seenCursors.has(key),'Repeated owned-cap cursor');seenCursors.add(key)
    }
    const sorted=[...candidateIds].sort()
    for(let offset=0;offset<sorted.length;offset+=16) {
      const batch=await Promise.allSettled(sorted.slice(offset,offset+16).map(capId=>verifyCap(capId)))
      for(const result of batch) {
        if(result.status==='rejected')throw result.reason
        if(!selected)selected=result.value
      }
    }
  }
  // Registry version records both existing registration changes and absence
  // becoming a registration while later custody/policy evidence is fetched.
  await reads.verify();signal?.throwIfAborted()
  return {schema:'native-market-buy-v1',soulId:market.soulId,stateId:market.stateId,bindingId:market.bindingId,
    seller:market.owner,sellerKioskId:market.kioskId,ownershipEpoch:market.ownershipEpoch,listingId:market.listing.id,
    priceAtomic:market.listing.priceAtomic,creator:market.creator,makerCreator:market.makerCreator,
    soulCreatorRoyaltyBps:market.soulCreatorRoyaltyBps,makerSourceRoyaltyBps:market.makerSourceRoyaltyBps,
    protocolFeeRecipient:market.protocolFeeRecipient,buyer,buyerKioskId:selected?.kioskId??null,buyerKioskCapId:selected?.capId??null,
    purchaseAvailable:market.purchaseAvailable && buyer!==market.owner,
    release:{network:'mainnet',protocolConfigId:pin.protocolConfigId,soulidityOriginalPackageId:pin.soulidityOriginalPackageId,
      soulidityCallablePackageId:pin.soulidityCallablePackageId,soulidityCallableDigest:pin.soulidityCallableDigest,
      ...config,writesEnabled:pin.marketWritesEnabled===true}}
}
