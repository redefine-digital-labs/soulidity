import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { ManagementLayoutBcs, ManagementPartBcs } from '../management/application-bcs'
import { validateCurrentMakerPackage } from '../../animacraft/current-maker-transactions'

type OwnedRef = { objectId: string; version: string; digest: string }
type SharedRef = { objectId: string; initialSharedVersion: string }
type Layout = ReturnType<typeof ManagementLayoutBcs.parse>
export interface OriginalSoulEnhancementPlan {
  /** Unsigned composer input, not a durable-operation or recovery schema. */
  schema: 'soulidity.original-soul-enhancement-plan.v1'
  target: { chainIdentifier: string; coinType: string; route: 'MAKER_SOUL' | 'NATIVE_APPLICATION'
    adapter: PinnedMovePackage; manufacturing: PinnedMovePackage; model: PinnedMovePackage; application: PinnedMovePackage }
  actor: string; soul: OwnedRef; maker: SharedRef; config: SharedRef; system: SharedRef
  contribution: { kind: 'MAKER'; version: string; policyHash: string }
    | { kind: 'PACK'; pack: SharedRef; version: string; policyHash: string }
  expectedApplicationRevision: string; feeRevision: string; expiryMs: string; attemptHex: string
  /** Exact independently reviewed quote total; no fee/price is guessed here. */
  payment: { amount: string; coins: OwnedRef[] }
  choices: { definitionHash: string; partBcs: string; layout: Layout
    part: { kind: 'EXISTING'; index: number } | { kind: 'NEW_PACK'; keyHex: string } }[]
  /** Proven before-slot free Item IDs. Their exact identities require effects
   * proof; the graph consumes this many returned linear Items, to actor only. */
  expectedReturnedItemIds: string[]
}
const MAX = 18446744073709551615n, CLOCK = `0x${'0'.repeat(63)}6`
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`SOUL_ENHANCEMENT_PLAN_${code}`) }
function fields(value: unknown, names: string[]) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...names].sort().join(), 'FIELDS')
}
function id(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'ID') }
function uint(value: unknown, positive = false): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'U64')
}
function hex(value: unknown, length = 32) {
  check(typeof value === 'string' && new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value), 'HEX')
  return Uint8Array.from(value.match(/../g)!, v => parseInt(v, 16))
}
function owned(value: OwnedRef) {
  fields(value, ['objectId', 'version', 'digest']); id(value.objectId); uint(value.version, true)
  check(typeof value.digest === 'string' && value.digest.length <= 44, 'DIGEST')
  const bytes = fromBase58(value.digest); check(bytes.length === 32 && toBase58(bytes) === value.digest, 'DIGEST')
}
function shared(value: SharedRef) { fields(value, ['objectId', 'initialSharedVersion']); id(value.objectId); uint(value.initialSharedVersion, true) }
export function parseOriginalSoulEnhancementPlan(input: OriginalSoulEnhancementPlan): OriginalSoulEnhancementPlan {
  const p = structuredClone(input)
  fields(p, ['schema', 'target', 'actor', 'soul', 'maker', 'config', 'system', 'contribution', 'expectedApplicationRevision', 'feeRevision', 'expiryMs', 'attemptHex', 'payment', 'choices', 'expectedReturnedItemIds'])
  check(p.schema === 'soulidity.original-soul-enhancement-plan.v1', 'SCHEMA')
  fields(p.target, ['chainIdentifier', 'coinType', 'route', 'adapter', 'manufacturing', 'model', 'application'])
  check(p.target.chainIdentifier === '35834a8a' && ['MAKER_SOUL', 'NATIVE_APPLICATION'].includes(p.target.route), 'TARGET')
  check(typeof p.target.coinType === 'string' && p.target.coinType.length <= 2048 && normalizeStructTag(p.target.coinType) === p.target.coinType, 'COIN')
  const packages = ['adapter', 'manufacturing', 'model', 'application'] as const
  for (const name of packages) { fields(p.target[name], ['originalPackageId', 'callablePackageId', 'callableDigest']); p.target[name] = validateCurrentMakerPackage(p.target[name]) }
  check(new Set(packages.map(name => p.target[name].originalPackageId)).size === packages.length
    && new Set(packages.map(name => p.target[name].callablePackageId)).size === packages.length, 'PACKAGE_ALIAS')
  id(p.actor); owned(p.soul); shared(p.maker); shared(p.config); shared(p.system)
  uint(p.expectedApplicationRevision); uint(p.feeRevision); uint(p.expiryMs, true); hex(p.attemptHex)
  check(p.attemptHex !== '0'.repeat(64), 'ATTEMPT')
  if (p.contribution.kind === 'MAKER') fields(p.contribution, ['kind', 'version', 'policyHash'])
  else { check(p.contribution.kind === 'PACK', 'CONTRIBUTION'); fields(p.contribution, ['kind', 'pack', 'version', 'policyHash']); shared(p.contribution.pack) }
  uint(p.contribution.version, true); hex(p.contribution.policyHash)
  fields(p.payment, ['amount', 'coins']); uint(p.payment.amount)
  check(Array.isArray(p.payment.coins) && p.payment.coins.length <= 256
    && (p.payment.amount === '0' ? p.payment.coins.length === 0 : p.payment.coins.length > 0), 'PAYMENT')
  for (const coin of p.payment.coins) owned(coin)
  const roles = [p.soul.objectId, p.maker.objectId, p.config.objectId, p.system.objectId, CLOCK,
    ...(p.contribution.kind === 'PACK' ? [p.contribution.pack.objectId] : []), ...p.payment.coins.map(coin => coin.objectId)]
  const packageIds = packages.flatMap(name => [p.target[name].originalPackageId, p.target[name].callablePackageId])
  check(new Set(roles).size === roles.length && roles.every(role => !packageIds.includes(role)), 'OBJECT_ALIAS')
  check(Array.isArray(p.choices) && p.choices.length > 0 && p.choices.length <= 512, 'CHOICES')
  const parts = new Set<string>(), indices = new Set<number>()
  for (const choice of p.choices) {
    fields(choice, ['definitionHash', 'partBcs', 'layout', 'part']); hex(choice.definitionHash)
    check(typeof choice.partBcs === 'string' && choice.partBcs.length <= 4096, 'PART')
    const part = ManagementPartBcs.parse(fromBase64(choice.partBcs))
    check(ManagementPartBcs.serialize(part).toBase64() === choice.partBcs && part.key.length > 0 && part.key.length <= 64 && !parts.has(choice.partBcs), 'PART')
    parts.add(choice.partBcs)
    if (choice.part.kind === 'EXISTING') {
      fields(choice.part, ['kind', 'index'])
      check(Number.isInteger(choice.part.index) && choice.part.index >= 0 && choice.part.index < 512 && !indices.has(choice.part.index), 'PART_INDEX'); indices.add(choice.part.index)
    } else {
      check(choice.part.kind === 'NEW_PACK' && p.contribution.kind === 'PACK', 'NEW_PACK')
      fields(choice.part, ['kind', 'keyHex']); const key = choice.part.keyHex
      check(typeof key === 'string' && /^(?:[0-9a-f]{2}){1,64}$/.test(key) && Array.from(part.key, v => v.toString(16).padStart(2, '0')).join('') === key, 'PACK_KEY')
      check(part.scope?.product === p.contribution.pack.objectId && part.scope.version === p.contribution.version
        && part.scope.protocol === p.config.objectId && Array.from(part.scope.policy, v => v.toString(16).padStart(2, '0')).join('') === p.contribution.policyHash
        && normalizeStructTag(part.scope.source_type.name) === normalizeStructTag(`${p.target.manufacturing.originalPackageId}::maker_catalog::Product<${p.target.coinType}>`), 'PACK_SCOPE')
    }
    const l = choice.layout
    fields(l, ['x_negative', 'x', 'y_negative', 'y', 'scale_ppm', 'rotation_mdeg', 'rotation_negative', 'color'])
    uint(l.x); uint(l.y); uint(l.scale_ppm, true); uint(l.rotation_mdeg)
    check(typeof l.x_negative === 'boolean' && typeof l.y_negative === 'boolean' && typeof l.rotation_negative === 'boolean'
      && (!l.x_negative || l.x !== '0') && (!l.y_negative || l.y !== '0') && (!l.rotation_negative || l.rotation_mdeg !== '0'), 'LAYOUT_SIGN')
    check(l.color instanceof Uint8Array && [0, 4].includes(l.color.length), 'COLOR')
    check(ManagementLayoutBcs.serialize(l).toBase64() === ManagementLayoutBcs.serialize(ManagementLayoutBcs.parse(ManagementLayoutBcs.serialize(l).toBytes())).toBase64(), 'LAYOUT')
  }
  check(Array.isArray(p.expectedReturnedItemIds) && p.expectedReturnedItemIds.length <= p.choices.length, 'RETURNED_ITEMS')
  const returned = new Set<string>()
  for (const item of p.expectedReturnedItemIds) { id(item); check(!returned.has(item) && !roles.includes(item) && !packageIds.includes(item), 'RETURNED_ALIAS'); returned.add(item) }
  return p
}

