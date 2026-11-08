import { Transaction } from '@mysten/sui/transactions'
import { fromHex, fromBase58, toBase58 } from '@mysten/sui/utils'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'

export interface FormsReference { nameHex: string; version: string }
export interface FormsManagementPlan {
  target: { chainIdentifier: string; application: PinnedMovePackage; model: PinnedMovePackage }
  author: string; kioskId: string; accountId: string; soulId: string; applicationId: string; journalId: string | null
  expectedRoot: string; expectedApplication: string; expectedGeneration: string; expectedJournal: string
  action: { kind: 'SAVE'; nameHex: string; parent: FormsReference | null; expectedHead: string }
    | { kind: 'ACTIVATE'; reference: FormsReference; itemIds: string[]; expectedRecipe: string }
}
const MAX = (1n << 64n) - 1n
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_MUTATION_${code}`) }
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join(), 'FIELDS')
}
function id(v: unknown): asserts v is string { check(typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v), 'ID') }
function uint(v: unknown, positive = false): asserts v is string {
  check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= MAX && (!positive || BigInt(v) > 0n), 'U64')
}
function name(v: unknown): asserts v is string { check(typeof v === 'string' && /^(?:[0-9a-f]{2}){1,64}$/.test(v), 'NAME') }
function reference(v: FormsReference) { exact(v, ['nameHex', 'version']); name(v.nameHex); uint(v.version, true) }
function pin(p: PinnedMovePackage) {
  exact(p, ['originalPackageId', 'callablePackageId', 'callableDigest']); id(p.originalPackageId); id(p.callablePackageId)
  check(typeof p.callableDigest === 'string' && p.callableDigest.length <= 44
    && fromBase58(p.callableDigest).length === 32 && toBase58(fromBase58(p.callableDigest)) === p.callableDigest, 'PIN_DIGEST')
}
/** Exact unsigned current-candidate intent. This does not qualify live custody,
 * ABI/callable/type origins, snapshot, effects or durable recovery. Public Forms
 * names are on-chain identifiers, distinct from encrypted private-library names. */
export function parseFormsManagementPlan(input: unknown): FormsManagementPlan {
  const p = structuredClone(input) as FormsManagementPlan
  exact(p, ['target', 'author', 'kioskId', 'accountId', 'soulId', 'applicationId', 'journalId', 'expectedRoot', 'expectedApplication', 'expectedGeneration', 'expectedJournal', 'action'])
  exact(p.target, ['chainIdentifier', 'application', 'model']); check(p.target.chainIdentifier === '35834a8a', 'CHAIN')
  pin(p.target.application); pin(p.target.model)
  ;[p.author, p.kioskId, p.accountId, p.soulId, p.applicationId].forEach(id)
  if (p.journalId !== null) id(p.journalId)
  ;[p.expectedRoot, p.expectedApplication, p.expectedGeneration, p.expectedJournal].forEach(v => uint(v))
  check(BigInt(p.expectedRoot) > 0n && BigInt(p.expectedRoot) <= MAX - 2n
    && BigInt(p.expectedApplication) < MAX && BigInt(p.expectedJournal) < MAX, 'REVISION_OVERFLOW')
  const a = p.action, roles = [p.kioskId, p.accountId, p.soulId, p.applicationId, ...(p.journalId ? [p.journalId] : [])]
  if (a.kind === 'SAVE') {
    exact(a, ['kind', 'nameHex', 'parent', 'expectedHead']); name(a.nameHex); uint(a.expectedHead)
    check(BigInt(a.expectedHead) < MAX, 'HEAD_OVERFLOW'); if (a.parent !== null) reference(a.parent)
    if (p.journalId === null) check(p.expectedJournal === '0' && a.expectedHead === '0' && a.parent === null, 'FIRST_SAVE')
    else check(BigInt(p.expectedJournal) > 0n, 'JOURNAL_REVISION')
    if (a.expectedHead !== '0' && a.parent !== null) check(a.parent.nameHex === a.nameHex && a.parent.version === a.expectedHead, 'PARENT_HEAD')
  } else {
    check(a.kind === 'ACTIVATE', 'ACTION'); exact(a, ['kind', 'reference', 'itemIds', 'expectedRecipe']); reference(a.reference)
    check(p.journalId !== null && BigInt(p.expectedJournal) > 0n && /^[0-9a-f]{64}$/.test(a.expectedRecipe) && !/^0+$/.test(a.expectedRecipe), 'ACTIVATION')
    check(Array.isArray(a.itemIds) && a.itemIds.length <= 512, 'ITEM_BOUND'); a.itemIds.forEach(id); roles.push(...a.itemIds)
  }
  const packages = [p.target.application, p.target.model].flatMap(pin => [pin.originalPackageId, pin.callablePackageId])
  check(p.target.application.originalPackageId !== p.target.model.originalPackageId && new Set(roles).size === roles.length
    && roles.every(role => !packages.includes(role) && role !== p.author), 'OBJECT_ALIAS')
  return p
}

/** Construct custom structs by their public Move constructors, never pretend
 * arbitrary Reference/Option<Reference> is a pure PTB input. Returned linear
 * vector<Item> is consumed by the fixed sender-return helper in this same PTB. */
export function buildFormsManagementTransaction(input: FormsManagementPlan) {
  const p = parseFormsManagementPlan(input), tx = new Transaction(), app = p.target.application.callablePackageId
  tx.setSender(p.author)
  const refType = `${p.target.application.originalPackageId}::forms::Reference`
  const makeReference = (r: FormsReference) => tx.moveCall({ target: `${app}::forms::reference`,
    arguments: [tx.pure.vector('u8', fromHex(r.nameHex)), tx.pure.u64(r.version)] })
  const common = () => [tx.object(p.kioskId), tx.object(p.accountId), tx.pure.id(p.soulId)]
  const a = p.action
  if (a.kind === 'SAVE') {
    const parent = a.parent === null ? tx.moveCall({ target: '0x1::option::none', typeArguments: [refType] })
      : tx.moveCall({ target: '0x1::option::some', typeArguments: [refType], arguments: [makeReference(a.parent)] })
    tx.moveCall({ target: `${app}::forms::save_account`, arguments: [...common(), tx.pure.vector('u8', fromHex(a.nameHex)), parent,
      tx.pure.u64(a.expectedHead), tx.pure.u64(p.expectedJournal), tx.pure.u64(p.expectedGeneration), tx.pure.u64(p.expectedRoot), tx.pure.u64(p.expectedApplication)] })
  } else {
    const reference = makeReference(a.reference), items = tx.makeMoveVec({ type: `${p.target.model.originalPackageId}::components::Item`, elements: a.itemIds.map(id => tx.object(id)) })
    const returned = tx.moveCall({ target: `${app}::forms::activate_account`, arguments: [...common(), reference, items,
      tx.pure.u64(p.expectedJournal), tx.pure.u64(p.expectedGeneration), tx.pure.u64(p.expectedRoot), tx.pure.u64(p.expectedApplication), tx.pure.vector('u8', fromHex(a.expectedRecipe))] })
    tx.moveCall({ target: `${app}::forms::return_items_to_sender`, arguments: [returned] })
  }
  return { transaction: tx, signingQualified: false as const, liveTypeOriginsVerified: false as const, plan: p }
}
