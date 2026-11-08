import { bcs } from '@mysten/sui/bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalItemConservation } from './application-forms-historical-item-conservation'
import { readFormsHistoricalReferences } from './application-forms-historical-references'
import { readFormsHistoricalBound } from './application-forms-historical-bound'

/** Combine actual three-rights equipment evidence at the SAME original
 * transaction/effects/checkpoint. No receipt from a later operation or an
 * independently changed history can satisfy another operation's obligation.
 * Visual eligibility/render, native custody and release acceptance remain. */
export async function readFormsHistoricalEquipment(input: Parameters<typeof readFormsHistoricalItemConservation>[0]) {
  const record = parseFormsManagementRecord(input.record)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const args = { ...input, record, signal }
  const items = await readFormsHistoricalItemConservation(args)
  if (items.status !== 'HISTORICAL_EQUIPMENT_CONSERVATION_EVIDENCE') return items
  const references = await readFormsHistoricalReferences(args)
  if (references.status !== 'HISTORICAL_REFERENCE_INVENTORY_EVIDENCE') throw Error('APPLICATION_FORMS_EQUIPMENT_REFERENCE_UNAVAILABLE')
  const bound = await readFormsHistoricalBound(args)
  if (bound.status !== 'HISTORICAL_BOUND_INVENTORY_EVIDENCE') throw Error('APPLICATION_FORMS_EQUIPMENT_BOUND_UNAVAILABLE')
  for (const other of [references, bound]) {
    if (other.transactionDigest !== items.transactionDigest || other.checkpoint !== items.checkpoint
      || bcs.TransactionEffects.serialize(other.effects).toBase64() !== bcs.TransactionEffects.serialize(items.effects).toBase64()
      || JSON.stringify(other.snapshot) !== JSON.stringify(items.snapshot)
      || JSON.stringify(other.compositionBefore) !== JSON.stringify(items.compositionBefore)
      || JSON.stringify(other.compositionAfter) !== JSON.stringify(items.compositionAfter)) {
      throw Error('APPLICATION_FORMS_EQUIPMENT_EVIDENCE_MISMATCH')
    }
  }
  signal.throwIfAborted()
  return { ...items, status: 'HISTORICAL_THREE_RIGHTS_EQUIPMENT_EVIDENCE' as const,
    originalReferenceSources: references.originalReferenceSources, originalBoundSources: bound.originalBoundSources,
    selectedReferenceInventoryVerified: true as const, selectedBoundInventoryVerified: true as const,
    requiresSourceInventoryProof: false as const, completeBusinessOutputVerified: false as const }
}
