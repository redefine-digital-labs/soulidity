import { afterEach,expect,it,vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs,Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { createMarketBuyOperationAdapter } from '../../web/lib/animacraft/market-buy-operation-adapter'
import { runMarketBuyOperation,type MarketBuySnapshot,type MarketBuyOperationRecord } from '../../web/lib/animacraft/market-buy-operation'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { marketBuyFixture,marketBuyEventEvidence,buySigner,bid,buyCoinBcs } from './fixtures/market-buy-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
async function fixture(options:{newKiosk?:boolean;balances?:string[]}={}){
  const f=await marketBuyFixture(options);let address:string|null=f.snapshot.buyer
  const event=marketBuyEventEvidence(f.record);const checkpoint=marketCancelCheckpointFixture()
  const effects=(success=true,digest=f.record.digest)=>bcs.TransactionEffects.serialize({V2:{status:success?{Success:true}:{Failure:{error:{InsufficientGas:true},command:0}},
    executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},transactionDigest:digest,
    gasObjectIndex:null,eventsDigest:success?event.digest:null,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
  const ledger={digest:f.record.digest,transaction:{digest:f.record.digest,bcs:{value:f.bytes}},effects:{transactionDigest:f.record.digest,bcs:{value:effects()},status:{success:true}},
    events:event,checkpoint:0n as bigint|undefined}
  const pkg={objectId:f.snapshot.release.soulidityCallablePackageId,version:2n,digest:f.snapshot.release.soulidityCallableDigest,owner:{kind:4},
    package:{storageId:f.snapshot.release.soulidityCallablePackageId,originalId:f.snapshot.release.soulidityOriginalPackageId,version:2n,
      typeOrigins:[{moduleName:'market',datatypeName:'AnimacraftV8SoulPurchased',packageId:f.snapshot.release.soulidityOriginalPackageId}]}}
  const pages:Array<{objects:Array<{objectId:string}>,nextPageToken?:Uint8Array}>=[{objects:f.paymentCoins.map(c=>({objectId:c.objectId}))}]
  const client={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),getEpoch:vi.fn(async()=>({response:{epoch:{epoch:9n}}})),
    getTransaction:vi.fn(async()=>({response:{transaction:ledger}})),getCheckpoint:vi.fn(async()=>({response:{checkpoint:checkpoint.checkpoint}})),
    getObject:vi.fn(async(request:{objectId:string})=>({response:{object:request.objectId===pkg.objectId?pkg:f.objects.get(request.objectId)}}))},
    stateService:{listOwnedObjects:vi.fn(async(request:{pageToken?:Uint8Array})=>({response:pages[request.pageToken?.[0]??0]}))},
    core:{executeTransaction:vi.fn(async()=>({})),resolveTransactionPlugin:()=>async(data:any,_options:any,next:()=>Promise<void>)=>{
      data.inputs=data.inputs.map((input:any)=>{
        if(!input.UnresolvedObject)return input
        const id=input.UnresolvedObject.objectId
        return id===f.snapshot.bindingId||id===f.snapshot.buyerKioskCapId
          ?Inputs.ObjectRef({objectId:id,version:'2',digest:f.snapshot.release.soulidityCallableDigest})
          :Inputs.SharedObjectRef({objectId:id,initialSharedVersion:'1',mutable:![f.snapshot.release.marketConfigV2Id,f.snapshot.release.soulTransferPolicyId].includes(id)})
      });data.gasData=f.tx.getData().gasData;await next()
    }}}
  const read=vi.fn(async(_listing?:string)=>f.snapshot)
  const sign=vi.fn(async(tx:Transaction)=>buySigner.signTransaction(await tx.build()))
  const sync=vi.fn(async(_record:MarketBuyOperationRecord):Promise<'COMPLETE'|'SUPERSEDED'>=>'COMPLETE')
  const observed=structuredClone(f.snapshot)
  const params={client:client as any,read,observed,getAddress:()=>address,sign,sync}
  const adapter=createMarketBuyOperationAdapter(params)
  return {...f,client,adapter,params,pages,event,ledger,pkg,effects,checkpoint,read,sign,sync,observed,setAddress:(value:string|null)=>{address=value}}
}
afterEach(()=>vi.useRealTimers())
it.each([{newKiosk:false,balances:['1200000']},{newKiosk:false,balances:['600000','500000']},
  {newKiosk:true,balances:['1200000']},{newKiosk:true,balances:['600000','500000']}])
  ('prepares and preflights actual SDK bytes newKiosk=$newKiosk payment=$balances',async options=>{
    const f=await fixture(options);const prepared=await f.adapter.prepare()
    expect(prepared.bytes).toBe(f.record.bytes);expect(prepared.digest).toBe(f.record.digest)
    await f.adapter.preflight(prepared,true);await f.adapter.preflight(prepared,false)
    expect(f.read.mock.calls).toEqual(Array(3).fill([f.snapshot.listingId]));expect(f.sign).not.toHaveBeenCalled()
    expect(f.client.stateService.listOwnedObjects).toHaveBeenCalledTimes(1)
  })
it('uses actual paginated owned coin discovery and exact BCS balances rather than list JSON balances',async()=>{
  const f=await fixture();f.pages.splice(0,1,{objects:[{objectId:f.paymentCoins[0].objectId}],nextPageToken:new Uint8Array([1])},
    {objects:[{objectId:f.paymentCoins[1].objectId,balance:'999999999999999'} as any]})
  const result=await f.adapter.prepare();expect(result.bytes).toBe(f.record.bytes)
  expect(f.client.stateService.listOwnedObjects).toHaveBeenCalledTimes(2)
  const request=f.client.stateService.listOwnedObjects.mock.calls[1][0] as any
  expect(request).toMatchObject({owner:f.snapshot.buyer,pageSize:20,objectType:`0x2::coin::Coin<${f.snapshot.release.paymentCoinType}>`,pageToken:new Uint8Array([1])})
})
it('skips a genuinely empty BCS coin without adding it to payment',async()=>{
  const f=await fixture({balances:['1200000']});const zero={...f.objects.values().next().value!,objectId:bid(90),contents:{value:buyCoinBcs.serialize({id:bid(90),balance:'0'}).toBytes()}}
  f.objects.set(bid(90),zero);f.pages[0].objects.unshift({objectId:bid(90)})
  expect((await f.adapter.prepare()).paymentCoins).toHaveLength(1)
})
it('continues beyond 32 verified dust coins to a sufficient larger coin on the next bounded page',async()=>{
  const f=await fixture({balances:['1200000']});const original=f.objects.get(f.paymentCoins[0].objectId)!
  const dust=Array.from({length:32},(_,index)=>{
    const objectId=bid(300+index)
    f.objects.set(objectId,{...original,objectId,contents:{value:buyCoinBcs.serialize({id:objectId,balance:'1'}).toBytes()}})
    return {objectId}
  })
  f.pages.splice(0,1,{objects:dust.slice(0,20),nextPageToken:new Uint8Array([1])},
    {objects:dust.slice(20),nextPageToken:new Uint8Array([2])},{objects:[{objectId:original.objectId}]})
  const prepared=await f.adapter.prepare()
  expect(prepared.paymentCoins).toEqual(f.paymentCoins);expect(prepared.bytes).toBe(f.record.bytes)
  expect(f.client.stateService.listOwnedObjects).toHaveBeenCalledTimes(3);expect(f.sign).not.toHaveBeenCalled()
})
it.each(['wrong-id','owner','shared-owner','type','bcs-id','bcs-trailing','balance','version','digest','duplicate','cursor','page-bound'])
  ('rejects payment discovery/evidence %s without opening a wallet',async problem=>{
    const f=await fixture();const coin=f.objects.get(f.paymentCoins[0].objectId)!
    if(problem==='wrong-id')coin.objectId=bid(999)
    if(problem==='owner')coin.owner.address=bid(999)
    if(problem==='shared-owner')coin.owner.kind=3
    if(problem==='type')coin.objectType='0x2::coin::Coin<0x2::sui::SUI>'
    if(problem==='bcs-id')coin.contents.value=buyCoinBcs.serialize({id:bid(999),balance:'600000'}).toBytes()
    if(problem==='bcs-trailing')coin.contents.value=new Uint8Array([...coin.contents.value,0])
    if(problem==='balance')for(const c of f.objects.values())c.contents.value=buyCoinBcs.serialize({id:c.objectId,balance:'1'}).toBytes()
    if(problem==='version')coin.version=0n
    if(problem==='digest')coin.digest='wrong'
    if(problem==='duplicate')f.pages[0].objects=[f.pages[0].objects[0],f.pages[0].objects[0]]
    if(problem==='cursor')f.pages[0]={objects:[f.pages[0].objects[0]],nextPageToken:new Uint8Array()}
    if(problem==='page-bound')f.pages[0].objects=Array(21).fill(f.pages[0].objects[0])
    await expect(f.adapter.prepare()).rejects.toThrow();expect(f.sign).not.toHaveBeenCalled();expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it('rechecks payment version/digest/balance before signature and saved-byte rebroadcast',async()=>{
  const f=await fixture();const record=await f.adapter.prepare();f.objects.get(f.paymentCoins[0].objectId)!.version=3n
  await expect(f.adapter.preflight(record,true)).rejects.toThrow('coin changed')
  await expect(f.adapter.preflight(record,false)).rejects.toThrow('coin changed')
  expect(await f.adapter.query(record)).toBe('SUCCEEDED')
})
it.each(['price','seller','binding','epoch','listing','creator','maker','rates','recipient','kiosk','cap','protocol','callable','digest','config','registry','policy','kiosk-package','availability','writes','wallet'])
  ('rejects changed quote/custody/target %s before payment and preflight',async problem=>{
    const f=await fixture();const s=f.snapshot
    if(problem==='price')s.priceAtomic='1000001'
    if(problem==='seller')s.seller=bid(999)
    if(problem==='binding')s.bindingId=bid(999)
    if(problem==='epoch')s.ownershipEpoch='4'
    if(problem==='listing')s.listingId=bid(999)
    if(problem==='creator')s.creator=bid(999)
    if(problem==='maker')s.makerCreator=bid(999)
    if(problem==='rates'){s.soulCreatorRoyaltyBps=500;s.makerSourceRoyaltyBps=500}
    if(problem==='recipient')s.protocolFeeRecipient=bid(999)
    if(problem==='kiosk')s.buyerKioskId=bid(999)
    if(problem==='cap')s.buyerKioskCapId=bid(999)
    if(problem==='protocol')s.release.protocolConfigId=bid(999)
    if(problem==='callable')s.release.soulidityCallablePackageId=bid(999)
    if(problem==='digest')s.release.soulidityCallableDigest=f.record.digest
    if(problem==='config')s.release.marketConfigV2Id=bid(999)
    if(problem==='registry')s.release.kioskRegistryId=bid(999)
    if(problem==='policy')s.release.soulTransferPolicyId=bid(999)
    if(problem==='kiosk-package')s.release.kioskPackageId=bid(999)
    if(problem==='availability')s.purchaseAvailable=false
    if(problem==='writes')s.release.writesEnabled=false
    if(problem==='wallet')f.setAddress(null)
    await expect(f.adapter.prepare()).rejects.toThrow();await expect(f.adapter.preflight(f.record,false)).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled();expect(f.client.stateService.listOwnedObjects).not.toHaveBeenCalled()
  })
it('accepts reordered equivalent snapshot fields and captures snapshot identity before asynchronous coin reads',async()=>{
  const f=await fixture()
  const reordered=Object.fromEntries(Object.entries(f.snapshot).reverse()) as unknown as MarketBuySnapshot
  reordered.release=Object.fromEntries(Object.entries(reordered.release).reverse()) as MarketBuySnapshot['release']
  f.read.mockResolvedValue(reordered)
  expect((await f.adapter.prepare()).bytes).toBe(f.record.bytes)
  f.client.ledgerService.getEpoch.mockImplementation(async()=>{reordered.priceAtomic='2';f.observed.priceAtomic='3';return{response:{epoch:{epoch:9n}}}})
  expect((await f.adapter.prepare()).bytes).toBe(f.record.bytes)
})
it('readonly self-owner and missing observed snapshot cannot prepare a purchase',async()=>{
  const f=await fixture();const self={...f.snapshot,buyer:f.snapshot.seller,buyerKioskId:f.snapshot.sellerKioskId,purchaseAvailable:false}
  await expect(createMarketBuyOperationAdapter({...f.params,observed:self,read:async()=>self}).prepare()).rejects.toThrow('unavailable')
  await expect(createMarketBuyOperationAdapter({...f.params,observed:undefined}).prepare()).rejects.toThrow('Refresh')
})
it.each(['35834a8a','4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6T'])('requires exact full Mainnet genesis, not %s',async chainId=>{
  const f=await fixture();f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId}})
  await expect(f.adapter.prepare()).rejects.toThrow('Mainnet');await expect(f.adapter.query(f.record)).rejects.toThrow('Mainnet')
  await expect(f.adapter.expiryCheckpoint(f.record)).rejects.toThrow('Mainnet')
})
it('verifies full native receipt BCS/floor payouts and remains queryable after buyer wallet or live write service changes',async()=>{
  const f=await fixture();f.setAddress(null);f.read.mockRejectedValue(new Error('live service unavailable'))
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
  const record={...f.record,phase:'SUCCEEDED' as const,syncStatus:'PENDING' as const}
  expect(await f.adapter.sync(record)).toBe('COMPLETE');expect(f.read).not.toHaveBeenCalled();expect(f.client.stateService.listOwnedObjects).not.toHaveBeenCalled()
  f.ledger.effects.bcs.value=f.effects(false);f.ledger.effects.status.success=false
  expect(await f.adapter.query(f.record)).toBe('FAILED');f.ledger.checkpoint=undefined;expect(await f.adapter.query(f.record)).toBe('PENDING')
})
it.each(['listing_id','soul_id','provenance_id','seller','buyer','maker_source_recipient','price','seller_payout','protocol_fee','soul_creator_royalty_bps',
  'soul_creator_royalty','maker_source_royalty_bps','maker_source_royalty'])('rejects altered canonical native purchase receipt %s',async field=>{
    const f=await fixture();Object.assign(f.event,marketBuyEventEvidence(f.record,receipt=>{
      receipt[field]=field.endsWith('_bps')?0:['listing_id','soul_id','provenance_id','seller','buyer','maker_source_recipient'].includes(field)?bid(999):'1'
    }));f.ledger.effects.bcs.value=f.effects()
    await expect(f.adapter.query(f.record)).rejects.toThrow('receipt identity')
  })
