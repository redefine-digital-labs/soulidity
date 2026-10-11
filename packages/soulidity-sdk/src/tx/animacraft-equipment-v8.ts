import { Transaction, type TransactionArgument, type TransactionObjectArgument, type TransactionResult } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'

/** Explicit accepted release IDs; a builder is not a live deployment/owner proof. */
export interface AnimacraftEquipmentV8Target {
  soulidityCallablePackageId: string
  runtimeOriginalPackageId: string
  protocolConfigId: string
}
export interface AnimacraftEquipmentV8Source {
  makerRootId: string
  definitionRegistryId: string
  packRegistryId: string
  makerAccessPassId: string
  paymentCoinType: string
}
export interface AnimacraftEquipmentV8Scope {
  target: AnimacraftEquipmentV8Target
  soulStateId: string
  equipmentId: string
  expectedRevision: bigint | string
}
declare const updateBrand: unique symbol
/** Opaque, transaction-local handle; the non-droppable Move guard is the authority. */
export interface AnimacraftEquipmentV8Update { readonly [updateBrand]: true }
export type AnimacraftEquipmentV8MutationScope = AnimacraftEquipmentV8Scope & { update: AnimacraftEquipmentV8Update }
export interface AnimacraftEquipmentV8FinalSource {
  definitionRegistryId: string; baseRegistryId: string
  /** Transaction-local typed proofs produced after the final mutation. */
  packDefinitionProofs?: TransactionObjectArgument[]
}
type UpdateState = { tx: Transaction; identity: string; initialRevision: bigint; nextRevision: bigint; guard: TransactionArgument; finished: boolean; definitionRegistryId?: string; baseRegistryId?: string }
const updates = new WeakMap<AnimacraftEquipmentV8Update, UpdateState>()
const begunEquipment = new WeakMap<Transaction, Set<string>>()
export interface AnimacraftEquipmentV8Placement {
  /** Omit for ordinary first-empty placement; specify to preserve an exact sparse slot. */
  targetSelectionIndex?: bigint | string
}
export type AnimacraftEquipmentV8Item =
  | { kind: 'base'; itemId: string; baseRegistryId: string; styleKey: string; swatchKey: string | null; protection?: AnimacraftEquipmentV8Protection }
  | { kind: 'external'; itemId: string; productId: string }
export type AnimacraftEquipmentV8Removal = { kind: 'base' | 'external'; itemId: string }
  | { kind: 'selection'; selectionIndex: string }
export interface AnimacraftEquipmentV8BaseSelection {
  baseRegistryId: string; partKey: string; itemKey: string; styleKey: string; swatchKey: string | null
  protection?: AnimacraftEquipmentV8Protection
}
export interface AnimacraftEquipmentV8Protection {
  sealRegistryId: string; sealPolicyId: string
  ciphertextBlobCommitment: number[]; certificationCommitment: number[]; sealId: number[]
}
export interface AnimacraftEquipmentV8PackSelection {
  baseRegistryId: string; releaseId: string; passId: string
  partKey: string; itemKey: string; styleKey: string; swatchKey: string | null
}

