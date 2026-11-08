import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {completePreflightFixture} from './fixtures/commerce-new-paid-preflight'
import {soulAccessFixtureState,soulAccessTransactionFixture} from './fixtures/soul-access-transaction'
import {createNativePublicReadPaidHostPreflightV2,NativePublicReadPaidHostRecoveryErrorV2} from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import {browserNativePublicReadPaidJournalV2,nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2,parseNativePublicReadPaidRecordV2} from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import {browserSoulAccessStore} from '../../web/lib/soulidity/soul-access-store'
import {createSoulAccessAdapter,parseSoulAccessRecord} from '../../web/lib/soulidity/soul-access-operation'
import {runSoulAccess} from '../../web/lib/soulidity/soul-access-runner'
import {soulAccessKey,type SoulAccessRecord} from '../../web/lib/soulidity/soul-access-plan'
import {validateNativePublicReadPaidHostResultV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-host-preflight-v2'
import {publicMutationCanonical,type AsyncPublicMutationStorage} from '../../web/lib/sui/public-mutation-journal'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {captureSameSoulMutationClient} from '../../web/lib/soulidity/same-soul-mutation-client'

let dom:JSDOM
beforeEach(()=>{
 dom=new JSDOM('',{url:'https://host.example.test'});vi.stubGlobal('window',dom.window);vi.stubGlobal('navigator',dom.window.navigator)
 const held=new Set<string>()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_options:unknown,work:(lock:unknown)=>unknown)=>{
  if(held.has(name))return work(null);held.add(name);try{return await work({name})}finally{held.delete(name)}
 }}})
})
afterEach(()=>{dom.window.close();vi.unstubAllGlobals()})
async function fixture(){
 const x=await completePreflightFixture('',soulAccessFixtureState().author)
 x.client.ledgerService.getTransaction=vi.fn(async()=>{throw {code:'NOT_FOUND'}})
 x.client.ledgerService.getCheckpoint=vi.fn(async()=>{throw Error('UNEXPECTED_CHECKPOINT')})
 const journal=browserNativePublicReadPaidJournalV2(),scope={chainIdentifier:'35834a8a',soulId:x.params.soulId,author:x.buyer},key=nativePublicReadPaidKeyV2(scope)
 return {...x,journal,scope,key,host:createNativePublicReadPaidHostPreflightV2()}
}
async function installLegacy(r:SoulAccessRecord){
 const store=browserSoulAccessStore(),key=soulAccessKey(r.plan)
 await store.exclusive(key,async()=>{
  store.write(key,{...r,packet:{...r.packet,phase:'PREPARED',signature:null}})
  if(r.packet.signature!==null){store.write(key,{...r,packet:{...r.packet,phase:'SIGNING',signature:null}});store.write(key,{...r,packet:{...r.packet,phase:'SIGNED'}})}
  if(r.packet.phase!=='PREPARED')store.write(key,r)
 })
 return store
}
function storageWith(write:(name:string,value:string)=>void|Promise<void>):AsyncPublicMutationStorage{
 const raw=window.localStorage;return {get length(){return raw.length},key:i=>raw.key(i),getItem:k=>raw.getItem(k),setItem:write}
}
it('keeps native core quote simulation on the captured RPC service', async () => {
 const source = new SuiGrpcClient({network: 'mainnet', baseUrl: 'https://unused.invalid'})
 const service = source.transactionExecutionService
 const original = vi.fn(function(this: unknown) {
  expect(this).toBe(service)
  throw Error('ORIGINAL_SIMULATION_RPC')
 })
 service.simulateTransaction = original as typeof service.simulateTransaction
 const captured = captureSameSoulMutationClient(source)
 const replacement = vi.fn(() => { throw Error('LATE_SIMULATION_RPC') })
 service.simulateTransaction = replacement as typeof service.simulateTransaction
 const bytes = Uint8Array.of(1, 2, 3)

 await expect(captured.core.simulateTransaction({transaction: bytes, checksEnabled: false})).rejects.toThrow('ORIGINAL_SIMULATION_RPC')
 expect(original).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({transaction: {bcs: {value: bytes}}, doGasSelection: false}))
 expect(replacement).not.toHaveBeenCalled()
 expect(captured.core.executeTransaction).toBeUndefined()
})
it('actual preparedOriginal -> async parser -> durable readback precedes enabled full simulation and validates the140 return',async()=>{
 const x=await fixture(),simulate=x.client.transactionExecutionService.simulateTransaction
 x.client.transactionExecutionService.simulateTransaction=vi.fn(async(request:any)=>{
  const retained=await x.journal.read(x.key);expect(retained?.packet.phase).toBe('PREPARED');expect(retained?.packet.signature).toBeNull()
  const original=JSON.parse(retained!.plan.originalText);expect(original.packet.bytes).toBe(retained!.packet.bytes);expect(request.checks).toBe(0);expect(request.doGasSelection).toBe(false)
  return simulate(request)
 })
 const result=await x.host(x.input),validated=await validateNativePublicReadPaidHostResultV2(x.input,result),retained=await x.journal.read(x.key)
 expect(validated.digest).toBe(result.preflight.prepared.packet.digest);expect(retained?.plan.originalText).toBe(result.retainedText)
 expect(result.retainedText).toBe(JSON.stringify({format:result.preflight.prepared.format,intent:result.preflight.prepared.intent,packet:result.preflight.prepared.packet,reviewedGas:result.preflight.prepared.reviewedGas,context:result.preflight.prepared.context}))
 expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('cold reentry exports the exact existing original instead of rebuilding/reselecting Gas or simulating again',async()=>{
 const x=await fixture(),result=await x.host(x.input),before=window.localStorage.getItem(x.key),calls=x.client.core.getMoveFunction.mock.calls.length
 const input={...x.input,attempt:new Uint8Array(32).fill(2)},cold=createNativePublicReadPaidHostPreflightV2()
 const error=await cold(input).catch(e=>e)
 expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2);expect(error.message).toContain('ORIGINAL_RECOVERY_REQUIRED')
 expect(error.recovery).toEqual({format:'native-public-read-v2',text:result.retainedText,digest:result.preflight.prepared.packet.digest,soulId:x.scope.soulId,durability:'CONFIRMED'})
 expect(window.localStorage.getItem(x.key)).toBe(before);expect(x.client.core.getMoveFunction.mock.calls.length).toBe(calls);expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it.each(['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED'] as const)('fresh V2 refuses a cross-original legacy %s head with original MISSING',async phase=>{
 const x=await fixture(),old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 expect(old.plan.author).toBe(x.buyer);expect(old.plan.deployment.originalPackageId).not.toBe(x.params.target.native.originalPackageId)
 const record=parseSoulAccessRecord({...old.record,packet:{...old.record.packet,phase,signature:phase==='SIGNED'?old.record.packet.signature:null}});await installLegacy(record)
 const before=window.localStorage.getItem(soulAccessKey(record.plan)),error=await x.host(x.input).catch(e=>e)
 expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2);expect(error.message).toContain(['SUCCEEDED','FAILED'].includes(phase)?'LEGACY_TERMINAL_RESULT_UNCONFIRMED':'LEGACY_RECOVERY_REQUIRED')
 expect(error.recovery.format).toBe('soulidity.soul-access.v1');expect(error.recovery.text).toBe(before)
 expect(window.localStorage.getItem(soulAccessKey(record.plan))).toBe(before);expect(await x.journal.read(x.key)).toBeNull();expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
 expect(x.client.ledgerService.getTransaction).toHaveBeenCalledWith(expect.objectContaining({digest:record.packet.digest}),expect.anything())
 expect(x.client.ledgerService.getTransaction).toHaveBeenCalledOnce()
})
it('allows an authenticated unsigned cancelled legacy original only after the actual original query returns MISSING',async()=>{
 const x=await fixture(),old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId}),record=parseSoulAccessRecord({...old.record,packet:{...old.record.packet,phase:'CANCELLED',signature:null}})
 await installLegacy(record);const result=await x.host(x.input);expect(result.preflight.notSignedOrExecuted).toBe(true)
 expect((await x.journal.read(x.key))?.plan.originalText).toBe(result.retainedText)
})
it.each([undefined,true])('actual legacy adapter sees the V2 unresolved head before an implicit prepare/sign, startNew=%s',async startNew=>{
 const x=await fixture();await x.host(x.input)
 const old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 old.client.ledgerService.getServiceInfo=x.client.ledgerService.getServiceInfo;old.client.ledgerService.getCheckpoint=x.client.ledgerService.getCheckpoint
 old.client.ledgerService.getTransaction=x.client.ledgerService.getTransaction
 const adapter=createSoulAccessAdapter({client:old.client as never,getAddress:()=>old.author,sign:vi.fn(async()=>{throw Error('SIGN_FORBIDDEN')})})
 const prepare=vi.spyOn(adapter,'prepare'),sign=vi.spyOn(adapter,'sign'),broadcast=vi.spyOn(adapter,'broadcast')
 await expect(runSoulAccess({plan:old.plan,store:browserSoulAccessStore(),adapter,startNew})).rejects.toThrow('V2_RECOVERY_REQUIRED')
 expect(prepare).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(broadcast).not.toHaveBeenCalled()
 expect(window.localStorage.getItem(soulAccessKey(old.plan))).toBeNull()
})
it('queryOnly and unsigned cancel preserve the selected legacy recovery despite an opaque foreign V2 head',async()=>{
 const x=await fixture(),old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 const selected=parseSoulAccessRecord({...old.record,packet:{...old.record.packet,phase:'PREPARED',signature:null}}),store=await installLegacy(selected)
 window.localStorage.setItem('soulidity.native-public-read-paid.v2:opaque','{}');old.client.ledgerService.getTransaction=x.client.ledgerService.getTransaction
 const adapter=createSoulAccessAdapter({client:old.client as never,getAddress:()=>old.author,sign:vi.fn(async()=>{throw Error('SIGN_FORBIDDEN')})})
 const result=await runSoulAccess({plan:old.plan,store,adapter,queryOnly:true,expectedPacket:selected.packet});expect(result.status).toBe('MISSING')
 const cancelled=await runSoulAccess({plan:old.plan,store,adapter,cancelUnsigned:true,expectedPacket:selected.packet});expect(cancelled.record.packet.phase).toBe('CANCELLED')
 expect(old.sign).not.toHaveBeenCalled()
})
it('storage refusal returns a portable original without running the full simulation',async()=>{
 const x=await fixture(),journal=browserNativePublicReadPaidJournalV2(storageWith(()=>{throw Error('QUOTA')})),host=createNativePublicReadPaidHostPreflightV2({journal})
 const error=await host(x.input).catch(e=>e);expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2);expect(error.message).toBe('QUOTA')
 expect(error.recovery.durability).toBe('UNCONFIRMED');expect((await nativePublicReadPaidRecordFromOriginalV2(error.recovery.text,x.scope.soulId)).packet.digest).toBe(error.recovery.digest)
 expect(await x.journal.read(x.key)).toBeNull();expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})
