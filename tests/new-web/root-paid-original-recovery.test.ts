import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {completePreflightFixture} from './fixtures/commerce-new-paid-preflight'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {createNativePublicReadPaidHostPreflightV2} from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import {browserNativePublicReadPaidJournalV2,nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2} from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import {discoverNativePublicReadPaidOriginalsV2,queryNativePublicReadPaidOriginalV2,cancelNativePublicReadPaidOriginalV2} from '../../web/lib/soulidity/native-public-read-paid-original-recovery-v2'
import {withSoulAccessAssetLock} from '../../web/lib/soulidity/soul-access-asset-lock'
let dom:JSDOM
beforeEach(()=>{dom=new JSDOM('',{url:'https://original-recovery.test'});vi.stubGlobal('window',dom.window);vi.stubGlobal('navigator',dom.window.navigator);const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(k:string,_o:unknown,work:(lock:unknown)=>unknown)=>{if(held.has(k))return work(null);held.add(k);try{return await work({name:k})}finally{held.delete(k)}}}})})
afterEach(()=>{dom.window.close();vi.unstubAllGlobals()})
async function fixture(){const x=await completePreflightFixture();x.client.ledgerService.getTransaction=vi.fn(async()=>{throw {code:'NOT_FOUND'}});x.client.ledgerService.getCheckpoint=vi.fn(async()=>{throw Error('UNEXPECTED_CHECKPOINT')});const result=await createNativePublicReadPaidHostPreflightV2()(x.input),record=await nativePublicReadPaidRecordFromOriginalV2(result.retainedText,x.params.soulId),key=nativePublicReadPaidKeyV2(record.plan),journal=browserNativePublicReadPaidJournalV2();return {...x,record,key,journal,result}}
const signal=()=>new AbortController().signal
it('cold discovery and original MISSING query work after paid input/config/wallet/core and WebLocks are absent',async()=>{
 const x=await fixture(),original=x.record.plan.originalText,client={ledgerService:x.client.ledgerService} as any;Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 const heads=await discoverNativePublicReadPaidOriginalsV2({chainIdentifier:'35834a8a',soulId:x.params.soulId,author:null});expect(heads).toEqual([x.record]);expect(heads[0].plan.originalText).toBe(original)
 expect(await queryNativePublicReadPaidOriginalV2({record:heads[0],client,signal:signal()})).toEqual({status:'MISSING'})
 await expect(cancelNativePublicReadPaidOriginalV2({record:heads[0],client,signal:signal()})).rejects.toThrow('REQUIRES_WEB_LOCKS');expect((await discoverNativePublicReadPaidOriginalsV2({...x.record.plan,author:x.buyer}))[0].plan.originalText).toBe(original)
})
it('discovery binds original chain, Soul and actor without treating an unrelated head as current permission',async()=>{
 const x=await fixture(),scope={chainIdentifier:'35834a8a',soulId:x.params.soulId,author:x.buyer}
 expect(await discoverNativePublicReadPaidOriginalsV2(scope)).toEqual([x.record])
 for(const changed of [{chainIdentifier:'deadbeef'},{soulId:'0x'+'1'.repeat(64)},{author:'0x'+'2'.repeat(64)}])expect(await discoverNativePublicReadPaidOriginalsV2({...scope,...changed})).toEqual([])
 expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
})
it('eligible local cancellation preserves exact original text/bytes after actual original MISSING and never creates or simulates another packet',async()=>{
 const x=await fixture(),result=await cancelNativePublicReadPaidOriginalV2({record:x.record,client:x.client,signal:signal()})
 expect(result).toMatchObject({original:{status:'MISSING'},record:{packet:{phase:'CANCELLED',signature:null}},notOnChainCancellation:true,notPermissionToRetryPayment:true})
 expect(result.record.plan.originalText).toBe(x.result.retainedText);expect(result.record.packet.bytes).toBe(x.record.packet.bytes);expect(await x.journal.read(x.key)).toEqual(result.record)
 expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce();expect(x.client.core.simulateTransaction.mock.calls.length).toBe(2)
})
it.each(['SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED'] as const)('never cancels original %s metadata into a fresh eligible operation',async phase=>{
 const x=await fixture(),current={...x.record,packet:{...x.record.packet,phase,signature:phase==='SIGNED'?'AA==':null}}
 await x.journal.exclusive(x.key,async()=>{if(phase==='SIGNED')await x.journal.write(x.key,{...x.record,packet:{...x.record.packet,phase:'SIGNING'}});await x.journal.write(x.key,current)})
 const before=window.localStorage.getItem(x.key)
 await expect(cancelNativePublicReadPaidOriginalV2({record:current,client:x.client,signal:signal()})).rejects.toThrow('CANNOT_CANCEL_SIGNING_OR_TERMINAL')
 expect(window.localStorage.getItem(x.key)).toBe(before);expect(x.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it('rejects a changed selected original before querying or writing a different current head',async()=>{
 const x=await fixture(),selected=structuredClone(x.record);selected.plan.originalText+='\n'
 await expect(cancelNativePublicReadPaidOriginalV2({record:selected,client:x.client,signal:signal()})).rejects.toThrow('SELECTED_ORIGINAL_CHANGED');expect(x.client.ledgerService.getTransaction).not.toHaveBeenCalled();expect(await x.journal.read(x.key)).toEqual(x.record)
})
it.each(['PENDING','SUBSCRIPTION_RECORDED'] as const)('actual original %s history does not authorize cancellation or phase promotion',async status=>{
 const x=await purchaseRecoveryFixture('v2'),record=await nativePublicReadPaidRecordFromOriginalV2(x.text,x.soulId),key=nativePublicReadPaidKeyV2(record.plan),journal=browserNativePublicReadPaidJournalV2();await journal.exclusive(key,()=>journal.write(key,record));if(status==='PENDING')delete x.finality.ledger.checkpoint
 expect((await queryNativePublicReadPaidOriginalV2({record,client:x.client,signal:signal()})).status).toBe(status)
 await expect(cancelNativePublicReadPaidOriginalV2({record,client:x.client,signal:signal()})).rejects.toThrow('ORIGINAL_RESULT_NOT_MISSING');expect(await journal.read(key)).toEqual(record)
})
it('cancel persists then loses ACK after stop: shared exclusion remains until write settles and cold discovery sees CANCELLED original',async()=>{
 const x=await fixture(),raw=window.localStorage;let enter!:()=>void,fail!:(e:Error)=>void;const entered=new Promise<void>(r=>enter=r)
 const journal=browserNativePublicReadPaidJournalV2({get length(){return raw.length},key:i=>raw.key(i),getItem:k=>raw.getItem(k),setItem:async(k,v)=>{raw.setItem(k,v);enter();await new Promise<void>((_,no)=>fail=no)}}),controller=new AbortController()
 const cancel=cancelNativePublicReadPaidOriginalV2({record:x.record,client:x.client,signal:controller.signal,journal});await entered;controller.abort()
 await expect(withSoulAccessAssetLock(x.record.plan,async()=>{})).rejects.toThrow('BUSY');fail(Error('CANCEL_ACK_LOST'));await expect(cancel).rejects.toThrow('CANCEL_ACK_LOST')
 const cold=(await discoverNativePublicReadPaidOriginalsV2({...x.record.plan,author:x.buyer}))[0];expect(cold.packet.phase).toBe('CANCELLED');expect(cold.plan.originalText).toBe(x.result.retainedText)
 await expect(withSoulAccessAssetLock(x.record.plan,async()=>42)).resolves.toBe(42)
})
