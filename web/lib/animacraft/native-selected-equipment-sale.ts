import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { AnimacraftEquipmentV8RemovalPlan } from '@soulidity/sdk'
import { EquipmentReadSet, equipmentCommitment, readNativeEquipment } from './native-equipment'
import { type NativeReceiveTarget, receiveId } from './native-receive'
import { selectedSoulEquipmentPlan } from './native-selected-soul-sale'
import { MAX_MARKET_BATCH_LIST_ROWS } from './market-batch-list-types'

type Equipment = Awaited<ReturnType<typeof readNativeEquipment>>
export interface SelectedSaleEquipmentItem { kind: 'base' | 'external'; itemId: string }
export interface SelectedSaleEquipmentScope {
  soulId: string
  stateId: string
  sellSoul: boolean
  items: SelectedSaleEquipmentItem[]
}
export interface SelectedSaleEquipmentPreparation {
  soulId: string
  stateId: string
  sellSoul: boolean
  selectedItems: Array<SelectedSaleEquipmentItem & { ownershipEpoch: string; selectionIndex: string }>
  equipment: null | {
    /** Only a selected Soul sale closes its binding. Selling all its instances
     * still preserves an empty Soul equipment binding for later use. */
    closeBinding: boolean
    plan: AnimacraftEquipmentV8RemovalPlan
    finalRevision: string
    finalSelectionCount: string
    finalCommitment: string
    retainedSelectionIndexes: string[]
  }
}

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const hashHex = (bytes: number[]) => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')
const releaseKey = (release: Equipment['release']) => JSON.stringify([
  release.network, release.protocolConfigId, release.soulidityCallablePackageId, release.soulidityCallableDigest,
  release.runtimeOriginalPackageId, release.runtimeCallablePackageId, release.runtimeCallableDigest, release.writesEnabled,
])

/** Explicit intent only. Unlocked wallet items need no equipment preparation and
 * must be authenticated by the Market asset reader, not inserted into this list.
 * This schema never treats a Base/Pack usage right as a transferable instance. */
export function captureSelectedSaleEquipmentScopes(input: readonly SelectedSaleEquipmentScope[]): SelectedSaleEquipmentScope[] {
  check(Array.isArray(input) && input.length > 0 && input.length <= MAX_MARKET_BATCH_LIST_ROWS, 'Invalid selected equipment scope count')
  const captured = structuredClone([...input])
  const souls = new Set<string>(), states = new Set<string>(), items = new Set<string>()
  let count = 0
  for (const row of captured) {
    check(row && typeof row === 'object' && keys(row, ['soulId', 'stateId', 'sellSoul', 'items'])
      && typeof row.sellSoul === 'boolean' && Array.isArray(row.items), 'Invalid selected equipment scope')
    receiveId(row.soulId); receiveId(row.stateId)
    check(!souls.has(row.soulId) && !states.has(row.stateId), 'Duplicate selected Soul equipment scope')
    souls.add(row.soulId); states.add(row.stateId)
    check(row.sellSoul || row.items.length > 0, 'No selected asset in equipment scope')
    count += Number(row.sellSoul) + row.items.length
    check(count <= MAX_MARKET_BATCH_LIST_ROWS, 'Selected asset batch exceeds limit')
    for (const item of row.items) {
      check(item && typeof item === 'object' && keys(item, ['kind', 'itemId'])
        && (item.kind === 'base' || item.kind === 'external'), 'Select actual Base or External instances only')
      receiveId(item.itemId)
      check(!items.has(item.itemId), 'Duplicate selected equipment instance')
      items.add(item.itemId)
    }
  }
  return captured
}

/** Consumes authenticated snapshots, never inventory hints. This is preparation,
 * not a listing/fee quote or a signing authorization. The caller must still prove
 * the complete Market source and recheck the shared mutable readset. */
