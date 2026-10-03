import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64, normalizeStructTag } from '@mysten/sui/utils'
import { buildCreateAnimacraftEquipmentV8Tx, appendEquipAnimacraftItemV8, appendUnequipAnimacraftItemV8,
  beginAnimacraftEquipmentV8Update, finishAnimacraftEquipmentV8Update, appendProveEquipmentPackDefinitionsV8, appendAttachAnimacraftPackDefinitionsV8,
  buildCloseEmptyAnimacraftEquipmentV8Tx, type AnimacraftEquipmentV8Source } from '@soulidity/sdk'
import { appendClearAnimacraftSelectionV8, appendSelectAnimacraftBaseStyleV8, appendSelectAnimacraftPackStyleV8, appendRemoveAnimacraftEquipmentV8 } from '@soulidity/sdk'
import type { readNativeEquipment } from './native-equipment'
import type { EquipmentChoice, EquipmentBaseChoice, EquipmentPackChoice } from './equipment-eligibility'
import { validateNamedLoadoutContent, type NamedLoadoutContent } from './named-loadout'
import type { NamedLoadoutPlan } from './named-loadout-plan'
import type { EquipmentUpdateSource } from './native-equipment-update-source'

export type EquipmentSnapshot = Awaited<ReturnType<typeof readNativeEquipment>>
export type EquipmentRelease = EquipmentSnapshot['release']
export type EquipmentOperation = { kind: 'unequip-base' | 'unequip-external'; itemId: string } | { kind: 'close' } | { kind: 'create' }
  | ({ kind: 'equip' } & EquipmentChoice)
  | { kind: 'clear-selection'; selectionIndex: string }
  | ({ kind: 'select-base' } & EquipmentBaseChoice)
  | ({ kind: 'select-pack' } & EquipmentPackChoice)
  | { kind: 'attach-pack'; pack: { releaseId: string; passId: string }; attachment?: { definitionCommitment: string; additionalSlots: number } }
  | { kind: 'apply-loadout'; content: NamedLoadoutContent; plan?: NamedLoadoutPlan; previousContent?: NamedLoadoutContent }
export class EquipmentNoChangeError extends Error {
  readonly code = 'NO_CHANGE'
  constructor() { super('This loadout is already equipped. No transaction is needed.'); this.name = 'EquipmentNoChangeError' }
}
export const equipmentValueKey = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key,entry[key]])) : entry)

