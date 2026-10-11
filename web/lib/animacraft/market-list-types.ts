import type {MarketBuySnapshot} from './market-buy-types'
import type {MarketCancelCheckpoint} from './market-cancel-checkpoint'
import type {SelectedAnimacraftSoulSaleV8} from '@soulidity/sdk'

/** Public chain facts, not authorization by the queried owner or an HTTP caller. */
export interface NativeMarketListSnapshot {
  schema:'native-market-list-v1'
  soulId:string;stateId:string;bindingId:string;owner:string;kioskId:string;kioskCapId:string;ownershipEpoch:string
  creator:string;makerCreator:string;soulCreatorRoyaltyBps:number;makerSourceRoyaltyBps:number;protocolFeeRecipient:string
  listed:boolean;listingId:string|null;priceAtomic:string|null;equipmentId:string|null
  equipmentSale?:NonNullable<SelectedAnimacraftSoulSaleV8['equipment']> & {runtimeCallableDigest:string;writesEnabled:boolean}
  listAvailable:boolean;repriceAvailable:boolean
  release:MarketBuySnapshot['release']
}

export interface MarketListOperationRecord {
  schema:1;kind:'list'|'reprice';snapshot:NativeMarketListSnapshot;priceAtomic:string
  bytes:string;digest:string;expirationEpoch:string
  phase:'PREPARED'|'SIGNING'|'SIGNED'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'RETIRED'
  signature:string|null;syncStatus?:'PENDING'|'COMPLETE'|'SUPERSEDED'
  retirement?:{priorPhase:'SIGNING'|'SIGNED';checkpoint:MarketCancelCheckpoint}
}
