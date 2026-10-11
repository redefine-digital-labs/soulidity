import type { Transaction } from '@mysten/sui/transactions'
import type { AnimacraftV8SoulListingScope } from './animacraft-market-v8'
import type { AnimacraftEquipmentV8RemovalPlan } from './animacraft-equipment-removal-v8'
import {buildSelectedAnimacraftSaleV8Tx} from './animacraft-selected-sale-v8'

export interface SelectedAnimacraftSoulSaleV8 extends AnimacraftV8SoulListingScope {
  priceAtomic: bigint
  equipment: AnimacraftEquipmentV8RemovalPlan | null
}

/** The existing Soul-only API is a typed subset of the single selected-sale
 * composer, not a separate transaction implementation or attached-sale mode. */
export function buildSelectedAnimacraftSoulSaleV8Tx(input: readonly SelectedAnimacraftSoulSaleV8[]): Transaction {
  const rows = structuredClone(input)
  if (!Array.isArray(rows) || !rows.length) throw new Error('Select at least one Soul to sell')
  return buildSelectedAnimacraftSaleV8Tx({rows:rows.map(({equipment,...listing})=>({assetType:'soul' as const,listing,
    equipmentId:equipment?.scope.equipmentId??null})),equipment:rows.flatMap(row=>row.equipment?[{plan:row.equipment,closeBinding:true}]:[])})
}
