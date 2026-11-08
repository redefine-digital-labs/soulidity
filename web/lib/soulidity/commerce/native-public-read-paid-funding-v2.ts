import { bcs } from '@mysten/sui/bcs'
import { normalizeStructTag,fromBase58,toBase58 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { commerceCheck,commerceId,decodeCommerce,readCommerceObject } from './economics-read'
const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
export type NativePublicReadPaidFundingReferenceV2={objectId:string;version:string;digest:string}
/** Exact selected current Coin refs only, not aggregate wallet JSON balances,
 * a reservation, signing permission or payment. Same-chain full Object BCS
 * establishes type/owner/value. Caller decides which supported graph to use.
 */
export async function readNativePublicReadPaidFundingV2(input:{client:SuiGrpcClient;buyer:string;coinType:string;required:string;
 coins:NativePublicReadPaidFundingReferenceV2[];excludedIds:string[];getBuyerAddress:()=>string|null;signal:AbortSignal}){
 const saved=structuredClone({buyer:input.buyer,coinType:input.coinType,required:input.required,coins:input.coins,excludedIds:input.excludedIds})
 const source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(30000)]),getBuyerAddress=input.getBuyerAddress
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
 const guard=()=>{signal.throwIfAborted();commerceCheck(getBuyerAddress()===saved.buyer,'PUBLIC_PAID_V2_FUNDING_WALLET_CHANGED')}
 commerceCheck(commerceId(saved.buyer)&&/^[1-9][0-9]{0,19}$/.test(saved.required)&&BigInt(saved.required)<=(1n<<64n)-1n
  &&saved.coins.length>0&&saved.coins.length<=256&&saved.excludedIds.length<=512&&saved.excludedIds.every(commerceId)
  &&new Set(saved.coins.map(c=>c.objectId)).size===saved.coins.length,'PUBLIC_PAID_V2_FUNDING_INPUT')
 for(const ref of saved.coins){let digest=false;try{digest=fromBase58(ref.digest).length===32&&toBase58(fromBase58(ref.digest))===ref.digest}catch{}
  commerceCheck(commerceId(ref.objectId)&&!saved.excludedIds.includes(ref.objectId)&&/^[1-9][0-9]{0,19}$/.test(ref.version)&&BigInt(ref.version)<=(1n<<64n)-1n&&digest,'PUBLIC_PAID_V2_FUNDING_REFERENCE')}
 guard();commerceCheck((await client.core.getChainIdentifier()).chainIdentifier===MAINNET_GENESIS_DIGEST,'PUBLIC_PAID_V2_FUNDING_CHAIN')
 const type=`0x2::coin::Coin<${normalizeStructTag(saved.coinType)}>`,coins:Array<NativePublicReadPaidFundingReferenceV2&{balance:string}>=[]
 let sum=0n
 for(const ref of saved.coins){guard();const object=await readCommerceObject(client,ref.objectId,type,signal),coin=decodeCommerce(Coin,object.contents)
  commerceCheck(object.version===ref.version&&object.digest===ref.digest&&object.owner.AddressOwner===saved.buyer&&coin.id===ref.objectId&&BigInt(coin.balance)>0n,'PUBLIC_PAID_V2_FUNDING_COIN')
  sum+=BigInt(coin.balance);commerceCheck(sum<=(1n<<64n)-1n,'PUBLIC_PAID_V2_FUNDING_OVERFLOW');coins.push({...ref,balance:coin.balance})}
 commerceCheck(sum>=BigInt(saved.required),'PUBLIC_PAID_V2_FUNDING_INSUFFICIENT')
 for(const ref of saved.coins){guard();const object=await readCommerceObject(client,ref.objectId,type,signal);commerceCheck(object.version===ref.version&&object.digest===ref.digest,'PUBLIC_PAID_V2_FUNDING_CHANGED')}
 guard();return {format:'native-public-read-v2' as const,proof:'actual-current-selected-coins-only' as const,buyer:saved.buyer,coinType:normalizeStructTag(saved.coinType),required:saved.required,verifiedBalance:String(sum),coins,notReservedOrPaid:true as const}
}
