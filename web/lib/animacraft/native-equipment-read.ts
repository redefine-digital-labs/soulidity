import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { decodeNativeBcs, NativeReceiveError, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet, readNativeEquipment, type EquipmentBaseItemBcs } from './native-equipment'
import { EquipmentAccessPassBcs, EquipmentBaseRegistryBcs, EquipmentDefinitionsBcs, EquipmentPackRegistryBcs,
  EquipmentProfileBcs, EquipmentItemRowBcs, EquipmentStyleRowBcs, EquipmentBaseHolderKeyBcs,
  EquipmentBaseOwnershipBcs, EquipmentColorRowBcs } from './native-equipment-source-bcs'
import { equipmentAccessCommitment } from './native-equipment-source'
import { readEquipmentPack, validEquipmentPackKey, equipmentPackStyleColor, EquipmentPackReleaseBcs, type PackRelease } from './native-equipment-pack'
import { readNativePackDefinitions } from './native-pack-definitions'
import { nativePackProfiles } from './native-pack-profiles'
import { EquipmentProtectedKeyBcs, EquipmentProtectedAssetBcs, EquipmentSealIdBcs, equipmentSealBinding } from './native-equipment-seal'
import { completeReadCertificationHash, completeReadHash } from './native-complete-read-bcs'
import { createNativeProtectedReadContext, readNativeProtectedReadPolicy, completeReadAggregatorUrls } from './native-protected-read-authority'
import type { NativeEquipmentReadTarget } from './native-equipment-read-types'
import { toBase64 } from '@mysten/sui/utils'
import { equipmentUtf8 } from './native-equipment-bytes'
import { nativeArtworkBlobId, nativeArtworkHex as hex } from './native-artwork-bytes'

const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8()), S = bcs.string()
const OwnedPricing = bcs.struct('OwnedBaseItemCommitmentInputV8', { domain: V, version: U, item_id: A,
  root_id: A, root_version: U, root_content_commitment: V, definition_registry_id: A, pack_registry_id: A,
  base_registry_id: A, part_key: S, item_key: S, item_payload_commitment: V, holder: A, ownership_epoch: U })
const PackPricing = bcs.struct('PricingCommitmentInputV8', { domain: V, version: U, release_id: A,
  release_content_commitment: V, access_kind: bcs.u8(), access_price_atomic: U, complete_mode: bcs.u8(),
  complete_price_atomic: U, complete_free_quota_per_wallet: U, complete_total_cap: U })
export function equipmentReadOwnedPricing(item: ReturnType<typeof EquipmentBaseItemBcs.parse>) {
  return completeReadHash(OwnedPricing.serialize({ ...item, item_id: item.id,
    domain: [...equipmentUtf8('animacraft-v8/runtime/owned-base-item')] }).toBytes())
}
export function equipmentReadPackPricing(release: PackRelease) {
  return completeReadHash(PackPricing.serialize({ ...release, release_id: release.id,
    release_content_commitment: release.content_commitment,
    domain: [...equipmentUtf8('animacraft-v8/runtime/pack-pricing')] }).toBytes())
}
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.some(v => v !== 0) && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_READ_INVALID', message)
}

/** Exact CURRENT DF10 slot. The immutable Complete recipe is never
 * consulted and never grants component access. Seal still authorizes the live owner. */
