import {readNativePublicReadPaidHistoryV2} from './native-public-read-paid-history-v2'
import {readCommercePayoutCoins} from './payout-coins'
import {readCommerceOwnedCoinInventory} from './owned-coin-inventory'
import {commerceCheck,commerceId} from './economics-read'

/** Original finalized money evidence -> beneficiary's current Coin objects.
 * Current inventory never substitutes for original proceeds or protocol income.
 * Missing/merged/transferred payout Coin never authorizes repeat payment.
 */
export async function readNativePublicReadPaidBeneficiaryFundsV2(input:Parameters<typeof readNativePublicReadPaidHistoryV2>[0]&{
 viewerAddress:string;getViewerAddress:()=>string|null}){
 const source=input.client,ledger=source.ledgerService,viewer=input.viewerAddress,getViewerAddress=input.getViewerAddress,signal=input.signal
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),listOwnedObjects:source.core.listOwnedObjects.bind(source.core)},
  ledgerService:{getObject:ledger.getObject.bind(ledger),getTransaction:ledger.getTransaction.bind(ledger),getCheckpoint:ledger.getCheckpoint.bind(ledger),getServiceInfo:ledger.getServiceInfo.bind(ledger)}} as unknown as typeof source
 const guard=()=>{signal.throwIfAborted();commerceCheck(commerceId(viewer)&&getViewerAddress()===viewer,'PUBLIC_PAID_V2_PROCEEDS_WALLET_CHANGED')}
 guard();const original=await readNativePublicReadPaidHistoryV2({...input,client,signal,proveMoney:true});guard()
 if(original.status!=='SUBSCRIPTION_RECORDED')return {format:'native-public-read-v2' as const,status:'ORIGINAL_PROCEEDS_NOT_CONFIRMED' as const,original,notPermissionToRetryPayment:true as const}
 const money=original.receipt.money;commerceCheck(money,'PUBLIC_PAID_V2_PROCEEDS_MONEY')
 const proceeds={beneficiary:money.payout.owner,coinType:money.coinType,coinId:money.payout.coinId,amount:money.payout.amount}
 if(proceeds.beneficiary!==viewer)return {format:'native-public-read-v2' as const,status:'OTHER_BENEFICIARY' as const,original,originalProceeds:proceeds,notPermissionToRetryPayment:true as const}
 const unavailable=(stage:'PAYOUT_COIN'|'COIN_INVENTORY',error:unknown)=>{guard();const code=error&&typeof error==='object'&&'code' in error&&(typeof error.code==='string'||typeof error.code==='number')?error.code:'CURRENT_READBACK_FAILED'
  return {format:'native-public-read-v2' as const,status:'ORIGINAL_PROCEEDS_CURRENT_READBACK_UNAVAILABLE' as const,original,originalProceeds:proceeds,currentReadback:{stage,status:'UNAVAILABLE' as const,code},
   notCurrentRevenueAttribution:true as const,notProtocolIncomeWithdrawalAuthority:true as const,notPermissionToRetryPayment:true as const,notCompleteContentDelivery:true as const}}
 let payout:Awaited<ReturnType<typeof readCommercePayoutCoins>>,inventory:Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>>
 try{payout=await readCommercePayoutCoins({client,owner:viewer,coinType:proceeds.coinType,payouts:[{coinId:proceeds.coinId,amount:proceeds.amount}],getViewerAddress,signal});guard()}catch(error){return unavailable('PAYOUT_COIN',error)}
 try{inventory=await readCommerceOwnedCoinInventory({client,owner:viewer,coinType:proceeds.coinType,getViewerAddress,signal});guard()}catch(error){return unavailable('COIN_INVENTORY',error)}
 return {format:'native-public-read-v2' as const,status:'ORIGINAL_PROCEEDS_AND_CURRENT_COIN_OBSERVATIONS' as const,original,originalProceeds:proceeds,payout,inventory,
  notCurrentRevenueAttribution:true as const,notProtocolIncomeWithdrawalAuthority:true as const,notPermissionToRetryPayment:true as const,notCompleteContentDelivery:true as const}
}
