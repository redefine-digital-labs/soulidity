import { validateEquipmentMarketOperationRecord, type EquipmentMarketOperationRecord } from './equipment-market-operation'
import { marketListCheck as check } from './market-list-operation'

export const EQUIPMENT_LISTING_ORIGINAL = 'soulidity.equipment-market-listing-original.v1'

interface EquipmentListingOriginal {
  schema: typeof EQUIPMENT_LISTING_ORIGINAL
  action: 'list' | 'reprice'
  packet: Pick<EquipmentMarketOperationRecord, 'bytes' | 'digest' | 'expirationEpoch'>
  snapshot: EquipmentMarketOperationRecord['snapshot']
  priceAtomic: string
}

function fields(input: unknown, keys: string[]) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)),
  'Invalid component listing original fields')
}

export function createEquipmentListingOriginal(input: unknown): EquipmentListingOriginal {
  const record = validateEquipmentMarketOperationRecord(input)
  const { action, bytes, digest, expirationEpoch, snapshot, priceAtomic } = record
  check(action === 'list' || action === 'reprice', 'Saved component listing or price change required')
  return { schema: EQUIPMENT_LISTING_ORIGINAL, action, packet: { bytes, digest, expirationEpoch }, snapshot, priceAtomic }
}

export function parseEquipmentListingOriginal(input: unknown) {
  fields(input, ['schema', 'action', 'packet', 'snapshot', 'priceAtomic'])
  const original = input as EquipmentListingOriginal
  check(original.schema === EQUIPMENT_LISTING_ORIGINAL && (original.action === 'list' || original.action === 'reprice'),
    'Invalid component listing original schema')
  fields(original.packet, ['bytes', 'digest', 'expirationEpoch'])
  return validateEquipmentMarketOperationRecord({
    schema: 1, kind: 'equipment-market', action: original.action, phase: 'PREPARED', signature: null,
    ...original.packet, snapshot: original.snapshot, priceAtomic: original.priceAtomic, paymentCoins: [],
  })
}
