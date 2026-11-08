import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { assertKioskItemField, CollectionKioskListingFieldBcs, CollectionKioskRegistrationFieldBcs,
  CollectionKioskRegistryBcs, CollectionPersonalKioskCapBcs, deriveKioskItemFieldId,
  SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs } from '@soulidity/sdk'
import { collectionBuyLock, CollectionBuyLockBcs, collectionBuyOwnerMarker, CollectionBuyOwnerMarkerBcs,
  collectionBuyRawType, collectionBuyTypes, parseCollectionBuyTarget, type CollectionBuyPlan, type CollectionBuyQuery } from './collection-buy-plan'
import { check, collectionCommandMarker, collectionCommandRaw, collectionCommandRegistration, decode, id, same } from './collection-command-plan'
import { collectionCommandChain, collectionCommandReadSet, collectionCommandSignal } from './collection-command-state'

/** Current custody of a confirmed original, independently of market state.
 * Bounded stable object observations are not signing authorization. */
export async function readCollectionBuyHandoff({ client, plan, receipt: input, signal: parent }: {
  client: SuiGrpcClient; plan: CollectionBuyPlan; receipt: NonNullable<CollectionBuyQuery['receipt']>; signal?: AbortSignal
}) {
  const target = parseCollectionBuyTarget(plan.target), receipt = structuredClone(input)
  const { collectionId, rightId, buyerAddress, buyerKioskId, buyerKioskCapId } = receipt
  const sellerKioskId = plan.sellerKioskId
  for (const value of [collectionId, rightId, buyerAddress, buyerKioskId, buyerKioskCapId, sellerKioskId]) id(value)
  check(collectionId === plan.request.collectionId && rightId === plan.rightId && buyerAddress === plan.author
    && receipt.sellerAddress === plan.sellerAddress && buyerAddress !== receipt.sellerAddress && receipt.listingId === plan.request.listingId
    && new Set([collectionId, rightId, buyerKioskId, buyerKioskCapId, sellerKioskId]).size === 5
    && (plan.buyerKiosk.kind === 'NEW' || buyerKioskId === plan.buyerKiosk.kioskId && buyerKioskCapId === plan.buyerKiosk.capId), 'HANDOFF_RECEIPT')

  const signal = collectionCommandSignal(parent), types = collectionBuyTypes(target)
  const { read, verify } = collectionCommandReadSet(client, signal)
  const chain = await collectionCommandChain(client, target, signal)
  if (target.chainIdentifier === '35834a8a') check(chain === MAINNET_GENESIS_DIGEST, 'HANDOFF_WRONG_MAINNET')
  async function move(objectId: string, type: string, ownerKind: 'Shared' | 'ObjectOwner' | 'AddressOwner', owner?: string) {
    const row = await read(objectId)
    check(row, 'HANDOFF_OBJECT')
    const raw = collectionCommandRaw(row)
    check(raw.data.Move && collectionBuyRawType(raw) === normalizeStructTag(type) && raw.owner.$kind === ownerKind
      && (owner === undefined || raw.owner.ObjectOwner === owner || raw.owner.AddressOwner === owner), 'HANDOFF_OBJECT_TYPE_OWNER')
    return raw.data.Move.contents
  }
  const packageRow = await read(target.callablePackageId)
  check(packageRow?.digest === target.callableDigest, 'HANDOFF_PACKAGE')
  const packageRaw = collectionCommandRaw(packageRow), pkg = packageRaw.data.Package
  check(packageRaw.owner.$kind === 'Immutable' && pkg, 'HANDOFF_PACKAGE')
  for (const [module, name] of [['collection', 'SoulCollection'], ['collection', 'SoulCollectionRight'],
    ['market', 'KioskRegistry'], ['market', 'PersonalKioskRegistration'], ['market', 'PersonalKioskOwnerKey']]) {
    const origins = pkg.typeOriginTable.filter(row => row.moduleName === module && row.datatypeName === name)
    check(origins.length === 1 && origins[0].package === target.originalPackageId && pkg.moduleMap.has(module), 'HANDOFF_TYPE_ORIGIN')
  }

  const collection = decode(SoulPublicCollectionBcs, await move(collectionId, types.collection, 'Shared'))
  const holder = collection.current_holder, kioskId = collection.current_holder_kiosk_id
  id(holder); id(kioskId); id(collection.creator)
  check(collection.id === collectionId && collection.version === '1' && collection.right_id === rightId
    && new Set([collectionId, rightId, kioskId]).size === 3, 'HANDOFF_COLLECTION')
  const item = deriveKioskItemFieldId(kioskId, rightId)
  assertKioskItemField(await move(item, types.item, 'ObjectOwner', kioskId), kioskId, rightId)
  const right = decode(SoulPublicCollectionRightBcs, await move(rightId, types.right, 'ObjectOwner', item))
  check(right.id === rightId && right.version === '1' && right.collection_id === collectionId
    && right.creator === collection.creator, 'HANDOFF_RIGHT')
  const kiosk = decode(SoulPublicKioskBcs, await move(kioskId, types.kiosk, 'Shared'))
  check(kiosk.id === kioskId && kiosk.owner === holder && kiosk.item_count > 0, 'HANDOFF_KIOSK')
  if (holder !== buyerAddress || kioskId !== buyerKioskId) {
    await verify()
    return { status: 'CUSTODY_CHANGED' as const, holder, kioskId, rightId }
  }

  const lockId = collectionBuyLock(kioskId, rightId)
  const lock = decode(CollectionBuyLockBcs, await move(lockId, types.lock, 'ObjectOwner', kioskId))
  check(same(lock, { id: lockId, name: { id: rightId }, value: true }), 'HANDOFF_LOCK')
  const registry = decode(CollectionKioskRegistryBcs, await move(target.kioskRegistryId, types.registry, 'Shared'))
  check(registry.id === target.kioskRegistryId && registry.version === '1', 'HANDOFF_REGISTRY')
  const registrationId = collectionCommandRegistration(target, buyerAddress)
  const registration = decode(CollectionKioskRegistrationFieldBcs, await move(registrationId, types.registration, 'ObjectOwner', registry.id))
  check(registration.id === registrationId && registration.name.owner === buyerAddress && registration.value.version === '1'
    && registration.value.kiosk_id === kioskId && registration.value.kiosk_cap_id === buyerKioskCapId, 'HANDOFF_REGISTRATION')
  const cap = decode(CollectionPersonalKioskCapBcs, await move(buyerKioskCapId, types.cap, 'AddressOwner', buyerAddress))
  check(cap.id === buyerKioskCapId && cap.cap?.for === kioskId
    && ![buyerKioskCapId, kioskId, collectionId, rightId].includes(cap.cap.id), 'HANDOFF_CAP')
  id(cap.cap.id)
  const ownerMarkerId = collectionBuyOwnerMarker(target, kioskId)
  const ownerMarker = decode(CollectionBuyOwnerMarkerBcs, await move(ownerMarkerId, types.ownerMarker, 'ObjectOwner', kioskId))
  check(same(ownerMarker, { id: ownerMarkerId, name: { dummy_field: false }, value: buyerAddress }), 'HANDOFF_PERSONAL_KIOSK')

  let reserved = false
  for (const exclusive of [false, true]) {
    const markerId = collectionCommandMarker(kioskId, rightId, exclusive)
    const markerRow = await read(markerId, true)
    if (!markerRow) continue
    const raw = collectionCommandRaw(markerRow)
    check(raw.data.Move && collectionBuyRawType(raw) === types.marker && raw.owner.ObjectOwner === kioskId, 'HANDOFF_MARKER_OWNER')
    const marker = decode(CollectionKioskListingFieldBcs, raw.data.Move.contents)
    check(marker.id === markerId && marker.name.id === rightId && marker.name.is_exclusive === exclusive, 'HANDOFF_MARKER')
    reserved = true
  }
  const formerIds = [deriveKioskItemFieldId(sellerKioskId, rightId), collectionBuyLock(sellerKioskId, rightId),
    collectionCommandMarker(sellerKioskId, rightId, false), collectionCommandMarker(sellerKioskId, rightId, true)]
  for (const objectId of formerIds) check(await read(objectId, true) === null, 'HANDOFF_FORMER_KIOSK')
  await verify()
  return { status: 'BUYER_HANDOFF_VERIFIED' as const, holder, kioskId, rightId, kioskCapId: buyerKioskCapId, lockId,
    reserved, formerKioskId: sellerKioskId, formerKioskCustodyAndReservationsAbsent: true as const }
}
