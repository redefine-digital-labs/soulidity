import { bcs, type BcsType } from '@mysten/sui/bcs'
import { MAKER_V8_BLEND_MODES, type MakerV8BlendMode } from '@soulidity/animacraft-render-core'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, parseStructTag } from '@mysten/sui/utils'
import { readNativeSourceAuthority } from './native-source-authority'
import { decodeNativeBcs, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet, EquipmentSelectionBcs } from './native-equipment'
import { EquipmentMakerBcs, EquipmentBaseRegistryBcs, EquipmentStyleRowBcs, EquipmentAssetRowBcs,
  EquipmentTrackRowBcs, EquipmentColorRowBcs, EquipmentExternalProductBcs, EquipmentPartRowBcs, EquipmentItemRowBcs } from './native-equipment-source-bcs'
import { EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs, validatePackDefinitionSources } from './native-equipment-pack'
import { findNativePackDefinitions, nativePackOwnedDefinition, validateNativePackRules, type NativePackDefinitions } from './native-pack-definitions'
import { equipmentBytesEqual, equipmentUtf8 } from './native-equipment-bytes'
import { nativeArtworkHex as hex } from './native-artwork-bytes'
import { evaluateNativeVisibilityRow, nativeVisibilitySelectorMatches, type NativeVisibilityLevel,
  type NativeVisibilitySubject, type NativeVisibilityToken } from './native-visibility'

const A = bcs.Address; const S = bcs.string()
type Selection = ReturnType<typeof EquipmentSelectionBcs.parse>
const sameHash = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_RENDER_SOURCE_INVALID', message)
}
const bounded = (value: string, max: number) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= BigInt(max)
const signed = (value: { negative: boolean; magnitude: string }, max: number) => {
  check(bounded(value.magnitude, max * 1000) && (!value.negative || value.magnitude !== '0'), 'Invalid signed transform')
  return Number(value.magnitude) / 1000 * (value.negative ? -1 : 1)
}
const key = (value: string) => equipmentUtf8(value).length > 0 && equipmentUtf8(value).length <= 128 && !/[\0/]/.test(value)
const rgba = (value: number) => `#${value.toString(16).padStart(8, '0')}`

type ReadObject = Parameters<EquipmentReadSet['accept']>[0]
/** Scene reads add Part/Item facts to every selected Style. Batch only this
 * rendering read set so the existing bounded browser session can still handle
 * 500 distinct selections without increasing its 4096-call budget. */
export class NativeRenderReadSet extends EquipmentReadSet {
  private snapshots = new Map<string, { version: bigint; digest: string }>()
  private pending: Array<{ id: string; type: string; kind: number; parent?: string;
    resolve: (value: Uint8Array | undefined) => void; reject: (error: unknown) => void }> = []
  private scheduled = false
  constructor(private renderClient: SuiGrpcClient) { super(renderClient) }
  override accept(object: ReadObject, id: string, type: string, kind: number, address?: string) {
    const result = super.accept(object, id, type, kind, address)
    if (kind !== 4) this.snapshots.set(id, { version: object!.version!, digest: object!.digest! })
    return result
  }
  override read(id: string, type: string, kind: number, parent?: string): Promise<Uint8Array | undefined> {
    receiveId(id)
    const result = new Promise<Uint8Array | undefined>((resolve, reject) => { this.pending.push({ id, type, kind, parent, resolve, reject }) })
    if (!this.scheduled) {
      this.scheduled = true
      void Promise.resolve().then(async () => {
        this.scheduled = false
        const batch = this.pending.splice(0)
        try {
          const values = await super.readMany(batch)
          batch.forEach((entry, index) => entry.resolve(values[index]))
        } catch (error) { batch.forEach(entry => entry.reject(error)) }
      })
    }
    return result
  }
  override async verify() {
    const entries = [...this.snapshots]
    for (let start = 0; start < entries.length; start += 400) {
      const requests = []
      for (let offset = start; offset < Math.min(start + 400, entries.length); offset += 50) {
        const batch = entries.slice(offset, offset + 50)
        requests.push((async () => {
          const { response } = await this.renderClient.ledgerService.batchGetObjects({
            requests: batch.map(([objectId]) => ({ objectId })), readMask: { paths: ['object_id', 'version', 'digest'] } })
          if (response.objects.length !== batch.length || response.objects.some((entry, index) => {
            const [id, before] = batch[index]
            return entry.result.oneofKind !== 'object' || entry.result.object.objectId !== id
              || entry.result.object.version !== before.version || entry.result.object.digest !== before.digest
          })) throw new NativeReceiveError('NATIVE_EQUIPMENT_CHANGED', 'Render source changed; retry the complete read', 409)
        })())
      }
      for (const result of await Promise.allSettled(requests)) if (result.status === 'rejected') throw result.reason
    }
  }
}

