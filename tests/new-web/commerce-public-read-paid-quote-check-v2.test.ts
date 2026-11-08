import {bcs,TypeTagSerializer} from '@mysten/sui/bcs'
import {TransactionDataBuilder} from '@mysten/sui/transactions'
import {expect,it,vi} from 'vitest'
import {activityHash,aid,adigest} from './fixtures/activity-transaction-evidence'
import {publicReadPaidAbiV2Fixture} from './fixtures/commerce-public-read-paid-abi-v2'
import {checkNativePublicReadPaidQuoteV2} from '../../web/lib/soulidity/commerce/native-public-read-paid-quote-check-v2'
// Controlled original SDK dev-inspect response; no executed VM quote/source
// qualification, gas funding, full purchase simulation, signature or payment.
async function fixture(variant=''){
 const f=await publicReadPaidAbiV2Fixture(),owner={Shared:{initialSharedVersion:'1'}},object=(id:string,type:string)=>{
  const bytes=bcs.Object.serialize({data:{Move:{type:{Other:TypeTagSerializer.parseFromStr(type).struct!},hasPublicTransfer:false,version:'9',contents:bcs.Address.serialize(id).toBytes()}},owner,previousTransaction:adigest(1),storageRebate:0}).toBytes()
  return {objectId:id,version:9n,digest:activityHash('Object',bytes),bcs:{value:bytes}}
 }
 const host=object(aid(12),`${aid(42)}::birth::PublicReadHostV2`),config=object(aid(10),`${aid(44)}::economics::Config<0x2::sui::SUI>`),baseRead=f.client.ledgerService.getObject.getMockImplementation()!
 f.client.ledgerService.getObject.mockImplementation(async(r:any)=>r.objectId===host.objectId?{response:{object:host}}:r.objectId===config.objectId?{response:{object:config}}:baseRead(r))
 const expected={hash:new Uint8Array(32).fill(7),total:'104'},sender=aid(99),intent={format:'native-public-read-v2' as const,nativeCallablePackageId:aid(43),coinType:'0x2::sui::SUI',config:{objectId:config.objectId,initialSharedVersion:'1'},host:{objectId:host.objectId,initialSharedVersion:'1'},kind:3}
 const contractExpected=structuredClone(expected)
 f.client.core.simulateTransaction=vi.fn(async(request:any)=>{
  expect(request.checksEnabled).toBe(false);expect(request.include).toEqual({bcs:true,effects:true,commandResults:true})
  const kind=bcs.TransactionKind.parse(await request.transaction.build({onlyTransactionKind:true})),tx=bcs.TransactionData.serialize({V1:{kind,sender:variant==='sender'?aid(98):sender,gasData:{payment:[],owner:sender,price:0,budget:0},expiration:{None:true}}}).toBytes()
  if(variant==='kind'){const raw=bcs.TransactionData.parse(tx);raw.V1!.kind.ProgrammableTransaction!.commands[0].MoveCall!.function='quote_public_read_paid_v1';tx.set(bcs.TransactionData.serialize(raw).toBytes())}
  const digest=TransactionDataBuilder.getDigestFromBytes(tx),effects=bcs.TransactionEffects.serialize({V2:{transactionDigest:digest,status:{Success:true},executedEpoch:1,gasUsed:{computationCost:0,storageCost:0,storageRebate:0,nonRefundableStorageFee:0},lamportVersion:10,changedObjects:[],unchangedConsensusObjects:[[host.objectId,{ReadOnlyRoot:['9',variant==='readonly-digest'?adigest(99):host.digest]}],[config.objectId,{ReadOnlyRoot:[variant==='readonly-version'?'8':'9',config.digest]}]],gasObjectIndex:null,eventsDigest:null,dependencies:[],auxDataDigest:null}}).toBytes()
  const result:any={$kind:variant==='failed'?'FailedTransaction':'Transaction',Transaction:{digest,status:{success:true},bcs:tx,effects:{status:{success:true},transactionDigest:digest,bcs:effects}},commandResults:[{returnValues:[{bcs:bcs.byteVector().serialize(variant==='hash'?new Uint8Array(32):contractExpected.hash).toBytes()},{bcs:bcs.u64().serialize(variant==='total'?'103':contractExpected.total).toBytes()}],mutatedReferences:[]}]}
  if(variant==='returns')result.commandResults[0].returnValues.pop()
  if(variant==='mutated')result.commandResults[0].mutatedReferences.push({bcs:new Uint8Array([1])})
  if(variant==='noncanonical-hash')result.commandResults[0].returnValues[0].bcs=new Uint8Array([160,0,...expected.hash])
  if(variant==='snapshot-after'){const object=bcs.Object.parse(host.bcs.value);object.data.Move!.version='10';host.bcs.value=bcs.Object.serialize(object).toBytes();host.version=10n;host.digest=activityHash('Object',host.bcs.value)}
  if(variant==='effect-digest')result.Transaction.effects.transactionDigest=adigest(99)
  return result
 })
 const ref=(row:typeof host)=>({objectId:row.objectId,version:'9',digest:row.digest})
 const input={client:f.client,native:f.n.deployment,foundation:f.f.deployment,intent,sender,expected,hostReference:ref(host),configReference:ref(config),signal:new AbortController().signal}
 return {f,host,config,input,run:()=>checkNativePublicReadPaidQuoteV2(input)}
}
it('matches actual contract quote BCS and exact readonly snapshot/kind without granting purchase simulation or signing',async()=>{
 const x=await fixture(),r=await x.run();expect(r).toMatchObject({contractQuote:{hash:x.input.expected.hash,total:'104'},queryChecks:'DISABLED_READONLY_DEV_INSPECT',requiresFullPurchaseFundingAndCheckedSimulation:true,notSigningQualification:true,notFinalizedReceipt:true,notDeliveryProof:true})
 expect(x.f.client.core.simulateTransaction).toHaveBeenCalledOnce()
})
it.each(['sender','kind','failed','hash','total','readonly-digest','readonly-version','returns','mutated','noncanonical-hash','snapshot-after','effect-digest'])('rejects contradictory readonly quote simulation: %s',async variant=>{
 await expect((await fixture(variant)).run()).rejects.toThrow()
})
it('captures query/RPC methods and expected quote before first await',async()=>{
 const x=await fixture(),chain=x.f.client.core.getChainIdentifier.getMockImplementation()!
 x.f.client.core.getChainIdentifier.mockImplementation(async()=>{x.input.expected.total='999';x.input.expected.hash.fill(0);x.f.client.core.simulateTransaction=()=>{throw Error('REPLACED_SIMULATION')};x.f.client.ledgerService.getObject=()=>{throw Error('REPLACED_OBJECT')};return chain()})
 // The mock return must stay the originally independent contract value.
 await expect(x.run()).resolves.toMatchObject({contractQuote:{total:'104'}})
})
