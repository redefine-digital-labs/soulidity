import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {Inputs,Transaction} from '@mysten/sui/transactions'
import {createMarketBatchListOperationAdapter,queryMarketBatchListOperationEvidence} from '../../web/lib/animacraft/market-batch-list-operation-adapter'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
import {marketBatchListFixture,marketBatchListEvents} from './fixtures/market-batch-list-operation'
import {listSigner,lid,listedReceiptBcs} from './fixtures/market-list-operation'
import {marketCancelCheckpointFixture} from './fixtures/market-cancel-operation'
import type {MarketBatchListSelection} from '../../web/lib/animacraft/market-batch-list-types'

async function fixture(){
  const f=await marketBatchListFixture();let address:string|null=f.record.owner
  const events=marketBatchListEvents(f.record),checkpoint=marketCancelCheckpointFixture(),s=f.record.rows[0].snapshot
  const effects:any={V2:{status:{Success:true},executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},
    transactionDigest:f.record.digest,gasObjectIndex:null,eventsDigest:events.digest,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}
  const ledger:any={digest:f.record.digest,transaction:{digest:f.record.digest,bcs:{value:f.bytes}},effects:{transactionDigest:f.record.digest,bcs:{value:bcs.TransactionEffects.serialize(effects).toBytes()},status:{success:true}},events,checkpoint:0n}
  const pkg:any={objectId:s.release.soulidityCallablePackageId,version:2n,digest:s.release.soulidityCallableDigest,owner:{kind:4},
    package:{storageId:s.release.soulidityCallablePackageId,originalId:s.release.soulidityOriginalPackageId,version:2n,
      typeOrigins:[{moduleName:'market',datatypeName:'SoulListed',packageId:s.release.soulidityOriginalPackageId}]}}
  const client:any={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),getEpoch:vi.fn(async()=>({response:{epoch:{epoch:9n}}})),
    getTransaction:vi.fn(async()=>({response:{transaction:ledger}})),getObject:vi.fn(async()=>({response:{object:pkg}})),
    getCheckpoint:vi.fn(async()=>({response:{checkpoint:checkpoint.checkpoint}}))},core:{executeTransaction:vi.fn(async()=>({})),
    resolveTransactionPlugin:()=>async(data:any,_options:any,next:()=>Promise<void>)=>{
      const owned=f.snapshot.rows.flatMap(({snapshot:s})=>[s.bindingId,s.kioskCapId,...(s.equipmentSale?.removals.flatMap(row=>row.kind==='selection'?[]:[row.itemId])??[])])
      const mutable=f.snapshot.rows.flatMap(({snapshot:s})=>[s.stateId,s.kioskId,s.release.kioskRegistryId,s.equipmentId])
      data.inputs=data.inputs.map((input:any)=>{if(!input.UnresolvedObject)return input;const id=input.UnresolvedObject.objectId
        return owned.includes(id)?Inputs.ObjectRef({objectId:id,version:'2',digest:s.release.soulidityCallableDigest})
          :Inputs.SharedObjectRef({objectId:id,initialSharedVersion:'1',mutable:mutable.includes(id)})})
      data.gasData=f.tx.getData().gasData;await next()
    }}}
  const read=vi.fn(async(_selection:MarketBatchListSelection[],_signal:AbortSignal)=>f.snapshot),sign=vi.fn(async(tx:Transaction)=>listSigner.signTransaction(await tx.build())),sync=vi.fn(async()=>'COMPLETE' as const)
  const params={client,read,sign,sync,observed:structuredClone(f.snapshot),getAddress:()=>address},adapter=createMarketBatchListOperationAdapter(params)
  const changeEvents=(change:(rows:any[])=>void)=>{ledger.events=marketBatchListEvents(f.record,change);effects.V2.eventsDigest=ledger.events.digest;ledger.effects.bcs.value=bcs.TransactionEffects.serialize(effects).toBytes()}
  return {...f,client,ledger,effects,pkg,params,adapter,read,sign,sync,changeEvents,setAddress:(value:string|null)=>{address=value}}
}
afterEach(()=>vi.useRealTimers())
it('builds one exact SDK packet and preflights every selected row without a wallet prompt',async()=>{
  const f=await fixture(),record=await f.adapter.prepare()
  expect(record.bytes).toBe(f.record.bytes);await f.adapter.preflight(record,true)
  expect(f.read.mock.calls[0][0]).toEqual(f.snapshot.rows.map(({snapshot:s,priceAtomic})=>({soulId:s.soulId,stateId:s.stateId,priceAtomic})))
  expect(f.sign).not.toHaveBeenCalled()
})
it.each(['price','order','row','epoch','revision','removal','equipment-gate','market-gate','owner','runtime','wallet'])(
  'rejects any selected %s change before signing or rebroadcast',async reason=>{
    const f=await fixture(),row=f.snapshot.rows[1],s=row.snapshot
    if(reason==='price')row.priceAtomic='1';if(reason==='order')f.snapshot.rows.reverse();if(reason==='row')f.snapshot.rows.pop()
    if(reason==='epoch')s.ownershipEpoch='4';if(reason==='revision')s.equipmentSale!.scope.expectedRevision='10'
    if(reason==='removal')s.equipmentSale!.removals.pop();if(reason==='equipment-gate')s.equipmentSale!.writesEnabled=false
    if(reason==='market-gate')s.listAvailable=false;if(reason==='owner')s.owner=lid(999)
    if(reason==='runtime')s.equipmentSale!.runtimeCallableDigest=f.record.digest;if(reason==='wallet')f.setAddress(null)
    await expect(f.adapter.prepare()).rejects.toThrow();await expect(f.adapter.preflight(f.record,false)).rejects.toThrow();expect(f.sign).not.toHaveBeenCalled()
  })