/** Content facts only: no wallet Pass discovery, admission/lifecycle/fee gate,
 * original/current merge decision, downloads, or implied decryption authority.
 * The caller obtains selections from the verified original recipe or equipment.
 * Every source is point-read; pagination is never evidence for a render layer. */
export async function readNativeRenderSource(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { rootId: string; makerVersion: string; rootCommitment: number[]; selections: Array<Selection | null> },
  options: { readSet?: EquipmentReadSet; signal?: AbortSignal } = {}) {
  input = structuredClone(input)
  options.signal?.throwIfAborted()
  const selections = input.selections
  check(selections.length > 0 && selections.length <= 500, 'Invalid render slot count')
  selections.forEach((selection, index) => {
    if (!selection) return
    check(selection.selection_index === String(index) && [0, 1, 2].includes(selection.source_class)
      && [selection.part_key, selection.item_key, selection.style_key, selection.layer_track_key].every(key), 'Invalid render slot identity')
  })
  const authority = await readNativeSourceAuthority(client, target)
  const { rootType, coreMarkerId, rt, baseType } = authority
  const reads = options.readSet ?? new EquipmentReadSet(client)
  const { response } = await client.ledgerService.getObject({ objectId: receiveId(input.rootId),
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
  check(response.object?.objectType, 'Missing render Maker type')
  const tag = parseStructTag(response.object.objectType)
  check(tag.typeParams.length === 1 && typeof tag.typeParams[0] !== 'string', 'Invalid render payment type')
  const coin = normalizeStructTag(tag.typeParams[0])
  const root = decodeNativeBcs(EquipmentMakerBcs, reads.accept(response.object, input.rootId, `${rootType}<${coin}>`, 3))
  check(root.id === input.rootId && root.version === '8' && root.maker_version === input.makerVersion
    && sameHash(root.content.content_commitment, input.rootCommitment)
    && root.core_original_package_id === target.coreOriginalPackageId && root.core_callable_package_id === coreMarkerId
    && root.economics.protocol_config_id === target.protocolConfigId && root.base_registry_id, 'Render Maker identity mismatch')
  const base = decodeNativeBcs(EquipmentBaseRegistryBcs,
    await reads.read(root.base_registry_id, baseType('BaseDefinitionRegistryV8'), 3))
  check(base.id === root.base_registry_id && base.version === '8' && base.sealed && base.root_id === root.id
    && base.maker_version === root.maker_version && sameHash(base.root_content_commitment, input.rootCommitment)
    && base.sealed_commitments && root.publication.sealed_base_registry_commitment
    && sameHash(base.sealed_commitments.aggregate, root.publication.sealed_base_registry_commitment), 'Render Base seal mismatch')

  const cached = new Map<string, Promise<unknown>>()
  const once = <T>(id: string, type: string, load: () => Promise<T>): Promise<T> => {
    const cacheKey = `${id}:${type}`
    if (!cached.has(cacheKey)) cached.set(cacheKey, load())
    return cached.get(cacheKey) as Promise<T>
  }
  const object = <T, I>(id: string, type: string, schema: BcsType<T, I>) => once(id, type,
    async () => decodeNativeBcs(schema, await reads.read(receiveId(id), type, 3)))
  async function field<T, I>(parent: string, keyType: string, keySchema: BcsType<any, any>, name: unknown,
    valueType: string, schema: BcsType<T, I>): Promise<T> {
    const keyBytes = keySchema.serialize(name).toBytes()
    const id = deriveDynamicFieldID(parent, keyType, keyBytes)
    const type = `0x2::dynamic_field::Field<${keyType},${valueType}>`
    return once(id, type, async () => {
      const result = decodeNativeBcs(bcs.struct('Field', { id: A, name: keySchema, value: schema }), await reads.read(id, type, 2, parent))
      check(result.id === id && equipmentBytesEqual(keySchema.serialize(result.name).toBytes(), keyBytes), 'Render field key mismatch')
      return result.value
    })
  }
  const layer = async (selection: Selection) => {
    const styleKey = { part_key: selection.part_key, item_key: selection.item_key, style_key: selection.style_key }
    const violations: NativeVisibilityLevel[] = []
    const programs: Array<{ subject: NativeVisibilitySubject;
      row: { visibility_tokens: NativeVisibilityToken[]; visibility_commitment: number[] };
      local: NativePackDefinitions | null }> = []
    const program = (subject: NativeVisibilitySubject,
      row: { visibility_tokens: NativeVisibilityToken[]; visibility_commitment: number[] },
      local: NativePackDefinitions | null = null) => { programs.push({ subject, row, local }) }
    let pack: ReturnType<typeof EquipmentPackReleaseBcs.parse> | null = null
    let packStyle: ReturnType<typeof EquipmentPackStyleBcs.parse> | null = null
    let definitions: NativePackDefinitions | null = null
    if (selection.source_class === 1) {
      pack = await object(selection.source_definition_id, `${rt('PackReleaseV8')}<${coin}>`, EquipmentPackReleaseBcs)
      check(pack.id === selection.source_definition_id && pack.version === '8' && pack.root_id === root.id
        && pack.root_version === root.maker_version && sameHash(pack.root_content_commitment, input.rootCommitment)
        && pack.semantic_pack_id === selection.source_semantic_id, 'Pack render source mismatch')
      packStyle = await field(pack.styles.id, rt('PackStyleKeyV8'), EquipmentPackStyleKeyBcs, styleKey, rt('PackStyleV8'), EquipmentPackStyleBcs)
      validatePackDefinitionSources(packStyle, check)
      const boundPack = pack
      definitions = await once(pack.id, rt('PackDefinitionsV8'), () => findNativePackDefinitions(reads, boundPack, rt))
      check(!Object.values(packStyle.definition_sources).includes(2) || definitions, 'Pack definitions missing')
      if (definitions) validateNativePackRules(definitions)
    }
    const ownedColor = definitions && packStyle?.definition_sources.color === 2 && selection.color_channel_key !== null
      ? nativePackOwnedDefinition(definitions, 'colors', selection.color_channel_key) : null
    const ownedPart = definitions && packStyle?.definition_sources.part === 2
      ? nativePackOwnedDefinition(definitions, 'parts', selection.part_key) : null
    const ownedTrack = definitions && packStyle?.definition_sources.track === 2
      ? nativePackOwnedDefinition(definitions, 'tracks', selection.layer_track_key) : null
    // These exact IDs depend only on the already bound selection. Read them
    // together, but settle every request before propagating any failure.
    const pending = {
      part: ownedPart ? Promise.resolve(ownedPart) : field(base.id, baseType('PartKeyV8'), bcs.struct('PartKeyV8', { key: S }),
        { key: selection.part_key }, baseType('PartRowV2'), EquipmentPartRowBcs),
      item: selection.source_class === 0 ? field(base.id, baseType('ItemKeyV8'), bcs.struct('ItemKeyV8', { part_key: S, item_key: S }),
        { part_key: selection.part_key, item_key: selection.item_key }, baseType('ItemRowV2'), EquipmentItemRowBcs) : Promise.resolve(null),
      style: selection.source_class === 0 ? field(base.id, baseType('StyleKeyV8'), EquipmentPackStyleKeyBcs,
        styleKey, baseType('StyleRowV2'), EquipmentStyleRowBcs) : Promise.resolve(null),
      track: ownedTrack ? Promise.resolve(ownedTrack) : field(base.id, baseType('TrackKeyV8'), bcs.struct('TrackKeyV8', { key: S }),
        { key: selection.layer_track_key }, baseType('TrackRowV2'), EquipmentTrackRowBcs),
      color: selection.color_channel_key !== null ? ownedColor
        ? Promise.resolve(ownedColor)
        : field(base.id, baseType('ColorKeyV8'), bcs.struct('ColorKeyV8', { channel_key: S }),
        { channel_key: selection.color_channel_key }, baseType('ColorChannelRowV2'), EquipmentColorRowBcs) : Promise.resolve(null),
    }
    for (const result of await Promise.allSettled(Object.values(pending))) if (result.status === 'rejected') throw result.reason
    const part = await pending.part
    check(part.key === selection.part_key, 'Render Part identity mismatch')
    program({ level: 'PART', partKey: selection.part_key, itemKey: null, styleKey: null,
      definitionSource: ownedPart ? 2 : 1, definitionSourceKey: ownedPart ? pack!.semantic_pack_id : null }, part, ownedPart ? definitions : null)
    if (definitions) {
      for (const [subject, level] of [[1, 'ITEM'], [2, 'STYLE']] as const) {
        const rows = definitions.rows.visibility.filter(row => row.subject === subject
          && row.part_key === selection.part_key && row.item_key === selection.item_key
          && row.style_key === (subject === 1 ? null : selection.style_key))
        check(rows.length === 1, 'Pack visibility row missing/ambiguous')
        const row = rows[0]
        check(subject === 2 ? row.definition_source === 2 : [1, 2].includes(row.definition_source), 'Pack visibility source mismatch')
        const visibilitySubject = { level, partKey: selection.part_key, itemKey: selection.item_key,
          styleKey: subject === 1 ? null : selection.style_key,
          definitionSource: row.definition_source as 1 | 2,
          definitionSourceKey: row.definition_source === 1 ? null : definitions.rows.semantic_pack_id }
        program(visibilitySubject, row, row.definition_source === 2 ? definitions : null)
        // Inherited Items retain their actual Base condition. The Pack entry
        // binds that identity but does not replace the Core Item's program.
        if (subject === 1 && row.definition_source === 1) {
          const inherited = await field(base.id, baseType('ItemKeyV8'), bcs.struct('ItemKeyV8', { part_key: S, item_key: S }),
            { part_key: selection.part_key, item_key: selection.item_key }, baseType('ItemRowV2'), EquipmentItemRowBcs)
          check(inherited.part_key === selection.part_key && inherited.item_key === selection.item_key, 'Pack inherited Item mismatch')
          program(visibilitySubject, inherited)
        }
      }
    }
    let transform = { x: 0, y: 0, scale: 1, rotation: 0 }; let opacity = 1
    let blendMode: MakerV8BlendMode = 'normal'; let displayOrder = 0
    let asset: { assetId: string; blobId: string; sha256: string; mediaType: string; byteLength: number } | null = null
    if (selection.source_class === 0) {
      check(selection.source_definition_id === root.id && selection.source_semantic_id === '', 'Base render source mismatch')
      const item = await pending.item
      check(item, 'Missing Base Item')
      check(item.part_key === selection.part_key && item.item_key === selection.item_key, 'Render Item identity mismatch')
      program({ level: 'ITEM', partKey: selection.part_key, itemKey: selection.item_key, styleKey: null }, item)
      const style = await pending.style
      check(style, 'Missing Base Style')
      check(style.part_key === selection.part_key && style.item_key === selection.item_key && style.style_key === selection.style_key
        && style.track_key === selection.layer_track_key && style.color_channel_key === selection.color_channel_key
        && style.asset_blob_id === selection.asset_blob_id && sameHash(style.asset_sha256, selection.asset_sha256)
        && sameHash(style.payload_commitment, selection.asset_content_commitment) && style.protected === selection.protected, 'Base render selection mismatch')
      program({ level: 'STYLE', partKey: selection.part_key, itemKey: selection.item_key, styleKey: selection.style_key }, style)
      const descriptor = await field(base.id, baseType('AssetKeyV2'), bcs.struct('AssetKeyV2', { asset_id: S }),
        { asset_id: style.asset_id }, baseType('AssetRowV2'), EquipmentAssetRowBcs)
      check(descriptor.asset_id === style.asset_id && sameHash(descriptor.sha256, selection.asset_sha256)
        && bounded(descriptor.byte_length, 8 * 1024 * 1024) && descriptor.byte_length !== '0', 'Base asset descriptor mismatch')
      check(bounded(style.display_order, Number.MAX_SAFE_INTEGER) && bounded(style.transform.scale_ppm, 100_000_000)
        && style.transform.scale_ppm !== '0' && bounded(style.opacity_ppm, 1_000_000)
        && style.blend_mode < MAKER_V8_BLEND_MODES.length, 'Base render transform mismatch')
      transform = { x: signed(style.transform.x_milli, 8192), y: signed(style.transform.y_milli, 8192),
        rotation: signed(style.transform.rotation_millidegrees, 360), scale: Number(style.transform.scale_ppm) / 1_000_000 }
      opacity = Number(style.opacity_ppm) / 1_000_000; displayOrder = Number(style.display_order)
      blendMode = MAKER_V8_BLEND_MODES[style.blend_mode]
      asset = { assetId: descriptor.asset_id, blobId: selection.asset_blob_id, sha256: hex(descriptor.sha256),
        mediaType: descriptor.media_type, byteLength: Number(descriptor.byte_length) }
    } else if (selection.source_class === 1) {
      const style = packStyle
      check(style, 'Missing Pack Style')
      check(style.part_key === selection.part_key && style.item_key === selection.item_key && style.style_key === selection.style_key
        && style.layer_track_key === selection.layer_track_key && style.color_channel_key === selection.color_channel_key
        && style.asset_blob_id === selection.asset_blob_id && sameHash(style.asset_sha256, selection.asset_sha256)
        && sameHash(style.asset_content_commitment, selection.asset_content_commitment) && style.protected === selection.protected,
      'Pack render selection mismatch')
      check(selection.protected ? sameHash(style.seal_binding_commitment, selection.seal_binding_commitment)
        : style.seal_binding_commitment.length === 0 && selection.seal_binding_commitment.length === 0, 'Pack Seal binding mismatch')
      // Pack transport metadata is in the hash-bound release manifest, never
      // guessed from extension or copied from another Pack with the same keys.
    } else {
      const product = await object(selection.source_definition_id, rt('ExternalItemProductV8'), EquipmentExternalProductBcs)
      check(product.id === selection.source_definition_id && product.version === '8' && product.root_id === root.id
        && product.root_version === root.maker_version && sameHash(product.root_content_commitment, input.rootCommitment)
        && product.part_key === selection.part_key && product.item_key === selection.item_key && product.style_key === selection.style_key
        && product.layer_track_key === selection.layer_track_key && product.color_channel_key === selection.color_channel_key
        && product.default_swatch_key === selection.swatch_key
        && product.asset_blob_id === selection.asset_blob_id && sameHash(product.asset_sha256, selection.asset_sha256)
        && sameHash(product.asset_content_commitment, selection.asset_content_commitment)
        && selection.source_semantic_id === '' && !selection.protected && selection.seal_binding_commitment.length === 0,
      'External render selection mismatch')
      check(bounded(product.asset_byte_length, 8 * 1024 * 1024) && product.asset_byte_length !== '0', 'External asset size mismatch')
      asset = { assetId: product.id, blobId: product.asset_blob_id, sha256: hex(product.asset_sha256),
        mediaType: product.asset_media_type, byteLength: Number(product.asset_byte_length) }
    }
    const track = await pending.track
    check(track.key === selection.layer_track_key && bounded(track.render_order, Number.MAX_SAFE_INTEGER), 'Render track mismatch')
    let swatch: { key: string; rgba: string; stops: Array<{ offset: number; rgba: string }> } | null = null
    if (selection.color_channel_key !== null) {
      const color = await pending.color
      check(color, 'Missing render color')
      const matches = color.swatches.filter(row => row.key === selection.swatch_key)
      check(color.key === selection.color_channel_key && selection.swatch_key !== null && matches.length === 1, 'Render swatch mismatch')
      swatch = { key: matches[0].key, rgba: rgba(matches[0].rgba), stops: matches[0].stops.map(stop => {
        check(bounded(stop.offset_ppm, 1_000_000), 'Render color stop mismatch')
        return { offset: Number(stop.offset_ppm) / 1_000_000, rgba: rgba(stop.rgba) }
      }) }
    } else check(selection.swatch_key === null, 'Unexpected render swatch')
    return { selectionIndex: Number(selection.selection_index), selection, asset, pack, transform, opacity, blendMode,
      displayOrder, trackOrder: Number(track.render_order), trackSource: ownedTrack ? 2 : 1,
      swatch, protected: selection.protected, violations, programs,
      partDefinitionId: ownedPart ? pack!.id : root.id }
  }
  const layers: Awaited<ReturnType<typeof layer>>[] = []
  // Await all in-flight reads even on failure before leaving the read operation.
  const selected = selections.filter((v): v is Selection => v !== null)
  for (let start = 0; start < selected.length; start += 8) {
    options.signal?.throwIfAborted()
    const results = await Promise.allSettled(selected.slice(start, start + 8).map(layer))
    for (const result of results) { if (result.status === 'rejected') throw result.reason; layers.push(result.value) }
  }
  // Resolve every exact Style/Part source before any condition is evaluated.
  // Labels and selection source_class alone cannot establish Part namespace.
  const partSources = new Map(layers.map(row => [row.selectionIndex, row.partDefinitionId]))
  for (const layer of layers) {
    for (const { subject, row, local } of layer.programs) {
      const ownParts = new Set(local?.rows.parts.map(part => part.key) ?? [])
      const visible = evaluateNativeVisibilityRow(subject, row, selections, (selector, selected) => {
        const expectedSource = ownParts.has(selector.part_key) ? local!.release_id : root.id
        if (partSources.get(Number(selected.selection_index)) !== expectedSource) return false
        const localBase = local && selector.source === 1 && selected.source_class === 1
          && selected.source_definition_id === local.release_id
        return nativeVisibilitySelectorMatches(selector, localBase ? { ...selected, source_class: 0 } : selected)
      })
      if (!visible && !layer.violations.includes(subject.level)) layer.violations.push(subject.level)
    }
  }
  // A shared caller owns the final verification after manifest awaits. A
  // standalone source read must still validate its own complete read set.
  if (!options.readSet) await reads.verify()
  options.signal?.throwIfAborted()
  const violations = layers.filter(row => row.violations.length > 0).map(row => ({ selectionIndex: row.selectionIndex, levels: row.violations }))
  return { root, layers: layers.map(({ programs: _programs, partDefinitionId: _partDefinitionId, ...layer }) => layer),
    selections, selectionIndexes: layers.map(row => row.selectionIndex),
    visibility: { valid: violations.length === 0, violations }, authority: 'CONTENT_ONLY' as const }
}
