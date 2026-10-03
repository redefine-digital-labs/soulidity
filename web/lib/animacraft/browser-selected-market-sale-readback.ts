import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {attestNativeReceiveTarget,createNativeReceiveClient,decodeNativeBcs,NativeSoulBindingBcs,type NativeReceiveTarget} from './native-receive'
import {EquipmentReadSet} from './native-equipment'
import {createNativeMarketReadbackSession,confirmAuthenticatedNativeMarketRow} from './browser-native-market-readback'
import {confirmAuthenticatedEquipmentMarketRow,confirmAuthenticatedPartialEquipmentRemoval} from './browser-equipment-market-readback'
import {confirmAuthenticatedClosedEquipmentGroup} from './selected-equipment-close-readback'
import {validateSelectedMarketSaleOperationRecord,type SelectedMarketSaleOperationRecord} from './selected-market-sale-operation'
import {querySelectedMarketSaleEvidence} from './selected-market-sale-evidence'
import {marketListCheck as check} from './market-list-operation'
import type {MarketListOperationRecord} from './market-list-types'

/** One synchronization result for the entire saved selected-sale transaction.
 * No per-row commit, new signing, live inventory expansion or split transactions. */
export async function confirmBrowserSelectedMarketSale(value:SelectedMarketSaleOperationRecord,
  options:{target:NativeReceiveTarget;signal?:AbortSignal},dependencies:{client?:SuiGrpcClient}={}):Promise<'COMPLETE'|'SUPERSEDED'>{
  const r=validateSelectedMarketSaleOperationRecord(value),target=structuredClone(options.target)
  check(r.phase==='SUCCEEDED','Only a finalized selected sale can synchronize')
  for(const row of r.snapshot.rows){
    const release=row.snapshot.release
    check(release.protocolConfigId===target.protocolConfigId&&release.soulidityOriginalPackageId===target.soulidityOriginalPackageId
      &&release.soulidityCallablePackageId===target.soulidityCallablePackageId&&release.soulidityCallableDigest===target.soulidityCallableDigest,
    'Captured selected-sale release mismatch')
    if(row.assetType==='soul'&&row.snapshot.equipmentSale){
      const e=row.snapshot.equipmentSale
      check(target.runtime?.originalPackageId===e.scope.target.runtimeOriginalPackageId&&target.runtime.callableDigest===e.runtimeCallableDigest,
        'Captured selected-sale Runtime mismatch')
    }
  }
  const timeout=AbortSignal.timeout(r.snapshot.rows.length===1?25000:120000)
  const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout
  signal.throwIfAborted()
  const weight=Math.min(20,Math.max(r.snapshot.rows.length,Math.ceil(r.snapshot.equipment.reduce((n,g)=>n+(g.equipment?.plan.removals.length??0),0)/20)))
  const session=createNativeMarketReadbackSession(dependencies.client??createNativeReceiveClient(signal),signal,weight)
  const proof=await querySelectedMarketSaleEvidence(r,session.client)
  check(proof.status==='SUCCEEDED','Finalized selected-sale receipt unavailable')
  const context={client:session.client,signal,reads:new EquipmentReadSet(session.client,true),historyReads:new EquipmentReadSet(session.client)}
  const selectedListings=new Map<string,string>()
  let superseded=false
  for(const [index,row] of r.snapshot.rows.entries()){
    const receipt=proof.receipts[index]
    let outcome:'COMPLETE'|'SUPERSEDED'
    if(row.assetType==='soul'){
      check(receipt.assetType==='soul','Selected Soul receipt order mismatch')
      const view:MarketListOperationRecord={...r,kind:'list',snapshot:row.snapshot,priceAtomic:row.priceAtomic}
      outcome=await confirmAuthenticatedNativeMarketRow(view,target,signal,session,{...proof,receipt:receipt.receipt,
        originalPackageId:row.snapshot.release.soulidityOriginalPackageId})
    }else{
      check(receipt.assetType==='equipment','Selected equipment receipt order mismatch')
      selectedListings.set(row.snapshot.asset.itemId,receipt.receipt.listingId)
      outcome=await confirmAuthenticatedEquipmentMarketRow({snapshot:row.snapshot,action:'list',bytes:r.bytes,digest:r.digest},
        {effects:proof.effects,receipt:receipt.receipt},context)
    }
    // Do not short-circuit later rows when one is superseded.
    superseded ||= outcome==='SUPERSEDED'
  }
  for(const preparation of r.snapshot.equipment){
    if(!preparation.equipment)continue
    let outcome:'COMPLETE'|'SUPERSEDED'
    if(preparation.sellSoul){
      const row=r.snapshot.rows.find(row=>row.assetType==='soul'&&row.snapshot.stateId===preparation.stateId)
      check(row?.assetType==='soul','Closed group selected Soul missing')
      const types=await attestNativeReceiveTarget(session.client,target,{market:true})
      const binding=decodeNativeBcs(NativeSoulBindingBcs,await context.reads.read(row.snapshot.bindingId,types.bindingType,4))
      check(binding.id===row.snapshot.bindingId&&binding.soul_id===preparation.soulId&&binding.soul_state_id===preparation.stateId
        &&binding.protocol_config_id===target.protocolConfigId,'Closed group immutable Soul source mismatch')
      outcome=await confirmAuthenticatedClosedEquipmentGroup({actor:r.snapshot.owner,ownershipEpoch:row.snapshot.ownershipEpoch,
        rootId:binding.root_id,target,preparation,bytes:r.bytes,digest:r.digest,effects:proof.effects,selectedListings},context)
    }else{
      const row=r.snapshot.rows.find(row=>row.assetType==='equipment'&&row.snapshot.removal?.stateId===preparation.stateId)
      check(row?.assetType==='equipment','Partial group selected instance missing')
      outcome=await confirmAuthenticatedPartialEquipmentRemoval({actor:r.snapshot.owner,rootId:row.snapshot.target.rootId,
        target:row.snapshot.release,preparation,bytes:r.bytes,digest:r.digest,effects:proof.effects},context)
    }
    superseded ||= outcome==='SUPERSEDED'
  }
  await context.reads.verify();await session.verify();signal.throwIfAborted()
  return superseded?'SUPERSEDED':'COMPLETE'
}
