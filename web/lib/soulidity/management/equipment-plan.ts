import {Transaction} from '@mysten/sui/transactions'
import {fromBase58,toBase58,fromBase64,toBase64} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {ManagementPartBcs,ManagementLayoutBcs} from './application-bcs'
import type {PinnedMovePackage} from '../../sui/pinned-move-package'
type Layout=Omit<ReturnType<typeof ManagementLayoutBcs.parse>,'color'>&{color:number[]}
export interface EquipmentManagementPlan{
 target:{chainIdentifier:string;application:PinnedMovePackage;model:PinnedMovePackage}
 author:string;kioskId:string;accountId:string;soulId:string;applicationId:string
 expectedRoot:string;expectedApplication:string;partBcs:string;partIndex:string
 previous:{kind:'EMPTY'|'REFERENCE'|'BOUND';itemId:null}|{kind:'ITEM';itemId:string}
 action:{kind:'REMOVE'}|{kind:'ATTACH'|'REPLACE';itemId:string;layout:Layout}
}
function check(v:unknown,c:string):asserts v{if(!v)throw Error(`MANAGEMENT_EQUIPMENT_PLAN_${c}`)}
function exact(v:unknown,keys:string[]):asserts v is Record<string,unknown>{check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join(),'FIELDS')}
function id(v:unknown):asserts v is string{check(typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v),'ID')}
function uint(v:unknown):asserts v is string{check(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<(1n<<64n),'U64')}
function pin(v:PinnedMovePackage){exact(v,['originalPackageId','callablePackageId','callableDigest']);id(v.originalPackageId);id(v.callablePackageId);check(typeof v.callableDigest==='string'&&v.callableDigest.length<=44&&fromBase58(v.callableDigest).length===32&&toBase58(fromBase58(v.callableDigest))===v.callableDigest,'PIN')}
/** This is frozen intent metadata, not current custody, ABI, eligibility or a
 * signed authorization. An old schema is never translated into this schema. */
export function parseEquipmentManagementPlan(input:unknown):EquipmentManagementPlan{
 const p=structuredClone(input)as EquipmentManagementPlan
 exact(p,['target','author','kioskId','accountId','soulId','applicationId','expectedRoot','expectedApplication','partBcs','partIndex','previous','action'])
 exact(p.target,['chainIdentifier','application','model']);check(p.target.chainIdentifier==='35834a8a','CHAIN');pin(p.target.application);pin(p.target.model)
 for(const v of [p.author,p.kioskId,p.accountId,p.soulId,p.applicationId])id(v)
 uint(p.expectedRoot);uint(p.expectedApplication);uint(p.partIndex)
 check(BigInt(p.expectedRoot)>0n&&BigInt(p.expectedRoot)<(1n<<64n)-2n&&BigInt(p.expectedApplication)<(1n<<64n)-1n&&BigInt(p.partIndex)<512n,'REVISION_INDEX')
 check(typeof p.partBcs==='string'&&p.partBcs.length>0&&p.partBcs.length<=8192,'PART_SIZE')
 const partBytes=fromBase64(p.partBcs),part=ManagementPartBcs.parse(partBytes)
 check(toBase64(partBytes)===p.partBcs&&ManagementPartBcs.serialize(part).toBase64()===p.partBcs,'PART_CANONICAL')
 exact(p.previous,['kind','itemId']);check(['EMPTY','REFERENCE','BOUND','ITEM'].includes(p.previous.kind),'PREVIOUS')
 if(p.previous.kind==='ITEM')id(p.previous.itemId);else check(p.previous.itemId===null,'PREVIOUS_ITEM')
 const a=p.action
 if(a.kind==='REMOVE'){exact(a,['kind']);check(p.previous.kind!=='EMPTY','REMOVE_EMPTY')}
 else{
  check(a.kind==='ATTACH'||a.kind==='REPLACE','ACTION');exact(a,['kind','itemId','layout']);id(a.itemId)
  check(a.kind==='ATTACH'?p.previous.kind==='EMPTY':p.previous.kind!=='EMPTY','SLOT_STATE')
  exact(a.layout,['x_negative','x','y_negative','y','scale_ppm','rotation_mdeg','rotation_negative','color'])
  for(const v of [a.layout.x,a.layout.y,a.layout.scale_ppm,a.layout.rotation_mdeg])uint(v)
  check([a.layout.x_negative,a.layout.y_negative,a.layout.rotation_negative].every(v=>typeof v==='boolean'),'LAYOUT_BOOL')
  check(Array.isArray(a.layout.color)&&[0,4].includes(a.layout.color.length)&&a.layout.color.every(v=>Number.isInteger(v)&&v>=0&&v<=255),'LAYOUT_COLOR')
  check((!a.layout.x_negative||a.layout.x!=='0')&&(!a.layout.y_negative||a.layout.y!=='0')&&(!a.layout.rotation_negative||a.layout.rotation_mdeg!=='0'),'LAYOUT_SIGN')
  ManagementLayoutBcs.serialize(a.layout).toBytes()
 }
 const roles=[p.kioskId,p.accountId,p.soulId,p.applicationId,...(p.previous.kind==='ITEM'?[p.previous.itemId]:[]),...(a.kind==='REMOVE'?[]:[a.itemId])]
 const packages=[p.target.application,p.target.model].flatMap(v=>[v.originalPackageId,v.callablePackageId])
 check(p.target.application.originalPackageId!==p.target.model.originalPackageId&&new Set(roles).size===roles.length&&roles.every(v=>v!==p.author&&!packages.includes(v)),'OBJECT_ALIAS')
 return p
}
/** Same template is used for current preparation and original record validation.
 * Custom PartKey/Layout come from exact public Move calls; original linear Item
 * results are fully consumed in this same graph. */
