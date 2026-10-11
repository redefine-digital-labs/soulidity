import {buildSelectedAnimacraftSoulSaleV8Tx} from '@soulidity/sdk'
import {marketListCheck as check,marketListUint64,marketListId,marketListCanonical as canonical,validateMarketListSnapshot} from './market-list-operation'
import {MAX_MARKET_BATCH_LIST_ROWS,type SoulMarketBatchListSnapshot,type SoulMarketBatchListRow} from './market-batch-list-types'
const positive=(v:unknown)=>marketListUint64(v)&&BigInt(v as string)>0n
const exact=(v:unknown,keys:string[])=>check(v!==null&&typeof v==='object'&&!Array.isArray(v)
  &&Object.keys(v).sort().join(',')===keys.sort().join(','),'Invalid selected sale fields')

/** Exact ordered rows, not inventory. Shared infrastructure may repeat only in
 * its same role; no selected asset/instance can alias another row's resources. */
export function validateSoulMarketBatchListSnapshot(value:unknown):SoulMarketBatchListSnapshot{
  const result=structuredClone(value) as SoulMarketBatchListSnapshot
  exact(result,['schema','owner','rows'])
  check(result.schema==='native-market-batch-list-v1'&&marketListId(result.owner)&&Array.isArray(result.rows)
    &&result.rows.length>0&&result.rows.length<=MAX_MARKET_BATCH_LIST_ROWS,'Invalid batch listing scope')
  const roles=new Map<string,string>(),packages=new Set<string>(),caps=new Map<string,string>()
  const claim=(id:string,role:string,shared=false)=>{
    check(!roles.has(id)||shared&&roles.get(id)===role,'Selected sale object roles overlap');roles.set(id,role)
  }
  let release:string|undefined,runtime:string|undefined,runtimeCallable:string|undefined
  for(const row of result.rows){
    exact(row,['assetType','snapshot','priceAtomic'])
    check(row.assetType==='soul'&&positive(row.priceAtomic),'Only explicitly selected Soul rows belong to this transaction')
    const s=validateMarketListSnapshot(row.snapshot);row.snapshot=s
    check(s.owner===result.owner&&!s.listed&&s.listingId===null&&(s.equipmentId===null||s.equipmentSale),'Selected Soul must have a complete held snapshot')
    const authority=canonical(s.release)
    check(release===undefined||release===authority,'Selected Souls use different market releases');release=authority
    claim(s.soulId,'soul');claim(s.stateId,'state');claim(s.bindingId,'binding')
    claim(s.kioskId,'kiosk',true);claim(s.kioskCapId,'cap',true)
    check(!caps.has(s.kioskCapId)||caps.get(s.kioskCapId)===s.kioskId,'Selected Kiosk cap scope mismatch');caps.set(s.kioskCapId,s.kioskId)
    for(const [id,role] of [[s.release.protocolConfigId,'protocol'],[s.release.marketConfigV2Id,'market'],
      [s.release.kioskRegistryId,'kiosk-registry'],[s.release.soulTransferPolicyId,'policy']])claim(id,role,true)
    for(const id of [s.release.soulidityOriginalPackageId,s.release.soulidityCallablePackageId,s.release.kioskPackageId])packages.add(id)
    const e=s.equipmentSale
    if(e){
      // The original family + digest must agree even when a row needs no Pack call.
      const family=canonical({original:e.scope.target.runtimeOriginalPackageId,digest:e.runtimeCallableDigest})
      check(runtime===undefined||runtime===family,'Selected Souls use different equipment releases');runtime=family
      claim(e.scope.equipmentId,'equipment');claim(e.definitionRegistryId,'definitions',true);claim(e.baseRegistryId,'base-registry',true)
      packages.add(e.scope.target.runtimeOriginalPackageId)
      for(const pack of e.packs){claim(pack.releaseId,'pack-release',true);packages.add(pack.runtimeCallablePackageId)
        check(runtimeCallable===undefined||runtimeCallable===pack.runtimeCallablePackageId,'Selected Souls use different callable equipment packages')
        runtimeCallable=pack.runtimeCallablePackageId}
      for(const removal of e.removals)if(removal.kind!=='selection')claim(removal.itemId,'instance')
    }
  }
  check([...roles.keys()].every(id=>!packages.has(id)),'Selected sale objects overlap packages')
  buildSoulMarketBatchListTransaction(result.rows)
  return result
}
export function buildSoulMarketBatchListTransaction(rows:SoulMarketBatchListRow[]){
  return buildSelectedAnimacraftSoulSaleV8Tx(rows.map(({snapshot:s,priceAtomic})=>({target:s.release,
    soulStateId:s.stateId,provenanceBindingId:s.bindingId,currentKioskId:s.kioskId,currentKioskCapOnChainId:s.kioskCapId,
    priceAtomic:BigInt(priceAtomic),equipment:s.equipmentSale??null})))
}
