import { bcs, type BcsType } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { parseFormsManagementRecord, type FormsManagementRecord } from './application-forms-record'
import { readFormsFinalizedExecution } from './application-forms-execution'
import { ApplicationFormsJournalBcs, ApplicationFormTransitionBcs, ApplicationFormTransitionCommitmentBcs } from './application-forms'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_HISTORICAL_${code}`) }
function decode<T>(codec: BcsType<T, any>, bytes: Uint8Array) {
  const value = codec.parse(bytes); check(codec.serialize(value).toBase64() === toBase64(bytes), 'NONCANONICAL'); return value
}
/** Exact effects-version Journal/append/head evidence. The root's original
 * descriptor and supplied Standard type origin must still be authenticated by
 * the complete root/tree verifier; this is deliberately NOT a business receipt.
 * All object reads specify original versions, never an RPC's latest children. */
export async function readFormsHistoricalJournal(input: {
  client: SuiGrpcClient; record: FormsManagementRecord; journalId: string; standardTypeOrigin: string; signal: AbortSignal
}) {
  const record = parseFormsManagementRecord(input.record), p = record.plan, journalId = input.journalId, standard = input.standardTypeOrigin
  check([journalId, standard].every(id => /^0x[0-9a-f]{64}$/.test(id) && !/^0x0+$/.test(id)), 'ID')
  check(p.journalId === null || p.journalId === journalId, 'JOURNAL_ID')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const execution = await readFormsFinalizedExecution({ ...input, record, signal })
  if (execution.status !== 'FINALIZED_EXECUTION') return execution
  const effects = execution.effects, tx = execution.transactionDigest, app = p.target.application.originalPackageId
  const moduleWrapper = `0x2::dynamic_object_field::Wrapper<${standard}::soul::ModuleKey<${app}::forms::Witness>>`
  const expectedOwner = deriveDynamicFieldID(p.soulId, moduleWrapper, bcs.byteVector().serialize(new TextEncoder().encode('forms')).toBytes())
  const read = (objectId: string, type: string, mode: 'input' | 'created' | 'mutated') => readHistoricalMoveObject({ client: input.client,
    effects, transactionDigest: tx, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const row = await read(journalId, `${app}::forms::Journal`, p.journalId === null ? 'created' : 'mutated')
  const after = decode(ApplicationFormsJournalBcs, row.bytes)
  check(row.object.owner.ObjectOwner === expectedOwner && after.id === journalId && after.root === p.soulId
    && after.revision === String(BigInt(p.expectedJournal) + 1n) && after.history.size === after.revision && after.heads.size === after.forms, 'JOURNAL_OUTPUT')
  let before: ReturnType<typeof ApplicationFormsJournalBcs.parse> | null = null
  if (p.journalId !== null) {
    const old = await read(journalId, `${app}::forms::Journal`, 'input'); before = decode(ApplicationFormsJournalBcs, old.bytes)
    check(old.object.owner.ObjectOwner === expectedOwner && before.id === journalId && before.root === p.soulId
      && before.revision === p.expectedJournal && before.history.id === after.history.id && before.heads.id === after.heads.id, 'JOURNAL_INPUT')
  } else check(p.action.kind === 'SAVE' && p.expectedJournal === '0', 'FIRST_JOURNAL')
  const id = deriveDynamicFieldID(after.history.id, 'u64', bcs.u64().serialize(after.revision).toBytes())
  const transitionCodec = bcs.struct('TransitionField', { id: bcs.Address, name: bcs.u64(), value: ApplicationFormTransitionBcs })
  const written = await read(id, `0x2::dynamic_field::Field<u64,${app}::forms::Transition>`, 'created')
  const field = decode(transitionCodec, written.bytes), transition = field.value
  check(field.id === id && field.name === after.revision && written.object.owner.ObjectOwner === after.history.id
    && transition.root === p.soulId && transition.sequence === after.revision && transition.actor === p.author
    && transition.epoch === effects.V2!.executedEpoch && transition.snapshot_commitment.length === 32
    && toHex(transition.previous) === (before ? toHex(before.head) : '00'.repeat(32)), 'TRANSITION_BINDING')
  const { commitment, ...base } = transition
  check(toHex(sha3_256(ApplicationFormTransitionCommitmentBcs.serialize({ domain: new TextEncoder().encode('soulidity/form-transition/v1'), schema: 1, ...base }).toBytes()))
    === toHex(commitment) && toHex(commitment) === toHex(after.head), 'TRANSITION_HASH')
  const a = p.action
  let beforeHead: string | null = null, afterHead: string | null = null
  if (a.kind === 'SAVE') {
    check(transition.operation === 0 && toHex(transition.reference.name) === a.nameHex
      && transition.reference.version === String(BigInt(a.expectedHead) + 1n), 'SAVE_REFERENCE')
    const name = transition.reference.name, headId = deriveDynamicFieldID(after.heads.id, 'vector<u8>', bcs.byteVector().serialize(name).toBytes())
    const codec = bcs.struct('HeadField', { id: bcs.Address, name: bcs.byteVector(), value: bcs.u64() })
    const current = await read(headId, '0x2::dynamic_field::Field<vector<u8>,u64>', a.expectedHead === '0' ? 'created' : 'mutated')
    const head = decode(codec, current.bytes)
    check(head.id === headId && toHex(head.name) === a.nameHex && head.value === transition.reference.version
      && current.object.owner.ObjectOwner === after.heads.id, 'HEAD_OUTPUT'); afterHead = head.value
    if (a.expectedHead === '0') beforeHead = '0'
    else {
      const previous = await read(headId, '0x2::dynamic_field::Field<vector<u8>,u64>', 'input'), old = decode(codec, previous.bytes)
      check(old.id === headId && toHex(old.name) === a.nameHex && old.value === a.expectedHead
        && previous.object.owner.ObjectOwner === after.heads.id, 'HEAD_INPUT'); beforeHead = old.value
    }
  } else check(transition.operation === 1 && toHex(transition.reference.name) === a.reference.nameHex
    && transition.reference.version === a.reference.version, 'ACTIVATE_REFERENCE')
  signal.throwIfAborted()
  return { status: 'HISTORICAL_JOURNAL_EVIDENCE' as const, checkpoint: execution.checkpoint, transactionDigest: tx,
    effects, before, after, transition, beforeHead, afterHead, journalReference: row.reference,
    requiresOriginalRootModuleMembership: true as const, completeBusinessOutputVerified: false as const }
}
