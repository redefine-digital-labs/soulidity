import { afterEach,expect,it,vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction,TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64,toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { runMarketBuyOperation,validateMarketBuyOperationRecord,validateMarketBuySnapshot,queryMarketBuyHistory,browserMarketBuyOperationStore,
  marketBuyOperationKey,type MarketBuyOperationRecord,type MarketBuyOperationStore } from '../../web/lib/animacraft/market-buy-operation'
import { marketBuyFixture,buySigner,bid } from './fixtures/market-buy-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
async function fixture(){
  const f=await marketBuyFixture();let saved:MarketBuyOperationRecord|null=null;let submitted=false;let locked=false
  const history=new Map<string,MarketBuyOperationRecord>();const events:string[]=[]
  const store:MarketBuyOperationStore={read:()=>structuredClone(saved),write:vi.fn((_k,r)=>{events.push(`save:${r.phase}:${r.syncStatus??''}`);saved=structuredClone(r)}),
    archive:vi.fn((_k,r)=>{events.push('archive');if(history.has(r.digest))expect(history.get(r.digest)).toEqual(r);else history.set(r.digest,structuredClone(r))}),
    history:()=>[...history.values()].map(r=>structuredClone(r)),
    async exclusive(_key,work){if(locked)throw new Error('locked');locked=true;try{return await work()}finally{locked=false}}}
  const adapter={prepare:vi.fn(async()=>{events.push('prepare');return structuredClone(f.record)}),
    query:vi.fn(async(_r:MarketBuyOperationRecord):Promise<'MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'>=>{events.push('query');return submitted?'SUCCEEDED':'MISSING'}),
    preflight:vi.fn(async(_r:MarketBuyOperationRecord,_signing:boolean)=>{}),
    sign:vi.fn(async(r:MarketBuyOperationRecord)=>{events.push('sign');return buySigner.signTransaction(fromBase64(r.bytes))}),
    verifySignature:vi.fn(async(r:MarketBuyOperationRecord)=>{await verifyTransactionSignature(fromBase64(r.bytes),r.signature!,{address:r.snapshot.buyer})}),
    broadcast:vi.fn(async(_r:MarketBuyOperationRecord)=>{events.push('broadcast');submitted=true}),
    sync:vi.fn(async(_r:MarketBuyOperationRecord):Promise<'COMPLETE'|'SUPERSEDED'>=>{events.push('sync');return 'COMPLETE'}),
    expiryCheckpoint:vi.fn(async(_r:MarketBuyOperationRecord)=>marketCancelCheckpointFixture().evidence)}
  return {...f,store,adapter,history,events,params:{soulId:f.snapshot.soulId,owner:f.snapshot.buyer,store,adapter},saved:()=>structuredClone(saved),
    setSaved:(r:MarketBuyOperationRecord)=>{saved=structuredClone(r)},setSubmitted:(v:boolean)=>{submitted=v}}
}
afterEach(()=>vi.unstubAllGlobals())
it.each([{newKiosk:false,balances:['1200000']},{newKiosk:false,balances:['600000','500000']},
  {newKiosk:true,balances:['1200000']},{newKiosk:true,balances:['600000','500000']}])
  ('validates actual SDK full BCS newKiosk=$newKiosk balances=$balances without serializing SDK-only Input hints',async options=>{
    const f=await marketBuyFixture(options);expect(validateMarketBuyOperationRecord(f.record)).toEqual(f.record)
    const data=Transaction.from(f.bytes).getData();expect(data.commands.some(c=>c.MergeCoins)).toBe(options.balances.length>1)
    expect(data.commands.some(c=>c.MoveCall?.function==='new')).toBe(options.newKiosk)
    expect(data.commands.filter(c=>c.MoveCall?.function==='buy_animacraft_v8_soul_fixed_price')).toHaveLength(1)
  })
it('allows paused display snapshot but rejects unsupported coin and invalid economic/custody identity',async()=>{
  const f=await marketBuyFixture();expect(validateMarketBuySnapshot({...f.snapshot,purchaseAvailable:false})).toMatchObject({purchaseAvailable:false})
  for(const patch of [{buyer:f.snapshot.seller},{buyerKioskCapId:null},{soulCreatorRoyaltyBps:1001},{makerSourceRoyaltyBps:751},
    {soulCreatorRoyaltyBps:500,makerSourceRoyaltyBps:750},{priceAtomic:'0'},
    {release:{...f.snapshot.release,paymentCoinType:'0x2::sui::SUI'}}])expect(()=>validateMarketBuySnapshot({...f.snapshot,...patch})).toThrow()
})
it('allows read-only self-owner snapshot without authorizing a self-purchase packet',async()=>{
  const f=await marketBuyFixture();const self={...f.snapshot,buyer:f.snapshot.seller,buyerKioskId:f.snapshot.sellerKioskId,purchaseAvailable:false}
  expect(validateMarketBuySnapshot(self)).toEqual(self)
  expect(()=>validateMarketBuySnapshot({...self,purchaseAvailable:true})).toThrow()
  expect(()=>validateMarketBuyOperationRecord({...f.record,snapshot:self})).toThrow('own Soul')
})
it.each(['buy-target','type-arg','split-price','extra-transfer','extra-split','result-wire','merge-destination','payment-ref','shared-coin','binding-ref','registry-mutability','gas-overlap','gas-owner','expiry'])
  ('rejects valid BCS purchase substitution %s',async problem=>{
    const f=await marketBuyFixture({newKiosk:true});const data=f.tx.getData() as any
    const buy=data.commands.find((c:any)=>c.MoveCall?.function==='buy_animacraft_v8_soul_fixed_price').MoveCall
    const split=data.commands.find((c:any)=>c.SplitCoins).SplitCoins
    if(problem==='buy-target')buy.function='buy_soul_fixed_price_v2'
    if(problem==='type-arg')buy.typeArguments=['0x2::sui::SUI']
    if(problem==='split-price')data.inputs[split.amounts[0].Input]={Pure:{bytes:toBase64(bcs.u64().serialize(999999).toBytes())}}
    if(problem==='extra-transfer')data.commands.push({TransferObjects:{objects:[split.coin],address:split.amounts[0]}})
    if(problem==='extra-split')data.commands.push({SplitCoins:structuredClone(split)})
    if(problem==='result-wire')buy.arguments[5]={NestedResult:[0,1]}
    if(problem==='merge-destination')data.commands.find((c:any)=>c.MergeCoins).MergeCoins.destination={GasCoin:true}
    const coinInput=data.inputs.find((c:any)=>c.Object?.ImmOrOwnedObject?.objectId===f.paymentCoins[0].objectId)
    if(problem==='payment-ref')coinInput.Object.ImmOrOwnedObject.version='3'
    if(problem==='shared-coin')coinInput.Object={SharedObject:{objectId:f.paymentCoins[0].objectId,initialSharedVersion:'1',mutable:true}}
    if(problem==='binding-ref')data.inputs.find((c:any)=>c.Object?.ImmOrOwnedObject?.objectId===f.snapshot.bindingId).Object={SharedObject:{objectId:f.snapshot.bindingId,initialSharedVersion:'1',mutable:false}}
    if(problem==='registry-mutability')data.inputs.find((c:any)=>c.Object?.SharedObject?.objectId===f.snapshot.release.kioskRegistryId).Object.SharedObject.mutable=false
    if(problem==='gas-overlap')data.gasData.payment[0].objectId=f.paymentCoins[0].objectId
    if(problem==='gas-owner')data.gasData.owner=bid(999)
    if(problem==='expiry')data.expiration={Epoch:'11'}
    const bytes=await Transaction.from(JSON.stringify(data)).build()
    expect(()=>validateMarketBuyOperationRecord({...f.record,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)})).toThrow()
  })
