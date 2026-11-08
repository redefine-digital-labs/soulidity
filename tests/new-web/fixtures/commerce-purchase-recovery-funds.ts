import {bcs} from '@mysten/sui/bcs'
import {vi} from 'vitest'
import {normalizeStructTag} from '@mysten/sui/utils'
import {purchaseRecoveryFixture} from './commerce-purchase-recovery-original'
import {queryPurchaseRecoveryOriginal} from '../../../web/lib/soulidity/commerce/purchase-recovery-original'
import {batchHistoryFixture} from './walrus-batch-history'
import {aid,adigest,activityGenesis} from './activity-transaction-evidence'

/** Current full BCS objects are separate from original versioned history. */
export async function purchaseRecoveryFundsFixture(kind:'v1'|'v2',variant='',originalVariant='',source?:{text:string;original:any;soulId:string;client:any;finality:any}){
 const x=source??await purchaseRecoveryFixture(kind,originalVariant),proof=await queryPurchaseRecoveryOriginal({text:x.text,soulId:x.soulId,client:x.client,signal:new AbortController().signal})
 if(!('receipt'in proof.history)||!proof.history.receipt.money)throw Error('ORIGINAL_MONEY_REQUIRED')
 const money=proof.history.receipt.money,payouts='payouts'in money?money.payouts:[money.payout],first=payouts[0],coinType=normalizeStructTag(money.coinType),base=await batchHistoryFixture(0),Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
 const current=new Map<string,{owner:string;amount:bigint;row:any}>(),tracked=new Set<string>()
 const set=(id:string,amount:bigint,owner:string)=>{tracked.add(id);current.set(id,{owner,amount,row:base.base.object(id,20,`0x2::coin::Coin<${coinType}>`,Coin.serialize({id,balance:amount}).toBytes(),{AddressOwner:owner},adigest(999))})}
 for(const p of payouts)set(p.coinId,BigInt(p.amount)+5n,p.owner)
 set(aid(6000),20n,first.owner)
 const configId=x.original.context.economics.configId,config=(await x.client.ledgerService.getObject({objectId:configId,version:10n})).response.object
 const read=x.client.ledgerService.getObject.bind(x.client.ledgerService)
 x.client.ledgerService.getObject=vi.fn(async(r:any,o:any)=>{
  if(r.version===undefined&&tracked.has(r.objectId)){if(!current.has(r.objectId))throw {code:'NOT_FOUND'};return {response:{object:current.get(r.objectId)!.row}}}
  if(r.version===undefined&&r.objectId===configId)return {response:{object:config}}
  return read(r,o)
 })
 x.client.core={...x.client.core,getChainIdentifier:vi.fn(async()=>({chainIdentifier:activityGenesis})),listOwnedObjects:vi.fn(async(r:any)=>({objects:[...current].filter(([,c])=>c.owner===r.owner).map(([objectId])=>({objectId,balance:'999999'})),hasNextPage:false,cursor:null}))}
 x.client.stateService={getBalance:vi.fn(async(r:any)=>{const coinBalance=[...current.values()].filter(c=>c.owner===r.owner).reduce((s,c)=>s+c.amount,0n);return {response:{balance:{coinType:r.coinType,balance:coinBalance+7n,coinBalance,addressBalance:7n}}}})}
 if(variant==='missing-payout')current.delete(first.coinId)
 if(variant==='other-owner')set(first.coinId,11n,aid(999))
 if(variant==='balance-rpc')x.client.stateService.getBalance.mockRejectedValue(Error('BALANCE_RPC_UNAVAILABLE'))
 if(variant==='inventory-rpc')x.client.core.listOwnedObjects.mockRejectedValue(Error('INVENTORY_RPC_UNAVAILABLE'))
 if(variant==='income-rpc'){const get=x.client.ledgerService.getObject.getMockImplementation()!;x.client.ledgerService.getObject.mockImplementation((r:any,o:any)=>{if(r.version===undefined&&r.objectId===configId)throw Error('INCOME_RPC_UNAVAILABLE');return get(r,o)})}
 return {...x,proof,current,set,payouts,first,coinType,config}
}
