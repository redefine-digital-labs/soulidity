import type { AnimacraftEquipmentV8Item, AnimacraftEquipmentV8Removal, AnimacraftEquipmentV8BaseSelection, AnimacraftEquipmentV8Protection, AnimacraftEquipmentV8PackSelection } from '@soulidity/sdk'
import type { readNativeEquipment } from './native-equipment'
import { equipmentPackStyleColor } from './native-equipment-pack'

type Snapshot = Awaited<ReturnType<typeof readNativeEquipment>>
type PlacementChoice = { targetSelectionIndex?: string }
export type EquipmentChoice = PlacementChoice & { item: AnimacraftEquipmentV8Item; styleStart?: number;
  replaces?: AnimacraftEquipmentV8Removal }
export type EquipmentBaseChoice = PlacementChoice & { selection: AnimacraftEquipmentV8BaseSelection; styleStart?: number; replaces?: AnimacraftEquipmentV8Removal }
export type EquipmentPackChoice = PlacementChoice & { selection: AnimacraftEquipmentV8PackSelection; replaces?: AnimacraftEquipmentV8Removal }
export type EquipmentEligibility = { allowed: false; reason: string } | { allowed: true; slot: number | null; reason: string }
const no = (reason: string): EquipmentEligibility => ({ allowed: false, reason })
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v,i) => v === b[i])
const max = 18446744073709551615n
/** Replacements preserve their exact position even when an earlier slot is empty. */
function placementSlot(snapshot: Snapshot, profile: NonNullable<Snapshot['source']>['slots'][number],
  choice: PlacementChoice, removedIndex: number | null): EquipmentEligibility {
  const requested = choice.targetSelectionIndex
  if (requested !== undefined && (typeof requested !== 'string' || !/^(0|[1-9][0-9]{0,2})$/.test(requested)
    || Number(requested) >= 500)) return no('Invalid target equipment slot.')
  if (profile.capacity !== '1') return no('Refresh the single-item Soul equipment layout.')
  const slots = [profile.slotStart]
  if (removedIndex !== null && !slots.includes(removedIndex)) return no('Choose a replacement in the same definition namespace.')
  const slot = requested !== undefined ? Number(requested) : removedIndex ?? slots.find(index => snapshot.equipment!.loadout.selections[index] === null)
  if (slot === undefined) return no('Replace the component currently equipped in this part.')
  if (!slots.includes(slot)) return no('Choose a target slot in the same part.')
  if (snapshot.equipment!.loadout.selections[slot] !== null && slot !== removedIndex) return no('The target equipment slot is occupied.')
  return { allowed: true, slot, reason: `Ready for slot ${slot + 1}${removedIndex !== null ? ' with atomic replacement' : ''}.` }
}
export function protectedBaseProof(snapshot: Snapshot, partKey: string, itemKey: string, styleKey: string) {
  const source = snapshot.source?.protectedBase
  return source?.available ? source.entries.find(row => row.partKey === partKey && row.itemKey === itemKey && row.styleKey === styleKey)?.proof ?? null : null
}
function protectionMatches(snapshot: Snapshot, style: NonNullable<Snapshot['source']>['styles'][number], proof?: AnimacraftEquipmentV8Protection) {
  if (!style.protected) return proof === undefined
  const expected = protectedBaseProof(snapshot,style.part_key,style.item_key,style.style_key)
  return Boolean(expected && proof && proof.sealRegistryId === expected.sealRegistryId && proof.sealPolicyId === expected.sealPolicyId
    && eq(proof.ciphertextBlobCommitment,expected.ciphertextBlobCommitment)
    && eq(proof.certificationCommitment,expected.certificationCommitment) && eq(proof.sealId,expected.sealId))
}
export function clearableEquipmentSelection(snapshot: Snapshot, index: number) {
  const row = snapshot.equipment?.loadout.selections[index]
  return Boolean(row && (row.source_class === 1 || row.source_class === 0
    && row.access_subject === snapshot.equipment!.loadout.maker_access_pass_id))
}
export function equipmentRemovalIndex(snapshot: Snapshot, removal: AnimacraftEquipmentV8Removal): number | null {
  const equipment = snapshot.equipment
  if (!equipment) return null
  if (removal.kind === 'selection') {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(removal.selectionIndex)) return null
    const index = Number(removal.selectionIndex)
    return index < 500 && clearableEquipmentSelection(snapshot,index) ? index : null
  }
  const old = equipment.instances.find(row => row.kind === removal.kind && row.item.id === removal.itemId)
  const lock = old?.item.equip_lock
  return old && lock && lock.loadout_id === equipment.loadout.id
    && equipment.loadout.selections[Number(lock.selection_index)]?.access_subject === old.item.id ? Number(lock.selection_index) : null
}