/** Frozen references constrain the recovered template without looking up a mutable preset. */
function validateLoadoutIntent(r: Pick<EquipmentOperationRecord,'operation'|'source'|'soulId'|'stateId'|'owner'|'ownershipEpoch'|'equipmentId'|'revision'>) {
  if (r.operation.kind !== 'apply-loadout') return
  const { content,previousContent,plan } = r.operation
  validateNamedLoadoutContent(content); validateNamedLoadoutContent(previousContent)
  operationCheck(previousContent && plan && Array.isArray(plan.removals) && Array.isArray(plan.additions)
    && Array.isArray(plan.unchangedSlots), 'Invalid loadout plan')
  for (const saved of [content,previousContent]) operationCheck(saved.soulId === r.soulId && saved.stateId === r.stateId
    && saved.capturedOwner === r.owner && saved.capturedOwnershipEpoch === r.ownershipEpoch
    && saved.capturedEquipmentId === r.equipmentId && saved.rootId === r.source?.makerRootId
    && saved.definitionRegistryId === r.source?.definitionRegistryId && saved.packRegistryId === r.source?.packRegistryId
    && saved.makerAccessPassId === r.source?.makerAccessPassId, 'Loadout recovery scope mismatch')
  operationCheck(previousContent.capturedEquipmentRevision === r.revision && content.slots.length === previousContent.slots.length
    && ['rootVersion','rootContentCommitment','baseRegistryId'].every(key => content[key as keyof NamedLoadoutContent] === previousContent[key as keyof NamedLoadoutContent]), 'Loadout recovery source mismatch')
  const removals: NamedLoadoutPlan['removals'] = []; const unchanged: number[] = []; const changed: number[] = []
  previousContent.slots.forEach((old,index) => {
    if (equipmentValueKey(old) === equipmentValueKey(content.slots[index])) { unchanged.push(index); return }
    if (old) removals.push(old.kind === 'base-selection' || old.kind === 'pack-selection'
      ? { kind:'selection',selectionIndex:String(index) } : { kind:old.kind === 'base-item' ? 'base' : 'external',itemId:old.accessSubject })
    if (content.slots[index]) changed.push(index)
  })
  operationCheck(equipmentValueKey(removals) === equipmentValueKey(plan.removals)
    && equipmentValueKey(unchanged) === equipmentValueKey(plan.unchangedSlots) && changed.length === plan.additions.length
    && plan.commandCount === removals.length + changed.length && plan.commandCount > 0
    && BigInt(r.revision) + BigInt(plan.commandCount) <= 18446744073709551615n, 'Invalid loadout difference or revision overflow')
  plan.additions.forEach((placement,index) => {
    const row = content.slots[changed[index]]!
    operationCheck(placement.targetSelectionIndex === String(changed[index]) && !placement.replaces
      && Object.keys(placement).every(key => ['kind','targetSelectionIndex','item','selection'].includes(key)), 'Invalid loadout placement')
    if (row.kind === 'external-item') {
      operationCheck(placement.kind === 'equip' && equipmentValueKey(placement.item) === equipmentValueKey({kind:'external',itemId:row.accessSubject,productId:row.sourceDefinitionId}), 'Loadout external reference mismatch')
      return
    }
    const value = placement.kind === 'equip' ? placement.item : placement.selection
    operationCheck((row.kind === 'base-item' ? placement.kind === 'equip' && placement.item.kind === 'base' && placement.item.itemId === row.accessSubject
      : row.kind === 'pack-selection' ? placement.kind === 'select-pack' && placement.selection.passId === row.accessSubject && placement.selection.releaseId === row.sourceDefinitionId
      : placement.kind === 'select-base') && 'baseRegistryId' in value && value.baseRegistryId === content.baseRegistryId
      && 'styleKey' in value && value.styleKey === row.styleKey && value.swatchKey === row.swatchKey
      && (row.kind === 'base-item' || 'partKey' in value && value.partKey === row.partKey && value.itemKey === row.itemKey), 'Loadout selection reference mismatch')
    operationCheck(row.kind === 'pack-selection' || ('protection' in value && !!value.protection) === row.protected, 'Loadout protection mismatch')
  })
}
export interface EquipmentOperationRecord {
  schema: 1
  soulId: string; stateId: string; owner: string; ownershipEpoch: string
  equipmentId: string | null; revision: string; release: EquipmentRelease
  source?: AnimacraftEquipmentV8Source; provenanceBindingId?: string
  updateSource?: EquipmentUpdateSource
  operation: EquipmentOperation; bytes: string; digest: string; expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  signature: string | null
}
const canonicalId = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const u64 = (value: unknown) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18446744073709551615n
export function operationCheck(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export const equipmentReleaseKey = (r: EquipmentRelease) => JSON.stringify([r.network, r.protocolConfigId,
  r.soulidityCallablePackageId, r.soulidityCallableDigest, r.runtimeOriginalPackageId, r.runtimeCallablePackageId, r.runtimeCallableDigest])
export const equipmentOperationKey = (soulId: string, owner: string) => {
  operationCheck(canonicalId(soulId) && canonicalId(owner), 'Invalid equipment operation scope')
  return `soulidity.equipment-operation:mainnet:${soulId}:${owner}`
}
export const terminalEquipmentOperation = (r: EquipmentOperationRecord) => ['SUCCEEDED','FAILED','CANCELLED'].includes(r.phase)
function explicitWalletRejection(error: unknown) {
  // Wallet Standard errors/codes.ts: USER__REQUEST_REJECTED. No message matching
  // or generic timeout/4001 inference; unknown providers remain recoverable.
  return error instanceof Error && error.name === 'WalletStandardError'
    && (error as Error & { context?: { __code?: unknown } }).context?.__code === 4001000
}

/** Build only approved native operations, also used as the exact persisted-byte
 * command template. No arbitrary Move call or extra command is recoverable. */
export function buildEquipmentOperationTransaction(r: Pick<EquipmentOperationRecord,
  'operation'|'equipmentId'|'stateId'|'revision'|'release'|'source'|'provenanceBindingId'|'updateSource'>) {
  if (r.operation.kind === 'create') {
    operationCheck(r.source && r.provenanceBindingId, 'Equipment creation source missing')
    return buildCreateAnimacraftEquipmentV8Tx({ target: r.release, source: r.source,
      soulStateId: r.stateId, provenanceBindingId: r.provenanceBindingId })
  }
  operationCheck(r.equipmentId, 'Equipment ID missing')
  const scope = { target: r.release, soulStateId: r.stateId, equipmentId: r.equipmentId, expectedRevision: r.revision }
  if (r.operation.kind === 'close') return buildCloseEmptyAnimacraftEquipmentV8Tx(scope)
  operationCheck(r.updateSource, 'Equipment final validation source missing')
  const tx = new Transaction()
  const update = beginAnimacraftEquipmentV8Update(tx, scope)
  const mutationScope = { ...scope, update }
  const finish = () => {
    const finalPacks = [...(r.updateSource!.packDefinitions ?? [])]
    if (r.operation.kind === 'attach-pack') {
      operationCheck(r.source && r.operation.attachment, 'Pack attachment plan missing')
      const releaseId = r.operation.pack.releaseId
      operationCheck(!finalPacks.some(row => row.releaseId === releaseId), 'Pack is already attached')
      finalPacks.push({ releaseId: r.operation.pack.releaseId, paymentCoinType: r.source.paymentCoinType,
        definitionCommitment: r.operation.attachment.definitionCommitment })
    }
    const packDefinitionProofs = finalPacks.map((pack, index) =>
      appendProveEquipmentPackDefinitionsV8(tx, { runtimeCallablePackageId: r.release.runtimeCallablePackageId,
        paymentCoinType: pack.paymentCoinType, equipmentId: r.equipmentId!, definitionRegistryId: r.updateSource!.definitionRegistryId,
        baseRegistryId: r.updateSource!.baseRegistryId, releaseId: pack.releaseId, bindingIndex: String(index) }))
    finishAnimacraftEquipmentV8Update(tx, { ...mutationScope, ...r.updateSource!, packDefinitionProofs }); return tx
  }
  if (r.operation.kind === 'attach-pack') {
    operationCheck(r.source && r.operation.attachment, 'Pack attachment source missing')
    appendAttachAnimacraftPackDefinitionsV8(tx, { ...mutationScope, source: r.source, pack: r.operation.pack })
    return finish()
  }
  if (r.operation.kind === 'apply-loadout') {
    operationCheck(r.source && r.operation.plan, 'Resolved loadout plan missing')
    let revision = BigInt(r.revision)
    for (const previous of r.operation.plan.removals) appendRemoveAnimacraftEquipmentV8(tx,{ ...mutationScope,expectedRevision:String(revision++),previous })
    for (const placement of r.operation.plan.additions) {
      const next = { ...mutationScope,source:r.source,expectedRevision:String(revision++),targetSelectionIndex:placement.targetSelectionIndex }
      if (placement.kind === 'equip') appendEquipAnimacraftItemV8(tx,{ ...next,item:placement.item })
      else if (placement.kind === 'select-base') appendSelectAnimacraftBaseStyleV8(tx,{ ...next,selection:placement.selection })
      else appendSelectAnimacraftPackStyleV8(tx,{ ...next,selection:placement.selection })
    }
    return finish()
  }
  if (r.operation.kind === 'clear-selection') {
    appendClearAnimacraftSelectionV8(tx, { ...mutationScope, selectionIndex: r.operation.selectionIndex }); return finish()
  }
  if (r.operation.kind === 'select-base' || r.operation.kind === 'select-pack') {
    operationCheck(r.source, 'Equipment source missing')
    if (r.operation.replaces) appendRemoveAnimacraftEquipmentV8(tx, { ...mutationScope, previous: r.operation.replaces })
    const nextScope = { ...mutationScope,source: r.source,targetSelectionIndex: r.operation.targetSelectionIndex,
      expectedRevision: String(BigInt(r.revision) + (r.operation.replaces ? 1n : 0n)) }
    if (r.operation.kind === 'select-pack') appendSelectAnimacraftPackStyleV8(tx,{ ...nextScope,selection: r.operation.selection })
    else appendSelectAnimacraftBaseStyleV8(tx,{ ...nextScope,selection: r.operation.selection })
    return finish()
  }
  if (r.operation.kind === 'equip') {
    operationCheck(r.source, 'Equipment source missing')
    if (r.operation.replaces) appendRemoveAnimacraftEquipmentV8(tx, { ...mutationScope, previous: r.operation.replaces })
    appendEquipAnimacraftItemV8(tx, { ...mutationScope, source: r.source, item: r.operation.item,
      expectedRevision: String(BigInt(r.revision) + (r.operation.replaces ? 1n : 0n)),
      targetSelectionIndex: r.operation.targetSelectionIndex }); return finish()
  }
  appendUnequipAnimacraftItemV8(tx, { ...mutationScope,
    kind: r.operation.kind === 'unequip-base' ? 'base' : 'external', itemId: r.operation.itemId }); return finish()
}

/** Treat persisted/browser data as untrusted, including its declared operation. */
export function validateEquipmentOperationRecord(value: unknown): EquipmentOperationRecord {
  const r = value as EquipmentOperationRecord
  operationCheck(r && r.schema === 1 && [r.soulId,r.stateId,r.owner].every(canonicalId)
    && (r.operation?.kind === 'create' ? r.equipmentId === null && r.revision === '0' : canonicalId(r.equipmentId))
    && u64(r.revision) && u64(r.ownershipEpoch) && u64(r.expirationEpoch)
    && r.release?.network === 'mainnet' && typeof r.release.writesEnabled === 'boolean'
    && [r.release.protocolConfigId,r.release.soulidityCallablePackageId,r.release.runtimeOriginalPackageId,r.release.runtimeCallablePackageId].every(canonicalId)
    && typeof r.release.soulidityCallableDigest === 'string' && typeof r.release.runtimeCallableDigest === 'string'
    && ['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED'].includes(r.phase)
    && (r.signature === null || typeof r.signature === 'string' && r.signature.length > 0 && r.signature.length < 32768)
    && (r.phase !== 'SIGNED' || r.signature !== null)
    && (!['PREPARED','SIGNING','CANCELLED'].includes(r.phase) || r.signature === null), 'Invalid equipment recovery record')
  operationCheck(r.operation && ['unequip-base','unequip-external','close','create','equip','clear-selection','select-base','select-pack','attach-pack','apply-loadout'].includes(r.operation.kind), 'Invalid equipment operation')
  if (!['create', 'close'].includes(r.operation.kind)) {
    operationCheck(r.updateSource && Object.keys(r.updateSource).sort().join(',') === (r.updateSource.packDefinitions === undefined
      ? 'baseRegistryId,definitionRegistryId' : 'baseRegistryId,definitionRegistryId,packDefinitions')
      && [r.updateSource.definitionRegistryId, r.updateSource.baseRegistryId].every(canonicalId)
      && (!r.source || r.source.definitionRegistryId === r.updateSource.definitionRegistryId), 'Invalid equipment final validation source')
    if (r.updateSource.packDefinitions !== undefined) {
      const packs = r.updateSource.packDefinitions
      operationCheck(Array.isArray(packs) && packs.length > 0 && packs.length <= 500
        && new Set(packs.map(row => row.releaseId)).size === packs.length && packs.every(row =>
          Object.keys(row).sort().join(',') === 'definitionCommitment,paymentCoinType,releaseId'
          && canonicalId(row.releaseId) && /^[0-9a-f]{64}$/.test(row.definitionCommitment)
          && typeof row.paymentCoinType === 'string' && row.paymentCoinType.includes('::')
          && normalizeStructTag(row.paymentCoinType) === row.paymentCoinType), 'Invalid equipment Pack validation sources')
    }
    if (r.operation.kind === 'apply-loadout') operationCheck(r.operation.content.baseRegistryId === r.updateSource.baseRegistryId,
      'Loadout final validation source mismatch')
  } else operationCheck(r.updateSource === undefined, 'Unexpected equipment final validation source')
  validateLoadoutIntent(r)
  operationCheck(!('targetSelectionIndex' in r.operation) || ['equip','select-base','select-pack'].includes(r.operation.kind),
    'Target equipment slot is only valid for placement')
  if (r.operation.kind === 'create' || r.operation.kind === 'equip' || r.operation.kind === 'select-base' || r.operation.kind === 'select-pack' || r.operation.kind === 'attach-pack' || r.operation.kind === 'apply-loadout') {
    operationCheck(r.source && [r.source.makerRootId,r.source.definitionRegistryId,r.source.packRegistryId,r.source.makerAccessPassId].every(canonicalId)
      && typeof r.source.paymentCoinType === 'string' && r.source.paymentCoinType.includes('::')
      && normalizeStructTag(r.source.paymentCoinType) === r.source.paymentCoinType, 'Invalid equipment source')
    if (r.operation.kind === 'attach-pack') operationCheck(r.operation.pack && canonicalId(r.operation.pack.releaseId)
      && canonicalId(r.operation.pack.passId) && r.operation.attachment
      && /^[0-9a-f]{64}$/.test(r.operation.attachment.definitionCommitment)
      && Number.isSafeInteger(r.operation.attachment.additionalSlots) && r.operation.attachment.additionalSlots >= 0
      && r.operation.attachment.additionalSlots <= 500, 'Invalid Pack attachment plan')
    else if (r.operation.kind === 'create') operationCheck(canonicalId(r.provenanceBindingId), 'Invalid equipment provenance')
    else if (r.operation.kind !== 'apply-loadout') {
      operationCheck(r.operation.targetSelectionIndex === undefined || u64(r.operation.targetSelectionIndex)
        && BigInt(r.operation.targetSelectionIndex) < 500n, 'Invalid target equipment slot')
      if (r.operation.kind === 'equip') operationCheck(r.operation.item && ['base','external'].includes(r.operation.item.kind)
        && canonicalId(r.operation.item.itemId), 'Invalid equipment choice')
      operationCheck(r.operation.kind === 'select-pack' || (r.operation.styleStart === undefined
          || Number.isInteger(r.operation.styleStart) && r.operation.styleStart >= 0 && r.operation.styleStart <= 500), 'Invalid equipment choice')
      if (r.operation.replaces) operationCheck(r.operation.replaces.kind === 'selection'
        ? u64(r.operation.replaces.selectionIndex) && BigInt(r.operation.replaces.selectionIndex) < 500n
        : ['base','external'].includes(r.operation.replaces.kind) && canonicalId(r.operation.replaces.itemId), 'Invalid replacement component')
      operationCheck(BigInt(r.revision) <= 18446744073709551615n - (r.operation.replaces ? 2n : 1n), 'Equipment revision overflow')
    }
  } else if (r.operation.kind === 'clear-selection') operationCheck(u64(r.operation.selectionIndex)
    && BigInt(r.operation.selectionIndex) < 500n && BigInt(r.revision) < 18446744073709551615n, 'Invalid selection removal')
  else if (r.operation.kind !== 'close') operationCheck(canonicalId(r.operation.itemId), 'Invalid equipment operation')
  operationCheck(typeof r.bytes === 'string' && r.bytes.length > 0 && r.bytes.length <= 180000, 'Invalid transaction bytes')
  const bytes = fromBase64(r.bytes)
  const transactionData = bcs.TransactionData.parse(bytes)
  operationCheck(toBase64(bytes) === r.bytes
    && toBase64(bcs.TransactionData.serialize(transactionData).toBytes()) === r.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === r.digest, 'Recovery transaction bytes/digest mismatch')
  const tx = Transaction.from(bytes).getData()
  operationCheck(tx.sender === r.owner && tx.gasData.owner === r.owner && u64(tx.gasData.budget)
    && BigInt(tx.gasData.budget!) > 0n && u64(tx.gasData.price) && BigInt(tx.gasData.price!) > 0n
    && tx.gasData.payment && tx.gasData.payment.length > 0
    && String(transactionData.V1?.expiration.Epoch) === r.expirationEpoch, 'Recovery sender/gas/expiration mismatch')
  const expected = buildEquipmentOperationTransaction(r).getData()
  const owned = new Set<string>()
  if (r.operation.kind === 'apply-loadout') {
    owned.add(r.source!.makerAccessPassId)
    for (const removal of r.operation.plan!.removals) if (removal.kind !== 'selection') owned.add(removal.itemId)
    for (const addition of r.operation.plan!.additions) {
      if (addition.kind === 'equip') owned.add(addition.item.itemId)
      if (addition.kind === 'select-pack') owned.add(addition.selection.passId)
    }
  } else if (r.operation.kind === 'create') { owned.add(r.provenanceBindingId!); owned.add(r.source!.makerAccessPassId) }
  else if (r.operation.kind === 'attach-pack') { owned.add(r.source!.makerAccessPassId); owned.add(r.operation.pack.passId) }
  else if (r.operation.kind === 'equip' || r.operation.kind === 'select-base' || r.operation.kind === 'select-pack') {
    if (r.operation.kind === 'equip') owned.add(r.operation.item.itemId)
    if (r.operation.kind === 'select-pack') owned.add(r.operation.selection.passId)
    owned.add(r.source!.makerAccessPassId)
    if (r.operation.replaces && r.operation.replaces.kind !== 'selection') owned.add(r.operation.replaces.itemId)
  } else if (r.operation.kind !== 'close' && r.operation.kind !== 'clear-selection') owned.add(r.operation.itemId)
  const ids = expected.inputs.flatMap(input => input.UnresolvedObject ? [input.UnresolvedObject.objectId] : [])
  operationCheck(tx.commands.length === expected.commands.length && tx.inputs.length === expected.inputs.length,
    'Unexpected recovery transaction commands')
  const mapping = new Map<number,number>(); const used = new Set<number>()
  expected.commands.forEach((command, commandIndex) => {
    if (command.MakeMoveVec) {
      operationCheck(equipmentValueKey(tx.commands[commandIndex]) === equipmentValueKey(command),
        'Unexpected equipment Pack proof vector')
      return
    }
    const wanted = command.MoveCall!; const call = tx.commands[commandIndex]?.MoveCall
    operationCheck(call && call.package === wanted.package && call.module === wanted.module && call.function === wanted.function
      && JSON.stringify(call.typeArguments) === JSON.stringify(wanted.typeArguments)
      && call.arguments.length === wanted.arguments.length, 'Unexpected recovery transaction commands')
    wanted.arguments.forEach((wantedArg,index) => {
      const arg = call.arguments[index]
      if (wantedArg.$kind === 'Result' || wantedArg.$kind === 'NestedResult') {
        operationCheck(equipmentValueKey(arg) === equipmentValueKey(wantedArg), 'Unexpected equipment update guard result')
        return
      }
      operationCheck(wantedArg.$kind === 'Input' && arg.$kind === 'Input', 'Unexpected recovery argument')
      const previous = mapping.get(wantedArg.Input)
      operationCheck(previous === undefined ? !used.has(arg.Input) : previous === arg.Input, 'Unexpected recovery argument')
      mapping.set(wantedArg.Input,arg.Input); used.add(arg.Input)
      const input = tx.inputs[arg.Input]; const template = expected.inputs[wantedArg.Input]
      if (template.Pure) operationCheck(input?.Pure?.bytes === template.Pure.bytes, 'Recovery revision or choice mismatch')
      else {
        const id = template.UnresolvedObject!.objectId; const obj = input?.Object
        if (owned.has(id)) operationCheck(obj?.ImmOrOwnedObject?.objectId === id && u64(obj.ImmOrOwnedObject.version), 'Recovery owned component input mismatch')
        else operationCheck(obj?.SharedObject?.objectId === id && u64(obj.SharedObject.initialSharedVersion)
          && obj.SharedObject.mutable === (id === r.equipmentId || id === r.stateId && ['close','create'].includes(r.operation.kind)), 'Recovery shared object input mismatch')
      }
    })
  })
  operationCheck(used.size === tx.inputs.length, 'Unexpected unused recovery input')
  operationCheck(new Set(tx.gasData.payment.map(ref => ref.objectId)).size === tx.gasData.payment.length
    && tx.gasData.payment.every(ref => canonicalId(ref.objectId) && !ids.includes(ref.objectId)), 'Recovery gas overlaps operation inputs')
  return r
}

export interface EquipmentOperationStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): EquipmentOperationRecord | null
  write(key: string, record: EquipmentOperationRecord): void
}
/** Synchronous committed storage, guarded across tabs. No TTL, swallowed quota
 * errors, memory fallback or clearing unknown transactions. No private keys. */
