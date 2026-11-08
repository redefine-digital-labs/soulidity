import { bcs } from '@mysten/sui/bcs'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { toHex } from '@mysten/sui/utils'
import { parseFormsManagementPlan, type FormsManagementPlan } from './application-forms-mutation'
import { ApplicationFormsJournalBcs, ApplicationFormReferenceBcs, ApplicationFormActivationBcs,
  ApplicationFormTransitionBcs, ApplicationFormTransitionCommitmentBcs } from './application-forms'
import { ApplicationFormSnapshotBcs } from './application-form-snapshot'
import { ManagementApplicationBcs } from './application-bcs'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_BUSINESS_${code}`) }
const hash = (v: Iterable<number>) => toHex(Uint8Array.from(v))
const activation = bcs.option(ApplicationFormActivationBcs)

/** Business relation on ORIGINAL historical input/output values. The caller
 * must authenticate each value against original effects/version/type/owner and
 * must still verify complete Snapshot/Item/root outputs. This partial relation
 * is deliberately not an acceptance receipt or a PublicMutationQuery success. */
export function verifyFormsJournalMutation(input: {
  plan: FormsManagementPlan; executedEpoch: string
  before: ReturnType<typeof ApplicationFormsJournalBcs.parse> | null
  after: ReturnType<typeof ApplicationFormsJournalBcs.parse>
  // SAVE authenticates changed heads; ACTIVATE uses the immutable selected snapshot.
  beforeHead: string | null; afterHead: string | null
  transition: ReturnType<typeof ApplicationFormTransitionBcs.parse>
  snapshot: ReturnType<typeof ApplicationFormSnapshotBcs.parse>
  applicationBefore: ReturnType<typeof ManagementApplicationBcs.parse>
  applicationAfter: ReturnType<typeof ManagementApplicationBcs.parse>
}) {
  const p = parseFormsManagementPlan(input.plan), { before, after, transition: row, snapshot, applicationBefore: appBefore, applicationAfter: appAfter } = structuredClone(input)
  for (const value of [input.executedEpoch, ...[input.beforeHead, input.afterHead].filter((value): value is string => value !== null)]) check(/^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= (1n << 64n) - 1n, 'U64')
  check(after.root === p.soulId && appBefore.root === p.soulId && appAfter.root === p.soulId
    && appBefore.id === p.applicationId && appAfter.id === p.applicationId && appBefore.revision === p.expectedApplication, 'APPLICATION_BINDING')
  check(after.revision === String(BigInt(p.expectedJournal) + 1n) && after.history.size === after.revision && after.heads.size === after.forms
    && after.head.length === 32 && new Set([after.id, after.heads.id, after.history.id]).size === 3, 'JOURNAL_OUTPUT')
  if (before) check(before.id === p.journalId && after.id === before.id && before.root === p.soulId && before.revision === p.expectedJournal
    && before.history.size === before.revision && before.heads.size === before.forms && before.heads.id === after.heads.id
    && before.history.id === after.history.id && hash(row.previous) === hash(before.head), 'JOURNAL_INPUT')
  else check(p.journalId === null && p.expectedJournal === '0' && hash(row.previous) === '00'.repeat(32)
    && p.action.kind === 'SAVE' && input.beforeHead === '0', 'FIRST_JOURNAL')
  check(row.root === p.soulId && row.sequence === after.revision && row.actor === p.author && row.epoch === input.executedEpoch
    && row.snapshot_commitment.length === 32 && hash(row.commitment) === hash(after.head), 'TRANSITION_BINDING')
  const { commitment, ...base } = row
  check(hash(sha3_256(ApplicationFormTransitionCommitmentBcs.serialize({ domain: new TextEncoder().encode('soulidity/form-transition/v1'), schema: 1, ...base }).toBytes()))
    === hash(commitment), 'TRANSITION_HASH')
  check(snapshot.id === row.snapshot && snapshot.root === p.soulId && snapshot.application === p.applicationId
    && hash(snapshot.commitment) === hash(row.snapshot_commitment)
    && ApplicationFormReferenceBcs.serialize(snapshot.reference).toBase64() === ApplicationFormReferenceBcs.serialize(row.reference).toBase64(), 'SNAPSHOT_BINDING')
  const a = p.action, oldVersions = before?.versions ?? '0', oldForms = before?.forms ?? '0'
  if (a.kind === 'SAVE') {
    check(row.operation === 0 && hash(row.reference.name) === a.nameHex && row.reference.version === String(BigInt(a.expectedHead) + 1n)
      && input.beforeHead === a.expectedHead && input.afterHead === row.reference.version, 'SAVE_REFERENCE')
    check(after.versions === String(BigInt(oldVersions) + 1n) && after.forms === String(BigInt(oldForms) + (a.expectedHead === '0' ? 1n : 0n))
      && activation.serialize(after.active).toBase64() === activation.serialize(before?.active ?? null).toBase64(), 'SAVE_TOTALS')
    check(snapshot.creator === p.author && snapshot.epoch === input.executedEpoch && snapshot.application_revision === p.expectedApplication
      && ManagementApplicationBcs.serialize(appBefore).toBase64() === ManagementApplicationBcs.serialize(appAfter).toBase64(), 'SAVE_CAPTURE')
    const expectedParent = a.expectedHead !== '0' ? { name: row.reference.name, version: a.expectedHead }
      : a.parent === null ? null : { name: Uint8Array.from(a.parent.nameHex.match(/../g)!, byte => parseInt(byte, 16)), version: a.parent.version }
    check(bcs.option(ApplicationFormReferenceBcs).serialize(snapshot.parent).toBase64() === bcs.option(ApplicationFormReferenceBcs).serialize(expectedParent).toBase64(), 'SAVE_PARENT')
  } else {
    check(before && row.operation === 1 && hash(row.reference.name) === a.reference.nameHex && row.reference.version === a.reference.version
      && input.beforeHead === null && input.afterHead === null, 'ACTIVATE_REFERENCE')
    check(after.versions === oldVersions && after.forms === oldForms && appAfter.revision === String(BigInt(p.expectedApplication) + 1n)
      && hash(appBefore.recipe_hash) === a.expectedRecipe, 'ACTIVATE_TOTALS')
    const active = after.active
    check(active && active.snapshot === row.snapshot && hash(active.commitment) === hash(row.snapshot_commitment)
      && ApplicationFormReferenceBcs.serialize(active.reference).toBase64() === ApplicationFormReferenceBcs.serialize(row.reference).toBase64()
      && active.application_revision === appAfter.revision && hash(active.composition) === hash(appAfter.recipe_hash), 'ACTIVATE_OUTPUT')
  }
  return { journalId: after.id, journalRevision: after.revision, snapshotId: snapshot.id,
    journalTransitionVerified: true as const, completeBusinessOutputVerified: false as const }
}
