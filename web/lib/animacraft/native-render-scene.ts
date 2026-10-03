import { nativeArtworkBlobId, nativeArtworkConcat, nativeArtworkHash, nativeArtworkHex as hex } from './native-artwork-bytes'
import { equipmentUtf8 } from './native-equipment-bytes'
import type { ResolvedMakerV8Layer, RenderAssetEvidence } from '@soulidity/animacraft-render-core'
import { isMakerV8SourceAsset, MAKER_V8_BLEND_MODES } from '@soulidity/animacraft-render-core'
import { getBlobUrl, profileReadStep } from '@soulidity/sdk'
import { NativeReceiveError } from './native-receive'
import type { readNativeRenderSource } from './native-render-source'
import { assertNativeSceneVisibility } from './native-visibility'
import { EquipmentSelectionBcs } from './native-equipment'
import { equipmentBytesEqual } from './native-equipment-bytes'

type Source = Awaited<ReturnType<typeof readNativeRenderSource>>
const hash = (bytes: Uint8Array | string) => hex(nativeArtworkHash(bytes))
const MAX_MANIFEST = 12 * 1024 * 1024
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_RENDER_MANIFEST_INVALID', message)
}
function record(value: unknown): Record<string, any> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Manifest record required')
  return value as Record<string, any>
}
function canonical(value: unknown, depth = 0): unknown {
  check(depth <= 64, 'Manifest nesting exceeds limit')
  if (Array.isArray(value)) return value.map(v => canonical(v, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(k => [k, canonical((value as Record<string, unknown>)[k], depth + 1)]))
  check(value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value), 'Invalid manifest value')
  return value
}
const json = (value: unknown) => JSON.stringify(canonical(value))

function selectedStyle(document: Record<string, any>, selection: Source['layers'][number]['selection']) {
  const styles = (document.parts ?? []).filter((part: any) => part.key === selection.part_key)
    .flatMap((part: any) => part.items.filter((item: any) => item.key === selection.item_key))
    .flatMap((item: any) => item.styles.filter((style: any) => style.key === selection.style_key))
  check(styles.length === 1, 'Authored Style identity missing or ambiguous')
  return styles[0]
}

function originalSource(document: Record<string, any>, selection: Source['layers'][number]['selection'], assetId: string) {
  const style = selectedStyle(document, selection)
  check(style.assetId === assetId && style.protected === true,
    'Protected source Style identity mismatch')
  const source = style.payload?.animacraftSourceAsset
  const descriptors = (document.assets ?? []).filter((asset: any) => asset.id === assetId)
  check(isMakerV8SourceAsset(source) && descriptors.length === 1
    && source.mediaType === descriptors[0].mediaType && source.byteLength === descriptors[0].byteLength,
  'Protected source metadata missing or mismatched')
  return { ...source }
}

/** Storage transport accepts only canonical Walrus IDs and configured aggregator.
 * No user URL, cookies, redirect, unbounded stream or plaintext fallback. */
