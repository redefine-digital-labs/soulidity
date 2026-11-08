import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../../sui/pinned-move-package'
import { receiveManagementSoul } from './receive'
import { readApplicationManagementState } from './application-state'

const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector(), Table = bcs.struct('Table', { id: A, size: U })
export const ApplicationFormReferenceBcs = bcs.struct('Reference', { name: V, version: U })
export const ApplicationFormActivationBcs = bcs.struct('Activation', { reference: ApplicationFormReferenceBcs, snapshot: A,
  commitment: V, application_revision: U, composition: V })
export const ApplicationFormsJournalBcs = bcs.struct('Journal', { id: A, root: A, revision: U, forms: U, versions: U,
  heads: Table, history: Table, head: V, active: bcs.option(ApplicationFormActivationBcs) })
export const ApplicationFormTransitionBcs = bcs.struct('Transition', { root: A, sequence: U, operation: bcs.u8(), actor: A, epoch: U,
  reference: ApplicationFormReferenceBcs, snapshot: A, snapshot_commitment: V, previous: V, commitment: V })
export const ApplicationFormTransitionCommitmentBcs = bcs.struct('TransitionCommitment', { domain: V, schema: bcs.u16(), root: A,
  sequence: U, operation: bcs.u8(), actor: A, epoch: U, reference: ApplicationFormReferenceBcs, snapshot: A, snapshot_commitment: V, previous: V })
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`APPLICATION_FORMS_${code}`) }
const bytesEqual = (a: Iterable<number>, b: Iterable<number>) => toHex(Uint8Array.from(a)) === toHex(Uint8Array.from(b))

/** Verify the entire append-only chain and derive heads from its actual saves.
 * A surviving activation receipt is current only when its exact composition
 * hash matches the current Application, including creator variant commitments. */
export function verifyApplicationFormsHistory(journal: ReturnType<typeof ApplicationFormsJournalBcs.parse>,
  history: ReturnType<typeof ApplicationFormTransitionBcs.parse>[], recipeHash: string) {
  check(BigInt(history.length) === BigInt(journal.revision) && journal.history.size === journal.revision, 'HISTORY_COUNT')
  let previous = new Uint8Array(32), saves = 0n
  const heads = new Map<string, { name: Uint8Array; version: string }>(), snapshots = new Map<string, { id: string; commitment: Uint8Array }>()
  let activation: Pick<ReturnType<typeof ApplicationFormActivationBcs.parse>, 'reference' | 'snapshot' | 'commitment'> | null = null
  for (let i = 0; i < history.length; i++) {
    const row = history[i], name = toHex(Uint8Array.from(row.reference.name)), reference = `${name}:${row.reference.version}`
    check(row.root === journal.root && row.sequence === String(i + 1) && row.reference.name.length > 0 && row.reference.name.length <= 64
      && BigInt(row.reference.version) > 0n && row.snapshot_commitment.length === 32 && bytesEqual(row.previous, previous), 'TRANSITION_BINDING')
    const { commitment, ...base } = row
    const calculated = sha3_256(ApplicationFormTransitionCommitmentBcs.serialize({ domain: new TextEncoder().encode('soulidity/form-transition/v1'), schema: 1, ...base }).toBytes())
    check(bytesEqual(calculated, commitment), 'TRANSITION_HASH'); previous = calculated
    if (row.operation === 0) {
      check(!snapshots.has(reference) && BigInt(row.reference.version) === BigInt(heads.get(name)?.version ?? '0') + 1n, 'SAVE_VERSION')
      snapshots.set(reference, { id: row.snapshot, commitment: row.snapshot_commitment }); heads.set(name, { name: row.reference.name, version: row.reference.version }); saves++
    } else {
      check(row.operation === 1, 'OPERATION'); const saved = snapshots.get(reference)
      check(saved && saved.id === row.snapshot && bytesEqual(saved.commitment, row.snapshot_commitment), 'ACTIVATION_SNAPSHOT')
      activation = { reference: row.reference, snapshot: row.snapshot, commitment: row.snapshot_commitment }
    }
  }
  check(saves === BigInt(journal.versions) && BigInt(heads.size) === BigInt(journal.forms) && journal.heads.size === journal.forms
    && bytesEqual(previous, journal.head), 'JOURNAL_TOTALS')
  check(Boolean(journal.active) === Boolean(activation), 'ACTIVE_RECEIPT')
  if (journal.active && activation) check(ApplicationFormReferenceBcs.serialize(journal.active.reference).toBase64() === ApplicationFormReferenceBcs.serialize(activation.reference).toBase64()
    && journal.active.snapshot === activation.snapshot && bytesEqual(journal.active.commitment, activation.commitment)
    && journal.active.composition.length === 32, 'ACTIVE_RECEIPT')
  return { heads: [...heads.values()], activeIsCurrent: !!journal.active && toHex(Uint8Array.from(journal.active.composition)) === recipeHash }
}

