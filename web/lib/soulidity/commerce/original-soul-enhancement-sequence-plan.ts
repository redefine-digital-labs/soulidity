import { Transaction, type TransactionArgument, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { fromBase64, toBase64, fromHex, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { ManagementLayoutBcs, ManagementPartBcs } from '../management/application-bcs'
import { appendUnsignedOriginalSoulEnhancementAccountContribution, parseOriginalSoulEnhancementAccountPlan, type OriginalSoulEnhancementAccountPlan as AccountPlan } from './original-soul-enhancement-account-transaction'
import type { UnsignedOriginalSoulEnhancementAccess } from './original-soul-enhancement-plan-values'
import { validateOriginalSoulEnhancementCoinRefs, type OriginalSoulEnhancementCoinRef } from './original-soul-enhancement-plan-values'
export type EnhancementSequenceContext = Pick<AccountPlan['intent'], 'target' | 'actor' | 'soul' | 'maker' | 'config' | 'system' | 'feeRevision' | 'expiryMs'> & { custody: AccountPlan['custody']; initialApplicationRevision: string; makerVersion: string; makerPolicyHash: string }
export type EnhancementSequencePart = { partBcs: string; constructor: { kind: 'EXISTING'; index: number } | { kind: 'PROFILE'; product: AccountPlan['intent']['maker']; version: string } }
type Before = { applicationBefore: string; standardBefore: string }
export type EnhancementSequenceStep = Before & (
  | { kind: 'CONTRIBUTE'; contribution: AccountPlan['intent']['contribution']; choices: Array<{ definitionHash: string; part: number; layoutBcs: string }>; amount: string; attemptHex: string; returnedItemIds: string[] }
  | { kind: 'CLEAR_SLOT'; part: number; operation: 'DETACH_ITEM' | 'CLEAR_REFERENCE' | 'UNMOUNT_BOUND'; returnedItemId: string | null }
  | { kind: 'REMOUNT_REFERENCE' | 'REMOUNT_BOUND'; part: number; permanentIndex: string; layoutBcs: string }
  | { kind: 'TUNE_EXISTING'; part: number; layoutBcs: string })
export interface OriginalSoulEnhancementSequencePlan {
  schema: 'soulidity.original-soul-enhancement-sequence.v1'; context: EnhancementSequenceContext
  parts: EnhancementSequencePart[]; steps: EnhancementSequenceStep[]; accessPlans: UnsignedOriginalSoulEnhancementAccess[]; fundingCoins: OriginalSoulEnhancementCoinRef[]
}
const MAX = (1n << 64n) - 1n
function check(v: unknown, code: string): asserts v { if (!v) throw Error('SOUL_ENHANCEMENT_SEQUENCE_' + code) }
function fields(v: unknown, names: string[]) { check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join(), 'FIELDS') }
function uint(v: unknown, positive = false): asserts v is string { check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= MAX && (!positive || BigInt(v) > 0n), 'U64') }
function layout(encoded: string) {
  check(typeof encoded === 'string' && encoded.length <= 128, 'LAYOUT')
  const value = ManagementLayoutBcs.parse(fromBase64(encoded)); check(ManagementLayoutBcs.serialize(value).toBase64() === encoded && [0, 4].includes(value.color.length)
    && BigInt(value.x) <= 8192000n && BigInt(value.y) <= 8192000n && BigInt(value.scale_ppm) > 0n && BigInt(value.scale_ppm) <= 100000000n && BigInt(value.rotation_mdeg) <= 360000n
    && (!value.x_negative || value.x !== '0') && (!value.y_negative || value.y !== '0') && (!value.rotation_negative || value.rotation_mdeg !== '0'), 'LAYOUT'); return value
}
export function enhancementSequenceContribution(p: OriginalSoulEnhancementSequencePlan, s: Extract<EnhancementSequenceStep, { kind: 'CONTRIBUTE' }>): AccountPlan {
  const c = p.context
  return { schema: 'soulidity.original-soul-enhancement-account-plan.v1', custody: { ...c.custody, expectedStandardRevision: s.standardBefore }, intent: {
    schema: 'soulidity.original-soul-enhancement-plan.v1', target: c.target, actor: c.actor, soul: c.soul, maker: c.maker, config: c.config, system: c.system,
    contribution: s.contribution, expectedApplicationRevision: s.applicationBefore, feeRevision: c.feeRevision, expiryMs: c.expiryMs, attemptHex: s.attemptHex,
    payment: { amount: s.amount, coins: s.amount === '0' ? [] : p.fundingCoins }, expectedReturnedItemIds: s.returnedItemIds,
    choices: s.choices.map(choice => { const part = p.parts[choice.part], value = ManagementPartBcs.parse(fromBase64(part.partBcs)); return {
      definitionHash: choice.definitionHash, partBcs: part.partBcs, layout: layout(choice.layoutBcs),
      part: part.constructor.kind === 'EXISTING' ? part.constructor : { kind: 'NEW_PACK', keyHex: toHex(value.key) },
    } }),
  } }
}
/** Portable domain intent only, never a fabricated RPC observation. Shape and
 * graph reconstruction do not authenticate compatibility, old Item metadata,
 * historical state, installed source or current Account authority. */
