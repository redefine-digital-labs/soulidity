import { vi } from 'vitest'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { SoulPublicListingBcs, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs,
  CollectionFloorKeyBcs, CollectionFloorFieldBcs, deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'
import { browserSoulDetailFixture, createBrowserSoulDetailModel, detailId as id, detailDigest } from './browser-soul-detail-fixture'
export { id, detailDigest }
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject }
}
/** Actual raw browser-detail graph with only gRPC/GraphQL transport controlled. */
export function marketSoulRawFixture(listed = true) {
  const f = browserSoulDetailFixture(listed), lifetime = new AbortController(), pkg = f.config.native.soulidityOriginalPackageId
  const listingPages: string[][] = [listed ? [f.listing.id] : []], soulPages: string[][] = [[f.state.id]]
  const checkpoints = { listings: 100, souls: 101 }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const request = JSON.parse(String(options?.body)), listing = request.variables.filter.type === `${pkg}::market::SoulListing`
    const pages = listing ? listingPages : soulPages, index = request.variables.after === null ? 0 : Number(request.variables.after.slice(1))
    const ids = pages[index] ?? [], checkpoint = listing ? checkpoints.listings : checkpoints.souls
    return new Response(JSON.stringify({ data: { chainIdentifier: detailDigest, checkpoint: { sequenceNumber: checkpoint,
      query: { objects: { nodes: ids.map(address => ({ address })), pageInfo: {
        hasNextPage: index + 1 < pages.length, endCursor: ids.length ? `c${index + 1}` : null } } } } } }))
  })
  function putListing(value = f.listing) { f.put(value.id, `${pkg}::market::SoulListing`, SoulPublicListingBcs.serialize(value).toBytes()) }
  function collection(collectionId = id(200), floor: string | null = '2000000') {
    Object.assign(f.state, { collection_id: collectionId }); Object.assign(f.listing, { collection_id: collectionId }); f.putState(); putListing()
    const value = { id: collectionId, version: '1', creator: f.state.creator, extra_royalty_bps: 500, tradeable: true,
      current_holder: id(204), current_holder_kiosk_id: id(203), right_id: id(205), max_supply: '18446744073709551615', current_supply: '1' }
    const right = { id: value.right_id, version: '1', collection_id: collectionId, creator: f.state.creator,
      name: 'Raw member Collection', description: 'Current holder is not its creator', image_url: '' }
    f.put(collectionId, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs.serialize(value).toBytes())
    f.put(value.current_holder_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: value.current_holder_kiosk_id,
      profits: '0', owner: value.current_holder, item_count: 1, allow_extensions: true }).toBytes())
    const fieldId = deriveKioskItemFieldId(value.current_holder_kiosk_id, right.id)
    f.put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: right.id } }, value: right.id }).toBytes(),
      { kind: 2, address: value.current_holder_kiosk_id })
    f.put(right.id, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs.serialize(right).toBytes(), { kind: 2, address: fieldId })
    const keyType = `${pkg}::collection::FloorPolicyKeyV1`, floorId = deriveDynamicFieldID(collectionId, keyType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
    f.put(floorId, `0x2::dynamic_field::Field<${keyType},0x1::option::Option<u128>>`,
      CollectionFloorFieldBcs.serialize({ id: floorId, name: { version: 1 }, value: floor }).toBytes(), { kind: 2, address: collectionId })
    return { value, right, fieldId, floorId }
  }
  return { ...f, lifetime, listingPages, soulPages, checkpoints, fetcher, putListing, collection,
    params: { client: f.client, config: f.config, viewerAddress: null as string | null, signal: lifetime.signal } }
}
/** Lightweight page orchestration fixtures. The separate raw cases above run
 * the real asset/detail/custody/listing composition, not these two callbacks. */
export async function marketSoulPageFixture(count = 1) {
  const f = marketSoulRawFixture(), model = await createBrowserSoulDetailModel(), viewer = model.input.asset.currentOwner
  const assets = Array.from({ length: count }, (_, i) => ({ ...structuredClone(model.input.asset), soulId: id(1000 + i), stateId: id(2000 + i) }))
  const details = assets.map(asset => ({ ...structuredClone(model.compose()), onChainId: asset.soulId, stateOnChainId: asset.stateId,
    viewerAddress: viewer, isOwner: true, isCreator: viewer === asset.creator }))
  f.listingPages.splice(0, 1, []); f.soulPages.splice(0, 1, assets.map(asset => asset.stateId)); f.params.viewerAddress = viewer
  const asset = vi.fn(async ({ stateId }: { stateId: string }) => {
    const value = assets.find(row => row.stateId === stateId); if (!value) throw new Error('fixture state missing'); return structuredClone(value)
  })
  const detail = vi.fn(async ({ soulId }: { soulId: string }) => {
    const value = details[assets.findIndex(row => row.soulId === soulId)]; if (!value) throw new Error('fixture detail missing'); return structuredClone(value)
  })
  return { ...f, assets, details, asset, detail, dependencies: { fetch: f.fetcher, asset, detail } }
}
