import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { ManagementCompositionBcs, ManagementSourceBcs, ManagementDefinitionBcs, ManagementRepresentationBcs } from './application-bcs'
import { readApplicationContainedHistoricalChild } from './application-historical-contained-child'
import { readFormsHistoricalSlots } from './application-forms-historical-slots'
import { parseFormsManagementRecord } from './application-forms-record'
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_REFERENCES_${code}`) }

/** Selected Reference records from original append-only Composition inventory.
 * Qualified source-store mutations must commit parent metadata. Never reads a
 * current maker publication or substitutes another Soul's equal-looking Source.
 * Bound inventory, licence eligibility and rendering remain separate proofs. */
export async function readFormsHistoricalReferences(input: Parameters<typeof readFormsHistoricalSlots>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalSlots({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_SLOT_BINDINGS_EVIDENCE') return evidence
  const c = evidence.compositionBefore, store = c.references, app = p.target.application.originalPackageId, model = p.target.model.originalPackageId
  check(store.locations.length <= 512 && BigInt(store.page_count) <= 512n && store.pages.size === store.page_count, 'STORE')
  const rootOwnerId = deriveDynamicFieldID(p.applicationId, `0x2::dynamic_object_field::Wrapper<${app}::character::CompositionKey>`, moveEmptyStructBytes())
  const Page = bcs.struct('Page', { id: bcs.Address, name: bcs.u64(), value: bcs.vector(ManagementSourceBcs) })
  const pages = new Map<string, ReturnType<typeof Page.parse>>(), used = new Set<string>()
  const verified: Array<{ index: string; source: ReturnType<typeof ManagementSourceBcs.parse> }> = []
  for (let i = 0; i < evidence.captured.selections.length; i++) {
    const choice = evidence.captured.selections[i].selection.Reference
    if (!choice) continue
    const index = choice.index
    check(!used.has(index) && BigInt(index) < BigInt(store.locations.length), 'INDEX'); used.add(index)
    const location = store.locations[Number(index)], snapshot = evidence.captured.sources[i].binding!.source
    check(BigInt(location.page) < BigInt(store.page_count) && BigInt(location.index) < 32n, 'LOCATION')
    let page = pages.get(location.page)
    if (!page) {
      const childId = deriveDynamicFieldID(store.pages.id, 'u64', bcs.u64().serialize(location.page).toBytes())
      const proof = await readApplicationContainedHistoricalChild({ client: input.client, anchorEffects: evidence.effects,
        anchorTransactionDigest: evidence.transactionDigest, anchorCheckpoint: evidence.checkpoint, rootId: c.id,
        rootType: `${app}::character::Composition`, rootOwnerId, parentUid: store.pages.id, childId,
        childType: `0x2::dynamic_field::Field<u64,vector<${model}::policy::Source>>`, chainIdentifier: p.target.chainIdentifier,
        genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: input.maxHops, assertContainsParent(bytes, uid) {
          const root = ManagementCompositionBcs.parse(bytes), oldLocation = root.references.locations[Number(index)]
          check(ManagementCompositionBcs.serialize(root).toBase64() === toBase64(bytes) && root.id === c.id && root.references.pages.id === uid
            && oldLocation && oldLocation.page === location.page && oldLocation.index === location.index, 'CONTAINMENT')
        } })
      page = Page.parse(proof.bytes)
      check(Page.serialize(page).toBase64() === toBase64(proof.bytes) && page.id === childId && page.name === location.page
        && page.value.length > 0 && page.value.length <= 32
        && page.value.reduce((size, source) => size + ManagementSourceBcs.serialize(source).toBytes().length, 0) <= 196608, 'PAGE')
      pages.set(location.page, page)
    }
    check(BigInt(location.index) < BigInt(page.value.length), 'MISSING_SOURCE')
    const source = page.value[Number(location.index)]
    check(source.definition.rights === 0 && snapshot.rights === 0
      && toHex(sha256(ManagementDefinitionBcs.serialize(source.definition).toBytes())) === toHex(source.definition_hash)
      && toHex(sha256(ManagementSourceBcs.serialize(source).toBytes())) === toHex(snapshot.source_hash)
      && source.product === snapshot.product && source.maker === snapshot.maker && source.maker_version === snapshot.maker_version && source.version === snapshot.version
      && toHex(source.definition_hash) === toHex(snapshot.definition)
      && toHex(sha256(ManagementRepresentationBcs.serialize(source.definition.representation).toBytes())) === toHex(snapshot.representation), 'SOURCE')
    verified.push({ index, source })
  }
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_REFERENCE_INVENTORY_EVIDENCE' as const, originalReferenceSources: verified,
    selectedReferenceInventoryVerified: true as const, requiresBoundInventoryProof: true as const, completeBusinessOutputVerified: false as const }
}
