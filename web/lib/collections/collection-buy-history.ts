import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  CollectionKioskRegistryBcs, CollectionPublicListingBcs, CollectionKioskListingFieldBcs, CollectionPersonalKioskCapBcs,
  CollectionKioskRegistrationFieldBcs, deriveKioskItemFieldId, assertKioskItemField } from '@soulidity/sdk'
import { historicalObjectOutput } from '../sui/historical-object'
import { collectionCommandHash, collectionCommandRaw, collectionCommandMarker, collectionCommandRegistration } from './collection-command-plan'
import { collectionCommandProjection } from './collection-command-state'
import { CollectionCommandEventsBcs } from './collection-command-history'
import { check, id, uint, same, decode, collectionBuyTypes, collectionBuyLock, collectionBuyOwnerMarker,
  CollectionBuyCoinBcs as Coin, CollectionBuyLockBcs, CollectionBuyOwnerMarkerBcs,
  type CollectionBuyRecord, type CollectionBuyQuery } from './collection-buy-plan'

const A = bcs.Address
export const CollectionBuyPurchasedBcs = bcs.struct('CollectionPurchased', { listing_id: A, collection_id: A, right_id: A,
  seller: A, buyer: A, price: bcs.u64(), platform_fee: bcs.u64() })
export const CollectionBuyRegistrationEventBcs = bcs.struct('PersonalKioskRegistrationUpdated', { kiosk_id: A, kiosk_cap_id: A, owner: A })
const NewKiosk = bcs.struct('NewPersonalKiosk', { kiosk_id: A })
type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Owner = ReturnType<typeof bcs.Owner.parse>

/** Canonical trusted-ledger historical proof. Later current price, holder,
 * kiosk, policy and wallet state never replace execution evidence. */
