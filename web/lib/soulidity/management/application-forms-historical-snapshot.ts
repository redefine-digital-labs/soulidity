import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ApplicationFormReferenceBcs } from './application-forms'
import { ApplicationFormSnapshotBcs } from './application-form-snapshot'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalSavedApplication } from './application-forms-historical-application'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_HISTORICAL_SNAPSHOT_${code}`) }
/** Original SAVE creates the Snapshot and typed Journal DOF wrapper together.
 * This authenticates header/capture/tree membership only. Its selections,
 * sources/variants and outer commitment must still be verified historically. */
export async function readFormsHistoricalSavedSnapshot(input: Parameters<typeof readFormsHistoricalSavedApplication>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  check(p.action.kind === 'SAVE', 'SAVE_REQUIRED')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const application = await readFormsHistoricalSavedApplication({ ...input, record, signal })
  if (application.status !== 'HISTORICAL_SAVED_APPLICATION_EVIDENCE') return application
  const reference = application.transition.reference, app = p.target.application.originalPackageId
  const Key = bcs.struct('SnapshotKey', { reference: ApplicationFormReferenceBcs })
  const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::forms::SnapshotKey>`
  const fieldId = deriveDynamicFieldID(application.after.id, wrapper, Key.serialize({ reference }).toBytes())
  const args = { client: input.client, effects: application.effects, transactionDigest: application.transactionDigest, mode: 'created' as const,
    signal, maxBytes: 256 * 1024 }
  const fieldObject = await readHistoricalMoveObject({ ...args, objectId: fieldId, type: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>` })
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: Key }), value: bcs.Address })
  const field = Field.parse(fieldObject.bytes)
  check(Field.serialize(field).toBase64() === toBase64(fieldObject.bytes) && field.id === fieldId && field.value === application.transition.snapshot
    && fieldObject.object.owner.ObjectOwner === application.after.id
    && ApplicationFormReferenceBcs.serialize(field.name.name.reference).toBase64() === ApplicationFormReferenceBcs.serialize(reference).toBase64(), 'FIELD')
  const object = await readHistoricalMoveObject({ ...args, objectId: field.value, type: `${app}::forms::Snapshot` })
  const snapshot = ApplicationFormSnapshotBcs.parse(object.bytes)
  check(ApplicationFormSnapshotBcs.serialize(snapshot).toBase64() === toBase64(object.bytes) && object.object.owner.ObjectOwner === fieldId
    && snapshot.id === field.value && snapshot.root === p.soulId && snapshot.application === p.applicationId
    && (snapshot.schema === 1 || snapshot.schema === 2) && snapshot.creator === p.author
    && snapshot.epoch === application.effects.V2!.executedEpoch && snapshot.application_revision === p.expectedApplication
    && ApplicationFormReferenceBcs.serialize(snapshot.reference).toBase64() === ApplicationFormReferenceBcs.serialize(reference).toBase64()
    && toHex(snapshot.commitment) === toHex(application.transition.snapshot_commitment), 'CAPTURE')
  const parent = p.action.expectedHead !== '0' ? { name: reference.name, version: p.action.expectedHead }
    : p.action.parent === null ? null : { name: Uint8Array.from(p.action.parent.nameHex.match(/../g)!, byte => parseInt(byte, 16)), version: p.action.parent.version }
  check(bcs.option(ApplicationFormReferenceBcs).serialize(snapshot.parent).toBase64() === bcs.option(ApplicationFormReferenceBcs).serialize(parent).toBase64(), 'PARENT')
  signal.throwIfAborted()
  return { ...application, status: 'HISTORICAL_SAVED_SNAPSHOT_HEADER_EVIDENCE' as const, snapshot,
    snapshotReference: object.reference, snapshotFieldReference: fieldObject.reference, snapshotHeaderAuthenticated: true as const,
    snapshotCommitmentVerified: false as const, completeBusinessOutputVerified: false as const }
}
