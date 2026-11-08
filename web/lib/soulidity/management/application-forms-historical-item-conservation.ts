import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalPoolItems } from './application-forms-historical-pool-items'
import { verifyFormsHistoricalIncomingItems } from './application-forms-historical-incoming-items'

/** Complete conservation of the qualified ACTIVATE equipment input union:
 * original slot-enumerated equipped pool plus exact original wallet inputs.
 * This is not generic transaction asset conservation or final business success;
 * source inventories, palettes/variants/render and native custody remain. */
export async function readFormsHistoricalItemConservation(input: Parameters<typeof readFormsHistoricalPoolItems>[0]) {
  const record = parseFormsManagementRecord(input.record)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const pool = await readFormsHistoricalPoolItems({ ...input, record, signal })
  if (pool.status !== 'HISTORICAL_ORIGINAL_POOL_ITEM_EVIDENCE') return pool
  const incoming = await verifyFormsHistoricalIncomingItems({ client: input.client, record, effects: pool.effects,
    selections: pool.captured.selections, sources: pool.captured.sources, signal })
  const items = [...pool.originalPoolItems, ...incoming.items]
  const ids = new Set(items.map(item => item.id))
  if (ids.size !== items.length) throw Error('APPLICATION_FORMS_CONSERVATION_INPUT_ALIAS')
  const selected = pool.captured.selections.flatMap(row => row.selection.Free ? [row.selection.Free.id] : [])
  if (selected.some(id => !ids.has(id)) || items.some(item => (item.destination === 'ORIGINAL_APPLICATION') !== selected.includes(item.id))) {
    throw Error('APPLICATION_FORMS_CONSERVATION_SELECTED_COVERAGE')
  }
  signal.throwIfAborted()
  return { ...pool, status: 'HISTORICAL_EQUIPMENT_CONSERVATION_EVIDENCE' as const, incomingItems: incoming.items,
    equipmentItems: items, equipmentInputUnionConservationVerified: true as const,
    requiresIncomingItemConservationProof: false as const, requiresItemConservationProof: false as const,
    requiresSourceInventoryProof: true as const, completeBusinessOutputVerified: false as const }
}
