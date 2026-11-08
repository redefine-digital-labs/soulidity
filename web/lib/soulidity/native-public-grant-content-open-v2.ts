import {SealClient,SessionKey,type SealCompatibleClient} from '@mysten/seal'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {fromBase64,toHex} from '@mysten/sui/utils'
import {blobIdFromInt} from '@mysten/walrus'
import {sha256} from '@noble/hashes/sha2.js'
import {profileReadStep} from '@soulidity/sdk'
import {MAINNET_GENESIS_DIGEST} from '../animacraft/mainnet-chain'
import {parseCanonicalNativeWorkbenchTarget,type CanonicalNativeWorkbenchTarget} from './canonical-native-workbench'
import {fetchBrowserContentBytes,validateBrowserContentSealConfig,type BrowserContentSealConfig} from './browser-content-open'
import {parseNativeCreationEnvelope} from './native-creation-envelope'
import {readNativePublicGrantV2} from './native-public-grant-read-v2'
import {verifyNativeGrantContentApprovalV2Interface,buildNativeGrantContentApprovalV2} from './native-grant-content-approval-v2'
function check(v:unknown,c:string):asserts v {if(!v)throw Error(`NATIVE_PUBLIC_GRANT_OPEN_V2_${c}`)}
/** Explicit candidate schema2 Grant content read. Actual Authorization/Grant,
 * locked Kiosk and Host are rechecked before and after wallet/Seal steps. Uses
 * a personal-message session only, with no payment, broadcast or plaintext
 * persistence. Live Grant policy remains authority; candidate adoption and
 * source qualification are required before release activation. */
export async function openNativePublicGrantContentV2(input:{client:SuiGrpcClient;sealClient:SealCompatibleClient;target:CanonicalNativeWorkbenchTarget;
 soulId:string;recordIndex:number;viewerAddress:string;blobBaseUrl:string;sealConfig:BrowserContentSealConfig;signal:AbortSignal;
 getAddress:()=>string|null;signPersonalMessage:(message:Uint8Array)=>Promise<string>},dependencies:{fetcher?:typeof fetch}={}){
 const target=parseCanonicalNativeWorkbenchTarget(input.target),config=validateBrowserContentSealConfig(input.sealConfig)
 const {client:sourceClient,sealClient,signal,soulId,recordIndex,viewerAddress:viewer,getAddress,signPersonalMessage}=input,deps={...dependencies},base=new URL(input.blobBaseUrl)
 const client={core:{getChainIdentifier:sourceClient.core.getChainIdentifier.bind(sourceClient.core),getMoveFunction:sourceClient.core.getMoveFunction.bind(sourceClient.core)},ledgerService:{getObject:sourceClient.ledgerService.getObject.bind(sourceClient.ledgerService)}} as unknown as SuiGrpcClient
 const sealChain=sealClient.core.getChainIdentifier.bind(sealClient.core)
 check(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash,'AGGREGATOR')
 check(/^0x[0-9a-f]{64}$/.test(viewer)&&BigInt(viewer)>0n,'VIEWER')
 const guard=()=>{signal.throwIfAborted();check(getAddress()===viewer,'WALLET_CHANGED')}
 const step=async<T>(work:()=>Promise<T>,discard?:(v:T)=>void):Promise<T>=>{guard();const value=await profileReadStep(signal,work,discard);try{guard();return value}catch(e){discard?.(value);throw e}}
 const read=()=>step(()=>readNativePublicGrantV2({client,target,soulId,recordIndex,viewerAddress:viewer,signal}))
 const snapshot=await read(),r=snapshot.record
 check(snapshot.soulId===soulId&&snapshot.recordIndex===recordIndex&&!r.deleted&&!r.purged&&(BigInt(r.read_mask)&2n)!==0n&&snapshot.viewerAddress===viewer,'RECORD')
 const envelope=parseNativeCreationEnvelope(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.envelope)),config,r.version)
 check(envelope.sealPackageId===target.native.originalPackageId&&envelope.contentId===snapshot.contentId&&envelope.kind===r.kind&&envelope.name===r.name
  &&envelope.nonce===toHex(r.nonce)&&envelope.documentId===snapshot.namespace,'ENVELOPE')
 await step(()=>verifyNativeGrantContentApprovalV2Interface({client,native:target.native,signal}))
 // Clock advances normally. Other returned identities/references must remain
 // identical; the freshly executed policy is responsible for current expiry.
 const stable=(value:typeof snapshot)=>{const {clockTimestampMs:_,...rest}=value;return JSON.stringify(rest)}
 const original=stable(snapshot)
 const verify=async()=>{check(stable(await read())===original,'SOURCE_CHANGED');check((await step(()=>sealChain())).chainIdentifier===MAINNET_GENESIS_DIGEST,'SEAL_CHAIN')}
 const blobId=blobIdFromInt(BigInt(r.reference.blob_id)),artifact={walrusBlobId:blobId,blobObjectId:r.reference.object,byteLength:r.reference.bytes,endEpoch:r.reference.end_epoch,walrusBlobUrl:`${base.href.replace(/\/$/,'')}/v1/blobs/${blobId}`}
 let ciphertext:Uint8Array|undefined,material:Uint8Array|undefined,plaintext:Uint8Array|undefined
 const wrapped=fromBase64(envelope.encryptedDek)
 try{
  ciphertext=await step(()=>fetchBrowserContentBytes({artifact},signal,deps.fetcher),b=>b.fill(0));check(toHex(sha256(ciphertext))===toHex(r.reference.sha256),'CIPHERTEXT_HASH');await verify()
  const seal=new SealClient({suiClient:sealClient,serverConfigs:config.serverConfigs,verifyKeyServers:true,timeout:10000});await step(()=>seal.getKeyServers())
  const tx=buildNativeGrantContentApprovalV2({nativeOriginalPackageId:target.native.originalPackageId,nativeCallablePackageId:target.native.callablePackageId,
   envelope,config,recordVersion:r.version,recordIndex:String(recordIndex),kiosk:snapshot.shared.kiosk,host:snapshot.shared.host,clock:snapshot.shared.clock});tx.setSender(viewer)
  const txBytes=await step(()=>tx.build({client,onlyTransactionKind:true}))
  const session=await step(()=>SessionKey.create({address:viewer,packageId:envelope.sealPackageId,ttlMin:config.ttlMin,suiClient:sealClient}));await verify()
  const signature=await step(()=>signPersonalMessage(session.getPersonalMessage()));await step(()=>session.setPersonalMessageSignature(signature));await verify()
  material=await step(()=>seal.decrypt({data:wrapped,sessionKey:session,txBytes,checkShareConsistency:true}),b=>b.fill(0))
  await verify()
  check(material.length===64&&toHex(material.subarray(32))===envelope.contentHash,'KEY_HASH')
  const key=await step(()=>crypto.subtle.importKey('raw',new Uint8Array(material!.subarray(0,32)),{name:'AES-GCM'},false,['decrypt']))
  await verify()
  plaintext=await step(async()=>new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(fromBase64(envelope.iv))},key,new Uint8Array(ciphertext!))),b=>b.fill(0))
  check(toHex(sha256(plaintext))===envelope.contentHash,'PLAINTEXT_HASH');await verify();guard()
  const result={bytes:plaintext,fileName:envelope.fileName,mimeType:envelope.mimeType};plaintext=undefined;return result
 }finally{ciphertext?.fill(0);material?.fill(0);plaintext?.fill(0);wrapped.fill(0)}
}
