import type { readNativeEquipment } from './native-equipment'

type EquipmentSnapshot = Awaited<ReturnType<typeof readNativeEquipment>>
export const NAMED_LOADOUT_LIMIT = 12
export const NAMED_LOADOUT_MAX_BYTES = 512 * 1024
export interface NamedLoadoutSlot {
  kind: 'base-selection' | 'pack-selection' | 'base-item' | 'external-item'
  partKey: string; itemKey: string; styleKey: string; swatchKey: string | null
  sourceDefinitionId: string; accessSubject: string
  assetContentCommitment: string; protected: boolean; sealBindingCommitment: string
}
/** A saved reference, never a transferable asset, entitlement or Seal proof. */
export interface NamedLoadoutContent {
  schema: 1
  soulId: string; stateId: string; rootId: string; rootVersion: string; rootContentCommitment: string
  definitionRegistryId: string; packRegistryId: string; baseRegistryId: string; makerAccessPassId: string
  capturedOwner: string; capturedOwnershipEpoch: string
  capturedEquipmentId: string; capturedEquipmentRevision: string
  slots: (NamedLoadoutSlot | null)[]
}
export interface NamedLoadoutSummary {
  id: string; name: string; version: number; selectionCount: number; slotCount: number
  createdAt: string; updatedAt: string
}
export interface NamedLoadout extends NamedLoadoutSummary { content: NamedLoadoutContent }

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const id = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
const u64 = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
const key = (v: unknown) => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= 128 && !/[\u0000-\u001f\u007f]/.test(v)
const hex = (bytes: number[]) => bytes.map(byte => byte.toString(16).padStart(2,'0')).join('')
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k))
export function validNamedLoadoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)
}
export function normalizeNamedLoadoutName(value: unknown): string {
  check(typeof value === 'string', 'Enter a loadout name.')
  const name = value.trim().normalize('NFC')
  check(name.length > 0 && [...name].length <= 80
    && !/[\u0000-\u001f\u007f]/.test(name), 'Use a loadout name of 1–80 characters without control characters.')
  return name
}
/** Decrypted/browser content is untrusted. Reject unknown data instead of storing
 * opaque proofs, asset URLs or a second source of equipment authority. */
export function validateNamedLoadoutContent(value: unknown): NamedLoadoutContent {
  const v = value as NamedLoadoutContent
  check(v && typeof v === 'object' && exactKeys(v,['schema','soulId','stateId','rootId','rootVersion','rootContentCommitment',
    'definitionRegistryId','packRegistryId','baseRegistryId','makerAccessPassId','capturedOwner','capturedOwnershipEpoch',
    'capturedEquipmentId','capturedEquipmentRevision','slots']), 'Invalid saved loadout fields.')
  check(v.schema === 1 && [v.soulId,v.stateId,v.rootId,v.definitionRegistryId,v.packRegistryId,v.baseRegistryId,
    v.makerAccessPassId,v.capturedOwner,v.capturedEquipmentId].every(id)
    && [v.rootVersion,v.capturedOwnershipEpoch,v.capturedEquipmentRevision].every(u64)
    && hash(v.rootContentCommitment) && Array.isArray(v.slots) && v.slots.length > 0 && v.slots.length <= 500,
  'Invalid saved loadout scope.')
  const instances = new Set<string>()
  for (const row of v.slots) {
    if (row === null) continue
    check(row && typeof row === 'object' && exactKeys(row,['kind','partKey','itemKey','styleKey','swatchKey',
      'sourceDefinitionId','accessSubject','assetContentCommitment','protected','sealBindingCommitment'])
      && ['base-selection','pack-selection','base-item','external-item'].includes(row.kind)
      && [row.partKey,row.itemKey,row.styleKey].every(key) && (row.swatchKey === null || key(row.swatchKey))
      && [row.sourceDefinitionId,row.accessSubject].every(id)
      && hash(row.assetContentCommitment) && typeof row.protected === 'boolean'
      && (row.protected ? hash(row.sealBindingCommitment) : row.sealBindingCommitment === ''),
    'Invalid saved loadout selection.')
    if (row.kind === 'base-selection' || row.kind === 'base-item') check(row.sourceDefinitionId === v.rootId, 'Saved Base source mismatch.')
    if (row.kind === 'base-selection') check(row.accessSubject === v.makerAccessPassId, 'Saved Base access mismatch.')
    if (row.kind === 'base-item' || row.kind === 'external-item') {
      check(!instances.has(row.accessSubject) && row.accessSubject !== v.makerAccessPassId, 'A saved component cannot occupy two slots.')
      instances.add(row.accessSubject)
    }
  }
  check(new TextEncoder().encode(JSON.stringify(v)).length <= NAMED_LOADOUT_MAX_BYTES, 'Saved loadout is too large.')
  return v
}

/** Called only after actual chain equipment has been read and verified.
 * Capturing does not acquire anything, change equipment, or persist Seal proofs. */
export function captureNamedLoadout(snapshot: EquipmentSnapshot): NamedLoadoutContent {
  const equipment = snapshot.equipment; const source = snapshot.source
  check(equipment && source, 'Load verified Soul equipment and its Maker source before saving.')
  const loadout = equipment.loadout
  const slots = loadout.selections.map((row,index): NamedLoadoutSlot | null => {
    if (!row) return null
    check(row.selection_index === String(index) && [0,1,2].includes(row.source_class), 'Equipment slot changed before capture.')
    const kind = row.source_class === 1 ? 'pack-selection' : row.source_class === 2 ? 'external-item'
      : row.source_class === 0 && row.access_subject === loadout.maker_access_pass_id ? 'base-selection' : 'base-item'
    if (kind === 'base-item' || kind === 'external-item') check(equipment.instances.some(entry =>
      entry.kind === (kind === 'base-item' ? 'base' : 'external') && entry.item.id === row.access_subject
      && entry.item.equip_lock?.loadout_id === loadout.id && entry.item.equip_lock.selection_index === String(index)),
    'The saved component must have its exact verified equipment lock.')
    return { kind,partKey:row.part_key,itemKey:row.item_key,styleKey:row.style_key,swatchKey:row.swatch_key,
      sourceDefinitionId:row.source_definition_id,accessSubject:row.access_subject,
      assetContentCommitment:hex(row.asset_content_commitment),protected:row.protected,sealBindingCommitment:hex(row.seal_binding_commitment) }
  })
  return validateNamedLoadoutContent({ schema:1,soulId:snapshot.soulId,stateId:snapshot.stateId,rootId:loadout.root_id,
    rootVersion:loadout.root_version,rootContentCommitment:hex(loadout.root_content_commitment),
    definitionRegistryId:loadout.definition_registry_id,packRegistryId:loadout.pack_registry_id,baseRegistryId:source.base.id,
    makerAccessPassId:loadout.maker_access_pass_id,capturedOwner:snapshot.owner,capturedOwnershipEpoch:snapshot.ownershipEpoch,
    capturedEquipmentId:loadout.id,capturedEquipmentRevision:loadout.revision,slots })
}
