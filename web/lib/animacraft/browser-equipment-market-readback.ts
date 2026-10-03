import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {bcs} from '@mysten/sui/bcs'
import {Transaction} from '@mysten/sui/transactions'
import {fromBase64,toHex} from '@mysten/sui/utils'
import {createNativeReceiveClient,decodeNativeBcs,receiveId,type NativeReceiveTarget} from './native-receive'
import {createNativeMarketReadbackSession,nativeMarketSharedOutputReference} from './browser-native-market-readback'
import {EquipmentReadSet,EquipmentBaseItemBcs,EquipmentExternalItemBcs,EquipmentLoadoutBcs,
  equipmentCommitment,readNativeEquipment} from './native-equipment'
import {EquipmentMarketListingBcs} from './native-equipment-market-bcs'
import {equipmentMarketAssetCommitment,readEquipmentMarketListingSnapshot,readEquipmentMarketCustodySnapshot} from './native-equipment-market-read'
import {validateEquipmentMarketOperationRecord,type EquipmentMarketOperationRecord} from './equipment-market-operation'
import {queryEquipmentMarketOperationEvidence,type EquipmentMarketOperationReceipt} from './equipment-market-operation-evidence'
import type {SelectedSaleEquipmentPreparation} from './native-selected-equipment-sale'
import {marketListCheck as check,marketListCanonical as canonical} from './market-list-operation'

type Effects=ReturnType<typeof bcs.TransactionEffects.parse>
const hex=(v:number[])=>toHex(new Uint8Array(v))
const fingerprint=(v:unknown)=>JSON.stringify(v,(_key,value)=>typeof value==='bigint'?String(value):value)

type EquipmentRowView=Pick<EquipmentMarketOperationRecord,'snapshot'|'action'|'bytes'|'digest'>
export type EquipmentMarketReadbackContext={client:SuiGrpcClient;signal:AbortSignal;reads:EquipmentReadSet;historyReads:EquipmentReadSet}
type ReadbackContext=EquipmentMarketReadbackContext
function assetOutput(effects:Effects,r:EquipmentRowView,owner:string){
  const s=r.snapshot,expectedInput=r.action==='list'?s.actor:s.listing!.id
  if(effects.V2){
    const rows=effects.V2.changedObjects.filter(([id])=>id===s.asset.itemId)
    check(rows.length===1,'Equipment output missing from effects')
    const change=rows[0][1],output=change.outputState.ObjectWrite,input=change.inputState.Exist
    check(change.idOperation.$kind==='None'&&output?.[1].AddressOwner===owner&&input
      &&input[1].AddressOwner===expectedInput&&input[0][0]===s.reference.version&&input[0][1]===s.reference.digest
      &&BigInt(effects.V2.lamportVersion)>BigInt(s.reference.version),'Equipment effects custody/reference mismatch')
    return {version:BigInt(effects.V2.lamportVersion),digest:output[0]}
  }
  check(effects.V1,'Unsupported equipment effects')
  const rows=effects.V1.mutated.filter(([ref])=>ref.objectId===s.asset.itemId)
  const prior=effects.V1.modifiedAtVersions.filter(([id])=>id===s.asset.itemId)
  check(rows.length===1&&rows[0][1].AddressOwner===owner&&prior.length===1&&prior[0][1]===s.reference.version
    &&BigInt(rows[0][0].version)>BigInt(s.reference.version),'Equipment V1 output custody/reference mismatch')
  return {version:BigInt(rows[0][0].version),digest:rows[0][0].digest}
}

/** Historical effects + object BCS establish what this exact transaction did;
 * current authenticated custody establishes whether that result still applies.
 * Neither the connected wallet nor today's write switches authorize this read. */
export async function confirmBrowserEquipmentMarketOperation(value:EquipmentMarketOperationRecord,
  options:{signal?:AbortSignal}={},dependencies:{client?:SuiGrpcClient}={}):Promise<'COMPLETE'|'SUPERSEDED'>{
  const r=validateEquipmentMarketOperationRecord(value),s=r.snapshot,target=s.release
  check(r.phase==='SUCCEEDED','Only a finalized equipment transaction can synchronize')
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const weight=Math.min(20,Math.max(1,Math.ceil((s.removal?.equipment?.retainedSelectionIndexes.length??0)/20)))
  const session=createNativeMarketReadbackSession(dependencies.client??createNativeReceiveClient(signal),signal,weight),client=session.client
  const proof=await queryEquipmentMarketOperationEvidence(r,client)
  check(proof.status==='SUCCEEDED','Finalized equipment receipt unavailable')
  const reads=new EquipmentReadSet(client,true),historyReads=new EquipmentReadSet(client)
  const context={client,signal,reads,historyReads}
  let superseded=await confirmAuthenticatedEquipmentMarketRow(r,proof,context)==='SUPERSEDED'
  if(s.removal?.equipment){
    const result=await confirmAuthenticatedPartialEquipmentRemoval({actor:s.actor,rootId:s.target.rootId,target,preparation:s.removal,
      bytes:r.bytes,digest:r.digest,effects:proof.effects},context)
    superseded ||= result==='SUPERSEDED'
  }
  await reads.verify();await session.verify();signal.throwIfAborted()
  return superseded?'SUPERSEDED':'COMPLETE'
}

