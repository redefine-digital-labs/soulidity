import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {browserNativePublicReadPaidJournalV2,browserNativePublicReadPaidOriginalReaderV2,nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2} from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import {createAsyncPublicMutationStore,type PublicMutationPacket} from '../../web/lib/sui/public-mutation-journal'
let dom:JSDOM
beforeEach(()=>{dom=new JSDOM('',{url:'https://original-reader.test'});vi.stubGlobal('window',dom.window);vi.stubGlobal('navigator',dom.window.navigator);const held=new Set<string>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(k:string,_o:unknown,work:(lock:unknown)=>unknown)=>{if(held.has(k))return work(null);held.add(k);try{return await work({name:k})}finally{held.delete(k)}}}})})
afterEach(()=>{dom.window.close();vi.unstubAllGlobals()})
async function fixture(){const x=await purchaseRecoveryFixture('v2'),record=await nativePublicReadPaidRecordFromOriginalV2(x.text,x.soulId),key=nativePublicReadPaidKeyV2(record.plan),journal=browserNativePublicReadPaidJournalV2();await journal.exclusive(key,()=>journal.write(key,record));return {...x,record,key,journal}}
it('discovers and exports the actual canonical original with no paid provider, current release, file, or WebLocks',async()=>{
 const x=await fixture(),before=window.localStorage.getItem(x.key);Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 const reader=browserNativePublicReadPaidOriginalReaderV2();expect(Object.keys(reader).sort()).toEqual(['heads','history','read'])
 expect(await reader.read(x.key)).toEqual(x.record);expect(await reader.heads()).toEqual([x.record]);expect((await reader.heads())[0].plan.originalText).toBe(x.text);expect(window.localStorage.getItem(x.key)).toBe(before)
 expect(()=>browserNativePublicReadPaidJournalV2()).toThrow('REQUIRES_STORAGE_AND_LOCKS')
})
it('readonly head lookup still parses original scope/bytes and rejects changed local original instead of exporting it as valid',async()=>{
 const x=await fixture(),raw=JSON.parse(window.localStorage.getItem(x.key)!);raw.plan.author='0x'+'1'.repeat(64);window.localStorage.setItem(x.key,JSON.stringify(raw));const before=window.localStorage.getItem(x.key)
 await expect(browserNativePublicReadPaidOriginalReaderV2().read(x.key)).rejects.toThrow();expect(window.localStorage.getItem(x.key)).toBe(before)
})
it('readonly discovery keeps unknown domain heads as visible errors without deleting or silently skipping them',async()=>{
 const x=await fixture(),opaque='soulidity.native-public-read-paid.v2:opaque';window.localStorage.setItem(opaque,'{}')
 await expect(browserNativePublicReadPaidOriginalReaderV2().heads()).rejects.toThrow('OPAQUE_HEAD_KEY');expect(window.localStorage.getItem(opaque)).toBe('{}')
 expect((await browserNativePublicReadPaidOriginalReaderV2().read(x.key))?.plan.originalText).toBe(x.text)
})
it('generic readonly capability cannot acquire a mutation lock or write, including with explicit offline storage',async()=>{
 type R={schema:string;plan:{id:string};packet:PublicMutationPacket};const values=new Map<string,string>(),setItem=vi.fn((k:string,v:string)=>{values.set(k,v)})
 const record:R={schema:'test',plan:{id:'one'},packet:{bytes:'bytes',digest:'digest',expirationEpoch:'1',phase:'PREPARED',signature:null}};values.set('test:one',JSON.stringify(record))
 const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem}
 vi.stubGlobal('window',undefined);vi.stubGlobal('navigator',undefined)
 const reader=createAsyncPublicMutationStore({prefix:'test:',changedEvent:'unused',errorPrefix:'TEST_READONLY',key:(p:{id:string})=>'test:'+p.id,parse:async(v:unknown)=>v as R,classify:(key:string)=>({headKey:key,archived:false}),readOnly:true,storage})
 expect(await reader.read('test:one')).toEqual(record);await expect(reader.write('test:one',record)).rejects.toThrow('READ_ONLY');await expect(reader.exclusive('test:one',async()=>{})).rejects.toThrow('READ_ONLY');expect(setItem).not.toHaveBeenCalled()
})
