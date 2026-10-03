import type { AnimacraftEquipmentV8Removal } from '@soulidity/sdk'
import type { EquipmentSnapshot } from './equipment-operation'
import { equipmentEligibility, baseSelectionEligibility, packSelectionEligibility, equipmentRemovalIndex,
  type EquipmentChoice, type EquipmentBaseChoice, type EquipmentPackChoice } from './equipment-eligibility'
import { captureNamedLoadout, validateNamedLoadoutContent, type NamedLoadoutSlot } from './named-loadout'

export type LoadoutPlacement = ({ kind: 'equip' } & EquipmentChoice)
  | ({ kind: 'select-base' } & EquipmentBaseChoice) | ({ kind: 'select-pack' } & EquipmentPackChoice)
export interface NamedLoadoutPlan {
  removals: AnimacraftEquipmentV8Removal[]
  additions: LoadoutPlacement[]
  unchangedSlots: number[]
  commandCount: number
}
type Pack = NonNullable<NonNullable<EquipmentSnapshot['source']>['pack']>
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const hex = (value: number[]) => value.map(byte => byte.toString(16).padStart(2,'0')).join('')
function equal(a: NamedLoadoutSlot | null, b: NamedLoadoutSlot | null) {
  if (!a || !b) return a === b
  return (Object.keys(a) as (keyof NamedLoadoutSlot)[]).every(key => a[key] === b[key])
}

/** A plan is derived from freshly verified chain objects, never a saved proof.
 * Even unchanged targets undergo entitlement/commitment/lock checks. This pure
 * projection does not mutate the snapshot or pretend that removals happened. */