it('abort during a delayed persist-then-reject keeps old and new writers blocked until settlement, then cold recovery sees the saved original',async()=>{
 const x=await fixture(),raw=window.localStorage;let entered!:()=>void,fail!:(e:Error)=>void;const began=new Promise<void>(r=>entered=r)
 const journal=browserNativePublicReadPaidJournalV2(storageWith(async(k,v)=>{raw.setItem(k,v);entered();await new Promise<void>((_,no)=>fail=no)})),host=createNativePublicReadPaidHostPreflightV2({journal}),controller=new AbortController()
 const first=host({...x.input,qualification:{...x.input.qualification,signal:controller.signal}});await began;controller.abort()
 await expect(x.host(x.input)).rejects.toThrow('ASSET_BUSY')
 const old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 await expect(runSoulAccess({plan:old.plan,store:browserSoulAccessStore(),adapter:old.adapter})).rejects.toThrow('ASSET_BUSY')
 fail(Error('ACK_LOST'));const error=await first.catch(e=>e);expect(error.recovery.durability).toBe('UNCONFIRMED');expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
 const cold=await x.host(x.input).catch(e=>e);expect(cold.recovery.text).toBe(error.recovery.text);expect(cold.recovery.durability).toBe('CONFIRMED')
})
it('simulation failure retains the complete PREPARED original and never opens a new attempt on reentry',async()=>{
 const x=await fixture();x.client.transactionExecutionService.simulateTransaction.mockRejectedValue(Error('SIMULATION_UNAVAILABLE'))
 const error=await x.host(x.input).catch(e=>e);expect(error.recovery.durability).toBe('CONFIRMED');expect((await x.journal.read(x.key))?.plan.originalText).toBe(error.recovery.text)
 const cold=await x.host(x.input).catch(e=>e);expect(cold.recovery.text).toBe(error.recovery.text);expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('strict async V2 parser rejects wrapper scope/packet/phase/original-format changes after await',async()=>{
 const x=await fixture(),result=await x.host(x.input),record=await nativePublicReadPaidRecordFromOriginalV2(result.retainedText,x.scope.soulId)
 for(const mutated of [
  {...record,plan:{...record.plan,author:'0x'+'1'.repeat(64)}},
  {...record,packet:{...record.packet,bytes:record.packet.bytes+'AA'}},
  {...record,packet:{...record.packet,phase:'SIGNED',signature:null}},
  {...record,plan:{...record.plan,originalText:JSON.stringify({...JSON.parse(result.retainedText),packet:{...record.packet,phase:'CANCELLED'}})}},
  {...record,unknown:true},
 ])await expect(parseNativePublicReadPaidRecordV2(mutated)).rejects.toThrow()
 expect(publicMutationCanonical(await x.journal.read(x.key))).toBe(publicMutationCanonical(record))
})
it('does not let an alleged legacy FAILED release the new Host without original checkpoint membership',async()=>{
 const x=await fixture(),old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 old.effects.V2!.status={$kind:'Failure',Failure:{error:{$kind:'InsufficientGas',InsufficientGas:true},command:null}}
 const failed=parseSoulAccessRecord({...old.record,packet:{...old.record.packet,phase:'FAILED'}});await installLegacy(failed)
 x.client.ledgerService.getTransaction=old.client.ledgerService.getTransaction
 x.client.ledgerService.getCheckpoint=vi.fn(async()=>{throw Error('CHECKPOINT_UNAVAILABLE')})
 const error=await x.host(x.input).catch(e=>e);expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2);expect(error.message).toContain('Ledger read failed')
 expect(x.client.ledgerService.getCheckpoint).toHaveBeenCalledOnce();expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled();expect(await x.journal.read(x.key)).toBeNull()
})
it('authenticated FAILED legacy outcome can release only after actual original checkpoint membership',async()=>{
 const x=await fixture(),old=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent',soulId:x.params.soulId})
 old.effects.V2!.status={$kind:'Failure',Failure:{error:{$kind:'InsufficientGas',InsufficientGas:true},command:null}};old.effects.V2!.executedEpoch='5'
 await installLegacy(parseSoulAccessRecord({...old.record,packet:{...old.record.packet,phase:'FAILED'}}))
 x.client.ledgerService.getTransaction=old.client.ledgerService.getTransaction;x.client.ledgerService.getCheckpoint=old.client.ledgerService.getCheckpoint
 expect((await x.host(x.input)).preflight.notSignedOrExecuted).toBe(true);expect(x.client.ledgerService.getCheckpoint).toHaveBeenCalledOnce()
})
it('unsigned CANCELLED V2 plus original MISSING permits an explicit different attempt, archiving exact original before replacement',async()=>{
 const x=await fixture(),first=await x.host(x.input),record=(await x.journal.read(x.key))!
 const cancelled={...record,packet:{...record.packet,phase:'CANCELLED' as const}};await x.journal.exclusive(x.key,()=>x.journal.write(x.key,cancelled))
 x.input.attempt=new Uint8Array(32).fill(2)
 const next=await x.host(x.input)
 expect(next.preflight.prepared.packet.digest).not.toBe(first.preflight.prepared.packet.digest)
 expect(await x.journal.history(x.key)).toEqual([cancelled]);expect((await x.journal.read(x.key))?.plan.originalText).toBe(next.retainedText)
})
it('cancelled packet cannot be resurrected with the same attempt or silently replaced after a failed archive',async()=>{
 const x=await fixture();await x.host(x.input);const record=(await x.journal.read(x.key))!,cancelled={...record,packet:{...record.packet,phase:'CANCELLED' as const}}
 await x.journal.exclusive(x.key,()=>x.journal.write(x.key,cancelled));const before=window.localStorage.getItem(x.key)
 await expect(x.host(x.input)).rejects.toThrow('PREVIOUS_PACKET_REUSE');expect(window.localStorage.getItem(x.key)).toBe(before)
 const raw=window.localStorage,journal=browserNativePublicReadPaidJournalV2(storageWith((k,v)=>{if(k.includes(':history:'))throw Error('ARCHIVE_QUOTA');raw.setItem(k,v)}))
 await expect(createNativePublicReadPaidHostPreflightV2({journal})({...x.input,attempt:new Uint8Array(32).fill(2)})).rejects.toThrow('ARCHIVE_QUOTA')
 expect(window.localStorage.getItem(x.key)).toBe(before);expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('contradictory V2 payout cannot release a fresh request or promote its journal phase',async()=>{
 const x=await fixture(),old=await purchaseRecoveryFixture('v2','money-payout'),record=await nativePublicReadPaidRecordFromOriginalV2(old.text,old.soulId),key=nativePublicReadPaidKeyV2(record.plan)
 await x.journal.exclusive(key,()=>x.journal.write(key,record))
 const client={...x.client,ledgerService:{...x.client.ledgerService,...old.client.ledgerService}},q={...x.input.qualification,client,soulId:record.plan.soulId,buyer:record.plan.author,economics:{...x.input.qualification.economics,chainIdentifier:record.plan.chainIdentifier}}
 // Prior original governs recovery even when a later selection is supplied.
 const error=await x.host({...x.input,qualification:q,getBuyerAddress:()=>record.plan.author}).catch(e=>e)
 expect(error).toBeInstanceOf(NativePublicReadPaidHostRecoveryErrorV2);expect(error.message).toContain('PUBLIC_PAID_V2_MONEY_BENEFICIARY');expect(error.recovery.text).toBe(old.text)
 expect((await x.journal.read(key))?.packet.phase).toBe('PREPARED');expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled();expect(x.client.core.simulateTransaction).not.toHaveBeenCalled()
})
