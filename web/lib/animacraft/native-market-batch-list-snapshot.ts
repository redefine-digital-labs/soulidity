import type {SuiGrpcClient} from '@mysten/sui/grpc'
import type {NativeReceiveTarget} from './native-receive'
import type {NativeMarketBuyTarget} from './native-market-buy-snapshot'
import {readSelectedMarketSaleSnapshot} from './selected-market-sale-snapshot'
import {marketListCheck as check,marketListId} from './market-list-operation'
import {validateMarketBatchListSelection,validateMarketBatchListSnapshot} from './market-batch-list-operation'
import type {MarketBatchListSelection,MarketBatchListRow} from './market-batch-list-types'

/** All selected rows share one mutable readset. A last-row read cannot hide a
 * first-row custody/equipment change. No wallet inventory is inferred as sale. */
export async function readNativeMarketBatchListSnapshot(client:SuiGrpcClient,target:NativeReceiveTarget,
  marketTarget:NativeMarketBuyTarget,input:{owner:string;selection:MarketBatchListSelection[]},signal?:AbortSignal){
  const {owner,selection}=structuredClone(input),pin=structuredClone(target),config=structuredClone(marketTarget)
  check(marketListId(owner),'Invalid batch seller')
  const selected=validateMarketBatchListSelection(selection)
  const snapshot=await readSelectedMarketSaleSnapshot(client,pin,config,{owner,
    selection:selected.map(row=>'assetType'in row?row:{assetType:'soul',...row})},signal)
  return validateMarketBatchListSnapshot({schema:'native-market-batch-list-v1',owner,rows:snapshot.rows,equipment:snapshot.equipment})
}