/** Advisory UI/pre-sign check over verified source rows, not a substitute for
 * Move execution. Deliberately does not evaluate Complete-only Rules. */
export function equipmentEligibility(snapshot: Snapshot, choice?: EquipmentChoice): EquipmentEligibility {
  const source = snapshot.source
  if (snapshot.listed) return no('Listed Souls cannot change equipment.')
  if (!source) return no('Refresh the verified Maker source before choosing equipment.')
  if (source.root.lifecycle !== 1) return no('The Maker is not active.')
  if (!source.access) return no('Acquire Maker access before creating or adding equipment.')
  if (!choice) {
    if (snapshot.equipment) return no('This Soul already has equipment.')
    if (!source.currentProtocol) return no('The Maker does not match the current protocol and pricing snapshot.')
    if (source.slots.length === 0) return no('This Maker has no equipment slots.')
    return { allowed: true, slot: null, reason: 'Create an empty equipment binding for this Soul.' }
  }
  const equipment = snapshot.equipment
  if (!equipment) return no('Create equipment for this Soul first.')
  if (BigInt(equipment.loadout.revision) > max - (choice.replaces ? 2n : 1n)) return no('Equipment revision cannot be advanced.')
  const candidate = snapshot.inventory?.objects.find(row => row.kind === choice.item.kind && row.item.id === choice.item.itemId)
  if (!candidate || candidate.item.holder !== snapshot.owner) return no('This component must be read from the current owner wallet.')
  let removedIndex: number | null = null
  if (choice.replaces) {
    removedIndex = equipmentRemovalIndex(snapshot,choice.replaces)
    if (removedIndex === null) return no('The component to replace is no longer equipped here.')
  }
  const lock = candidate.item.equip_lock
  if (lock && !(choice.replaces && choice.replaces.kind !== 'selection' && choice.replaces.itemId === candidate.item.id && lock.loadout_id === equipment.loadout.id
    && Number(lock.selection_index) === removedIndex)) return no('This component is already in use. Select its replacement operation or unequip it first.')
  let part: string
  if (choice.item.kind === 'base' && 'part_key' in candidate.item) {
    const item = candidate.item
    if (!source.definitions.item_assetization) return no('This Maker does not use independent Base item assets.')
    if (item.root_id !== source.root.id || item.root_version !== source.root.maker_version
      || !eq(item.root_content_commitment, source.root.content.content_commitment)
      || item.definition_registry_id !== source.definitions.id || item.pack_registry_id !== source.packs.id
      || item.base_registry_id !== source.base.id || choice.item.baseRegistryId !== source.base.id) return no('This Base component belongs to a different Maker source.')
    const row = source.items.find(row => row.part_key === item.part_key && row.item_key === item.item_key)
    if (!row || row.status !== 0 || !eq(row.payload_commitment, item.item_payload_commitment)) return no('The Base item definition is not a matching public asset.')
    const owner = source.ownership.find(row => row.itemId === item.id)?.record
    if (!owner || owner.item_id !== item.id || owner.ownership_epoch !== item.ownership_epoch) return no('The Maker ownership record does not match this component.')
    const style = source.styles.find(row => row.part_key === item.part_key && row.item_key === item.item_key && row.style_key === (choice.item as { styleKey: string }).styleKey)
    if (!style) return no('Load the page containing this component style before selecting it.')
    if (!protectionMatches(snapshot,style,choice.item.protection)) return no('The protected-content equipment proof is missing or does not match this style.')
    if (!source.tracks.some(row => row.key === style.track_key)) return no('The selected style layer is unavailable.')
    if ((style.color_channel_key === null) !== (choice.item.swatchKey === null)
      || style.color_channel_key !== null && !source.colors.find(row => row.key === style.color_channel_key)?.swatches.some(row => row.key === (choice.item as { swatchKey: string | null }).swatchKey)) return no('Choose an exact swatch from this style’s color channel.')
    part = item.part_key
  } else if (choice.item.kind === 'external' && 'product_id' in candidate.item) {
    const item = candidate.item
    const entry = source.external.find(row => row.product.id === item.product_id)
    if (!entry || choice.item.productId !== item.product_id) return no('The external product could not be verified.')
    const { product, admission } = entry
    if (product.lifecycle !== 0) return no('This external product is not active.')
    if (product.root_id !== source.root.id || product.root_version !== source.root.maker_version
      || !eq(product.root_content_commitment, source.root.content.content_commitment)) return no('This external product belongs to a different Maker source.')
    if (!admission || admission.admission_state !== 0 || admission.product_id !== product.id
      || !eq(admission.compatibility_commitment, product.compatibility_commitment)
      || !eq(admission.product_content_commitment, product.content_commitment)) return no('This external product is not currently admitted by the Maker.')
    if (!eq(item.product_content_commitment, product.content_commitment)
      || !eq(item.asset_content_commitment, product.asset_content_commitment)) return no('This component does not match its external product.')
    const profile = source.slots.find(row => row.source_definition_id === source.root.id && row.part_key === product.part_key)
    if (profile?.wardrobe_mode !== 1 || ![2,3].includes(profile.behavior)) return no('This part does not accept external components.')
    part = product.part_key
  } else return no('Component kind does not match the verified instance.')
  const profile = source.slots.find(row => row.source_definition_id === source.root.id && row.part_key === part)
  if (!profile) return no('The component part is unavailable.')
  if (removedIndex !== null && equipment.loadout.selections[removedIndex]?.part_key !== part) return no('Choose a replacement in the same part.')
  return placementSlot(snapshot,profile,choice,removedIndex)
}

