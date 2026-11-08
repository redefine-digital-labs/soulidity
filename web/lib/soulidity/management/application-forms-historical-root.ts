import { normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { deriveKioskItemFieldId } from '@soulidity/sdk'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { CanonicalSoulBcs } from '../canonical-native-workbench'
import { ApplicationFormsJournalBcs } from './application-forms'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalJournal } from './application-forms-historical-journal'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_ROOT_${code}`) }
type Root = ReturnType<typeof CanonicalSoulBcs.parse>
const canonical = (value: unknown) => JSON.stringify(value)
function module(root: Root, namespace: string, name: string) {
  const matches = root.modules.filter(row => normalizeStructTag(row.namespace.name) === normalizeStructTag(namespace)
    && toHex(row.name) === toHex(new TextEncoder().encode(name)))
  check(matches.length <= 1, 'MODULE_ALIAS'); return matches[0] ?? null
}

/** Authenticate original root input/output and Journal descriptor membership.
 * Supplied Standard origin is checked against the effects-authenticated actual
 * object type, but release/code qualification and the full Kiosk/Account field
 * tree, Application/Snapshot/Item outputs remain separate mandatory proofs. */
export async function readFormsHistoricalRoot(input: Parameters<typeof readFormsHistoricalJournal>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan, standard = input.standardTypeOrigin
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const journal = await readFormsHistoricalJournal({ ...input, record, signal })
  if (journal.status !== 'HISTORICAL_JOURNAL_EVIDENCE') return journal
  const args = { client: input.client, effects: journal.effects, transactionDigest: journal.transactionDigest,
    objectId: p.soulId, type: `${standard}::soul::Soul`, signal, maxBytes: 256 * 1024 }
  const old = await readHistoricalMoveObject({ ...args, mode: 'input' }), written = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
  const before = CanonicalSoulBcs.parse(old.bytes), after = CanonicalSoulBcs.parse(written.bytes)
  check(CanonicalSoulBcs.serialize(before).toBase64() === toBase64(old.bytes) && CanonicalSoulBcs.serialize(after).toBase64() === toBase64(written.bytes), 'NONCANONICAL')
  const nativeField = deriveKioskItemFieldId(p.kioskId, p.soulId)
  check(old.object.owner.ObjectOwner === nativeField && written.object.owner.ObjectOwner === nativeField
    && before.id === p.soulId && after.id === p.soulId && before.schema === 1 && after.schema === 1 && !before.editing && !after.editing
    && before.revision === p.expectedRoot && before.name === after.name && canonical(before.origin) === canonical(after.origin), 'ORIGINAL_ROOT')
  const increments = p.action.kind === 'ACTIVATE' || p.journalId === null ? 2n : 1n
  check(after.revision === String(BigInt(p.expectedRoot) + increments), 'ROOT_REVISION')
  const app = p.target.application.originalPackageId
  const beforeApp = module(before, `${app}::character::ApplicationWitness`, 'animacraft')
  const afterApp = module(after, `${app}::character::ApplicationWitness`, 'animacraft')
  check(beforeApp && afterApp && [beforeApp, afterApp].every(row => row.object === p.applicationId && row.schema === 3 && !row.removable
    && normalizeStructTag(row.value_type.name) === normalizeStructTag(`${app}::character::ApplicationState`)), 'APPLICATION_MODULE')
  const beforeForms = module(before, `${app}::forms::Witness`, 'forms'), afterForms = module(after, `${app}::forms::Witness`, 'forms')
  check(afterForms && afterForms.object === journal.after.id && afterForms.schema === 2 && !afterForms.removable
    && normalizeStructTag(afterForms.value_type.name) === normalizeStructTag(`${app}::forms::Journal`), 'FORMS_MODULE')
  const digest = toHex(sha3_256(ApplicationFormsJournalBcs.serialize(journal.after).toBytes()))
  check(toHex(afterForms.body_hash) === digest && toHex(afterForms.semantic_hash) === digest, 'JOURNAL_OUTPUT_COMMITMENT')
  if (journal.before) {
    check(beforeForms && beforeForms.object === p.journalId && beforeForms.schema === 2 && !beforeForms.removable
      && normalizeStructTag(beforeForms.value_type.name) === normalizeStructTag(`${app}::forms::Journal`), 'JOURNAL_INPUT_MODULE')
    const oldDigest = toHex(sha3_256(ApplicationFormsJournalBcs.serialize(journal.before).toBytes()))
    check(toHex(beforeForms.body_hash) === oldDigest && toHex(beforeForms.semantic_hash) === oldDigest, 'JOURNAL_INPUT_COMMITMENT')
  } else check(beforeForms === null, 'FIRST_JOURNAL_ABSENCE')
  if (p.action.kind === 'SAVE') check(canonical(beforeApp) === canonical(afterApp), 'SAVE_APPLICATION_CHANGED')
  const key = (row: Root['modules'][number]) => `${normalizeStructTag(row.namespace.name)}:${toHex(row.name)}`
  const unaffected = (root: Root) => root.modules.filter(row => {
    const k = key(row); return k !== key(afterForms) && (p.action.kind === 'SAVE' || k !== key(afterApp))
  }).sort((a, b) => key(a).localeCompare(key(b)))
  check(new Set(before.modules.map(key)).size === before.modules.length && new Set(after.modules.map(key)).size === after.modules.length
    && after.modules.length === before.modules.length + (beforeForms ? 0 : 1)
    && canonical(unaffected(before)) === canonical(unaffected(after)), 'UNRELATED_MODULE_CHANGED')
  signal.throwIfAborted()
  return { ...journal, status: 'HISTORICAL_ROOT_JOURNAL_EVIDENCE' as const, rootBefore: before, rootAfter: after,
    applicationDescriptorBefore: beforeApp, applicationDescriptorAfter: afterApp,
    rootReference: written.reference, rootJournalMembershipVerified: true as const,
    requiresOriginalRootModuleMembership: false as const, requiresKioskAccountTreeProof: true as const,
    completeBusinessOutputVerified: false as const }
}
