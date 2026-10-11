import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { SoulPublicBcs, SoulStatePublicBcs, SoulStatePointerKeyV1Bcs, SoulDetailStateBcs,
  SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicListingBcs, CollectionPublicListingBcs,
  CollectionFloorKeyBcs, CollectionFloorValueBcs, CollectionKioskListingKeyBcs, SoulPublicKioskBcs,
  CollectionPersonalKioskCapBcs, KioskItemWrapperBcs, KIOSK_ITEM_WRAPPER_TYPE } from '@soulidity/sdk'
import { historicalObjectOutput } from '../sui/historical-object'
import { createSoulAuthoringMaterializer, resolveSoulAuthoringImage } from './soul-authoring-manifest'
import { proveSoulAuthoringContent, type SoulAuthoringContentEvent } from './soul-authoring-content-history'
import type { SoulAuthoringHistoricalReader } from './soul-authoring-history-read'
import type { SoulAuthoringPreparation } from './soul-authoring-store'
import type { SoulAuthoringKiosk } from './soul-authoring-transaction'
import { soulAuthoringPacketCheck as check } from './soul-authoring-packet'

const A = bcs.Address, U = bcs.u64(), B = bcs.bool()
const Lock = bcs.struct('Lock', { id: A })
const JoinedKey = bcs.struct('JoinedSourceKey', { source_object_id: A })
const RegistrationKey = bcs.struct('PersonalKioskOwnerKey', { owner: A })
const Registration = bcs.struct('PersonalKioskRegistration', { version: U, kiosk_id: A, kiosk_cap_id: A })
const Registry = bcs.struct('KioskRegistry', { id: A, version: U })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function shared(reader: SoulAuthoringHistoricalReader, reference: { owner: { Shared?: { initialSharedVersion: string } } }) {
  check(reference.owner.Shared?.initialSharedVersion === reader.effects.V2!.lamportVersion, 'CREATED_SHARED_BIRTH')
}
export interface SoulAuthoringMintIdentity {
  mintIndex: number; soulId: string; stateId: string; contentId: string; accessListId: string; listingId: string | null
}
export interface SoulAuthoringCollectionIdentity { collectionId: string; rightId: string; listingId: string | null }

/** Semantic output proof used only after the independent full graph and raw
 * finalized events have been authenticated. It cannot itself accept a mint. */
