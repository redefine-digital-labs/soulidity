import {Transaction} from '@mysten/sui/transactions'
import {fromBase64,fromHex,toHex,normalizeStructTag} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {appendListAnimacraftEquipmentV8,appendAnimacraftEquipmentV8RemovalPlan,
  buildBuyAnimacraftEquipmentV8Tx,buildRepriceAnimacraftEquipmentV8Tx,
  buildCancelAnimacraftEquipmentV8Tx,buildRecoverAnimacraftEquipmentV8Tx} from '@soulidity/sdk'
import {marketListCheck as check,marketListId as id,marketListUint64 as uint,
  marketListDigest as digest} from './market-list-operation'
import {readNativeReceiveTarget} from './native-receive'
import {validateListingTransactionBytes} from './listing-transaction-validation'
import {validateMarketCancelCheckpoint} from './market-cancel-checkpoint'
import {EquipmentMarketQuoteCommitmentBcs} from './native-equipment-market-bcs'
import type {EquipmentMarketOperationSnapshot,EquipmentMarketOperationRecord} from './equipment-market-operation-types'
export type {EquipmentMarketOperationSnapshot,EquipmentMarketOperationRecord,EquipmentMarketAction} from './equipment-market-operation-types'

const positive=(v:unknown)=>uint(v)&&BigInt(v as string)>0n
const price=(v:unknown)=>uint(v)&&BigInt(v as string)>=40n
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)
function exact(v:unknown,keys:string[]):asserts v is Record<string,unknown>{
  check(v!==null&&typeof v==='object'&&!Array.isArray(v)
    &&Object.keys(v).sort().join(',')===[...keys].sort().join(','),'Invalid equipment operation fields')
}
export const equipmentMarketOperationKey=(itemId:string,actor:string)=>{
  check(id(itemId)&&id(actor),'Invalid equipment operation scope')
  return `soulidity.equipment-market-operation:mainnet:${itemId}:${actor}`
}
export const terminalEquipmentMarketOperation=(r:EquipmentMarketOperationRecord)=>['SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)

/** Validates a saved projection without consulting today's chain or switches.
 * Live provenance belongs to read/preflight; saved evidence must remain queryable. */
export function validateEquipmentMarketSnapshot(value:unknown):EquipmentMarketOperationSnapshot{
  const s=structuredClone(value) as EquipmentMarketOperationSnapshot
  exact(s,['schema','actor','seller','ownershipEpoch','asset','reference','assetCommitment','quoteContext','target','release',
    'protocolTreasuryId','listing','lock','removal','available'])
  check(s.schema==='equipment-market-operation-v1'&&id(s.actor)&&id(s.seller)&&uint(s.ownershipEpoch)
    &&hash(s.assetCommitment),'Invalid equipment operation identity')
  exact(s.quoteContext,['makerVersion','rootContentCommitment','economicsCommitment','rightsCommitment'])
  check(uint(s.quoteContext.makerVersion)&&hash(s.quoteContext.rootContentCommitment)
    &&hash(s.quoteContext.economicsCommitment)&&hash(s.quoteContext.rightsCommitment),'Invalid equipment quote authority')
  const release=s.release
  s.release=readNativeReceiveTarget({NEXT_PUBLIC_SUI_NETWORK:'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID:release?.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID:release?.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON:JSON.stringify(release)})
  check(s.release.runtime&&s.release.equipmentMarket,'Equipment Market release pin required')
  const t=s.target,p=s.release.equipmentMarket
  exact(t,['marketCallablePackageId','paymentCoinType','registryId','treasuryId','rootId','protocolConfigId','catalogId','replacementId','packageConfigId'])
  check(t.marketCallablePackageId===p.callablePackageId&&t.replacementId===p.replacementId
    &&t.protocolConfigId===s.release.protocolConfigId&&typeof t.paymentCoinType==='string'
    &&t.paymentCoinType.includes('::')&&normalizeStructTag(t.paymentCoinType)===t.paymentCoinType,'Equipment target differs from release')
  const a=s.asset
  check(a?.kind==='base'||a?.kind==='external','Select only Base or External instances')
  exact(a,a.kind==='base'?['kind','itemId','packRegistryId','definitionRegistryId','baseRegistryId']:['kind','itemId','productId'])
  exact(s.reference,['objectId','version','digest'])
  check(s.reference.objectId===a.itemId&&positive(s.reference.version)&&digest(s.reference.digest),'Exact equipment reference required')
  check(s.protocolTreasuryId===null||id(s.protocolTreasuryId),'Invalid protocol treasury')
  const objects=[t.registryId,t.treasuryId,t.rootId,t.protocolConfigId,t.catalogId,t.replacementId,t.packageConfigId,a.itemId,
    ...(a.kind==='base'?[a.packRegistryId,a.definitionRegistryId,a.baseRegistryId]:[a.productId]),
    ...(s.protocolTreasuryId?[s.protocolTreasuryId]:[])]
  if(s.listing!==null){
    exact(s.listing,['id','revision','priceAtomic','quoteCommitment'])
    check(uint(s.listing.revision)&&BigInt(s.listing.revision)<18446744073709551615n
      &&price(s.listing.priceAtomic)&&hash(s.listing.quoteCommitment),'Invalid equipment listing quote/revision')
    objects.push(s.listing.id)
    check(s.listing.quoteCommitment===equipmentOperationQuote(s,s.listing.priceAtomic).commitment,'Equipment quote commitment changed')
    check(s.lock===null&&s.removal===null,'Listed equipment cannot be equipped')
  }else check(s.actor===s.seller,'Only the holder may list equipment')
  const packages=[release.coreOriginalPackageId,release.outputOriginalPackageId,release.outputCallablePackageId,
    release.soulidityOriginalPackageId,release.soulidityCallablePackageId,s.release.runtime.originalPackageId,
    s.release.runtime.callablePackageId,p.originalPackageId,p.callablePackageId,
    ...(release.release?[release.release.originalPackageId,release.release.callablePackageId]:[])]
  check(objects.every(id)&&new Set(objects).size===objects.length&&objects.every(v=>!packages.includes(v)),'Equipment object roles overlap')
  exact(s.available,['list','buy','reprice','cancel','recover'])
  check(Object.values(s.available).every(v=>typeof v==='boolean')
    &&(!s.available.list||s.listing===null)
    &&(!s.available.buy||s.listing!==null&&s.actor!==s.seller&&s.protocolTreasuryId!==null)
    &&(!s.available.reprice||s.listing!==null&&s.actor===s.seller)
    &&(!s.available.cancel||s.listing!==null&&s.actor===s.seller)
    &&(!s.available.recover||s.listing!==null),'Invalid equipment availability')
  if(s.lock!==null){
    exact(s.lock,['equipmentId','revision','selectionIndex'])
    check(id(s.lock.equipmentId)&&positive(s.lock.revision)&&uint(s.lock.selectionIndex)
      &&BigInt(s.lock.selectionIndex)<500n&&s.listing===null,'Invalid equipment lock')
  }
  if(s.removal!==null){
    const r=s.removal,e=r.equipment
    exact(r,['soulId','stateId','sellSoul','selectedItems','equipment'])
    check(s.lock&&r.sellSoul===false&&id(r.soulId)&&id(r.stateId)&&r.soulId!==r.stateId
      &&Array.isArray(r.selectedItems)&&r.selectedItems.length===1&&e,'Exact partial equipment removal required')
    const selected=r.selectedItems[0]
    exact(selected,['kind','itemId','ownershipEpoch','selectionIndex'])
    check(selected.kind===a.kind&&selected.itemId===a.itemId&&selected.ownershipEpoch===s.ownershipEpoch
      &&selected.selectionIndex===s.lock.selectionIndex,'Selected equipment differs from lock')
    exact(e,['closeBinding','plan','finalRevision','finalSelectionCount','finalCommitment','retainedSelectionIndexes'])
    check(e.closeBinding===false&&uint(e.finalRevision)&&uint(e.finalSelectionCount)&&hash(e.finalCommitment)
      &&Array.isArray(e.retainedSelectionIndexes)&&e.retainedSelectionIndexes.every(v=>uint(v)&&BigInt(v)<500n)
      &&new Set(e.retainedSelectionIndexes).size===e.retainedSelectionIndexes.length
      &&!e.retainedSelectionIndexes.includes(selected.selectionIndex)
      &&String(e.retainedSelectionIndexes.length)===e.finalSelectionCount,'Partial removal must preserve unchecked equipment')
    const plan=e.plan
    exact(plan,['scope','definitionRegistryId','baseRegistryId','removals','packs'])
    exact(plan.scope,['target','soulStateId','equipmentId','expectedRevision'])
    exact(plan.scope.target,['soulidityCallablePackageId','runtimeOriginalPackageId','protocolConfigId'])
    check(plan.scope.soulStateId===r.stateId&&plan.scope.equipmentId===s.lock.equipmentId
      &&plan.scope.target.soulidityCallablePackageId===release.soulidityCallablePackageId
      &&plan.scope.target.runtimeOriginalPackageId===s.release.runtime.originalPackageId
      &&plan.scope.target.protocolConfigId===release.protocolConfigId&&uint(plan.scope.expectedRevision)
      &&BigInt(plan.scope.expectedRevision)>=BigInt(s.lock.revision)
      &&BigInt(e.finalRevision)===BigInt(plan.scope.expectedRevision)+1n
      &&Array.isArray(plan.removals)&&plan.removals.length===1&&plan.removals[0].kind===a.kind
      &&'itemId'in plan.removals[0]&&plan.removals[0].itemId===a.itemId,'Partial removal scope changed')
    check(Array.isArray(plan.packs)&&plan.packs.length<=500,'Invalid partial removal Pack set')
    for(const [index,pack] of plan.packs.entries()){
      exact(pack,['runtimeCallablePackageId','paymentCoinType','releaseId','bindingIndex'])
      check(pack.runtimeCallablePackageId===s.release.runtime.callablePackageId&&pack.bindingIndex===String(index),
        'Partial removal Pack release mismatch')
    }
    const extras=[r.soulId,r.stateId,plan.scope.equipmentId,...plan.packs.map(v=>v.releaseId)]
    check(extras.every(id)&&new Set(extras).size===extras.length&&extras.every(v=>!objects.includes(v)&&!packages.includes(v)),
      'Partial removal objects overlap')
    for(const [registry,expected] of [[plan.definitionRegistryId,a.kind==='base'?a.definitionRegistryId:null],
      [plan.baseRegistryId,a.kind==='base'?a.baseRegistryId:null]] as const){
      check(id(registry)&&!packages.includes(registry)&&!extras.includes(registry)
        &&(expected?registry===expected:!objects.includes(registry)),'Partial removal registry mismatch')
    }
    check(plan.definitionRegistryId!==plan.baseRegistryId,'Partial removal registries overlap')
    appendAnimacraftEquipmentV8RemovalPlan(new Transaction(),plan)
  }
  check(!s.available.list||s.lock===null||s.removal!==null,'Locked equipment requires verified partial removal')
  check(s.lock!==null||s.removal===null,'Unexpected equipment removal')
  return s
}

export function equipmentOperationQuote(s:EquipmentMarketOperationSnapshot,priceAtomic:string){
  check(price(priceAtomic),'Equipment price requires a nonzero 2.5% fee')
  const gross=BigInt(priceAtomic),protocol=gross*250n/10000n,seller=gross-protocol,c=s.quoteContext
  const commitment=toHex(sha256(EquipmentMarketQuoteCommitmentBcs.serialize({
    domain:[...new TextEncoder().encode('animacraft-v8/market/quote')],version:'8',quote_kind:3,
    root_id:s.target.rootId,maker_version:c.makerVersion,root_content_commitment:[...fromHex(c.rootContentCommitment)],
    economics_commitment:[...fromHex(c.economicsCommitment)],rights_commitment:[...fromHex(c.rightsCommitment)],
    gross_atomic:priceAtomic,protocol_atomic:String(protocol),creator_atomic:'0',source_atomic:'0',seller_atomic:String(seller),
  }).toBytes()))
  return {grossAtomic:priceAtomic,protocolAtomic:String(protocol),sellerAtomic:String(seller),creatorAtomic:'0',sourceAtomic:'0',commitment}
}

export function buildEquipmentMarketOperationTransaction(r:Pick<EquipmentMarketOperationRecord,'action'|'snapshot'|'priceAtomic'|'paymentCoins'>){
  const s=r.snapshot,t=s.target,a=s.asset
  if(r.action==='list'){
    check(s.listing===null&&(s.lock===null||s.removal?.equipment),'Exact equipment removal required')
    const tx=new Transaction()
    if(s.removal?.equipment)appendAnimacraftEquipmentV8RemovalPlan(tx,s.removal.equipment.plan)
    appendListAnimacraftEquipmentV8(tx,{target:t,asset:a,priceAtomic:BigInt(r.priceAtomic)});return tx
  }
  check(s.listing,'Equipment listing required')
  if(r.action==='reprice')return buildRepriceAnimacraftEquipmentV8Tx({target:t,listingId:s.listing.id,
    expectedRevision:s.listing.revision,priceAtomic:BigInt(r.priceAtomic)})
  const input={target:t,listingId:s.listing.id,expectedRevision:s.listing.revision,receiving:s.reference,
    ...(a.kind==='base'?{kind:a.kind,packRegistryId:a.packRegistryId,definitionRegistryId:a.definitionRegistryId}:{kind:a.kind})}
  if(r.action==='buy'){
    check(s.protocolTreasuryId,'Equipment purchase treasury required')
    return buildBuyAnimacraftEquipmentV8Tx({...input,protocolTreasuryId:s.protocolTreasuryId,
      priceAtomic:BigInt(r.priceAtomic),paymentCoinObjectIds:r.paymentCoins.map(c=>c.objectId)})
  }
  check(r.action==='cancel'||r.action==='recover','Invalid equipment action')
  return (r.action==='cancel'?buildCancelAnimacraftEquipmentV8Tx:buildRecoverAnimacraftEquipmentV8Tx)(input)
}

/** Exact ABI mutability is derived from the current Move entry points, never
 * inferred from naming or RPC ownership. Replacement is an immutable input. */
export function equipmentMarketInputRoles(r:Pick<EquipmentMarketOperationRecord,'action'|'snapshot'|'paymentCoins'>){
  const s=r.snapshot,t=s.target
  const owned=new Set([t.replacementId,...r.paymentCoins.map(c=>c.objectId)]),mutable=new Set([t.registryId])
  if(s.listing)mutable.add(s.listing.id)
  if(r.action==='list')owned.add(s.asset.itemId)
  if(r.action==='buy'){
    mutable.add(t.treasuryId);mutable.add(s.protocolTreasuryId!)
    if(s.asset.kind==='base')mutable.add(s.asset.packRegistryId)
  }
  // Partial removal borrows SoulState immutably; only Soul sale closes the
  // binding and needs &mut SoulState. Do not reuse that different graph's roles.
  if(s.removal?.equipment)mutable.add(s.removal.equipment.plan.scope.equipmentId)
  return {owned,mutable}
}
export function equipmentMarketReservedAssets(s:EquipmentMarketOperationSnapshot){
  return [s.asset.itemId,...(s.removal?[s.removal.soulId,s.removal.stateId,s.removal.equipment!.plan.scope.equipmentId]:[])]
}
export function validateEquipmentMarketOperationRecord(value:unknown):EquipmentMarketOperationRecord{
  const r=structuredClone(value) as EquipmentMarketOperationRecord
  check(r&&r.schema===1&&r.kind==='equipment-market'&&['list','buy','reprice','cancel','recover'].includes(r.action),
    'Invalid equipment operation')
  const s=validateEquipmentMarketSnapshot(r.snapshot);r.snapshot=s
  check(price(r.priceAtomic)&&(r.action==='list'?s.listing===null&&s.actor===s.seller&&(s.lock===null||s.removal!==null):s.listing!==null)
    &&(!['reprice','cancel'].includes(r.action)||s.actor===s.seller)
    &&(r.action!=='buy'||s.actor!==s.seller&&s.protocolTreasuryId!==null&&BigInt(s.ownershipEpoch)<18446744073709551615n)
    &&(!['buy','cancel','recover'].includes(r.action)||r.priceAtomic===s.listing!.priceAtomic),'Equipment intent differs from frozen quote')
  check(uint(r.expirationEpoch)&&['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(r.phase)
    &&(r.signature===null||typeof r.signature==='string'&&r.signature.length>0&&r.signature.length<32768)
    &&(r.phase!=='SIGNED'||r.signature!==null)
    &&(r.phase==='SUCCEEDED'?['PENDING','COMPLETE','SUPERSEDED'].includes(r.syncStatus as string):r.syncStatus===undefined)
    &&(!['PREPARED','SIGNING','CANCELLED'].includes(r.phase)||r.signature===null),'Invalid equipment journal phase')
  check(r.phase!=='RETIRED'||r.retirement,'Retired equipment evidence missing')
  if(r.retirement!==undefined){
    check(['RETIRED','SUCCEEDED','FAILED'].includes(r.phase)&&['SIGNING','SIGNED'].includes(r.retirement?.priorPhase)
      &&(r.retirement.priorPhase==='SIGNED'?r.signature!==null:r.signature===null),'Invalid equipment retirement')
    r.retirement.checkpoint=validateMarketCancelCheckpoint(r.retirement.checkpoint,r.expirationEpoch)
  }
  const forbidden=new Set<string>([...Object.values(s.target).filter(id),s.asset.itemId,
    ...(s.asset.kind==='base'?[s.asset.packRegistryId,s.asset.definitionRegistryId,s.asset.baseRegistryId]:[s.asset.productId]),
    ...(s.protocolTreasuryId?[s.protocolTreasuryId]:[]),...(s.listing?[s.listing.id]:[]),
    ...equipmentMarketReservedAssets(s),...(s.removal?.equipment?[s.removal.equipment.plan.definitionRegistryId,s.removal.equipment.plan.baseRegistryId,
      ...s.removal.equipment.plan.packs.map(p=>p.releaseId)]:[])])
  for(const v of [s.release.coreOriginalPackageId,s.release.outputOriginalPackageId,s.release.outputCallablePackageId,
    s.release.soulidityOriginalPackageId,s.release.soulidityCallablePackageId,s.release.runtime!.originalPackageId,
    s.release.runtime!.callablePackageId,s.release.equipmentMarket!.originalPackageId,
    ...(s.release.release?[s.release.release.originalPackageId,s.release.release.callablePackageId]:[])])forbidden.add(v)
  check(Array.isArray(r.paymentCoins)&&(r.action==='buy'?r.paymentCoins.length>0&&r.paymentCoins.length<=32:r.paymentCoins.length===0),
    'Equipment payment selection required only for purchase')
  for(const coin of r.paymentCoins){exact(coin,['objectId','version','digest','balanceAtomic'])
    check(id(coin.objectId)&&positive(coin.version)&&digest(coin.digest)&&positive(coin.balanceAtomic)
      &&!forbidden.has(coin.objectId),'Invalid exact equipment payment coin');forbidden.add(coin.objectId)}
  if(r.action==='buy'){
    const balance=r.paymentCoins.reduce((sum,c)=>sum+BigInt(c.balanceAtomic),0n)
    check(balance>=BigInt(r.priceAtomic)&&balance<=18446744073709551615n,'Equipment payment balance outside exact bounds')
  }
  const expected=buildEquipmentMarketOperationTransaction(r),roles=equipmentMarketInputRoles(r)
  validateListingTransactionBytes(r,{owner:s.actor,expected,...roles,forbidden})
  // Unlike a mutable shared object's initial version, selected owned/payment
  // versions and digests must be exactly those authenticated before preparation.
  const inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs
  for(const ref of [...r.paymentCoins,...(r.action==='list'?[s.reference]:[])]){
    const actual=inputs.find(i=>i.Object?.ImmOrOwnedObject?.objectId===ref.objectId)?.Object?.ImmOrOwnedObject
    check(actual?.version===ref.version&&actual.digest===ref.digest,'Equipment owned reference changed')
  }
  return r
}