export async function readNativeEquipmentReadTarget(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string; selectionIndex: number }, signal?: AbortSignal,
  aggregators: ReadonlyMap<string, string> = completeReadAggregatorUrls()): Promise<NativeEquipmentReadTarget> {
  aggregators = new Map(aggregators)
  input = structuredClone(input)
  check(Number.isSafeInteger(input.selectionIndex) && input.selectionIndex >= 0 && input.selectionIndex < 500, 'Invalid equipment slot')
  signal?.throwIfAborted()
  const reads = new EquipmentReadSet(client)
  try {
    const current = await readNativeEquipment(client, target, { soulId: input.soulId, stateId: input.stateId }, reads)
    check(current.status === 'BOUND' && current.equipment, 'Current equipment missing')
    const { loadout, instances } = current.equipment
    const selection = loadout.selections[input.selectionIndex]
    check(selection && selection.protected && (selection.source_class === 0 || selection.source_class === 1), 'Selected slot is not a protected Base/Pack layer')
    check([selection.part_key, selection.item_key, selection.style_key].every(validEquipmentPackKey), 'Invalid selected asset key')
    const context = await createNativeProtectedReadContext(client, target, reads, signal)
    const authority = await readNativeProtectedReadPolicy(context, { rootId: loadout.root_id,
      makerVersion: loadout.root_version, rootContentCommitment: loadout.root_content_commitment })
    const { root, protocol, catalogId, releaseConfigId, registry, policy, coin, st, rt, baseType, rolePackages, seal } = authority
    const { field, ct } = context
    const runtime = rolePackages[2]
    check(target.runtime && runtime.objectId === target.runtime.callablePackageId
      && runtime.package!.originalId === target.runtime.originalPackageId && runtime.digest === target.runtime.callableDigest, 'Exact Runtime pin mismatch')
    context.assertLink(context.native, runtime); context.assertLink(runtime, context.core); context.assertLink(runtime, seal)
    // Existing entitlement factories require ACTIVE Maker access. Listing and
    // equipment write switches are not read-authority predicates.
    check(root.lifecycle === 1, 'Current Maker access requires an active Root')
    const ids = root.publication.registry_ids!
    check(root.base_registry_id, 'Base registry missing')
    const definitions = decodeNativeBcs(EquipmentDefinitionsBcs, await reads.read(ids.runtime_definition_registry_id, rt('RuntimeDefinitionRegistryV8'), 3))
    const packs = decodeNativeBcs(EquipmentPackRegistryBcs, await reads.read(ids.pack_registry_id, rt('PackRegistryV8'), 3))
    const base = decodeNativeBcs(EquipmentBaseRegistryBcs, await reads.read(root.base_registry_id, baseType('BaseDefinitionRegistryV8'), 3))
    for (const row of [definitions, packs]) check(row.version === '8' && row.root_id === root.id
      && row.root_version === root.maker_version && eq(row.root_content_commitment, root.content.content_commitment), 'Runtime source identity mismatch')
    check(definitions.id === ids.runtime_definition_registry_id && packs.id === ids.pack_registry_id
      && definitions.base_registry_id === base.id && packs.definition_registry_id === definitions.id
      && packs.admission_authority_id === ids.admission_authority_id && eq(packs.admission_policy_commitment, root.expected_pack_admission_policy_commitment)
      && loadout.definition_registry_id === definitions.id && loadout.pack_registry_id === packs.id
      && definitions.sealed && definitions.profile_keys.length <= 500
      && definitions.observed_profile_count === definitions.expected_profile_count
      && BigInt(definitions.observed_profile_count) === BigInt(definitions.profile_keys.length)
      && new Set(definitions.profile_keys).size === definitions.profile_keys.length, 'Runtime companion/profile mismatch')
    check(base.id === root.base_registry_id && base.version === '8' && base.sealed && base.root_id === root.id
      && base.maker_version === root.maker_version && eq(base.root_content_commitment, root.content.content_commitment)
      && base.sealed_commitments && root.publication.sealed_base_registry_commitment
      && eq(base.sealed_commitments.aggregate, root.publication.sealed_base_registry_commitment), 'Base seal mismatch')
    const profiles: ReturnType<typeof EquipmentProfileBcs.parse>[] = []
    for (let start = 0; start < definitions.profile_keys.length; start += 16) {
      signal?.throwIfAborted()
      const results = await Promise.allSettled(definitions.profile_keys.slice(start, start + 16).map(part_key =>
        field(definitions.profiles.id, rt('PartProfileKeyV8'), bcs.struct('PartProfileKeyV8', { part_key: S }),
          { part_key }, rt('PartProfileV8'), EquipmentProfileBcs)))
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
        profiles.push(result.value)
      }
    }
    for (const [index, profile] of profiles.entries()) {
      const part_key = definitions.profile_keys[index]
      check(profile.index === String(index) && profile.part_key === part_key && BigInt(profile.capacity) > 0n
        && BigInt(profile.capacity) <= 64n && [0,1].includes(profile.wardrobe_mode)
        && [0,1,2,3].includes(profile.behavior) && [0,1,2].includes(profile.admission_ceiling), 'Exact part profile mismatch')
    }
    // The equipment layout includes Pack-owned Parts, even when the selected
    // protected layer belongs to Base. Authenticate every attached definition;
    // a same-named Part in another namespace is not an interchangeable slot.
    const layout = profiles.map(profile => ({ ...profile, source_definition_id: root.id }))
    for (const binding of loadout.attached_pack_definitions) {
      signal?.throwIfAborted()
      const release = decodeNativeBcs(EquipmentPackReleaseBcs,
        await reads.read(binding.release_id, `${rt('PackReleaseV8')}<${coin}>`, 3))
      check(release.id === binding.release_id && release.version === '8' && release.root_id === root.id
        && release.root_version === root.maker_version && eq(release.root_content_commitment, root.content.content_commitment),
      'Attached Pack root mismatch')
      const owned = await readNativePackDefinitions(reads, release, rt)
      check(eq(owned.commitment, binding.definition_commitment), 'Attached Pack definition commitment mismatch')
      layout.push(...nativePackProfiles(owned, definitions.admission_ceiling)
        .map(profile => ({ ...profile, source_definition_id: release.id })))
      check(layout.length <= 500, 'Equipment layout exceeds limit')
    }
    check(layout.length === loadout.selections.length && layout.length === loadout.definition_slots.length,
      'Selected part slot mismatch')
    layout.forEach((profile, index) => {
      const slot = loadout.definition_slots[index]
      check(slot.start === String(index) && slot.capacity === '1' && slot.part_key === profile.part_key
        && slot.source_definition_id === profile.source_definition_id && eq(slot.profile_commitment, profile.profile_commitment),
      'Equipment definition profile mismatch')
    })
    const selectedSlot = loadout.definition_slots[input.selectionIndex]
    check(selectedSlot?.part_key === selection.part_key, 'Selected part slot mismatch')
    const access = decodeNativeBcs(EquipmentAccessPassBcs, await reads.read(loadout.maker_access_pass_id,
      ct('treasury_v8', 'MakerAccessPassV8'), 1, current.owner))
    check(access.id === loadout.maker_access_pass_id && access.version === '8' && access.holder === current.owner
      && access.root_id === root.id && access.maker_version === root.maker_version
      && eq(access.root_content_commitment, root.content.content_commitment)
      && (root.economics.maker_access === 0 ? access.paid_atomic === '0'
        : root.economics.maker_access === 1 && access.paid_atomic === root.economics.maker_price_atomic)
      && eq(equipmentAccessCommitment(access), loadout.maker_access_commitment), 'MakerAccess entitlement mismatch')
    let branch: Pick<NativeEquipmentReadTarget, 'kind'> & { ownedBaseItemId?: string; packReleaseId?: string; packPassId?: string }
    let scopeKind: number, scopeKey: string, scopeCommitment: number[]
    let styleBinding: number[] | null = null
    let selectedColor: ReturnType<typeof EquipmentColorRowBcs.parse> | undefined
    if (selection.source_class === 0) {
      check(selectedSlot.source_definition_id === root.id, 'Base selection Part namespace mismatch')
      const item = await field(base.id, baseType('ItemKeyV8'), bcs.struct('ItemKeyV8', { part_key: S, item_key: S }),
        selection, baseType('ItemRowV2'), EquipmentItemRowBcs)
      const style = await field(base.id, baseType('StyleKeyV8'), bcs.struct('StyleKeyV8', { part_key: S, item_key: S, style_key: S }),
        selection, baseType('StyleRowV2'), EquipmentStyleRowBcs)
      check(item.part_key === selection.part_key && item.item_key === selection.item_key && item.status === 0
        && style.part_key === selection.part_key && style.item_key === selection.item_key && style.style_key === selection.style_key
        && style.protected && style.track_key === selection.layer_track_key && style.color_channel_key === selection.color_channel_key
        && style.asset_blob_id === selection.asset_blob_id && eq(style.asset_sha256, selection.asset_sha256)
        && eq(style.payload_commitment, selection.asset_content_commitment)
        && selection.source_definition_id === root.id && selection.source_semantic_id === '', 'Base selected row mismatch')
      if (definitions.item_assetization) {
        const owned = instances.find(row => row.kind === 'base' && row.item.id === selection.access_subject)?.item
        check(owned && 'base_registry_id' in owned && owned.base_registry_id === base.id
          && eq(owned.item_payload_commitment, item.payload_commitment)
          && eq(selection.pricing_commitment, equipmentReadOwnedPricing(owned)), 'Owned Base entitlement mismatch')
        const holder = await field(packs.base_item_owners.id, rt('BaseItemHolderKeyV8'), EquipmentBaseHolderKeyBcs,
          { part_key: selection.part_key, item_key: selection.item_key, holder: current.owner }, rt('BaseItemOwnershipRecordV8'), EquipmentBaseOwnershipBcs)
        check(holder.item_id === owned.id && holder.ownership_epoch === owned.ownership_epoch, 'Owned Base ownership record mismatch')
        branch = { kind: 'owned-base', ownedBaseItemId: owned.id }
      } else {
        check(selection.access_subject === access.id && selection.source_epoch === '0'
          && eq(selection.pricing_commitment, loadout.maker_access_commitment), 'Base usage entitlement mismatch')
        branch = { kind: 'base' }
      }
      scopeKind = 0; scopeKey = 'maker/base'; scopeCommitment = root.content.content_commitment
      if (selection.color_channel_key !== null) selectedColor = await field(base.id, baseType('ColorKeyV8'),
        bcs.struct('ColorKeyV8', { channel_key: S }), { channel_key: selection.color_channel_key },
        baseType('ColorChannelRowV2'), EquipmentColorRowBcs)
    } else {
      const pack = (await readEquipmentPack(client, reads, { owner: current.owner, rootId: root.id,
        rootVersion: root.maker_version, rootCommitment: root.content.content_commitment, paymentCoinType: coin,
        baseRegistryId: base.id, packs, runtimeType: rt, baseType, query: { passId: selection.access_subject,
          style: { partKey: selection.part_key, itemKey: selection.item_key, styleKey: selection.style_key } } })).selected
      check(pack && pack.release.lifecycle === 2 && pack.admission?.admission_state === 0
        && pack.admission.semantic_pack_id === pack.release.semantic_pack_id
        && eq(pack.admission.release_content_commitment, pack.release.content_commitment)
        && pack.semanticReleaseId === pack.release.id && pack.release.observed_style_count === pack.release.expected_style_count
        && selection.source_definition_id === pack.release.id && selection.source_semantic_id === pack.release.semantic_pack_id
        && selection.source_epoch === '0' && eq(selection.pricing_commitment, equipmentReadPackPricing(pack.release)), 'Pack current admission/entitlement mismatch')
      const style = pack.styles[0]
      check(style?.protected && style.layer_track_key === selection.layer_track_key && style.color_channel_key === selection.color_channel_key
        && style.asset_blob_id === selection.asset_blob_id && eq(style.asset_sha256, selection.asset_sha256)
        && eq(style.asset_content_commitment, selection.asset_content_commitment), 'Pack selected style mismatch')
      check(selectedSlot.source_definition_id === (style.definition_sources.part === 2 ? pack.release.id : root.id),
        'Pack selection Part namespace mismatch')
      selectedColor = equipmentPackStyleColor(pack, style)
      styleBinding = style.seal_binding_commitment
      branch = { kind: 'pack', packReleaseId: pack.release.id, packPassId: pack.pass.id }
      scopeKind = 1; scopeKey = `pack/${pack.release.semantic_pack_id}`; scopeCommitment = pack.release.content_commitment
    }
    if (selection.color_channel_key !== null) {
      check(selectedColor?.key === selection.color_channel_key
        && selectedColor.swatches.some(row => row.key === selection.swatch_key), 'Selected color/swatch missing')
    } else check(selection.swatch_key === null, 'Swatch without color channel')
    const key = { scope_kind: scopeKind, scope_key: scopeKey, asset_key: `${selection.part_key}/${selection.item_key}/${selection.style_key}` }
    let asset = await field(registry.assets.id, st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key, st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, true)
    if (asset === null) asset = await field(registry.runtime_assets.id, st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs, key, st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, true)
    check(asset, 'Exact protected equipment asset missing')
    const aad = EquipmentSealIdBcs.serialize({ ...registry, ...key,
      domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2', schema_revision: '2' }).toBytes()
    const sealId = completeReadHash(aad), blobId = selection.asset_blob_id
    check(nativeArtworkBlobId(blobId), 'Invalid ciphertext Blob identity')
    check(asset.scope_kind === key.scope_kind && asset.scope_key === key.scope_key && asset.asset_key === key.asset_key
      && eq(asset.scope_commitment, scopeCommitment) && eq(asset.asset_content_commitment, selection.asset_content_commitment)
      && asset.ciphertext_blob_id === blobId && eq(asset.ciphertext_sha256, selection.asset_sha256)
      && eq(asset.seal_id, sealId) && eq(asset.ciphertext_blob_commitment, asset.ciphertext_blob_commitment)
      && eq(asset.certification_commitment, completeReadCertificationHash(registry, asset))
      && eq(selection.seal_binding_commitment, equipmentSealBinding(registry, asset))
      && (!styleBinding || eq(styleBinding, selection.seal_binding_commitment)), 'Exact equipment ciphertext/certification mismatch')
    return { ...branch, schema: 'native-equipment-read-v1', soulId: current.soulId, stateId: current.stateId,
      owner: current.owner, ownershipEpoch: current.ownershipEpoch, bindingId: current.provenanceBindingId,
      rootId: root.id, protocolConfigId: protocol.id, catalogId, releaseConfigId, sealRegistryId: registry.id,
      sealPolicyId: policy.id, paymentCoinType: coin, loadoutId: loadout.id, loadoutRevision: loadout.revision,
      loadoutCommitment: hex(loadout.commitment), runtimeDefinitionsId: definitions.id, baseRegistryId: base.id,
      packRegistryId: packs.id, makerAccessId: access.id, selectionIndex: input.selectionIndex,
      slot: { partKey: selection.part_key, itemKey: selection.item_key, styleKey: selection.style_key,
        colorChannelKey: selection.color_channel_key, swatchKey: selection.swatch_key, layerTrackKey: selection.layer_track_key,
        sourceClass: selection.source_class, sourceDefinitionId: selection.source_definition_id,
        sourceSemanticId: selection.source_semantic_id, accessSubject: selection.access_subject, sourceEpoch: selection.source_epoch,
        pricingCommitment: hex(selection.pricing_commitment), assetContentCommitment: hex(selection.asset_content_commitment),
        sealBindingCommitment: hex(selection.seal_binding_commitment) }, release: { ...target.release! },
      ciphertext: { blobId, sha256: hex(selection.asset_sha256), sealId, aadBase64: toBase64(aad),
        ciphertextBlobCommitment: hex(asset.ciphertext_blob_commitment), certificationCommitment: hex(asset.certification_commitment) },
      policy: { keyServers: policy.key_servers.map(row => ({ objectId: row.key_server_id, weight: row.weight,
        ...(aggregators.has(row.key_server_id) ? { aggregatorUrl: aggregators.get(row.key_server_id)! } : {}) })),
        threshold: policy.threshold, maxPlaintextBytes: Number(policy.max_plaintext_bytes), cipherSuite: policy.cipher_suite,
        keyDerivation: policy.key_derivation, ciphertextFormat: policy.ciphertext_format } } as NativeEquipmentReadTarget
  } finally {
    await reads.verify()
    signal?.throwIfAborted()
  }
}