export async function proveCollectionBuyHistory(params: { client: SuiGrpcClient; record: CollectionBuyRecord;
  effects: Effects; events: Uint8Array; signal: AbortSignal }): Promise<NonNullable<CollectionBuyQuery['receipt']>> {
  const { client, signal } = params, r = structuredClone(params.record), effects = structuredClone(params.effects), e = effects.V2, p = r.plan
  check(e && e.status.$kind === 'Success' && e.transactionDigest === r.packet.digest, 'HISTORY_EFFECTS')
  uint(e.lamportVersion, true)
  check(e.changedObjects.length <= 512 && e.unchangedConsensusObjects.length <= 32
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length, 'HISTORY_DUPLICATES')
  const bytes = new Uint8Array(params.events)
  check(bytes.length > 0 && bytes.length <= 65536 && e.eventsDigest === collectionCommandHash('TransactionEvents', bytes), 'HISTORY_EVENTS_DIGEST')
  const events = decode(CollectionCommandEventsBcs, bytes), creating = p.buyerKiosk.kind === 'NEW'
  check(events.length === (creating ? 3 : 1), 'HISTORY_EVENT_COUNT')
  function event(index: number, module: string, name: string, kiosk = false) {
    const v = events[index]
    check(v.package_id === (kiosk ? p.target.kioskPackageId : p.target.callablePackageId) && v.transaction_module === module && v.sender === p.author
      && normalizeStructTag(TypeTagSerializer.tagToString({ struct: v.type_ })) === `${kiosk ? p.target.personalKioskTypePackageId : p.target.originalPackageId}::${module}::${name}`, 'HISTORY_EVENT_TYPE')
    return v.contents
  }
  let buyerKioskId = p.buyerKiosk.kioskId!, buyerKioskCapId = p.buyerKiosk.capId!
  if (creating) {
    const created = decode(NewKiosk, event(0, 'personal_kiosk', 'NewPersonalKiosk', true))
    const reg = decode(CollectionBuyRegistrationEventBcs, event(1, 'market', 'PersonalKioskRegistrationUpdated'))
    id(created.kiosk_id); id(reg.kiosk_cap_id)
    check(created.kiosk_id === reg.kiosk_id && reg.owner === p.author, 'HISTORY_NEW_REGISTRATION_EVENT')
    buyerKioskId = reg.kiosk_id; buyerKioskCapId = reg.kiosk_cap_id
    check(buyerKioskId !== buyerKioskCapId && [buyerKioskId, buyerKioskCapId].every(id => !p.objects.some(row => row.objectId === id) && !p.absentIds.includes(id)), 'HISTORY_CREATED_ALIAS')
  }
  check(same(decode(CollectionBuyPurchasedBcs, event(creating ? 2 : 0, 'market', 'CollectionPurchased')), {
    listing_id: p.request.listingId, collection_id: p.request.collectionId, right_id: p.rightId,
    seller: p.sellerAddress, buyer: p.author, price: p.quote.priceAtomic, platform_fee: p.quote.feeAtomic }), 'HISTORY_PURCHASE_EVENT')
  // Re-attest imported raw package/type origins against the ledger at their
  // immutable stored versions; self-consistent caller-supplied hashes are not
  // independent chain evidence. Never replace these with current package reads.
  for (const objectId of [p.target.callablePackageId, p.target.kioskPackageId]) {
    const expected = p.objects.find(row => row.objectId === objectId)!
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: BigInt(expected.version),
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    check(same(collectionCommandProjection(response.object), expected), 'HISTORY_PACKAGE_EVIDENCE')
  }
  const tx = Transaction.from(fromBase64(r.packet.bytes)).getData(), types = collectionBuyTypes(p.target)
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

  async function frozenInput(objectId: string, type: string, expected: string) {
    const value = await object(objectId, type, 'input'); check(toBase64(value.bytes) === expected, 'HISTORY_FROZEN_INPUT'); return value
  }
  const root = await frozenInput(p.request.collectionId, types.collection, p.expected.collectionBcs)
  const collection = decode(SoulPublicCollectionBcs, root.bytes)
  const finalRoot = await object(p.request.collectionId, types.collection, 'mutated')
  check(same(decode(SoulPublicCollectionBcs, finalRoot.bytes), { ...collection, current_holder: p.author, current_holder_kiosk_id: buyerKioskId }), 'HISTORY_ROOT_TRANSFER')
  const market = decode(SoulPublicMarketConfigBcs, (await frozenRoot(p.target.marketConfigId, types.market, p.expected.marketBcs)).bytes)
  await frozenRoot(p.target.collectionTransferPolicyId, types.policy, p.expected.policyBcs)
  const listingBefore = await frozenInput(p.request.listingId, types.listing, p.expected.listingBcs)
  const listing = decode(CollectionPublicListingBcs, listingBefore.bytes)
  check(same(decode(CollectionPublicListingBcs, (await object(p.request.listingId, types.listing, 'mutated')).bytes), {
    ...listing, is_active: false, purchase_cap: null }), 'HISTORY_LISTING_CONSUMED')
  check(listing.purchase_cap, 'HISTORY_PURCHASE_CAP_REQUIRED')
  // Sui 722 commits deleted wrapped UIDs even without a standalone input.
  // The UID is anchored in the exact historical listing, not a free allowance.
  const capDeletion = change(listing.purchase_cap.id)
  check(capDeletion.outputState.$kind === 'NotExist' && capDeletion.idOperation.$kind === 'Deleted'
    && capDeletion.inputState.$kind === 'NotExist', 'HISTORY_PURCHASE_CAP_DELETION')
  const sellerBefore = await object(p.sellerKioskId, types.kiosk, 'input'), sellerAfter = await object(p.sellerKioskId, types.kiosk, 'mutated')
  const seller = decode(SoulPublicKioskBcs, sellerBefore.bytes)
  check(seller.owner === p.sellerAddress && seller.item_count > 0
    && same(decode(SoulPublicKioskBcs, sellerAfter.bytes), { ...seller, item_count: seller.item_count - 1 }), 'HISTORY_SELLER_KIOSK')
  const registryBefore = await object(p.target.kioskRegistryId, types.registry, 'input'), registryAfter = await object(p.target.kioskRegistryId, types.registry, 'mutated')
  check(decode(CollectionKioskRegistryBcs, registryBefore.bytes).version === '1'
    && toBase64(registryBefore.bytes) === toBase64(registryAfter.bytes), 'HISTORY_REGISTRY')
  const buyerAfter = await object(buyerKioskId, types.kiosk, creating ? 'created' : 'mutated')
  const buyer = decode(SoulPublicKioskBcs, buyerAfter.bytes)
  check(buyer.owner === p.author, 'HISTORY_BUYER_KIOSK_OWNER')
  if (creating) {
    check(buyerAfter.full.owner.Shared?.initialSharedVersion === e.lamportVersion && buyer.item_count === 1 && buyer.profits === '0' && buyer.allow_extensions, 'HISTORY_NEW_KIOSK')
    const cap = await object(buyerKioskCapId, types.cap, 'created'), value = decode(CollectionPersonalKioskCapBcs, cap.bytes)
    check(cap.full.owner.AddressOwner === p.author && value.cap && value.cap.for === buyerKioskId
      && value.cap.id !== buyerKioskId && value.cap.id !== buyerKioskCapId && value.cap.id !== listing.purchase_cap.id
      && !p.objects.some(row => row.objectId === value.cap!.id) && !p.absentIds.includes(value.cap.id), 'HISTORY_NEW_CAP')
    id(value.cap.id)
    // kiosk::new creates this UID and personal_kiosk::new wraps it in the
    // new PersonalKioskCap. Created-and-wrapped remains an effects row.
    const wrappedCap = change(value.cap.id)
    check(wrappedCap.inputState.$kind === 'NotExist' && wrappedCap.outputState.$kind === 'NotExist'
      && wrappedCap.idOperation.$kind === 'Created', 'HISTORY_NEW_WRAPPED_CAP')
    const regId = collectionCommandRegistration(p.target, p.author), reg = await object(regId, types.registration, 'created')
    check(reg.full.owner.ObjectOwner === p.target.kioskRegistryId && same(decode(CollectionKioskRegistrationFieldBcs, reg.bytes), {
      id: regId, name: { owner: p.author }, value: { version: '1', kiosk_id: buyerKioskId, kiosk_cap_id: buyerKioskCapId } }), 'HISTORY_NEW_REGISTRATION')
    const markerId = collectionBuyOwnerMarker(p.target, buyerKioskId), marker = await object(markerId, types.ownerMarker, 'created')
    check(marker.full.owner.ObjectOwner === buyerKioskId && same(decode(CollectionBuyOwnerMarkerBcs, marker.bytes), {
      id: markerId, name: { dummy_field: false }, value: p.author }), 'HISTORY_NEW_PERSONAL_MARKER')
  } else {
    const before = decode(SoulPublicKioskBcs, (await object(buyerKioskId, types.kiosk, 'input')).bytes)
    check(before.owner === p.author && before.item_count < 4294967295 && same(buyer, { ...before, item_count: before.item_count + 1 }), 'HISTORY_BUYER_KIOSK')
    const cap = await object(buyerKioskCapId, types.cap, 'owned-input'), value = decode(CollectionPersonalKioskCapBcs, cap.bytes)
    check(cap.full.owner.AddressOwner === p.author && value.cap?.for === buyerKioskId
      && toBase64(cap.bytes) === toBase64(collectionCommandRaw(p.objects.find(row => row.objectId === buyerKioskCapId)!).data.Move!.contents)
      && !e.changedObjects.some(([id]) => id === buyerKioskCapId), 'HISTORY_CAP_PRESERVATION')
    check(value.cap && !e.changedObjects.some(([id]) => id === value.cap!.id), 'HISTORY_WRAPPED_CAP_PRESERVATION')
  }
  function removed(objectId: string) { const c = change(objectId); check(c.idOperation.$kind === 'Deleted' && c.outputState.$kind === 'NotExist', 'HISTORY_CHILD_NOT_REMOVED') }
  const markerId = collectionCommandMarker(p.sellerKioskId, p.rightId, true), marker = await object(markerId, types.marker, 'input')
  check(marker.full.owner.ObjectOwner === p.sellerKioskId && same(decode(CollectionKioskListingFieldBcs, marker.bytes), {
    id: markerId, name: { id: p.rightId, is_exclusive: true }, value: '0' }), 'HISTORY_RESERVATION')
  removed(markerId)
  const sourceItem = deriveKioskItemFieldId(p.sellerKioskId, p.rightId), destinationItem = deriveKioskItemFieldId(buyerKioskId, p.rightId)
  const source = await object(sourceItem, types.item, 'input'), destination = await object(destinationItem, types.item, 'created')
  check(source.full.owner.ObjectOwner === p.sellerKioskId && destination.full.owner.ObjectOwner === buyerKioskId, 'HISTORY_ITEM_OWNER')
  assertKioskItemField(source.bytes, p.sellerKioskId, p.rightId); assertKioskItemField(destination.bytes, buyerKioskId, p.rightId); removed(sourceItem)
  const rightBefore = await frozenInput(p.rightId, types.right, p.expected.rightBcs), rightAfter = await object(p.rightId, types.right, 'mutated')
  check(rightBefore.full.owner.ObjectOwner === sourceItem && rightAfter.full.owner.ObjectOwner === destinationItem
    && toBase64(rightBefore.bytes) === toBase64(rightAfter.bytes)
    && decode(SoulPublicCollectionRightBcs, rightAfter.bytes).collection_id === p.request.collectionId, 'HISTORY_RIGHT_TRANSFER')
  const sourceLock = collectionBuyLock(p.sellerKioskId, p.rightId)
  if (e.changedObjects.some(([id]) => id === sourceLock)) {
    const lock = await object(sourceLock, types.lock, 'input')
    check(lock.full.owner.ObjectOwner === p.sellerKioskId && same(decode(CollectionBuyLockBcs, lock.bytes), {
      id: sourceLock, name: { id: p.rightId }, value: true }), 'HISTORY_SOURCE_LOCK'); removed(sourceLock)
  } else check(p.absentIds.includes(sourceLock), 'HISTORY_SOURCE_LOCK_REQUIRED')
  const destLock = collectionBuyLock(buyerKioskId, p.rightId), lock = await object(destLock, types.lock, 'created')
  check(lock.full.owner.ObjectOwner === buyerKioskId && same(decode(CollectionBuyLockBcs, lock.bytes), {
    id: destLock, name: { id: p.rightId }, value: true }), 'HISTORY_DESTINATION_LOCK')
  let paymentBefore = 0n, paymentAfter = 0n
  for (const [index, coinId] of p.paymentCoinIds.entries()) {
    const ref = p.objects.find(row => row.objectId === coinId)!, c = change(coinId), input = c.inputState.Exist
    check(input?.[0][0] === ref.version && input[0][1] === ref.digest && input[1].AddressOwner === p.author, 'HISTORY_PAYMENT_REFERENCE')
    const before = await object(coinId, types.coin, 'input'); paymentBefore += BigInt(decode(Coin, before.bytes).balance)
    if (index === 0) { const after = await object(coinId, types.coin, 'mutated'); check(after.full.owner.AddressOwner === p.author, 'HISTORY_CHANGE_OWNER'); paymentAfter = BigInt(decode(Coin, after.bytes).balance) }
    else removed(coinId)
  }
  check(paymentBefore - BigInt(p.quote.buyerTotalAtomic) === paymentAfter, 'HISTORY_PAYMENT_AMOUNT')
  const payouts = [{ owner: p.sellerAddress, amount: p.quote.priceAtomic },
    ...(BigInt(p.quote.feeAtomic) > 0n ? [{ owner: market.fee_recipient, amount: p.quote.feeAtomic }] : [])]
  const gasIds = new Set(tx.gasData.payment!.map(row => row.objectId))
  const payoutIds = e.changedObjects.filter(([id, c]) => !allowed.has(id) && !gasIds.has(id) && c.idOperation.$kind === 'Created' && c.outputState.ObjectWrite?.[1].AddressOwner)
  check(payoutIds.length === payouts.length, 'HISTORY_PAYOUT_COUNT')
  for (const [coinId] of payoutIds) {
    const coin = await object(coinId, types.coin, 'created'), amount = decode(Coin, coin.bytes).balance
    const index = payouts.findIndex(row => row.owner === coin.full.owner.AddressOwner && row.amount === amount)
    check(index >= 0, 'HISTORY_PAYOUT'); payouts.splice(index, 1)
  }
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
  return { collectionId: p.request.collectionId, rightId: p.rightId, listingId: p.request.listingId,
    sellerAddress: p.sellerAddress, buyerAddress: p.author, buyerKioskId, buyerKioskCapId,
    priceAtomic: p.quote.priceAtomic, platformFeeAtomic: p.quote.feeAtomic, totalPaymentAtomic: p.quote.buyerTotalAtomic }
}
