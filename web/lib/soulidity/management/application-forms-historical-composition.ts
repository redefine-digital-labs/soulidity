import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { ManagementCompositionBcs, ManagementPartBcs } from './application-bcs'
import { readFormsHistoricalActivate } from './application-forms-historical-activate'
import { parseFormsManagementRecord } from './application-forms-record'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_COMPOSITION_${code}`) }

/** Original ACTIVATE Composition input/output metadata. Exact typed wrapper
 * owner is checked; wrapper value membership still needs original lineage.
 * Slot/palette/variant child contents and Item pool are not inferred from counts. */
export async function readFormsHistoricalComposition(input: Parameters<typeof readFormsHistoricalActivate>[0] & { compositionId: string }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan, id = input.compositionId
  check(/^0x[0-9a-f]{64}$/.test(id) && !/^0x0+$/.test(id)
    && ![p.soulId, p.applicationId, p.journalId, p.accountId, p.kioskId].includes(id), 'ID')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalActivate({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_ACTIVATE_RELATION_EVIDENCE') return evidence
  const app = p.target.application.originalPackageId
  const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`
  const owner = deriveDynamicFieldID(p.applicationId, wrapper, moveEmptyStructBytes())
  const args = { client: input.client, effects: evidence.effects, transactionDigest: evidence.transactionDigest,
    objectId: id, type: `${app}::character::Composition`, signal, maxBytes: 256 * 1024 }
  const old = await readHistoricalMoveObject({ ...args, mode: 'input' }), written = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
  const before = ManagementCompositionBcs.parse(old.bytes), after = ManagementCompositionBcs.parse(written.bytes)
  check(ManagementCompositionBcs.serialize(before).toBase64() === toBase64(old.bytes)
    && ManagementCompositionBcs.serialize(after).toBase64() === toBase64(written.bytes), 'NONCANONICAL')
  check(before.id === id && after.id === id && old.object.owner.ObjectOwner === owner && written.object.owner.ObjectOwner === owner
    && BigInt(after.revision) === BigInt(before.revision) + 1n && BigInt(evidence.snapshot.composition_revision) <= BigInt(before.revision), 'BINDING')
  const invariant = (value: typeof before) => {
    const { revision: _, colors: __, slots, ...rest } = value
    return ManagementCompositionBcs.serialize({ ...rest, revision: '0', colors: [], slots: { ...slots, size: '0' } }).toBase64()
  }
  check(invariant(before) === invariant(after), 'PERMANENT_STRUCTURE')
  const parts = after.assembly.parts.map(part => ManagementPartBcs.serialize(part).toBase64())
  check(parts.length <= 512 && new Set(parts).size === parts.length && parts.length === evidence.captured.selections.length
    && evidence.captured.selections.every((row, i) => ManagementPartBcs.serialize(row.part).toBase64() === parts[i]), 'PARTS')
  check(after.slots.size === String(evidence.captured.selections.filter(row => row.selection.$kind !== 'Empty').length)
    && JSON.stringify(after.colors) === JSON.stringify(evidence.snapshot.colors), 'OUTPUT_SELECTIONS')
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_COMPOSITION_METADATA_EVIDENCE' as const,
    compositionBefore: before, compositionAfter: after, compositionInputReference: old.reference, compositionOutputReference: written.reference,
    compositionMetadataVerified: true as const, requiresCompositionKeyMembershipProof: true as const,
    requiresCompositionChildrenProof: true as const, completeBusinessOutputVerified: false as const }
}
