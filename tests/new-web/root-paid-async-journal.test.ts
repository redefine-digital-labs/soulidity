import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {createAsyncPublicMutationStore,publicMutationCanonical,type AsyncPublicMutationStorage,type PublicMutationPacket} from '../../web/lib/sui/public-mutation-journal'

type RecordV2={schema:string;plan:{asset:string;originalText:string};packet:PublicMutationPacket}
const prefix='test.root-paid:',key=prefix+'asset'
const record=(digest='original'):RecordV2=>({schema:'test.v2',plan:{asset:'asset',originalText:'raw original bytes'},packet:{bytes:'exact-'+digest,digest,expirationEpoch:'6',phase:'PREPARED',signature:null}})
let dom:JSDOM
beforeEach(()=>{
 dom=new JSDOM('',{url:'https://journal.example.test'});vi.stubGlobal('window',dom.window);vi.stubGlobal('navigator',dom.window.navigator)
 const held=new Set<string>()
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,_options:unknown,work:(lock:unknown)=>unknown)=>{if(held.has(name))return work(null);held.add(name);try{return await work({name})}finally{held.delete(name)}}}})
})
afterEach(()=>{dom.window.close();vi.unstubAllGlobals()})
function fixture(storage:AsyncPublicMutationStorage=window.localStorage,parse=async(input:unknown)=>structuredClone(input) as RecordV2){
 return createAsyncPublicMutationStore({prefix,changedEvent:'root-paid-test',errorPrefix:'ASYNC_JOURNAL',key:p=>prefix+p.asset,parse,storage,
  classify:name=>{const parts=name.slice(prefix.length).split(':');if(parts.length!==1&&!(parts.length===4&&parts[1]==='history'))throw Error('OPAQUE_HEAD_KEY');return {headKey:prefix+parts[0],archived:parts.length===4}}})
}
async function install(r=record()){const s=fixture();await s.exclusive(key,async()=>{await s.write(key,r)});return s}
it('awaits async rejection before a first write can retain an invalid original',async()=>{
 const parse=vi.fn(async()=>{await Promise.resolve();throw Error('ORIGINAL_INVALID')});const s=fixture(window.localStorage,parse)
 await expect(s.exclusive(key,()=>s.write(key,record()))).rejects.toThrow('ORIGINAL_INVALID');expect(window.localStorage.length).toBe(0)
})
it('does not expose an unawaited parser result as a record on read, heads, or history',async()=>{
 const s=await install();await s.exclusive(key,async()=>{await s.write(key,{...record(),packet:{...record().packet,phase:'CANCELLED'}});await s.write(key,record('next'))})
 const parse=vi.fn(async()=>{await Promise.resolve();throw Error('CORRUPT_ASYNC_ORIGINAL')});const other=fixture(window.localStorage,parse)
 await expect(other.read(key)).rejects.toThrow('CORRUPT_ASYNC_ORIGINAL');await expect(other.heads()).rejects.toThrow('CORRUPT_ASYNC_ORIGINAL');await expect(other.history(key)).rejects.toThrow('CORRUPT_ASYNC_ORIGINAL')
})
it('rejects a head changed while its original was asynchronously validated',async()=>{
 await install();let enter!:()=>void,finish!:()=>void;const entered=new Promise<void>(r=>enter=r)
 const s=fixture(window.localStorage,async v=>{enter();await new Promise<void>(r=>finish=r);return v as RecordV2})
 const reading=s.read(key);await entered;window.localStorage.setItem(key,publicMutationCanonical(record('replacement')));finish()
 await expect(reading).rejects.toThrow('RECORD_CHANGED_DURING_PARSE')
})
it('storage rejection holds the actual head lock until the initiated write settles',async()=>{
 let enter!:()=>void,finish!:(e:Error)=>void;const entered=new Promise<void>(r=>enter=r),raw=window.localStorage
 const storage={get length(){return raw.length},key:(i:number)=>raw.key(i),getItem:(k:string)=>raw.getItem(k),setItem:async(k:string,v:string)=>{raw.setItem(k,v);enter();await new Promise<void>((_,no)=>finish=no)}}
 const s=fixture(storage),writing=s.exclusive(key,()=>s.write(key,record()));await entered
 await expect(fixture().exclusive(key,async()=>{})).rejects.toThrow('BUSY');finish(Error('ACK_LOST'))
 await expect(writing).rejects.toThrow('ACK_LOST');expect((await fixture().read(key))?.packet.digest).toBe('original')
})
it('readback mismatch fails without reporting the original durable',async()=>{
 const raw=window.localStorage,storage={get length(){return raw.length},key:(i:number)=>raw.key(i),getItem:(k:string)=>raw.getItem(k),setItem:(k:string,_v:string)=>raw.setItem(k,publicMutationCanonical(record('other')))}
 const s=fixture(storage);await expect(s.exclusive(key,()=>s.write(key,record()))).rejects.toThrow('PERSISTENCE_FAILED')
})
it('archives and reads back the original before replacing a cancelled head',async()=>{
 const s=await install(),cancelled={...record(),packet:{...record().packet,phase:'CANCELLED' as const}}
 await s.exclusive(key,async()=>{await s.write(key,cancelled);await s.write(key,record('next'))})
 expect(await fixture().history(key)).toEqual([cancelled]);expect(await fixture().read(key)).toEqual(record('next'))
})
it('archive refusal preserves the cancelled original as the current head',async()=>{
 const s=await install(),cancelled={...record(),packet:{...record().packet,phase:'CANCELLED' as const}};await s.exclusive(key,()=>s.write(key,cancelled))
 const raw=window.localStorage,storage={get length(){return raw.length},key:(i:number)=>raw.key(i),getItem:(k:string)=>raw.getItem(k),setItem:(k:string,v:string)=>{if(k.includes(':history:'))throw Error('QUOTA');raw.setItem(k,v)}}
 const other=fixture(storage);await expect(other.exclusive(key,()=>other.write(key,record('next')))).rejects.toThrow('QUOTA');expect(await s.read(key)).toEqual(cancelled)
})
it('cannot change immutable raw text or replace an unresolved packet',async()=>{
 const s=await install();await expect(s.exclusive(key,()=>s.write(key,{...record(),plan:{...record().plan,originalText:'reencoded'}}))).rejects.toThrow('RECOVERY_REQUIRED')
 await expect(s.exclusive(key,()=>s.write(key,record('new nonce')))).rejects.toThrow('RECOVERY_REQUIRED');expect(await s.read(key)).toEqual(record())
})
it('fails closed on an opaque domain head rather than silently omitting it',async()=>{
 window.localStorage.setItem(prefix+'asset:unknown','{}');await expect(fixture().heads()).rejects.toThrow('OPAQUE_HEAD_KEY')
})
it('supports a bounded full original larger than the legacy 300k record limit',async()=>{
 const r=record();r.plan.originalText='a'.repeat(490000);const s=await install(r);expect((await s.read(key))?.plan.originalText).toBe(r.plan.originalText)
})
