import { captureMakerProductIncomeClient } from './maker-product-income-client'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag,normalizeSuiAddress} from '@mysten/sui/utils'
import {profileReadStep} from '@soulidity/sdk'
import {readPinnedMovePackage,type PinnedMovePackage} from '../../sui/pinned-move-package'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {commerceCheck} from './economics-read'
type Signature=Awaited<ReturnType<SuiGrpcClient['core']['getMoveFunction']>>['function']['parameters'][number]
function signature(s:Signature,depth=0):string{
 commerceCheck(depth<=8,'MAKER_INCOME_ABI_TYPE_DEPTH');const b=s.body;let inner:string
 if(b.$kind==='datatype'){
  const base=normalizeStructTag(b.datatype.typeName);commerceCheck(!base.includes('<')&&b.datatype.typeParameters.length<=8,'MAKER_INCOME_ABI_TYPE_SHAPE')
  inner=base+(b.datatype.typeParameters.length?`<${b.datatype.typeParameters.map(body=>signature({reference:null,body},depth+1)).join(',')}>`:'')
 }else if(b.$kind==='vector')inner=`vector<${signature({reference:null,body:b.vector},depth+1)}>`
 else if(b.$kind==='typeParameter')inner=`T${b.index}`
 else inner=b.$kind
 return(s.reference===null?'':s.reference==='mutable'?'&mut ':s.reference==='immutable'?'&':'?')+inner
}
/** Exact explicitly pinned public withdraw_income interface only. This does
 * not qualify source semantics, grant Control authority, simulate execution or
 * authorize any wallet/journal operation. No old operation is reconstructed.
 */
export async function verifyMakerProductIncomeInterface(input:{client:SuiGrpcClient;manufacturing:PinnedMovePackage;signal:AbortSignal}){
 const pin=structuredClone(input.manufacturing),source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(30000)])
 const client=captureMakerProductIncomeClient(source)
 commerceCheck((await profileReadStep(signal,()=>client.core.getChainIdentifier())).chainIdentifier===MAINNET_GENESIS_DIGEST,'MAKER_INCOME_ABI_CHAIN')
 const pkg=await readPinnedMovePackage(client,pin,signal)
 const type=(name:string)=>{const origin=pkg.origins.get(`maker_catalog::${name}`);commerceCheck(origin,'MAKER_INCOME_ABI_ORIGIN');return normalizeStructTag(`${origin}::maker_catalog::${name}`)}
 const productType=type('Product'),controlType=type('Control'),ctx=normalizeStructTag('0x2::tx_context::TxContext')
 const expected=[`&mut ${productType}<T0>`,`&mut ${controlType}`,'u64','u64','address','vector<u8>',`&mut ${ctx}`]
 const fn=structuredClone((await profileReadStep(signal,()=>client.core.getMoveFunction({packageId:pin.callablePackageId,moduleName:'maker_catalog',name:'withdraw_income',signal}))).function)
 commerceCheck(fn&&normalizeSuiAddress(fn.packageId)===pin.callablePackageId&&fn.moduleName==='maker_catalog'&&fn.name==='withdraw_income'
  &&fn.visibility==='public'&&fn.isEntry===false&&fn.typeParameters.length===1&&fn.typeParameters[0].constraints.length===0&&fn.typeParameters[0].isPhantom===false
  &&fn.parameters.length===expected.length&&fn.returns.length===0&&JSON.stringify(fn.parameters.map(s=>signature(s)))===JSON.stringify(expected),'MAKER_INCOME_ABI_SIGNATURE')
 signal.throwIfAborted()
 return {manufacturing:pkg.pin,productType,controlType,interfaceVerified:true as const,requiresQualifiedSource:true as const,notCurrentControlAuthority:true as const,notCheckedSimulation:true as const,notSigningQualification:true as const}
}
