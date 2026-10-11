import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicCollectionBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  CollectionKioskRegistryBcs, CollectionPublicListingBcs, CollectionKioskListingFieldBcs, CollectionPersonalKioskCapBcs } from '@soulidity/sdk'
import { historicalObjectOutput } from '../sui/historical-object'
import { check, id, uint, same, decode, collectionCommandHash, collectionCommandRaw, collectionCommandTypes,
  collectionCommandMarker, type CollectionCommandRecord, type CollectionCommandQuery } from './collection-command-plan'
import { collectionCommandProjection } from './collection-command-state'

const A = bcs.Address
export const CollectionCommandEventsBcs = bcs.vector(bcs.struct('Event', {
  package_id: A, transaction_module: bcs.string(), sender: A, type_: bcs.StructTag, contents: bcs.byteVector(),
}))
export const CollectionCommandListedBcs = bcs.struct('CollectionListed', { listing_id: A, collection_id: A,
  right_id: A, seller: A, kiosk_id: A, price: bcs.u64() })
export const CollectionCommandCancelledBcs = bcs.struct('CollectionListingCancelled', { listing_id: A, collection_id: A, seller: A })
const Coin = bcs.struct('Coin', { id: A, balance: bcs.u64() })
type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Owner = ReturnType<typeof bcs.Owner.parse>

/** Trusted-ledger canonical historical evidence, not a validator-quorum proof.
 * Current owner/price/portfolio state never substitutes for this receipt. */