export function browserEquipmentOperationStore(): EquipmentOperationStore {
  operationCheck(typeof window !== 'undefined' && navigator.locks?.request, 'Persistent equipment recovery requires browser storage and Web Locks')
  const storage = window.localStorage
  return {
    exclusive: (key, work) => navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      operationCheck(lock, 'This Soul has an operation open in another tab'); return work()
    }),
    read: key => {
      const raw = storage.getItem(key)
      return raw === null ? null : validateEquipmentOperationRecord(JSON.parse(raw))
    },
    write: (key, record) => {
      validateEquipmentOperationRecord(record)
      const encoded = JSON.stringify(record)
      storage.setItem(key, encoded)
      operationCheck(storage.getItem(key) === encoded, 'Equipment recovery could not be persisted')
    },
  }
}
export type EquipmentQueryResult = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
export interface EquipmentOperationAdapter {
  prepare(operation: EquipmentOperation): Promise<EquipmentOperationRecord>
  query(record: EquipmentOperationRecord): Promise<EquipmentQueryResult>
  /** Fresh owner/revision/release checks before signing; same release/write gate
   * before rebroadcast. Query recovery itself needs neither ownership nor gate. */
  preflight(record: EquipmentOperationRecord, signing: boolean): Promise<void>
  sign(record: EquipmentOperationRecord): Promise<{ bytes: string; signature: string }>
  verifySignature(record: EquipmentOperationRecord): Promise<void>
  broadcast(record: EquipmentOperationRecord): Promise<void>
  readback(record: EquipmentOperationRecord): Promise<void>
}
/** One durable intent per wallet/Soul. A timeout is never failed; only a verified
 * finalized ledger result advances to terminal. Resume never calls prepare. */
