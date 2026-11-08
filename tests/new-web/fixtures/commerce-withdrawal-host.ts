import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { expect, it } from 'vitest'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import { EconomicsConfigBcs, EconomicsAdminBcs, IncomeRequestBcs, IncomeReceiptFieldBcs } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { IncomeWithdrawnBcs, readIncomeWithdrawalHistory } from '../../../web/lib/soulidity/commerce/income-withdrawal-history'
import {INCOME_WITHDRAWAL_RECOVERY_SCHEMA,createIncomeWithdrawalRecoveryRecord,parseIncomeWithdrawalRecoveryRecord,exportIncomeWithdrawalRecoveryRecord,importIncomeWithdrawalRecoveryRecord,incomeWithdrawalRecoveryProps,queryIncomeWithdrawalRecoveryRecord} from '../../../web/lib/soulidity/commerce/income-withdrawal-recovery-record'
import {vi} from 'vitest'
import {fromBase64} from '@mysten/sui/utils'
import {ActivityFixtureEventsBcs} from './activity-transaction-evidence'
import {incomeWithdrawalAbiFixture} from './commerce-income-withdrawal-abi'
import {simulateNewIncomeWithdrawal} from '../../../web/lib/soulidity/commerce/income-withdrawal-simulation'
import {readEconomicsIncome} from '../../../web/lib/soulidity/commerce/economics-read'
import {preflightNewIncomeWithdrawal} from '../../../web/lib/soulidity/commerce/income-withdrawal-preflight'
import {recheckPreparedIncomeWithdrawal} from '../../../web/lib/soulidity/commerce/income-withdrawal-resume-preflight'
import {retainPreparedIncomeWithdrawalOriginal} from '../../../web/lib/soulidity/commerce/income-withdrawal-original-retention'
import {qualifiedIncomeRecoveryImportFixture as fixture} from './income-withdrawal-recovery-import'

// Extracted actual full-BCS/RPC fixture. No deployed/source/signing qualification.
export async function portableFixture(){const x=await fixture(),pin=x.params.target.foundation;x.params.target.foundation={originalPackageId:pin.originalPackageId,callablePackageId:pin.callablePackageId,callableDigest:pin.callableDigest} as typeof pin;const record=createIncomeWithdrawalRecoveryRecord(x.params);return {...x,record,text:exportIncomeWithdrawalRecoveryRecord(record)}}

export async function simulationFixture(multipleGas=false){
 const x=await portableFixture();x.record.packet.phase='PREPARED';x.record.packet.signature=null
 if(multipleGas){
  const codec=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()}),extraId=aid(80),before=structuredClone(x.rows.get(`${aid(8)}:2`)),raw=bcs.Object.parse(before.bcs.value)
  raw.data.Move!.contents=codec.serialize({id:extraId,balance:1100}).toBytes()
  before.objectId=extraId;before.contents={value:raw.data.Move!.contents};before.bcs.value=bcs.Object.serialize(raw).toBytes();before.digest=activityHash('Object',before.bcs.value);x.rows.set(`${extraId}:2`,before)
  x.f.transactionData.V1.gasData.payment.push({objectId:extraId,version:'2',digest:before.digest});x.f.rehashTransaction()
  for(const [key,row] of x.rows){if(row.version!==10n)continue
   const object=bcs.Object.parse(row.bcs.value);object.previousTransaction=x.f.ledger.digest
   if(row.objectId===aid(8))object.data.Move!.contents=codec.serialize({id:aid(8),balance:2097}).toBytes()
   row.contents={value:object.data.Move!.contents};row.previousTransaction=x.f.ledger.digest;row.bcs.value=bcs.Object.serialize(object).toBytes();row.digest=activityHash('Object',row.bcs.value)
   x.f.effectsData.V2!.changedObjects.find(([id])=>id===row.objectId)![1].outputState.ObjectWrite![0]=row.digest
  }
  x.f.effectsData.V2!.changedObjects.push([extraId,{inputState:{$kind:'Exist',Exist:[['2',before.digest],{$kind:'AddressOwner',AddressOwner:x.params.intent.actor}]},outputState:{$kind:'NotExist',NotExist:true},idOperation:{$kind:'Deleted',Deleted:true}}])
  x.f.rehashEffects();x.params.packet.bytes=toBase64(x.f.ledger.transaction.bcs.value);x.params.packet.digest=x.f.ledger.digest
  x.record=createIncomeWithdrawalRecoveryRecord(x.params);x.record.packet.phase='PREPARED';x.record.packet.signature=null
 }
 const raw:any={digest:x.record.packet.digest,transaction:{bcs:{value:fromBase64(x.record.packet.bytes)}},effects:{bcs:{value:bcs.TransactionEffects.serialize(x.f.effectsData).toBytes()},transactionDigest:x.record.packet.digest,status:{success:true}},events:{bcs:{value:ActivityFixtureEventsBcs.serialize(x.f.eventsData).toBytes()}},signatures:[],objects:{objects:structuredClone([...x.rows.values()])}}
 const client:any=x.params.client,read=client.ledgerService.getObject.bind(client.ledgerService)
 client.ledgerService.getObject=vi.fn(async(r:any)=>{if(r.version!==undefined)throw Error('NO_SIM_LEDGER_FALLBACK');return read(r)})
 client.core={getChainIdentifier:async()=>({chainIdentifier:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'}),getMoveFunction:async()=>({function:incomeWithdrawalAbiFixture(x.record.target.foundation.callablePackageId,x.record.target.foundation.originalPackageId)})}
 client.transactionExecutionService={simulateTransaction:vi.fn(async()=>({response:{transaction:raw,commandOutputs:[]}}))}
 const input={client,record:x.record,reviewedGas:{budget:'1000',price:'1',coins:[{objectId:aid(8),version:'2',digest:x.rows.get(`${aid(8)}:2`).digest}]},getActorAddress:()=>x.params.intent.actor,signal:x.params.signal,executionRegistry:x.executionRegistry}
 if(multipleGas)input.reviewedGas.coins.push({objectId:aid(80),version:'2',digest:x.rows.get(`${aid(80)}:2`).digest})
 return {...x,raw,input}
}

export async function preflightFixture(){
 const x=await simulationFixture(),client=x.input.client,read=client.ledgerService.getObject
 client.ledgerService.getObject=vi.fn(async(r:any)=>{
  if(r.version!==undefined)throw Error('NO_PREFLIGHT_VERSIONED_LEDGER_READ')
  const row=x.rows.get(`${r.objectId}:${r.objectId===aid(8)?2:9}`)
  return row?{response:{object:row}}:read(r)
 })
 const reviewed=await readEconomicsIncome({client,target:x.params.target,admin:{actor:x.params.intent.actor,objectId:x.params.intent.adminId},signal:x.params.signal})
 const input={kind:'NEW_INCOME_WITHDRAWAL' as const,client,target:x.params.target,...x.params.intent,reviewed,gas:x.input.reviewedGas,expirationEpoch:'6',getActorAddress:x.input.getActorAddress,signal:x.params.signal,executionRegistry:x.executionRegistry}
 return {...x,preflightInput:input}
}