it.each(['digest','bytes','effects-digest','status','checkpoint','package-digest','package-origin','type-origin','events-hash','events-trailing','metadata-soul'])
  ('rejects ledger/record substitution %s',async problem=>{
    const f=await fixture();const record=structuredClone(f.record)
    if(problem==='digest')f.ledger.transaction.digest='wrong'
    if(problem==='bytes')f.ledger.transaction.bcs.value=new Uint8Array([1])
    if(problem==='effects-digest')f.ledger.effects.bcs.value=f.effects(true,f.snapshot.release.soulidityCallableDigest)
    if(problem==='status')f.ledger.effects.status.success=false
    if(problem==='checkpoint')f.ledger.checkpoint=-1n
    if(problem==='package-digest')f.pkg.digest=f.record.digest
    if(problem==='package-origin')f.pkg.package.originalId=bid(999)
    if(problem==='type-origin')f.pkg.package.typeOrigins[0].packageId=bid(999)
    if(problem==='events-hash')f.event.digest=f.record.digest
    if(problem==='events-trailing')f.event.bcs.value=new Uint8Array([...f.event.bcs.value,0])
    if(problem==='metadata-soul'){record.snapshot.soulId=bid(999);record.phase='SUCCEEDED';record.syncStatus='COMPLETE'}
    await expect(f.adapter.query(record)).rejects.toThrow()
  })