export async function runEquipmentOperation(params: {
  soulId: string; owner: string; operation?: EquipmentOperation
  store: EquipmentOperationStore; adapter: EquipmentOperationAdapter
  queryOnly?: boolean; cancelUnsigned?: boolean; onRecord?: (record: EquipmentOperationRecord) => void
}) {
  const { store, adapter } = params
  const key = equipmentOperationKey(params.soulId, params.owner)
  return store.exclusive(key, async () => {
    let record = store.read(key)
    const save = (r: EquipmentOperationRecord) => { store.write(key, r); record = r; params.onRecord?.(r) }
    if (params.operation) {
      operationCheck(!record || terminalEquipmentOperation(record), 'Recover the pending equipment operation first')
      if (record && record.phase !== 'CANCELLED') {
        const status = await adapter.query(record)
        operationCheck(status === record.phase, 'Previous equipment result must be confirmed before a new operation')
      }
      record = await adapter.prepare(params.operation)
      operationCheck(record.soulId === params.soulId && record.owner === params.owner && record.phase === 'PREPARED', 'Prepared operation scope mismatch')
      save(validateEquipmentOperationRecord(record))
    }
    operationCheck(record && record.soulId === params.soulId && record.owner === params.owner, 'No matching equipment operation to recover')
    validateEquipmentOperationRecord(record)
    if (record.phase === 'CANCELLED') return record
    // Even persisted terminal claims are re-queried; browser storage is not proof.
    const reconcile = async () => {
      const result = await adapter.query(record!)
      if (result === 'SUCCEEDED' || result === 'FAILED') {
        if (result === 'SUCCEEDED') await adapter.readback(record!)
        save({ ...record!, phase: result }); return true
      }
      operationCheck(!terminalEquipmentOperation(record!), 'Recorded result cannot be confirmed; do not start another operation')
      return result === 'PENDING'
    }
    if (await reconcile() || params.queryOnly) return record!
    if (params.cancelUnsigned) {
      operationCheck(record.phase === 'PREPARED' && record.signature === null, 'A signed transaction cannot be discarded')
      save({ ...record, phase: 'CANCELLED' }); return record!
    }
    await adapter.preflight(record, record.phase !== 'SIGNED')
    if (record.phase === 'PREPARED' || record.phase === 'SIGNING') {
      const wasUnsigned = record.phase === 'PREPARED'
      save({ ...record, phase: 'SIGNING' })
      let signed
      try { signed = await adapter.sign(record!) }
      catch (error) {
        // A rejection now cannot erase an EARLIER unknown signing attempt.
        if (wasUnsigned && explicitWalletRejection(error)) save({ ...record!, phase: 'PREPARED' })
        throw error
      }
      operationCheck(signed.bytes === record.bytes, 'Wallet changed the prepared transaction; nothing was broadcast')
      const next = { ...record, phase: 'SIGNED' as const, signature: signed.signature }
      await adapter.verifySignature(next)
      save(next) // Must succeed before ANY broadcast.
    }
    await adapter.preflight(record!, false)
    await adapter.verifySignature(record!)
    // Persisted signed bytes survive any crash/rejection here. Never turn a
    // transport error into a failed transaction or generate replacement bytes.
    await adapter.broadcast(record!)
    await reconcile()
    return record!
  })
}