function objectId(value: string, label: string) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error(`${label} must be a canonical nonzero object ID`)
  }
  return value
}
function revision(value: bigint | string) {
  if ((typeof value !== 'bigint' && typeof value !== 'string') || !/^(0|[1-9][0-9]*)$/.test(String(value))) {
    throw new Error('expectedRevision must be an exact u64')
  }
  const result = BigInt(value)
  if (result > 18446744073709551615n) throw new Error('expectedRevision exceeds u64')
  return result
}
function targetSlot(value: bigint | string | undefined) {
  if (value === undefined) return null
  const index = revision(value)
  if (index >= 500n) throw new Error('targetSelectionIndex exceeds equipment capacity')
  return index
}
function key(value: string, label: string) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length === 0
    || new TextEncoder().encode(value).length > 128) throw new Error(`${label} must be 1–128 UTF-8 bytes`)
  return value
}
function target(value: AnimacraftEquipmentV8Target, fn: string): `${string}::${string}::${string}` {
  objectId(value.protocolConfigId, 'protocolConfigId')
  return `${objectId(value.soulidityCallablePackageId, 'soulidityCallablePackageId')}::animacraft_equipment_adapter_v8::${fn}`
}
function source(value: AnimacraftEquipmentV8Source) {
  for (const k of ['makerRootId', 'definitionRegistryId', 'packRegistryId', 'makerAccessPassId'] as const) objectId(value[k], k)
  if (typeof value.paymentCoinType !== 'string' || !value.paymentCoinType.includes('::')) throw new Error('paymentCoinType is required')
  normalizeStructTag(value.paymentCoinType)
}
function scope(value: AnimacraftEquipmentV8Scope) {
  objectId(value.soulStateId, 'soulStateId')
  objectId(value.equipmentId, 'equipmentId')
  return revision(value.expectedRevision)
}
function scopeIdentity(value: AnimacraftEquipmentV8Scope) {
  target(value.target, 'begin_update_v8')
  scope(value)
  objectId(value.target.runtimeOriginalPackageId, 'runtimeOriginalPackageId')
  return [value.target.soulidityCallablePackageId, value.target.runtimeOriginalPackageId, value.target.protocolConfigId, value.soulStateId, value.equipmentId].join(':')
}
function updateState(tx: Transaction, params: AnimacraftEquipmentV8MutationScope, finishing = false) {
  const state = updates.get(params.update)
  if (!state || state.tx !== tx || state.identity !== scopeIdentity(params) || state.finished) {
    throw new Error('Equipment update must be an open handle for this transaction and exact Soul scope')
  }
  if (revision(params.expectedRevision) !== (finishing ? state.initialRevision : state.nextRevision)) {
    throw new Error('Equipment update requires adjacent exact revisions')
  }
  if (!finishing && state.nextRevision === 18446744073709551615n) throw new Error('Equipment mutation would overflow revision')
  return state
}
function assertUpdateSource(state: UpdateState, definitionRegistryId: string, baseRegistryId?: string) {
  if ((state.definitionRegistryId && state.definitionRegistryId !== definitionRegistryId)
    || (state.baseRegistryId && baseRegistryId && state.baseRegistryId !== baseRegistryId)) {
    throw new Error('Equipment update source must remain exact across all mutations and finish')
  }
}

/** Begin exactly once per equipment in this PTB; finish after all mutations. */
export function beginAnimacraftEquipmentV8Update(tx: Transaction, params: AnimacraftEquipmentV8Scope): AnimacraftEquipmentV8Update {
  const identity = scopeIdentity(params); const rev = scope(params)
  const begun = begunEquipment.get(tx) ?? new Set<string>()
  if (begun.has(params.equipmentId)) throw new Error('Equipment update already began in this transaction')
  const guard = tx.moveCall({ target: target(params.target, 'begin_update_v8'), arguments: [
    tx.object(params.soulStateId), tx.object(params.equipmentId), tx.object(params.target.protocolConfigId), tx.pure.u64(rev),
  ] })
  const update = Object.freeze({}) as AnimacraftEquipmentV8Update
  updates.set(update, { tx, identity, initialRevision: rev, nextRevision: rev, guard, finished: false })
  begun.add(params.equipmentId); begunEquipment.set(tx, begun)
  return update
}

/** Consume after final sparse-loadout validation. Pass the original begin scope/revision;
 * source identities add no active Maker, access-pass or payment dependency. */
export function finishAnimacraftEquipmentV8Update(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & AnimacraftEquipmentV8FinalSource): void {
  const state = updateState(tx, params, true)
  objectId(params.definitionRegistryId, 'definitionRegistryId'); objectId(params.baseRegistryId, 'baseRegistryId')
  assertUpdateSource(state, params.definitionRegistryId, params.baseRegistryId)
  const packDefinitions = tx.makeMoveVec({
    type: `${params.target.runtimeOriginalPackageId}::runtime_v8::PackDefinitionProofV8`,
    elements: params.packDefinitionProofs ?? [],
  })
  tx.moveCall({ target: target(params.target, 'finish_update_v8'), arguments: [
    tx.object(params.equipmentId), tx.object(params.definitionRegistryId), tx.object(params.baseRegistryId), packDefinitions, state.guard,
  ] })
  state.finished = true
}

/** Read-only producer; Move binds the returned non-droppable proof to this final
 * equipment revision and attached Pack definition commitment. */