export function buildEquipmentManagementTransaction(input:EquipmentManagementPlan){
 const p=parseEquipmentManagementPlan(input),tx=new Transaction(),a=p.action,app=p.target.application.callablePackageId;tx.setSender(p.author)
 const common=()=>[tx.object(p.kioskId),tx.object(p.accountId),tx.pure.id(p.soulId)]
 const part=tx.moveCall({target:`${app}::character::management_part_account`,arguments:[...common(),tx.pure.u64(p.partIndex),tx.pure.vector('u8',sha256(fromBase64(p.partBcs))),tx.pure.u64(p.expectedApplication),tx.pure.u64(p.expectedRoot)]})
 const args=[...common()];if(a.kind!=='REMOVE')args.push(tx.object(a.itemId));args.push(part)
 if(a.kind!=='REMOVE'){const l=a.layout;args.push(tx.moveCall({target:`${p.target.model.callablePackageId}::policy::layout_signed`,arguments:[tx.pure.bool(l.x_negative),tx.pure.u64(l.x),tx.pure.bool(l.y_negative),tx.pure.u64(l.y),tx.pure.u64(l.scale_ppm),tx.pure.bool(l.rotation_negative),tx.pure.u64(l.rotation_mdeg),tx.pure.vector('u8',l.color)]}))}
 args.push(tx.pure.u64(p.expectedApplication),tx.pure.u64(p.expectedRoot))
 const method=a.kind==='REMOVE'?p.previous.kind==='ITEM'?'detach_scoped_account':p.previous.kind==='BOUND'?'unmount_bound_scoped_account':'clear_reference_scoped_account':a.kind==='ATTACH'?'attach_scoped_account':'replace_scoped_account'
 const result=tx.moveCall({target:`${app}::character::${method}`,arguments:args})
 if(method==='detach_scoped_account')tx.transferObjects([result],p.author)
 if(a.kind==='REPLACE'){
  const held=p.previous.kind==='ITEM',consumed=tx.moveCall({target:`0x1::option::${held?'destroy_some':'destroy_none'}`,typeArguments:[`${p.target.model.originalPackageId}::components::Item`],arguments:[result]})
  if(held)tx.transferObjects([consumed],p.author)
 }
 return{transaction:tx,plan:p,signingQualified:false as const}
}
