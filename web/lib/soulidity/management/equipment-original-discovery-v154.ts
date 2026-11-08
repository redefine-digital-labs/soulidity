import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readHistoricalMoveObject, historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { ManagementApplicationBcs, ManagementCompositionBcs, ManagementPartBcs, ManagementStoredBindingBcs } from './application-bcs'
import { readEquipmentHistoricalRootApplication } from './equipment-historical-root-application'
import { readOriginalOptionalDirectChildV154 } from './application-original-optional-child-v154'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_ORIGINAL_DISCOVERY_V154_${code}`) }
/** Bounded original-only discovery. Hints are generated from actual typed
 * fields/history, including authenticated deletions/creation for empty parts.
 * The complete inventory reader subsequently verifies the hints independently.
 * Parent-commit/cardinality semantics still require original source acceptance. */
export async function discoverEquipmentOriginalInventoryV154(input: Parameters<typeof readEquipmentHistoricalRootApplication>[0] & { maxHops?: number }) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan, client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const standardTypeOrigin = input.standardTypeOrigin, maxHops = input.maxHops ?? 64, signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  check(Number.isSafeInteger(maxHops) && maxHops > 0 && maxHops <= 256, 'HOP_BOUND')
  const e = await readEquipmentHistoricalRootApplication({ client, record, standardTypeOrigin, signal })
  check(e.rootApplication && e.execution.status === 'FINALIZED_EXECUTION', 'FINALIZED_ROOT_APPLICATION')
  const execution = e.execution, app = p.target.application.originalPackageId, wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`
  const mappingId = deriveDynamicFieldID(p.applicationId, wrapper, moveEmptyStructBytes())
  const mapping = await readOriginalOptionalDirectChildV154({ client, effects: execution.effects, transactionDigest: record.packet.digest, checkpoint: execution.checkpoint,
    snapshot: 'input', rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: e.rootApplication.moduleFieldId, childId: mappingId,
    childType: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST,
    maxHops, signal, assertRoot(bytes) { const s = ManagementApplicationBcs.parse(bytes); check(ManagementApplicationBcs.serialize(s).toBase64() === toBase64(bytes)
      && s.id === p.applicationId && s.root === p.soulId, 'APPLICATION') } })
  check(mapping.status === 'PRESENT', 'COMPOSITION_REQUIRED')
  const Mapping = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address }), link = Mapping.parse(mapping.child.bytes)
  check(Mapping.serialize(link).toBase64() === toBase64(mapping.child.bytes) && link.id === mappingId && !link.name.name.dummy_field && mapping.child.reference.created, 'COMPOSITION_KEY')
  const args = { client, effects: execution.effects, transactionDigest: record.packet.digest, objectId: link.value, type: `${app}::character::Composition`, signal, maxBytes: 256 * 1024 }
  const anchor = await readHistoricalMoveObject({ ...args, mode: 'input' }), composition = ManagementCompositionBcs.parse(anchor.bytes)
  check(ManagementCompositionBcs.serialize(composition).toBase64() === toBase64(anchor.bytes) && composition.id === link.value && anchor.object.owner.ObjectOwner === mappingId
    && composition.assembly.parts.length <= 512 && BigInt(composition.slots.size) <= BigInt(composition.assembly.parts.length), 'COMPOSITION')
  const parts = composition.assembly.parts.map(part => ManagementPartBcs.serialize(part).toBase64())
  check(new Set(parts).size === parts.length, 'PART_ALIAS')
  const partType = `${p.target.model.originalPackageId}::assembly::PartKey`, Field = bcs.struct('Field', { id: bcs.Address, name: ManagementPartBcs, value: ManagementStoredBindingBcs })
  const found: string[] = [], proofs: Array<{ partBcs: string; reason: string; writer: string }> = []
  for (const [index, part] of composition.assembly.parts.entries()) {
    if (found.length === Number(composition.slots.size)) break
    const partBcs = parts[index], childId = deriveDynamicFieldID(composition.slots.id, partType, ManagementPartBcs.serialize(part).toBytes())
    let root = anchor, maximum = execution.checkpoint, totalBytes = 0, resolved = false
    const seen = new Set<string>()
    for (let hop = 0; hop < maxHops; hop++) {
      signal.throwIfAborted(); totalBytes += root.bytes.length; check(totalBytes <= 16 * 1024 * 1024, 'BYTE_BOUND')
      const state = ManagementCompositionBcs.parse(root.bytes)
      check(ManagementCompositionBcs.serialize(state).toBase64() === toBase64(root.bytes) && state.id === composition.id && state.slots.id === composition.slots.id
        && root.object.owner.ObjectOwner === mappingId, 'COMPOSITION_HISTORY')
      const writer = root.object.previousTransaction; check(!seen.has(writer), 'CYCLE'); seen.add(writer)
      const tx = await readHistoricalParentTransaction({ client, transactionDigest: writer, maxCheckpoint: maximum, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
      check(tx.executionStatus === 'Success' && !tx.sharedInputs.some(row => row.objectId === composition.id), 'PARENT')
      const output = historicalObjectOutput(tx.effects, composition.id)
      check(output.version === root.reference.version && output.digest === root.reference.digest && output.owner.ObjectOwner === mappingId
        && (output.created || output.inputOwner?.ObjectOwner === mappingId), 'PARENT_LINK')
      const change = tx.effects.V2!.changedObjects.find(([id]) => id === childId)?.[1]
      if (change) {
        if (change.outputState.$kind === 'NotExist') {
          check(change.idOperation.$kind === 'Deleted' && change.inputState.Exist?.[1].ObjectOwner === composition.slots.id, 'DELETION')
          proofs.push({ partBcs, reason: 'AUTHENTICATED_DELETION', writer })
        } else {
          const child = await readHistoricalMoveObject({ client, effects: tx.effects, transactionDigest: writer, objectId: childId,
            type: `0x2::dynamic_field::Field<${partType},${app}::character::StoredBinding>`, mode: 'written', signal, maxBytes: 256 * 1024 })
          const field = Field.parse(child.bytes)
          check(Field.serialize(field).toBase64() === toBase64(child.bytes) && field.id === childId && ManagementPartBcs.serialize(field.name).toBase64() === partBcs
            && child.object.owner.ObjectOwner === composition.slots.id && [field.value.item, field.value.reference, field.value.bound].filter(v => v !== null).length === 1, 'TYPED_SLOT')
          found.push(partBcs); proofs.push({ partBcs, reason: 'ORIGINAL_TYPED_FIELD', writer })
        }
        resolved = true; break
      }
      if (output.created) { proofs.push({ partBcs, reason: 'COMPLETE_PARENT_HISTORY_TO_CREATION', writer }); resolved = true; break }
      root = await readHistoricalMoveObject({ ...args, effects: tx.effects, transactionDigest: writer, mode: 'input' })
      check(root.reference.version < output.version, 'PRIOR_LINK'); maximum = tx.checkpoint
    }
    check(resolved, 'INCOMPLETE_HISTORY')
  }
  check(found.length === Number(composition.slots.size), 'OCCUPIED_COVERAGE')
  signal.throwIfAborted()
  return { compositionId: composition.id, originalOccupiedPartBcs: found, proofs, requiresOriginalSourceCardinalityAndParentCommit: true as const }
}
