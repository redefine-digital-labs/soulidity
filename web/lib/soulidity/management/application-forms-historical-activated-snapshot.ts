import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ApplicationFormsJournalBcs, ApplicationFormReferenceBcs } from './application-forms'
import { ApplicationFormSnapshotBcs } from './application-form-snapshot'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalActivatedApplication } from './application-forms-historical-application'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_ACTIVATED_SNAPSHOT_${code}`) }
/** Follow the original Journal's own owned-parent lineage, independent of
 * current head or later outer Soul/Kiosk ownership. Qualified Forms code must
 * keep SnapshotKey and Snapshot immutable. The original SAVE transition/full
 * content and all activation Item/output semantics remain separate proofs. */
export async function readFormsHistoricalActivatedSnapshot(input: Parameters<typeof readFormsHistoricalActivatedApplication>[0] & { maxHops?: number }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  check(p.action.kind === 'ACTIVATE', 'ACTIVATE_REQUIRED')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const application = await readFormsHistoricalActivatedApplication({ ...input, record, signal })
  if (application.status !== 'HISTORICAL_ACTIVATED_APPLICATION_EVIDENCE') return application
  check(application.before, 'ORIGINAL_JOURNAL')
  const before = application.before, app = p.target.application.originalPackageId, reference = application.transition.reference
  const moduleWrapper = `0x2::dynamic_object_field::Wrapper<${input.standardTypeOrigin}::soul::ModuleKey<${app}::forms::Witness>>`
  const journalOwner = deriveDynamicFieldID(p.soulId, moduleWrapper, bcs.byteVector().serialize(new TextEncoder().encode('forms')).toBytes())
  const Key = bcs.struct('SnapshotKey', { reference: ApplicationFormReferenceBcs })
  const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::forms::SnapshotKey>`
  const fieldId = deriveDynamicFieldID(before.id, wrapper, Key.serialize({ reference }).toBytes())
  const fieldType = `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`
  const fieldProof = await readHistoricalChildThroughOwnedParent({ client: input.client,
    anchorEffects: application.effects, anchorTransactionDigest: application.transactionDigest, anchorCheckpoint: application.checkpoint,
    anchorMode: 'input', rootId: before.id, rootType: `${app}::forms::Journal`, rootOwnerId: journalOwner,
    childId: fieldId, childType: fieldType, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST,
    signal, maxHops: input.maxHops, assertRoot(bytes) {
      const value = ApplicationFormsJournalBcs.parse(bytes)
      check(ApplicationFormsJournalBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === before.id && value.root === p.soulId
        && value.heads.id === before.heads.id && value.history.id === before.history.id && BigInt(value.revision) <= BigInt(before.revision)
        && value.heads.size === value.forms && value.history.size === value.revision, 'JOURNAL_LINEAGE')
    } })
  check(fieldProof.reference.created, 'IMMUTABLE_FIELD_CREATED_REQUIRED')
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: Key }), value: bcs.Address })
  const field = Field.parse(fieldProof.bytes)
  check(Field.serialize(field).toBase64() === toBase64(fieldProof.bytes) && field.id === fieldId && field.value === application.transition.snapshot
    && ApplicationFormReferenceBcs.serialize(field.name.name.reference).toBase64() === ApplicationFormReferenceBcs.serialize(reference).toBase64(), 'FIELD')
  const writer = await readHistoricalParentTransaction({ client: input.client, transactionDigest: fieldProof.writerTransactionDigest,
    maxCheckpoint: application.checkpoint, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
  check(writer.executionStatus === 'Success', 'WRITER_FAILED')
  const object = await readHistoricalMoveObject({ client: input.client, effects: writer.effects, transactionDigest: writer.transactionDigest,
    objectId: field.value, type: `${app}::forms::Snapshot`, mode: 'created', signal, maxBytes: 256 * 1024 })
  const snapshot = ApplicationFormSnapshotBcs.parse(object.bytes)
  check(ApplicationFormSnapshotBcs.serialize(snapshot).toBase64() === toBase64(object.bytes) && object.object.owner.ObjectOwner === fieldId
    && snapshot.id === field.value && snapshot.root === p.soulId && snapshot.application === p.applicationId
    && (snapshot.schema === 1 || snapshot.schema === 2) && BigInt(snapshot.application_revision) <= BigInt(p.expectedApplication)
    && snapshot.epoch === writer.effects.V2!.executedEpoch
    && ApplicationFormReferenceBcs.serialize(snapshot.reference).toBase64() === ApplicationFormReferenceBcs.serialize(reference).toBase64()
    && toHex(snapshot.commitment) === toHex(application.transition.snapshot_commitment), 'SNAPSHOT')
  signal.throwIfAborted()
  return { ...application, status: 'HISTORICAL_ACTIVATED_SNAPSHOT_HEADER_EVIDENCE' as const, snapshot,
    snapshotReference: object.reference, snapshotFieldProof: fieldProof, snapshotWriter: writer,
    snapshotHeaderAuthenticated: true as const, requiresQualifiedSnapshotImmutability: true as const,
    requiresOriginalSaveTransitionProof: true as const, snapshotCommitmentVerified: false as const,
    completeBusinessOutputVerified: false as const }
}
