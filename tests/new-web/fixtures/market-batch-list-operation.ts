import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {toBase64,toBase58} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {marketListFixture,lid,listedReceiptBcs} from './market-list-operation'
import {cancelEventsBcs} from './market-cancel-operation'
import {buildMarketBatchListTransaction} from '../../../web/lib/animacraft/market-batch-list-operation'
import type {SoulMarketBatchListSnapshot,BatchMarketListOperationRecord} from '../../../web/lib/animacraft/market-batch-list-types'

export async function marketBatchListFixture(equipped=true){
  const first=(await marketListFixture({equipped})).snapshot,second=structuredClone(first)
  Object.assign(second,{soulId:lid(112),stateId:lid(114),bindingId:lid(113)})
  if(second.equipmentSale){second.equipmentId=lid(190);Object.assign(second.equipmentSale.scope,{soulStateId:lid(114),equipmentId:lid(190)})
    second.equipmentSale.removals=[{kind:'base',itemId:lid(194)},{kind:'selection',selectionIndex:'4'}]}
  const snapshot:SoulMarketBatchListSnapshot={schema:'native-market-batch-list-v1',owner:first.owner,
    rows:[{assetType:'soul',snapshot:first,priceAtomic:'10001'},{assetType:'soul',snapshot:second,priceAtomic:'20002'}]}
  const data=buildMarketBatchListTransaction(snapshot.rows).getData()
  const owned=snapshot.rows.flatMap(({snapshot:s})=>[s.bindingId,s.kioskCapId,...(s.equipmentSale?.removals.flatMap(r=>r.kind==='selection'?[]:[r.itemId])??[])])
  const mutable=snapshot.rows.flatMap(({snapshot:s})=>[s.stateId,s.kioskId,s.release.kioskRegistryId,s.equipmentId])
  const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    return {Object:owned.includes(objectId)?{ImmOrOwnedObject:{objectId,version:'2',digest:first.release.soulidityCallableDigest}}
      :{SharedObject:{objectId,initialSharedVersion:'1',mutable:mutable.includes(objectId)}}}
  })}))
  tx.setSender(snapshot.owner);tx.setGasOwner(snapshot.owner);tx.setGasPrice('1000');tx.setGasBudget('1000000')
  tx.setGasPayment([{objectId:lid(200),version:'1',digest:first.release.soulidityCallableDigest}]);tx.setExpiration({Epoch:'10'})
  const bytes=await tx.build(),record:BatchMarketListOperationRecord={schema:1,kind:'batch-list',owner:snapshot.owner,rows:structuredClone(snapshot.rows),
    bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED',signature:null}
  return {snapshot,record,bytes,tx}
}
export function marketBatchListEvents(record:BatchMarketListOperationRecord,mutate?:(rows:any[])=>void){
  const release=record.rows[0].snapshot.release
  const events=record.rows.map((row,index)=>{if(row.assetType!=='soul')throw new Error('Soul fixture requires Soul rows');const {snapshot:s,priceAtomic}=row;return {package_id:release.soulidityCallablePackageId,transaction_module:'market',sender:record.owner,
    type_:{address:release.soulidityOriginalPackageId,module:'market',name:'SoulListed',typeParams:[]},
    contents:Array.from(listedReceiptBcs.serialize({listing_id:lid(300+index),soul_id:s.soulId,seller:record.owner,kiosk_id:s.kioskId,price:priceAtomic}).toBytes())}})
  mutate?.(events)
  const bytes=cancelEventsBcs.serialize({data:events}).toBytes()
  return {bcs:{value:bytes},digest:toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...bytes]),{dkLen:32})),events:[]}
}
