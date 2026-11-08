import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { fromBase58, toBase58, fromBase64 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { ManagementPartBcs } from '../management/application-bcs'
import { parseOriginalSoulEnhancementPlan, type OriginalSoulEnhancementPlan } from './original-soul-enhancement-transaction'

export interface OriginalSoulEnhancementAccountPlan {
  /** Unsigned graph data, never a second journal or authorization schema. */
  schema: 'soulidity.original-soul-enhancement-account-plan.v1'
  /** soul is an observed child-object reference used as metadata only. It is
   * never supplied as a direct owned transaction input by this composer. The
   * payment is this contribution's exact amount; access acquisition is separate. */
  intent: OriginalSoulEnhancementPlan
  custody: { kiosk: OriginalSoulEnhancementPlan['maker']; account: OriginalSoulEnhancementPlan['soul']; expectedStandardRevision: string }
}
const CLOCK = `0x${'0'.repeat(63)}6`, MAX = (1n << 64n) - 1n
function check(v: unknown, code: string): asserts v { if (!v) throw Error('SOUL_ENHANCEMENT_ACCOUNT_PLAN_' + code) }
function fields(v: unknown, names: string[]) {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join(), 'FIELDS')
}
function id(v: unknown): asserts v is string { check(typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v), 'ID') }
function positive(v: unknown): asserts v is string {
  check(typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= MAX, 'REVISION')
}
function bytes(hex: string) { return Uint8Array.from(hex.match(/../g)!, value => parseInt(value, 16)) }
export function parseOriginalSoulEnhancementAccountPlan(input: OriginalSoulEnhancementAccountPlan) {
  const p = structuredClone(input)
  fields(p, ['schema', 'intent', 'custody']); check(p.schema === 'soulidity.original-soul-enhancement-account-plan.v1', 'SCHEMA')
  p.intent = parseOriginalSoulEnhancementPlan(p.intent)
  fields(p.custody, ['kiosk', 'account', 'expectedStandardRevision'])
  const { account, kiosk } = p.custody
  fields(kiosk, ['objectId', 'initialSharedVersion']); id(kiosk.objectId); positive(kiosk.initialSharedVersion)
  fields(account, ['objectId', 'version', 'digest']); id(account.objectId); positive(account.version)
  check(typeof account.digest === 'string' && account.digest.length <= 44, 'ACCOUNT_DIGEST')
  const digest = fromBase58(account.digest); check(digest.length === 32 && toBase58(digest) === account.digest, 'ACCOUNT_DIGEST')
  positive(p.custody.expectedStandardRevision)
  const i = p.intent, writes = BigInt(i.choices.length) + (i.contribution.kind === 'PACK' ? 2n : 1n)
  check(BigInt(p.custody.expectedStandardRevision) + writes <= MAX && BigInt(i.expectedApplicationRevision) < MAX, 'REVISION_OVERFLOW')
  const roles = [kiosk.objectId, account.objectId, i.soul.objectId, i.maker.objectId, i.config.objectId, i.system.objectId, CLOCK,
    ...(i.contribution.kind === 'PACK' ? [i.contribution.pack.objectId] : []), ...i.payment.coins.map(row => row.objectId), ...i.expectedReturnedItemIds]
  const packageIds = [i.target.adapter, i.target.application, i.target.manufacturing, i.target.model].flatMap(row => [row.originalPackageId, row.callablePackageId])
  check(new Set(roles).size === roles.length && roles.every(role => role !== i.actor && !packageIds.includes(role)), 'OBJECT_ALIAS')
  return p
}

/** Actual public Account wrapper graph for one contribution. Uses the observed
 * Account reference and shared Kiosk; the nested Soul enters only as a pure ID.
 * Existing Parts are constructed by management_part_account with both CAS and
 * the exact typed-part hash. New Pack Parts come from the published profile.
 * Source/ABI/owner/price/supply, durable original-first preparation and same-byte
 * full simulation are mandatory before this unsigned graph can be enabled. */
export function buildOriginalSoulEnhancementAccountTransaction(input: OriginalSoulEnhancementAccountPlan) {
  const tx = new Transaction(), p = parseOriginalSoulEnhancementAccountPlan(input); tx.setSender(p.intent.actor)
  appendUnsignedOriginalSoulEnhancementAccountContribution(tx, p)
  return { transaction: tx, plan: p, rootSuppliedAsOwnedInput: false as const,
    sourceQualified: false as const, ABIQualified: false as const, ownerAuthorityVerified: false as const, compatibilityVerified: false as const,
    quoteVerified: false as const, signingQualified: false as const, delivered: false as const, notPreparedPayment: true as const }
}

/** Low-level unsigned graph composition only. The basket composer supplies
 * Parts obtained before any mutation and one shared, exact-payment coin pool.
 * This helper supplies no source/owner/payment/simulation authorization. */
