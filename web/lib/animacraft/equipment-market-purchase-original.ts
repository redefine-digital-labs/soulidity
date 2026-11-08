import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { queryEquipmentMarketPurchaseFunds } from './equipment-market-purchase-funds'
import { validateEquipmentMarketOperationRecord, type EquipmentMarketOperationRecord } from './equipment-market-operation'
import { marketListCheck as check } from './market-list-operation'

export const EQUIPMENT_PURCHASE_ORIGINAL = 'soulidity.equipment-market-purchase-original.v1'

export interface EquipmentPurchaseOriginal {
  schema: typeof EQUIPMENT_PURCHASE_ORIGINAL
  packet: Pick<EquipmentMarketOperationRecord, 'bytes' | 'digest' | 'expirationEpoch'>
  snapshot: EquipmentMarketOperationRecord['snapshot']
  priceAtomic: string
  paymentCoins: EquipmentMarketOperationRecord['paymentCoins']
}

function fields(input: unknown, keys: string[]) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)),
  'Invalid component original fields')
}

export function createEquipmentPurchaseOriginal(input: unknown): EquipmentPurchaseOriginal {
  const record = validateEquipmentMarketOperationRecord(input)
  check(record.action === 'buy', 'Saved component purchase required')
  const { bytes, digest, expirationEpoch, snapshot, priceAtomic, paymentCoins } = record
  return { schema: EQUIPMENT_PURCHASE_ORIGINAL, packet: { bytes, digest, expirationEpoch }, snapshot, priceAtomic, paymentCoins }
}

export function parseEquipmentPurchaseOriginal(input: unknown, itemId: string) {
  fields(input, ['schema', 'packet', 'snapshot', 'priceAtomic', 'paymentCoins'])
  const original = input as EquipmentPurchaseOriginal
  check(original.schema === EQUIPMENT_PURCHASE_ORIGINAL, 'Invalid component purchase original schema')
  fields(original.packet, ['bytes', 'digest', 'expirationEpoch'])
  const record = validateEquipmentMarketOperationRecord({
    schema: 1, kind: 'equipment-market', action: 'buy', phase: 'PREPARED', signature: null,
    ...original.packet, snapshot: original.snapshot, priceAtomic: original.priceAtomic, paymentCoins: original.paymentCoins,
  })
  check(record.snapshot.asset.itemId === itemId, 'Original component ID mismatch')
  return record
}

/** The local envelope only selects the transaction. Finality and both custody
 * states come from the ledger, with no journal adoption or wallet operation. */
export function queryEquipmentPurchaseOriginal(input: unknown, itemId: string, client: SuiGrpcClient, signal: AbortSignal) {
  return queryEquipmentMarketPurchaseFunds(parseEquipmentPurchaseOriginal(input, itemId), client, signal, { proveCustody: true })
}
