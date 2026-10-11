import { bcs } from '@mysten/sui/bcs'
import { createHash } from 'node:crypto'
import { nativeRenderSourceFixture } from './native-render-source'
import { NativeSoulBindingBcs, type NativeReceiveTarget } from '../../../web/lib/animacraft/native-receive'
import { EquipmentBaseItemBcs } from '../../../web/lib/animacraft/native-equipment'
import { EquipmentMakerBcs, EquipmentBaseRegistryBcs, EquipmentStyleRowBcs, EquipmentAssetRowBcs,
  EquipmentDefinitionsBcs, EquipmentProfileBcs, EquipmentPartRowBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { nativeVisibilityCommitment } from '../../../web/lib/animacraft/native-visibility'
import { EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../../web/lib/animacraft/native-equipment-pack'
import { readNativeEquipmentRenderTarget } from '../../../web/lib/animacraft/native-equipment-render'
export const renderId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const id = renderId
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const json = (value: unknown) => JSON.stringify(canonical(value))
const hash = (value: string) => [...createHash('sha256').update(value).digest()]
const hex = (value: number[]) => Buffer.from(value).toString('hex')
export function nativeEquipmentRenderFixture(kind: 'base' | 'pack' = 'base', protectedLayer = false, publicMedia?: Uint8Array) {
  const f = nativeRenderSourceFixture()
  // Sparse Soul equipment uses distinct Parts, never three slots in one Part.
  // Preserve the authored body capacity3; it does not expand Soul equipment.
  const keys = ['spare-one', 'spare-two', 'body']
  const profileKey = bcs.struct('PartProfileKeyV8', { part_key: bcs.string() })
  const profileField = bcs.struct('Field', { id: bcs.Address, name: profileKey, value: EquipmentProfileBcs })
  const originalProfile = profileField.parse(f.objects.get(f.profileId).contents.value).value
  const partKey = bcs.struct('PartKeyV8', { key: bcs.string() })
  const partField = bcs.struct('Field', { id: bcs.Address, name: partKey, value: EquipmentPartRowBcs })
  const originalPart = partField.parse(f.objects.get(f.partId).contents.value).value
  const profiles = keys.map((part_key, index) => ({ ...originalProfile, index: String(index), part_key,
    capacity: part_key === 'body' ? '3' : '1', profile_commitment: Array(32).fill(index + 1) }))
  for (const profile of profiles) {
    f.field(id(91), f.runtimeType('PartProfileKeyV8'), profileKey, { part_key: profile.part_key },
      f.runtimeType('PartProfileV8'), EquipmentProfileBcs, profile)
    f.field(id(85), f.ct('base_registry_v8', 'PartKeyV8'), partKey, { key: profile.part_key },
      f.ct('base_registry_v8', 'PartRowV2'), EquipmentPartRowBcs, { ...originalPart, key: profile.part_key,
        sequence: profile.index, capacity: profile.capacity,
        visibility_commitment: nativeVisibilityCommitment({ level: 'PART', partKey: profile.part_key, itemKey: null, styleKey: null }, []) })
  }
  f.set(id(81), EquipmentDefinitionsBcs, registry => {
    registry.profile_keys = keys; registry.expected_profile_count = '3'; registry.observed_profile_count = '3'
    registry.profiles.size = '3'
  })
  const document = { canvas: { width: 512, height: 512, pixelMode: 'pixelated' },
    tracks: [{ key: 'front', renderOrder: 0 }], outputs: [{ key: 'main', label: 'Main', payload: { format: 'png' } }],
    ...(kind === 'base' && protectedLayer ? {
      assets: [{ id: 'hat', mediaType: 'image/png', byteLength: 3 }],
      parts: [{ key: f.baseSelection.part_key, items: [{ key: f.baseSelection.item_key, styles: [{
        key: f.baseSelection.style_key, assetId: 'hat', protected: true,
        payload: { animacraftSourceAsset: { sha256: hex(hash('png')), mediaType: 'image/png', byteLength: 3 } },
      }] }] }],
    } : {}) }
  const rootCommitment = hash(json({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document }))
  const renderer = hash(json({ schemaVersion: 'animacraft.maker-v8-renderer.v2', canvas: document.canvas,
    tracks: document.tracks, outputs: document.outputs.map(({ key, payload }) => ({ key, payload })) }))
  const mediaBlobId = Buffer.alloc(32, 41).toString('base64url')
  const makerBlobId = Buffer.alloc(32, 42).toString('base64url')
  const packBlobId = Buffer.alloc(32, 43).toString('base64url')
  const selection = structuredClone(kind === 'base' ? f.baseSelection : f.packSelection)
  if (publicMedia) {
    if (protectedLayer) throw new Error('Public browser media cannot stand in for protected ciphertext')
    selection.asset_sha256 = [...createHash('sha256').update(publicMedia).digest()]
  }
  Object.assign(selection, { selection_index: '2', asset_blob_id: mediaBlobId, protected: protectedLayer,
    seal_binding_commitment: protectedLayer ? Array(32).fill(7) : [] })
  const descriptor = { assetId: 'hat', blobId: mediaBlobId, sha256: hex(selection.asset_sha256), byteLength: publicMedia?.length ?? 100,
    mediaType: protectedLayer ? 'application/vnd.animacraft.seal-ciphertext' : 'image/png' }
  const makerManifest = { schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8, document,
    certifiedAssets: kind === 'base' ? [descriptor] : [] }
  const manifests = new Map<string, Uint8Array>([[makerBlobId, Buffer.from(json(makerManifest))]])
  f.set(id(10), EquipmentMakerBcs, root => {
    root.content.manifest_blob_id = makerBlobId; root.content.manifest_sha256 = hash(json(makerManifest))
    root.content.content_commitment = rootCommitment; root.content.renderer_commitment = renderer
  })
  f.set(id(13), NativeSoulBindingBcs, binding => { binding.root_content_commitment = rootCommitment })
  f.set(id(85), EquipmentBaseRegistryBcs, base => { base.root_content_commitment = rootCommitment })
  f.set(id(84), EquipmentBaseItemBcs, item => { item.root_content_commitment = rootCommitment; item.equip_lock.selection_index = '2' })
  const styleField = bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentStyleRowBcs })
  const assetField = bcs.struct('Field', { id: bcs.Address,
    name: bcs.struct('AssetKeyV2', { asset_id: bcs.string() }), value: EquipmentAssetRowBcs })
  if (kind === 'base') {
    f.set(f.styleId, styleField, row => { row.value.protected = protectedLayer; row.value.asset_blob_id = mediaBlobId
      row.value.asset_sha256 = selection.asset_sha256 })
    f.set(f.assetId, assetField, row => { row.value.media_type = descriptor.mediaType
      row.value.sha256 = selection.asset_sha256; row.value.byte_length = String(descriptor.byteLength) })
  } else {
    const asset = { ...descriptor, contentCommitment: hex(selection.asset_content_commitment), protected: protectedLayer,
      sealBindingCommitment: protectedLayer ? hex(selection.seal_binding_commitment) : null }
    const content = { schemaVersion: 'animacraft.maker-v8-pack-content.v1', protocolVersion: 8,
      rootId: id(10), rootVersion: '1', rootContentCommitment: hex(rootCommitment), semanticPackId: 'winter',
      styles: [{ partKey: selection.part_key, itemKey: selection.item_key, styleKey: selection.style_key,
        layerTrackKey: selection.layer_track_key, colorChannelKey: selection.color_channel_key, asset }] }
    const semantic = { ...content, styles: content.styles.map(style => ({ ...style,
      asset: { assetId: asset.assetId, contentCommitment: asset.contentCommitment, protected: asset.protected } })) }
    const contentCommitment = hash(json(semantic))
    const packManifest = { schemaVersion: 'animacraft.maker-v8-pack-manifest.v1', protocolVersion: 8,
      contentCommitment: hex(contentCommitment), content }
    manifests.set(packBlobId, Buffer.from(json(packManifest)))
    f.set(f.releaseId, EquipmentPackReleaseBcs, pack => { pack.root_content_commitment = rootCommitment
      pack.content_commitment = contentCommitment; pack.manifest_blob_id = packBlobId; pack.manifest_sha256 = hash(json(packManifest)) })
    f.set(f.packStyleId, bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }), row => {
      row.value.protected = protectedLayer; row.value.asset_blob_id = mediaBlobId; row.value.seal_binding_commitment = selection.seal_binding_commitment
      row.value.asset_sha256 = selection.asset_sha256
    })
  }
  f.editLoadout(row => { row.root_content_commitment = rootCommitment; row.selections = [null, null, selection]
    row.definition_slots = profiles.map(profile => ({ source_definition_id: id(10), part_key: profile.part_key,
      profile_commitment: profile.profile_commitment, start: profile.index, capacity: '1' })) })
  return { ...f, target: f.target as NativeReceiveTarget, manifests, makerBlobId, packBlobId, mediaBlobId, rootCommitment, selection,
    readScene: (signal?: AbortSignal) => readNativeEquipmentRenderTarget(f.client, f.target, { soulId: id(12), stateId: id(14) }, signal) }
}