export function parseOriginalSoulEnhancementSequencePlan(input: unknown): OriginalSoulEnhancementSequencePlan {
  const p = structuredClone(input) as OriginalSoulEnhancementSequencePlan
  fields(p, ['schema', 'context', 'parts', 'steps', 'accessPlans', 'fundingCoins']); check(p.schema === 'soulidity.original-soul-enhancement-sequence.v1', 'SCHEMA')
  fields(p.context, ['target', 'actor', 'soul', 'maker', 'config', 'system', 'feeRevision', 'expiryMs', 'custody', 'initialApplicationRevision', 'makerVersion', 'makerPolicyHash'])
  check(Array.isArray(p.parts) && p.parts.length > 0 && p.parts.length <= 512 && Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 1024
    && Array.isArray(p.accessPlans) && p.accessPlans.length <= 512, 'BOUNDS')
  validateOriginalSoulEnhancementCoinRefs(p.fundingCoins)
  uint(p.context.makerVersion, true); check(/^[0-9a-f]{64}$/.test(p.context.makerPolicyHash), 'MAKER_POLICY')
  const parts = new Set<string>(), indices = new Set<number>()
  for (const part of p.parts) {
    fields(part, ['partBcs', 'constructor']); check(typeof part.partBcs === 'string' && part.partBcs.length <= 4096, 'PART')
    const value = ManagementPartBcs.parse(fromBase64(part.partBcs)); check(ManagementPartBcs.serialize(value).toBase64() === part.partBcs && value.key.length > 0 && value.key.length <= 64 && !parts.has(part.partBcs), 'PART'); parts.add(part.partBcs)
    if (part.constructor.kind === 'EXISTING') {
      fields(part.constructor, ['kind', 'index']); check(Number.isInteger(part.constructor.index) && part.constructor.index >= 0 && part.constructor.index < 512 && !indices.has(part.constructor.index), 'PART_INDEX'); indices.add(part.constructor.index)
    } else {
      check(part.constructor.kind === 'PROFILE', 'PART_CONSTRUCTOR'); fields(part.constructor, ['kind', 'product', 'version'])
      uint(part.constructor.version, true); check(value.scope?.product === part.constructor.product.objectId && value.scope.version === part.constructor.version, 'PROFILE_SCOPE')
    }
  }
  const partAt = (n: number) => { check(Number.isInteger(n) && n >= 0 && n < p.parts.length, 'PART_ARGUMENT'); return p.parts[n] }
  let app = BigInt(p.context.initialApplicationRevision), std = BigInt(p.context.custody.expectedStandardRevision), count = 0, total = 0n
  uint(p.context.initialApplicationRevision); uint(p.context.custody.expectedStandardRevision, true)
  const admitted = new Set<string>()
  const placements = new Set<number>(), cleared = new Set<number>(), returned = new Set<string>(), attempts = new Set<string>(), groups = new Set<string>(), used = new Set<number>()
  for (const step of p.steps) {
    uint(step.applicationBefore); uint(step.standardBefore, true); check(step.applicationBefore === String(app) && step.standardBefore === String(std), 'STEP_CAS')
    let commits = 1n
    if (step.kind === 'CONTRIBUTE') {
      fields(step, ['kind', 'applicationBefore', 'standardBefore', 'contribution', 'choices', 'amount', 'attemptHex', 'returnedItemIds'])
      check(Array.isArray(step.choices) && step.choices.length > 0 && step.choices.length <= 512, 'CHOICES')
      for (const choice of step.choices) { fields(choice, ['definitionHash', 'part', 'layoutBcs']); partAt(choice.part); check(!placements.has(choice.part), 'PART_PLACED_TWICE'); placements.add(choice.part); used.add(choice.part) }
      const parsed = parseOriginalSoulEnhancementAccountPlan(enhancementSequenceContribution(p, step)), i = parsed.intent
      if (i.contribution.kind === 'MAKER') check(i.contribution.version === p.context.makerVersion && i.contribution.policyHash === p.context.makerPolicyHash, 'MAKER_VERSION')
      const product = i.contribution.kind === 'PACK' ? i.contribution.pack.objectId : i.maker.objectId, group = `${product}:${i.contribution.version}`
      check(!groups.has(group) && !attempts.has(i.attemptHex), 'DUPLICATE_CONTRIBUTION'); groups.add(group); attempts.add(i.attemptHex)
      for (const id of step.returnedItemIds) { check(!returned.has(id), 'RETURNED_TWICE'); returned.add(id) }
      if (step.contribution.kind === 'PACK') admitted.add(`${step.contribution.pack.objectId}:${step.contribution.version}`)
      count++; total += BigInt(step.amount); commits = BigInt(step.choices.length) + (step.contribution.kind === 'PACK' ? 2n : 1n)
    } else {
      partAt(step.part); used.add(step.part)
      if (step.kind === 'CLEAR_SLOT') {
        fields(step, ['kind', 'applicationBefore', 'standardBefore', 'part', 'operation', 'returnedItemId'])
        check(p.parts[step.part].constructor.kind === 'EXISTING', 'CLEAR_INITIAL_PART')
        check(['DETACH_ITEM', 'CLEAR_REFERENCE', 'UNMOUNT_BOUND'].includes(step.operation) && !cleared.has(step.part) && !placements.has(step.part), 'CLEAR_ORDER'); cleared.add(step.part)
        check(step.operation === 'DETACH_ITEM' ? typeof step.returnedItemId === 'string' && /^0x[0-9a-f]{64}$/.test(step.returnedItemId) && !/^0x0+$/.test(step.returnedItemId) : step.returnedItemId === null, 'DETACH_ID')
        if (step.returnedItemId) { check(!returned.has(step.returnedItemId), 'RETURNED_TWICE'); returned.add(step.returnedItemId) }
      } else {
        check(['REMOUNT_REFERENCE', 'REMOUNT_BOUND', 'TUNE_EXISTING'].includes(step.kind) && !placements.has(step.part), 'OWNER_STEP'); placements.add(step.part)
        fields(step, ['kind', 'applicationBefore', 'standardBefore', 'part', 'layoutBcs', ...(step.kind === 'TUNE_EXISTING' ? [] : ['permanentIndex'])]); layout(step.layoutBcs)
        const constructor = p.parts[step.part].constructor
        check(constructor.kind === 'EXISTING' || step.kind !== 'TUNE_EXISTING' && admitted.has(`${constructor.product.objectId}:${constructor.version}`), 'OWNER_PART_NOT_ADMITTED')
        if (step.kind !== 'TUNE_EXISTING') { uint(step.permanentIndex); check(BigInt(step.permanentIndex) < 512n, 'PERMANENT_INDEX') }
      }
    }
    app++; std += commits; check(app <= MAX && std <= MAX, 'REVISION_OVERFLOW')
  }
  check(count > 0 && used.size === p.parts.length, 'UNUSED_PART_OR_NO_CONTRIBUTION')
  const c = p.context, roleIds = [c.actor, c.soul.objectId, c.maker.objectId, c.config.objectId, c.system.objectId, c.custody.account.objectId, c.custody.kiosk.objectId,
    ...[c.target.adapter, c.target.application, c.target.manufacturing, c.target.model].flatMap(x => [x.originalPackageId, x.callablePackageId]), `0x${'0'.repeat(63)}6`, ...returned]
  const business = new Set(roleIds.slice(0, roleIds.length - returned.size)), sharedVersions = new Map<string, string>([[c.maker.objectId, c.maker.initialSharedVersion]])
  for (const step of p.steps) if (step.kind === 'CONTRIBUTE' && step.contribution.kind === 'PACK') {
    const ref = step.contribution.pack; check(!sharedVersions.has(ref.objectId) || sharedVersions.get(ref.objectId) === ref.initialSharedVersion, 'SHARED_REFERENCE'); sharedVersions.set(ref.objectId, ref.initialSharedVersion); business.add(ref.objectId)
  }
  for (const id of returned) check(!business.has(id), 'RETURNED_ALIAS')
  for (const part of p.parts) if (part.constructor.kind === 'PROFILE') {
    const ctor = part.constructor, value = ManagementPartBcs.parse(fromBase64(part.partBcs))
    const match = p.steps.find(step => step.kind === 'CONTRIBUTE' && step.contribution.kind === 'PACK' && step.contribution.pack.objectId === ctor.product.objectId && step.contribution.version === ctor.version)
    check(match?.kind === 'CONTRIBUTE' && match.contribution.kind === 'PACK' && match.contribution.pack.initialSharedVersion === ctor.product.initialSharedVersion
      && toHex(value.scope!.policy) === match.contribution.policyHash, 'PROFILE_CONTRIBUTION')
  }
  validateOriginalSoulEnhancementCoinRefs(p.fundingCoins, [...business, ...returned])
  const acquisitions = new Set<string>()
  for (const access of p.accessPlans) {
    fields(access, ['kind', 'product', 'version', 'policyHash', 'attemptHex', 'amount']); fields(access.product, ['objectId', 'initialSharedVersion'])
    uint(access.version, true); uint(access.product.initialSharedVersion, true); uint(access.amount)
    check(['BUY', 'CLAIM'].includes(access.kind) && /^[0-9a-f]{64}$/.test(access.policyHash) && /^[0-9a-f]{64}$/.test(access.attemptHex) && access.attemptHex !== '0'.repeat(64)
      && (access.kind === 'BUY' ? BigInt(access.amount) > 0n : access.amount === '0'), 'ACCESS')
    const group = `${access.product.objectId}:${access.version}`; check(!acquisitions.has(group), 'ACCESS_TWICE'); acquisitions.add(group)
    const match = p.steps.find(s => s.kind === 'CONTRIBUTE' && s.contribution.version === access.version
      && (s.contribution.kind === 'PACK' ? s.contribution.pack.objectId : c.maker.objectId) === access.product.objectId)
    // Inherited Maker qualification may have no Maker contribution in this basket.
    check(access.product.objectId === c.maker.objectId || match, 'ACCESS_PRODUCT')
    if (access.product.objectId === c.maker.objectId) check(access.product.initialSharedVersion === c.maker.initialSharedVersion && access.version === c.makerVersion && access.policyHash === c.makerPolicyHash, 'ACCESS_REFERENCE')
    else if (match?.kind === 'CONTRIBUTE' && match.contribution.kind === 'PACK') check(access.product.initialSharedVersion === match.contribution.pack.initialSharedVersion && access.policyHash === match.contribution.policyHash, 'ACCESS_REFERENCE')
    total += BigInt(access.amount)
  }
  check(total <= MAX && (total === 0n ? p.fundingCoins.length === 0 : p.fundingCoins.length > 0), 'PAYMENT_POOL')
  return p
}