/** Non-asset Base content consumes Maker access, never a manufactured wallet item. */
export function baseSelectionEligibility(snapshot: Snapshot, choice: EquipmentBaseChoice): EquipmentEligibility {
  const source = snapshot.source; const equipment = snapshot.equipment; const selected = choice.selection
  if (snapshot.listed) return no('Listed Souls cannot change equipment.')
  if (!source) return no('Refresh the verified Maker source before choosing equipment.')
  if (source.root.lifecycle !== 1) return no('The Maker is not active.')
  if (!source.access) return no('Acquire Maker access before adding a selection.')
  if (!equipment) return no('Create equipment for this Soul first.')
  if (source.definitions.item_assetization) return no('This Maker requires an owned Base item from the wallet.')
  if (selected.baseRegistryId !== source.base.id) return no('This style belongs to a different Maker source.')
  if (BigInt(equipment.loadout.revision) > max - (choice.replaces ? 2n : 1n)) return no('Equipment revision cannot be advanced.')
  const item = source.items.find(row => row.part_key === selected.partKey && row.item_key === selected.itemKey)
  if (!item || item.status !== 0) return no('This Base item is not public content.')
  const style = source.styles.find(row => row.part_key === selected.partKey && row.item_key === selected.itemKey && row.style_key === selected.styleKey)
  if (!style) return no('Load the page containing this component style before selecting it.')
  if (!protectionMatches(snapshot,style,selected.protection)) return no('The protected-content equipment proof is missing or does not match this style.')
  if (!source.tracks.some(row => row.key === style.track_key)) return no('The selected style layer is unavailable.')
  if ((style.color_channel_key === null) !== (selected.swatchKey === null)
    || style.color_channel_key !== null && !source.colors.find(row => row.key === style.color_channel_key)?.swatches.some(row => row.key === selected.swatchKey)) return no('Choose an exact swatch from this style’s color channel.')
  const profile = source.slots.find(row => row.source_definition_id === source.root.id && row.part_key === selected.partKey)
  if (!profile) return no('The component part is unavailable.')
  const removedIndex = choice.replaces ? equipmentRemovalIndex(snapshot,choice.replaces) : null
  if (choice.replaces && (removedIndex === null || equipment.loadout.selections[removedIndex]?.part_key !== selected.partKey)) return no('Choose a currently equipped replacement in the same part.')
  return placementSlot(snapshot,profile,choice,removedIndex)
}

