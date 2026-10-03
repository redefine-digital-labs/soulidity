import { afterEach,expect,it,vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs,Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { createMarketListOperationAdapter } from '../../web/lib/animacraft/market-list-operation-adapter'
import { runMarketListOperation,type MarketListSnapshot,type MarketListOperationRecord } from '../../web/lib/animacraft/market-list-operation'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { marketListFixture,marketListEventEvidence,listSigner,lid,listedReceiptBcs,cancelledReceiptBcs } from './fixtures/market-list-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
async function fixture(options:{kind?:'list'|'reprice';priceAtomic?:string;equipped?:boolean}={}){
  const f=await marketListFixture(options);let address:string|null=f.snapshot.owner
  const event=marketListEventEvidence(f.record);const checkpoint=marketCancelCheckpointFixture()
  const effects=(success=true,digest=f.record.digest)=>bcs.TransactionEffects.serialize({V2:{status:success?{Success:true}:{Failure:{error:{InsufficientGas:true},command:0}},
    executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},transactionDigest:digest,
    gasObjectIndex:null,eventsDigest:success?event.digest:null,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
  const ledger={digest:f.record.digest,transaction:{digest:f.record.digest,bcs:{value:f.bytes}},effects:{transactionDigest:f.record.digest,bcs:{value:effects()},status:{success:true}},
    events:event,checkpoint:0n as bigint|undefined}
  const pkg={objectId:f.snapshot.release.soulidityCallablePackageId,version:2n,digest:f.snapshot.release.soulidityCallableDigest,owner:{kind:4},
    package:{storageId:f.snapshot.release.soulidityCallablePackageId,originalId:f.snapshot.release.soulidityOriginalPackageId,version:2n,
      typeOrigins:['SoulListed','SoulListingCancelled'].map(datatypeName=>({moduleName:'market',datatypeName,packageId:f.snapshot.release.soulidityOriginalPackageId}))}}
  const client={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),getEpoch:vi.fn(async()=>({response:{epoch:{epoch:9n}}})),
    getTransaction:vi.fn(async()=>({response:{transaction:ledger}})),getCheckpoint:vi.fn(async()=>({response:{checkpoint:checkpoint.checkpoint}})),
    getObject:vi.fn(async(_request:{objectId:string})=>({response:{object:pkg}}))},
    core:{executeTransaction:vi.fn(async()=>({})),resolveTransactionPlugin:()=>async(data:any,_options:any,next:()=>Promise<void>)=>{
      data.inputs=data.inputs.map((input:any)=>{
        if(!input.UnresolvedObject)return input
        const id=input.UnresolvedObject.objectId
        const plan=f.snapshot.equipmentSale
        const instances=plan?.removals.flatMap(row=>row.kind==='selection'?[]:[row.itemId])??[]
        const readonly=[f.snapshot.release.marketConfigV2Id,...(plan?[plan.scope.target.protocolConfigId,
          plan.definitionRegistryId,plan.baseRegistryId,...plan.packs.map(pack=>pack.releaseId)]:[])]
        return id===f.snapshot.bindingId||id===f.snapshot.kioskCapId||instances.includes(id)
          ?Inputs.ObjectRef({objectId:id,version:'2',digest:f.snapshot.release.soulidityCallableDigest})
          :Inputs.SharedObjectRef({objectId:id,initialSharedVersion:'1',mutable:!readonly.includes(id)})
      });data.gasData=f.tx.getData().gasData;await next()
    }}}
  const read=vi.fn(async(_listing?:string,_cap?:string)=>f.snapshot)
  const sign=vi.fn(async(tx:Transaction)=>listSigner.signTransaction(await tx.build()))
  const sync=vi.fn(async(_record:MarketListOperationRecord):Promise<'COMPLETE'|'SUPERSEDED'>=>'COMPLETE')
  const observed=structuredClone(f.snapshot)
  const params={client:client as any,read,observed,intent:f.kind,priceAtomic:BigInt(f.priceAtomic),getAddress:()=>address,sign,sync}
  const adapter=createMarketListOperationAdapter(params)
  return {...f,client,adapter,params,event,ledger,pkg,effects,checkpoint,read,sign,sync,observed,setAddress:(value:string|null)=>{address=value}}
}
afterEach(()=>vi.useRealTimers())
it('prepares and recovers exact equipped-Soul removal/listing bytes without re-reading live equipment on query',async()=>{
  const f=await fixture({equipped:true});const prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe(f.record.bytes)
  await f.adapter.preflight(prepared,true)
  expect(prepared.snapshot.equipmentSale).toEqual(f.snapshot.equipmentSale)
  f.read.mockClear();f.read.mockRejectedValue(new Error('later owner or offline equipment'))
  f.setAddress(null)
  expect(await f.adapter.query(prepared)).toBe('SUCCEEDED')
  expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
})
it.each(['revision','removals','runtime digest','equipment writes'])(
  'rejects changed equipped sale %s before signing',async problem=>{
    const f=await fixture({equipped:true});const plan=f.snapshot.equipmentSale!
    if(problem==='revision')plan.scope.expectedRevision=String(BigInt(plan.scope.expectedRevision)+1n)
    if(problem==='removals')plan.removals=plan.removals.slice(1)
    if(problem==='runtime digest')plan.runtimeCallableDigest=f.record.digest
    if(problem==='equipment writes')plan.writesEnabled=false
    await expect(f.adapter.prepare()).rejects.toThrow()
    await expect(f.adapter.preflight(f.record,true)).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled()
  })
it.each(['list','reprice'] as const)('prepares/preflights/queries actual SDK %s using saved listing and cap hints',async kind=>{
  const f=await fixture({kind});const prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe(f.record.bytes);expect(prepared.digest).toBe(f.record.digest)
  await f.adapter.preflight(prepared,true);await f.adapter.preflight(prepared,false)
  expect(f.read.mock.calls).toEqual(Array(3).fill([f.snapshot.listingId??undefined,f.snapshot.kioskCapId]))
  expect(await f.adapter.query(prepared)).toBe('SUCCEEDED');expect(f.sign).not.toHaveBeenCalled()
})
it.each(['price','owner','binding','epoch','listing','creator','maker','rates','recipient','kiosk','cap','protocol','callable','digest','config','registry','policy','kiosk-package','availability','writes','wallet','equipment'])
  ('rejects changed listing/custody/target %s before wallet',async problem=>{
    const f=await fixture({kind:'reprice'});const s=f.snapshot
    if(problem==='price')s.priceAtomic='1'
    if(problem==='owner')s.owner=lid(999)
    if(problem==='binding')s.bindingId=lid(999)
    if(problem==='epoch')s.ownershipEpoch='4'
    if(problem==='listing')s.listingId=lid(999)
    if(problem==='creator')s.creator=lid(999)
    if(problem==='maker')s.makerCreator=lid(999)
    if(problem==='rates'){s.soulCreatorRoyaltyBps=500;s.makerSourceRoyaltyBps=500}
    if(problem==='recipient')s.protocolFeeRecipient=lid(999)
    if(problem==='kiosk')s.kioskId=lid(999)
    if(problem==='cap')s.kioskCapId=lid(999)
    if(problem==='protocol')s.release.protocolConfigId=lid(999)
    if(problem==='callable')s.release.soulidityCallablePackageId=lid(999)
    if(problem==='digest')s.release.soulidityCallableDigest=f.record.digest
    if(problem==='config')s.release.marketConfigV2Id=lid(999)
    if(problem==='registry')s.release.kioskRegistryId=lid(999)
    if(problem==='policy')s.release.soulTransferPolicyId=lid(999)
    if(problem==='kiosk-package')s.release.kioskPackageId=lid(999)
    if(problem==='availability')s.repriceAvailable=false
    if(problem==='writes')s.release.writesEnabled=false
    if(problem==='wallet')f.setAddress(null)
    if(problem==='equipment'){s.equipmentId=lid(999);s.repriceAvailable=false}
    await expect(f.adapter.prepare()).rejects.toThrow();await expect(f.adapter.preflight(f.record,false)).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled()
  })
it.each(['intent','price','observed','zero','overflow'])('requires explicit valid observed intent/price (%s)',async missing=>{
  const f=await fixture()
  const patch=missing==='intent'?{intent:undefined}:missing==='observed'?{observed:undefined}:missing==='zero'?{priceAtomic:0n}
    :missing==='overflow'?{priceAtomic:18446744073709551616n}:{priceAtomic:undefined}
  await expect(createMarketListOperationAdapter({...f.params,...patch}).prepare()).rejects.toThrow('Refresh')
})
it('captures caller intent/price and accepts reordered equivalent snapshot properties',async()=>{
  const f=await fixture()
  const reordered=Object.fromEntries(Object.entries(f.snapshot).reverse()) as unknown as MarketListSnapshot
  reordered.release=Object.fromEntries(Object.entries(reordered.release).reverse()) as MarketListSnapshot['release']
  f.read.mockResolvedValue(reordered)
  f.params.priceAtomic=2n;f.params.intent='reprice';f.observed.listAvailable=false
  expect((await f.adapter.prepare()).bytes).toBe(f.record.bytes)
})
it.each(['35834a8a','4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6T'])('rejects incorrect mainnet genesis %s',async chainId=>{
  const f=await fixture();f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId}})
  await expect(f.adapter.prepare()).rejects.toThrow('Mainnet');await expect(f.adapter.query(f.record)).rejects.toThrow('Mainnet')
  await expect(f.adapter.expiryCheckpoint(f.record)).rejects.toThrow('Mainnet')
})
it('queries and synchronizes after wallet/live service changes; failure/pending needs no receipt',async()=>{
  const f=await fixture();f.setAddress(null);f.read.mockRejectedValue(new Error('unavailable'))
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
  expect(await f.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})).toBe('COMPLETE')
  expect(f.read).not.toHaveBeenCalled()
  f.ledger.effects.bcs.value=f.effects(false);f.ledger.effects.status.success=false
  expect(await f.adapter.query(f.record)).toBe('FAILED');f.ledger.checkpoint=undefined;expect(await f.adapter.query(f.record)).toBe('PENDING')
})
it.each(['listing_id','soul_id','seller','kiosk_id','price'])('rejects substituted exact SoulListed %s',async field=>{
  const f=await fixture()
  Object.assign(f.event,marketListEventEvidence(f.record,events=>{
    const event=events.at(-1);const receipt:any=listedReceiptBcs.parse(Uint8Array.from(event.contents))
    receipt[field]=field==='price'?'1':field==='listing_id'?lid(0):lid(999)
    event.contents=Array.from(listedReceiptBcs.serialize(receipt).toBytes())
  }));f.ledger.effects.bcs.value=f.effects()
  await expect(f.adapter.query(f.record)).rejects.toThrow('receipt identity')
})
it.each(['missing','duplicate','wrong-old-id','wrong-soul','wrong-seller','old-is-new','order','sender','type-origin','type-params','package','module','trailing'])
 ('rejects incorrect atomic reprice receipts %s',async problem=>{
  const f=await fixture({kind:'reprice'})
  Object.assign(f.event,marketListEventEvidence(f.record,events=>{
    const old=events[0];const fresh=events[1]
    if(problem==='missing')events.shift()
    if(problem==='duplicate')events.unshift(structuredClone(old))
    if(problem==='order')events.reverse()
    if(problem==='sender')old.sender=lid(999)
    if(problem==='type-origin')old.type_.address=lid(999)
    if(problem==='type-params')old.type_.typeParams=[{u64:true}]
    if(problem==='package')old.package_id=lid(999)
    if(problem==='module')old.transaction_module='other'
    if(problem==='trailing')old.contents.push(0)
    if(problem.startsWith('wrong-')){
      const value=cancelledReceiptBcs.parse(Uint8Array.from(old.contents))
      if(problem==='wrong-old-id')value.listing_id=lid(999)
      if(problem==='wrong-soul')value.soul_id=lid(999)
      if(problem==='wrong-seller')value.seller=lid(999)
      old.contents=Array.from(cancelledReceiptBcs.serialize(value).toBytes())
    }
    if(problem==='old-is-new'){const value=listedReceiptBcs.parse(Uint8Array.from(fresh.contents));value.listing_id=f.snapshot.listingId!
      fresh.contents=Array.from(listedReceiptBcs.serialize(value).toBytes())}
  }));f.ledger.effects.bcs.value=f.effects()
  await expect(f.adapter.query(f.record)).rejects.toThrow()
 })
