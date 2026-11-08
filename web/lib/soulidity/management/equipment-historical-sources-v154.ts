import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { readApplicationContainedHistoricalChild } from './application-historical-contained-child'
import { parseEquipmentManagementRecord } from './equipment-record'
import { readEquipmentHistoricalInventoryV154 } from './equipment-historical-inventory-v154'
import { ManagementApplicationBcs, ManagementCompositionBcs, ManagementBoundPartsBcs, ManagementPagedSourcesBcs,
  ManagementItemBcs, ManagementSourceBcs, ManagementDefinitionBcs } from './application-bcs'

type Source = ReturnType<typeof ManagementSourceBcs.parse>
type Store = ReturnType<typeof ManagementPagedSourcesBcs.parse>
type Effects = Parameters<typeof readHistoricalMoveObject>[0]['effects']
type Proof = Awaited<ReturnType<typeof readApplicationContainedHistoricalChild>>
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_SOURCES_V154_${code}`) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sourceBytes = (value: Source) => ManagementSourceBcs.serialize(value).toBase64()
function source(value: Source, rights: number) {
  check(value.definition.rights === rights && toHex(sha256(ManagementDefinitionBcs.serialize(value.definition).toBytes())) === toHex(value.definition_hash), 'SOURCE_RIGHTS_HASH')
  return value
}
/** Internal component of the complete original result pipeline. Proves actual
 * all Reference/Bound pages and every occupied Item on both original snapshots;
 * metadata hints and selected Source hashes cannot replace raw historical data.
 * Source eligibility/semantic, custody, gas/all effects and approved release
 * qualification remain mandatory before any complete-business success verdict. */
export async function readEquipmentHistoricalSourcesV154(input: Parameters<typeof readEquipmentHistoricalInventoryV154>[0]) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan, client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const standardTypeOrigin = input.standardTypeOrigin, compositionId = input.compositionId, maxHops = input.maxHops
  const originalOccupiedPartBcs = [...input.originalOccupiedPartBcs], signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  const evidence = await readEquipmentHistoricalInventoryV154({ client, record, standardTypeOrigin, compositionId, maxHops, originalOccupiedPartBcs, signal })
  if (!evidence.inventory || !evidence.slot || !evidence.rootApplication) return { ...evidence, sources: null }
  const inventory = evidence.inventory
  const execution = evidence.execution; check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const c = evidence.slot.compositionBefore, app = p.target.application.originalPackageId, model = p.target.model.originalPackageId
  const compositionOwner = deriveDynamicFieldID(p.applicationId, `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`, moveEmptyStructBytes())
  const moduleOwner = evidence.rootApplication.moduleFieldId
  const Page = bcs.struct('Page', { id: bcs.Address, name: bcs.u64(), value: bcs.vector(ManagementSourceBcs) })
  const pageType = `0x2::dynamic_field::Field<u64,vector<${model}::policy::Source>>`
  type Anchor = { effects: Effects; transactionDigest: string; checkpoint: string; mode: 'input' | 'written' }
  const anchor = (mode: 'input' | 'written'): Anchor => ({ effects: execution.effects, transactionDigest: record.packet.digest, checkpoint: execution.checkpoint, mode })
  const histories: Array<{ role: string; snapshot: string; id: string; proof: Proof }> = []
  async function contained(a: Anchor, rootId: string, rootType: string, rootOwnerId: string, parentUid: string, childId: string, childType: string,
    assertContainsParent: (bytes: Uint8Array, uid: string) => void, role: string) {
    const proof = await readApplicationContainedHistoricalChild({ client, anchorEffects: a.effects, anchorTransactionDigest: a.transactionDigest,
      anchorCheckpoint: a.checkpoint, anchorMode: a.mode, rootId, rootType, rootOwnerId, parentUid, childId, childType,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops, assertContainsParent })
    histories.push({ role, snapshot: a.mode, id: childId, proof }); return proof
  }
  function assertApplication(bytes: Uint8Array) {
    const value = ManagementApplicationBcs.parse(bytes)
    check(ManagementApplicationBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === p.applicationId && value.root === p.soulId
      && value.operator.name === evidence.rootApplication!.applicationBefore.operator.name, 'APPLICATION')
  }
  async function pages(store: Store, rights: number, a: Anchor, rootId: string, rootType: string, rootOwnerId: string, kind: 'REFERENCE' | 'BOUND') {
    check(store.locations.length <= 512 && BigInt(store.page_count) <= 512n && store.pages.size === store.page_count, 'STORE_BOUND')
    const values: Source[] = [], locations: Store['locations'] = [], proofs: Proof[] = [], rows: ReturnType<typeof Page.parse>[] = []
    let lastBytes = 0
    for (let page = 0; page < Number(store.page_count); page++) {
      const name = String(page), id = deriveDynamicFieldID(store.pages.id, 'u64', bcs.u64().serialize(name).toBytes())
      const proof = await contained(a, rootId, rootType, rootOwnerId, store.pages.id, id, pageType, (bytes, uid) => {
        const root = kind === 'REFERENCE' ? ManagementCompositionBcs.parse(bytes) : ManagementBoundPartsBcs.parse(bytes)
        const actual = 'references' in root ? root.references : root.records
        const canonical = 'references' in root ? ManagementCompositionBcs.serialize(root).toBase64() : ManagementBoundPartsBcs.serialize(root).toBase64()
        check(canonical === toBase64(bytes) && root.id === rootId && actual.pages.id === uid, 'STORE_PARENT')
      }, `${kind}_PAGE`)
      const row = Page.parse(proof.bytes), size = row.value.reduce((sum, value) => sum + ManagementSourceBcs.serialize(value).toBytes().length, 0)
      check(Page.serialize(row).toBase64() === toBase64(proof.bytes) && row.id === id && row.name === name && row.value.length > 0
        && row.value.length <= 32 && size <= 196608, 'PAGE')
      row.value.forEach((value, index) => { source(value, rights); values.push(value); locations.push({ page: name, index: String(index) }) })
      rows.push(row); proofs.push(proof); lastBytes = size
    }
    check(values.length <= 512 && same(locations, store.locations) && String(lastBytes) === store.last_bytes, 'STORE_COVERAGE')
    return { values, rows, proofs }
  }
  const referenceBefore = await pages(c.references, 0, anchor('input'), c.id, `${app}::character::Composition`, compositionOwner, 'REFERENCE')
  const referenceAfter = await pages(evidence.slot.compositionAfter.references, 0, anchor('written'), c.id, `${app}::character::Composition`, compositionOwner, 'REFERENCE')
  check(same(referenceBefore.rows, referenceAfter.rows), 'REFERENCE_INVENTORY_CHANGED')
  const boundWrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::BoundPartsKey>`, boundField = deriveDynamicFieldID(p.applicationId, boundWrapper, moveEmptyStructBytes())
  const mapping = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest,
    anchorCheckpoint: execution.checkpoint, anchorMode: 'input', rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: moduleOwner,
    childId: boundField, childType: `0x2::dynamic_field::Field<${boundWrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
    genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops, assertRoot: assertApplication })
  const Mapping = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address }), mapped = Mapping.parse(mapping.bytes)
  check(mapping.reference.created && Mapping.serialize(mapped).toBase64() === toBase64(mapping.bytes) && mapped.id === boundField && mapped.name.name.dummy_field === false
    && !execution.effects.V2!.changedObjects.some(([id]) => id === boundField), 'BOUND_MAPPING')
  async function boundAt(mode: 'input' | 'written') {
    const proof = await contained(anchor(mode), p.applicationId, `${app}::character::ApplicationState`, moduleOwner, boundField, mapped.value,
      `${app}::character::BoundParts`, bytes => assertApplication(bytes), 'BOUND_CARRIER')
    const value = ManagementBoundPartsBcs.parse(proof.bytes)
    check(ManagementBoundPartsBcs.serialize(value).toBase64() === toBase64(proof.bytes) && value.id === mapped.value, 'BOUND_CARRIER')
    const writer = await readHistoricalParentTransaction({ client, transactionDigest: proof.writerTransactionDigest, maxCheckpoint: execution.checkpoint,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
    check(writer.executionStatus === 'Success', 'BOUND_WRITER')
    const data = await pages(value.records, 1, { effects: writer.effects, transactionDigest: writer.transactionDigest, checkpoint: writer.checkpoint, mode: 'written' },
      value.id, `${app}::character::BoundParts`, boundField, 'BOUND')
    return { value, proof, data }
  }
  const boundBefore = await boundAt('input'), boundAfter = await boundAt('written')
  check(toBase64(boundBefore.proof.bytes) === toBase64(boundAfter.proof.bytes) && same(boundBefore.data.rows, boundAfter.data.rows), 'BOUND_INVENTORY_CHANGED')
  // A synthetic/unqualified effects graph cannot hide descendant writes by
  // omitting a parent commit: compare every known current page effect directly.
  for (const [before, after] of [[referenceBefore, referenceAfter], [boundBefore.data, boundAfter.data]] as const) {
    for (let i = 0; i < before.rows.length; i++) {
      const id = before.rows[i].id
      if (!execution.effects.V2!.changedObjects.some(([objectId]) => objectId === id)) continue
      const common = { client, effects: execution.effects, transactionDigest: record.packet.digest, objectId: id, type: pageType, signal, maxBytes: 256 * 1024 }
      const old = await readHistoricalMoveObject({ ...common, mode: 'input' }), next = await readHistoricalMoveObject({ ...common, mode: 'mutated' })
      check(old.reference.version === before.proofs[i].reference.version && old.reference.digest === before.proofs[i].reference.digest
        && toBase64(old.bytes) === Page.serialize(before.rows[i]).toBase64() && toBase64(next.bytes) === Page.serialize(after.rows[i]).toBase64()
        && toBase64(old.bytes) === toBase64(next.bytes) && old.object.owner.ObjectOwner === before.proofs[i].reference.owner.ObjectOwner
        && next.object.owner.ObjectOwner === before.proofs[i].reference.owner.ObjectOwner, 'PAGE_EFFECT_CONSERVATION')
    }
  }
  const Key = bcs.struct('ItemKey', { id: bcs.Address }), itemWrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::ItemKey>`
  const ItemField = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: Key }), value: bcs.Address })
  const itemField = (id: string) => deriveDynamicFieldID(p.applicationId, itemWrapper, Key.serialize({ id }).toBytes())
  const ids = [...new Set([...evidence.inventory.inputs, ...evidence.inventory.outputs].flatMap(row => row.binding.item === null ? [] : [row.binding.item]))]
  const items: Array<{ id: string; source: Source; beforeDigest: string; afterDigest: string }> = []
  for (const id of ids) {
    const moving = [...(evidence.items?.incoming ?? []), ...(evidence.items?.outgoing ?? [])].find(row => row.id === id)
    let before: { bytes: Uint8Array; reference: { digest: string } }, after: typeof before
    if (moving) {
      const common = { client, effects: execution.effects, transactionDigest: record.packet.digest, objectId: id, type: `${model}::components::Item`, signal, maxBytes: 256 * 1024 }
      before = await readHistoricalMoveObject({ ...common, mode: 'input' }); after = await readHistoricalMoveObject({ ...common, mode: 'mutated' })
    } else {
      const fieldId = itemField(id)
      const proofs: Proof[] = []
      for (const mode of ['input', 'written'] as const) {
        const field = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest,
          anchorCheckpoint: execution.checkpoint, anchorMode: mode, rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: moduleOwner,
          childId: fieldId, childType: `0x2::dynamic_field::Field<${itemWrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
          genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops, assertRoot: assertApplication })
        const value = ItemField.parse(field.bytes)
        check(ItemField.serialize(value).toBase64() === toBase64(field.bytes) && value.id === fieldId && value.name.name.id === id && value.value === id, 'ITEM_MAPPING')
        proofs.push(await contained(anchor(mode), p.applicationId, `${app}::character::ApplicationState`, moduleOwner, fieldId, id,
          `${model}::components::Item`, bytes => assertApplication(bytes), 'ITEM_CARRIER'))
      }
      ;[before, after] = proofs
    }
    const value = ManagementItemBcs.parse(before.bytes)
    check(ManagementItemBcs.serialize(value).toBase64() === toBase64(before.bytes) && value.id === id && toBase64(before.bytes) === toBase64(after.bytes), 'ITEM_CONSERVATION')
    source(value.source, 2)
    if (moving) check(toHex(sha256(ManagementSourceBcs.serialize(value.source).toBytes())) === moving.sourceHash, 'MOVING_ITEM_SOURCE')
    items.push({ id, source: value.source, beforeDigest: before.reference.digest, afterDigest: after.reference.digest })
  }
  function rows(input: typeof inventory.inputs) {
    return input.map(row => {
      const b = row.binding, value = b.item !== null ? items.find(item => item.id === b.item)?.source : b.bound !== null
        ? boundBefore.data.values[Number(b.bound)] : referenceBefore.values[Number(b.reference)]
      check(value, 'SLOT_SOURCE_COVERAGE'); return { ...row, source: value }
    })
  }
  signal.throwIfAborted()
  return { ...evidence, sources: { referenceSources: referenceBefore.values, boundSources: boundBefore.data.values, boundParts: boundBefore.value,
    items, inputs: rows(evidence.inventory.inputs), outputs: rows(evidence.inventory.outputs), histories,
    fullPermanentSourceInventoryPreserved: true as const, occupiedItemSourcesPreserved: true as const,
    requiresQualifiedParentCommitInvariant: true as const, requiresSourceAdapterSemanticEligibility: true as const,
    requiresGasAndAllEffectsConservation: true as const, completeBusinessOutputVerified: false as const }, completeBusinessOutputVerified: false as const }
}
