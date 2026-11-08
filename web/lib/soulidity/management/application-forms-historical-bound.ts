import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readApplicationContainedHistoricalChild } from './application-historical-contained-child'
import { ManagementApplicationBcs, ManagementBoundPartsBcs, ManagementSourceBcs, ManagementDefinitionBcs, ManagementRepresentationBcs } from './application-bcs'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalSlots } from './application-forms-historical-slots'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_BOUND_${code}`) }
/** Original Bound permanent inventory: prove typed mapping, latest carrier at
 * original Application input, then contained pages at that historical carrier.
 * Qualified parent-commit/permanent-child invariants required; never current
 * owned state, another Soul's record or Item ownership as a Bound substitute. */
export async function readFormsHistoricalBound(input: Parameters<typeof readFormsHistoricalSlots>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalSlots({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_SLOT_BINDINGS_EVIDENCE') return evidence
  const app = p.target.application.originalPackageId, model = p.target.model.originalPackageId
  const wrapper = `0x2::dynamic_object_field::Wrapper<${app}::character::BoundPartsKey>`
  const fieldId = deriveDynamicFieldID(p.applicationId, wrapper, moveEmptyStructBytes())
  const moduleOwner = deriveDynamicFieldID(p.soulId, `0x2::dynamic_object_field::Wrapper<${input.standardTypeOrigin}::soul::ModuleKey<${app}::character::ApplicationWitness>>`, bcs.byteVector().serialize(new TextEncoder().encode('animacraft')).toBytes())
  function assertApplication(bytes: Uint8Array) {
    const value = ManagementApplicationBcs.parse(bytes)
    check(ManagementApplicationBcs.serialize(value).toBase64() === toBase64(bytes) && value.id === p.applicationId && value.root === p.soulId, 'APPLICATION')
  }
  const mapping = await readHistoricalChildThroughOwnedParent({ client: input.client, anchorEffects: evidence.effects,
    anchorTransactionDigest: evidence.transactionDigest, anchorCheckpoint: evidence.checkpoint, anchorMode: 'input',
    rootId: p.applicationId, rootType: `${app}::character::ApplicationState`, rootOwnerId: moduleOwner,
    childId: fieldId, childType: `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, chainIdentifier: p.target.chainIdentifier,
    genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: input.maxHops, assertRoot: assertApplication })
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address }), field = Field.parse(mapping.bytes)
  check(mapping.reference.created && Field.serialize(field).toBase64() === toBase64(mapping.bytes) && field.id === fieldId
    && field.name.name.dummy_field === false && !evidence.effects.V2!.changedObjects.some(([id]) => id === fieldId || id === field.value), 'PERMANENT_MAPPING')
  const carrier = await readApplicationContainedHistoricalChild({ client: input.client, anchorEffects: evidence.effects,
    anchorTransactionDigest: evidence.transactionDigest, anchorCheckpoint: evidence.checkpoint, rootId: p.applicationId,
    rootType: `${app}::character::ApplicationState`, rootOwnerId: moduleOwner, parentUid: fieldId, childId: field.value,
    childType: `${app}::character::BoundParts`, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST,
    signal, maxHops: input.maxHops, assertContainsParent: bytes => assertApplication(bytes) })
  const bound = ManagementBoundPartsBcs.parse(carrier.bytes), store = bound.records
  check(ManagementBoundPartsBcs.serialize(bound).toBase64() === toBase64(carrier.bytes) && bound.id === field.value
    && store.locations.length <= 512 && BigInt(store.page_count) <= 512n && store.pages.size === store.page_count, 'CARRIER')
  const writer = await readHistoricalParentTransaction({ client: input.client, transactionDigest: carrier.writerTransactionDigest,
    maxCheckpoint: evidence.checkpoint, chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal })
  check(writer.executionStatus === 'Success', 'WRITER')
  const Page = bcs.struct('Page', { id: bcs.Address, name: bcs.u64(), value: bcs.vector(ManagementSourceBcs) }), used = new Set<string>()
  const verified: Array<{ index: string; source: ReturnType<typeof ManagementSourceBcs.parse> }> = []
  for (let i = 0; i < evidence.captured.selections.length; i++) {
    const choice = evidence.captured.selections[i].selection.Bound
    if (!choice) continue
    const index = choice.index, snapshot = evidence.captured.sources[i].binding!.source
    check(!used.has(index) && BigInt(index) < BigInt(store.locations.length), 'INDEX'); used.add(index)
    const location = store.locations[Number(index)]
    check(BigInt(location.page) < BigInt(store.page_count) && BigInt(location.index) < 32n, 'LOCATION')
    const childId = deriveDynamicFieldID(store.pages.id, 'u64', bcs.u64().serialize(location.page).toBytes())
    const proof = await readApplicationContainedHistoricalChild({ client: input.client, anchorEffects: writer.effects,
      anchorTransactionDigest: writer.transactionDigest, anchorCheckpoint: writer.checkpoint, anchorMode: 'written', rootId: bound.id,
      rootType: `${app}::character::BoundParts`, rootOwnerId: fieldId, parentUid: store.pages.id, childId,
      childType: `0x2::dynamic_field::Field<u64,vector<${model}::policy::Source>>`, chainIdentifier: p.target.chainIdentifier,
      genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: input.maxHops, assertContainsParent(bytes, uid) {
        const root = ManagementBoundPartsBcs.parse(bytes), old = root.records.locations[Number(index)]
        check(ManagementBoundPartsBcs.serialize(root).toBase64() === toBase64(bytes) && root.id === bound.id && root.records.pages.id === uid
          && old && old.page === location.page && old.index === location.index, 'CONTAINMENT')
      } })
    const page = Page.parse(proof.bytes)
    check(Page.serialize(page).toBase64() === toBase64(proof.bytes) && page.id === childId && page.name === location.page && page.value.length <= 32
      && BigInt(location.index) < BigInt(page.value.length) && page.value.reduce((n, value) => n + ManagementSourceBcs.serialize(value).toBytes().length, 0) <= 196608, 'PAGE')
    const source = page.value[Number(location.index)]
    check(source.definition.rights === 1 && snapshot.rights === 1
      && toHex(sha256(ManagementDefinitionBcs.serialize(source.definition).toBytes())) === toHex(source.definition_hash)
      && toHex(sha256(ManagementSourceBcs.serialize(source).toBytes())) === toHex(snapshot.source_hash)
      && source.product === snapshot.product && source.maker === snapshot.maker && source.maker_version === snapshot.maker_version && source.version === snapshot.version
      && toHex(source.definition_hash) === toHex(snapshot.definition)
      && toHex(sha256(ManagementRepresentationBcs.serialize(source.definition.representation).toBytes())) === toHex(snapshot.representation), 'SOURCE')
    verified.push({ index, source })
  }
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_BOUND_INVENTORY_EVIDENCE' as const, originalBoundParts: bound, originalBoundSources: verified,
    selectedBoundInventoryVerified: true as const, boundPartsMappingVerified: true as const, completeBusinessOutputVerified: false as const }
}