export function prepareSelectedSaleEquipment(owner: string, input: readonly SelectedSaleEquipmentScope[],
  snapshots: readonly Equipment[]): SelectedSaleEquipmentPreparation[] {
  receiveId(owner)
  const selection = captureSelectedSaleEquipmentScopes(input)
  check(Array.isArray(snapshots) && snapshots.length === selection.length, 'Missing exact selected equipment snapshots')
  const frozen = structuredClone(snapshots)
  const equipmentIds = new Set<string>(), instanceIds = new Set<string>()
  return selection.map((selected, index) => {
    const snapshot = frozen[index]
    check(snapshot.soulId === selected.soulId && snapshot.stateId === selected.stateId
      && snapshot.owner === owner && snapshot.listed === false, 'Selected equipment owner/Soul scope changed')
    check(releaseKey(snapshot.release) === releaseKey(frozen[0].release), 'Selected equipment release changed')
    const complete = selectedSoulEquipmentPlan(snapshot)
    if (!snapshot.equipment) {
      check(selected.sellSoul && selected.items.length === 0 && complete === null, 'Selected equipment is not bound to this Soul')
      return { soulId: selected.soulId, stateId: selected.stateId, sellSoul: true, selectedItems: [], equipment: null }
    }
    check(complete, 'Missing selected equipment removal source')
    const { loadout, binding, instances } = snapshot.equipment
    check(!equipmentIds.has(loadout.id), 'Equipment cannot be updated twice in one selected sale')
    equipmentIds.add(loadout.id)
    check(binding.soul_id === selected.soulId && binding.soul_state_id === selected.stateId
      && binding.holder === owner && binding.ownership_epoch === snapshot.ownershipEpoch
      && binding.protocol_config_id === snapshot.release.protocolConfigId && loadout.holder === owner,
    'Selected equipment binding changed')
    check(equipmentCommitment(loadout) === hashHex(loadout.commitment), 'Selected equipment commitment changed')
    for (const row of instances) {
      check(!instanceIds.has(row.item.id), 'Equipped instance appears in multiple selected Souls')
      instanceIds.add(row.item.id)
    }
    const selectedItems = selected.items.map(choice => {
      const instance = instances.find(row => row.item.id === choice.itemId)
      check(instance && instance.kind === choice.kind, 'Selected instance is not equipped on this Soul')
      const item = instance!.item, lock = item.equip_lock
      check(item.transferable === true && item.holder === owner, 'Selected equipment is not transferable by this owner')
      check(lock && lock.loadout_id === loadout.id && BigInt(lock.equip_revision) > 0n
        && BigInt(lock.equip_revision) <= BigInt(loadout.revision), 'Selected instance lock changed')
      const slot = loadout.selections[Number(lock!.selection_index)]
      check(slot && slot.selection_index === lock!.selection_index && slot.access_subject === item.id
        && slot.source_epoch === item.ownership_epoch, 'Selected instance slot/ownership epoch changed')
      return { ...choice, ownershipEpoch: item.ownership_epoch, selectionIndex: lock!.selection_index }
    })
    const chosenIds = new Set(selectedItems.map(row => row.itemId))
    const removals = selected.sellSoul ? complete!.removals : complete!.removals.filter(row =>
      row.kind !== 'selection' && chosenIds.has(row.itemId))
    check(selected.sellSoul || removals.length === selectedItems.length, 'Incomplete selected-instance removal plan')
    const finalSelections = loadout.selections.map(slot => slot && (selected.sellSoul || chosenIds.has(slot.access_subject)) ? null : slot)
    const retainedSelectionIndexes = finalSelections.flatMap((slot, i) => slot ? [String(i)] : [])
    const finalRevision = BigInt(loadout.revision) + BigInt(removals.length)
    check(finalRevision <= (1n << 64n) - 1n, 'Selected equipment removal revision overflow')
    return { soulId: selected.soulId, stateId: selected.stateId, sellSoul: selected.sellSoul, selectedItems,
      equipment: { closeBinding: selected.sellSoul, plan: { ...complete!, removals }, finalRevision: String(finalRevision),
        finalSelectionCount: String(retainedSelectionIndexes.length), retainedSelectionIndexes,
        finalCommitment: equipmentCommitment({ ...loadout, selections: finalSelections }) } }
  })
}

/** Every requested Soul and its selected instance locks share a final readset.
 * No inventory scan, automatic selection, signature or Market transaction. */
export async function readSelectedSaleEquipment(client: SuiGrpcClient, target: NativeReceiveTarget,
  owner: string, input: readonly SelectedSaleEquipmentScope[], readSet?: EquipmentReadSet) {
  receiveId(owner)
  const selection = captureSelectedSaleEquipmentScopes(input), capturedTarget = structuredClone(target)
  const reads = readSet ?? new EquipmentReadSet(client, true)
  const snapshots: Equipment[] = []
  for (const row of selection) snapshots.push(await readNativeEquipment(client, capturedTarget,
    { soulId: row.soulId, stateId: row.stateId, update: true }, reads))
  const preparations = prepareSelectedSaleEquipment(owner, selection, snapshots)
  await reads.verify()
  return { owner, release: structuredClone(snapshots[0].release), preparations }
}