it('queries complete historical receipts when wallet, flags and live equipment are unavailable',async()=>{
  const f=await fixture();f.setAddress(null);f.read.mockRejectedValue(new Error('offline'))
  const proof=await queryMarketBatchListOperationEvidence(f.record,f.client)
  expect(proof.status).toBe('SUCCEEDED')
  if(proof.status==='SUCCEEDED')expect(proof.receipts.map(row=>row.price)).toEqual(['10001','20002'])
  expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
})
it.each(['missing','extra','duplicate','order','soul','price','seller','kiosk','listing-alias','authority','type-param','cancel'])(
  'rejects incomplete or substituted receipt set: %s',async reason=>{
    const f=await fixture()
    f.changeEvents(events=>{
      if(reason==='missing')events.pop();if(reason==='extra'||reason==='duplicate')events.push(events[0]);if(reason==='order')events.reverse()
      if(reason==='authority')events[1].sender=lid(999);if(reason==='type-param')events[1].type_.typeParams=[{u8:true}]
      if(reason==='cancel')events.push({...events[0],type_:{...events[0].type_,name:'SoulListingCancelled'}})
      if(['soul','price','seller','kiosk','listing-alias'].includes(reason)){
        const v=listedReceiptBcs.parse(Uint8Array.from(events[1].contents))
        if(reason==='soul')v.soul_id=lid(999);if(reason==='price')v.price='1';if(reason==='seller')v.seller=lid(999);if(reason==='kiosk')v.kiosk_id=lid(999)
        if(reason==='listing-alias')v.listing_id=lid(300)
        events[1].contents=Array.from(listedReceiptBcs.serialize(v).toBytes())
      }
    })
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
it.each(['bytes','digest','effects','events','package','origin','chain'])('rejects historical evidence substitution: %s',async reason=>{
  const f=await fixture()
  if(reason==='bytes')f.ledger.transaction.bcs.value=new Uint8Array([1])
  if(reason==='digest')f.ledger.digest=lid(999)
  if(reason==='effects')f.ledger.effects.status.success=false
  if(reason==='events')f.ledger.events.digest=f.record.digest
  if(reason==='package')f.pkg.digest=f.record.digest
  if(reason==='origin')f.pkg.package.typeOrigins[0].packageId=lid(999)
  if(reason==='chain')f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId:'35834a8a'}})
  await expect(f.adapter.query(f.record)).rejects.toThrow()
})
it('pending and failure are not partial success and require no receipt replay',async()=>{
  const f=await fixture();f.ledger.checkpoint=undefined
  expect(await f.adapter.query(f.record)).toBe('PENDING')
  f.ledger.checkpoint=2n;f.effects.V2.status={Failure:{error:{InsufficientGas:true},command:0}};f.effects.V2.eventsDigest=null
  f.ledger.effects.bcs.value=bcs.TransactionEffects.serialize(f.effects).toBytes();f.ledger.effects.status.success=false;delete f.ledger.events
  expect(await f.adapter.query(f.record)).toBe('FAILED');expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
