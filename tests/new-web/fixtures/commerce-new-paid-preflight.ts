import {bcs,TypeTagSerializer} from '@mysten/sui/bcs'
import {TransactionDataBuilder} from '@mysten/sui/transactions'
import {deriveDynamicFieldID,fromBase64} from '@mysten/sui/utils'
import {sha256} from '@noble/hashes/sha2.js'
import {expect,vi} from 'vitest'
import {fixture} from './commerce-recovery-current-content'
import {aid,activityHash} from './activity-transaction-evidence'
import {publicReadPaidAbiV2Fixture} from './commerce-public-read-paid-abi-v2'
import {MAINNET_GENESIS_DIGEST} from '../../../web/lib/animacraft/mainnet-chain'
import {historicalMoveObjectType} from '../../../web/lib/sui/historical-object'
import {NativeInitialPaidBcs} from '../../../web/lib/soulidity/native-initial-children'
import {EconomicsConfigBcs} from '../../../web/lib/soulidity/commerce/economics-bcs'
import {PaidContentBuyerKeyBcs,PaidContentEntryBcs} from '../../../web/lib/soulidity/commerce/paid-content-policy'
import {NativePaidAttemptFieldBcs,NativePaidAttemptKeyBcs,NativePaidEntryFieldBcs} from '../../../web/lib/soulidity/commerce/native-paid-content-receipt'
import {NativePaidUpdatedBcs,NativeSubscriptionPaidBcs} from '../../../web/lib/soulidity/commerce/native-paid-content-history'
import {preflightNewNativePublicReadPaidPurchaseV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-preflight-v2'
import {prepareNewNativePublicReadPaidPurchaseV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-preparation-v2'
import {readNativePublicReadPaidV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-read-v2'
import {readContractCheckedNativePublicReadPaidPreviewV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-preview-v2'

// Actual pipeline; controlled raw RPC/full simulation witness, not node execution.
async function contractCheckedPreviewFixture(variant='',buyerOverride?:string){
 const x=await fixture('new',buyerOverride);const {chainIdentifier:unused,...foundation}=x.params.economics.foundation;x.params.economics.foundation=foundation as typeof x.params.economics.foundation;const abi=await publicReadPaidAbiV2Fixture(),client=x.f.client as any
 const normalized=(fn:any)=>{const value=JSON.parse(JSON.stringify(fn).replaceAll(aid(42),x.f.nativeId).replaceAll(aid(44),x.params.economics.foundation.originalPackageId));value.packageId=x.params.target.native.callablePackageId;return value}
 client.core.getMoveFunction=vi.fn(async(r:any)=>({function:normalized([abi.quote,abi.buy,abi.approval].find(fn=>fn.name===r.name))}))
 client.core.simulateTransaction=vi.fn(async(request:any)=>{
  const expected=(await readNativePublicReadPaidV2(x.params)).quote!
  const kind=bcs.TransactionKind.parse(await request.transaction.build({onlyTransactionKind:true})),sender=x.buyer,raw=bcs.TransactionData.serialize({V1:{kind,sender,gasData:{owner:sender,payment:[],price:0,budget:0},expiration:{None:true}}}).toBytes(),digest=TransactionDataBuilder.getDigestFromBytes(raw)
  const shared=request.transaction.getData().inputs.flatMap((i:any)=>i.Object?.SharedObject?[i.Object.SharedObject]:[])
  const effects=bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:1,gasUsed:{computationCost:0,storageCost:0,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:11,changedObjects:[],unchangedConsensusObjects:shared.map((r:any)=>{const object=x.f.rows.get(r.objectId);return [r.objectId,{ReadOnlyRoot:[String(object.version),object.digest]}]}),gasObjectIndex:null,eventsDigest:null,dependencies:[],auxDataDigest:null}}).toBytes()
  if(variant==='entry-added'){
   x.ledger.entries.size=1;const key={kind:x.record.kind,buyer:x.buyer},wrapped=`0x2::dynamic_object_field::Wrapper<${x.f.nativeId}::birth::PaidKey>`,owner=deriveDynamicFieldID(x.f.state.id,wrapped,new Uint8Array([0]))
   x.f.object(x.ledger.id,`${x.params.target.content!.originalPackageId}::paid_access::Ledger`,NativeInitialPaidBcs.serialize(x.ledger).toBytes(),owner)
   x.f.object(x.entryId,`0x2::dynamic_field::Field<${x.params.target.content!.originalPackageId}::paid_access::BuyerKey,${x.params.target.content!.originalPackageId}::paid_access::Entry>`,bcs.struct('Field',{id:bcs.Address,name:PaidContentBuyerKeyBcs,value:PaidContentEntryBcs}).serialize({id:x.entryId,name:key,value:{issuer:x.owner,generation:2,scope:1,expiry:null,revision:3}}).toBytes(),x.ledger.entries.id)
  }
  if(variant==='clock')x.clock(101)
  return {$kind:'Transaction',Transaction:{digest,status:{success:true},bcs:raw,effects:{status:{success:true},transactionDigest:digest,bcs:effects}},commandResults:[{mutatedReferences:[],returnValues:[{bcs:bcs.byteVector().serialize(expected.hash).toBytes()},{bcs:bcs.u64().serialize(variant==='wrong-total'?'103':expected.total).toBytes()}]}]}
 })
 return {...x,client,runPreview:()=>readContractCheckedNativePublicReadPaidPreviewV2(x.params)}
}

async function purchasePreparationFixture(variant='',buyerOverride?:string){
 const x=await contractCheckedPreviewFixture('',buyerOverride),client=x.client,coinCodec=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),paymentId=aid(8800),gasId=aid(8801)
 const coin=(id:string,balance:number,owner=x.buyer)=>x.f.object(id,'0x2::coin::Coin<0x2::sui::SUI>',coinCodec.serialize({id,balance}).toBytes(),{AddressOwner:owner})
 const payment=coin(paymentId,variant==='payment-low'?103:1000,variant==='payment-owner'?aid(999):x.buyer),gasCoin=coin(gasId,variant==='gas-low'?9:100)
 const ref=(row:any)=>({objectId:row.objectId,version:String(row.version),digest:row.digest})
 x.f.object(x.params.target.registryId,`${x.f.nativeId}::registry::Registry`,bcs.Address.serialize(x.params.target.registryId).toBytes(),{Shared:{initialSharedVersion:'5'}})
 client.ledgerService.getEpoch=vi.fn(async()=>({response:{epoch:{epoch:variant==='epoch'?7n:5n,referenceGasPrice:variant==='gas-price'?2n:1n}}}))
 const reviewed=await readNativePublicReadPaidV2(x.params);if(variant==='review-total')reviewed.quote!.total='105'
 const input={qualification:x.params,reviewed,paymentCoin:ref(payment),gas:{budget:'10',price:'1',coins:[ref(gasCoin)]},expirationEpoch:'6',quoteExpiryMs:variant==='expiry'?'99':'200',attempt:new Uint8Array(32).fill(1),getBuyerAddress:()=>x.buyer}
 if(variant==='gas-alias')input.gas.coins=[ref(payment)]
 if(variant==='attempt')input.attempt.fill(0)
 return {...x,input,runPrepare:()=>prepareNewNativePublicReadPaidPurchaseV2(input)}
}

export async function completePreflightFixture(variant='',buyerOverride?:string){
 const x=await purchasePreparationFixture('',buyerOverride),client=x.client,expected=x.input.reviewed,offer=expected.offer!,content=x.params.target.content!.originalPackageId
 client.ledgerService.getServiceInfo=vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}}))
 client.transactionExecutionService={simulateTransaction:vi.fn(async(request:any)=>{
  expect(request.checks).toBe(0);expect(request.doGasSelection).toBe(false)
  const bytes=request.transaction.bcs.value as Uint8Array,tx=bcs.TransactionData.parse(bytes).V1!,digest=TransactionDataBuilder.getDigestFromBytes(bytes),version='11',pool:any[]=[],changes:any[]=[]
  const project=(id:string,object:any)=>{const raw=bcs.Object.serialize(object).toBytes(),move=object.data.Move,owner=object.owner
   return {objectId:id,version:BigInt(move.version),digest:activityHash('Object',raw),bcs:{value:raw},contents:{value:move.contents},objectType:historicalMoveObjectType(move.type),previousTransaction:object.previousTransaction,
    owner:owner.AddressOwner?{kind:1,address:owner.AddressOwner}:owner.ObjectOwner?{kind:2,address:owner.ObjectOwner}:{kind:3,version:BigInt(owner.Shared.initialSharedVersion)}}}
  const before=(id:string)=>{const row=x.f.rows.get(id);const value=project(id,bcs.Object.parse(row.bcs.value));if(!pool.some(r=>r.objectId===id&&r.version===value.version))pool.push(value);return value}
  const write=(id:string,type:string,contents:Uint8Array,owner:any,created=false)=>{
   const old=created?null:before(id),data={data:{Move:{type:{Other:TypeTagSerializer.parseFromStr(type).struct!},hasPublicTransfer:true,version,contents}},owner,previousTransaction:digest,storageRebate:'0'},row=project(id,data)
   pool.push(row);changes.push([id,{inputState:old?{Exist:[[String(old.version),old.digest],owner]}:{NotExist:true},outputState:{ObjectWrite:[row.digest,owner]},idOperation:created?{Created:true}:{None:true}}]);return row}
  const body=(id:string)=>bcs.Object.parse(x.f.rows.get(id).bcs.value).data.Move!.contents
  write(x.host.id,`${x.f.nativeId}::birth::PublicReadHostV2`,body(x.host.id),{Shared:{initialSharedVersion:'5'}})
  const paidOwner=deriveDynamicFieldID(x.f.state.id,`0x2::dynamic_object_field::Wrapper<${x.f.nativeId}::birth::PaidKey>`,new Uint8Array([0]))
  write(x.ledger.id,`${content}::paid_access::Ledger`,NativeInitialPaidBcs.serialize({...x.ledger,revision:4,entries:{...x.ledger.entries,size:1},attempts:{...x.ledger.attempts,size:1}}).toBytes(),{ObjectOwner:paidOwner})
  const nextConfig=structuredClone(x.cfg);nextConfig.income.funds='3';nextConfig.income.collected='3';nextConfig.income.revision='1'
  write(x.cfg.id,`${x.params.economics.foundation.originalPackageId}::economics::Config<0x2::sui::SUI>`,EconomicsConfigBcs.serialize(nextConfig).toBytes(),{Shared:{initialSharedVersion:'1'}})
  const entry={issuer:x.owner,generation:'2',scope:'1',expiry:'200',revision:'4'},buyerKey={kind:x.record.kind,buyer:x.buyer}
  write(x.entryId,`0x2::dynamic_field::Field<${content}::paid_access::BuyerKey,${content}::paid_access::Entry>`,NativePaidEntryFieldBcs.serialize({id:x.entryId,name:buyerKey,value:entry}).toBytes(),{ObjectOwner:x.ledger.entries.id},true)
  const ptb=tx.kind.ProgrammableTransaction!,attemptArg=ptb.commands[1].MoveCall!.arguments[9]
  if(attemptArg.$kind!=='Input')throw Error('FIXTURE_ATTEMPT_INPUT')
  const attempt=bcs.byteVector().parse(fromBase64(ptb.inputs[attemptArg.Input].Pure!.bytes)),key={buyer:x.buyer,attempt},attemptId=deriveDynamicFieldID(x.ledger.attempts.id,`${content}::paid_access::AttemptKey`,NativePaidAttemptKeyBcs.serialize(key).toBytes())
  const receipt={kind:x.record.kind,quote:expected.quote!.hash,entry_hash:sha256(PaidContentEntryBcs.serialize(entry).toBytes()),price:offer.price,total:'104',platform_fee:'3',fee_revision:x.cfg.revision,platform_recipient:x.cfg.recipient,beneficiary:x.owner}
  write(attemptId,`0x2::dynamic_field::Field<${content}::paid_access::AttemptKey,${content}::paid_access::Receipt>`,NativePaidAttemptFieldBcs.serialize({id:attemptId,name:key,value:receipt}).toBytes(),{ObjectOwner:x.ledger.attempts.id},true)
  const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),coinType='0x2::coin::Coin<0x2::sui::SUI>'
  write(x.input.paymentCoin.objectId,coinType,Coin.serialize({id:x.input.paymentCoin.objectId,balance:variant==='debit'?897:896}).toBytes(),{AddressOwner:x.buyer})
  write(aid(8810),coinType,Coin.serialize({id:aid(8810),balance:101}).toBytes(),{AddressOwner:x.owner},true)
  const gasIndex=changes.length;write(x.input.gas.coins[0].objectId,coinType,Coin.serialize({id:x.input.gas.coins[0].objectId,balance:98}).toBytes(),{AddressOwner:x.buyer})
  const readonly=[x.params.target.registryId,x.f.kiosk!.id,aid(6)].map(id=>{const row=before(id);return [id,{ReadOnlyRoot:[String(row.version),row.digest]}]})
  const Events=bcs.vector(bcs.struct('Event',{package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.byteVector()}))
  const eventBytes=Events.serialize([{package_id:x.params.target.content!.callablePackageId,transaction_module:'paid_access',sender:x.buyer,type_:{address:content,module:'paid_access',name:'Updated',typeParams:[]},contents:NativePaidUpdatedBcs.serialize({root:x.params.soulId,kind:x.record.kind,buyer:x.buyer,revision:4,operation:2,entry}).toBytes()},
   {package_id:x.params.economics.foundation.callablePackageId,transaction_module:'economics',sender:x.buyer,type_:{address:x.params.economics.foundation.originalPackageId,module:'economics',name:'Paid',typeParams:[]},contents:NativeSubscriptionPaidBcs.serialize({subject:x.params.soulId,attempt,payer:x.buyer,gross:104,fee:3,beneficiary:x.owner}).toBytes()}]).toBytes()
  const effects=bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:5,gasUsed:{computationCost:1,storageCost:1,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:version,changedObjects:changes,unchangedConsensusObjects:readonly,gasObjectIndex:gasIndex,eventsDigest:activityHash('TransactionEvents',eventBytes),dependencies:[],auxDataDigest:null}}).toBytes()
  return {response:{transaction:{digest,transaction:{bcs:{value:bytes}},effects:{bcs:{value:effects},transactionDigest:digest,status:{success:true}},events:{bcs:{value:eventBytes}},objects:{objects:pool},signatures:[]},commandOutputs:[]}}
 })}
 return {...x,runComplete:()=>preflightNewNativePublicReadPaidPurchaseV2(x.input)}
}