it('only exact NOT_FOUND is missing, and expiry uses executed checkpoint not current epoch',async()=>{
  const f=await fixture();f.client.ledgerService.getTransaction.mockRejectedValueOnce({code:'NOT_FOUND'})
  expect(await f.adapter.query(f.record)).toBe('MISSING')
  f.client.ledgerService.getTransaction.mockRejectedValueOnce(new Error('NOT_FOUND'))
  await expect(f.adapter.query(f.record)).rejects.toThrow('NOT_FOUND')
  expect(await f.adapter.expiryCheckpoint(f.record)).toEqual(f.checkpoint.evidence)
  f.client.ledgerService.getCheckpoint.mockResolvedValue({response:{checkpoint:marketCancelCheckpointFixture('10').checkpoint}})
  await expect(f.adapter.expiryCheckpoint(f.record)).rejects.toThrow('strictly later')
  f.client.ledgerService.getEpoch.mockResolvedValue({response:{epoch:{epoch:11n}}})
  await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('expired')
})
it('verifies actual buyer signature and only broadcasts exact persisted payment bytes',async()=>{
  const f=await fixture();const signed=await f.adapter.sign(f.record)
  const record={...f.record,phase:'SIGNED' as const,signature:signed.signature};await f.adapter.verifySignature(record);await f.adapter.broadcast(record)
  expect(f.client.core.executeTransaction).toHaveBeenCalledWith({transaction:f.bytes,signatures:[signed.signature],signal:expect.any(AbortSignal)})
  const retired={...record,phase:'RETIRED' as const,retirement:{priorPhase:'SIGNED' as const,checkpoint:f.checkpoint.evidence}}
  await expect(f.adapter.sign(retired)).rejects.toThrow();await expect(f.adapter.broadcast(retired)).rejects.toThrow()
  expect(await f.adapter.query(retired)).toBe('SUCCEEDED')
})
it.each(['chain','discovery','coin','build','sign','broadcast','query','sync','checkpoint'] as const)
  ('bounds hanging %s and ignores late results rather than making another payment',async operation=>{
    const f=await fixture();let resolve!:(value:any)=>void;const pending=new Promise<any>(done=>{resolve=done});vi.useFakeTimers()
    let work:Promise<unknown>
    if(operation==='chain'){f.client.ledgerService.getServiceInfo.mockReturnValue(pending);work=f.adapter.query(f.record)}
    else if(operation==='discovery'){f.client.stateService.listOwnedObjects.mockReturnValue(pending);work=f.adapter.prepare()}
    else if(operation==='coin'){f.client.ledgerService.getObject.mockReturnValue(pending);work=f.adapter.prepare()}
    else if(operation==='build'){f.client.core.resolveTransactionPlugin=()=>async()=>pending;work=f.adapter.prepare()}
    else if(operation==='sign'){f.sign.mockReturnValue(pending);work=f.adapter.sign(f.record)}
    else if(operation==='broadcast'){f.client.core.executeTransaction.mockReturnValue(pending);work=f.adapter.broadcast({...f.record,phase:'SIGNED',signature:(await buySigner.signTransaction(f.bytes)).signature})}
    else if(operation==='query'){f.client.ledgerService.getTransaction.mockReturnValue(pending);work=f.adapter.query(f.record)}
    else if(operation==='checkpoint'){f.client.ledgerService.getCheckpoint.mockReturnValue(pending);work=f.adapter.expiryCheckpoint(f.record)}
    else {f.sync.mockReturnValue(pending);work=f.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})}
    const assertion=expect(work).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(operation==='sign'?120001:25001);await assertion
    expect(vi.getTimerCount()).toBe(0);resolve({});await vi.advanceTimersByTimeAsync(0)
    expect(f.client.core.executeTransaction).toHaveBeenCalledTimes(operation==='broadcast'?1:0)
  })
it('wallet timeout releases journal lock, keeps SIGNING and never sends its late valid purchase signature',async()=>{
  const f=await fixture();let saved:MarketBuyOperationRecord|null=null;let locked=false;let resolve!:(value:any)=>void
  f.sign.mockReturnValue(new Promise(done=>{resolve=done}));f.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'})
  const store={read:()=>saved,write:(_key:string,r:MarketBuyOperationRecord)=>{saved=structuredClone(r)},archive:vi.fn(),history:()=>[],
    async exclusive<T>(_key:string,work:()=>Promise<T>){if(locked)throw new Error('locked');locked=true;try{return await work()}finally{locked=false}}}
  vi.useFakeTimers();const work=runMarketBuyOperation({soulId:f.snapshot.soulId,owner:f.snapshot.buyer,start:true,store,adapter:f.adapter})
  const assertion=expect(work).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(120001);await assertion
  expect(locked).toBe(false);expect((saved as MarketBuyOperationRecord|null)?.phase).toBe('SIGNING')
  resolve(await buySigner.signTransaction(f.bytes));await vi.advanceTimersByTimeAsync(0);expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