export function createSoulAuthoringOutputProof(input: {
  reader: SoulAuthoringHistoricalReader; preparation: SoulAuthoringPreparation; registeredBlobIds: readonly string[]
}) {
  const reader = input.reader, p = structuredClone(input.preparation), r = p.manifest.request, target = r.target, pkg = target.originalPackageId
  const materialize = createSoulAuthoringMaterializer(p.manifest, p.preparation, [...input.registeredBlobIds])
  async function custody(kioskId: string, assetId: string, locked: boolean) {
    const item = await reader.field(kioskId, KIOSK_ITEM_WRAPPER_TYPE, KioskItemWrapperBcs,
      { name: { id: assetId } }, '0x2::object::ID', A)
    check(item.value === assetId && historicalObjectOutput(reader.effects, assetId).owner.ObjectOwner === item.objectId, 'ASSET_KIOSK_CUSTODY')
    if (locked) check((await reader.field(kioskId, '0x2::kiosk::Lock', Lock, { id: assetId }, 'bool', B)).value, 'ASSET_KIOSK_LOCK')
  }
  async function listing(listingId: string | null, price: string | null, kioskId: string,
    identity: { soulId: string; stateId: string; collectionId: string | null; royalty: number } | { collectionId: string; rightId: string }) {
    check((listingId === null) === (price === null), 'LISTING_PRESENCE')
    if (listingId === null || price === null) return
    const soul = 'soulId' in identity, assetId = soul ? identity.soulId : identity.rightId
    const output = soul ? await reader.read(listingId, `${pkg}::market::SoulListing`, SoulPublicListingBcs)
      : await reader.read(listingId, `${pkg}::market::CollectionListing`, CollectionPublicListingBcs)
    const value = output.value; shared(reader, output.reference)
    check(value.id === listingId && value.version === (soul ? '2' : '1') && value.seller === r.author && value.seller_kiosk_id === kioskId
      && value.price === price && value.is_active && value.purchase_cap?.kiosk_id === kioskId
      && value.purchase_cap.item_id === assetId && value.purchase_cap.min_price === '0', 'CREATED_LISTING')
    if (soul) {
      const s = value as ReturnType<typeof SoulPublicListingBcs.parse>
      check(s.soul_id === identity.soulId && s.state_id === identity.stateId && s.collection_id === identity.collectionId
        && s.creator === r.author && s.creator_royalty_bps === identity.royalty, 'CREATED_SOUL_LISTING')
    } else {
      const c = value as ReturnType<typeof CollectionPublicListingBcs.parse>
      check(c.collection_id === identity.collectionId && c.right_id === identity.rightId, 'CREATED_COLLECTION_LISTING')
    }
    check(/^0x[0-9a-f]{64}$/.test(value.purchase_cap.id) && !/^0x0+$/.test(value.purchase_cap.id)
      && ![listingId, kioskId, assetId].includes(value.purchase_cap.id), 'PURCHASE_CAP_ID')
    const marker = await reader.field(kioskId, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs,
      { id: assetId, is_exclusive: true }, 'u64', U)
    check(marker.value === '0', 'CREATED_LISTING_RESERVATION')
  }
  async function mint(identity: SoulAuthoringMintIdentity, kioskId: string, collectionId: string | null, events: readonly SoulAuthoringContentEvent[]) {
    const m = r.mints[identity.mintIndex], args = materialize(identity.mintIndex)
    check(m && identity.contentId === m.contentObjectId
      && new Set([identity.soulId, identity.stateId, identity.contentId, identity.accessListId]).size === 4, 'MINT_IDENTITY')
    const soul = (await reader.read(identity.soulId, `${pkg}::soul::Soul`, SoulPublicBcs)).value
    const stateOutput = await reader.read(identity.stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs), state = stateOutput.value
    shared(reader, stateOutput.reference)
    check(soul.id === identity.soulId && soul.version === '1' && soul.creator === r.author && soul.name === args.name
      && soul.description === args.description && soul.image_url === args.imageUrl && soul.origin_ref === m.originRef
      && soul.provenance_kind === (m.kind === 'ORDINARY' ? 0 : m.kind === 'IMPORTED' ? 1 : 2), 'MINT_SOUL_METADATA')
    check(state.id === identity.stateId && state.version === '1' && state.soul_id === soul.id && state.creator === r.author
      && state.creator_royalty_bps === m.creatorRoyaltyBps && state.current_owner === r.author && state.current_kiosk_id === kioskId
      && state.ownership_epoch === '0' && state.grant_capacity === '1' && state.active_grants.size === '0'
      && state.active_grant_ids.size === '0' && state.active_grant_count === '0' && state.content_id === identity.contentId
      && state.access_list_id === identity.accessListId && state.collection_id === collectionId
      && state.is_listed === (m.listingPriceAtomic !== null), 'MINT_STATE')
    const pointer = await reader.field(soul.id, `${pkg}::soul::SoulStatePointerKeyV1`, SoulStatePointerKeyV1Bcs, { version: 1 }, '0x2::object::ID', A)
    check(pointer.value === state.id, 'MINT_STATE_POINTER')
    const paidOutput = await reader.read(identity.accessListId, `${pkg}::paid_access::SoulPaidAccessList`, SoulDetailStateBcs.Paid), paid = paidOutput.value
    shared(reader, paidOutput.reference)
    check(paid.id === identity.accessListId && paid.version === '1' && paid.soul_id === soul.id && paid.creator === r.author
      && paid.kind_configs.size === '0' && paid.entries.size === '0', 'MINT_PAID_ACCESS')
    const content = await proveSoulAuthoringContent({ reader, originalPackageId: pkg, soulId: soul.id, contentId: identity.contentId,
      stateConfigTable: state.config_ext, initialContent: args.initialContent, initialStateConfig: args.initialStateConfig, events })
    const ids = [soul.id, state.id, content.id, paid.id, state.active_grants.id, state.active_grant_ids.id,
      state.config_ext.id, paid.kind_configs.id, paid.entries.id, content.items.id, content.count_by_kind.id, content.active.id]
    check(new Set(ids).size === ids.length, 'MINT_ROOT_TABLE_ALIAS')
    await custody(kioskId, soul.id, true)
    if (m.source) {
      // The exact typed source input remains unchanged except its owner/version.
      const rawCodec = { parse: (bytes: Uint8Array) => bytes, serialize: (bytes: Uint8Array) => ({ toBytes: () => bytes }) }
      const before = await reader.input(m.source.objectId, m.source.objectType, rawCodec)
      const after = await reader.read(m.source.objectId, m.source.objectType, rawCodec, 'mutated')
      check(before.raw.owner.AddressOwner === r.author && toBase64(before.value) === toBase64(after.value), 'JOINED_SOURCE_INPUT')
      await custody(kioskId, m.source.objectId, false)
      const marker = await reader.field(target.kioskRegistryId, `${pkg}::market::JoinedSourceKey`, JoinedKey,
        { source_object_id: m.source.objectId }, 'bool', B)
      check(marker.value, 'JOINED_SOURCE_MARKER')
    }
    await listing(identity.listingId, m.listingPriceAtomic, kioskId,
      { soulId: soul.id, stateId: state.id, collectionId, royalty: m.creatorRoyaltyBps })
    return { ...identity, kioskId, collectionId }
  }
  async function collection(identity: SoulAuthoringCollectionIdentity, kioskId: string) {
    const expected = r.collection; check(expected, 'UNEXPECTED_COLLECTION')
    const output = await reader.read(identity.collectionId, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs), c = output.value
    shared(reader, output.reference)
    check(c.id === identity.collectionId && c.version === '1' && c.creator === r.author && c.current_holder === r.author
      && c.current_holder_kiosk_id === kioskId && c.right_id === identity.rightId && c.extra_royalty_bps === expected.extraRoyaltyBps
      && c.tradeable === expected.tradeable && c.max_supply === expected.maxSupply && c.current_supply === '0', 'CREATED_COLLECTION')
    const right = (await reader.read(identity.rightId, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs)).value
    check(right.id === identity.rightId && right.version === '1' && right.collection_id === c.id && right.creator === r.author
      && right.name === expected.name && right.description === expected.description
      && right.image_url === resolveSoulAuthoringImage(expected.image, r, p.preparation), 'CREATED_COLLECTION_RIGHT')
    const floor = await reader.field(c.id, `${pkg}::collection::FloorPolicyKeyV1`, CollectionFloorKeyBcs, { version: 1 }, '0x1::option::Option<u128>', CollectionFloorValueBcs)
    check(floor.value === expected.floorPriceAtomic, 'CREATED_COLLECTION_FLOOR')
    await custody(kioskId, right.id, true)
    await listing(identity.listingId, expected.listingPriceAtomic, kioskId, { collectionId: c.id, rightId: right.id })
    return { ...identity, kioskId }
  }
  async function boundCollection(collectionId: string, mintCount: number) {
    const before = await reader.input(collectionId, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs)
    const after = await reader.read(collectionId, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, 'mutated')
    const b = before.value, a = after.value
    check(before.raw.owner.Shared && same(before.raw.owner, after.reference.owner) && b.id === collectionId && b.version === '1'
      && b.creator === r.author && same({ ...b, current_supply: a.current_supply }, a)
      && BigInt(a.current_supply) === BigInt(b.current_supply) + BigInt(mintCount)
      && (a.max_supply === null || BigInt(a.current_supply) <= BigInt(a.max_supply)), 'BOUND_COLLECTION')
    return { beforeSupply: b.current_supply, afterSupply: a.current_supply, maxSupply: a.max_supply }
  }
  async function kiosk(selected: SoulAuthoringKiosk, kioskId: string, capId: string, addedItems: number, registrationCreated: boolean) {
    check(selected.kind === 'NEW' || selected.kioskId === kioskId && selected.capId === capId, 'KIOSK_SELECTION')
    const isNew = selected.kind === 'NEW'
    const output = await reader.read(kioskId, '0x2::kiosk::Kiosk', SoulPublicKioskBcs, isNew ? 'created' : 'mutated'), k = output.value
    check(k.id === kioskId && k.owner === r.author && output.reference.owner.Shared, 'KIOSK_OWNER')
    const capType = `${target.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`
    if (isNew) {
      shared(reader, output.reference)
      check(k.item_count === addedItems && k.profits === '0', 'NEW_KIOSK_CONTENTS')
      const cap = await reader.read(capId, capType, CollectionPersonalKioskCapBcs)
      check(cap.reference.owner.AddressOwner === r.author && cap.value.id === capId && cap.value.cap?.for === kioskId, 'NEW_KIOSK_CAP')
    } else {
      const before = await reader.input(kioskId, '0x2::kiosk::Kiosk', SoulPublicKioskBcs)
      check(before.raw.owner.Shared && same(before.raw.owner, output.reference.owner)
        && k.item_count === before.value.item_count + addedItems && same({ ...before.value, item_count: k.item_count }, k), 'KIOSK_CHANGE')
      const cap = await reader.input(capId, capType, CollectionPersonalKioskCapBcs)
      check(cap.raw.owner.AddressOwner === r.author && cap.value.id === capId && cap.value.cap?.for === kioskId, 'EXISTING_KIOSK_CAP')
      if (reader.effects.V2!.changedObjects.some(([id]) => id === capId)) {
        const after = await reader.read(capId, capType, CollectionPersonalKioskCapBcs, 'mutated')
        check(after.reference.owner.AddressOwner === r.author && same(after.value, cap.value), 'KIOSK_CAP_CHANGE')
      }
    }
    check(!isNew || registrationCreated, 'NEW_KIOSK_REGISTRATION_REQUIRED')
    if (registrationCreated) {
      const registration = await reader.field(target.kioskRegistryId, `${pkg}::market::PersonalKioskOwnerKey`, RegistrationKey,
        { owner: r.author }, `${pkg}::market::PersonalKioskRegistration`, Registration)
      check(registration.value.version === '1' && registration.value.kiosk_id === kioskId && registration.value.kiosk_cap_id === capId, 'NEW_KIOSK_REGISTRATION')
    }
    const registry = await reader.read(target.kioskRegistryId, `${pkg}::market::KioskRegistry`, Registry, 'mutated')
    const beforeRegistry = await reader.input(target.kioskRegistryId, `${pkg}::market::KioskRegistry`, Registry)
    check(registry.value.id === target.kioskRegistryId && registry.value.version === '1'
      && beforeRegistry.raw.owner.Shared && same(beforeRegistry.raw.owner, registry.reference.owner)
      && same(registry.value, beforeRegistry.value), 'KIOSK_REGISTRY_CHANGE')
    return { kioskId, capId }
  }
  return { mint, collection, boundCollection, kiosk }
}
