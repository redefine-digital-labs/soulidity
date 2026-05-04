import { MAX_COLLECTION_SUPPLY } from '@soulidity/sdk'

export const COLLECTION_SUPPLY_CAP_ERROR =
  `Must be an integer between 1 and ${MAX_COLLECTION_SUPPLY.toLocaleString()}`

export function parseCollectionSupplyCapInput(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Required')
  }

  const cap = Number(trimmed)
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_COLLECTION_SUPPLY) {
    throw new Error(COLLECTION_SUPPLY_CAP_ERROR)
  }
  return cap
}
