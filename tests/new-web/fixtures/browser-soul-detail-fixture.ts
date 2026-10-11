import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../../packages/soulidity-sdk/src/kiosk-item-custody'
import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SoulPublicBcs, SoulStatePublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs,
  SoulStatePointerFieldV1Bcs, SoulStatePointerKeyV1Bcs } from '../../../packages/soulidity-sdk/src/soul-public-read'
import { SoulDetailStateBcs as D } from '../../../packages/soulidity-sdk/src/soul-detail-state'
import { SoulPublicKioskBcs, SoulPublicListingBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '../../../packages/soulidity-sdk/src/soul-public-listing'
import { buildSoulPublicPreviewStateConfig } from '../../../packages/soulidity-sdk/src/soul-public-preview'
import type { BrowserSoulDetailConfig } from '../../../web/lib/soulidity/browser-soul-detail'
import { readSoulPublicSnapshotBySoulId } from '../../../packages/soulidity-sdk/src/soul-public-read'
import { readSoulDetailState } from '../../../packages/soulidity-sdk/src/soul-detail-state'
import { readSoulPublicListing } from '../../../packages/soulidity-sdk/src/soul-public-listing'
import { composeChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'

export const detailId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const detailDigest = toBase58(new Uint8Array(32).fill(1))
const A = bcs.Address, N = bcs.u32(), U = bcs.u64(), S = bcs.string(), V = bcs.vector(bcs.u8())

/** One connected ordinary Soul graph. Only actual SDK transport methods are
 * stubbed; every production reader parses/validates the real wire BCS itself. */
export function browserSoulDetailFixture(listed = true, owner = detailId(5)) {
  const id = detailId, pkg = id(1), digest = detailDigest
  const state = { id: id(2), version: '1', soul_id: id(3), creator: id(4), creator_royalty_bps: 500,
    current_owner: owner, current_kiosk_id: id(7), ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: id(8), size: '1' }, active_grant_ids: { id: id(9), size: '1' }, active_grant_count: '1',
    content_id: id(17), config_ext: { id: id(11), size: '2' }, collection_id: null, access_list_id: id(12), is_listed: listed }
  const soul = { id: id(3), version: '1', name: 'Ordinary Soul', description: 'Raw chain description', image_url: '', provenance_kind: 1, origin_ref: null, creator: id(4) }
  const content = { id: id(17), version: '1', soul_id: id(3), items: { id: id(13), size: '3' },
    count_by_kind: { id: id(14), size: '3' }, active: { id: id(15), size: '1' } }
  const registry = { id: id(30), version: '1', next_kind: 16, kinds: { id: id(31), size: '3' }, name_to_kind: { id: id(32), size: '3' } }
  const slots = [0, 1, 3].map(kind => ({ version: '1', kind, blob_object_id: id(22 + kind), is_public: false,
    deleted: false, purged: false, download_policy: kind === 3 ? 1 : 0, grant_scope_mask: kind === 3 ? '8' : kind === 1 ? '2' : '1',
    read_mode_mask: kind === 3 ? '7' : '3', op_mask: kind === 3 ? '15' : kind === 1 ? '7' : '0', seal_encrypted: true, created_at_ms: '123' }))
  const grantSlot = { version: '1', grant_id: id(50), grantee: id(51), scope_mask: '9', expires_at_ms: '2000' as string | null, ownership_epoch_snapshot: '2' }
  const grant = { id: id(50), version: '1', soul_id: id(3), grantee: id(51), issued_by: owner,
    ownership_epoch_snapshot: '2', scope_mask: '9', expires_at_ms: '2000' as string | null }
  const paid = { id: id(12), version: '1', soul_id: id(3), creator: id(4), kind_configs: { id: id(60), size: '1' }, entries: { id: id(61), size: '1' } }
  const paidConfig = { version: '1', price_atomic: '9007199254740993', scope_mask: '8', duration_ms: '0' as string | null, ownership_epoch_snapshot: '2' }
  const entry = { version: '1', scope_mask: '8', expires_at_ms: '2000' as string | null, ownership_epoch_snapshot: '2' }
  const listing = { id: id(70), version: '2', soul_id: soul.id, state_id: state.id, seller: state.current_owner,
    seller_kiosk_id: state.current_kiosk_id, price: '1000000', creator: state.creator, creator_royalty_bps: 500,
    collection_id: null, purchase_cap: { id: id(71), kiosk_id: state.current_kiosk_id, item_id: soul.id, min_price: '0' }, is_active: true }
  const config: BrowserSoulDetailConfig = { native: { protocolConfigId: id(80), coreOriginalPackageId: id(81), outputOriginalPackageId: id(82),
    outputCallablePackageId: id(83), soulidityCallablePackageId: id(84), soulidityOriginalPackageId: pkg,
    outputCallableDigest: digest, soulidityCallableDigest: digest, expectedNativeBinding: {
      soulOriginalType: `${pkg}::soul::Soul`, soulDefiningType: `${pkg}::soul::Soul`,
      mintWitnessOriginalType: `${pkg}::animacraft_v8_binding::MintBindingWitnessV8`, mintWitnessDefiningType: `${pkg}::animacraft_v8_binding::MintBindingWitnessV8`,
      ownerWitnessOriginalType: `${pkg}::animacraft_v8_binding::SoulOwnerWitnessV8`, ownerWitnessDefiningType: `${pkg}::animacraft_v8_binding::SoulOwnerWitnessV8` } },
    chainIdentifier: '01010101', marketConfigId: id(72), kindRegistryId: registry.id, kioskRegistryId: id(73),
    personalKioskTypePackageId: id(74), paymentCoinType: SOUL_PUBLIC_USDC_TYPE, discoveryEndpoint: 'https://graphql.example.com/' }
  const rows = new Map<string, any>(), tables = new Map<string, any[]>()
  function put(objectId: string, type: string, bytes: Uint8Array, owner: any = { kind: 3, version: 1n }) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 1n, digest, owner, contents: { value: bytes } })
  }
  function field(parent: string, keyType: string, keyCodec: any, key: any, valueType: string, valueCodec: any, value: any) {
    const keyBytes = keyCodec.serialize(key).toBytes(), fieldId = deriveDynamicFieldID(parent, keyType, keyBytes)
    put(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keyCodec, value: valueCodec })
      .serialize({ id: fieldId, name: key, value }).toBytes(), { kind: 2, address: parent })
    const candidates = tables.get(parent) ?? []
    if (!candidates.some(c => c.fieldId === fieldId)) candidates.push({ fieldId, kind: 1, name: { name: keyType, value: keyBytes }, valueType })
    tables.set(parent, candidates); return fieldId
  }
  const putState = () => put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes())
  const putSoul = () => {
    const fieldId = deriveKioskItemFieldId(state.current_kiosk_id, soul.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
      { kind: 2, address: state.current_kiosk_id })
    put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: fieldId })
  }
  const putSlots = () => slots.forEach(slot => field(content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
    { kind: slot.kind, name: slot.kind === 0 ? 'soul' : slot.kind === 1 ? 'default' : 'main' },
    `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), [slot]))
  putState(); putSoul(); putSlots()
  put(content.id, `${pkg}::content::SoulContent`, SoulContentPublicBcs.serialize(content).toBytes())
  put(registry.id, `${pkg}::kind_registry::KindRegistry`, D.Registry.serialize(registry).toBytes())
  put(paid.id, `${pkg}::paid_access::SoulPaidAccessList`, D.Paid.serialize(paid).toBytes())
  put(grant.id, `${pkg}::grant::SoulGrant`, D.Grant.serialize(grant).toBytes(), { kind: 1, address: grant.grantee })
  put(id(6), '0x2::clock::Clock', D.Clock.serialize({ id: id(6), timestamp_ms: '1000' }).toBytes())
  put(state.current_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: state.current_kiosk_id,
    profits: '0', owner: state.current_owner, item_count: 1, allow_extensions: false }).toBytes())
  put(listing.id, `${pkg}::market::SoulListing`, SoulPublicListingBcs.serialize(listing).toBytes())
  put(config.marketConfigId, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs.serialize({ id: config.marketConfigId,
    version: '2', legacy_config_id: id(0), fee_recipient: id(75), platform_fee_bps: 250, primary_enabled: true, secondary_enabled: true }).toBytes())
  put(config.kioskRegistryId, `${pkg}::market::KioskRegistry`, bcs.struct('KioskRegistry', { id: A, version: U })
    .serialize({ id: config.kioskRegistryId, version: '1' }).toBytes())
  field(config.kioskRegistryId, `${pkg}::market::PersonalKioskOwnerKey`, bcs.struct('PersonalKioskOwnerKey', { owner: A }),
    { owner: state.current_owner }, `${pkg}::market::PersonalKioskRegistration`, bcs.struct('PersonalKioskRegistration', {
      version: U, kiosk_id: A, kiosk_cap_id: A }), { version: '1', kiosk_id: state.current_kiosk_id, kiosk_cap_id: id(76) })
  put(id(76), `${config.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, bcs.struct('PersonalKioskCap', {
    id: A, cap: bcs.option(bcs.struct('KioskOwnerCap', { id: A, for: A })) }).serialize({ id: id(76), cap: { id: id(77), for: state.current_kiosk_id } }).toBytes(),
  { kind: 1, address: state.current_owner })
  const pointerType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(soul.id, pointerType, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
  put(pointerId, `0x2::dynamic_field::Field<${pointerType},0x2::object::ID>`, SoulStatePointerFieldV1Bcs.serialize({
    id: pointerId, name: { version: 1 }, value: state.id }).toBytes(), { kind: 2, address: soul.id })
  const preview = buildSoulPublicPreviewStateConfig({ tags: ['oc', 'cat'], previewImages: ['https://images.example.com/preview.png'] })
  field(state.config_ext.id, '0x1::string::String', S, preview.key, 'vector<u8>', V, [...new TextEncoder().encode(preview.valueUtf8)])
  field(state.config_ext.id, '0x1::string::String', S, 'sprite_config_json', 'vector<u8>', V, [...new TextEncoder().encode('{"frames":2}')])
  for (const slot of slots) {
    const name = slot.kind === 0 ? 'soul_doc' : slot.kind === 1 ? 'memory' : 'sprite'
    field(content.count_by_kind.id, 'u32', N, slot.kind, 'u64', U, '1')
    field(registry.kinds.id, 'u32', N, slot.kind, `${pkg}::kind_registry::KindDescriptor`, D.Descriptor, {
      version: '1', kind: slot.kind, name, op_mask: slot.op_mask, read_mode_mask: slot.kind === 3 ? '15' : '3',
      has_active_binding: slot.kind === 3, requires_download_policy: slot.kind === 3,
      default_grant_scope_mask: slot.grant_scope_mask, deprecated: false })
    field(registry.name_to_kind.id, '0x1::string::String', S, name, 'u32', N, slot.kind)
  }
  field(content.active.id, 'u32', N, 3, `${pkg}::content::ActiveBinding`, D.Active,
    { version: '1', kind: 3, name: 'main', version_index: '0', download_policy: 1 })
  field(state.active_grants.id, 'address', A, grant.grantee, `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot, grantSlot)
  field(state.active_grant_ids.id, '0x2::object::ID', A, grant.id, 'address', A, grant.grantee)
  field(paid.kind_configs.id, 'u32', N, 3, `${pkg}::paid_access::KindPaidConfig`, D.PaidConfig, paidConfig)
  field(paid.entries.id, 'address', A, grant.grantee, `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, { id: id(62), size: '1' })
  field(id(62), 'u32', N, 3, `${pkg}::paid_access::KindPaidEntry`, D.PaidEntry, entry)
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(((args: any) => {
    const value = rows.get(args.objectId)
    if (!value) return Promise.reject(new Error(`raw object missing: ${args.objectId}`))
    return Promise.resolve({ response: { object: structuredClone(value) } })
  }) as any)
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((r: any) => ({ result: rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const list = vi.spyOn(client.stateService, 'listDynamicFields').mockImplementation(((args: any) => Promise.resolve({ response: {
    dynamicFields: structuredClone(tables.get(args.parent) ?? []) } })) as any)
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { chainIdentifier: digest,
    checkpoint: { sequenceNumber: 100, query: { objects: { nodes: [{ address: listing.id }], pageInfo: { hasNextPage: false, endCursor: 'complete' } } } } } })))
  return { client, config, state, soul, content, slots, grantSlot, grant, paidConfig, entry, listing, rows, tables,
    field, put, putState, putSoul, putSlots, pointerId, get, batch, list, chain, fetcher }
}

/** Standalone reusable model setup, with no test registrations. The model's
 * component inputs were produced by the actual connected raw readers above. */
export async function createBrowserSoulDetailModel(listed = true, owner = detailId(5)) {
  const f = browserSoulDetailFixture(listed, owner), deployment = { originalPackageId: f.config.native.soulidityOriginalPackageId,
    chainIdentifier: f.config.chainIdentifier }
  const asset = await readSoulPublicSnapshotBySoulId({ client: f.client, deployment, soulId: f.soul.id })
  const expectedState = { version: asset.stateVersion, digest: asset.stateDigest }
  const state = await readSoulDetailState({ client: f.client, deployment: { ...deployment, kindRegistryId: f.config.kindRegistryId },
    stateId: asset.stateId, expectedState, viewerAddresses: [asset.currentOwner] })
  const listing = await readSoulPublicListing({ client: f.client, deployment: { ...deployment,
    marketConfigId: f.config.marketConfigId, paymentCoinType: f.config.paymentCoinType }, stateId: asset.stateId,
    listingId: listed ? f.listing.id : null, expectedState })
  const input: Parameters<typeof composeChainSoulDetail>[0] = structuredClone({ originalPackageId: deployment.originalPackageId, asset, state, listing,
    currentKioskCapId: detailId(76), viewerAddress: asset.currentOwner })
  return { f, input, compose: () => composeChainSoulDetail(input) }
}