/** Pack content uses its own style definitions and an existing verified pass.
 * Neither current purchase price, Complete quotas nor Pack control epoch revoke
 * that entitlement. Move remains the final authority for the transaction. */
export function packSelectionEligibility(snapshot: Snapshot, choice: EquipmentPackChoice): EquipmentEligibility {
  const source = snapshot.source; const equipment = snapshot.equipment; const selected = choice.selection
  if (snapshot.listed) return no('Listed Souls cannot change equipment.')
  if (!source) return no('Refresh the verified Maker source before choosing equipment.')
  if (source.root.lifecycle !== 1) return no('The Maker is not active.')
  if (!source.access) return no('Acquire Maker access before adding a selection.')
  if (!equipment) return no('Create equipment for this Soul first.')
  if (BigInt(equipment.loadout.revision) > max - (choice.replaces ? 2n : 1n)) return no('Equipment revision cannot be advanced.')
  const pack = source.pack?.selected
  if (!pack || pack.pass.id !== selected.passId || pack.pass.holder !== snapshot.owner) return no('Load the exact Pack pass from the current owner wallet.')
  const { release,pass,admission } = pack
  if (selected.baseRegistryId !== source.base.id || release.id !== selected.releaseId || pass.release_id !== release.id
    || release.root_id !== source.root.id || release.root_version !== source.root.maker_version
    || !eq(release.root_content_commitment,source.root.content.content_commitment)
    || pass.root_id !== release.root_id || pass.root_version !== release.root_version
    || !eq(pass.root_content_commitment,release.root_content_commitment)
    || !eq(pass.release_content_commitment,release.content_commitment)) return no('This Pack belongs to a different Maker source.')
  if (release.lifecycle !== 2) return no('The Pack is not active.')
  if (!admission || admission.admission_state !== 0 || admission.release_id !== release.id
    || admission.semantic_pack_id !== release.semantic_pack_id || pack.semanticReleaseId !== release.id
    || !eq(admission.release_content_commitment,release.content_commitment)) return no('This Pack is not admitted to this Maker.')
  const style = pack.styles.find(row => row.part_key === selected.partKey && row.item_key === selected.itemKey && row.style_key === selected.styleKey)
  if (!style) return no('Load the exact style from this Pack before selecting it.')
  if (pack.definitionCommitment !== null) {
    const attached = equipment.loadout.attached_pack_definitions.find(row => row.release_id === release.id)
    if (!attached || !eq(attached.definition_commitment, pack.definitionCommitment)) return no('Attach this Pack’s verified definitions before selecting its styles.')
  }
  const definitionId = style.definition_sources.part === 2 ? release.id : source.root.id
  const profile = source.slots.find(row => row.source_definition_id === definitionId && row.part_key === selected.partKey)
  if (!profile || (style.definition_sources.part === 1
    ? profile.wardrobe_mode !== 1 || ![1,2,3].includes(profile.behavior)
    : ![0,1].includes(profile.wardrobe_mode) || ![0,1,3].includes(profile.behavior))) return no('This part does not accept Pack content.')
  if ((style.color_channel_key === null) !== (selected.swatchKey === null)
    || style.color_channel_key !== null && !equipmentPackStyleColor(pack, style)?.swatches.some(row => row.key === selected.swatchKey)) return no('Choose an exact swatch from this style’s color channel.')
  const removedIndex = choice.replaces ? equipmentRemovalIndex(snapshot,choice.replaces) : null
  if (choice.replaces && (removedIndex === null || equipment.loadout.selections[removedIndex]?.part_key !== selected.partKey)) return no('Choose a currently equipped replacement in the same part.')
  return placementSlot(snapshot,profile,choice,removedIndex)
}
