import type {NativeMarketListSnapshot} from './market-list-types'
import type {ListingLifecycleRecord} from './listing-operation-lifecycle'
import type {SelectedMarketSaleRow,SelectedMarketSaleSelection} from './selected-market-sale-snapshot'
import type {SelectedSaleEquipmentPreparation} from './native-selected-equipment-sale'

export const MAX_MARKET_BATCH_LIST_ROWS=20
export type MarketBatchListSelection={soulId:string;stateId:string;priceAtomic:string}|Extract<SelectedMarketSaleSelection,{assetType:'equipment'}>
export interface SoulMarketBatchListRow {assetType:'soul';snapshot:NativeMarketListSnapshot;priceAtomic:string}
export type MarketBatchListRow=SelectedMarketSaleRow
export interface SoulMarketBatchListSnapshot {schema:'native-market-batch-list-v1';owner:string;rows:SoulMarketBatchListRow[]}
export interface NativeMarketBatchListSnapshot {
  schema:'native-market-batch-list-v1';owner:string;rows:MarketBatchListRow[]
  equipment?:SelectedSaleEquipmentPreparation[]
}
export interface BatchMarketListOperationRecord extends ListingLifecycleRecord {
  schema:1;kind:'batch-list';owner:string;rows:MarketBatchListRow[]
  equipment?:SelectedSaleEquipmentPreparation[]
}