/** Row evaluator shared by single and mixed sale readback. The caller MUST
 * validate the entire saved command graph and complete authenticated receipt set.
 * It owns final readset/session verification; this function never queries or
 * validates a fabricated single-item transaction and never evaluates group plans. */
export async function confirmAuthenticatedEquipmentMarketRow(r:EquipmentRowView,
  proof:{effects:Effects;receipt:EquipmentMarketOperationReceipt},context:ReadbackContext):Promise<'COMPLETE'|'SUPERSEDED'>{
  const {client,signal,reads,historyReads}=context,s=r.snapshot,target=s.release,pin=target.equipmentMarket!,receipt=proof.receipt
  const market=(await client.ledgerService.getObject({objectId:pin.callablePackageId})).response.object!.package!
  const runtime=(await client.ledgerService.getObject({objectId:target.runtime!.callablePackageId})).response.object!
  check(runtime.digest===target.runtime!.callableDigest&&runtime.owner?.kind===4
    &&runtime.package?.storageId===target.runtime!.callablePackageId&&runtime.package.originalId===target.runtime!.originalPackageId
    &&runtime.package.version===runtime.version,'Equipment historical Runtime pin mismatch')
  function type(pkg:NonNullable<typeof runtime.package>,module:string,name:string){
    const origins=pkg.typeOrigins.filter(row=>row.moduleName===module&&row.datatypeName===name)
    check(origins.length===1,'Equipment historical type origin missing')
    return `${receiveId(origins[0].packageId)}::${module}::${name}`
  }
  const listingType=`${type(market,'market_v8','EquipmentListingV8')}<${s.target.paymentCoinType}>`
  const itemType=type(runtime.package!,'runtime_v8',s.asset.kind==='base'?'OwnedBaseItemV8':'OwnedExternalItemV8')
  const listingRef=nativeMarketSharedOutputReference(proof.effects,receipt.listingId)
  const inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs
  if(r.action==='list')check(listingRef.created,'Equipment listing was not created by this transaction')
  else{
    const shared=inputs.find(i=>i.Object?.SharedObject?.objectId===receipt.listingId)?.Object?.SharedObject
    check(!listingRef.created&&shared&&BigInt(shared.initialSharedVersion)===listingRef.birth,'Equipment listing output birth mismatch')
  }
  const historical=(await client.ledgerService.getObject({objectId:receipt.listingId,version:listingRef.version})).response.object!
  check(historical.digest===listingRef.digest&&historical.owner?.version===listingRef.birth
    &&historical.previousTransaction===r.digest,'Historical equipment listing differs from effects')
  const post=decodeNativeBcs(EquipmentMarketListingBcs,historyReads.accept(historical,receipt.listingId,listingType,3))
  check(post.id===receipt.listingId&&post.version==='8'&&post.registry_id===s.target.registryId&&post.treasury_id===s.target.treasuryId
    &&post.package_config_id===s.target.packageConfigId&&post.root_id===s.target.rootId
    &&post.maker_version===s.quoteContext.makerVersion&&hex(post.root_content_commitment)===s.quoteContext.rootContentCommitment
    &&post.custody.asset_id===s.asset.itemId&&post.custody.asset_kind===(s.asset.kind==='base'?0:2)
    &&post.custody.source_id===(s.asset.kind==='base'?s.asset.baseRegistryId:s.asset.productId)
    &&post.custody.holder===s.seller&&post.custody.ownership_epoch===s.ownershipEpoch
    &&hex(post.custody.asset_commitment)===s.assetCommitment
    &&post.status===receipt.status&&post.revision===receipt.revision
    &&post.terminal_recipient===(receipt.status===0?`0x${'0'.repeat(64)}`:receipt.recipient)
    &&post.gross_atomic===receipt.grossAtomic&&post.protocol_atomic===receipt.protocolAtomic
    &&post.seller_atomic===receipt.sellerAtomic&&post.creator_atomic==='0'&&post.source_atomic==='0'
    &&hex(post.quote_commitment)===receipt.quoteCommitment,'Historical equipment listing postcondition mismatch')
  const expectedOwner=receipt.status===0?receipt.listingId:receipt.recipient
  const itemRef=r.action==='reprice'?{version:BigInt(s.reference.version),digest:s.reference.digest}:assetOutput(proof.effects,r,expectedOwner)
  const itemRaw=(await client.ledgerService.getObject({objectId:s.asset.itemId,version:itemRef.version})).response.object!
  check(itemRaw.digest===itemRef.digest&&(r.action==='reprice'||itemRaw.previousTransaction===r.digest),'Historical equipment reference mismatch')
  const schema=s.asset.kind==='base'?EquipmentBaseItemBcs:EquipmentExternalItemBcs
  const itemBytes=historyReads.accept(itemRaw,s.asset.itemId,itemType,1,expectedOwner)
  const item=s.asset.kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,itemBytes):decodeNativeBcs(EquipmentExternalItemBcs,itemBytes)
  const frozenAsset=(v:typeof item)=>hex(equipmentMarketAssetCommitment((schema as typeof EquipmentBaseItemBcs).serialize({
    ...v,holder:s.seller,ownership_epoch:s.ownershipEpoch,equip_lock:null} as ReturnType<typeof EquipmentBaseItemBcs.parse>).toBytes()))
  check(item.id===s.asset.itemId&&item.version==='8'&&item.holder===receipt.recipient&&item.ownership_epoch===receipt.ownershipEpoch
    &&item.equip_lock===null&&item.transferable&&frozenAsset(item)===s.assetCommitment,'Historical equipment holder/contents mismatch')
  // Effects V1 does not commit the predecessor digest; fetch it explicitly.
  if(proof.effects.V1&&r.action!=='reprice'){
    const before=(await client.ledgerService.getObject({objectId:s.asset.itemId,version:BigInt(s.reference.version)})).response.object!
    check(before.digest===s.reference.digest,'Equipment V1 predecessor digest mismatch')
    new EquipmentReadSet(client).accept(before,s.asset.itemId,itemType,1,r.action==='list'?s.actor:s.listing!.id)
  }
  const current=await readEquipmentMarketListingSnapshot(client,target,pin,
    {rootId:s.target.rootId,listingId:receipt.listingId},signal,reads)
  const currentRaw=(await client.ledgerService.getObject({objectId:receipt.listingId})).response.object!
  check(currentRaw.version!>=listingRef.version&&currentRaw.owner?.version===listingRef.birth
    &&(currentRaw.version!==listingRef.version||fingerprint(currentRaw)===fingerprint(historical)),'Equipment listing version regressed')
  const immutable=(v:typeof post)=>canonical({...v,gross_atomic:undefined,protocol_atomic:undefined,creator_atomic:undefined,
    source_atomic:undefined,seller_atomic:undefined,quote_commitment:undefined,status:undefined,revision:undefined,terminal_recipient:undefined})
  check(immutable(current.listing)===immutable(post)&&BigInt(current.listing.revision)>=BigInt(post.revision),
    'Equipment listing immutable custody changed')
  const listingChanged=canonical(current.listing)!==canonical(post)
  check(!listingChanged||post.status===0&&currentRaw.version!>listingRef.version&&BigInt(current.listing.revision)>BigInt(post.revision),
    'Terminal equipment listing changed or revision did not advance')
  const custody=await readEquipmentMarketCustodySnapshot(client,target,pin,
    {rootId:s.target.rootId,itemId:s.asset.itemId,kind:s.asset.kind},signal,reads)
  const live=custody.asset.item,liveRaw=(await client.ledgerService.getObject({objectId:s.asset.itemId})).response.object!
  check(liveRaw.version!>=itemRef.version&&(liveRaw.version!==itemRef.version||fingerprint(liveRaw)===fingerprint(itemRaw))
    &&frozenAsset(live)===s.assetCommitment&&BigInt(live.ownership_epoch)>=BigInt(receipt.ownershipEpoch)
    &&(live.holder===item.holder||BigInt(live.ownership_epoch)>BigInt(receipt.ownershipEpoch)),
  'Current equipment identity/ownership epoch changed without proof')
  // A later terminal listing is also an ownership frontier. In particular,
  // successful settlement must advance once before any subsequent transfer
  // (including a later transfer back to the original seller) is possible.
  if(current.listing.status!==0){
    const frontier=BigInt(current.listing.custody.ownership_epoch)+(current.listing.status===1?1n:0n)
    check(BigInt(live.ownership_epoch)>=frontier
      &&(BigInt(live.ownership_epoch)>frontier||live.holder===current.listing.terminal_recipient),
    'Current equipment contradicts the terminal listing ownership frontier')
  }
  const assetChanged=live.holder!==item.holder||live.ownership_epoch!==item.ownership_epoch
    ||custody.addressOwner!==expectedOwner||live.equip_lock!==null
  check(!assetChanged||liveRaw.version!>itemRef.version,'Changed equipment requires a later version')
  return listingChanged||assetChanged?'SUPERSEDED':'COMPLETE'
}

