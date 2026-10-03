import { sha256 } from '@noble/hashes/sha2.js'
import { equipmentBytesEqual, equipmentUtf8 } from './native-equipment-bytes'
import { bcs, type BcsType } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, parseStructTag } from '@mysten/sui/utils'
import { decodeNativeBcs, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'
import { readEquipmentProtectedBase } from './native-equipment-seal'
import { readEquipmentPack, EquipmentPackReleaseBcs, type EquipmentPackQuery } from './native-equipment-pack'
import { readNativePackDefinitions } from './native-pack-definitions'
import { nativePackProfiles } from './native-pack-profiles'
import { readNativeSourceAuthority } from './native-source-authority'
import type { NamedLoadoutContent } from './named-loadout'
import type { EquipmentReadSet, EquipmentLoadoutBcs, EquipmentBaseItemBcs } from './native-equipment'
import { EquipmentMakerBcs, EquipmentDefinitionsBcs, EquipmentProfileBcs, EquipmentPackRegistryBcs,
  EquipmentBaseRegistryBcs, EquipmentAccessPassBcs, EquipmentItemRowBcs, EquipmentStyleRowBcs, EquipmentColorRowBcs,
  EquipmentExternalProductBcs, EquipmentExternalAdmissionBcs, EquipmentAccessEntitlementBcs,
  EquipmentBaseHolderKeyBcs, EquipmentBaseOwnershipBcs, EquipmentTrackRowBcs,
  EquipmentProtocolBcs, EquipmentProtocolCommitmentBcs, EquipmentEconomicsBcs, EquipmentEconomicsCommitmentBcs } from './native-equipment-source-bcs'

const A = bcs.Address; const U = bcs.u64(); const S = bcs.string(); const V = bcs.vector(bcs.u8())
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_SOURCE_INVALID', message)
}
export function equipmentAccessCommitment(access: ReturnType<typeof EquipmentAccessPassBcs.parse>) {
  return [...sha256(EquipmentAccessEntitlementBcs.serialize({ ...access, pass_id: access.id,
    domain: [...equipmentUtf8('animacraft-v8/runtime/maker-access-entitlement')],
  }).toBytes())]
}
export function equipmentProtocolCommitment(protocol: ReturnType<typeof EquipmentProtocolBcs.parse>) {
  return [...sha256(EquipmentProtocolCommitmentBcs.serialize({ ...protocol,
    domain: 'animacraft-fresh-v8/core/protocol-config/v2', schema_revision: '8', config_id: protocol.id,
    config_revision: protocol.revision,
  }).toBytes())]
}
export function equipmentEconomicsCommitment(economics: ReturnType<typeof EquipmentEconomicsBcs.parse>) {
  return [...sha256(EquipmentEconomicsCommitmentBcs.serialize({ ...economics,
    domain: [...equipmentUtf8('animacraft-v8/economics-snapshot')], version: '8',
  }).toBytes())]
}

/** Reads actual source rows, never a caller-provided Maker or manifest guess.
 * Returned data describes source configuration; transaction simulation/chain
 * execution still rechecks current authority, Rules and selected entitlements. */