export async function proveCollectionCommandHistory(params: { client: SuiGrpcClient; record: CollectionCommandRecord;
  effects: Effects; events: Uint8Array; signal: AbortSignal }): Promise<NonNullable<CollectionCommandQuery['receipt']>> {
  const { client, signal } = params, r = structuredClone(params.record), effects = structuredClone(params.effects), e = effects.V2, p = r.plan
  check(e && e.status.$kind === 'Success' && e.transactionDigest === r.packet.digest, 'HISTORY_EFFECTS')
  uint(e.lamportVersion, true)
  check(e.changedObjects.length <= 512 && e.unchangedConsensusObjects.length <= 32
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length, 'HISTORY_DUPLICATES')
  const bytes = new Uint8Array(params.events)
  check(bytes.length > 0 && bytes.length <= 65536 && e.eventsDigest === collectionCommandHash('TransactionEvents', bytes), 'HISTORY_EVENTS_DIGEST')
  const events = decode(CollectionCommandEventsBcs, bytes), wanted = p.request.action === 'reprice'
    ? ['CollectionListingCancelled', 'CollectionListed'] : [p.request.action === 'list' ? 'CollectionListed' : 'CollectionListingCancelled']
  check(events.length === wanted.length, 'HISTORY_EVENT_COUNT')
  let newListingId: string | null = null
  events.forEach((event, index) => {
    check(event.package_id === p.target.callablePackageId && event.transaction_module === 'market' && event.sender === p.author
      && normalizeStructTag(TypeTagSerializer.tagToString({ struct: event.type_ })) === `${p.target.originalPackageId}::market::${wanted[index]}`,
    'HISTORY_EVENT_TYPE')
    if (wanted[index] === 'CollectionListed') {
      const v = decode(CollectionCommandListedBcs, event.contents); id(v.listing_id)
      check(v.collection_id === p.request.collectionId && v.right_id === p.rightId && v.seller === p.author
        && v.kiosk_id === p.kioskId && v.price === p.request.priceAtomic && v.listing_id !== p.oldListingId
        && !p.objects.some(row => row.objectId === v.listing_id) && !p.absentIds.includes(v.listing_id), 'HISTORY_LISTED_EVENT')
      newListingId = v.listing_id
    } else check(same(decode(CollectionCommandCancelledBcs, event.contents), {
      listing_id: p.oldListingId, collection_id: p.request.collectionId, seller: p.author }), 'HISTORY_CANCELLED_EVENT')
  })
  const tx = Transaction.from(fromBase64(r.packet.bytes)).getData(), types = collectionCommandTypes(p.target)
  const allowed = new Set<string>(), reads = new Set<string>()
  function change(objectId: string) {
    const rows = e!.changedObjects.filter(([id]) => id === objectId)
    check(rows.length === 1 && !e!.unchangedConsensusObjects.some(([id]) => id === objectId), 'HISTORY_CHANGE_REQUIRED')
    allowed.add(objectId); return rows[0][1]
  }
  async function object(objectId: string, type: string, mode: 'input' | 'created' | 'mutated' | 'readonly' | 'owned-input') {
    let version: string, expectedDigest: string, expectedOwner: Owner | null = null
    if (mode === 'input') { const input = change(objectId).inputState.Exist; check(input, 'HISTORY_INPUT_REQUIRED')
      version = input[0][0]; expectedDigest = input[0][1]; expectedOwner = input[1]
    } else if (mode === 'owned-input') {
      const ref = tx.inputs.find(row => row.Object?.ImmOrOwnedObject?.objectId === objectId)?.Object?.ImmOrOwnedObject
      check(ref, 'HISTORY_OWNED_INPUT_REQUIRED'); version = String(ref.version); expectedDigest = ref.digest
    } else if (mode === 'readonly') {
      check(!e!.changedObjects.some(([id]) => id === objectId), 'HISTORY_READONLY_CHANGED')
      const rows = e!.unchangedConsensusObjects.filter(([id]) => id === objectId), value = rows[0]?.[1].ReadOnlyRoot
      check(rows.length === 1 && value, 'HISTORY_READONLY_REQUIRED'); version = value[0]; expectedDigest = value[1]; reads.add(objectId)
    } else {
      change(objectId); const ref = historicalObjectOutput(effects, objectId, mode)
      version = String(ref.version); expectedDigest = ref.digest; expectedOwner = ref.owner
    }
    uint(version, true); check(['created', 'mutated'].includes(mode) ? version === e!.lamportVersion
      : BigInt(version) < BigInt(e!.lamportVersion), 'HISTORY_VERSION')
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: BigInt(version),
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    const observed = collectionCommandProjection(response.object), full = collectionCommandRaw(observed), move = full.data.Move
    check(observed.objectId === objectId && observed.version === version && observed.digest === expectedDigest
      && response.object?.objectType === normalizeStructTag(type) && move
      && (expectedOwner === null || same(full.owner, expectedOwner))
      && (!['created', 'mutated'].includes(mode) || full.previousTransaction === r.packet.digest), 'HISTORY_OBJECT_REFERENCE')
    const shared = tx.inputs.find(row => row.Object?.SharedObject?.objectId === objectId)?.Object?.SharedObject
    if (shared) check(full.owner.Shared?.initialSharedVersion === shared.initialSharedVersion, 'HISTORY_SHARED_BIRTH')
    return { bytes: move.contents, full }
  }
  async function frozenRoot(objectId: string, type: string, expected: string) {
    const value = await object(objectId, type, 'readonly'); check(toBase64(value.bytes) === expected, 'HISTORY_FROZEN_ROOT'); return value
  }
  const root = await frozenRoot(p.request.collectionId, types.collection, p.expected.collectionBcs)
  const collection = decode(SoulPublicCollectionBcs, root.bytes)
  check(collection.current_holder === p.author && collection.current_holder_kiosk_id === p.kioskId && collection.right_id === p.rightId, 'HISTORY_ROOT_AUTHORITY')
  if (p.request.action !== 'delist') {
    const market = decode(SoulPublicMarketConfigBcs, (await frozenRoot(p.target.marketConfigId, types.market, p.expected.marketBcs!)).bytes)
    check(market.secondary_enabled && market.platform_fee_bps === p.quote.feeBps, 'HISTORY_MARKET')
  }
  const cap = await object(p.kioskCapId, types.cap, 'owned-input')
  check(cap.full.owner.AddressOwner === p.author && toBase64(cap.bytes) === p.expected.capBcs
    && !e.changedObjects.some(([id]) => id === p.kioskCapId), 'HISTORY_CAP_PRESERVATION')
  const preservedCap = decode(CollectionPersonalKioskCapBcs, cap.bytes)
  check(preservedCap.cap && !e.changedObjects.some(([id]) => id === preservedCap.cap!.id), 'HISTORY_WRAPPED_CAP_PRESERVATION')
  // Kiosk contents are not a made-up ownership epoch. Prove the actual chain
  // input/output; unrelated pre-execution Kiosk activity is not a failed sale.
  const kioskBefore = await object(p.kioskId, types.kiosk, 'input'), kioskAfter = await object(p.kioskId, types.kiosk, 'mutated')
  const kiosk = decode(SoulPublicKioskBcs, kioskBefore.bytes)
  check(kiosk.owner === p.author && kiosk.item_count > 0 && toBase64(kioskBefore.bytes) === toBase64(kioskAfter.bytes), 'HISTORY_KIOSK_PRESERVATION')
  if (p.request.action !== 'delist') {
    const before = await object(p.target.kioskRegistryId, types.registry, 'input'), after = await object(p.target.kioskRegistryId, types.registry, 'mutated')
    check(decode(CollectionKioskRegistryBcs, before.bytes).version === '1' && toBase64(before.bytes) === toBase64(after.bytes), 'HISTORY_REGISTRY_PRESERVATION')
  }
  if (p.oldListingId) {
    const before = await object(p.oldListingId, types.listing, 'input'), after = await object(p.oldListingId, types.listing, 'mutated')
    check(toBase64(before.bytes) === p.expected.listingBcs, 'HISTORY_OLD_LISTING_INPUT')
    const old = decode(CollectionPublicListingBcs, before.bytes), current = decode(CollectionPublicListingBcs, after.bytes)
    check(same(current, { ...old, purchase_cap: null, is_active: false }), 'HISTORY_OLD_LISTING_OUTPUT')
    check(old.purchase_cap, 'HISTORY_OLD_PURCHASE_CAP')
    const removed = change(old.purchase_cap.id)
    check(removed.inputState.$kind === 'NotExist' && removed.outputState.$kind === 'NotExist'
      && removed.idOperation.$kind === 'Deleted', 'HISTORY_OLD_WRAPPED_CAP')
  }
  if (newListingId) {
    const after = await object(newListingId, types.listing, 'created'), l = decode(CollectionPublicListingBcs, after.bytes)
    check(after.full.owner.Shared?.initialSharedVersion === e.lamportVersion && l.id === newListingId && l.version === '1'
      && l.collection_id === p.request.collectionId && l.right_id === p.rightId && l.seller === p.author && l.seller_kiosk_id === p.kioskId
      && l.price === p.request.priceAtomic && l.is_active && l.purchase_cap && l.purchase_cap.kiosk_id === p.kioskId
      && l.purchase_cap.item_id === p.rightId && l.purchase_cap.min_price === '0', 'HISTORY_NEW_LISTING')
    id(l.purchase_cap.id)
    check(!p.objects.some(row => row.objectId === l.purchase_cap!.id) && !p.absentIds.includes(l.purchase_cap.id)
      && l.purchase_cap.id !== newListingId, 'HISTORY_NEW_PURCHASE_CAP')
    if (p.expected.listingBcs) check(decode(CollectionPublicListingBcs, fromBase64(p.expected.listingBcs)).purchase_cap?.id !== l.purchase_cap.id, 'HISTORY_REUSED_PURCHASE_CAP')
    // Sui 722 includes a created-and-wrapped UID in changedObjects even when
    // its value is stored inside the newly shared Listing, not standalone.
    const wrapped = change(l.purchase_cap.id)
    check(wrapped.inputState.$kind === 'NotExist' && wrapped.outputState.$kind === 'NotExist'
      && wrapped.idOperation.$kind === 'Created', 'HISTORY_NEW_WRAPPED_CAP')
  }
  const markerId = collectionCommandMarker(p.kioskId, p.rightId, true), markerChange = e.changedObjects.find(([id]) => id === markerId)
  const marker = (row: Awaited<ReturnType<typeof object>>) => {
    const value = decode(CollectionKioskListingFieldBcs, row.bytes)
    check(row.full.owner.ObjectOwner === p.kioskId && value.id === markerId && value.name.id === p.rightId
      && value.name.is_exclusive && value.value === '0', 'HISTORY_RESERVATION'); return value
  }
  if (p.request.action === 'list') {
    marker(await object(markerId, types.marker, 'created'))
  } else if (p.request.action === 'delist') {
    marker(await object(markerId, types.marker, 'input')); const c = change(markerId)
    check(c.outputState.$kind === 'NotExist' && c.idOperation.$kind === 'Deleted', 'HISTORY_RESERVATION_NOT_REMOVED')
  } else if (markerChange) {
    marker(await object(markerId, types.marker, 'input')); marker(await object(markerId, types.marker, 'mutated'))
  }
  // A cancel/relist may minimize an unchanged zero-price child. This is a
  // preservation consequence of the exact approved code, not a claimed new
  // historical version. No unrelated child changes are accepted below.
  const gas = tx.gasData.payment!
  check(e.gasObjectIndex !== null && e.changedObjects[e.gasObjectIndex]?.[0] === gas[0].objectId, 'HISTORY_GAS_INDEX')
  let balance = 0n, finalBalance = 0n
  for (const [index, coin] of gas.entries()) {
    const c = change(coin.objectId), input = c.inputState.Exist
    check(input?.[0][0] === coin.version && input[0][1] === coin.digest && input[1].AddressOwner === p.author, 'HISTORY_GAS_REFERENCE')
    const before = await object(coin.objectId, '0x2::coin::Coin<0x2::sui::SUI>', 'input')
    balance += BigInt(decode(Coin, before.bytes).balance)
    if (index === 0) {
      const after = await object(coin.objectId, '0x2::coin::Coin<0x2::sui::SUI>', 'mutated')
      check(after.full.owner.AddressOwner === p.author, 'HISTORY_GAS_OWNER'); finalBalance = BigInt(decode(Coin, after.bytes).balance)
    } else check(c.idOperation.$kind === 'Deleted' && c.outputState.$kind === 'NotExist', 'HISTORY_GAS_MERGE')
  }
  const charge = BigInt(e.gasUsed.computationCost) + BigInt(e.gasUsed.storageCost) - BigInt(e.gasUsed.storageRebate)
  check(balance - charge === finalBalance, 'HISTORY_GAS_AMOUNT')
  check(e.changedObjects.every(([id]) => allowed.has(id)) && e.unchangedConsensusObjects.every(([id]) => reads.has(id)), 'HISTORY_UNEXPECTED_EFFECT')
  const expectedReads = tx.inputs.flatMap(row => row.Object?.SharedObject && !row.Object.SharedObject.mutable ? [row.Object.SharedObject.objectId] : [])
  check(expectedReads.length === reads.size && expectedReads.every(id => reads.has(id)), 'HISTORY_READ_SET')
  signal.throwIfAborted()
  return { collectionId: p.request.collectionId, rightId: p.rightId, oldListingId: p.oldListingId,
    newListingId, priceAtomic: p.request.priceAtomic }
}
