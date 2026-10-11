import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromHex, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { SoulDetailStateBcs } from '@soulidity/sdk'
import type { WalrusBatchParentHistoryContext } from '../upload/walrus-batch-history'
import { walrusBatchPreparationHash } from '../upload/walrus-batch-preparation'
import { assertSoulAuthoringBusinessGraph } from './soul-authoring-graph'
import { createSoulAuthoringHistoricalReader, decodeAuthoringHistory } from './soul-authoring-history-read'
import { SoulAuthoringContentEventBcs } from './soul-authoring-content-history'
import { createSoulAuthoringOutputProof, type SoulAuthoringCollectionIdentity, type SoulAuthoringMintIdentity } from './soul-authoring-outputs'
import { createSoulAuthoringMaterializer } from './soul-authoring-manifest'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation } from './soul-authoring-store'
import { soulAuthoringPacketCheck as check, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import { contentEnvelopeKey } from './content-envelope'
import { historicalObjectOutput } from '../sui/historical-object'

const A = bcs.Address, S = bcs.string(), U = bcs.u64(), B = bcs.bool(), N = bcs.u32()
export const SoulAuthoringEventsBcs = bcs.vector(bcs.struct('Event', { package_id: A, transaction_module: S, sender: A,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const SoulAuthoringEventCodecs = {
  MintManifestCommittedV1: bcs.struct('MintManifestCommittedV1', { author: A, manifest_hash: bcs.byteVector() }),
  NewPersonalKiosk: bcs.struct('NewPersonalKiosk', { kiosk_id: A }),
  PersonalKioskRegistrationUpdated: bcs.struct('PersonalKioskRegistrationUpdated', { kiosk_id: A, kiosk_cap_id: A, owner: A }),
  SoulContentCreated: bcs.struct('SoulContentCreated', { content_id: A, soul_id: A }),
  SoulStateConfigUpserted: bcs.struct('SoulStateConfigUpserted', { state_id: A, soul_id: A, updater: A, key: S }),
  ContentVersionAppended: SoulAuthoringContentEventBcs,
  ActiveBindingUpdated: bcs.struct('ActiveBindingUpdated', { content_id: A, soul_id: A, kind: N, kind_name: S,
    binding: bcs.option(SoulDetailStateBcs.Active), updater: A }),
  SoulPaidAccessListCreated: bcs.struct('SoulPaidAccessListCreated', { paid_access_list_id: A, soul_id: A, creator: A }),
  SoulCreated: bcs.struct('SoulCreated', { soul_id: A, state_id: A, content_id: A, creator: A, owner: A, provenance_kind: bcs.u8() }),
  SoulMintedToKiosk: bcs.struct('SoulMintedToKiosk', { soul_id: A, state_id: A, content_id: A, kiosk_id: A, owner: A, provenance_kind: bcs.u8() }),
  SoulCollectionCreated: bcs.struct('SoulCollectionCreated', { collection_id: A, right_id: A, creator: A, current_holder: A, tradeable: B, max_supply: bcs.option(U) }),
  CollectionMintedToKiosk: bcs.struct('CollectionMintedToKiosk', { collection_id: A, right_id: A, owner: A, kiosk_id: A, tradeable: B }),
  SoulAddedToCollection: bcs.struct('SoulAddedToCollection', { collection_id: A, soul_id: A, current_supply: U, max_supply: bcs.option(U) }),
  SoulListed: bcs.struct('SoulListed', { listing_id: A, soul_id: A, seller: A, kiosk_id: A, price: U }),
  CollectionListed: bcs.struct('CollectionListed', { listing_id: A, collection_id: A, right_id: A, seller: A, kiosk_id: A, price: U }),
}
type EventName = keyof typeof SoulAuthoringEventCodecs
type EventValue<K extends EventName> = ReturnType<typeof SoulAuthoringEventCodecs[K]['parse']>
const modules: Record<EventName, string> = { MintManifestCommittedV1: 'market', NewPersonalKiosk: 'personal_kiosk',
  PersonalKioskRegistrationUpdated: 'market', SoulContentCreated: 'content', SoulStateConfigUpserted: 'soul',
  ContentVersionAppended: 'content', ActiveBindingUpdated: 'content', SoulPaidAccessListCreated: 'paid_access',
  SoulCreated: 'soul', SoulMintedToKiosk: 'market', SoulCollectionCreated: 'collection', CollectionMintedToKiosk: 'market',
  SoulAddedToCollection: 'collection', SoulListed: 'market', CollectionListed: 'market' }
export interface SoulAuthoringBusinessReceipt {
  parentKey: string; manifestHash: string; transactionDigest: string; checkpoint: string; stage: 'REGISTER' | 'MINT'
  kiosk: { kioskId: string; capId: string } | null; collection: SoulAuthoringCollectionIdentity | null; mints: SoulAuthoringMintIdentity[]
}
/** Called by the real Walrus history verifier, or by the raw authoring query
 * for a registration with no files. Context is already finalized/authenticated;
 * this is the business proof, not a replacement for ledger/checkpoint proof.
 * A created-Collection mint additionally requires the freshly re-proved original
 * REGISTER receipt from this verifier, never a current Collection lookup. */
export async function proveSoulAuthoringBusinessHistory(params: {
  client: SuiGrpcClient; preparation: SoulAuthoringPreparation; record: SoulAuthoringPacketRecord
  context: WalrusBatchParentHistoryContext; registrationReceipt: SoulAuthoringBusinessReceipt | null; signal: AbortSignal
}): Promise<SoulAuthoringBusinessReceipt> {
  const { client, signal } = params, p = parseSoulAuthoringPreparation(params.preparation)
  // Browser AbortSignal is not structured-cloneable. Snapshot only proof data;
  // keep the caller's live cancellation signal for every historical read.
  const c = structuredClone({ ...params.context, signal: undefined }), prior = structuredClone(params.registrationReceipt)
  const graph = assertSoulAuthoringBusinessGraph({ preparation: p, record: params.record,
    walrusCommandIndices: c.walrusCommandIndices, registeredBlobIds: c.blobs.map(b => b.objectId) })
  const record = graph.record, step = record.plan.step, r = p.manifest.request, target = r.target
  check(c.packet.bytes === record.packet.bytes && c.packet.digest === record.packet.digest && c.effects.V2?.transactionDigest === c.packet.digest
    && c.effects.V2.status.$kind === 'Success' && c.stage === (step.kind === 'REGISTER' ? 'register' : 'consume')
    && walrusBatchPreparationHash(c.preparation) === walrusBatchPreparationHash(p.preparation)
    && JSON.stringify(graph.fileIndices) === JSON.stringify(c.indices), 'BUSINESS_CONTEXT_MISMATCH')
  check(c.effects.V2.changedObjects.length <= 16384
    && new Set(c.effects.V2.changedObjects.map(([id]) => id)).size === c.effects.V2.changedObjects.length
    && new Set(c.effects.V2.unchangedConsensusObjects.map(([id]) => id)).size === c.effects.V2.unchangedConsensusObjects.length
    && c.effects.V2.unchangedConsensusObjects.every(([id]) => !c.effects.V2!.changedObjects.some(([other]) => id === other)), 'BUSINESS_EFFECTS_ALIASES')
  check(c.events.length > 0 && c.events.length <= 1024 * 1024, 'BUSINESS_EVENTS_BUDGET')
  const all = decodeAuthoringHistory(SoulAuthoringEventsBcs, c.events), ignored = new Set(c.walrusEventIndices)
  check(ignored.size === c.walrusEventIndices.length && c.walrusEventIndices.every(i => Number.isSafeInteger(i) && i >= 0 && i < all.length), 'WALRUS_EVENT_INDICES')
  const events = all.filter((_, i) => !ignored.has(i)); let cursor = 0
  const type = (name: EventName) => normalizeStructTag(`${name === 'NewPersonalKiosk' ? target.personalKioskTypePackageId : target.originalPackageId}::${modules[name]}::${name}`)
  function decode<K extends EventName>(name: K, event: typeof all[number]): EventValue<K> {
    const personal = name === 'NewPersonalKiosk'
    check(normalizeStructTag(TypeTagSerializer.tagToString({ struct: event.type_ })) === type(name)
      && event.package_id === (personal ? target.kioskPackageId : target.callablePackageId)
      && event.transaction_module === (personal ? 'personal_kiosk' : name === 'SoulAddedToCollection' ? 'collection' : 'market')
      && event.sender === r.author, 'BUSINESS_EVENT_SOURCE')
    return decodeAuthoringHistory(SoulAuthoringEventCodecs[name], event.contents) as EventValue<K>
  }
  function candidates<K extends EventName>(name: K) {
    return events.filter(e => normalizeStructTag(TypeTagSerializer.tagToString({ struct: e.type_ })) === type(name)).map(e => decode(name, e))
  }
  function next<K extends EventName>(name: K, expected?: Partial<EventValue<K>>): EventValue<K> {
    check(events[cursor], 'BUSINESS_EVENT_MISSING'); const value = decode(name, events[cursor++])
    if (expected) check(Object.entries(expected).every(([key, v]) => JSON.stringify(value[key as keyof typeof value]) === JSON.stringify(v)), 'BUSINESS_EVENT_VALUE')
    return value
  }
  function has(name: EventName) { return events[cursor] && normalizeStructTag(TypeTagSerializer.tagToString({ struct: events[cursor].type_ })) === type(name) }
  const reader = createSoulAuthoringHistoricalReader({ client, record, effects: c.effects, signal })
  const output = createSoulAuthoringOutputProof({ reader, preparation: p, registeredBlobIds: c.blobs.map(b => b.objectId) })
  const receipt: SoulAuthoringBusinessReceipt = { parentKey: record.plan.parentKey, manifestHash: record.plan.manifestHash,
    transactionDigest: record.packet.digest, checkpoint: c.checkpoint, stage: step.kind, kiosk: null, collection: null, mints: [] }
  if (step.kind === 'MINT') {
    if (r.collection) check(prior?.stage === 'REGISTER' && prior.parentKey === receipt.parentKey && prior.manifestHash === receipt.manifestHash
      && prior.collection?.collectionId === step.chunk.collectionObjectId && prior.transactionDigest !== receipt.transactionDigest, 'CREATED_COLLECTION_HISTORY_REQUIRED')
    for (const index of c.indices) if (p.preparation.manifest.files[index].uploadType === 'public')
      check(historicalObjectOutput(c.effects, c.blobs[index].objectId, 'mutated').owner.AddressOwner === r.author, 'PUBLIC_BLOB_RECIPIENT')
  }
  const selected = step.kind === 'REGISTER' ? step.kiosk : step.chunk.kiosk
  async function kiosk(kioskId: string, addedItems: number) {
    let capId = selected.capId, created = false
    if (selected.kind === 'NEW') next('NewPersonalKiosk', { kiosk_id: kioskId })
    if (has('PersonalKioskRegistrationUpdated')) {
      const e = next('PersonalKioskRegistrationUpdated', { kiosk_id: kioskId, owner: r.author })
      check(capId === null || capId === e.kiosk_cap_id, 'KIOSK_CAP_EVENT'); capId = e.kiosk_cap_id; created = true
    }
    check(capId, 'KIOSK_CAP_REQUIRED'); receipt.kiosk = await output.kiosk(selected, kioskId, capId, addedItems, created)
  }
  if (step.kind === 'REGISTER') {
    const commitment = next('MintManifestCommittedV1', { author: r.author })
    check(toBase64(commitment.manifest_hash) === toBase64(fromHex(record.plan.manifestHash)), 'MANIFEST_EVENT_HASH')
    if (r.collection) {
      const m = candidates('CollectionMintedToKiosk'); check(m.length === 1, 'COLLECTION_MINT_EVENT_COUNT')
      const v = m[0], lists = candidates('CollectionListed')
      check(lists.length === (r.collection.listingPriceAtomic === null ? 0 : 1), 'COLLECTION_LIST_EVENT_COUNT')
      await kiosk(v.kiosk_id, 1)
      next('SoulCollectionCreated', { collection_id: v.collection_id, right_id: v.right_id, creator: r.author,
        current_holder: r.author, tradeable: r.collection.tradeable, max_supply: r.collection.maxSupply })
      next('CollectionMintedToKiosk', { ...v, owner: r.author, tradeable: r.collection.tradeable })
      if (lists.length) next('CollectionListed', { ...lists[0], collection_id: v.collection_id, right_id: v.right_id,
        seller: r.author, kiosk_id: v.kiosk_id, price: r.collection.listingPriceAtomic! })
      receipt.collection = { collectionId: v.collection_id, rightId: v.right_id, listingId: lists[0]?.listing_id ?? null }
      await output.collection(receipt.collection, v.kiosk_id)
    }
  } else if (step.chunk.mintIndices.length) {
    const chunk = step.chunk, minted = candidates('SoulMintedToKiosk')
    check(minted.length === chunk.mintIndices.length, 'SOUL_MINT_EVENT_COUNT')
    const kioskId = minted[0].kiosk_id
    await kiosk(kioskId, chunk.mintIndices.reduce((n, i) => n + 1 + (r.mints[i].source ? 1 : 0), 0))
    const bind = chunk.collectionObjectId ? await output.boundCollection(chunk.collectionObjectId, chunk.mintIndices.length) : null
    const materialize = createSoulAuthoringMaterializer(p.manifest, p.preparation, c.blobs.map(b => b.objectId))
    for (const [position, mintIndex] of chunk.mintIndices.entries()) {
      const m = r.mints[mintIndex], args = materialize(mintIndex), v = minted[position]
      check(v.content_id === m.contentObjectId && v.owner === r.author && v.kiosk_id === kioskId
        && v.provenance_kind === (m.kind === 'ORDINARY' ? 0 : m.kind === 'IMPORTED' ? 1 : 2), 'SOUL_MINT_EVENT')
      next('SoulContentCreated', { content_id: v.content_id, soul_id: v.soul_id })
      const config = (key: string) => next('SoulStateConfigUpserted', { state_id: v.state_id, soul_id: v.soul_id, updater: r.author, key })
      for (const entry of [...args.initialStateConfig].reverse()) config(entry.key)
      const appended = []
      for (const entry of args.initialContent) {
        const e = next('ContentVersionAppended'); appended.push(e)
        config(contentEnvelopeKey({ contentObjectId: v.content_id, kind: entry.kind, name: entry.name,
          versionIndex: String(entry.expectedVersionIndex), blobObjectId: entry.blobObjectId }))
        if (entry.setActive) next('ActiveBindingUpdated', { content_id: v.content_id, soul_id: v.soul_id, kind: entry.kind,
          kind_name: e.kind_name, updater: r.author, binding: { version: '1', kind: entry.kind, name: entry.name,
            version_index: String(entry.expectedVersionIndex), download_policy: e.download_policy } })
      }
      const paid = next('SoulPaidAccessListCreated', { soul_id: v.soul_id, creator: r.author })
      next('SoulCreated', { soul_id: v.soul_id, state_id: v.state_id, content_id: v.content_id,
        creator: r.author, owner: r.author, provenance_kind: v.provenance_kind })
      next('SoulMintedToKiosk', v)
      if (bind) next('SoulAddedToCollection', { collection_id: chunk.collectionObjectId!, soul_id: v.soul_id,
        current_supply: String(BigInt(bind.beforeSupply) + BigInt(position + 1)), max_supply: bind.maxSupply })
      const sale = m.listingPriceAtomic === null ? null : next('SoulListed', { soul_id: v.soul_id, seller: r.author, kiosk_id: kioskId, price: m.listingPriceAtomic })
      const identity = { mintIndex, soulId: v.soul_id, stateId: v.state_id, contentId: v.content_id,
        accessListId: paid.paid_access_list_id, listingId: sale?.listing_id ?? null }
      await output.mint(identity, kioskId, chunk.collectionObjectId, appended); receipt.mints.push(identity)
    }
  }
  check(cursor === events.length, 'EXTRA_BUSINESS_EVENTS')
  const mintedIds = receipt.mints.flatMap(m => [m.soulId, m.stateId, m.contentId, m.accessListId, ...(m.listingId ? [m.listingId] : [])])
  check(new Set(mintedIds).size === mintedIds.length, 'BUSINESS_OUTPUT_ALIAS')
  signal.throwIfAborted(); return receipt
}
