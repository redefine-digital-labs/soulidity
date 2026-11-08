import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag} from '@mysten/sui/utils'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {commerceCheck,commerceId,decodeCommerce,readCommerceObject} from './economics-read'
const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
/** Current Coin OBJECT inventory only. Discovery rows are ID hints, never
 * balances. Two bounded enumerations and full-object ref rechecks detect drift.
 * This excludes address/accumulator balances, revenue attribution, reservations,
 * protocol income and withdrawal/signing authority. No atomic ledger claim.
 */
export async function readCommerceOwnedCoinInventory(input:{client:SuiGrpcClient;owner:string;coinType:string;getViewerAddress:()=>string|null;signal:AbortSignal}){
 const owner=input.owner,coinType=normalizeStructTag(input.coinType),getViewerAddress=input.getViewerAddress,signal=AbortSignal.any([input.signal,AbortSignal.timeout(45000)])
 const source=input.client,client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),listOwnedObjects:source.core.listOwnedObjects.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
 const guard=()=>{signal.throwIfAborted();commerceCheck(getViewerAddress()===owner,'COIN_INVENTORY_WALLET_CHANGED')}
 commerceCheck(commerceId(owner),'COIN_INVENTORY_OWNER');guard()
 commerceCheck((await client.core.getChainIdentifier()).chainIdentifier===MAINNET_GENESIS_DIGEST,'COIN_INVENTORY_CHAIN');guard()
 const type=`0x2::coin::Coin<${coinType}>`
 const discover=async()=>{const ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null|undefined,complete=false
  for(let page=0;page<20;page++){guard();const row=await client.core.listOwnedObjects({owner,type,limit:50,cursor,signal});guard()
   commerceCheck(row.objects.length<=50&&typeof row.hasNextPage==='boolean','COIN_INVENTORY_PAGE')
   for(const hint of row.objects){commerceCheck(commerceId(hint.objectId)&&!ids.has(hint.objectId),'COIN_INVENTORY_DUPLICATE');ids.add(hint.objectId)}
   if(!row.hasNextPage){complete=true;break}
   commerceCheck(typeof row.cursor==='string'&&row.cursor.length>0&&row.cursor.length<=16384&&!cursors.has(row.cursor),'COIN_INVENTORY_CURSOR');cursors.add(row.cursor);cursor=row.cursor
  }
  commerceCheck(complete,'COIN_INVENTORY_INCOMPLETE');return [...ids].sort()
 }
 const ids=await discover(),coins:Array<{objectId:string;version:string;digest:string;balance:string}>=[]
 let balance=0n
 for(const id of ids){guard();const object=await readCommerceObject(client,id,type,signal),coin=decodeCommerce(Coin,object.contents)
  commerceCheck(coin.id===id&&object.owner.AddressOwner===owner,'COIN_INVENTORY_COIN');balance+=BigInt(coin.balance)
  coins.push({objectId:id,version:object.version,digest:object.digest,balance:coin.balance})}
 const again=await discover();commerceCheck(ids.join(',')===again.join(','),'COIN_INVENTORY_SET_CHANGED')
 for(const ref of coins){guard();const current=await readCommerceObject(client,ref.objectId,type,signal);commerceCheck(current.version===ref.version&&current.digest===ref.digest,'COIN_INVENTORY_CHANGED')}
 guard();return {proof:'current-owned-coin-object-inventory-only' as const,owner,coinType,coins,observedCoinBalance:String(balance),
  notTotalWalletBalance:true as const,notAddressOrAccumulatorBalance:true as const,notRevenueAttribution:true as const,notProtocolWithdrawableIncome:true as const,
  notReservedOrSigningAuthority:true as const,notAtomicLedgerSnapshot:true as const}
}
