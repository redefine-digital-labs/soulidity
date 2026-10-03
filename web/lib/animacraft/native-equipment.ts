import { sha256 } from '@noble/hashes/sha2.js'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { equipmentUtf8, validEquipmentCursor } from './native-equipment-bytes'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeSoulBcs, NativeSoulStateBcs, NativeSoulBindingBcs, type NativeReceiveTarget } from './native-receive'
import { readNativeEquipmentSource } from './native-equipment-source'
import { readEquipmentUpdateSource } from './native-equipment-update-source'
import type { EquipmentPackQuery } from './native-equipment-pack'
import { validateNamedLoadoutContent, type NamedLoadoutContent } from './named-loadout'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'

const A = bcs.Address; const U = bcs.u64(); const V = bcs.vector(bcs.u8()); const S = bcs.string()
export const EquipmentLockBcs = bcs.struct('EquipLockV8', { loadout_id: A, equip_revision: U, selection_index: U })
export const EquipmentSelectionBcs = bcs.struct('LoadoutSelectionV8', {
  selection_index: U, part_key: S, item_key: S, style_key: S, color_channel_key: bcs.option(S),
  swatch_key: bcs.option(S), layer_track_key: S, asset_blob_id: S, asset_sha256: V,
  asset_content_commitment: V, source_class: bcs.u8(), source_definition_id: A,
  source_semantic_id: S, access_subject: A, source_epoch: U, pricing_commitment: V,
  protected: bcs.bool(), seal_binding_commitment: V,
})
const Selections = bcs.vector(bcs.option(EquipmentSelectionBcs))
export const EquipmentDefinitionSlotBcs = bcs.struct('DefinitionSlotV8', {
  source_definition_id: A, part_key: S, profile_commitment: V, start: U, capacity: U,
})
const DefinitionSlots = bcs.vector(EquipmentDefinitionSlotBcs)
export const EquipmentAttachedPackDefinitionBcs = bcs.struct('AttachedPackDefinitionV8', {
  release_id: A, definition_commitment: V,
})
const AttachedPackDefinitions = bcs.vector(EquipmentAttachedPackDefinitionBcs)
export const EquipmentLoadoutBcs = bcs.struct('MakerLoadoutV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V,
  definition_registry_id: A, pack_registry_id: A, maker_access_pass_id: A,
  maker_access_commitment: V, holder: A, revision: U,
  attached_pack_definitions: AttachedPackDefinitions, definition_slots: DefinitionSlots, selections: Selections,
  selection_count: U, commitment: V,
})
export const EquipmentBindingBcs = bcs.struct('SoulEquipmentBindingV8', {
  soul_id: A, soul_state_id: A, holder: A, ownership_epoch: U, protocol_config_id: A,
})
export const EquipmentBaseItemBcs = bcs.struct('OwnedBaseItemV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V,
  definition_registry_id: A, pack_registry_id: A, base_registry_id: A, part_key: S,
  item_key: S, item_payload_commitment: V, holder: A, ownership_epoch: U,
  transferable: bcs.bool(), equip_lock: bcs.option(EquipmentLockBcs),
})
export const EquipmentExternalItemBcs = bcs.struct('OwnedExternalItemV8', {
  id: A, version: U, product_id: A, product_content_commitment: V,
  asset_content_commitment: V, holder: A, ownership_epoch: U,
  transferable: bcs.bool(), equip_lock: bcs.option(EquipmentLockBcs),
})
export const EquipmentPointerBcs = bcs.struct('Field', { id: A, name: bcs.u8(), value: A })
// Move's empty structs compile to one false dummy_field, not zero bytes.
export const EquipmentKeyBcs = bcs.struct('SoulEquipmentKeyV8', { dummy_field: bcs.bool() })
export const EquipmentBindingFieldBcs = bcs.struct('Field', {
  id: A, name: EquipmentKeyBcs, value: EquipmentBindingBcs,
})
const CommitmentBcs = bcs.struct('LoadoutCommitmentInputV8', {
  domain: V, version: U, root_id: A, root_version: U, root_content_commitment: V,
  attached_pack_definitions: AttachedPackDefinitions, definition_slots: DefinitionSlots, selections: Selections,
})
export function equipmentCommitment(loadout: Pick<ReturnType<typeof EquipmentLoadoutBcs.parse>,
  'version' | 'root_id' | 'root_version' | 'root_content_commitment' | 'attached_pack_definitions' | 'definition_slots' | 'selections'>) {
  return toHex(sha256(CommitmentBcs.serialize({ ...loadout,
    domain: [...equipmentUtf8('animacraft-v8/runtime/current-loadout')],
  }).toBytes()))
}
function check(value: unknown, label: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_INVALID', label)
}
const hashEqual = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
type LedgerObject = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>