it('persists prepared/signing/signed before wallet/payment and finalized success before sync',async()=>{
  const f=await fixture();const result=await runMarketBuyOperation({...f.params,start:true})
  expect(result).toMatchObject({phase:'SUCCEEDED',syncStatus:'COMPLETE',bytes:f.record.bytes})
  expect(f.events).toEqual(['prepare','save:PREPARED:','query','save:SIGNING:','sign','save:SIGNED:','broadcast','query','save:SUCCEEDED:PENDING','sync','save:SUCCEEDED:COMPLETE'])
})
it.each(['PREPARED','SIGNING','SIGNED'])('storage failure at %s prevents unjournaled payment',async phase=>{
  const f=await fixture();const write=f.store.write
  f.store.write=(key,r)=>{if(r.phase===phase)throw new Error('quota');write(key,r)}
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow('quota')
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(f.adapter.sign).toHaveBeenCalledTimes(phase==='SIGNED'?1:0)
})
it('query-first unknown broadcast resumes the same signature and never collects a second payment',async()=>{
  const f=await fixture();f.adapter.broadcast.mockImplementationOnce(async()=>{f.setSubmitted(true);throw new Error('timeout')})
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow('timeout');expect(f.saved()?.phase).toBe('SIGNED')
  expect(await runMarketBuyOperation(f.params)).toMatchObject({phase:'SUCCEEDED'})
  expect(f.adapter.sign).toHaveBeenCalledTimes(1);expect(f.adapter.prepare).toHaveBeenCalledTimes(1);expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it('missing signed purchase rebroadcasts only original bytes/signature',async()=>{
  const f=await fixture();const signed=await buySigner.signTransaction(f.bytes);f.setSaved({...f.record,phase:'SIGNED',signature:signed.signature})
  await runMarketBuyOperation(f.params);expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.prepare).not.toHaveBeenCalled()
  expect(f.adapter.broadcast.mock.calls[0][0]).toMatchObject({bytes:f.record.bytes,signature:signed.signature})
})
it.each([false,true])('only explicit initial WalletStandard rejection can reset SIGNING (explicit=%s)',async explicit=>{
  const f=await fixture();const error=explicit?Object.assign(new Error('rejected'),{name:'WalletStandardError',context:{__code:4001000}}):Object.assign(new Error('rejected'),{code:4001})
  f.adapter.sign.mockRejectedValue(error)
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow()
  expect(f.saved()?.phase).toBe(explicit?'PREPARED':'SIGNING')
  if(explicit)expect((await runMarketBuyOperation({...f.params,cancelUnsigned:true})).phase).toBe('CANCELLED')
  else await expect(runMarketBuyOperation({...f.params,cancelUnsigned:true})).rejects.toThrow('cannot be discarded')
})
it.each(['bytes','signer'])('rejects wallet %s substitution and preserves unknown signing',async problem=>{
  const f=await fixture();f.adapter.sign.mockImplementation(async()=>problem==='bytes'?{bytes:'wrong',signature:'wrong'}:Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(24)).signTransaction(f.bytes))
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow();expect(f.saved()?.phase).toBe('SIGNING');expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('durable success survives mirror outage and later ownership supersession without a second purchase',async()=>{
  const f=await fixture();f.adapter.sync.mockRejectedValueOnce(new Error('mirror outage'))
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow('mirror outage')
  expect(f.saved()).toMatchObject({phase:'SUCCEEDED',syncStatus:'PENDING'})
  f.adapter.sync.mockResolvedValue('SUPERSEDED')
  expect(await runMarketBuyOperation({...f.params,queryOnly:true})).toMatchObject({phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  expect(f.adapter.sign).toHaveBeenCalledTimes(1)
})
it.each(['COMPLETE','SUPERSEDED'] as const)('saved %s never substitutes for current custody synchronization',async syncStatus=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SUCCEEDED',syncStatus});f.setSubmitted(true)
  f.adapter.sync.mockImplementation(async()=>{f.events.push('sync');return 'SUPERSEDED'})
  expect(await runMarketBuyOperation({...f.params,queryOnly:true})).toMatchObject({phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  expect(f.adapter.sync).toHaveBeenCalledTimes(1);expect(f.events).toEqual(['query','save:SUCCEEDED:PENDING','sync','save:SUCCEEDED:SUPERSEDED'])
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('query-only and pending results never open the wallet or reselect payment',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  await runMarketBuyOperation({...f.params,queryOnly:true});f.adapter.query.mockResolvedValue('PENDING');await runMarketBuyOperation(f.params)
  expect(f.adapter.preflight).not.toHaveBeenCalled();expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it('retirement archives full payment packet before pointer, recovers partial write, and never replays archived bytes',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNED',signature:(await buySigner.signTransaction(f.bytes)).signature})
  const write=f.store.write;f.store.write=()=>{throw new Error('quota')}
  await expect(runMarketBuyOperation({...f.params,retireExpired:true})).rejects.toThrow('quota')
  expect(f.history.size).toBe(1);expect(f.saved()?.phase).toBe('SIGNED')
  f.store.write=write;const retired=await runMarketBuyOperation(f.params)
  expect(retired).toEqual(f.history.get(f.record.digest));expect(retired.phase).toBe('RETIRED');expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()
  await expect(runMarketBuyOperation({...f.params,start:true})).rejects.toThrow('cannot be prepared')
  f.adapter.query.mockResolvedValue('SUCCEEDED')
  const before=f.saved();expect(await queryMarketBuyHistory({...f.params,digest:f.record.digest})).toBe('SUCCEEDED')
  expect(f.saved()).toEqual(before);expect(f.adapter.sync).not.toHaveBeenCalled()
})
it.each(['equal','pending','network','archive'])('retirement rejects %s without discarding an unknown payment',async failure=>{
  const f=await fixture();const record={...f.record,phase:'SIGNING' as const};f.setSaved(record)
  if(failure==='equal')f.adapter.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture('10').evidence)
  if(failure==='pending')f.adapter.query.mockResolvedValue('PENDING')
  if(failure==='network')f.adapter.query.mockRejectedValue(new Error('offline'))
  if(failure==='archive')vi.mocked(f.store.archive).mockImplementation(()=>{throw new Error('quota')})
  if(failure==='pending')await runMarketBuyOperation({...f.params,retireExpired:true})
  else await expect(runMarketBuyOperation({...f.params,retireExpired:true})).rejects.toThrow()
  expect(f.saved()).toEqual(record);expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('isolates onRecord/adapter mutation and concurrent attempts with a scope lock',async()=>{
  const f=await fixture();f.adapter.preflight.mockImplementation(async r=>{r.snapshot.buyer=bid(999);r.paymentCoins=[]})
  const result=await runMarketBuyOperation({...f.params,start:true,onRecord:r=>{r.bytes='wrong';r.snapshot.priceAtomic='1'}})
  expect(result.bytes).toBe(f.record.bytes);expect(f.saved()?.snapshot.priceAtomic).toBe('1000000')
  let release!:()=>void;const held=f.store.exclusive('key',()=>new Promise<void>(done=>{release=done}))
  await expect(runMarketBuyOperation(f.params)).rejects.toThrow('locked');release();await held
})
it('browser purchase journal has its own scope, immutable retirement, verified persistence and no memory fallback',async()=>{
  const f=await fixture();vi.stubGlobal('window',{});vi.stubGlobal('navigator',{})
  expect(()=>browserMarketBuyOperationStore()).toThrow('Web Locks')
  const values=new Map<string,string>();const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,
    getItem:(k:string)=>values.get(k)??null,setItem:vi.fn((k:string,v:string)=>{values.set(k,v)})}
  vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('navigator',{locks:{request:vi.fn()}})
  const store=browserMarketBuyOperationStore();const key=marketBuyOperationKey(f.snapshot.soulId,f.snapshot.buyer)
  expect(key).toContain('market-buy-operation');store.write(key,f.record);expect(store.read(key)).toEqual(f.record)
  const retired=validateMarketBuyOperationRecord({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  store.archive(key,retired);store.archive(key,structuredClone(retired));expect(store.history(key)).toEqual([retired])
  expect(()=>store.archive(key,{...retired,snapshot:{...retired.snapshot,ownershipEpoch:'4'}})).toThrow('immutable')
  storage.setItem.mockImplementationOnce(()=>{throw new Error('quota')});expect(()=>store.write(key,f.record)).toThrow('quota')
})