export function planNamedLoadout(snapshot: EquipmentSnapshot, content: unknown, packs: Pack[] = snapshot.source?.applyPacks ?? []): NamedLoadoutPlan {
  const saved = validateNamedLoadoutContent(content)
  const current = captureNamedLoadout(snapshot)
  for (const key of ['soulId','stateId','rootId','rootVersion','rootContentCommitment','definitionRegistryId',
    'packRegistryId','baseRegistryId','makerAccessPassId','capturedOwner','capturedOwnershipEpoch','capturedEquipmentId'] as const) {
    check(saved[key] === current[key], 'Saved loadout no longer belongs to this Soul, owner epoch or Maker source.')
  }
  check(saved.slots.length === current.slots.length, 'Saved loadout capacity changed.')
  check(!snapshot.listed, 'Listed Souls cannot apply loadouts.')
  const equipment = snapshot.equipment!; const source = snapshot.source!
  const removals: AnimacraftEquipmentV8Removal[] = []
  const unchangedSlots: number[] = []
  current.slots.forEach((old,index) => {
    if (equal(old,saved.slots[index])) { unchangedSlots.push(index); return }
    if (!old) return
    const removal: AnimacraftEquipmentV8Removal = old.kind === 'base-selection' || old.kind === 'pack-selection'
      ? { kind: 'selection',selectionIndex: String(index) }
      : { kind: old.kind === 'base-item' ? 'base' : 'external',itemId: old.accessSubject }
    check(equipmentRemovalIndex(snapshot,removal) === index, 'The component to remove is no longer equipped here.')
    removals.push(removal)
  })
  const additions: LoadoutPlacement[] = []
  saved.slots.forEach((row,index) => {
    if (!row) return
    const unchanged = unchangedSlots.includes(index)
    const targetSelectionIndex = String(index)
    // Eligibility uses empty target slots; actual removals are checked above.
    // Unlock only the exact current item that is removed by this plan (or kept).
    const objects = snapshot.inventory?.objects.map(entry => {
      if (entry.item.id !== row.accessSubject || !entry.item.equip_lock) return entry
      const lock = entry.item.equip_lock
      check(lock.loadout_id === equipment.loadout.id && (unchanged && lock.selection_index === targetSelectionIndex
        || removals.some(r => r.kind !== 'selection' && r.itemId === entry.item.id
          && equipmentRemovalIndex(snapshot,r) === Number(lock.selection_index))), 'This component is in use outside this loadout change.')
      return { ...entry,item: { ...entry.item,equip_lock: null } }
    })
    let view: EquipmentSnapshot = { ...snapshot, status: 'BOUND',equipment: { ...equipment,loadout: { ...equipment.loadout,
      // Revision overflow is checked against the actual total below. The
      // per-placement check must not reject a no-op at the final u64 revision.
      revision: '0',selections: equipment.loadout.selections.map(() => null) } },
      inventory: snapshot.inventory ? { ...snapshot.inventory,objects: objects! } : null }
    let placement: LoadoutPlacement
    if (row.kind === 'external-item') {
      const product = source.external.find(entry => entry.product.id === row.sourceDefinitionId)?.product
      check(product && product.part_key === row.partKey && product.item_key === row.itemKey
        && product.style_key === row.styleKey && product.default_swatch_key === row.swatchKey
        && hex(product.asset_content_commitment) === row.assetContentCommitment
        && !row.protected && row.sealBindingCommitment === '', 'Saved external component content changed.')
      placement = { kind: 'equip',targetSelectionIndex,item: { kind: 'external',itemId: row.accessSubject,productId: row.sourceDefinitionId } }
    } else if (row.kind === 'pack-selection') {
      const pack = [...packs,...(source.pack ? [source.pack] : [])].find(entry => entry.selected?.pass.id === row.accessSubject)
      const style = pack?.selected?.styles.find(style => style.part_key === row.partKey && style.item_key === row.itemKey && style.style_key === row.styleKey)
      check(style && hex(style.asset_content_commitment) === row.assetContentCommitment
        && style.protected === row.protected && hex(style.seal_binding_commitment) === row.sealBindingCommitment,
      'Saved Pack style content changed.')
      view = { ...view,source: { ...source,pack: pack! } }
      placement = { kind: 'select-pack',targetSelectionIndex,selection: { baseRegistryId: saved.baseRegistryId,
        releaseId: row.sourceDefinitionId,passId: row.accessSubject,partKey: row.partKey,itemKey: row.itemKey,
        styleKey: row.styleKey,swatchKey: row.swatchKey } }
    } else {
      const style = source.styles.find(style => style.part_key === row.partKey && style.item_key === row.itemKey && style.style_key === row.styleKey)
      const protectedEntry = source.protectedBase.entries.find(entry => entry.partKey === row.partKey && entry.itemKey === row.itemKey && entry.styleKey === row.styleKey)
      check(style && hex(style.payload_commitment) === row.assetContentCommitment && style.protected === row.protected
        && (row.protected ? source.protectedBase.available && protectedEntry?.proof && protectedEntry.bindingCommitment
          && hex(protectedEntry.bindingCommitment) === row.sealBindingCommitment : row.sealBindingCommitment === ''),
      'Saved Base style content or protection changed.')
      const protection = row.protected ? protectedEntry!.proof! : undefined
      if (row.kind === 'base-item') {
        const item = objects?.find(entry => entry.kind === 'base' && entry.item.id === row.accessSubject)?.item
        check(item && 'part_key' in item && item.part_key === row.partKey && item.item_key === row.itemKey,
          'Saved Base instance identity changed.')
        placement = { kind: 'equip',targetSelectionIndex,item: { kind: 'base',itemId: row.accessSubject,
          baseRegistryId: saved.baseRegistryId,styleKey: row.styleKey,swatchKey: row.swatchKey,...(protection ? { protection } : {}) } }
      } else placement = { kind: 'select-base',targetSelectionIndex,selection: { baseRegistryId: saved.baseRegistryId,
        partKey: row.partKey,itemKey: row.itemKey,styleKey: row.styleKey,swatchKey: row.swatchKey,...(protection ? { protection } : {}) } }
    }
    const eligible = placement.kind === 'equip' ? equipmentEligibility(view,placement)
      : placement.kind === 'select-base' ? baseSelectionEligibility(view,placement) : packSelectionEligibility(view,placement)
    check(eligible.allowed && eligible.slot === index, eligible.reason)
    if (!unchanged) additions.push(placement)
  })
  const commandCount = removals.length + additions.length
  check(BigInt(equipment.loadout.revision) + BigInt(commandCount) <= 18446744073709551615n, 'Equipment revision cannot be advanced.')
  return { removals,additions,unchangedSlots,commandCount }
}
