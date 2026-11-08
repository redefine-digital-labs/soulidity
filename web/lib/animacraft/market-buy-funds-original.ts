import { marketBuyCheck as check, validateMarketBuyOperationRecord, type MarketBuyOperationRecord, type MarketBuySnapshot } from './market-buy-operation'

export const MARKET_BUY_FUNDS_ORIGINAL = 'soulidity.native-market-funds-original.v1'
type Payment = MarketBuyOperationRecord['paymentCoins'][number]
export type MarketBuyFundsOriginal = {
  schema: typeof MARKET_BUY_FUNDS_ORIGINAL
  packet: Pick<MarketBuyOperationRecord, 'bytes' | 'digest' | 'expirationEpoch'>
  snapshot: MarketBuySnapshot
  paymentCoins: Payment[]
}

const snapshotFields = ['schema', 'soulId', 'stateId', 'bindingId', 'seller', 'sellerKioskId', 'ownershipEpoch',
  'listingId', 'priceAtomic', 'creator', 'makerCreator', 'soulCreatorRoyaltyBps', 'makerSourceRoyaltyBps',
  'protocolFeeRecipient', 'buyer', 'buyerKioskId', 'buyerKioskCapId', 'purchaseAvailable'] as const satisfies readonly (keyof MarketBuySnapshot)[]
const releaseFields = ['network', 'protocolConfigId', 'soulidityOriginalPackageId', 'soulidityCallablePackageId',
  'soulidityCallableDigest', 'marketConfigV2Id', 'kioskRegistryId', 'soulTransferPolicyId', 'kioskPackageId',
  'paymentCoinType', 'writesEnabled'] as const satisfies readonly (keyof MarketBuySnapshot['release'])[]
const paymentFields = ['objectId', 'version', 'digest', 'balanceAtomic'] as const satisfies readonly (keyof Payment)[]
const packetFields = ['bytes', 'digest', 'expirationEpoch'] as const

function pick<T extends object, K extends keyof T>(value: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map(key => [key, value[key]])) as Pick<T, K>
}
function keys(value: unknown, expected: readonly string[]) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), 'MARKET_BUY_FUNDS_ORIGINAL_FIELDS')
}

/** Construct only from a validated original record. TransactionData includes no signature. */
export function createMarketBuyFundsOriginal(record: MarketBuyOperationRecord): MarketBuyFundsOriginal {
  return {
    schema: MARKET_BUY_FUNDS_ORIGINAL,
    packet: pick(record, packetFields),
    snapshot: { ...pick(record.snapshot, snapshotFields), release: pick(record.snapshot.release, releaseFields) },
    paymentCoins: record.paymentCoins.map(coin => pick(coin, paymentFields)),
  }
}

/** Only the historical verifier consumes this synthetic read record. Never adopt it into the journal. */
export function marketBuyFundsOriginalReadRecord(file: MarketBuyFundsOriginal): MarketBuyOperationRecord {
  return { schema: 1, kind: 'buy', phase: 'PREPARED', signature: null, ...pick(file.packet, packetFields),
    snapshot: file.snapshot, paymentCoins: file.paymentCoins }
}

export function parseMarketBuyFundsOriginal(value: unknown, soulId: string): MarketBuyFundsOriginal {
  keys(value, ['schema', 'packet', 'snapshot', 'paymentCoins'])
  const file = value as MarketBuyFundsOriginal
  check(file.schema === MARKET_BUY_FUNDS_ORIGINAL, 'MARKET_BUY_FUNDS_ORIGINAL_SCHEMA')
  keys(file.packet, packetFields)
  keys(file.snapshot, [...snapshotFields, 'release'])
  keys(file.snapshot.release, releaseFields)
  check(file.snapshot.soulId === soulId, 'PURCHASE_ORIGINAL_SOUL_MISMATCH')
  check(Array.isArray(file.paymentCoins) && file.paymentCoins.length > 0 && file.paymentCoins.length <= 32, 'MARKET_BUY_FUNDS_ORIGINAL_PAYMENT')
  for (const coin of file.paymentCoins) keys(coin, paymentFields)
  return createMarketBuyFundsOriginal(validateMarketBuyOperationRecord(marketBuyFundsOriginalReadRecord(file)))
}
