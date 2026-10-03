import {expect,it} from 'vitest'
import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,toBase64,toBase58} from '@mysten/sui/utils'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {readSelectedMarketSaleSnapshot,buildSelectedMarketSaleTransaction,type SelectedMarketSaleSelection} from '../../web/lib/animacraft/selected-market-sale-snapshot'
import {selectedMarketSaleInputRoles,validateSelectedMarketSaleOperationRecord,type SelectedMarketSaleOperationRecord} from '../../web/lib/animacraft/selected-market-sale-operation'
import type {NativeMarketBuyTarget} from '../../web/lib/animacraft/native-market-buy-snapshot'
async function fixture(){
  const f=await equipmentMarketOperationFixture({equipped:true}),equipmentScope={soulId:emid(12),stateId:emid(14)}
  const selection:SelectedMarketSaleSelection[]=[{assetType:'equipment',rootId:f.rootId,itemId:f.itemId,kind:'base',priceAtomic:'10001',equipmentScope},
    {assetType:'equipment',rootId:f.rootId,itemId:emid(102),kind:'external',priceAtomic:'20001',equipmentScope}]
  const snapshot=await readSelectedMarketSaleSnapshot(f.client,f.target,{} as NativeMarketBuyTarget,{owner:f.owner,selection})
  const roles=selectedMarketSaleInputRoles(snapshot),data=buildSelectedMarketSaleTransaction(snapshot).getData()
  data.inputs=data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId,s=snapshot.rows.find(row=>row.assetType==='equipment'&&row.snapshot.asset.itemId===objectId)
    const ref=s?.assetType==='equipment'?s.snapshot.reference:{objectId,version:'2',digest:f.target.outputCallableDigest}
    return roles.owned.has(objectId)?Inputs.ObjectRef(ref):Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)})
  })
  const tx=Transaction.from(JSON.stringify(data));tx.setSender(f.owner);tx.setGasOwner(f.owner);tx.setGasPrice(1);tx.setGasBudget(100000)
  tx.setGasPayment([{objectId:emid(950),version:'2',digest:f.target.outputCallableDigest}]);tx.setExpiration({Epoch:9})
  const bytes=await tx.build(),record:SelectedMarketSaleOperationRecord={schema:1,kind:'batch-list',snapshot,bytes:toBase64(bytes),
    digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'9',phase:'PREPARED',signature:null}
  return {...f,record,roles,data:tx.getData()}
}
it('validates one exact packet with two listings and a single readonly-SoulState removal group',async()=>{
  const f=await fixture();expect(validateSelectedMarketSaleOperationRecord(f.record)).toEqual(f.record)
  expect(f.roles.mutable.has(emid(14))).toBe(false);expect(f.roles.mutable.has(emid(80))).toBe(true)
  expect(f.data.commands.filter(c=>c.MoveCall?.function==='begin_update_v8')).toHaveLength(1)
})
it.each(['extra command','missing command','price','row order','reference version','reference digest','state mutable','gas alias','sender','expiration'])(
  'rejects rehashed mixed bytes or record substitution: %s',async kind=>{
    const f=await fixture(),data=structuredClone(f.data),r=structuredClone(f.record)
    if(kind==='extra command')data.commands.push(data.commands[data.commands.length-1])
    if(kind==='missing command')data.commands.pop()
    if(kind==='price')r.snapshot.rows[0].priceAtomic='10002'
    if(kind==='row order')r.snapshot.rows.reverse()
    if(kind==='reference version')data.inputs.find(i=>i.Object?.ImmOrOwnedObject?.objectId===f.itemId)!.Object!.ImmOrOwnedObject!.version='3'
    if(kind==='reference digest'){
      const ref=data.inputs.find(i=>i.Object?.ImmOrOwnedObject?.objectId===f.itemId)!.Object!.ImmOrOwnedObject!
      const changed=toBase58(new Uint8Array(32).fill(99));expect(changed).not.toBe(ref.digest);ref.digest=changed
    }
    if(kind==='state mutable')data.inputs.find(i=>i.Object?.SharedObject?.objectId===emid(14))!.Object!.SharedObject!.mutable=true
    if(kind==='gas alias')data.gasData.payment![0].objectId=f.itemId
    if(kind==='sender')data.sender=emid(951)
    if(kind==='expiration')r.expirationEpoch='10'
    const bytes=await Transaction.from(JSON.stringify(data)).build();r.bytes=toBase64(bytes);r.digest=TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(()=>validateSelectedMarketSaleOperationRecord(r)).toThrow()
  })
it('rejects unsigned SIGNED and unproven retirement without editing saved bytes',async()=>{
  const f=await fixture();expect(()=>validateSelectedMarketSaleOperationRecord({...f.record,phase:'SIGNED'})).toThrow()
  expect(()=>validateSelectedMarketSaleOperationRecord({...f.record,phase:'RETIRED'})).toThrow()
  expect(Transaction.from(fromBase64(f.record.bytes)).getData().sender).toBe(f.owner)
})
