import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Transaction} from '@mysten/sui/transactions'
import {fromHex,fromBase58,toBase58,normalizeStructTag,normalizeSuiAddress} from '@mysten/sui/utils'
import {profileReadStep} from '@soulidity/sdk'
import {readPinnedMovePackage,type PinnedMovePackage} from '../sui/pinned-move-package'
import {MAINNET_GENESIS_DIGEST} from '../animacraft/mainnet-chain'
import {parseNativeCreationEnvelope,type NativeCreationEnvelope} from './native-creation-envelope'
import type {BrowserContentSealConfig} from './browser-content-open'
const POLICY='seal_approve_content_owner_v2'
function check(v:unknown,c:string):asserts v {if(!v)throw Error(`NATIVE_OWNER_APPROVAL_V2_${c}`)}
type Parameter=Awaited<ReturnType<SuiGrpcClient['core']['getMoveFunction']>>['function']['parameters'][number]
function signature(p:Parameter):string{
 const b=p.body,inner=b.$kind==='datatype'?normalizeStructTag(b.datatype.typeName+(b.datatype.typeParameters.length?`<${b.datatype.typeParameters.map(body=>signature({reference:null,body})).join(',')}>`:'')):b.$kind==='vector'?`vector<${signature({reference:null,body:b.vector})}>`:b.$kind
 return(p.reference===null?'':p.reference==='immutable'?'&':p.reference==='mutable'?'&mut ':'?')+inner
}
/** Actual immutable package and exact callable interface only. Never guesses a
 * Host from a State or routes v1 content through the v2 ABI. Must run before a
 * Seal session or wallet message. Does not attest code/authority/deployment. */
export async function verifyNativeOwnerContentApprovalV2Interface(input:{client:SuiGrpcClient;native:PinnedMovePackage;custody:PinnedMovePackage;signal:AbortSignal}){
 const signal=input.signal,pin=structuredClone(input.native),custodyPin=structuredClone(input.custody),source=input.client
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction.bind(source.core)},
  ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
 signal.throwIfAborted()
 check((await profileReadStep(signal,()=>client.core.getChainIdentifier())).chainIdentifier===MAINNET_GENESIS_DIGEST,'CHAIN')
 const pkg=await readPinnedMovePackage(client,pin,signal),origin=pkg.origins.get('birth::PublicReadHostV2')
 check(origin,'HOST_TYPE_ORIGIN')
 const custody=await readPinnedMovePackage(client,custodyPin,signal),accountOrigin=custody.origins.get('account::Account'),link=pkg.linkage.get(custodyPin.originalPackageId)
 check(accountOrigin,'ACCOUNT_TYPE_ORIGIN')
 check(link&&link.upgradedId===custodyPin.callablePackageId&&link.upgradedVersion===String(custody.version),'CUSTODY_LINKAGE')
 const accountType=normalizeStructTag(`${accountOrigin}::account::Account`)
 const fn=(await profileReadStep(signal,()=>client.core.getMoveFunction({packageId:pin.callablePackageId,moduleName:'birth',name:POLICY,signal}))).function
 const hostType=normalizeStructTag(`${origin}::birth::PublicReadHostV2`)
 const expected=['vector<u8>',`&mut ${normalizeStructTag('0x2::kiosk::Kiosk')}`,`&${accountType}`,`&${hostType}`,'u64',`&${normalizeStructTag('0x2::tx_context::TxContext')}`]
 check(normalizeSuiAddress(fn.packageId)===pin.callablePackageId&&fn.moduleName==='birth'&&fn.name===POLICY
  &&fn.visibility==='public'&&fn.typeParameters.length===0&&fn.returns.length===0&&JSON.stringify(fn.parameters.map(signature))===JSON.stringify(expected),'INTERFACE')
 signal.throwIfAborted()
 return{pin:pkg.pin,custodyPin:custody.pin,hostType,accountType,policy:POLICY,requiresCurrentHostRecordCustodyAndOwnedAccountProof:true as const,notAuthorization:true as const,notDeploymentAcceptance:true as const}
}
export type NativeOwnerReadSharedRef={objectId:string;initialSharedVersion:string;mutable:boolean}
export type NativeOwnerReadAccountRef={objectId:string;version:string;digest:string}
const u64=(v:unknown,zero=false):v is string=>typeof v==='string'&&(zero?/^(0|[1-9][0-9]{0,19})$/:/^[1-9][0-9]{0,19}$/).test(v)&&BigInt(v)<=18446744073709551615n
const objectId=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>6n
function digest(v:unknown){try{return typeof v==='string'&&v.length<=44&&fromBase58(v).length===32&&toBase58(fromBase58(v))===v}catch{return false}}
/** Unsigned transaction KIND only. The caller must first use an actual reader
 * to bind the current root/Host/Record and owned Account to its current owner.
 * Ref syntax is not ownership proof. Actual Account/source-module and namespace
 * authorization remains the on-chain policy; this neither signs nor broadcasts.
 */
export function buildNativeOwnerContentApprovalV2(input:{nativeOriginalPackageId:string;nativeCallablePackageId:string;envelope:NativeCreationEnvelope;
 config:BrowserContentSealConfig;recordVersion:string;recordIndex:string;kiosk:NativeOwnerReadSharedRef;host:NativeOwnerReadSharedRef;account:NativeOwnerReadAccountRef}){
 const {nativeOriginalPackageId,nativeCallablePackageId,recordIndex,recordVersion}=input
 const kiosk=structuredClone(input.kiosk),host=structuredClone(input.host),account=structuredClone(input.account)
 const e=parseNativeCreationEnvelope(input.envelope,input.config,recordVersion)
 check(objectId(nativeOriginalPackageId)&&e.sealPackageId===nativeOriginalPackageId,'ENVELOPE_PACKAGE')
 check(objectId(nativeCallablePackageId),'PACKAGE');check(u64(recordIndex,true),'INDEX')
 for(const [ref,mutable] of [[kiosk,true],[host,false]] as const){
  check(ref&&Object.keys(ref).sort().join(',')==='initialSharedVersion,mutable,objectId'&&objectId(ref.objectId)&&u64(ref.initialSharedVersion)&&ref.mutable===mutable,'SHARED_REF')
 }
 check(account&&Object.keys(account).sort().join(',')==='digest,objectId,version'&&objectId(account.objectId)&&u64(account.version)&&digest(account.digest),'ACCOUNT_REF')
 check(new Set([kiosk.objectId,host.objectId,account.objectId]).size===3,'ROLES')
 const tx=new Transaction()
 tx.moveCall({target:`${nativeCallablePackageId}::birth::${POLICY}`,arguments:[tx.pure.vector('u8',fromHex(e.documentId)),tx.sharedObjectRef(kiosk),tx.objectRef(account),tx.sharedObjectRef(host),tx.pure.u64(recordIndex)]})
 return tx
}