/** One grouped partial update, not one update per selected instance. Complete
 * removal with binding closure has additional historical deletion requirements
 * and is deliberately rejected here rather than silently treated as partial. */
export async function confirmAuthenticatedPartialEquipmentRemoval(value:{actor:string;rootId:string;target:NativeReceiveTarget;
  preparation:SelectedSaleEquipmentPreparation;bytes:string;digest:string;effects:Effects},context:ReadbackContext):Promise<'COMPLETE'|'SUPERSEDED'>{
    const {actor,rootId,target,preparation,bytes,digest,effects}=value,{client,reads,historyReads}=context
    check(preparation.equipment&&!preparation.sellSoul&&!preparation.equipment.closeBinding,'Partial equipment group required')
    const e=preparation.equipment,plan=e.plan,ref=nativeMarketSharedOutputReference(effects,plan.scope.equipmentId)
    const inputs=Transaction.from(fromBase64(bytes)).getData().inputs
    const runtime=(await client.ledgerService.getObject({objectId:target.runtime!.callablePackageId})).response.object!
    check(runtime.digest===target.runtime!.callableDigest&&runtime.owner?.kind===4
      &&runtime.package?.storageId===target.runtime!.callablePackageId&&runtime.package.originalId===target.runtime!.originalPackageId
      &&runtime.package.version===runtime.version,'Equipment historical Runtime pin mismatch')
    const origins=runtime.package!.typeOrigins.filter(row=>row.moduleName==='runtime_v8'&&row.datatypeName==='MakerLoadoutV8')
    check(origins.length===1,'Equipment historical loadout origin missing')
    const loadoutType=`${receiveId(origins[0].packageId)}::runtime_v8::MakerLoadoutV8`
    const shared=inputs.find(i=>i.Object?.SharedObject?.objectId===plan.scope.equipmentId)?.Object?.SharedObject
    check(!ref.created&&shared&&BigInt(shared.initialSharedVersion)===ref.birth,'Partial removal output scope mismatch')
    const raw=(await client.ledgerService.getObject({objectId:plan.scope.equipmentId,version:ref.version})).response.object!
    check(raw.digest===ref.digest&&raw.owner?.version===ref.birth&&raw.previousTransaction===digest,'Historical partial removal differs from effects')
    const loadout=decodeNativeBcs(EquipmentLoadoutBcs,historyReads.accept(raw,plan.scope.equipmentId,loadoutType,3))
    check(loadout.id===plan.scope.equipmentId&&loadout.version==='8'&&loadout.holder===actor&&loadout.root_id===rootId
      &&loadout.revision===e.finalRevision&&loadout.selection_count===e.finalSelectionCount&&hex(loadout.commitment)===e.finalCommitment
      &&equipmentCommitment(loadout)===e.finalCommitment
      &&canonical(loadout.selections.flatMap((slot,index)=>slot?[String(index)]:[]))===canonical(e.retainedSelectionIndexes),
    'Historical partial removal changed unchecked equipment')
    const liveEquipment=await readNativeEquipment(client,target,{soulId:preparation.soulId,stateId:preparation.stateId},reads)
    if(liveEquipment.equipment?.loadout.id===plan.scope.equipmentId){
      const now=(await client.ledgerService.getObject({objectId:plan.scope.equipmentId})).response.object!
      check(now.version!>=ref.version&&now.owner?.version===ref.birth
        &&(now.version!==ref.version||fingerprint(now)===fingerprint(raw))
        &&BigInt(liveEquipment.equipment.loadout.revision)>=BigInt(e.finalRevision),
      'Current equipment loadout version or revision regressed')
    }
    const same=liveEquipment.owner===actor&&liveEquipment.equipment?.loadout.id===plan.scope.equipmentId
      &&liveEquipment.equipment.loadout.revision===e.finalRevision&&hex(liveEquipment.equipment.loadout.commitment)===e.finalCommitment
    return same?'COMPLETE':'SUPERSEDED'
}
