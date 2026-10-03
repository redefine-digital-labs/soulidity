import { afterEach,expect,it,vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction,TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64,toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { runMarketListOperation,validateMarketListOperationRecord,validateMarketListSnapshot,queryMarketListHistory,browserMarketListOperationStore,buildMarketListOperationTransaction,
  marketListOperationKey,type MarketListOperationRecord,type MarketListOperationStore } from '../../web/lib/animacraft/market-list-operation'
import { marketListFixture,listSigner,lid } from './fixtures/market-list-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
async function fixture(){
  const f=await marketListFixture();let saved:MarketListOperationRecord|null=null;let submitted=false;let locked=false
  const history=new Map<string,MarketListOperationRecord>();const events:string[]=[]
  const store:MarketListOperationStore={read:()=>structuredClone(saved),write:vi.fn((_k,r)=>{events.push(`save:${r.phase}:${r.syncStatus??''}`);saved=structuredClone(r)}),
    archive:vi.fn((_k,r)=>{events.push('archive');if(history.has(r.digest))expect(history.get(r.digest)).toEqual(r);else history.set(r.digest,structuredClone(r))}),
    history:()=>[...history.values()].map(r=>structuredClone(r)),
    async exclusive(_key,work){if(locked)throw new Error('locked');locked=true;try{return await work()}finally{locked=false}}}
  const adapter={prepare:vi.fn(async()=>{events.push('prepare');return structuredClone(f.record)}),
    query:vi.fn(async(_r:MarketListOperationRecord):Promise<'MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'>=>{events.push('query');return submitted?'SUCCEEDED':'MISSING'}),
    preflight:vi.fn(async(_r:MarketListOperationRecord,_signing:boolean)=>{}),
    sign:vi.fn(async(r:MarketListOperationRecord)=>{events.push('sign');return listSigner.signTransaction(fromBase64(r.bytes))}),
    verifySignature:vi.fn(async(r:MarketListOperationRecord)=>{await verifyTransactionSignature(fromBase64(r.bytes),r.signature!,{address:r.snapshot.owner})}),
    broadcast:vi.fn(async(_r:MarketListOperationRecord)=>{events.push('broadcast');submitted=true}),
    sync:vi.fn(async(_r:MarketListOperationRecord):Promise<'COMPLETE'|'SUPERSEDED'>=>{events.push('sync');return 'COMPLETE'}),
    expiryCheckpoint:vi.fn(async(_r:MarketListOperationRecord)=>marketCancelCheckpointFixture().evidence)}
  return {...f,store,adapter,history,events,params:{soulId:f.snapshot.soulId,owner:f.snapshot.owner,store,adapter},saved:()=>structuredClone(saved),
    setSaved:(r:MarketListOperationRecord)=>{saved=structuredClone(r)},setSubmitted:(v:boolean)=>{submitted=v}}
}
afterEach(()=>vi.unstubAllGlobals())
it('LIST and REPRICE share the same Soul/owner lock and cannot start over unknown signing',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  const reprice=await marketListFixture({kind:'reprice'})
  f.adapter.prepare.mockResolvedValue(reprice.record)
  expect(marketListOperationKey(f.snapshot.soulId,f.snapshot.owner)).toBe(marketListOperationKey(reprice.snapshot.soulId,reprice.snapshot.owner))
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('Recover the pending')
  expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('verified prior success allows a fresh atomic reprice without requiring an old mirror to overwrite newer state',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'})
  const reprice=await marketListFixture({kind:'reprice'})
  f.adapter.prepare.mockResolvedValue(reprice.record)
  f.adapter.query.mockImplementation(async r=>r.digest===f.record.digest||f.saved()?.phase==='SIGNED'?'SUCCEEDED':'MISSING')
  const result=await runMarketListOperation({...f.params,start:true})
  expect(result).toMatchObject({kind:'reprice',phase:'SUCCEEDED',bytes:reprice.record.bytes})
  expect(f.adapter.sync).toHaveBeenCalledTimes(1)
  expect(f.adapter.sync.mock.calls[0][0].digest).toBe(reprice.record.digest)
})
it('retired LIST history success cannot mutate or synchronize the newer REPRICE intent',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  const retired=await runMarketListOperation({...f.params,retireExpired:true})
  const reprice=await marketListFixture({kind:'reprice'})
  f.adapter.prepare.mockResolvedValue(reprice.record)
  const next=await runMarketListOperation({...f.params,start:true})
  expect(next.kind).toBe('reprice');expect(next.digest).not.toBe(retired.digest)
  f.adapter.sync.mockClear();f.adapter.sign.mockClear();f.adapter.broadcast.mockClear()
  f.adapter.query.mockResolvedValue('SUCCEEDED')
  expect(await queryMarketListHistory({...f.params,digest:retired.digest})).toBe('SUCCEEDED')
  expect(f.saved()).toEqual(next);expect(f.history.get(retired.digest)).toEqual(retired)
  expect(f.adapter.sync).not.toHaveBeenCalled();expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('does not trust an already saved retirement marker when starting a new intent',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  await runMarketListOperation({...f.params,retireExpired:true});const before=f.saved()
  f.adapter.expiryCheckpoint.mockRejectedValue(new Error('latest unavailable'))
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('latest unavailable')
  expect(f.saved()).toEqual(before);expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it('archive readback failure leaves the active unknown packet intact',async()=>{
  const f=await fixture();const before={...f.record,phase:'SIGNING' as const};f.setSaved(before)
  f.store.history=()=>[]
  await expect(runMarketListOperation({...f.params,retireExpired:true})).rejects.toThrow('archive readback')
  expect(f.saved()).toEqual(before);expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('rejects archived packet substitution during partial pointer recovery',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  const retired=validateMarketListOperationRecord({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  f.history.set(retired.digest,{...retired,snapshot:{...retired.snapshot,ownershipEpoch:'4'}})
  await expect(runMarketListOperation(f.params)).rejects.toThrow('archive packet mismatch')
  expect(f.saved()?.phase).toBe('SIGNING');expect(f.adapter.preflight).not.toHaveBeenCalled()
})
it('mutually exclusive recovery actions and forged terminal results cannot trigger signing',async()=>{
  const f=await fixture()
  await expect(runMarketListOperation({...f.params,start:true,retireExpired:true})).rejects.toThrow('mutually exclusive')
  f.setSaved({...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'})
  await expect(runMarketListOperation({...f.params,queryOnly:true})).rejects.toThrow('cannot be confirmed')
  expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.sync).not.toHaveBeenCalled()
})
it.each(['list','reprice'] as const)('validates actual SDK %s full BCS and exact result wiring',async kind=>{
  const f=await marketListFixture({kind});expect(validateMarketListOperationRecord(f.record)).toEqual(f.record)
  const calls=Transaction.from(f.bytes).getData().commands.map(c=>c.MoveCall?.function)
  expect(calls).toEqual([...(kind==='reprice'?['cancel_animacraft_v8_soul_listing']:[]),
    'ensure_personal_kiosk_registered_v2','list_animacraft_v8_soul_fixed_price','finalize_soul_listing'])
})
it('validates atomic equipped LIST including owned instances and final Pack proof wiring',async()=>{
  const f=await marketListFixture({equipped:true})
  expect(validateMarketListOperationRecord(f.record)).toEqual(f.record)
  const data=f.tx.getData(), calls=data.commands.flatMap(c=>c.MoveCall?[c.MoveCall]:[])
  expect(calls.map(c=>c.function)).toEqual(['begin_update_v8','unequip_base_v8','unequip_external_v8','clear_selection_v8',
    'prove_equipment_pack_definitions_v8','finish_update_v8','close_empty_equipment_v8',
    'ensure_personal_kiosk_registered_v2','list_animacraft_v8_soul_fixed_price','finalize_soul_listing'])
  const close=calls.find(c=>c.function==='close_empty_equipment_v8')!
  expect(bcs.u64().fromBase64(data.inputs[(close.arguments[3] as {Input:number}).Input].Pure!.bytes)).toBe('9007199254740996')
  const paused=structuredClone(f.record)
  paused.snapshot.release.writesEnabled=false;paused.snapshot.equipmentSale!.writesEnabled=false;paused.snapshot.listAvailable=false
  expect(validateMarketListOperationRecord(paused)).toEqual(paused)
})
it.each(['missing plan','plan without equipment','scope state','scope equipment','scope package','scope protocol','revision bigint',
  'runtime digest','write flag','unknown plan field','owned alias','definition alias','pack alias','protocol alias','package alias',
  'duplicate removal','duplicate slot','pack order','mixed runtime','removal count','reprice'])('rejects equipped snapshot %s',async problem=>{
  const f=await marketListFixture({equipped:true}),s=structuredClone(f.snapshot),e=s.equipmentSale!
  if(problem==='missing plan')delete s.equipmentSale
  if(problem==='plan without equipment')s.equipmentId=null
  if(problem==='scope state')e.scope.soulStateId=lid(400)
  if(problem==='scope equipment')e.scope.equipmentId=lid(400)
  if(problem==='scope package')e.scope.target.soulidityCallablePackageId=lid(400)
  if(problem==='scope protocol')e.scope.target.protocolConfigId=lid(400)
  if(problem==='revision bigint')e.scope.expectedRevision=1n
  if(problem==='runtime digest')e.runtimeCallableDigest='bad'
  if(problem==='write flag')(e as any).writesEnabled='true'
  if(problem==='unknown plan field')(e as any).extra=true
  if(problem==='owned alias')e.removals[0]={kind:'base',itemId:s.bindingId}
  if(problem==='definition alias')e.definitionRegistryId=s.stateId
  if(problem==='pack alias')e.packs[0].releaseId=e.baseRegistryId
  if(problem==='protocol alias'){s.release.protocolConfigId=s.kioskId;e.scope.target.protocolConfigId=s.kioskId}
  if(problem==='package alias')e.baseRegistryId=e.scope.target.runtimeOriginalPackageId
  if(problem==='duplicate removal')e.removals.push(e.removals[0])
  if(problem==='duplicate slot')e.removals.push({kind:'selection',selectionIndex:'8'})
  if(problem==='pack order')e.packs[0].bindingIndex='1'
  if(problem==='mixed runtime')e.packs.push({...e.packs[0],runtimeCallablePackageId:lid(401),releaseId:lid(402),bindingIndex:'1'})
  if(problem==='removal count')e.removals=Array(501).fill({kind:'selection',selectionIndex:'8'})
  if(problem==='reprice'){s.listed=true;s.listAvailable=false;s.repriceAvailable=true;s.listingId=lid(400);s.priceAtomic='1'}
  expect(()=>validateMarketListSnapshot(s)).toThrow()
})
it.each(['removal instance','removal kind','removal slot','pack release','pack revision','empty removals','close revision',
  'proof wire','extra transfer','instance shared','instance zero version','equipment readonly','protocol mutable','definition mutable','base mutable','pack mutable'])
  ('rejects rehashed equipped bytes or snapshot substitution %s',async problem=>{
    const f=await marketListFixture({equipped:true}),record=structuredClone(f.record),e=record.snapshot.equipmentSale!,data=f.tx.getData() as any
    const calls=data.commands.flatMap((c:any)=>c.MoveCall?[c.MoveCall]:[])
    if(problem==='removal instance')e.removals[0]={kind:'base',itemId:lid(400)}
    if(problem==='removal kind')e.removals[0]={kind:'external',itemId:lid(94)}
    if(problem==='removal slot')e.removals[2]={kind:'selection',selectionIndex:'9'}
    if(problem==='pack release')e.packs[0].releaseId=lid(400)
    if(problem==='pack revision')e.scope.expectedRevision='9007199254740994'
    if(problem==='empty removals')e.removals=[]
    if(problem==='close revision'){
      const arg=calls.find((c:any)=>c.function==='close_empty_equipment_v8').arguments[3]
      data.inputs[arg.Input]={Pure:{bytes:toBase64(bcs.u64().serialize('9007199254740995').toBytes())}}
    }
    if(problem==='proof wire')calls.find((c:any)=>c.function==='finish_update_v8').arguments[3]={Result:0}
    if(problem==='extra transfer')data.commands.push({TransferObjects:{objects:[{Input:0}],address:{Input:0}}})
    if(problem==='instance shared')data.inputs.find((i:any)=>i.Object?.ImmOrOwnedObject?.objectId===lid(94)).Object={SharedObject:{objectId:lid(94),initialSharedVersion:'1',mutable:true}}
    if(problem==='instance zero version')data.inputs.find((i:any)=>i.Object?.ImmOrOwnedObject?.objectId===lid(94)).Object.ImmOrOwnedObject.version='0'
    const sharedIds:Record<string,string>={'equipment readonly':lid(90),'protocol mutable':lid(1),'definition mutable':lid(92),'base mutable':lid(93),'pack mutable':lid(96)}
    if(sharedIds[problem]){const ref=data.inputs.find((i:any)=>i.Object?.SharedObject?.objectId===sharedIds[problem]).Object.SharedObject;ref.mutable=!ref.mutable}
    const bytes=await Transaction.from(JSON.stringify(data)).build()
    record.bytes=toBase64(bytes);record.digest=TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(()=>validateMarketListOperationRecord(record)).toThrow()
  })
it.each([1,90,92,93,94,95,96])('rejects equipment gas overlap with object %s',async id=>{
  const f=await marketListFixture({equipped:true}),tx=Transaction.from(f.bytes)
  tx.setGasPayment([{objectId:lid(id),version:'1',digest:f.snapshot.release.soulidityCallableDigest}])
  const bytes=await tx.build()
  expect(()=>validateMarketListOperationRecord({...f.record,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)})).toThrow('gas overlaps')
})
it('validates read-only pause/equipment snapshots without enabling listing packets',async()=>{
  const f=await marketListFixture()
  expect(validateMarketListSnapshot({...f.snapshot,listAvailable:false})).toMatchObject({listAvailable:false})
  const equipped={...f.snapshot,listAvailable:false,equipmentId:lid(90)}
  expect(validateMarketListSnapshot(equipped)).toEqual(equipped)
  expect(()=>validateMarketListOperationRecord({...f.record,snapshot:equipped})).toThrow()
  expect(()=>buildMarketListOperationTransaction({...f.record,snapshot:equipped})).toThrow('Verified equipment sale plan required')
  for(const patch of [{kioskCapId:null},{soulCreatorRoyaltyBps:1001},{makerSourceRoyaltyBps:751},
    {soulCreatorRoyaltyBps:500,makerSourceRoyaltyBps:750},{listed:true},{listingId:lid(90)},
    {release:{...f.snapshot.release,paymentCoinType:'0x2::sui::SUI'}}])expect(()=>validateMarketListSnapshot({...f.snapshot,...patch})).toThrow()
})
it.each(['target','type-arg','price','extra-transfer','extra-cancel','result-wire','cancel-order','cap-shared','binding-ref',
  'config-mutability','registry-mutability','gas-overlap','gas-owner','expiry','extra-input'])
  ('rejects valid BCS listing/reprice substitution %s',async problem=>{
    const f=await marketListFixture({kind:'reprice'});const data=f.tx.getData() as any
    const list=data.commands.find((c:any)=>c.MoveCall?.function==='list_animacraft_v8_soul_fixed_price').MoveCall
    if(problem==='target')list.function='list_soul_fixed_price_v2'
    if(problem==='type-arg')list.typeArguments=['0x2::sui::SUI']
    if(problem==='price')data.inputs[list.arguments[6].Input]={Pure:{bytes:toBase64(bcs.u64().serialize(999999).toBytes())}}
    if(problem==='extra-transfer')data.commands.push({TransferObjects:{objects:[list.arguments[2]],address:list.arguments[6]}})
    if(problem==='extra-cancel')data.commands.push(structuredClone(data.commands[0]))
    if(problem==='result-wire')data.commands.at(-1).MoveCall.arguments=[{Result:0}]
    if(problem==='cancel-order')[data.commands[0],data.commands[1]]=[data.commands[1],data.commands[0]]
    for(const [name,id] of [['cap-shared',f.snapshot.kioskCapId],['binding-ref',f.snapshot.bindingId]]){
      if(problem===name)data.inputs.find((c:any)=>c.Object?.ImmOrOwnedObject?.objectId===id).Object={SharedObject:{objectId:id,initialSharedVersion:'1',mutable:false}}
    }
    for(const [name,id] of [['config-mutability',f.snapshot.release.marketConfigV2Id],['registry-mutability',f.snapshot.release.kioskRegistryId]]){
      if(problem===name){const ref=data.inputs.find((c:any)=>c.Object?.SharedObject?.objectId===id).Object.SharedObject;ref.mutable=!ref.mutable}
    }
    if(problem==='gas-overlap')data.gasData.payment[0].objectId=f.snapshot.kioskCapId
    if(problem==='gas-owner')data.gasData.owner=lid(999)
    if(problem==='expiry')data.expiration={Epoch:'11'}
    if(problem==='extra-input')data.inputs.push({Pure:{bytes:toBase64(bcs.u64().serialize(1).toBytes())}})
    const bytes=await Transaction.from(JSON.stringify(data)).build()
    expect(()=>validateMarketListOperationRecord({...f.record,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)})).toThrow()
  })
it.each(['0','01','18446744073709551616','1e6','-1'])('rejects invalid exact price %s',async priceAtomic=>{
  const f=await marketListFixture();expect(()=>validateMarketListOperationRecord({...f.record,priceAtomic})).toThrow()
})
it('persists prepared/signing/signed before wallet/broadcast and finalized success before sync',async()=>{
  const f=await fixture();const result=await runMarketListOperation({...f.params,start:true})
  expect(result).toMatchObject({phase:'SUCCEEDED',syncStatus:'COMPLETE',bytes:f.record.bytes})
  expect(f.events).toEqual(['prepare','save:PREPARED:','query','save:SIGNING:','sign','save:SIGNED:','broadcast','query','save:SUCCEEDED:PENDING','sync','save:SUCCEEDED:COMPLETE'])
})
it.each(['PREPARED','SIGNING','SIGNED'])('storage failure at %s prevents unjournaled listing',async phase=>{
  const f=await fixture();const write=f.store.write
  f.store.write=(key,r)=>{if(r.phase===phase)throw new Error('quota');write(key,r)}
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('quota')
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(f.adapter.sign).toHaveBeenCalledTimes(phase==='SIGNED'?1:0)
})
it('query-first unknown broadcast resumes the same signature and never creates another listing',async()=>{
  const f=await fixture();f.adapter.broadcast.mockImplementationOnce(async()=>{f.setSubmitted(true);throw new Error('timeout')})
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('timeout');expect(f.saved()?.phase).toBe('SIGNED')
  expect(await runMarketListOperation(f.params)).toMatchObject({phase:'SUCCEEDED'})
  expect(f.adapter.sign).toHaveBeenCalledTimes(1);expect(f.adapter.prepare).toHaveBeenCalledTimes(1);expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it('missing signed listing rebroadcasts only original bytes/signature',async()=>{
  const f=await fixture();const signed=await listSigner.signTransaction(f.bytes);f.setSaved({...f.record,phase:'SIGNED',signature:signed.signature})
  await runMarketListOperation(f.params);expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.prepare).not.toHaveBeenCalled()
  expect(f.adapter.broadcast.mock.calls[0][0]).toMatchObject({bytes:f.record.bytes,signature:signed.signature})
})
it.each([false,true])('only explicit initial WalletStandard rejection can reset SIGNING (explicit=%s)',async explicit=>{
  const f=await fixture();const error=explicit?Object.assign(new Error('rejected'),{name:'WalletStandardError',context:{__code:4001000}}):Object.assign(new Error('rejected'),{code:4001})
  f.adapter.sign.mockRejectedValue(error)
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow()
  expect(f.saved()?.phase).toBe(explicit?'PREPARED':'SIGNING')
  if(explicit)expect((await runMarketListOperation({...f.params,cancelUnsigned:true})).phase).toBe('CANCELLED')
  else await expect(runMarketListOperation({...f.params,cancelUnsigned:true})).rejects.toThrow('cannot be discarded')
})
it.each(['bytes','signer'])('rejects wallet %s substitution and preserves unknown signing',async problem=>{
  const f=await fixture();f.adapter.sign.mockImplementation(async()=>problem==='bytes'?{bytes:'wrong',signature:'wrong'}:Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(24)).signTransaction(f.bytes))
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow();expect(f.saved()?.phase).toBe('SIGNING');expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('durable success survives mirror outage and later ownership supersession without a second listing',async()=>{
  const f=await fixture();f.adapter.sync.mockRejectedValueOnce(new Error('mirror outage'))
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('mirror outage')
  expect(f.saved()).toMatchObject({phase:'SUCCEEDED',syncStatus:'PENDING'})
  f.adapter.sync.mockResolvedValue('SUPERSEDED')
  expect(await runMarketListOperation({...f.params,queryOnly:true})).toMatchObject({phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  expect(f.adapter.sign).toHaveBeenCalledTimes(1)
})
it.each(['COMPLETE','SUPERSEDED'] as const)('saved %s never substitutes for current custody synchronization',async syncStatus=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SUCCEEDED',syncStatus});f.setSubmitted(true)
  f.adapter.sync.mockImplementation(async()=>{f.events.push('sync');return 'SUPERSEDED'})
  expect(await runMarketListOperation({...f.params,queryOnly:true})).toMatchObject({phase:'SUCCEEDED',syncStatus:'SUPERSEDED'})
  expect(f.adapter.sync).toHaveBeenCalledTimes(1);expect(f.events).toEqual(['query','save:SUCCEEDED:PENDING','sync','save:SUCCEEDED:SUPERSEDED'])
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('query-only and pending results never open the wallet or prepare another listing',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  await runMarketListOperation({...f.params,queryOnly:true});f.adapter.query.mockResolvedValue('PENDING');await runMarketListOperation(f.params)
  expect(f.adapter.preflight).not.toHaveBeenCalled();expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it('retirement archives the full listing packet before pointer, recovers partial write, and never replays archived bytes',async()=>{
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNED',signature:(await listSigner.signTransaction(f.bytes)).signature})
  const write=f.store.write;f.store.write=()=>{throw new Error('quota')}
  await expect(runMarketListOperation({...f.params,retireExpired:true})).rejects.toThrow('quota')
  expect(f.history.size).toBe(1);expect(f.saved()?.phase).toBe('SIGNED')
  f.store.write=write;const retired=await runMarketListOperation(f.params)
  expect(retired).toEqual(f.history.get(f.record.digest));expect(retired.phase).toBe('RETIRED');expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()
  await expect(runMarketListOperation({...f.params,start:true})).rejects.toThrow('cannot be prepared')
  f.adapter.query.mockResolvedValue('SUCCEEDED')
  const before=f.saved();expect(await queryMarketListHistory({...f.params,digest:f.record.digest})).toBe('SUCCEEDED')
  expect(f.saved()).toEqual(before);expect(f.adapter.sync).not.toHaveBeenCalled()
})
it.each(['equal','pending','network','archive'])('retirement rejects %s without discarding an unknown listing',async failure=>{
  const f=await fixture();const record={...f.record,phase:'SIGNING' as const};f.setSaved(record)
  if(failure==='equal')f.adapter.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture('10').evidence)
  if(failure==='pending')f.adapter.query.mockResolvedValue('PENDING')
  if(failure==='network')f.adapter.query.mockRejectedValue(new Error('offline'))
  if(failure==='archive')vi.mocked(f.store.archive).mockImplementation(()=>{throw new Error('quota')})
  if(failure==='pending')await runMarketListOperation({...f.params,retireExpired:true})
  else await expect(runMarketListOperation({...f.params,retireExpired:true})).rejects.toThrow()
  expect(f.saved()).toEqual(record);expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('isolates onRecord/adapter mutation and concurrent attempts with a scope lock',async()=>{
  const f=await fixture();f.adapter.preflight.mockImplementation(async r=>{r.snapshot.owner=lid(999);r.priceAtomic='1'})
  const result=await runMarketListOperation({...f.params,start:true,onRecord:r=>{r.bytes='wrong';r.priceAtomic='1'}})
  expect(result.bytes).toBe(f.record.bytes);expect(f.saved()?.priceAtomic).toBe('1000000')
  let release!:()=>void;const held=f.store.exclusive('key',()=>new Promise<void>(done=>{release=done}))
  await expect(runMarketListOperation(f.params)).rejects.toThrow('locked');release();await held
})
it('browser listing journal has its own scope, immutable retirement, verified persistence and no memory fallback',async()=>{
  const f=await fixture();vi.stubGlobal('window',{});vi.stubGlobal('navigator',{})
  expect(()=>browserMarketListOperationStore()).toThrow('Web Locks')
  const values=new Map<string,string>();const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,
    getItem:(k:string)=>values.get(k)??null,setItem:vi.fn((k:string,v:string)=>{values.set(k,v)})}
  vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('navigator',{locks:{request:vi.fn()}})
  const store=browserMarketListOperationStore();const key=marketListOperationKey(f.snapshot.soulId,f.snapshot.owner)
  expect(key).toContain('market-list-operation');store.write(key,f.record);expect(store.read(key)).toEqual(f.record)
  const retired=validateMarketListOperationRecord({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  store.archive(key,retired);store.archive(key,structuredClone(retired));expect(store.history(key)).toEqual([retired])
  expect(()=>store.archive(key,{...retired,snapshot:{...retired.snapshot,ownershipEpoch:'4'}})).toThrow('immutable')
  storage.setItem.mockImplementationOnce(()=>{throw new Error('quota')});expect(()=>store.write(key,f.record)).toThrow('quota')
})
