import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {verifyTransactionSignature} from '@mysten/sui/verify'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'
import {validateMarketCancelCheckpoint} from './market-cancel-checkpoint'
import {marketListCheck as check,marketListId,marketListCanonical as canonical} from './market-list-operation'
import {queryListingPacketEvidence} from './listing-operation-evidence'
import {querySelectedMarketSaleEvidence} from './selected-market-sale-evidence'
import {selectedBatchRecord} from './market-batch-list-operation'
import {buildMarketBatchListTransaction,validateMarketBatchListSnapshot,validateMarketBatchListOperationRecord,
  type NativeMarketBatchListSnapshot,type BatchMarketListOperationRecord,type MarketBatchListOperationAdapter} from './market-batch-list-operation'
import type {MarketBatchListSelection} from './market-batch-list-types'

const TIMEOUT_MS=25_000
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>,timeoutMs=TIMEOUT_MS):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Batch listing request timed out; recover the saved transaction'))},timeoutMs)
  })])}finally{clearTimeout(timer)}
}
const ListedBcs=bcs.struct('SoulListed',{listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address,kiosk_id:bcs.Address,price:bcs.u64()})
export function batchListingSelection(value:Pick<NativeMarketBatchListSnapshot,'rows'>):MarketBatchListSelection[]{
  return value.rows.map(row=>row.assetType==='soul'?{soulId:row.snapshot.soulId,stateId:row.snapshot.stateId,priceAtomic:row.priceAtomic}:
    {assetType:'equipment',rootId:row.snapshot.target.rootId,itemId:row.snapshot.asset.itemId,kind:row.snapshot.asset.kind,priceAtomic:row.priceAtomic,
      ...(row.snapshot.removal?{equipmentScope:{soulId:row.snapshot.removal.soulId,stateId:row.snapshot.removal.stateId}}:{})})
}
export function batchListingWritable(value:NativeMarketBatchListSnapshot,address:string|null){
  return address===value.owner&&value.rows.every(row=>{
    if(row.assetType==='soul'){const s=row.snapshot;return s.owner===address&&!s.listed&&s.listAvailable
      &&s.release.writesEnabled&&(s.equipmentId===null||s.equipmentSale?.writesEnabled===true)}
    const s=row.snapshot;return s.actor===address&&s.seller===address&&s.listing===null&&s.available.list
      &&s.release.marketWritesEnabled===true&&s.release.equipmentWritesEnabled===true
  })
}
export function createMarketBatchListOperationAdapter(params:{client:SuiGrpcClient;
  read:(selection:MarketBatchListSelection[],signal:AbortSignal)=>Promise<NativeMarketBatchListSnapshot>;
  observed?:NativeMarketBatchListSnapshot;getAddress:()=>string|null;
  sign:(tx:Transaction)=>Promise<{bytes:string;signature:string}>;
  sync:(record:BatchMarketListOperationRecord)=>Promise<'COMPLETE'|'SUPERSEDED'>}):MarketBatchListOperationAdapter{
  const {client,read,getAddress,sign,sync}=params,observed=params.observed?validateMarketBatchListSnapshot(params.observed):undefined
  async function chain(){const {response}=await bounded(abort=>client.ledgerService.getServiceInfo({},{abort,timeout:TIMEOUT_MS}));check(response.chainId===MAINNET_GENESIS_DIGEST,'Mainnet batch listing RPC required')}
  async function epoch(){const {response}=await bounded(abort=>client.ledgerService.getEpoch({readMask:{paths:['epoch']}},{abort,timeout:TIMEOUT_MS}))
    const value=response.epoch?.epoch;check(typeof value==='bigint'&&value>=0n&&value<18446744073709551615n,'Current epoch unavailable');return value}
  async function fresh(value:Pick<NativeMarketBatchListSnapshot,'rows'>){await chain()
    return validateMarketBatchListSnapshot(await bounded(signal=>read(batchListingSelection(value),signal)))}
  const fixed=(v:NativeMarketBatchListSnapshot)=>canonical({...v,rows:v.rows.map(row=>({...row,snapshot:{...row.snapshot,
    listAvailable:undefined,repriceAvailable:undefined,available:undefined,release:{...row.snapshot.release,writesEnabled:undefined,
      marketWritesEnabled:undefined,equipmentWritesEnabled:undefined}}}))})
  const same=(now:NativeMarketBatchListSnapshot,old:NativeMarketBatchListSnapshot)=>check(fixed(now)===fixed(old),'Selected sale list, prices, custody or release changed')
  const snapshot=(r:BatchMarketListOperationRecord):NativeMarketBatchListSnapshot=>({schema:'native-market-batch-list-v1',owner:r.owner,rows:r.rows,
    ...(r.equipment!==undefined?{equipment:r.equipment}:{})})
  return {
    async prepare(){check(observed,'Review the complete selected sale list first')
      const current=await fresh(observed);same(current,observed);check(batchListingWritable(current,getAddress()),'Batch listing unavailable or seller wallet changed')
      const expirationEpoch=String(await epoch()+1n),tx=buildMarketBatchListTransaction(current.rows,current.equipment)
      tx.setSender(current.owner);tx.setExpiration({Epoch:expirationEpoch})
      const bytes=await bounded(()=>tx.build({client}))
      const record=validateMarketBatchListOperationRecord({schema:1,kind:'batch-list',owner:current.owner,rows:current.rows,
        ...(current.equipment!==undefined?{equipment:current.equipment}:{}),
        bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch,phase:'PREPARED',signature:null})
      check(getAddress()===current.owner,'Wallet changed while preparing selected sale');return record
    },
    async preflight(value){const r=validateMarketBatchListOperationRecord(value)
      check(['PREPARED','SIGNING','SIGNED'].includes(r.phase),'Terminal batch cannot sign or rebroadcast')
      const current=await fresh(r);same(r.equipment===undefined?{...current,equipment:undefined}:current,snapshot(r));check(batchListingWritable(current,getAddress()),'Batch listing unavailable or seller wallet changed')
      check(await epoch()<=BigInt(r.expirationEpoch),'Saved batch expired; query or retire without rebuilding it')
      check(getAddress()===r.owner,'Wallet changed during batch preflight')},
    async sign(value){const r=validateMarketBatchListOperationRecord(value)
      check(['PREPARED','SIGNING'].includes(r.phase)&&getAddress()===r.owner,'Wallet changed or batch cannot request signature')
      return bounded(()=>sign(Transaction.from(fromBase64(r.bytes))),120_000)},
    async verifySignature(value){const r=validateMarketBatchListOperationRecord(value);check(r.signature,'Batch signature missing')
      await bounded(()=>verifyTransactionSignature(fromBase64(r.bytes),r.signature!,{address:r.owner,client}))},
    async broadcast(value){const r=validateMarketBatchListOperationRecord(value)
      check(r.phase==='SIGNED'&&r.signature&&getAddress()===r.owner,'Only the saved signed batch may broadcast')
      await bounded(signal=>client.core.executeTransaction({transaction:fromBase64(r.bytes),signatures:[r.signature!],signal}))},
    async sync(value){return bounded(()=>sync(validateMarketBatchListOperationRecord(value)),120_000)},
    async expiryCheckpoint(value){const r=validateMarketBatchListOperationRecord(value);await chain()
      const {response}=await bounded(abort=>client.ledgerService.getCheckpoint({checkpointId:{oneofKind:undefined},
        readMask:{paths:['sequence_number','digest','summary','signature']}},{abort,timeout:TIMEOUT_MS}))
      const checkpoint=response.checkpoint,summary=checkpoint?.summary
      check(checkpoint&&summary?.bcs?.value&&checkpoint.digest===summary.digest&&typeof summary.epoch==='bigint'&&typeof summary.sequenceNumber==='bigint'
        &&checkpoint.sequenceNumber===summary.sequenceNumber&&checkpoint.signature?.epoch===summary.epoch&&checkpoint.signature.signature?.length===48&&checkpoint.signature.bitmap?.length,
      'Executed batch checkpoint evidence unavailable or inconsistent')
      return validateMarketCancelCheckpoint({bytes:toBase64(summary.bcs.value),digest:checkpoint.digest,epoch:String(summary.epoch),sequenceNumber:String(summary.sequenceNumber)},r.expirationEpoch)},
    async query(value){const r=validateMarketBatchListOperationRecord(value)
      return (r.equipment!==undefined?await querySelectedMarketSaleEvidence(selectedBatchRecord(r),client):await queryMarketBatchListOperationEvidence(r,client)).status},
  }
}
export type MarketBatchListOperationEvidence={status:'MISSING'|'PENDING'|'FAILED'}|{
  status:'SUCCEEDED';checkpoint:string;receipts:Array<ReturnType<typeof ListedBcs.parse>>;
  effects:ReturnType<typeof bcs.TransactionEffects.parse>;originalPackageId:string
}
export async function queryMarketBatchListOperationEvidence(value:BatchMarketListOperationRecord,client:SuiGrpcClient):Promise<MarketBatchListOperationEvidence>{
  const r=validateMarketBatchListOperationRecord(value)
  check(r.equipment===undefined&&r.rows.every(row=>row.assetType==='soul'),'Use the complete selected-sale receipt query for grouped records')
  const first=r.rows[0];check(first.assetType==='soul','Soul receipt required');const release=first.snapshot.release
  const proof=await queryListingPacketEvidence({...r,release},client)
  if(proof.status!=='SUCCEEDED')return proof
  const events=proof.events.data.filter(event=>event.type_.address===release.soulidityOriginalPackageId&&event.type_.module==='market')
  check(!events.some(event=>event.type_.name==='SoulListingCancelled'),'Selected new sales cannot cancel another listing')
  const listed=events.filter(event=>event.type_.name==='SoulListed')
  check(listed.length===r.rows.length,'Complete selected listing receipt set required')
  const ids=new Set<string>(),inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs.flatMap(input=>
    input.Object?.SharedObject?[input.Object.SharedObject.objectId]:input.Object?.ImmOrOwnedObject?[input.Object.ImmOrOwnedObject.objectId]:[])
  const receipts=listed.map((event,index)=>{
    const selected=r.rows[index];check(selected.assetType==='soul','Soul receipt required');const {snapshot:s,priceAtomic}=selected
    check(event.package_id===release.soulidityCallablePackageId&&event.transaction_module==='market'&&event.sender===r.owner
      &&event.type_.typeParams.length===0&&event.contents.length===136,'Batch listing event authority mismatch')
    const receipt=ListedBcs.parse(Uint8Array.from(event.contents))
    check(toBase64(ListedBcs.serialize(receipt).toBytes())===toBase64(Uint8Array.from(event.contents))
      &&marketListId(receipt.listing_id)&&!ids.has(receipt.listing_id)&&!inputs.includes(receipt.listing_id)
      &&!r.rows.some(row=>row.assetType==='soul'&&row.snapshot.soulId===receipt.listing_id)
      &&receipt.soul_id===s.soulId&&receipt.seller===r.owner&&receipt.kiosk_id===s.kioskId&&receipt.price===priceAtomic,
    'Selected listing receipt identity, order or price mismatch')
    ids.add(receipt.listing_id);return receipt
  })
  return {status:'SUCCEEDED',checkpoint:proof.checkpoint,receipts,effects:proof.effects,originalPackageId:proof.originalPackageId}
}