export function appendProveEquipmentPackDefinitionsV8(tx: Transaction, params: {
  runtimeCallablePackageId: string; paymentCoinType: string; equipmentId: string
  definitionRegistryId: string; baseRegistryId: string; releaseId: string; bindingIndex: bigint | string
}): TransactionResult {
  for (const name of ['runtimeCallablePackageId', 'equipmentId', 'definitionRegistryId', 'baseRegistryId', 'releaseId'] as const) objectId(params[name], name)
  if (typeof params.paymentCoinType !== 'string' || !params.paymentCoinType.includes('::')) throw new Error('paymentCoinType is required')
  normalizeStructTag(params.paymentCoinType)
  const index = revision(params.bindingIndex)
  return tx.moveCall({ target: `${params.runtimeCallablePackageId}::runtime_v8::prove_equipment_pack_definitions_v8`,
    typeArguments: [params.paymentCoinType], arguments: [tx.object(params.equipmentId), tx.object(params.definitionRegistryId),
      tx.object(params.baseRegistryId), tx.object(params.releaseId), tx.pure.u64(index)] })
}
function protection(value: AnimacraftEquipmentV8Protection) {
  objectId(value.sealRegistryId,'sealRegistryId'); objectId(value.sealPolicyId,'sealPolicyId')
  for (const row of [value.ciphertextBlobCommitment,value.certificationCommitment,value.sealId]) {
    if (!Array.isArray(row) || row.length !== 32 || row.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Protected equipment commitment must contain 32 bytes')
  }
}
function protectionArgs(tx: Transaction, value: AnimacraftEquipmentV8Protection) {
  return [tx.object(value.sealRegistryId), tx.object(value.sealPolicyId),
    tx.pure.vector('u8',value.ciphertextBlobCommitment), tx.pure.vector('u8',value.certificationCommitment), tx.pure.vector('u8',value.sealId)]
}

export function buildCreateAnimacraftEquipmentV8Tx(params: {
  target: AnimacraftEquipmentV8Target; source: AnimacraftEquipmentV8Source
  soulStateId: string; provenanceBindingId: string
}): Transaction {
  const call = target(params.target, 'create_equipment_v8')
  source(params.source)
  objectId(params.soulStateId, 'soulStateId')
  objectId(params.provenanceBindingId, 'provenanceBindingId')
  const tx = new Transaction()
  tx.moveCall({ target: call, typeArguments: [params.source.paymentCoinType], arguments: [
    tx.object(params.soulStateId), tx.object(params.provenanceBindingId),
    tx.object(params.source.makerRootId), tx.object(params.target.protocolConfigId),
    tx.object(params.source.definitionRegistryId), tx.object(params.source.packRegistryId),
    tx.object(params.source.makerAccessPassId),
  ] })
  return tx
}

/** Borrow the native owner guard; only the explicit final finish validates visibility. */
export function appendEquipAnimacraftItemV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & AnimacraftEquipmentV8Placement & {
  source: AnimacraftEquipmentV8Source; item: AnimacraftEquipmentV8Item
}): void {
  const rev = scope(params)
  const update = updateState(tx, params)
  source(params.source)
  const item = params.item
  if (item.kind !== 'base' && item.kind !== 'external') throw new Error('Unsupported component kind')
  objectId(item.itemId, 'itemId')
  const call = target(params.target, item.kind === 'base' ? item.protection ? 'equip_protected_base_v8' : 'equip_base_v8' : 'equip_external_v8')
  if (item.kind === 'base') {
    objectId(item.baseRegistryId, 'baseRegistryId'); key(item.styleKey, 'styleKey')
    if (item.swatchKey !== null) key(item.swatchKey, 'swatchKey')
    if (item.protection) protection(item.protection)
  } else objectId(item.productId, 'productId')
  assertUpdateSource(update, params.source.definitionRegistryId, item.kind === 'base' ? item.baseRegistryId : undefined)
  const args = [update.guard, tx.object(params.equipmentId), tx.object(item.itemId),
    tx.object(params.source.makerRootId),
    tx.object(params.source.definitionRegistryId), tx.object(params.source.packRegistryId),
    tx.object(item.kind === 'base' ? item.baseRegistryId : item.productId),
    tx.object(params.source.makerAccessPassId), tx.pure.u64(rev), tx.pure.option('u64', targetSlot(params.targetSelectionIndex))]
  if (item.kind === 'base') args.push(tx.pure.string(item.styleKey), tx.pure.option('string', item.swatchKey))
  if (item.kind === 'base' && item.protection) args.push(...protectionArgs(tx,item.protection))
  tx.moveCall({ target: call, typeArguments: [params.source.paymentCoinType], arguments: args })
  update.definitionRegistryId = params.source.definitionRegistryId
  if (item.kind === 'base') update.baseRegistryId = item.baseRegistryId
  update.nextRevision++
}