/** Optimistic read set: every mutable object must still have the exact version
 * and digest after all dependent reads, otherwise no successful snapshot. */
export class EquipmentReadSet {
  private seen = new Map<string, Pick<LedgerObject, 'version' | 'digest'>>()
  private absent = new Set<string>()
  private cached = new Map<string, Promise<LedgerObject | undefined>>()
  private active = 0
  private waiting: Array<() => void> = []
  constructor(private client: SuiGrpcClient, private cacheReads = false) {}
  async kioskItem(objectId: string, type: string, kioskId: string) {
    const fieldId = deriveKioskItemFieldId(kioskId, objectId)
    const bytes = await this.read(fieldId, KIOSK_ITEM_FIELD_TYPE, 2, kioskId)
    check(bytes instanceof Uint8Array, 'Kiosk Item field BCS missing')
    assertKioskItemField(bytes, kioskId, objectId)
    return this.read(objectId, type, 2, fieldId)
  }
  async read(objectId: string, type: string, ownerKind: number, ownerAddress?: string) {
    receiveId(objectId)
    if (this.cacheReads) {
      const object = await this.exactObject(objectId)
      return this.accept(object, objectId, type, ownerKind, ownerAddress)
    }
    const { response } = await this.client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
    return this.accept(response.object, objectId, type, ownerKind, ownerAddress)
  }
  accept(object: LedgerObject | undefined, id: string, type: string, kind: number, address?: string) {
    if (this.absent.has(id)) throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Previously absent object changed during read', 409)
    check(object?.objectId === id && object.version !== undefined && object.version > 0n
      && typeof object.digest === 'string' && object.digest.length > 0
      && object.objectType && normalizeStructTag(object.objectType) === normalizeStructTag(type)
      && object.owner?.kind === kind && (!address || object.owner.address === address), 'Object identity/type/custody mismatch')
    if (kind !== 4) {
      const prior = this.seen.get(id)
      if (prior && (prior.version !== object.version || prior.digest !== object.digest)) {
        throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Object changed during read; refresh before acting', 409)
      }
      this.seen.set(id, { version: object.version, digest: object.digest })
    }
    return object.contents?.value
  }
  async pointer(stateId: string) {
    const id = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([10]))
    const bytes = await this.optional(id, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId)
    if (bytes === null) return null
    const pointer = decodeNativeBcs(EquipmentPointerBcs, bytes)
    check(pointer.id === id && pointer.name === 10, 'Equipment pointer key mismatch')
    return receiveId(pointer.value)
  }
  async optional(id: string, type: string, kind: number, parent?: string) {
    receiveId(id)
    const missing = () => {
      if (this.seen.has(id)) throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Object changed to absent during read', 409)
      this.absent.add(id)
      return null
    }
    if (this.cacheReads) {
      const object = await this.exactObject(id)
      return object === undefined ? missing() : this.accept(object, id, type, kind, parent)
    }
    // Raw batch status preserves NOT_FOUND; this installed core adapter turns
    // per-object errors into generic Error strings and cannot prove absence.
    const { response } = await this.client.ledgerService.batchGetObjects({ requests: [{ objectId: id }],
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
    check(response.objects.length === 1, 'Missing equipment pointer response')
    const result = response.objects[0].result
    if (result.oneofKind === 'error' && result.error.code === 5) return missing()
    if (result.oneofKind === 'error') throw new NativeReceiveError('NATIVE_EQUIPMENT_UNAVAILABLE', 'Equipment pointer lookup failed', 503)
    check(result.oneofKind === 'object', 'Malformed equipment pointer response')
    return this.accept(result.object, id, type, kind, parent)
  }
  private exactObject(id: string) {
    let pending = this.cached.get(id)
    if (!pending) {
      pending = (async () => {
        if (this.active >= 16) await new Promise<void>(resolve => this.waiting.push(resolve))
        else this.active++
        try {
        const { response } = await this.client.ledgerService.batchGetObjects({ requests: [{ objectId: id }],
          readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
        check(response.objects.length === 1, 'Missing exact object response')
        const result = response.objects[0].result
        if (result.oneofKind === 'error' && result.error.code === 5) return undefined
        check(result.oneofKind === 'object', 'Exact object lookup failed')
        return result.object
        } finally {
          const next = this.waiting.shift()
          if (next) next()
          else this.active--
        }
      })()
      this.cached.set(id, pending)
    }
    return pending
  }
  async readMany(requests: Array<{ id: string; type: string; kind: number; parent?: string }>) {
    if (this.cacheReads) {
      const values: Array<Uint8Array | undefined> = []
      for (let start = 0; start < requests.length; start += 16) values.push(...await Promise.all(requests.slice(start,start + 16)
        .map(row => this.read(row.id,row.type,row.kind,row.parent))))
      return values
    }
    const values: Array<Uint8Array | undefined> = []
    for (let i = 0; i < requests.length; i += 50) {
      const batch = requests.slice(i, i + 50)
      const { response } = await this.client.ledgerService.batchGetObjects({ requests: batch.map(r => ({ objectId: r.id })),
        readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
      check(response.objects.length === batch.length, 'Missing object batch response')
      response.objects.forEach((row, j) => {
        check(row.result.oneofKind === 'object', 'Object batch lookup failed')
        const r = batch[j]; values.push(this.accept(row.result.object, r.id, r.type, r.kind, r.parent))
      })
    }
    return values
  }
  async verify() {
    // Bounded concurrency, including up to 500 equipped selections.
    const entries = [...this.seen]
    for (let i = 0; i < entries.length; i += 16) {
      await Promise.all(entries.slice(i, i + 16).map(async ([id, previous]) => {
        const { response } = await this.client.ledgerService.getObject({ objectId: id,
          readMask: { paths: ['object_id', 'version', 'digest'] } })
        if (response.object?.objectId !== id || response.object.version !== previous.version
          || response.object.digest !== previous.digest) {
          throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Equipment changed; refresh before acting', 409)
        }
      }))
    }
    // Missing dynamic fields have no digest. They still belong to the readset:
    // a newly claimed protocol catalog or buyer entitlement changes eligibility.
    const absent = [...this.absent]
    for (let i = 0; i < absent.length; i += 50) {
      const ids = absent.slice(i, i + 50)
      const { response } = await this.client.ledgerService.batchGetObjects({ requests: ids.map(objectId => ({ objectId })),
        readMask: { paths: ['object_id', 'version', 'digest'] } })
      check(response.objects.length === ids.length, 'Missing absence verification response')
      for (const row of response.objects) {
        if (row.result.oneofKind === 'object') throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Previously absent object changed during read', 409)
        check(row.result.oneofKind === 'error' && row.result.error.code === 5, 'Absence verification unavailable')
      }
    }
  }
}

async function attestEquipment(client: SuiGrpcClient, target: NativeReceiveTarget) {
  if (!target.runtime) throw new NativeReceiveError('NATIVE_EQUIPMENT_TARGET_UNAVAILABLE', 'Exact Runtime release is required', 503)
  const types = await attestNativeReceiveTarget(client, target)
  const pin = target.runtime
  const read = async (objectId: string) => (await client.ledgerService.getObject({ objectId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'package'] } })).response.object
  const [runtime, native, output] = await Promise.all([
    read(receiveId(pin.callablePackageId)), read(target.soulidityCallablePackageId), read(target.outputCallablePackageId),
  ])
  const pkg = runtime?.package
  check(runtime?.objectId === pin.callablePackageId && runtime.digest === pin.callableDigest
    && runtime.owner?.kind === 4 && pkg?.originalId === pin.originalPackageId
    && pkg.storageId === pin.callablePackageId && pkg.version === runtime.version, 'Runtime release mismatch')
  for (const [parent, id, digest] of [[native, target.soulidityCallablePackageId, target.soulidityCallableDigest],
    [output, target.outputCallablePackageId, target.outputCallableDigest]] as const) {
    check(parent?.objectId === id && parent.digest === digest && parent.owner?.kind === 4
      && parent.package?.storageId === id && parent.package.version === parent.version
      && parent.package.linkage.filter(row => row.originalId === pin.originalPackageId).length === 1
      && parent.package.linkage.some(row => row.originalId === pin.originalPackageId
        && row.upgradedId === pin.callablePackageId && row.upgradedVersion === pkg.version), 'Runtime linkage mismatch')
  }
  const origin = (name: string) => {
    const rows = pkg.typeOrigins.filter(row => row.moduleName === 'runtime_v8' && row.datatypeName === name)
    check(rows.length === 1 && pkg.modules.some(m => m.name === 'runtime_v8' && m.contents && m.contents.length > 4), 'Missing Runtime type origin')
    return `${receiveId(rows[0].packageId)}::runtime_v8::${name}`
  }
  return { ...types, loadout: origin('MakerLoadoutV8'), key: origin('SoulEquipmentKeyV8'),
    binding: origin('SoulEquipmentBindingV8'), base: origin('OwnedBaseItemV8'), external: origin('OwnedExternalItemV8') }
}

export async function readNativeEquipment(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string; inventory?: { kind: 'base' | 'external'; cursor?: string; itemId?: string };
    source?: { styleStart?: number; pack?: EquipmentPackQuery }; update?: true; loadoutContent?: NamedLoadoutContent }, readSet?: EquipmentReadSet) {
  const exact = input.loadoutContent === undefined ? undefined : validateNamedLoadoutContent(structuredClone(input.loadoutContent))
  check(!exact || (!input.inventory && !input.source && exact.soulId === input.soulId && exact.stateId === input.stateId), 'Invalid exact loadout scope/query')
  const soulId = receiveId(input.soulId); const stateId = receiveId(input.stateId)
  const types = await attestEquipment(client, target)
  const reads = readSet ?? new EquipmentReadSet(client, Boolean(exact))
  const state = decodeNativeBcs(NativeSoulStateBcs, await reads.read(stateId, types.stateType, 3))
  check(state.id === stateId && state.soul_id === soulId, 'SoulState mismatch')
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(soulId, types.soulType, state.current_kiosk_id))
  check(soul.id === soulId && soul.provenance_kind === 3, 'Native Animacraft Soul required')
  const provenanceFieldId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const pointer = decodeNativeBcs(EquipmentPointerBcs, await reads.read(provenanceFieldId,
    '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  check(pointer.id === provenanceFieldId && pointer.name === 9, 'Native provenance slot mismatch')
  const provenance = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(pointer.value, types.bindingType, 4))
  check(provenance.id === pointer.value && provenance.version === '8' && provenance.soul_id === soulId
    && provenance.soul_state_id === stateId && provenance.protocol_config_id === target.protocolConfigId,
  'Native provenance mismatch')
  const equipmentId = await reads.pointer(stateId)
  const identity = { soulId, stateId, owner: state.current_owner, ownershipEpoch: state.ownership_epoch,
    listed: state.is_listed, rootId: provenance.root_id, provenanceBindingId: provenance.id,
    release: { network: 'mainnet' as const, protocolConfigId: target.protocolConfigId,
      soulidityCallablePackageId: target.soulidityCallablePackageId, soulidityCallableDigest: target.soulidityCallableDigest,
      runtimeOriginalPackageId: target.runtime!.originalPackageId,
      runtimeCallablePackageId: target.runtime!.callablePackageId, runtimeCallableDigest: target.runtime!.callableDigest,
      writesEnabled: target.equipmentWritesEnabled === true } }
  const inventory = exact ? await readExactInventory(exact) : input.inventory ? await readInventory(input.inventory) : null
  if (!equipmentId) {
    const source = input.source || exact ? await readSource(null) : null
    await reads.verify(); return { ...identity, status: 'NOT_CREATED' as const, equipment: null, inventory, source, updateSource: null }
  }
  const loadout = decodeNativeBcs(EquipmentLoadoutBcs, await reads.read(equipmentId, types.loadout, 3))
  const attachedIds = new Set<string>()
  check(loadout.attached_pack_definitions.length <= 500, 'Attached Pack definition count invalid')
  for (const entry of loadout.attached_pack_definitions) {
    check(entry.release_id !== loadout.root_id && !attachedIds.has(entry.release_id)
      && entry.definition_commitment.length === 32, 'Attached Pack definition identity invalid')
    attachedIds.add(entry.release_id)
  }
  const fieldId = deriveDynamicFieldID(equipmentId, types.key, EquipmentKeyBcs.serialize({ dummy_field: false }).toBytes())
  const field = decodeNativeBcs(EquipmentBindingFieldBcs, await reads.read(fieldId,
    `0x2::dynamic_field::Field<${types.key},${types.binding}>`, 2, equipmentId))
  const binding = field.value
  check(field.id === fieldId && field.name.dummy_field === false && binding.soul_id === soulId && binding.soul_state_id === stateId
    && binding.protocol_config_id === target.protocolConfigId && binding.holder === state.current_owner
    && binding.ownership_epoch === state.ownership_epoch, 'Equipment binding/owner epoch mismatch')
  check(loadout.id === equipmentId && loadout.version === '8' && loadout.holder === state.current_owner
    && loadout.root_id === provenance.root_id && loadout.root_version === provenance.maker_version
    && hashEqual(loadout.root_content_commitment, provenance.root_content_commitment), 'Equipment Maker/holder mismatch')
  check(loadout.selections.length <= 500 && BigInt(loadout.selection_count) === BigInt(loadout.selections.filter(Boolean).length)
    && loadout.commitment.length === 32 && equipmentCommitment(loadout) === toHex(new Uint8Array(loadout.commitment)), 'Equipment commitment/count mismatch')
  let slotEnd = 0n
  const slotKeys = new Set<string>()
  for (const slot of loadout.definition_slots) {
    const capacity = BigInt(slot.capacity)
    const slotKey = `${slot.source_definition_id}/${slot.part_key}`
    check((slot.source_definition_id === loadout.root_id || attachedIds.has(slot.source_definition_id)) && slot.part_key.length > 0
      && !slotKeys.has(slotKey) && slot.profile_commitment.length === 32
      && BigInt(slot.start) === slotEnd && capacity === 1n && slotEnd + capacity <= 500n,
    'Equipment definition slot identity/range mismatch')
    slotKeys.add(slotKey)
    for (let index = Number(slotEnd); index < Number(slotEnd + capacity); index++) {
      const selection = loadout.selections[index]
      check(!selection || selection.part_key === slot.part_key && (slot.source_definition_id === loadout.root_id
        || selection.source_class === 1 && selection.source_definition_id === slot.source_definition_id), 'Equipment selection definition slot mismatch')
    }
    slotEnd += capacity
  }
  check(slotEnd === BigInt(loadout.selections.length), 'Equipment definition slot coverage mismatch')
  const instanceIds = new Set<string>()
  const items = []
  for (let start = 0; start < loadout.selections.length; start += 16) {
    const batch = await Promise.all(loadout.selections.slice(start, start + 16).map(async (selection, offset) => {
    const index = start + offset; if (!selection) return null
    check(selection.selection_index === String(index) && [0, 1, 2].includes(selection.source_class), 'Selection slot/source mismatch')
    // Base/Pack usage rights are not independently owned component instances.
    if (selection.source_class === 1 || (selection.source_class === 0 && selection.access_subject === loadout.maker_access_pass_id)) return null
    const id = receiveId(selection.access_subject)
    check(!instanceIds.has(id), 'Instance appears in multiple slots'); instanceIds.add(id)
    const kind = selection.source_class === 0 ? 'base' as const : 'external' as const
    const item = kind === 'base'
      ? decodeNativeBcs(EquipmentBaseItemBcs, await reads.read(id, types.base, 1, state.current_owner))
      : decodeNativeBcs(EquipmentExternalItemBcs, await reads.read(id, types.external, 1, state.current_owner))
    check(item.id === id && item.version === '8' && item.holder === state.current_owner
      && item.ownership_epoch === selection.source_epoch && item.equip_lock?.loadout_id === equipmentId
      && item.equip_lock.selection_index === String(index) && BigInt(item.equip_lock.equip_revision) > 0n
      && BigInt(item.equip_lock.equip_revision) <= BigInt(loadout.revision), 'Component instance lock/owner mismatch')
    if ('root_id' in item) {
      check(item.root_id === loadout.root_id && item.root_version === loadout.root_version
        && hashEqual(item.root_content_commitment, loadout.root_content_commitment)
        && item.definition_registry_id === loadout.definition_registry_id && item.pack_registry_id === loadout.pack_registry_id
        && selection.source_definition_id === item.root_id && selection.part_key === item.part_key
        && selection.item_key === item.item_key, 'Base source mismatch')
    } else check(item.product_id === selection.source_definition_id
      && hashEqual(item.asset_content_commitment, selection.asset_content_commitment), 'External source mismatch')
    return { kind, item }
    }))
    for (const item of batch) if (item) items.push(item)
  }
  const source = input.source || exact ? await readSource(loadout) : null
  const updateSource = input.update || input.source || exact ? await readEquipmentUpdateSource(client, target, reads, loadout) : null
  await reads.verify()
  return { ...identity, status: 'BOUND' as const, equipment: { loadout, binding, instances: items }, inventory, source, updateSource }

  async function readSource(loadout: ReturnType<typeof EquipmentLoadoutBcs.parse> | null) {
    return readNativeEquipmentSource(client, target, reads, { rootId: provenance.root_id,
      owner: state.current_owner, makerVersion: provenance.maker_version,
      rootCommitment: provenance.root_content_commitment, loadout, styleStart: input.source?.styleStart, pack: input.source?.pack,
      exactSlots: exact?.slots,
      baseItems: inventory?.objects.flatMap(row => 'part_key' in row.item ? [row.item] : []),
      externalProductIds: inventory?.objects.flatMap(row => 'product_id' in row.item ? [row.item.product_id] : []) })
  }

  async function readExactInventory(content: NamedLoadoutContent) {
    const objects: Awaited<ReturnType<typeof readInventory>>['objects'] = []
    const targets = content.slots.filter(row => row?.kind === 'base-item' || row?.kind === 'external-item')
    for (let start = 0; start < targets.length; start += 16) {
      const pages = await Promise.all(targets.slice(start, start + 16).map(row => readInventory({
        kind: row!.kind === 'base-item' ? 'base' : 'external', itemId: row!.accessSubject })))
      objects.push(...pages.flatMap(page => page.objects))
    }
    return { objects, hasNextPage: false, cursor: null }
  }

  async function readInventory(query: { kind: 'base' | 'external'; cursor?: string; itemId?: string }) {
    check(query.kind === 'base' || query.kind === 'external', 'Unknown inventory kind')
    if (query.cursor !== undefined) check(validEquipmentCursor(query.cursor), 'Invalid inventory cursor')
    const type = query.kind === 'base' ? types.base : types.external
    check(query.itemId === undefined || query.cursor === undefined, 'Targeted inventory cannot use a cursor')
    // A selected ID survives index pagination/reordering, but grants no custody authority.
    const page = query.itemId !== undefined
      ? { objects: [{ objectId: receiveId(query.itemId), type,
        owner: { $kind: 'AddressOwner' as const, AddressOwner: state.current_owner } }], hasNextPage: false, cursor: null }
      : await client.core.listOwnedObjects({ owner: state.current_owner, type, limit: 20, cursor: query.cursor })
    check(page.objects.length <= 20 && (!page.hasNextPage || typeof page.cursor === 'string' && page.cursor.length > 0), 'Invalid inventory page')
    const ids = new Set<string>()
    const objects = await Promise.all(page.objects.map(async row => {
      const id = receiveId(row.objectId)
      check(!ids.has(id), 'Duplicate inventory instance'); ids.add(id)
      check(normalizeStructTag(row.type) === normalizeStructTag(type)
        && row.owner.$kind === 'AddressOwner' && row.owner.AddressOwner === state.current_owner, 'Inventory index mismatch')
      // Index rows are discovery hints; always read current BCS and custody.
      const item = query.kind === 'base'
        ? decodeNativeBcs(EquipmentBaseItemBcs, await reads.read(id, types.base, 1, state.current_owner))
        : decodeNativeBcs(EquipmentExternalItemBcs, await reads.read(id, types.external, 1, state.current_owner))
      check(item.id === id && item.version === '8' && item.holder === state.current_owner, 'Inventory instance holder mismatch')
      return { kind: query.kind, item,
        // Not an admission verdict. Maker/Pack/Seal/rights checks still precede any equip.
        eligibility: 'NOT_EVALUATED' as const,
        occupancy: item.equip_lock === null ? 'UNLOCKED' as const
          : item.equip_lock.loadout_id === equipmentId ? 'THIS_SOUL' as const : 'OTHER_LOADOUT' as const }
    }))
    return { objects, hasNextPage: page.hasNextPage, cursor: page.hasNextPage ? page.cursor : null }
  }
}
