import type {AnimacraftEquipmentMarketV8Asset,AnimacraftEquipmentMarketV8Receiving,
  AnimacraftEquipmentMarketV8Target} from '@soulidity/sdk'
import type {NativeReceiveTarget} from './native-receive'
import type {SelectedSaleEquipmentPreparation} from './native-selected-equipment-sale'
import type {ListingLifecycleRecord} from './listing-operation-lifecycle'
import type {MarketBuyPaymentCoin} from './market-buy-types'

export type EquipmentMarketAction='list'|'buy'|'reprice'|'cancel'|'recover'
/** A serializable projection of authenticated reads, never a wallet inventory hint.
 * Permission bits are current gates, not historical transaction-query authority. */
export interface EquipmentMarketOperationSnapshot {
  schema:'equipment-market-operation-v1'
  actor:string;seller:string;ownershipEpoch:string
  asset:AnimacraftEquipmentMarketV8Asset
  reference:AnimacraftEquipmentMarketV8Receiving
  /** Expected custody commitment, after the optional atomic removal clears lock. */
  assetCommitment:string
  quoteContext:{makerVersion:string;rootContentCommitment:string;economicsCommitment:string;rightsCommitment:string}
  target:AnimacraftEquipmentMarketV8Target
  release:NativeReceiveTarget
  protocolTreasuryId:string|null
  listing:null|{id:string;revision:string;priceAtomic:string;quoteCommitment:string}
  lock:null|{equipmentId:string;revision:string;selectionIndex:string}
  removal:SelectedSaleEquipmentPreparation|null
  available:{list:boolean;buy:boolean;reprice:boolean;cancel:boolean;recover:boolean}
}
export interface EquipmentMarketOperationRecord extends ListingLifecycleRecord {
  schema:1;kind:'equipment-market';action:EquipmentMarketAction
  snapshot:EquipmentMarketOperationSnapshot
  /** Exact intended gross price; existing quote for buy/cancel/recover. */
  priceAtomic:string
  paymentCoins:MarketBuyPaymentCoin[]
}
