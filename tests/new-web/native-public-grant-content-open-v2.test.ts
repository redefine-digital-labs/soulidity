import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromHex,toHex} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {SealClient} from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import {contentAppendPreparationFixture} from './fixtures/content-append-preparation'
import {grantOpenObjectsFixtureV2} from './fixtures/native-public-grant-content-open-v2'
import {aid} from './fixtures/activity-transaction-evidence'
import {encryptNativeCreationEnvelope} from '../../web/lib/soulidity/native-creation-envelope'
import {openNativePublicGrantContentV2} from '../../web/lib/soulidity/native-public-grant-content-open-v2'
afterEach(()=>vi.restoreAllMocks())
async function fixture(){
 const f=await contentAppendPreparationFixture(),x=await grantOpenObjectsFixtureV2(f.signer.toSuiAddress()),r=x.record,target=x.input.target
 const keyBytes=new Uint8Array(32).fill(5),iv=new Uint8Array(12).fill(6),key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt'])
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,f.params.plaintext)),seal=new SealClient({suiClient:f.client,serverConfigs:f.params.sealConfig.serverConfigs,verifyKeyServers:true})
 const envelope=await encryptNativeCreationEnvelope({sealPackageId:target.native.originalPackageId,contentId:x.host.state.content,kind:r.kind,name:r.name,nonce:toHex(r.nonce),contentHash:toHex(sha256(f.params.plaintext)),mimeType:'text/plain',fileName:'memory.md',dek:keyBytes,iv,config:f.params.sealConfig,signal:f.controller.signal,encrypt:a=>seal.encrypt(a)})
 r.envelope=new TextEncoder().encode(JSON.stringify(envelope));r.reference.sha256=sha256(ciphertext);r.reference.bytes=String(ciphertext.length);x.rewriteRecord()
 const primitive=(kind:string)=>({reference:null,body:{$kind:kind}}),datatype=(typeName:string)=>({reference:'immutable',body:{$kind:'datatype',datatype:{typeName,typeParameters:[]}}})
 const fn:any={packageId:target.native.callablePackageId,moduleName:'birth',name:'seal_approve_content_grant_v2',visibility:'public',typeParameters:[],returns:[],parameters:[{reference:null,body:{$kind:'vector',vector:{$kind:'u8'}}},datatype('0x2::kiosk::Kiosk'),datatype(`${x.f.nativeId}::birth::PublicReadHostV2`),primitive('u64'),datatype('0x2::clock::Clock'),datatype('0x2::tx_context::TxContext')]}
 const client={core:{...x.f.client.core,getMoveFunction:vi.fn(async()=>({function:fn}))},ledgerService:x.f.client.ledgerService} as any
 const input={client,sealClient:f.client,target,soulId:x.f.root.id,recordIndex:0,viewerAddress:x.viewer,blobBaseUrl:'https://walrus.example.com',sealConfig:f.params.sealConfig,signal:f.controller.signal,getAddress:f.params.wallet.getAddress,signPersonalMessage:f.sign}
 const fetcher=vi.fn(async()=>new Response(new Uint8Array(ciphertext)))
 return {f,x,fn,input,ciphertext,fetcher,run:()=>openNativePublicGrantContentV2(input,{fetcher})}
}
it('uses actual fullObject Grant reader, actual pinned interface and readonly grant kind with real AES',async()=>{
 const q=await fixture(),result=await q.run();expect(result.bytes).toEqual(q.f.params.plaintext);expect(q.f.sign).toHaveBeenCalledOnce()
 const graph=bcs.TransactionKind.parse(q.f.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!
 expect(graph.commands).toHaveLength(1);expect(graph.commands[0].MoveCall!.function).toBe('seal_approve_content_grant_v2');expect(graph.inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject.mutable]:[])).toEqual([false,false,false]);expect(q.f.unwrapped.every(v=>v.every(b=>b===0))).toBe(true);result.bytes.fill(0)
})
it.each(['expiry','revoke','generation','owner','scope','ABI','ciphertext','wallet','namespace'])('denies actual %s without asking for signature',async variant=>{
 const q=await fixture()
 if(variant==='expiry'){q.x.grant.expiry='100';q.x.rewrite()}
 if(variant==='revoke')q.x.f.rows.delete(q.x.grantId)
 if(variant==='generation'){q.x.auth.generation='1';q.x.rewrite()}
 if(variant==='owner'){q.x.grant.issuer=aid(999);q.x.rewrite()}
 if(variant==='scope'){q.x.grant.scope='2';q.x.rewrite()}
 if(variant==='ABI')q.fn.name='seal_approve_content_paid_v2'
 if(variant==='ciphertext')q.fetcher.mockImplementation(async()=>new Response(new Uint8Array(q.ciphertext.length)))
 if(variant==='wallet')q.f.setAddress(aid(999))
 if(variant==='namespace'){q.x.record.nonce=new Uint8Array(16);q.x.rewriteRecord()}
 await expect(q.run()).rejects.toThrow();expect(q.f.sign).not.toHaveBeenCalled();expect(q.f.decryptCall).not.toHaveBeenCalled()
})
it.each(['expiry','revoke','generation','wallet','source'])('rechecks %s changed during personal-message signing before decrypt',async variant=>{
 const q=await fixture(),sign=q.f.sign.getMockImplementation()!
 q.f.sign.mockImplementation(async message=>{const s=await sign(message)
 if(variant==='expiry')q.x.grant.expiry='100'
 if(variant==='generation')q.x.auth.generation='1'
 if(variant==='source')q.x.grant.sequence='1'
 q.x.rewrite()
 if(variant==='revoke')q.x.f.rows.delete(q.x.grantId)
 if(variant==='wallet')q.f.setAddress(aid(999))
 return s})
 await expect(q.run()).rejects.toThrow();expect(q.f.decryptCall).not.toHaveBeenCalled()
})
it('rechecks revocation after Seal decrypt and zeroes returned key material',async()=>{
 const q=await fixture(),decrypt=q.f.decryptCall.getMockImplementation()!
 q.f.decryptCall.mockImplementation(async a=>{const v=await decrypt(a);q.x.f.rows.delete(q.x.grantId);return v})
 await expect(q.run()).rejects.toThrow();expect(q.f.unwrapped.length).toBe(1);expect(q.f.unwrapped[0].every(b=>b===0)).toBe(true)
})

it('rejects wrong Seal chain before signing',async()=>{
 const q=await fixture();vi.mocked(q.f.client.core.getChainIdentifier).mockResolvedValue({chainIdentifier:'wrong'})
 await expect(q.run()).rejects.toThrow('SEAL_CHAIN');expect(q.f.sign).not.toHaveBeenCalled()
})
it('cancels before any fetch or personal message',async()=>{
 const q=await fixture();q.f.controller.abort();await expect(q.run()).rejects.toThrow();expect(q.fetcher).not.toHaveBeenCalled();expect(q.f.sign).not.toHaveBeenCalled()
})
it('clears plaintext when revocation is observed immediately after actual AES decrypt',async()=>{
 const q=await fixture(),original=crypto.subtle.decrypt.bind(crypto.subtle);let plaintext:ArrayBuffer|undefined
 vi.spyOn(crypto.subtle,'decrypt').mockImplementation(async(...args)=>{const result=await original(...args)
 if((args[0] as any).name==='AES-GCM'&&(args[2] as Uint8Array).byteLength===q.ciphertext.length){plaintext=result;q.x.f.rows.delete(q.x.grantId)}return result})
 await expect(q.run()).rejects.toThrow();expect(plaintext).toBeDefined();expect(new Uint8Array(plaintext!).every(b=>b===0)).toBe(true)
})
