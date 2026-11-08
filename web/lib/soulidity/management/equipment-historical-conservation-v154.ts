import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject, historicalMoveObjectType, historicalObjectInput } from '../../sui/historical-object'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readEquipmentHistoricalNestedSemanticV154 } from './equipment-historical-nested-semantic-v154'
import { readEquipmentHistoricalModuleV154 } from './equipment-historical-module-v154'
import { readEquipmentHistoricalUnlistedCustodyV155 } from './equipment-historical-custody-v155'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { parseEquipmentManagementRecord } from './equipment-record'
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_CONSERVATION_V154_${code}`) }
const Events = bcs.struct('TransactionEvents', { data: bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address, type_: bcs.StructTag, contents: bcs.byteVector() })) })
const ApplicationChanged = bcs.struct('Changed', { soul: bcs.Address, revision: bcs.u64(), recipe_hash: bcs.byteVector(), operation: bcs.u8(), item: bcs.option(bcs.Address) })
const StandardChanged = bcs.struct('Changed', { soul: bcs.Address, revision: bcs.u64(), operation: bcs.u8(), namespace: bcs.struct('TypeName', { name: bcs.string() }), name: bcs.byteVector(), object: bcs.Address })
/** Full original-state conservation pipeline. No caller's partial-proof flags
 * are accepted: every constituent is reconstructed from the saved packet and
 * original ledger history. G1/source/build/deployed qualification remains required for an equipment
 * outcome. Qualified renderer/asset bytes remain separate display obligations. */
export async function readEquipmentHistoricalConservationV154(input: Parameters<typeof readEquipmentHistoricalNestedSemanticV154>[0] & {
  custodyTypeOrigin: string; maxParentHops?: number; standardPackage: PinnedMovePackage
}) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan, client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const c = { client, record, standardTypeOrigin: input.standardTypeOrigin, visualTypeOrigin: input.visualTypeOrigin, contentTypeOrigin: input.contentTypeOrigin,
    custodyTypeOrigin: input.custodyTypeOrigin, standardPackage: structuredClone(input.standardPackage), compositionId: input.compositionId,
    maxHops: input.maxHops, maxParentHops: input.maxParentHops, originalOccupiedPartBcs: [...input.originalOccupiedPartBcs],
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(180000)]) }
  check(c.standardPackage && /^0x[0-9a-f]{64}$/.test(c.standardPackage.callablePackageId), 'STANDARD_PACKAGE')
  const evidence = await readEquipmentHistoricalNestedSemanticV154(c)
  if (!evidence.nestedSemantic || !evidence.applicationTree || !evidence.model || !evidence.sources || !evidence.slot || !evidence.rootApplication || !evidence.inventory || !evidence.items)
    return { ...evidence, conservation: null }
  const execution = evidence.execution; check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const membership = await readEquipmentHistoricalModuleV154(c)
  check(membership.moduleHistory && membership.execution.status === 'FINALIZED_EXECUTION', 'MODULE_PROOF')
  const native = await readEquipmentHistoricalUnlistedCustodyV155(c)
  check(native.custody && 'originalListingsAbsent' in native.custody && native.custody.originalListingsAbsent
    && native.execution.status === 'FINALIZED_EXECUTION', 'UNLISTED_CUSTODY')
  for (const other of [membership.execution, native.execution]) check(other.checkpoint === execution.checkpoint
    && toBase64(bcs.TransactionEffects.serialize(other.effects).toBytes()) === toBase64(bcs.TransactionEffects.serialize(execution.effects).toBytes())
    && toBase64(other.events) === toBase64(execution.events), 'ORIGINAL_OBSERVATIONS_DIFFER')
  const gas = await readSuiGasSettlement({ client, packet: record.packet, effects: execution.effects, signal: c.signal })
  const comp = evidence.slot.compositionBefore, app = p.target.application.originalPackageId, itemWrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::ItemKey>`
  const itemKey = (id: string) => deriveDynamicFieldID(p.applicationId, itemWrapper, bcs.Address.serialize(id).toBytes())
  const moves = [...evidence.items.incoming, ...evidence.items.outgoing]
  const mutable = new Set([p.soulId, p.applicationId, comp.id, p.accountId, p.kioskId, evidence.slot.slotId,
    membership.moduleHistory.versionId, ...moves.flatMap(row => [row.id, itemKey(row.id)])])
  const known = new Set([...mutable, ...[...evidence.inventory.inputs, ...evidence.inventory.outputs].map(row => deriveDynamicFieldID(comp.slots.id, `${p.target.model.originalPackageId}::assembly::PartKey`, fromBase64(row.partBcs))),
    ...evidence.sources.histories.map(row => row.id), ...evidence.sources.items.flatMap(row => [row.id, itemKey(row.id)]),
    ...evidence.model.originalObjectIds, ...evidence.applicationTree.histories.map(row => row.id),
    evidence.rootApplication.moduleFieldId, native.custody.nativeFields.itemBefore.childId, native.custody.nativeFields.lockBefore.childId])
  for (const key of ['CompositionKey', 'BoundPartsKey', 'CoreKey', 'AuthorizationKey', 'ContentKey', 'PaidAccessKey', 'LoadoutKey', 'OutputKey', 'StateConfigurationKey'])
    known.add(deriveDynamicFieldID(p.applicationId, `0x2::dynamic_object_field::Wrapper<${app}::character::${key}>`, moveEmptyStructBytes()))
  check(gas.gasCoinIds.every(id => !known.has(id)), 'GAS_ROLE_ALIAS')
  for (const id of gas.gasCoinIds) { known.add(id); mutable.add(id) }
  const e = execution.effects.V2!
  check(e.changedObjects.length <= 4096 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && e.unchangedConsensusObjects.length === 0, 'EFFECT_SCOPE')
  const unchangedWrites: string[] = []
  for (const [id, change] of e.changedObjects) {
    check(known.has(id), 'UNEXPECTED_OBJECT_EFFECT')
    if (mutable.has(id)) continue // Exact domain-specific proofs above own these deltas.
    check(change.idOperation.$kind === 'None' && change.inputState.$kind === 'Exist' && change.outputState.$kind === 'ObjectWrite', 'UNRELATED_LIFETIME')
    const original = historicalObjectInput(execution.effects, id)
    // A raw type hint only selects a decoder. The subsequent historical reader
    // authenticates full Object BCS, type and recomputed digest against effects.
    const hint = (await client.ledgerService.getObject({ objectId: id, version: original.version,
      readMask: { paths: ['bcs'] } }, { abort: c.signal })).response.object?.bcs?.value
    check(hint instanceof Uint8Array && hint.length > 0 && hint.length <= 1024 * 1024, 'ORIGINAL_RAW_TYPE')
    const parsed = bcs.Object.parse(hint); check(parsed.data.Move, 'MOVE_OBJECT_REQUIRED')
    const type = historicalMoveObjectType(parsed.data.Move.type)
    const args = { client, effects: execution.effects, transactionDigest: record.packet.digest, objectId: id, type, signal: c.signal, maxBytes: 1024 * 1024 }
    const before = await readHistoricalMoveObject({ ...args, mode: 'input' }), after = await readHistoricalMoveObject({ ...args, mode: 'mutated' })
    check(toBase64(before.bytes) === toBase64(after.bytes) && JSON.stringify(before.object.owner) === JSON.stringify(after.object.owner), 'UNRELATED_BODY_OR_OWNER_CHANGED')
    unchangedWrites.push(id)
  }
  // Character records change first; Standard commits the permanent module next.
  // Standard commit_update also updates ModuleVersionKey (verified above).
  const events = Events.parse(execution.events)
  check(Events.serialize(events).toBase64() === toBase64(execution.events) && events.data.length === 2, 'EVENT_COUNT')
  const [changed, committed] = events.data
  check(changed.package_id === p.target.application.callablePackageId && changed.transaction_module === 'character' && changed.sender === p.author
    && changed.type_.address === app && changed.type_.module === 'character' && changed.type_.name === 'Changed' && changed.type_.typeParams.length === 0, 'APPLICATION_EVENT_SOURCE')
  const value = ApplicationChanged.parse(changed.contents), expectedOperation = p.action.kind === 'ATTACH' ? 1 : p.action.kind === 'REPLACE' ? 2 : p.previous.kind === 'ITEM' ? 3 : p.previous.kind === 'REFERENCE' ? 4 : 5
  check(ApplicationChanged.serialize(value).toBase64() === toBase64(changed.contents) && value.soul === p.soulId
    && value.revision === evidence.rootApplication.applicationAfter.revision && toHex(value.recipe_hash) === toHex(evidence.rootApplication.applicationAfter.recipe_hash)
    && value.operation === expectedOperation && value.item === (p.action.kind === 'REMOVE' && p.previous.kind === 'ITEM' ? p.previous.itemId : null), 'APPLICATION_EVENT')
  check(committed.package_id === c.standardPackage.callablePackageId && committed.transaction_module === 'soul' && committed.sender === p.author
    && committed.type_.address === c.standardTypeOrigin && committed.type_.module === 'soul' && committed.type_.name === 'Changed' && committed.type_.typeParams.length === 0, 'STANDARD_EVENT_SOURCE')
  const commit = StandardChanged.parse(committed.contents)
  check(StandardChanged.serialize(commit).toBase64() === toBase64(committed.contents) && commit.soul === p.soulId && commit.revision === evidence.rootApplication.rootAfter.revision
    && commit.operation === 2 && normalizeStructTag(commit.namespace.name) === normalizeStructTag(`${app}::character::ApplicationWitness`)
    && toHex(commit.name) === '616e696d616372616674' && commit.object === p.applicationId, 'STANDARD_EVENT')
  c.signal.throwIfAborted()
  return { ...evidence, conservation: { gas, moduleHistory: membership.moduleHistory, custody: native.custody, unchangedWrites,
    checkedChangedObjectIds: e.changedObjects.map(([id]) => id), originalGasAndAllEffectsConserved: true as const, bothOriginalChangeEventsVerified: true as const,
    requiresApprovedOriginalSourceForEquipmentOutcome: true as const, requiresQualifiedRendererAndAssetContentForDisplay: true as const }, completeBusinessOutputVerified: false as const }
}
