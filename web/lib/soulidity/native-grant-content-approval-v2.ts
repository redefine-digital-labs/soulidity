import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Transaction} from '@mysten/sui/transactions'
import {fromHex,normalizeStructTag,normalizeSuiAddress} from '@mysten/sui/utils'
import {profileReadStep} from '@soulidity/sdk'
import {readPinnedMovePackage,type PinnedMovePackage} from '../sui/pinned-move-package'
import {MAINNET_GENESIS_DIGEST} from '../animacraft/mainnet-chain'
import {parseNativeCreationEnvelope,type NativeCreationEnvelope} from './native-creation-envelope'
import type {BrowserContentSealConfig} from './browser-content-open'
const POLICY='seal_approve_content_grant_v2'
function check(v:unknown,c:string):asserts v {if(!v)throw Error(`NATIVE_GRANT_APPROVAL_V2_${c}`)}
type Parameter=Awaited<ReturnType<SuiGrpcClient['core']['getMoveFunction']>>['function']['parameters'][number]
function signature(p:Parameter):string{
 const b=p.body,inner=b.$kind==='datatype'?normalizeStructTag(b.datatype.typeName+(b.datatype.typeParameters.length?`<${b.datatype.typeParameters.map(body=>signature({reference:null,body})).join(',')}>`:'')):b.$kind==='vector'?`vector<${signature({reference:null,body:b.vector})}>`:b.$kind
 return(p.reference===null?'':p.reference==='immutable'?'&':p.reference==='mutable'?'&mut ':'?')+inner
}
/** Actual immutable package and exact callable interface only. Never guesses a
 * Host from a State or routes v1 content through the v2 ABI. Must run before a
 * Seal session or wallet message. Does not attest code/authority/deployment. */
export async function verifyNativeGrantContentApprovalV2Interface(input:{client:SuiGrpcClient;native:PinnedMovePackage;signal:AbortSignal}){
 const signal=input.signal,pin=structuredClone(input.native),source=input.client
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction.bind(source.core)},
  ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
 signal.throwIfAborted()
 check((await profileReadStep(signal,()=>client.core.getChainIdentifier())).chainIdentifier===MAINNET_GENESIS_DIGEST,'CHAIN')
 const pkg=await readPinnedMovePackage(client,pin,signal),origin=pkg.origins.get('birth::PublicReadHostV2')
 check(origin,'HOST_TYPE_ORIGIN')
 const fn=(await profileReadStep(signal,()=>client.core.getMoveFunction({packageId:pin.callablePackageId,moduleName:'birth',name:POLICY,signal}))).function
 const hostType=normalizeStructTag(`${origin}::birth::PublicReadHostV2`)
 const expected=['vector<u8>',`&${normalizeStructTag('0x2::kiosk::Kiosk')}`,`&${hostType}`,'u64',`&${normalizeStructTag('0x2::clock::Clock')}`,`&${normalizeStructTag('0x2::tx_context::TxContext')}`]
 check(normalizeSuiAddress(fn.packageId)===pin.callablePackageId&&fn.moduleName==='birth'&&fn.name===POLICY
  &&fn.visibility==='public'&&fn.typeParameters.length===0&&fn.returns.length===0&&JSON.stringify(fn.parameters.map(signature))===JSON.stringify(expected),'INTERFACE')
 signal.throwIfAborted()
 return{pin:pkg.pin,hostType,policy:POLICY,requiresCurrentHostRecordCustodyAndGrantProof:true as const,notAuthorization:true as const,notDeploymentAcceptance:true as const}
}
export type NativeGrantReadSharedRef={objectId:string;initialSharedVersion:string;mutable:false}
/** Unsigned Seal transaction KIND only: no gas, payment, Account or owner cap.
 * This is the Grant policy only, with no owner/paid fallback. Shared refs must
 * come from the verified live Host/Kiosk/Clock reader. Actual
 * record namespace, live policy, Grant and custody are enforced on chain.
 */
export function buildNativeGrantContentApprovalV2(input:{nativeOriginalPackageId:string;nativeCallablePackageId:string;envelope:NativeCreationEnvelope;
 config:BrowserContentSealConfig;recordVersion:string;recordIndex:string;kiosk:NativeGrantReadSharedRef;host:NativeGrantReadSharedRef;clock:NativeGrantReadSharedRef}){
 const captured=structuredClone(input)
 input=captured
 check(typeof input.recordVersion==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(input.recordVersion)&&BigInt(input.recordVersion)<=18446744073709551615n,'VERSION')
 const e=parseNativeCreationEnvelope(input.envelope,input.config,input.recordVersion)
 check(/^0x[0-9a-f]{64}$/.test(input.nativeOriginalPackageId)&&BigInt(input.nativeOriginalPackageId)>3n&&e.sealPackageId===input.nativeOriginalPackageId,'ENVELOPE_PACKAGE')
 check(/^0x[0-9a-f]{64}$/.test(input.nativeCallablePackageId)&&BigInt(input.nativeCallablePackageId)>3n,'PACKAGE')
 check(typeof input.recordIndex==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(input.recordIndex)&&BigInt(input.recordIndex)<=18446744073709551615n,'INDEX')
 const refs=[input.kiosk,input.host,input.clock].map(ref=>{
  check(ref&&Object.keys(ref).sort().join(',')==='initialSharedVersion,mutable,objectId'
   &&/^0x[0-9a-f]{64}$/.test(ref.objectId)&&BigInt(ref.objectId)!==0n&&ref.mutable===false
   &&typeof ref.initialSharedVersion==='string'&&/^[1-9][0-9]{0,19}$/.test(ref.initialSharedVersion)&&BigInt(ref.initialSharedVersion)<=18446744073709551615n,'SHARED_REF')
  return {...ref}
 })
 check(new Set(refs.map(r=>r.objectId)).size===3&&BigInt(refs[0].objectId)>6n&&BigInt(refs[1].objectId)>6n&&refs[2].objectId===normalizeSuiAddress('0x6')&&refs[2].initialSharedVersion==='1','ROLES')
 const tx=new Transaction()
 tx.moveCall({target:`${input.nativeCallablePackageId}::birth::${POLICY}`,arguments:[tx.pure.vector('u8',fromHex(e.documentId)),tx.sharedObjectRef(refs[0]),tx.sharedObjectRef(refs[1]),tx.pure.u64(input.recordIndex),tx.sharedObjectRef(refs[2])]})
 return tx
}