export function appendUnequipAnimacraftItemV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & {
  itemId: string; kind: 'base' | 'external'
}): void {
  const rev = scope(params)
  const update = updateState(tx, params)
  objectId(params.itemId, 'itemId')
  if (params.kind !== 'base' && params.kind !== 'external') throw new Error('Unsupported component kind')
  const call = target(params.target, params.kind === 'base' ? 'unequip_base_v8' : 'unequip_external_v8')
  tx.moveCall({ target: call, arguments: [update.guard, tx.object(params.equipmentId),
    tx.object(params.itemId), tx.pure.u64(rev)] })
  update.nextRevision++
}

export function appendClearAnimacraftSelectionV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & { selectionIndex: string }): void {
  const rev = scope(params); const index = revision(params.selectionIndex)
  const update = updateState(tx, params)
  if (index >= 500n) throw new Error('selectionIndex exceeds equipment capacity')
  tx.moveCall({ target: target(params.target,'clear_selection_v8'), arguments: [
    update.guard, tx.object(params.equipmentId),
    tx.pure.u64(rev), tx.pure.u64(index),
  ] })
  update.nextRevision++
}

export function appendRemoveAnimacraftEquipmentV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & { previous: AnimacraftEquipmentV8Removal }): void {
  if (params.previous.kind === 'selection') appendClearAnimacraftSelectionV8(tx, { ...params, selectionIndex: params.previous.selectionIndex })
  else appendUnequipAnimacraftItemV8(tx, { ...params, ...params.previous })
}

export function appendSelectAnimacraftBaseStyleV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & AnimacraftEquipmentV8Placement & {
  source: AnimacraftEquipmentV8Source; selection: AnimacraftEquipmentV8BaseSelection
}): void {
  const rev = scope(params); source(params.source)
  const update = updateState(tx, params)
  const selection = params.selection
  objectId(selection.baseRegistryId, 'baseRegistryId')
  key(selection.partKey, 'partKey'); key(selection.itemKey, 'itemKey'); key(selection.styleKey, 'styleKey')
  if (selection.swatchKey !== null) key(selection.swatchKey, 'swatchKey')
  if (selection.protection) protection(selection.protection)
  assertUpdateSource(update, params.source.definitionRegistryId, selection.baseRegistryId)
  tx.moveCall({ target: target(params.target,selection.protection ? 'select_protected_base_v8' : 'select_base_v8'), typeArguments: [params.source.paymentCoinType], arguments: [
    update.guard, tx.object(params.equipmentId),
    tx.object(params.source.makerRootId), tx.object(params.source.definitionRegistryId), tx.object(params.source.packRegistryId),
    tx.object(selection.baseRegistryId), tx.object(params.source.makerAccessPassId), tx.pure.u64(rev),
    tx.pure.option('u64', targetSlot(params.targetSelectionIndex)),
    tx.pure.string(selection.partKey), tx.pure.string(selection.itemKey), tx.pure.string(selection.styleKey), tx.pure.option('string', selection.swatchKey),
    ...(selection.protection ? protectionArgs(tx,selection.protection) : []),
  ] })
  update.definitionRegistryId = params.source.definitionRegistryId; update.baseRegistryId = selection.baseRegistryId
  update.nextRevision++
}

/** Attach admitted Pack definitions without selecting a Style or acquiring access. */
export function appendAttachAnimacraftPackDefinitionsV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & {
  source: AnimacraftEquipmentV8Source; pack: Pick<AnimacraftEquipmentV8PackSelection, 'releaseId' | 'passId'>
}): void {
  const rev = scope(params); source(params.source)
  const update = updateState(tx, params)
  objectId(params.pack.releaseId, 'releaseId'); objectId(params.pack.passId, 'passId')
  assertUpdateSource(update, params.source.definitionRegistryId)
  tx.moveCall({ target: target(params.target, 'attach_pack_definitions_v8'), typeArguments: [params.source.paymentCoinType], arguments: [
    update.guard, tx.object(params.equipmentId),
    tx.object(params.source.makerRootId), tx.object(params.source.definitionRegistryId), tx.object(params.source.packRegistryId),
    tx.object(params.pack.releaseId), tx.object(params.pack.passId), tx.object(params.source.makerAccessPassId), tx.pure.u64(rev),
  ] })
  update.definitionRegistryId = params.source.definitionRegistryId
  update.nextRevision++
}

