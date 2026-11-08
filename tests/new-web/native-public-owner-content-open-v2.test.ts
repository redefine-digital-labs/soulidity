import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromHex,toHex} from '@mysten/sui/utils'
import {nativeAuthoringFixture} from './fixtures/native-authoring'
import {aid,adigest} from './fixtures/activity-transaction-evidence'
import {deriveNativeCreationContentId} from '../../web/lib/soulidity/native-creation-transaction'
import {openNativePublicOwnerContentV2} from '../../web/lib/soulidity/native-public-owner-content-open-v2'
afterEach(()=>vi.restoreAllMocks())
async function fixture(){
 const f=await nativeAuthoringFixture()
 f.request.target.nativeOriginalPackageId=aid(110);f.request.contentId=deriveNativeCreationContentId(f.request.target,f.request.author,f.request.mintNonce)
 f.request.slots.push({fileIndex:2,kind:3,name:'pet',nonce:'04'.repeat(16),readMask:'5',downloadPolicy:0,setActive:false})
 f.params.files.push({...f.params.files[0],file:new File([await f.params.files[0].file.arrayBuffer()],'pet.txt',{type:'text/plain'})})
 const preparation=await f.prepare(),envelope=preparation.envelopes[2].envelope,file=preparation.preparation.manifest.files[2],client=f.params.wallet.client
 const pin={originalPackageId:aid(90),callablePackageId:aid(91),callableDigest:adigest(9)}
 const target={chainIdentifier:'35834a8a',standard:pin,native:{originalPackageId:f.request.target.nativeOriginalPackageId,callablePackageId:f.request.target.nativeCallablePackageId,callableDigest:f.request.release.nativeCallableDigest},content:pin,custody:pin,registryId:f.request.target.registryId,configId:f.request.target.configId}
 const record={kind:3,name:'pet',version:'0',read_mask:'5',scope:'8',download_policy:1,deleted:false,purged:false,nonce:fromHex(envelope.nonce),envelope:new TextEncoder().encode(JSON.stringify(envelope)),
 reference:{blob_id:'1',object:aid(45),sha256:fromHex(file.payloadHash),bytes:String(file.payloadByteLength),end_epoch:15}}
 const ref=(objectId:string)=>({objectId,initialSharedVersion:'1',mutable:false as const})
 const snapshot:any={format:'native-public-read-v2',soulId:aid(44),recordIndex:0,contentId:f.request.contentId,record,namespace:envelope.documentId,ownerAddress:f.request.author,accountReference:{objectId:aid(46),version:'10',digest:adigest(3)},hostReference:{digest:adigest(2)},clockTimestampMs:'100',shared:{kiosk:ref(aid(42)),host:ref(aid(43)),clock:ref(aid(6))}}
 const read=vi.fn(async()=>structuredClone(snapshot)),interfaceProof=vi.fn(async()=>({}) as any),fetcher=vi.fn(async()=>new Response(new Uint8Array(preparation.preparation.payloads[2])))
 const input={client,sealClient:client,target,soulId:aid(44),recordIndex:0,viewerAddress:f.request.author,blobBaseUrl:'https://walrus.example.com',sealConfig:f.params.sealConfig,signal:f.controller.signal,getAddress:f.params.wallet.getAddress,signPersonalMessage:f.sign}
 return{f,input,record,snapshot,read,interfaceProof,fetcher,run:()=>openNativePublicOwnerContentV2(input as any,{read:read as any,interface:interfaceProof,fetcher})}
}
it('decrypts actual prepared ciphertext through the exact owner v2 Seal kind and real AES without any payment',async()=>{
 const x=await fixture(),result=await x.run()
 expect(result.downloadAllowed).toBe(true)
 expect(result.bytes).toEqual(new Uint8Array(await x.f.params.files[2].file.arrayBuffer()));expect(x.f.sign).toHaveBeenCalledOnce();expect(x.interfaceProof).toHaveBeenCalledOnce()
 const kind=bcs.TransactionKind.parse(x.f.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!,call=kind.commands[0].MoveCall!
 expect(call.function).toBe('seal_approve_content_owner_v2');expect(kind.commands).toHaveLength(1)
 expect(kind.inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject]:[]).map(r=>r.mutable)).toEqual([true,false])
 expect(kind.inputs.flatMap(i=>i.Object?.ImmOrOwnedObject?[i]:[])).toHaveLength(1)
 expect(x.f.unwrapped.every(v=>v.every(b=>b===0))).toBe(true);result.bytes.fill(0)
})
it.each(['owner-bit','deleted','account','owner','namespace','interface','ciphertext','wallet'])('rejects %s before asking for a personal-message signature',async variant=>{
 const x=await fixture()
 if(variant==='owner-bit')x.record.read_mask='4'
 if(variant==='deleted')x.record.deleted=true
 if(variant==='account')x.snapshot.accountReference=null
 if(variant==='owner')x.snapshot.ownerAddress=aid(99)
 if(variant==='namespace')x.snapshot.namespace='00'.repeat(32)
 if(variant==='interface')x.interfaceProof.mockRejectedValue(Error('UNADOPTED_INTERFACE'))
 if(variant==='ciphertext')x.fetcher.mockImplementation(async()=>new Response(new Uint8Array(Number(x.record.reference.bytes))))
 if(variant==='wallet')x.f.setAddress(aid(99))
 await expect(x.run()).rejects.toThrow();expect(x.f.sign).not.toHaveBeenCalled()
})
it('rechecks original Host reference after wallet signature and before decryption',async()=>{
 const x=await fixture(),sign=x.f.sign.getMockImplementation()!
 x.f.sign.mockImplementation(async(...args)=>{const result=await sign(...args);x.snapshot.hostReference.digest=adigest(99);return result})
 await expect(x.run()).rejects.toThrow('SOURCE_CHANGED');expect(x.f.decryptCall).not.toHaveBeenCalled()
})
it('does not treat normal Clock advancement as a content change',async()=>{
 const x=await fixture();let n=0;x.read.mockImplementation(async()=>({...structuredClone(x.snapshot),clockTimestampMs:String(100+n++)}))
 const result=await x.run();expect(toHex(result.bytes)).not.toBe('');result.bytes.fill(0)
})
it('surfaces actual policy denial without falling back to paid reads or returning content',async()=>{
 const x=await fixture();x.f.decryptCall.mockRejectedValue(Error('OWNER_POLICY_DENIED'))
 await expect(x.run()).rejects.toThrow('OWNER_POLICY_DENIED');expect(x.f.sign).toHaveBeenCalledOnce();expect(x.f.decryptCall).toHaveBeenCalledOnce()
})

it('rejects an Account changed after signing before decrypting',async()=>{
 const x=await fixture(),sign=x.f.sign.getMockImplementation()!
 x.f.sign.mockImplementation(async(...args)=>{const value=await sign(...args);x.snapshot.accountReference.digest=adigest(98);return value})
 await expect(x.run()).rejects.toThrow('SOURCE_CHANGED');expect(x.f.decryptCall).not.toHaveBeenCalled()
})
it('allows an owner-only record with zero paid scope',async()=>{
 const x=await fixture();x.record.read_mask='1';x.record.scope='0'
 const result=await x.run();expect(result.bytes.length).toBeGreaterThan(0);result.bytes.fill(0)
})
