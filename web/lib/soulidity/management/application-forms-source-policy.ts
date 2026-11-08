import { toHex } from '@mysten/sui/utils'
import { ManagementSourceBcs, ManagementLayoutBcs, ManagementAdapterBcs, ManagementPartBcs } from './application-bcs'
import { readFormsHistoricalEquipment } from './application-forms-historical-equipment'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_SOURCE_POLICY_${code}`) }
type Source = ReturnType<typeof ManagementSourceBcs.parse>
type Layout = ReturnType<typeof ManagementLayoutBcs.parse>
type Adapter = ReturnType<typeof ManagementAdapterBcs.parse>
export function assertManagementSourceLayout(bounds: Source['definition']['bounds'], value: Layout) {
  check(BigInt(value.x) <= BigInt(bounds.max_x) && BigInt(value.y) <= BigInt(bounds.max_y)
    && BigInt(value.scale_ppm) >= BigInt(bounds.min_scale) && BigInt(value.scale_ppm) <= BigInt(bounds.max_scale)
    && BigInt(value.rotation_mdeg) <= BigInt(bounds.max_rotation)
    && (!value.color.length || bounds.colors.some(color => toHex(color) === toHex(value.color))), 'LAYOUT')
}
/** Exact policy::use_follows_soul/assert_layout/assert_rules and required-root
 * preconditions, given authenticated original sources/parts. This deliberately
 * does not implement visual::assert_rules, mappings or render evaluation. */
export function verifyFormsSourcePolicy(input: {
  required: Uint8Array[]; slots: Array<{ part: ReturnType<typeof ManagementPartBcs.parse>; source: Source; layout: Layout; adapter: Adapter | null }>
}) {
  const values = structuredClone(input)
  check(values.slots.length <= 512 && values.required.length <= 512, 'BOUND')
  const hashes = new Set(values.slots.map(row => toHex(row.source.definition_hash)))
  for (const required of values.required) check(values.slots.some(row => row.part.scope === null && toHex(row.part.key) === toHex(required)), 'REQUIRED_PART')
  for (const row of values.slots) {
    check(row.source.definition.transferable_use, 'USE_FOLLOWS_SOUL')
    assertManagementSourceLayout(row.source.definition.bounds, row.layout); if (row.adapter) assertManagementSourceLayout(row.adapter.bounds, row.layout)
    check(row.source.definition.required_styles.every(hash => hashes.has(toHex(hash)))
      && row.source.definition.forbidden_styles.every(hash => !hashes.has(toHex(hash))), 'DEFINITION_RULES')
  }
  return { sourcePolicyConstraintsVerified: true as const, visualSceneRulesVerified: false as const, semanticRenderVerified: false as const }
}
export async function readFormsHistoricalSourcePolicy(input: Parameters<typeof readFormsHistoricalEquipment>[0]) {
  const evidence = await readFormsHistoricalEquipment(input)
  if (evidence.status !== 'HISTORICAL_THREE_RIGHTS_EQUIPMENT_EVIDENCE') return evidence
  const refs = new Map(evidence.originalReferenceSources.map(row => [row.index, row.source]))
  const bounds = new Map(evidence.originalBoundSources.map(row => [row.index, row.source]))
  const items = new Map(evidence.equipmentItems.map(row => [row.id, row.source]))
  const slots = evidence.slotOutputs.map(row => {
    const b = row.binding, source = b.item !== null ? items.get(b.item) : b.bound !== null ? bounds.get(b.bound) : refs.get(b.reference!)
    check(source, 'SOURCE_COVERAGE'); return { part: row.part, source, layout: b.layout, adapter: b.adapter }
  })
  const policy = verifyFormsSourcePolicy({ required: evidence.compositionAfter.required, slots })
  input.signal.throwIfAborted()
  return { ...evidence, ...policy, policyEquipmentSlots: slots, status: 'HISTORICAL_SOURCE_POLICY_EVIDENCE' as const, completeBusinessOutputVerified: false as const }
}