/** Actual existing-Soul contribution graph. No new Soul/Complete/BEGIN, quota
 * calculation, gas selection, source installation, journal, signing or RPC.
 * Public getters/constructors supply every custom Move value. Before-state
 * compatibility, prices, rights, returned identities and all-effects proof
 * remain mandatory caller obligations, not facts established by this builder. */
export function buildOriginalSoulEnhancementTransaction(input: OriginalSoulEnhancementPlan) {
  const p = parseOriginalSoulEnhancementPlan(input), tx = new Transaction(); tx.setSender(p.actor)
  const t = p.target, module = t.route === 'MAKER_SOUL' ? 'maker_soul' : 'runtime', purchaseModule = t.route === 'MAKER_SOUL' ? 'maker_soul' : 'issuer'
  const object = (ref: SharedRef, mutable: boolean) => tx.sharedObjectRef({ ...ref, mutable })
  const soul = tx.objectRef(p.soul), maker = object(p.maker, p.contribution.kind === 'MAKER'), cfg = object(p.config, true), system = object(p.system, false)
  const product = p.contribution.kind === 'PACK' ? object(p.contribution.pack, true) : maker
  const call = (pkg: string, module: string, fn: string, args: TransactionArgument[], types: string[] = []) => tx.moveCall({ target: `${pkg}::${module}::${fn}`, arguments: args, typeArguments: types })
  const choices = p.choices.map(choice => {
    const part = choice.part.kind === 'EXISTING'
      ? call('0x1', 'vector', 'remove', [call(t.application.callablePackageId, 'character', 'parts', [soul]), tx.pure.u64(choice.part.index)], [`${t.model.originalPackageId}::assembly::PartKey`])
      : call(t.model.callablePackageId, 'assembly', 'scoped_part', [call(t.model.callablePackageId, 'assembly', 'profile_scope', [call(t.manufacturing.callablePackageId, 'maker_catalog', 'assembly_profile', [product, tx.pure.u64(p.contribution.version)], [t.coinType])]), tx.pure.vector('u8', ManagementPartBcs.parse(fromBase64(choice.partBcs)).key)])
    const l = choice.layout, layout = call(t.model.callablePackageId, 'policy', 'layout_signed', [tx.pure.bool(l.x_negative), tx.pure.u64(l.x), tx.pure.bool(l.y_negative), tx.pure.u64(l.y), tx.pure.u64(l.scale_ppm), tx.pure.bool(l.rotation_negative), tx.pure.u64(l.rotation_mdeg), tx.pure.vector('u8', l.color)])
    return call(t.adapter.callablePackageId, purchaseModule, 'purchase', [tx.pure.vector('u8', hex(choice.definitionHash)), part, layout])
  })
  const purchases = tx.makeMoveVec({ type: `${t.adapter.originalPackageId}::${purchaseModule}::Purchase`, elements: choices })
  let payment: TransactionArgument
  if (p.payment.amount === '0') payment = call('0x2', 'coin', 'zero', [], [t.coinType])
  else {
    const [primary, ...rest] = p.payment.coins.map(coin => tx.objectRef(coin))
    if (rest.length) tx.mergeCoins(primary, rest)
    payment = tx.splitCoins(primary, [tx.pure.u64(p.payment.amount)])[0]
  }
  const args = [soul, product, ...(p.contribution.kind === 'PACK' ? [maker] : []), cfg,
    ...(p.contribution.kind === 'PACK' ? [tx.pure.u64(p.contribution.version)] : []), tx.pure.u64(p.expectedApplicationRevision),
    tx.pure.vector('u8', hex(p.contribution.policyHash)), purchases, tx.pure.vector('u8', hex(p.attemptHex)), tx.pure.u64(p.feeRevision), tx.pure.u64(p.expiryMs), payment,
    object({ objectId: CLOCK, initialSharedVersion: '1' }, false), system]
  const returned = call(t.adapter.callablePackageId, module, p.contribution.kind === 'PACK' ? 'enhance_pack' : 'enhance_maker', args, [t.coinType])
  const itemType = `${t.model.originalPackageId}::components::Item`
  const items = p.expectedReturnedItemIds.map(() => call('0x1', 'vector', 'pop_back', [returned], [itemType]))
  call('0x1', 'vector', 'destroy_empty', [returned], [itemType])
  if (items.length) tx.transferObjects(items, p.actor)
  return { transaction: tx, plan: p, signingQualified: false as const, sourceQualified: false as const,
    compatibilityVerified: false as const, quoteVerified: false as const, delivered: false as const }
}
