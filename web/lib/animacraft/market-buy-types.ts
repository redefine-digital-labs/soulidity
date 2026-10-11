import type { MarketCancelCheckpoint } from './market-cancel-checkpoint'

export const NATIVE_MARKET_PAYMENT_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export interface MarketBuySnapshot {
  schema: 'native-market-buy-v1'
  soulId: string; stateId: string; bindingId: string; seller: string; sellerKioskId: string
  ownershipEpoch: string; listingId: string; priceAtomic: string; creator: string; makerCreator: string
  soulCreatorRoyaltyBps: number; makerSourceRoyaltyBps: number; protocolFeeRecipient: string
  buyer: string; buyerKioskId: string | null; buyerKioskCapId: string | null; purchaseAvailable: boolean
  release: { network: 'mainnet'; protocolConfigId: string; soulidityOriginalPackageId: string
    soulidityCallablePackageId: string; soulidityCallableDigest: string; marketConfigV2Id: string
    kioskRegistryId: string; soulTransferPolicyId: string; kioskPackageId: string; paymentCoinType: string; writesEnabled: boolean }
}
export interface MarketBuyPaymentCoin { objectId: string; version: string; digest: string; balanceAtomic: string }
export interface MarketBuyOperationRecord {
  schema: 1; kind: 'buy'; snapshot: MarketBuySnapshot; paymentCoins: MarketBuyPaymentCoin[]
  bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED'|'SIGNING'|'SIGNED'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'RETIRED'
  signature: string | null; syncStatus?: 'PENDING'|'COMPLETE'|'SUPERSEDED'
  retirement?: { priorPhase: 'SIGNING'|'SIGNED'; checkpoint: MarketCancelCheckpoint }
}
