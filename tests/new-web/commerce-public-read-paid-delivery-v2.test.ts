import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromHex} from '@mysten/sui/utils'
import {deriveNativeCreationContentId} from '../../web/lib/soulidity/native-creation-transaction'
import {nativeAuthoringFixture} from './fixtures/native-authoring'
import {aid,adigest} from './fixtures/activity-transaction-evidence'
import {openReusableNativePublicReadContentV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2'
import {openNativePublicPaidContentV2} from '../../web/lib/soulidity/native-public-paid-content-open-v2'
import {openNativePublicOwnerContentV2} from '../../web/lib/soulidity/native-public-owner-content-open-v2'
afterEach(()=>vi.restoreAllMocks())
async function fixture(owner=false){
 const f=await nativeAuthoringFixture();f.request.target.nativeOriginalPackageId=aid(110);f.request.contentId=deriveNativeCreationContentId(f.request.target,f.request.author,f.request.mintNonce);f.request.slots.push({fileIndex:2,kind:3,name:'pet',nonce:'04'.repeat(16),readMask:'5',downloadPolicy:0,setActive:false});f.params.files.push({...f.params.files[0],file:new File([await f.params.files[0].file.arrayBuffer()],'pet.txt',{type:'text/plain'})})
 const preparation=await f.prepare(),envelope=preparation.envelopes[2].envelope,file=preparation.preparation.manifest.files[2],client=f.params.wallet.client,pin={originalPackageId:aid(90),callablePackageId:aid(91),callableDigest:adigest(9)}
 const target={chainIdentifier:'35834a8a',standard:pin,custody:pin,native:{originalPackageId:f.request.target.nativeOriginalPackageId,callablePackageId:f.request.target.nativeCallablePackageId,callableDigest:f.request.release.nativeCallableDigest},content:pin,registryId:f.request.target.registryId,configId:f.request.target.configId}
 const record={kind:3,name:'pet',version:'0',read_mask:'5',scope:'8',deleted:false,purged:false,nonce:fromHex(envelope.nonce),envelope:new TextEncoder().encode(JSON.stringify(envelope)),reference:{blob_id:'1',object:aid(45),sha256:fromHex(file.payloadHash),bytes:String(file.payloadByteLength),end_epoch:15}}
 const ref=(objectId:string)=>({objectId,initialSharedVersion:'1',mutable:false as const}),snapshot:any={format:'native-public-read-v2',soulId:aid(44),recordIndex:0,contentId:f.request.contentId,record,namespace:envelope.documentId,ownerAddress:f.request.author,accountReference:{objectId:aid(46),version:'9',digest:adigest(9)},hostReference:{digest:adigest(2)},clockTimestampMs:'100',shared:{kiosk:ref(aid(42)),host:ref(aid(43)),clock:ref(aid(6))}}
 const qualification:any={format:'native-public-read-v2',buyer:f.request.author,soulId:aid(44),hostId:aid(43),stateId:aid(47),ledgerId:aid(48),recordIndex:0,kind:3,contentScope:'8',contentVersion:'0',namespace:envelope.documentId,owner:owner?f.request.author:aid(99),generation:'2',entryHash:owner?null:'01'.repeat(32),decision:{action:owner?'REUSE_OWNER':'REUSE_ENTRY'},recordReference:{objectId:aid(49),version:'9',digest:adigest(9)},hostReference:snapshot.hostReference,notAuthorization:true}
 const read=vi.fn(async()=>structuredClone(qualification)),readRecord=vi.fn(async()=>structuredClone(snapshot)),iface=vi.fn(async()=>({}) as any),fetcher=vi.fn(async()=>new Response(new Uint8Array(preparation.preparation.payloads[2])))
 const openPaid=vi.fn(async(input:any)=>openNativePublicPaidContentV2(input,{read:readRecord as any,interface:iface,fetcher})),openOwner=vi.fn(async(input:any)=>openNativePublicOwnerContentV2(input,{read:readRecord as any,interface:iface,fetcher}))
 const input:any={qualification:{format:'native-public-read-v2',client,target,economics:{chainIdentifier:'35834a8a',foundation:pin,configId:target.configId,coinType:'0x2::sui::SUI'},soulId:aid(44),buyer:f.request.author,kind:3,recordIndex:0,requiredScope:8n,signal:f.controller.signal},protected:{sealClient:client,blobBaseUrl:'https://walrus.example.com',sealConfig:f.params.sealConfig,getAddress:f.params.wallet.getAddress,signPersonalMessage:f.sign}}
 return {f,input,qualification,snapshot,record,read,openPaid,openOwner,run:()=>openReusableNativePublicReadContentV2(input,{read,openPaid,openOwner})}
}
it.each([false,true])('opens actual prepared ciphertext through real AES and correct controlled Seal policy; owner=%s',async owner=>{
 const x=await fixture(owner),result=await x.run();expect(result.status).toBe('CONTENT_OPENED')
 if(result.status!=='CONTENT_OPENED')throw Error('NO_CONTENT')
 expect(result.content.bytes).toEqual(new Uint8Array(await x.f.params.files[2].file.arrayBuffer()));expect(result).toMatchObject({accessPath:owner?'REUSE_OWNER':'REUSE_ENTRY',requiresQualifiedSourceAndFormatAdoption:true,notDurablePurchaseCompletion:true,notMainnetAcceptance:true})
 const call=bcs.TransactionKind.parse(x.f.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!.commands[0].MoveCall!
 expect(call.function).toBe(owner?'seal_approve_content_owner_v2':'seal_approve_content_paid_v2');expect(owner?x.openPaid:x.openOwner).not.toHaveBeenCalled();result.content.bytes.fill(0)
})
it.each(['PURCHASE_REQUIRED','BLOCKED'])('does not sign/open/pay from current decision %s',async action=>{
 const x=await fixture();x.qualification.decision={action,reason:'NO_SALE_OFFER'}
 expect(await x.run()).toMatchObject({status:'CURRENT_ACCESS_NOT_REUSABLE',notContentDelivered:true});expect(x.f.sign).not.toHaveBeenCalled();expect(x.openPaid).not.toHaveBeenCalled();expect(x.openOwner).not.toHaveBeenCalled()
})
it('does not route owner reuse through paid policy when owner read bit is absent',async()=>{
 const x=await fixture(true);x.record.read_mask='4'
 await expect(x.run()).rejects.toThrow('RECORD');expect(x.openPaid).not.toHaveBeenCalled();expect(x.f.sign).not.toHaveBeenCalled()
})
it('surfaces actual paid policy denial without owner fallback or automatic retry',async()=>{
 const x=await fixture();x.f.decryptCall.mockRejectedValue(Error('POLICY_DENIED'))
 await expect(x.run()).rejects.toThrow('POLICY_DENIED');expect(x.openOwner).not.toHaveBeenCalled();expect(x.f.decryptCall).toHaveBeenCalledOnce()
})
it.each(['generation','owner','entryHash','namespace','scope','decision'])('zeros opened bytes if current qualification %s changes before final delivery',async variant=>{
 const x=await fixture(),bytes=new Uint8Array([1,2,3]);x.openPaid.mockImplementation(async()=>{if(variant==='decision')x.qualification.decision={action:'PURCHASE_REQUIRED'};else x.qualification[variant==='scope'?'contentScope':variant]=variant==='generation'?'3':variant==='scope'?'16':aid(999);return {bytes,fileName:'test',mimeType:'text/plain'}})
 await expect(x.run()).rejects.toThrow('QUALIFICATION_CHANGED');expect([...bytes]).toEqual([0,0,0])
})
it('zeros opened bytes when final current reader fails',async()=>{
 const x=await fixture(),bytes=new Uint8Array([1]);x.openPaid.mockResolvedValue({bytes,fileName:'x',mimeType:'text/plain'});x.read.mockImplementationOnce(async()=>structuredClone(x.qualification)).mockRejectedValueOnce(Error('RPC_UNAVAILABLE'))
 await expect(x.run()).rejects.toThrow('RPC_UNAVAILABLE');expect(bytes[0]).toBe(0)
})
it('guards wallet and clears bytes returned after a wallet change',async()=>{
 const x=await fixture(),bytes=new Uint8Array([1]);x.openPaid.mockImplementation(async()=>{x.f.setAddress(aid(999));return {bytes,fileName:'x',mimeType:'text/plain'}})
 await expect(x.run()).rejects.toThrow('WALLET_CHANGED');expect(bytes[0]).toBe(0)
})