/** Actual optional Standard Forms module. Complete bounded history is required;
 * exceeding the explicit limit fails instead of silently truncating it. Public
 * names are Forms identifiers, never private encrypted library names. */
export async function readApplicationFormsHistory(input: Parameters<typeof readApplicationManagementState>[0]) {
  const target = structuredClone(input.target), signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const guard = () => { signal.throwIfAborted(); check(input.getViewerAddress() === input.viewerAddress, 'WALLET_CHANGED') }
  guard(); const state = await readApplicationManagementState({ ...input, target, signal })
  const before = await receiveManagementSoul({ ...input, target, signal })
  const origins = await readPinnedMovePackageOrigins(input.client, target.application, signal)
  const type = (name: string) => { const origin = origins.get(`forms::${name}`); check(origin, 'TYPE_ORIGIN'); return `${origin}::forms::${name}` }
  const modules = before.modules.filter(row => row.namespace === normalizeStructTag(type('Witness')) && row.nameHex === '666f726d73')
  check(modules.length <= 1, 'MODULE_ALIAS')
  const descriptor = modules[0]
  if (!descriptor) {
    const final = await receiveManagementSoul({ ...input, target, signal })
    check(JSON.stringify(before) === JSON.stringify(final), 'SOURCE_CHANGED_RETRY'); guard()
    return { soulId: state.soulId, installed: false as const, notAuthorization: true as const }
  }
  check(descriptor.schema === 2 && !descriptor.removable && descriptor.valueType === normalizeStructTag(type('Journal')), 'MODULE_SCHEMA')
  const seen = new Map<string, { type: string; owner: string | null; version: string; digest: string }>()
  async function read(objectId: string, expectedType: string, owner: string | null) {
    guard(); const { response } = await profileReadStep(signal, () => input.client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    guard(); const row = response.object
    check(row?.objectId === objectId && typeof row.version === 'bigint' && row.version > 0n && row.digest
      && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 256 * 1024, 'OBJECT')
    const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(expectedType) && (!owner || raw.owner.ObjectOwner === owner), 'TYPE_OWNER')
    const old = seen.get(objectId); check(!old || old.version === String(row.version) && old.digest === row.digest, 'CHANGED_RETRY')
    seen.set(objectId, { type: expectedType, owner, version: String(row.version), digest: row.digest }); return move.contents
  }
  const bytes = await read(descriptor.objectId, type('Journal'), null), journal = ApplicationFormsJournalBcs.parse(bytes)
  check(ApplicationFormsJournalBcs.serialize(journal).toBase64() === toBase64(bytes) && journal.root === state.soulId && journal.id === descriptor.objectId
    && toHex(sha3_256(bytes)) === descriptor.bodyHash && descriptor.semanticHash === descriptor.bodyHash, 'JOURNAL_BINDING')
  check(BigInt(journal.revision) <= 4096n, 'HISTORY_BOUND')
  check(new Set([journal.id, journal.heads.id, journal.history.id]).size === 3
    && (!journal.active || BigInt(journal.active.application_revision) <= BigInt(state.applicationRevision)), 'JOURNAL_TABLES')
  const history: ReturnType<typeof ApplicationFormTransitionBcs.parse>[] = []
  for (let sequence = 1n; sequence <= BigInt(journal.revision); sequence++) {
    const id = deriveDynamicFieldID(journal.history.id, 'u64', U.serialize(sequence).toBytes())
    const codec = bcs.struct('HistoryField', { id: A, name: U, value: ApplicationFormTransitionBcs })
    const raw = await read(id, `0x2::dynamic_field::Field<u64,${type('Transition')}>`, journal.history.id), field = codec.parse(raw)
    check(codec.serialize(field).toBase64() === toBase64(raw) && field.id === id && field.name === String(sequence), 'HISTORY_FIELD'); history.push(field.value)
  }
  const verified = verifyApplicationFormsHistory(journal, history, state.recipeHash)
  for (const head of verified.heads) {
    const name = Uint8Array.from(head.name), id = deriveDynamicFieldID(journal.heads.id, 'vector<u8>', V.serialize(name).toBytes())
    const codec = bcs.struct('HeadField', { id: A, name: V, value: U })
    const raw = await read(id, '0x2::dynamic_field::Field<vector<u8>,u64>', journal.heads.id), field = codec.parse(raw)
    check(codec.serialize(field).toBase64() === toBase64(raw) && field.id === id && bytesEqual(field.name, name) && field.value === head.version, 'HEAD_FIELD')
  }
  for (const [id, row] of seen) await read(id, row.type, row.owner)
  const after = await readApplicationManagementState({ ...input, target, signal }), reception = await receiveManagementSoul({ ...input, target, signal })
  check(JSON.stringify(state) === JSON.stringify(after) && JSON.stringify(before) === JSON.stringify(reception), 'SOURCE_CHANGED_RETRY'); guard()
  return { soulId: state.soulId, installed: true as const, journal, history, ...verified, snapshotsVerified: false as const, notAuthorization: true as const }
}