/** Offline independent reconstruction from the compact, explicit domain plan.
 * No RPC graph, observed UID, receipt, source installation or wallet authority
 * is created. Layout/Part bytes are canonical typed metadata. */
export function buildOriginalSoulEnhancementSequenceTransaction(input: OriginalSoulEnhancementSequencePlan) {
  const p = parseOriginalSoulEnhancementSequencePlan(input), c = p.context, tx = new Transaction(); tx.setSender(c.actor)
  const call = (pkg: string, module: string, fn: string, args: TransactionArgument[], types: string[] = []) => tx.moveCall({ target: `${pkg}::${module}::${fn}`, arguments: args, typeArguments: types })
  const shared = (r: AccountPlan['intent']['maker'], mutable: boolean) => tx.sharedObjectRef({ ...r, mutable })
  const kiosk = shared(c.custody.kiosk, true), account = tx.objectRef(c.custody.account), root = tx.pure.id(c.soul.objectId)
  const app = c.target.application.callablePackageId, model = c.target.model.callablePackageId
  const parts = p.parts.map(row => row.constructor.kind === 'EXISTING'
    ? call(app, 'character', 'management_part_account', [kiosk, account, root, tx.pure.u64(row.constructor.index), tx.pure.vector('u8', sha256(fromBase64(row.partBcs))), tx.pure.u64(c.initialApplicationRevision), tx.pure.u64(c.custody.expectedStandardRevision)])
    : call(model, 'assembly', 'scoped_part', [call(model, 'assembly', 'profile_scope', [call(c.target.manufacturing.callablePackageId, 'maker_catalog', 'assembly_profile', [shared(row.constructor.product, true), tx.pure.u64(row.constructor.version)], [c.target.coinType])]), tx.pure.vector('u8', ManagementPartBcs.parse(fromBase64(row.partBcs)).key)]))
  let pool: TransactionArgument | null = null
  if (p.fundingCoins.length) { const [first, ...rest] = p.fundingCoins.map(ref => tx.objectRef(ref)); pool = first; if (rest.length) tx.mergeCoins(first, rest) }
  for (const access of p.accessPlans) {
    const args: TransactionArgument[] = [shared(access.product, true), shared(c.config, true), tx.pure.u64(access.version), tx.pure.vector('u8', fromHex(access.policyHash)), tx.pure.u64(c.feeRevision), tx.pure.u64(c.expiryMs), tx.pure.vector('u8', fromHex(access.attemptHex))]
    if (access.kind === 'BUY') { check(pool, 'POOL'); args.push(tx.splitCoins(pool, [tx.pure.u64(access.amount)])[0]) }
    const clock = shared({ objectId: `0x${'0'.repeat(63)}6`, initialSharedVersion: '1' }, false), system = shared(c.system, false)
    args.push(...(c.target.route === 'MAKER_SOUL' ? [system, clock] : [clock, system]))
    call(c.target.route === 'MAKER_SOUL' ? c.target.manufacturing.callablePackageId : c.target.adapter.callablePackageId, c.target.route === 'MAKER_SOUL' ? 'maker_factory' : 'runtime', access.kind === 'BUY' ? 'buy_access' : 'claim_access', args, [c.target.coinType])
  }
  const itemResults: TransactionObjectArgument[] = []
  const makeLayout = (encoded: string) => { const l = layout(encoded); return call(model, 'policy', 'layout_signed', [tx.pure.bool(l.x_negative), tx.pure.u64(l.x), tx.pure.bool(l.y_negative), tx.pure.u64(l.y), tx.pure.u64(l.scale_ppm), tx.pure.bool(l.rotation_negative), tx.pure.u64(l.rotation_mdeg), tx.pure.vector('u8', l.color)]) }
  for (const step of p.steps) {
    if (step.kind === 'CONTRIBUTE') {
      const payment = step.amount === '0' ? call('0x2', 'coin', 'zero', [], [c.target.coinType]) : (check(pool, 'POOL'), tx.splitCoins(pool, [tx.pure.u64(step.amount)])[0])
      itemResults.push(...appendUnsignedOriginalSoulEnhancementAccountContribution(tx, enhancementSequenceContribution(p, step), { parts: step.choices.map(choice => parts[choice.part]), payment }))
    } else {
      const args: TransactionArgument[] = [kiosk, account, root]
      if (step.kind === 'CLEAR_SLOT') {
        args.push(parts[step.part], tx.pure.u64(step.applicationBefore), tx.pure.u64(step.standardBefore))
        const result = call(app, 'character', step.operation === 'DETACH_ITEM' ? 'detach_scoped_account' : step.operation === 'UNMOUNT_BOUND' ? 'unmount_bound_scoped_account' : 'clear_reference_scoped_account', args)
        if (step.operation === 'DETACH_ITEM') itemResults.push(result)
      } else {
        if (step.kind !== 'TUNE_EXISTING') args.push(tx.pure.u64(step.permanentIndex))
        args.push(parts[step.part], makeLayout(step.layoutBcs), tx.pure.u64(step.applicationBefore), tx.pure.u64(step.standardBefore))
        call(app, 'character', step.kind === 'TUNE_EXISTING' ? 'tune_scoped_account' : step.kind === 'REMOUNT_BOUND' ? 'remount_bound_scoped_account' : 'remount_reference_scoped_account', args)
      }
    }
  }
  if (itemResults.length) tx.transferObjects(itemResults, c.actor)
  return tx
}