it.each(['duplicate','sender','package','module','type-origin','type-params','trailing','unexpected-cancel'])
 ('rejects incorrect list event %s',async problem=>{
  const f=await fixture()
  Object.assign(f.event,marketListEventEvidence(f.record,events=>{
    const event=events[0]
    if(problem==='duplicate')events.push(structuredClone(event))
    if(problem==='sender')event.sender=lid(999)
    if(problem==='package')event.package_id=lid(999)
    if(problem==='module')event.transaction_module='other'
    if(problem==='type-origin')event.type_.address=lid(999)
    if(problem==='type-params')event.type_.typeParams=[{u64:true}]
    if(problem==='trailing')event.contents.push(0)
    if(problem==='unexpected-cancel')events.push({...event,type_:{...event.type_,name:'SoulListingCancelled'},
      contents:Array.from(cancelledReceiptBcs.serialize({listing_id:lid(24),soul_id:f.snapshot.soulId,seller:f.snapshot.owner}).toBytes())})
  }));f.ledger.effects.bcs.value=f.effects();await expect(f.adapter.query(f.record)).rejects.toThrow()
 })
it.each(['digest','bytes','effects-digest','status','checkpoint','package-digest','package-origin','type-origin','events-hash','events-trailing','metadata-soul',
  'package-versions-missing','package-versions-zero','package-versions-string','package-version-mismatch'])
  ('rejects ledger/record substitution %s',async problem=>{
    const f=await fixture();const record=structuredClone(f.record)
    if(problem==='digest')f.ledger.transaction.digest='wrong'
    if(problem==='bytes')f.ledger.transaction.bcs.value=new Uint8Array([1])
    if(problem==='effects-digest')f.ledger.effects.bcs.value=f.effects(true,f.snapshot.release.soulidityCallableDigest)
    if(problem==='status')f.ledger.effects.status.success=false
    if(problem==='checkpoint')f.ledger.checkpoint=-1n
    if(problem==='package-digest')f.pkg.digest=f.record.digest
    if(problem==='package-versions-missing'){(f.pkg as any).version=undefined;(f.pkg.package as any).version=undefined}
    if(problem==='package-versions-zero'){f.pkg.version=0n;f.pkg.package.version=0n}
    if(problem==='package-versions-string'){(f.pkg as any).version='2';(f.pkg.package as any).version='2'}
    if(problem==='package-version-mismatch')f.pkg.package.version=3n
    if(problem==='package-origin')f.pkg.package.originalId=lid(999)
    if(problem==='type-origin')f.pkg.package.typeOrigins[0].packageId=lid(999)
    if(problem==='events-hash')f.event.digest=f.record.digest
    if(problem==='events-trailing')f.event.bcs.value=new Uint8Array([...f.event.bcs.value,0])
    if(problem==='metadata-soul'){record.snapshot.soulId=lid(999);record.phase='SUCCEEDED';record.syncStatus='COMPLETE'}
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
it('verifies actual seller signature and only broadcasts exact persisted listing bytes',async()=>{
  const f=await fixture();const signed=await f.adapter.sign(f.record)
  const record={...f.record,phase:'SIGNED' as const,signature:signed.signature};await f.adapter.verifySignature(record);await f.adapter.broadcast(record)
  expect(f.client.core.executeTransaction).toHaveBeenCalledWith({transaction:f.bytes,signatures:[signed.signature],signal:expect.any(AbortSignal)})
  const retired={...record,phase:'RETIRED' as const,retirement:{priorPhase:'SIGNED' as const,checkpoint:f.checkpoint.evidence}}
  await expect(f.adapter.sign(retired)).rejects.toThrow();await expect(f.adapter.broadcast(retired)).rejects.toThrow()
  expect(await f.adapter.query(retired)).toBe('SUCCEEDED')
})
it.each(['chain','read','epoch','package','build','sign','broadcast','query','sync','checkpoint'] as const)
  ('bounds hanging %s and ignores late results rather than submitting another listing',async operation=>{
    const f=await fixture();let resolve!:(value:any)=>void;const pending=new Promise<any>(done=>{resolve=done});vi.useFakeTimers()
    let work:Promise<unknown>
    if(operation==='chain'){f.client.ledgerService.getServiceInfo.mockReturnValue(pending);work=f.adapter.query(f.record)}
    else if(operation==='read'){f.read.mockReturnValue(pending);work=f.adapter.prepare()}
    else if(operation==='epoch'){f.client.ledgerService.getEpoch.mockReturnValue(pending);work=f.adapter.prepare()}
    else if(operation==='package'){f.client.ledgerService.getObject.mockReturnValue(pending);work=f.adapter.query(f.record)}
    else if(operation==='build'){f.client.core.resolveTransactionPlugin=()=>async()=>pending;work=f.adapter.prepare()}
    else if(operation==='sign'){f.sign.mockReturnValue(pending);work=f.adapter.sign(f.record)}
    else if(operation==='broadcast'){f.client.core.executeTransaction.mockReturnValue(pending);work=f.adapter.broadcast({...f.record,phase:'SIGNED',signature:(await listSigner.signTransaction(f.bytes)).signature})}
    else if(operation==='query'){f.client.ledgerService.getTransaction.mockReturnValue(pending);work=f.adapter.query(f.record)}
    else if(operation==='checkpoint'){f.client.ledgerService.getCheckpoint.mockReturnValue(pending);work=f.adapter.expiryCheckpoint(f.record)}
    else {f.sync.mockReturnValue(pending);work=f.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})}
    const assertion=expect(work).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(operation==='sign'?120001:25001);await assertion
    expect(vi.getTimerCount()).toBe(0);resolve({});await vi.advanceTimersByTimeAsync(0)
    expect(f.client.core.executeTransaction).toHaveBeenCalledTimes(operation==='broadcast'?1:0)
  })
it('wallet timeout releases journal lock, keeps SIGNING and never sends its late valid listing signature',async()=>{
  const f=await fixture();let saved:MarketListOperationRecord|null=null;let locked=false;let resolve!:(value:any)=>void
  f.sign.mockReturnValue(new Promise(done=>{resolve=done}));f.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'})
  const store={read:()=>saved,write:(_key:string,r:MarketListOperationRecord)=>{saved=structuredClone(r)},archive:vi.fn(),history:()=>[],
    async exclusive<T>(_key:string,work:()=>Promise<T>){if(locked)throw new Error('locked');locked=true;try{return await work()}finally{locked=false}}}
  vi.useFakeTimers();const work=runMarketListOperation({soulId:f.snapshot.soulId,owner:f.snapshot.owner,start:true,store,adapter:f.adapter})
  const assertion=expect(work).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(120001);await assertion
  expect(locked).toBe(false);expect((saved as MarketListOperationRecord|null)?.phase).toBe('SIGNING')
  resolve(await listSigner.signTransaction(f.bytes));await vi.advanceTimersByTimeAsync(0);expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