export async function fetchNativeRenderBlob(blobId: string, maximumBytes: number,
  signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  check(nativeArtworkBlobId(blobId),
    'Noncanonical render Blob ID')
  check(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= MAX_MANIFEST, 'Invalid render byte limit')
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  abort.throwIfAborted()
  let received: Response | undefined, discarded = false
  const discard = (response: Response) => {
    if (!discarded) { discarded = true; void response.body?.cancel().catch(() => {}) }
  }
  const pending = fetcher(getBlobUrl(blobId), { redirect: 'error', credentials: 'omit', signal: abort }).then(response => {
    received = response
    if (abort.aborted) discard(response)
    return response
  })
  // If cancellation skips run(), a late transport rejection still has an owner.
  void pending.catch(() => {})
  // Own the response across every microtask between fetch and body-reader handoff.
  let response: Response
  try { response = await profileReadStep(abort, () => pending, discard); abort.throwIfAborted() }
  catch (error) { if (received) discard(received); throw error }
  if (!response.ok) discard(response)
  check(response.ok && response.body, 'Render storage unavailable')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    discard(response); throw new NativeReceiveError('NATIVE_RENDER_TOO_LARGE', 'Render bytes exceed limit', 413)
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const result = await profileReadStep(abort, () => reader.read()); if (result.done) break
      length += result.value.length
      if (length > maximumBytes) throw new NativeReceiveError('NATIVE_RENDER_TOO_LARGE', 'Render bytes exceed limit', 413)
      chunks.push(result.value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  abort.throwIfAborted()
  return nativeArtworkConcat(chunks, length)
}

function assetEvidence(value: unknown, protectedAsset: boolean, sourceClass: number): RenderAssetEvidence & { blobId: string } {
  const asset = record(value)
  check(typeof asset.assetId === 'string' && equipmentUtf8(asset.assetId).length > 0 && equipmentUtf8(asset.assetId).length <= 128
    && !/[\0/]/.test(asset.assetId) && typeof asset.blobId === 'string' && asset.blobId.length > 0
    && asset.blobId.length <= 512 && /^[0-9a-f]{64}$/.test(asset.sha256)
    && Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0 && asset.byteLength <= 8 * 1024 * 1024
    && (protectedAsset ? asset.mediaType === 'application/vnd.animacraft.seal-ciphertext'
      : sourceClass === 1 ? ['image/png', 'image/webp'].includes(asset.mediaType)
        : sourceClass === 2 ? ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(asset.mediaType)
          : typeof asset.mediaType === 'string' && asset.mediaType.length <= 256 && /^image\/[A-Za-z0-9.+-]+$/.test(asset.mediaType)), 'Invalid certified render asset')
  return { assetId: asset.assetId, blobId: asset.blobId, sha256: asset.sha256, byteLength: asset.byteLength, mediaType: asset.mediaType }
}

/** Resolve rendering fields only from hash-bound manifests + exact chain rows.
 * This is not a publisher validator and never grants commerce/decrypt authority. */
export async function resolveNativeRenderScene(source: Source, options: {
  signal?: AbortSignal; fetchBlob?: (blobId: string, maximumBytes: number) => Promise<Uint8Array>;
  completedOutput?: { outputKey: string; rendererSchemaCommitment: string }
} = {}) {
  source = structuredClone(source)
  check(Array.isArray(source.selections) && source.selections.length > 0 && source.selections.length <= 500
    && Array.isArray(source.layers) && Array.isArray(source.selectionIndexes), 'Incomplete source selections')
  const selected = source.selections.flatMap((selection, index) => selection ? [{ selection, index }] : [])
  check(source.layers.length === selected.length && source.selectionIndexes.length === selected.length
    && source.layers.every((row, position) => row.selectionIndex === selected[position].index
      && source.selectionIndexes[position] === selected[position].index
      && equipmentBytesEqual(EquipmentSelectionBcs.serialize(row.selection).toBytes(),
        EquipmentSelectionBcs.serialize(selected[position].selection).toBytes())
      && Array.isArray(row.violations)), 'Source layers do not cover every selected slot')
  const violations = source.layers.filter(row => row.violations.length > 0)
    .map(row => ({ selectionIndex: row.selectionIndex, levels: row.violations }))
  check(source.visibility?.valid === (violations.length === 0)
    && JSON.stringify(source.visibility.violations) === JSON.stringify(violations), 'Source visibility evidence mismatch')
  const fetchBlob = options.fetchBlob ?? ((blobId, maximumBytes) => fetchNativeRenderBlob(blobId, maximumBytes, options.signal))
  const cache = new Map<string, Promise<Record<string, any>>>()
  let totalBytes = 0
  const manifest = (blobId: string, sha: string) => {
    const key = `${blobId}:${sha}`
    if (!cache.has(key)) cache.set(key, (async () => {
      const bytes = await fetchBlob(blobId, MAX_MANIFEST)
      check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_MANIFEST, 'Manifest byte limit exceeded')
      totalBytes += bytes.length; check(totalBytes <= 32 * 1024 * 1024, 'Scene manifests exceed total byte budget')
      check(hash(bytes) === sha, 'Render manifest SHA mismatch')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const parsed = record(JSON.parse(text)); check(json(parsed) === text, 'Noncanonical render manifest')
      return parsed
    })())
    return cache.get(key)!
  }
  const root = source.root
  const maker = await manifest(root.content.manifest_blob_id, hex(root.content.manifest_sha256))
  check(maker.schemaVersion === 'animacraft.maker-v8-manifest.v2' && maker.protocolVersion === 8, 'Wrong Maker manifest schema')
  const doc = record(maker.document); const canvas = record(doc.canvas)
  check([canvas.width, canvas.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 8192)
    && ['smooth', 'pixelated'].includes(canvas.pixelMode) && Array.isArray(doc.tracks) && Array.isArray(doc.outputs), 'Invalid Maker render configuration')
  check(hash(json({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document: doc })) === hex(root.content.content_commitment),
    'Maker public content commitment mismatch')
  check(hash(json({ schemaVersion: 'animacraft.maker-v8-renderer.v2', canvas,
    tracks: doc.tracks.map(({ key, renderOrder }: any) => ({ key, renderOrder })),
    outputs: doc.outputs.map(({ key, payload }: any) => ({ key, payload })) })) === hex(root.content.renderer_commitment),
  'Maker renderer commitment mismatch')
  if (options.completedOutput) {
    const outputs = doc.outputs.filter((output: any) => output.key === options.completedOutput!.outputKey)
    check(outputs.length === 1 && hash(json({ schemaVersion: 'animacraft.maker-v8-output-renderer.v1',
      key: outputs[0].key, label: outputs[0].label, payload: outputs[0].payload, canvas }))
      === options.completedOutput.rendererSchemaCommitment, 'Completed output renderer commitment mismatch')
  }
  const layers: ResolvedMakerV8Layer[] = []
  for (const row of source.layers) {
    const selection = row.selection
    const checkTrack = (document: Record<string, any>) => {
      check(Array.isArray(document.tracks), 'Manifest tracks missing')
      const matchingTracks = document.tracks.filter((track: any) => track.key === selection.layer_track_key)
      check(matchingTracks.length === 1 && matchingTracks[0].renderOrder === row.trackOrder, 'Manifest/chain track mismatch')
    }
    if (row.trackSource !== 2) checkTrack(doc)
    else check(row.pack, 'Owned track requires Pack metadata')
    let asset = row.asset
    let appearance = { transform: row.transform, opacity: row.opacity, blendMode: row.blendMode, displayOrder: row.displayOrder }
    let sourceAsset: ResolvedMakerV8Layer['sourceAsset'] = null
    if (row.pack) {
      const pack = row.pack
      const m = await manifest(pack.manifest_blob_id, hex(pack.manifest_sha256)); const content = record(m.content)
      check(m.schemaVersion === 'animacraft.maker-v8-pack-manifest.v1' && m.protocolVersion === 8
        && content.schemaVersion === 'animacraft.maker-v8-pack-content.v1' && content.protocolVersion === 8
        && content.rootId === root.id && content.rootVersion === root.maker_version
        && content.rootContentCommitment === hex(root.content.content_commitment) && content.semanticPackId === pack.semantic_pack_id
        && m.contentCommitment === hex(pack.content_commitment) && Array.isArray(content.styles), 'Pack manifest binding mismatch')
      const semantic = { ...content, styles: content.styles.map((style: any) => ({ ...style,
        asset: { assetId: record(style.asset).assetId, contentCommitment: style.asset.contentCommitment, protected: style.asset.protected } })) }
      check(hash(json(semantic)) === m.contentCommitment, 'Pack semantic content mismatch')
      const matches = content.styles.filter((style: any) => style.partKey === selection.part_key
        && style.itemKey === selection.item_key && style.styleKey === selection.style_key)
      check(matches.length === 1, 'Pack manifest style missing or ambiguous')
      const style = matches[0]; const descriptor = record(style.asset)
      check(style.layerTrackKey === selection.layer_track_key && style.colorChannelKey === selection.color_channel_key
        && descriptor.contentCommitment === hex(selection.asset_content_commitment)
        && descriptor.protected === selection.protected
        && descriptor.sealBindingCommitment === (selection.protected ? hex(selection.seal_binding_commitment) : null), 'Pack manifest style mismatch')
      asset = assetEvidence(descriptor, row.protected, 1)
      check(row.trackSource !== 2 || content.authoring != null, 'Owned track authoring missing')
      if (content.authoring != null) {
        check(content.authoring.schemaVersion === 'animacraft.maker-v8-pack-authoring-content.v1', 'Invalid Pack authoring schema')
        check(json(record(content.authoring.parent).document) === json(doc), 'Pack parent document mismatch')
        const authoredDocument = record(content.authoring.document)
        if (row.trackSource === 2) checkTrack(authoredDocument)
        const authored = selectedStyle(authoredDocument, selection)
        check(authored.assetId === asset.assetId && authored.trackKey === style.layerTrackKey
          && authored.colorChannelKey === style.colorChannelKey && authored.defaultSwatchKey === style.defaultSwatchKey
          && authored.protected === selection.protected, 'Pack authored Style/index mismatch')
        const t = record(authored.transform)
        check(Number.isFinite(t.x) && Math.abs(t.x) <= 8192 && Number.isFinite(t.y) && Math.abs(t.y) <= 8192
          && Number.isFinite(t.scale) && t.scale > 0 && t.scale <= 100
          && Number.isFinite(t.rotation) && Math.abs(t.rotation) <= 360
          && Number.isFinite(authored.opacity) && authored.opacity >= 0 && authored.opacity <= 1
          && Number.isSafeInteger(authored.displayOrder) && MAKER_V8_BLEND_MODES.includes(authored.blendMode),
        'Invalid Pack authored appearance')
        appearance = { transform: { x: t.x, y: t.y, scale: t.scale, rotation: t.rotation },
          opacity: authored.opacity, blendMode: authored.blendMode, displayOrder: authored.displayOrder }
        if (row.protected) sourceAsset = originalSource(authoredDocument, selection, asset.assetId)
      }
    } else if (selection.source_class === 0) {
      check(Array.isArray(maker.certifiedAssets), 'Maker certified assets missing')
      const matches = maker.certifiedAssets.filter((a: any) => a.assetId === asset?.assetId)
      check(matches.length === 1 && json(assetEvidence(matches[0], row.protected, 0)) === json(asset), 'Maker asset descriptor mismatch')
      if (row.protected) sourceAsset = originalSource(doc, selection, asset!.assetId)
    }
    check(asset && asset.blobId === selection.asset_blob_id && asset.sha256 === hex(selection.asset_sha256), 'Scene asset selection mismatch')
    const resolved = assetEvidence(asset, row.protected, selection.source_class)
    // False conditions hide pixels only after every selected layer's exact
    // chain and manifest metadata has passed the same identity checks.
    if (row.violations.length > 0) continue
    layers.push({ selectionIndex: row.selectionIndex, selection: { source: (['BASE', 'PACK', 'EXTERNAL'] as const)[selection.source_class],
      partKey: selection.part_key, itemKey: selection.item_key, styleKey: selection.style_key },
    asset: resolved, ...appearance,
    trackOrder: row.trackOrder, swatch: row.swatch, protected: row.protected, sourceAsset })
  }
  const scene = { schemaVersion: 'soulidity.native-render-scene.v1' as const,
    rootId: root.id, makerVersion: root.maker_version, rootContentCommitment: hex(root.content.content_commitment),
    document: { canvas: { width: canvas.width as number, height: canvas.height as number, pixelMode: canvas.pixelMode as 'smooth' | 'pixelated' } },
    selections: source.selections, selectionIndexes: source.selectionIndexes, visibility: source.visibility, layers }
  assertNativeSceneVisibility(scene)
  return scene
}