export async function readNativeEquipmentSource(client: SuiGrpcClient, target: NativeReceiveTarget,
  reads: EquipmentReadSet, input: { rootId: string; owner: string; makerVersion: string; rootCommitment: number[];
    loadout: ReturnType<typeof EquipmentLoadoutBcs.parse> | null; styleStart?: number; externalProductIds?: string[];
    baseItems?: ReturnType<typeof EquipmentBaseItemBcs.parse>[]; pack?: EquipmentPackQuery; exactSlots?: NamedLoadoutContent['slots'] }) {
  check(input.exactSlots === undefined || (input.exactSlots.length <= 500 && input.styleStart === undefined && input.pack === undefined), 'Invalid exact source query')
  const { native, runtime, origin, rt, baseType, rootType, coreMarkerId } = await readNativeSourceAuthority(client, target)
  const { response: rootResponse } = await client.ledgerService.getObject({ objectId: input.rootId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
  check(rootResponse.object?.objectType, 'Maker type missing')
  const tag = parseStructTag(rootResponse.object.objectType)
  check(tag.typeParams.length === 1 && typeof tag.typeParams[0] !== 'string', 'Maker payment type missing')
  const coin = normalizeStructTag(tag.typeParams[0])
  const root = decodeNativeBcs(EquipmentMakerBcs, reads.accept(rootResponse.object, input.rootId, `${rootType}<${coin}>`, 3))
  check(root.id === input.rootId && root.version === '8' && root.maker_version === input.makerVersion
    && eq(root.content.content_commitment, input.rootCommitment) && root.core_original_package_id === target.coreOriginalPackageId
    && root.core_callable_package_id === coreMarkerId && root.economics.protocol_config_id === target.protocolConfigId
    && normalizeStructTag(root.economics.payment_coin_type) === coin, 'Maker source identity mismatch')
  const protocol = decodeNativeBcs(EquipmentProtocolBcs, await reads.read(target.protocolConfigId,
    origin('core','protocol_config_v8','ProtocolConfigV8'), 3))
  check(protocol.id === target.protocolConfigId && protocol.version === '8'
    && eq(protocol.commitment, equipmentProtocolCommitment(protocol)), 'Protocol source commitment mismatch')
  const economics = root.economics
  const expectedEconomics = { ...economics, protocol_config_id: protocol.id, protocol_config_revision: protocol.revision,
    protocol_config_commitment: protocol.commitment, protocol_treasury_id: protocol.treasury_id ?? economics.protocol_treasury_id,
    payment_coin_type: coin, primary_content_fee_bps: protocol.primary_content_fee_bps,
    fixed_complete_fee_atomic: protocol.fixed_complete_fee_atomic, maker_market_fee_bps: protocol.maker_market_fee_bps,
    soul_market_fee_bps: protocol.soul_market_fee_bps }
  expectedEconomics.commitment = equipmentEconomicsCommitment(expectedEconomics)
  const validPolicy = [0,1].includes(economics.maker_access) && BigInt(economics.maker_price_atomic) <= 1_000_000_000_000n
    && (BigInt(economics.maker_price_atomic) > 0n) === (economics.maker_access === 1)
    && [0,1,2,3].includes(economics.complete_mode) && BigInt(economics.complete_price_atomic) <= 1_000_000_000_000n
    && BigInt(economics.complete_per_wallet_quota) <= 1_000_000_000n && BigInt(economics.complete_total_cap) <= 1_000_000_000n
    && (economics.complete_total_cap === '0' || BigInt(economics.complete_per_wallet_quota) <= BigInt(economics.complete_total_cap))
    && (BigInt(economics.complete_price_atomic) > 0n) === [1,2].includes(economics.complete_mode)
    && (BigInt(economics.complete_per_wallet_quota) > 0n) === [1,3].includes(economics.complete_mode)
  // This is a create-only gate. Protocol pause/drift must not hide equipment or prevent removal.
  const currentProtocol = protocol.enabled && protocol.treasury_id !== null && validPolicy
    && protocol.core_original_package_id === target.coreOriginalPackageId && protocol.core_callable_package_id === coreMarkerId
    && protocol.payment_coin_type === coin
    && equipmentBytesEqual(EquipmentEconomicsBcs.serialize(expectedEconomics).toBytes(), EquipmentEconomicsBcs.serialize(economics).toBytes())
  const ids = root.publication.registry_ids
  check(ids && root.base_registry_id && root.maker_treasury_id, 'Maker source registries not bound')
  const definitions = decodeNativeBcs(EquipmentDefinitionsBcs, await reads.read(ids.runtime_definition_registry_id, rt('RuntimeDefinitionRegistryV8'), 3))
  const packs = decodeNativeBcs(EquipmentPackRegistryBcs, await reads.read(ids.pack_registry_id, rt('PackRegistryV8'), 3))
  const base = decodeNativeBcs(EquipmentBaseRegistryBcs, await reads.read(root.base_registry_id, baseType('BaseDefinitionRegistryV8'), 3))
  for (const row of [definitions, packs]) check(row.version === '8' && row.root_id === root.id
    && row.root_version === root.maker_version && eq(row.root_content_commitment, input.rootCommitment), 'Runtime source mismatch')
  check(definitions.id === ids.runtime_definition_registry_id && packs.id === ids.pack_registry_id
    && definitions.base_registry_id === root.base_registry_id && packs.definition_registry_id === definitions.id
    && packs.admission_authority_id === ids.admission_authority_id
    && eq(packs.admission_policy_commitment, root.expected_pack_admission_policy_commitment)
    && definitions.sealed && definitions.profile_keys.length <= 500
    && BigInt(definitions.observed_profile_count) === BigInt(definitions.profile_keys.length)
    && definitions.observed_profile_count === definitions.expected_profile_count
    && new Set(definitions.profile_keys).size === definitions.profile_keys.length, 'Source registry binding/count mismatch')
  check(base.id === root.base_registry_id && base.version === '8' && base.sealed && base.root_id === root.id
    && base.maker_version === root.maker_version && eq(base.root_content_commitment, input.rootCommitment)
    && base.sealed_commitments && root.publication.sealed_base_registry_commitment
    && eq(base.sealed_commitments.aggregate, root.publication.sealed_base_registry_commitment), 'Base source seal mismatch')
  if (input.loadout) check(input.loadout.definition_registry_id === definitions.id && input.loadout.pack_registry_id === packs.id, 'Equipment source registry mismatch')

  async function fields<T, I>(parent: string, keyType: string, keySchema: BcsType<any, any>, keys: unknown[],
    valueType: string, schema: BcsType<T, I>) {
    const Field = bcs.struct('Field', { id: A, name: keySchema, value: schema })
    const requests = keys.map(key => ({ id: deriveDynamicFieldID(parent, keyType, keySchema.serialize(key).toBytes()),
      type: `0x2::dynamic_field::Field<${keyType},${valueType}>`, kind: 2, parent }))
    const bytes = await reads.readMany(requests)
    return bytes.map((bytes, i) => {
      const row = decodeNativeBcs(Field, bytes)
      check(row.id === requests[i].id && equipmentBytesEqual(keySchema.serialize(row.name).toBytes(), keySchema.serialize(keys[i]).toBytes()), 'Source row key mismatch')
      return row.value
    })
  }
  const profiles = await fields(definitions.profiles.id, rt('PartProfileKeyV8'), bcs.struct('PartProfileKeyV8', { part_key: S }),
    definitions.profile_keys.map(part_key => ({ part_key })), rt('PartProfileV8'), EquipmentProfileBcs)
  let capacity = 0
  const slots = profiles.map((profile, index) => {
    check(profile.index === String(index) && profile.part_key === definitions.profile_keys[index]
      && BigInt(profile.capacity) > 0n && BigInt(profile.capacity) <= 64n && [0,1].includes(profile.wardrobe_mode)
      && [0,1,2,3].includes(profile.behavior) && [0,1,2].includes(profile.admission_ceiling), 'Part profile mismatch')
    const slotStart = capacity++
    return { ...profile, makerCapacity: profile.capacity, capacity: '1', slotStart, source_definition_id: root.id }
  })
  if (input.loadout) {
    const attached = new Set<string>()
    check(input.loadout.attached_pack_definitions.length <= 500, 'Attached Pack count invalid')
    for (const binding of input.loadout.attached_pack_definitions) {
      check(binding.release_id !== root.id && !attached.has(binding.release_id), 'Duplicate/invalid attached Pack')
      attached.add(binding.release_id)
      const release = decodeNativeBcs(EquipmentPackReleaseBcs, await reads.read(binding.release_id, `${rt('PackReleaseV8')}<${coin}>`, 3))
      check(release.id === binding.release_id && release.version === '8' && release.root_id === root.id
        && release.root_version === root.maker_version && eq(release.root_content_commitment, input.rootCommitment), 'Attached Pack root mismatch')
      const owned = await readNativePackDefinitions(reads, release, rt)
      check(eq(binding.definition_commitment, owned.commitment), 'Attached Pack definition commitment mismatch')
      for (const profile of nativePackProfiles(owned, definitions.admission_ceiling)) {
        const slotStart = capacity++
        check(capacity <= 500, 'Source slot capacity mismatch')
        slots.push({ ...profile, makerCapacity: profile.capacity, capacity: '1', slotStart, source_definition_id: release.id })
      }
    }
  }
  check(capacity <= 500 && (!input.loadout || input.loadout.selections.length === capacity), 'Source slot capacity mismatch')
  if (input.loadout) {
    check(input.loadout.definition_slots.length === slots.length, 'Source definition slot count mismatch')
    slots.forEach((profile, index) => {
      const slot = input.loadout!.definition_slots[index]
      check(slot.source_definition_id === profile.source_definition_id && slot.part_key === profile.part_key
        && slot.start === String(profile.slotStart) && slot.capacity === profile.capacity
        && eq(slot.profile_commitment, profile.profile_commitment), 'Source definition slot profile mismatch')
    })
  }

  // Treasury-backed access discovery also works before the first equipment is created.
  const Treasury = bcs.struct('MakerTreasuryV8', { id: A, version: U, root_id: A, maker_version: U, root_content_commitment: V,
    revenue: bcs.struct('Balance', { value: U }), total_collected: bcs.u128(), total_withdrawn: bcs.u128() })
  const treasury = decodeNativeBcs(Treasury, await reads.read(root.maker_treasury_id,
    `${origin('core','treasury_v8','MakerTreasuryV8')}<${coin}>`, 3))
  check(treasury.id === root.maker_treasury_id && treasury.version === '8' && treasury.root_id === root.id
    && treasury.maker_version === root.maker_version && eq(treasury.root_content_commitment, input.rootCommitment), 'Treasury source mismatch')
  const accessKey = bcs.struct('MakerAccessKeyV8', { holder: A })
  const accessKeyType = origin('core','treasury_v8','MakerAccessKeyV8')
  const accessFieldId = deriveDynamicFieldID(treasury.id, accessKeyType, accessKey.serialize({ holder: input.owner }).toBytes())
  const AccessRecord = bcs.struct('MakerAccessRecordV8', { pass_id: A, holder: A, paid_atomic: U, issued_at_ms: U })
  const accessBytes = await reads.optional(accessFieldId, `0x2::dynamic_field::Field<${accessKeyType},${origin('core','treasury_v8','MakerAccessRecordV8')}>`, 2, treasury.id)
  let access: ReturnType<typeof EquipmentAccessPassBcs.parse> | null = null
  if (accessBytes !== null) {
    const row = decodeNativeBcs(bcs.struct('Field', { id: A, name: accessKey, value: AccessRecord }), accessBytes)
    check(row.id === accessFieldId && row.name.holder === input.owner && row.value.holder === input.owner, 'Access record mismatch')
    access = decodeNativeBcs(EquipmentAccessPassBcs, await reads.read(row.value.pass_id, origin('core','treasury_v8','MakerAccessPassV8'), 1, input.owner))
    check(access.id === row.value.pass_id && access.version === '8' && access.root_id === root.id
      && access.maker_version === root.maker_version && access.holder === input.owner && eq(access.root_content_commitment, input.rootCommitment)
      && access.paid_atomic === row.value.paid_atomic && access.issued_at_ms === row.value.issued_at_ms
      && access.paid_atomic === (root.economics.maker_access === 0 ? '0' : root.economics.maker_price_atomic), 'Maker access proof mismatch')
  }
  if (input.loadout) check(access?.id === input.loadout.maker_access_pass_id, 'Equipment access pointer mismatch')
  if (input.loadout && access) check(eq(equipmentAccessCommitment(access), input.loadout.maker_access_commitment), 'Equipment access entitlement mismatch')

  // Unrelated Maker instances are valid wallet inventory, not a source-read failure.
  const baseItems = (input.baseItems ?? []).filter(item => item.root_id === root.id && item.root_version === root.maker_version
    && eq(item.root_content_commitment, input.rootCommitment) && item.definition_registry_id === definitions.id
    && item.pack_registry_id === packs.id && item.base_registry_id === base.id)
  check(baseItems.length <= (input.exactSlots ? 500 : 20), 'Base source page too large')
  const ownership = await boundedMap(baseItems, async item => {
    const key = { part_key: item.part_key, item_key: item.item_key, holder: input.owner }
    const keyType = rt('BaseItemHolderKeyV8')
    const fieldId = deriveDynamicFieldID(packs.base_item_owners.id, keyType, EquipmentBaseHolderKeyBcs.serialize(key).toBytes())
    const bytes = await reads.optional(fieldId, `0x2::dynamic_field::Field<${keyType},${rt('BaseItemOwnershipRecordV8')}>`, 2, packs.base_item_owners.id)
    if (bytes === null) return { itemId: item.id, record: null }
    const field = decodeNativeBcs(bcs.struct('Field', { id: A, name: EquipmentBaseHolderKeyBcs, value: EquipmentBaseOwnershipBcs }), bytes)
    check(field.id === fieldId && field.name.part_key === key.part_key && field.name.item_key === key.item_key
      && field.name.holder === input.owner, 'Base ownership key mismatch')
    return { itemId: item.id, record: field.value }
  })

  // Real chain index, paginated instead of truncating the creator's style set.
  const start = input.styleStart ?? 0
  const totalStyles = Number(base.observed_counts.styles)
  check(Number.isSafeInteger(totalStyles) && totalStyles <= 500 && Number.isSafeInteger(start) && start >= 0 && start <= totalStyles, 'Style page range invalid')
  const count = Math.min(50, totalStyles - start)
  const StyleKey = bcs.struct('StyleKeyV8', { part_key: S, item_key: S, style_key: S })
  const keys = input.exactSlots ? [...new Map(input.exactSlots.flatMap(row => row && (row.kind === 'base-selection' || row.kind === 'base-item')
    ? [[JSON.stringify([row.partKey,row.itemKey,row.styleKey]), { part_key: row.partKey, item_key: row.itemKey, style_key: row.styleKey }] as const] : [])).values()]
    : await fields(base.id, baseType('StyleIndexKeyV8'), bcs.struct('StyleIndexKeyV8', { index: U }),
    Array.from({ length: count }, (_, index) => ({ index: String(start + index) })), baseType('StyleKeyV8'), StyleKey)
  const styles = await fields(base.id, baseType('StyleKeyV8'), StyleKey, keys, baseType('StyleRowV2'), EquipmentStyleRowBcs)
  const itemKeys = [...new Map([...keys, ...baseItems].map(key => [JSON.stringify([key.part_key,key.item_key]), { part_key: key.part_key, item_key: key.item_key }])).values()]
  const items = await fields(base.id, baseType('ItemKeyV8'), bcs.struct('ItemKeyV8', { part_key: S, item_key: S }), itemKeys, baseType('ItemRowV2'), EquipmentItemRowBcs)
  styles.forEach((style, index) => check(style.part_key === keys[index].part_key && style.item_key === keys[index].item_key && style.style_key === keys[index].style_key, 'Style identity mismatch'))
  items.forEach((item, index) => check(item.part_key === itemKeys[index].part_key && item.item_key === itemKeys[index].item_key, 'Item identity mismatch'))
  const colorKeys = [...new Set(styles.flatMap(style => style.color_channel_key === null ? [] : [style.color_channel_key]))]
  const colors = await fields(base.id, baseType('ColorKeyV8'), bcs.struct('ColorKeyV8', { channel_key: S }),
    colorKeys.map(channel_key => ({ channel_key })), baseType('ColorChannelRowV2'), EquipmentColorRowBcs)
  colors.forEach((color,index) => check(color.key === colorKeys[index], 'Color identity mismatch'))
  const trackKeys = [...new Set(styles.map(style => style.track_key))]
  const tracks = await fields(base.id, baseType('TrackKeyV8'), bcs.struct('TrackKeyV8', { key: S }),
    trackKeys.map(key => ({ key })), baseType('TrackRowV2'), EquipmentTrackRowBcs)
  tracks.forEach((track,index) => check(track.key === trackKeys[index], 'Track identity mismatch'))
  const productIds = [...new Set(input.externalProductIds ?? [])]
  check(productIds.length <= (input.exactSlots ? 500 : 20), 'External source page too large')
  const products = await reads.readMany(productIds.map(productId => ({ id: receiveId(productId), type: rt('ExternalItemProductV8'), kind: 3 })))
  const external = await boundedMap(products, async (bytes,index) => {
    const product = decodeNativeBcs(EquipmentExternalProductBcs, bytes)
    check(product.id === productIds[index] && product.version === '8', 'External product identity mismatch')
    const keyBytes = A.serialize(product.id).toBytes()
    const fieldId = deriveDynamicFieldID(packs.external_admissions.id, '0x2::object::ID', keyBytes)
    const admissionBytes = await reads.optional(fieldId,
      `0x2::dynamic_field::Field<0x2::object::ID,${rt('ExternalAdmissionRecordV8')}>`, 2, packs.external_admissions.id)
    let admission: ReturnType<typeof EquipmentExternalAdmissionBcs.parse> | null = null
    if (admissionBytes !== null) {
      const field = decodeNativeBcs(bcs.struct('Field', { id: A, name: A, value: EquipmentExternalAdmissionBcs }), admissionBytes)
      check(field.id === fieldId && field.name === product.id && field.value.product_id === product.id, 'External admission key mismatch')
      admission = field.value
    }
    return { product, admission }
  })
  const protectedBase = await readEquipmentProtectedBase(client, reads, { root, styles, native, runtime })
  const pack = input.pack ? await readEquipmentPack(client, reads, { owner: input.owner, rootId: root.id,
    rootVersion: root.maker_version, rootCommitment: input.rootCommitment, paymentCoinType: coin,
    baseRegistryId: base.id, packs, runtimeType: rt, baseType, query: input.pack }) : null
  const packGroups = new Map<string, NonNullable<EquipmentPackQuery['exactStyles']>>()
  for (const row of input.exactSlots ?? []) if (row?.kind === 'pack-selection') {
    const group = packGroups.get(row.accessSubject) ?? []
    group.push({ partKey: row.partKey, itemKey: row.itemKey, styleKey: row.styleKey })
    packGroups.set(row.accessSubject, group)
  }
  const applyPacks = await boundedMap([...packGroups],async ([passId, requested]) => {
    const exactStyles = [...new Map(requested.map(row => [JSON.stringify(row), row])).values()]
    return readEquipmentPack(client, reads, { owner: input.owner, rootId: root.id,
      rootVersion: root.maker_version, rootCommitment: input.rootCommitment, paymentCoinType: coin,
      baseRegistryId: base.id, packs, runtimeType: rt, baseType, query: { passId, exactStyles } })
  })
  return { root, definitions, packs, base, slots, access, protocol, currentProtocol, protectedBase, paymentCoinType: coin,
    items, styles, colors, tracks, ownership, external, pack, applyPacks, stylePage: { start, next: input.exactSlots ? null : start + count < totalStyles ? start + count : null, total: totalStyles },
    eligibility: 'SOURCE_CONFIGURATION_ONLY' as const }
}

async function boundedMap<T, R>(rows: T[], work: (row: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = []
  for (let start = 0; start < rows.length; start += 16) {
    result.push(...await Promise.all(rows.slice(start, start + 16).map((row, offset) => work(row, start + offset))))
  }
  return result
}