/** Existing Pack entitlement, not a new purchase or a separate component mint. */
export function appendSelectAnimacraftPackStyleV8(tx: Transaction, params: AnimacraftEquipmentV8MutationScope & AnimacraftEquipmentV8Placement & {
  source: AnimacraftEquipmentV8Source; selection: AnimacraftEquipmentV8PackSelection
}): void {
  const rev = scope(params); source(params.source)
  const update = updateState(tx, params)
  const s = params.selection
  objectId(s.baseRegistryId,'baseRegistryId'); objectId(s.releaseId,'releaseId'); objectId(s.passId,'passId')
  key(s.partKey,'partKey'); key(s.itemKey,'itemKey'); key(s.styleKey,'styleKey')
  if (s.swatchKey !== null) key(s.swatchKey,'swatchKey')
  if ([s.partKey,s.itemKey,s.styleKey,s.swatchKey].some(value => value !== null && /[\0/]/.test(value))) {
    throw new Error('Pack keys cannot contain a null byte or slash')
  }
  assertUpdateSource(update, params.source.definitionRegistryId, s.baseRegistryId)
  tx.moveCall({ target: target(params.target,'select_pack_v8'),typeArguments: [params.source.paymentCoinType],arguments: [
    update.guard,tx.object(params.equipmentId),
    tx.object(params.source.makerRootId),tx.object(params.source.definitionRegistryId),tx.object(params.source.packRegistryId),
    tx.object(s.baseRegistryId),tx.object(s.releaseId),tx.object(s.passId),tx.object(params.source.makerAccessPassId),
    tx.pure.u64(rev),tx.pure.option('u64',targetSlot(params.targetSelectionIndex)),tx.pure.string(s.partKey),tx.pure.string(s.itemKey),tx.pure.string(s.styleKey),tx.pure.option('string',s.swatchKey),
  ] })
  update.definitionRegistryId = params.source.definitionRegistryId; update.baseRegistryId = s.baseRegistryId
  update.nextRevision++
}

/** Removal/empty close deliberately require no active Maker, access pass or payment. */
export function buildCloseEmptyAnimacraftEquipmentV8Tx(params: AnimacraftEquipmentV8Scope): Transaction {
  const tx = new Transaction()
  appendCloseEmptyAnimacraftEquipmentV8(tx, params)
  return tx
}

/** Compose empty-close and listing in one PTB; never closes a nonempty binding. */
export function appendCloseEmptyAnimacraftEquipmentV8(tx: Transaction, params: AnimacraftEquipmentV8Scope): void {
  const rev = scope(params)
  const call = target(params.target, 'close_empty_equipment_v8')
  tx.moveCall({ target: call, arguments: [tx.object(params.soulStateId), tx.object(params.equipmentId),
    tx.object(params.target.protocolConfigId), tx.pure.u64(rev)] })
}

/** Replacement is atomic: failed admission rolls back removal and its instance unlock. */
export function buildReplaceAnimacraftItemV8Tx(params: AnimacraftEquipmentV8Scope & AnimacraftEquipmentV8Placement & {
  source: AnimacraftEquipmentV8Source; previous: AnimacraftEquipmentV8Removal
  next: AnimacraftEquipmentV8Item; baseRegistryId: string
}): Transaction {
  const rev = scope(params)
  if (rev > 18446744073709551613n) throw new Error('Replacement would overflow revision')
  const tx = new Transaction()
  const update = beginAnimacraftEquipmentV8Update(tx, params)
  appendRemoveAnimacraftEquipmentV8(tx, { ...params, update })
  appendEquipAnimacraftItemV8(tx, { ...params, update, expectedRevision: rev + 1n, item: params.next })
  finishAnimacraftEquipmentV8Update(tx, { ...params, update, definitionRegistryId: params.source.definitionRegistryId })
  return tx
}
