import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { ApplicationFormsJournalBcs, ApplicationFormReferenceBcs, ApplicationFormTransitionBcs, ApplicationFormTransitionCommitmentBcs } from './application-forms'
import { readFormsHistoricalActivatedSnapshot } from './application-forms-historical-activated-snapshot'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_ACTIVATION_SAVE_${code}`) }
/** Authenticate the original SAVE append in the Snapshot creation transaction.
 * Original author/epoch belong to that transaction, not today's activator.
 * Full contents, original capture and activation outputs remain separate. */
export async function readFormsHistoricalActivationSave(input: Parameters<typeof readFormsHistoricalActivatedSnapshot>[0]) {
  const evidence = await readFormsHistoricalActivatedSnapshot(input)
  if (evidence.status !== 'HISTORICAL_ACTIVATED_SNAPSHOT_HEADER_EVIDENCE') return evidence
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)]), writer = evidence.snapshotWriter
  const app = input.record.plan.target.application.originalPackageId
  const args = { client: input.client, effects: writer.effects, transactionDigest: writer.transactionDigest, signal, maxBytes: 256 * 1024 }
  const object = await readHistoricalMoveObject({ ...args, objectId: evidence.after.id, type: `${app}::forms::Journal`, mode: 'written' })
  const journal = ApplicationFormsJournalBcs.parse(object.bytes)
  check(ApplicationFormsJournalBcs.serialize(journal).toBase64() === toBase64(object.bytes) && journal.id === evidence.after.id
    && object.object.owner.ObjectOwner === evidence.snapshotFieldProof.rootOwnerId && journal.root === evidence.snapshot.root && journal.history.size === journal.revision && journal.heads.size === journal.forms, 'JOURNAL')
  const id = deriveDynamicFieldID(journal.history.id, 'u64', bcs.u64().serialize(journal.revision).toBytes())
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: ApplicationFormTransitionBcs })
  const created = await readHistoricalMoveObject({ ...args, objectId: id, type: `0x2::dynamic_field::Field<u64,${app}::forms::Transition>`, mode: 'created' })
  const field = Field.parse(created.bytes), row = field.value, snapshot = evidence.snapshot
  check(Field.serialize(field).toBase64() === toBase64(created.bytes) && field.id === id && field.name === journal.revision
    && created.object.owner.ObjectOwner === journal.history.id && row.sequence === journal.revision && row.operation === 0
    && row.root === snapshot.root && row.snapshot === snapshot.id && row.actor === snapshot.creator && row.epoch === snapshot.epoch
    && row.epoch === writer.effects.V2!.executedEpoch && toHex(row.snapshot_commitment) === toHex(snapshot.commitment)
    && ApplicationFormReferenceBcs.serialize(row.reference).toBase64() === ApplicationFormReferenceBcs.serialize(snapshot.reference).toBase64(), 'SAVE_BINDING')
  const { commitment, ...base } = row
  check(toHex(sha3_256(ApplicationFormTransitionCommitmentBcs.serialize({ domain: new TextEncoder().encode('soulidity/form-transition/v1'), schema: 1, ...base }).toBytes()))
    === toHex(commitment) && toHex(commitment) === toHex(journal.head), 'HASH')
  if (object.reference.created) check(journal.revision === '1' && toHex(row.previous) === '00'.repeat(32), 'FIRST_SAVE')
  else {
    const old = await readHistoricalMoveObject({ ...args, objectId: journal.id, type: `${app}::forms::Journal`, mode: 'input' })
    const before = ApplicationFormsJournalBcs.parse(old.bytes)
    check(ApplicationFormsJournalBcs.serialize(before).toBase64() === toBase64(old.bytes)
      && before.id === journal.id && before.root === journal.root && before.history.id === journal.history.id && before.heads.id === journal.heads.id
      && old.object.owner.ObjectOwner === object.object.owner.ObjectOwner && BigInt(before.revision) + 1n === BigInt(journal.revision)
      && toHex(before.head) === toHex(row.previous), 'PREVIOUS')
  }
  const headId = deriveDynamicFieldID(journal.heads.id, 'vector<u8>', bcs.byteVector().serialize(snapshot.reference.name).toBytes())
  const Head = bcs.struct('Head', { id: bcs.Address, name: bcs.byteVector(), value: bcs.u64() })
  const headObject = await readHistoricalMoveObject({ ...args, objectId: headId, type: '0x2::dynamic_field::Field<vector<u8>,u64>', mode: 'written' })
  const head = Head.parse(headObject.bytes)
  check(Head.serialize(head).toBase64() === toBase64(headObject.bytes) && head.id === headId
    && headObject.object.owner.ObjectOwner === journal.heads.id && toHex(head.name) === toHex(snapshot.reference.name)
    && head.value === snapshot.reference.version && BigInt(head.value) > 0n, 'HEAD')
  if (headObject.reference.created) check(head.value === '1', 'FIRST_HEAD')
  else {
    const previous = await readHistoricalMoveObject({ ...args, objectId: headId, type: '0x2::dynamic_field::Field<vector<u8>,u64>', mode: 'input' })
    const oldHead = Head.parse(previous.bytes)
    check(Head.serialize(oldHead).toBase64() === toBase64(previous.bytes) && oldHead.id === headId
      && previous.object.owner.ObjectOwner === journal.heads.id && toHex(oldHead.name) === toHex(head.name)
      && BigInt(oldHead.value) > 0n && BigInt(oldHead.value) + 1n === BigInt(head.value), 'PREVIOUS_HEAD')
  }
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_ACTIVATION_SAVE_TRANSITION_EVIDENCE' as const,
    originalSaveTransition: row, originalSaveJournal: journal, originalSaveHead: head, originalSaveTransitionVerified: true as const,
    requiresOriginalSaveTransitionProof: false as const, snapshotCommitmentVerified: false as const,
    completeBusinessOutputVerified: false as const }
}