export function appendUnsignedOriginalSoulEnhancementAccountContribution(tx: Transaction, input: OriginalSoulEnhancementAccountPlan,
  options?: { parts: TransactionArgument[]; payment: TransactionArgument }) {
  const p = parseOriginalSoulEnhancementAccountPlan(input), i = p.intent, t = i.target
  check(!options || options.parts.length === i.choices.length, 'PART_ARGUMENTS')
  const call = (pkg: string, module: string, fn: string, args: TransactionArgument[], types: string[] = []) => tx.moveCall({ target: `${pkg}::${module}::${fn}`, arguments: args, typeArguments: types })
  const shared = (ref: OriginalSoulEnhancementPlan['maker'], mutable: boolean) => tx.sharedObjectRef({ ...ref, mutable })
  const kiosk = shared(p.custody.kiosk, true), account = tx.objectRef(p.custody.account), root = tx.pure.id(i.soul.objectId)
  const maker = shared(i.maker, i.contribution.kind === 'MAKER'), cfg = shared(i.config, true), system = shared(i.system, false)
  const product = i.contribution.kind === 'PACK' ? shared(i.contribution.pack, true) : maker
  const purchaseModule = t.route === 'MAKER_SOUL' ? 'maker_soul' : 'issuer'
  const choices = i.choices.map((choice, index) => {
    const part = options ? options.parts[index] : choice.part.kind === 'EXISTING'
      ? call(t.application.callablePackageId, 'character', 'management_part_account', [kiosk, account, root, tx.pure.u64(choice.part.index),
        tx.pure.vector('u8', sha256(fromBase64(choice.partBcs))), tx.pure.u64(i.expectedApplicationRevision), tx.pure.u64(p.custody.expectedStandardRevision)])
      : call(t.model.callablePackageId, 'assembly', 'scoped_part', [call(t.model.callablePackageId, 'assembly', 'profile_scope', [call(t.manufacturing.callablePackageId, 'maker_catalog', 'assembly_profile', [product, tx.pure.u64(i.contribution.version)], [t.coinType])]),
        tx.pure.vector('u8', ManagementPartBcs.parse(fromBase64(choice.partBcs)).key)])
    const l = choice.layout, layout = call(t.model.callablePackageId, 'policy', 'layout_signed', [tx.pure.bool(l.x_negative), tx.pure.u64(l.x), tx.pure.bool(l.y_negative), tx.pure.u64(l.y), tx.pure.u64(l.scale_ppm), tx.pure.bool(l.rotation_negative), tx.pure.u64(l.rotation_mdeg), tx.pure.vector('u8', l.color)])
    return call(t.adapter.callablePackageId, purchaseModule, 'purchase', [tx.pure.vector('u8', bytes(choice.definitionHash)), part, layout])
  })
  const purchases = tx.makeMoveVec({ type: `${t.adapter.originalPackageId}::${purchaseModule}::Purchase`, elements: choices })
  let payment: TransactionArgument
  if (options) payment = options.payment
  else if (i.payment.amount === '0') payment = call('0x2', 'coin', 'zero', [], [t.coinType])
  else {
    const [primary, ...rest] = i.payment.coins.map(coin => tx.objectRef(coin))
    if (rest.length) tx.mergeCoins(primary, rest)
    payment = tx.splitCoins(primary, [tx.pure.u64(i.payment.amount)])[0]
  }
  const args = [kiosk, account, root, product, ...(i.contribution.kind === 'PACK' ? [maker] : []), cfg,
    ...(i.contribution.kind === 'PACK' ? [tx.pure.u64(i.contribution.version)] : []), tx.pure.u64(i.expectedApplicationRevision), tx.pure.u64(p.custody.expectedStandardRevision),
    tx.pure.vector('u8', bytes(i.contribution.policyHash)), purchases, tx.pure.vector('u8', bytes(i.attemptHex)), tx.pure.u64(i.feeRevision), tx.pure.u64(i.expiryMs), payment,
    shared({ objectId: CLOCK, initialSharedVersion: '1' }, false), system]
  const returned = call(t.adapter.callablePackageId, t.route === 'MAKER_SOUL' ? 'maker_soul' : 'runtime', i.contribution.kind === 'PACK' ? 'enhance_pack_account' : 'enhance_maker_account', args, [t.coinType])
  const itemType = `${t.model.originalPackageId}::components::Item`
  const oldItems = i.expectedReturnedItemIds.map(() => call('0x1', 'vector', 'pop_back', [returned], [itemType]))
  call('0x1', 'vector', 'destroy_empty', [returned], [itemType])
  if (!options && oldItems.length) tx.transferObjects(oldItems, i.actor)
  return oldItems
}
