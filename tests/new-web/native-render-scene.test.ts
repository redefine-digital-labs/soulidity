import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { resolveNativeRenderScene, fetchNativeRenderBlob } from '../../web/lib/animacraft/native-render-scene'
import type { readNativeRenderSource } from '../../web/lib/animacraft/native-render-source'
import { renderSelectionFixture } from './fixtures/native-render-source'
type Source = Awaited<ReturnType<typeof readNativeRenderSource>>
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const bytes = (value: string) => [...Buffer.from(value, 'hex')]
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v
const json = (v: unknown) => JSON.stringify(canonical(v))
const asset = { assetId: 'hat', blobId: 'hat-blob', sha256: digest('png'), mediaType: 'image/png', byteLength: 3 }
function fixture() {
  const document = { canvas: { width: 800, height: 800, pixelMode: 'smooth' }, tracks: [{ key: 'front', renderOrder: 2 }],
    outputs: [{ key: 'main', label: 'Main', payload: { format: 'png' } }] }
  const manifest = { schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8, document, certifiedAssets: [asset] }
  const source = { authority: 'CONTENT_ONLY', root: { id: id(1), maker_version: '1', content: {
    manifest_blob_id: 'maker-manifest', manifest_sha256: bytes(digest(json(manifest))),
    content_commitment: bytes(digest(json({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document }))),
    renderer_commitment: bytes(digest(json({ schemaVersion: 'animacraft.maker-v8-renderer.v2', canvas: document.canvas,
      tracks: document.tracks, outputs: document.outputs.map(({key, payload}) => ({key, payload})) }))),
  } }, selectionIndexes: [3], visibility: { valid: true, violations: [] }, layers: [{ selectionIndex: 3, selection: renderSelectionFixture({ selection_index: '3',
    layer_track_key: 'front', color_channel_key: 'tint', swatch_key: 'red', asset_blob_id: asset.blobId, asset_sha256: bytes(asset.sha256) }),
  asset, pack: null, transform: { x: -1.25, y: 2.125, scale: 0.875, rotation: -33.125 }, opacity: 0.625,
  blendMode: 'multiply', displayOrder: 3, trackOrder: 2, swatch: { key: 'red', rgba: '#ff000080', stops: [] }, protected: false, violations: [] }] } as unknown as Source
  source.selections = [null, null, null, source.layers[0].selection]
  const blobs = new Map([['maker-manifest', Buffer.from(json(manifest))]])
  const fetchBlob = vi.fn(async (blobId: string) => { if (!blobs.has(blobId)) throw new Error('missing'); return blobs.get(blobId)! })
  const save = () => { blobs.set('maker-manifest', Buffer.from(json(manifest))); source.root.content.manifest_sha256 = bytes(digest(json(manifest))) }
  return { source, document, manifest, blobs, fetchBlob, save,
    resolve: () => resolveNativeRenderScene(source, { fetchBlob }) }
}
describe('native exact content scene', () => {
  it('keeps sparse selected identity when the entire scene is hidden', async () => {
    const f = fixture(), original = structuredClone(f.source.selections)
    f.source.layers[0].violations = ['STYLE']
    f.source.visibility = { valid: false, violations: [{ selectionIndex: 3, levels: ['STYLE'] }] }
    expect(await f.resolve()).toMatchObject({ selections: original, selectionIndexes: [3], layers: [], visibility: f.source.visibility })
    expect(f.fetchBlob.mock.calls.map(call => call[0])).toEqual(['maker-manifest'])
  })
  it('rejects omitted hidden source rows before downloading a manifest', async () => {
    const f = fixture()
    f.source.visibility = { valid: false, violations: [{ selectionIndex: 3, levels: ['STYLE'] }] }
    f.source.layers = []
    await expect(f.resolve()).rejects.toThrow()
    expect(f.fetchBlob).not.toHaveBeenCalled()
  })
  it.each(['asset-length', 'asset-hash', 'track'])('does not skip hidden %s identity validation', async mode => {
    const f = fixture(), row = f.source.layers[0]
    row.violations = ['STYLE']; f.source.visibility = { valid: false, violations: [{ selectionIndex: 3, levels: ['STYLE'] }] }
    if (mode === 'asset-length') row.asset = { ...asset, byteLength: 4 }
    if (mode === 'asset-hash') row.asset = { ...asset, sha256: '00'.repeat(32) }
    if (mode === 'track') row.trackOrder = 9
    await expect(f.resolve()).rejects.toThrow()
  })
  it.each(['image/jpeg', 'image/gif', 'image/avif'])('preserves Runtime-supported External %s assets', async mediaType => {
    const f = fixture(); const row = f.source.layers[0]
    row.selection.source_class = 2; row.asset = { ...asset, mediaType }
    expect((await f.resolve()).layers[0].asset.mediaType).toBe(mediaType)
  })
  it('verifies completed Output schema separately from the whole Maker renderer config', async () => {
    const f = fixture(); const output = f.document.outputs[0]
    const rendererSchemaCommitment = digest(json({ schemaVersion: 'animacraft.maker-v8-output-renderer.v1', ...output, canvas: f.document.canvas }))
    expect(rendererSchemaCommitment).not.toBe(Buffer.from(f.source.root.content.renderer_commitment).toString('hex'))
    await expect(resolveNativeRenderScene(f.source, { fetchBlob: f.fetchBlob,
      completedOutput: { outputKey: 'main', rendererSchemaCommitment } })).resolves.toMatchObject({ rootId: id(1) })
    await expect(resolveNativeRenderScene(f.source, { fetchBlob: f.fetchBlob,
      completedOutput: { outputKey: 'main', rendererSchemaCommitment: Buffer.from(f.source.root.content.renderer_commitment).toString('hex') } })).rejects.toThrow('Completed output')
    await expect(resolveNativeRenderScene(f.source, { fetchBlob: f.fetchBlob,
      completedOutput: { outputKey: 'other', rendererSchemaCommitment } })).rejects.toThrow('Completed output')
  })
  it('binds Maker manifest/config and preserves original slot, per-layer color and exact coordinates', async () => {
    const f = fixture(); const scene = await f.resolve()
    expect(scene.document.canvas).toEqual(f.document.canvas)
    expect(scene.layers[0]).toMatchObject({ selectionIndex: 3, transform: f.source.layers[0].transform,
      opacity: 0.625, blendMode: 'multiply', swatch: { key: 'red', rgba: '#ff000080' }, asset })
    expect(f.fetchBlob).toHaveBeenCalledTimes(1)
  })
  it.each(['sha', 'content', 'renderer', 'track', 'asset', 'schema', 'canvas'])('rejects %s drift', async mode => {
    const f = fixture()
    if (mode === 'sha') f.source.root.content.manifest_sha256.fill(0)
    if (mode === 'content') f.source.root.content.content_commitment.fill(0)
    if (mode === 'renderer') f.source.root.content.renderer_commitment.fill(0)
    if (mode === 'track') f.source.layers[0].trackOrder = 9
    if (mode === 'asset') f.source.layers[0].asset = { ...asset, byteLength: 4 }
    if (mode === 'schema') { f.manifest.schemaVersion = 'old'; f.save() }
    if (mode === 'canvas') { f.document.canvas.width = 8193; f.save() }
    await expect(f.resolve()).rejects.toThrow()
  })
  it('requires canonical UTF-8 JSON even if its raw hash matches', async () => {
    const f = fixture(); const altered = Buffer.from(JSON.stringify(f.manifest, null, 2))
    f.blobs.set('maker-manifest', altered); f.source.root.content.manifest_sha256 = bytes(digest(altered))
    await expect(f.resolve()).rejects.toThrow('Noncanonical')
  })
  it.each(['valid', 'missing', 'wrong-length', 'wrong-style'])('resolves protected source identity without fetching media: %s', async mode => {
    const f = fixture(); const encrypted = { ...asset, mediaType: 'application/vnd.animacraft.seal-ciphertext' }
    f.manifest.certifiedAssets = [encrypted]; f.source.layers[0].asset = encrypted; f.source.layers[0].protected = true
    const selection = f.source.layers[0].selection
    selection.protected = true
    const sourceAsset = { sha256: asset.sha256, mediaType: asset.mediaType, byteLength: asset.byteLength }
    Object.assign(f.document, { assets: [{ id: asset.assetId, mediaType: asset.mediaType, byteLength: asset.byteLength }],
      parts: [{ key: selection.part_key, items: [{ key: selection.item_key, styles: [{
        key: mode === 'wrong-style' ? 'different-style' : selection.style_key, assetId: asset.assetId, protected: true,
        payload: mode === 'missing' ? {} : { animacraftSourceAsset: { ...sourceAsset, byteLength: mode === 'wrong-length' ? 4 : 3 } },
      }] }] }] })
    f.source.root.content.content_commitment = bytes(digest(json({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document: f.document })))
    f.save()
    if (mode === 'valid') expect((await f.resolve()).layers[0]).toMatchObject({ protected: true, sourceAsset })
    else await expect(f.resolve()).rejects.toThrow(/Protected source|Style identity/)
    expect(f.fetchBlob.mock.calls.map(call => call[0])).toEqual(['maker-manifest'])
  })
  it.each([[false, false], [true, false], [false, true], [true, true]])('resolves exact Pack protected=%s ownedTrack=%s without wallet/admission requirements', async (protectedAsset, ownedTrack) => {
    const f = fixture(); const row = f.source.layers[0]
    const descriptor = { ...asset, contentCommitment: asset.sha256, protected: protectedAsset,
      mediaType: protectedAsset ? 'application/vnd.animacraft.seal-ciphertext' : asset.mediaType,
      sealBindingCommitment: protectedAsset ? 'ab'.repeat(32) : null }
    const sourceAsset = { sha256: asset.sha256, mediaType: asset.mediaType, byteLength: asset.byteLength }
    const content = { schemaVersion: 'animacraft.maker-v8-pack-content.v1', protocolVersion: 8,
      rootId: id(1), rootVersion: '1', rootContentCommitment: Buffer.from(f.source.root.content.content_commitment).toString('hex'),
      authoring: { schemaVersion: 'animacraft.maker-v8-pack-authoring-content.v1', parent: { document: structuredClone(f.document) }, document: {
        tracks: [{ key: 'front', renderOrder: ownedTrack ? 23 : 2 }],
        assets: [{ id: asset.assetId, mediaType: asset.mediaType, byteLength: asset.byteLength }],
        parts: [{ key: 'body', items: [{ key: 'hat', styles: [{ key: 'red', assetId: asset.assetId,
          protected: protectedAsset, trackKey: 'front', colorChannelKey: 'tint', defaultSwatchKey: 'red',
          transform: { x: 12.5, y: -8, scale: 0.5, rotation: 15 }, opacity: 0.75, blendMode: 'multiply', displayOrder: 7,
          payload: { animacraftSourceAsset: sourceAsset } }] }] }],
      } },
      semanticPackId: 'extras', styles: [{ partKey: 'body', itemKey: 'hat', styleKey: 'red', layerTrackKey: 'front', colorChannelKey: 'tint', defaultSwatchKey: 'red', asset: descriptor }] }
    const semantic = { ...content, styles: content.styles.map(style => ({ ...style,
      asset: { assetId: descriptor.assetId, contentCommitment: descriptor.contentCommitment, protected: protectedAsset } })) }
    const packManifest = { schemaVersion: 'animacraft.maker-v8-pack-manifest.v1', protocolVersion: 8,
      contentCommitment: digest(json(semantic)), content }
    f.blobs.set('pack-manifest', Buffer.from(json(packManifest)))
    row.pack = { id: id(9), semantic_pack_id: 'extras', manifest_blob_id: 'pack-manifest', manifest_sha256: bytes(digest(json(packManifest))),
      content_commitment: bytes(packManifest.contentCommitment) } as Source['layers'][number]['pack']
    Object.assign(row.selection, { source_class: 1, protected: protectedAsset, asset_content_commitment: bytes(descriptor.contentCommitment),
      seal_binding_commitment: protectedAsset ? bytes(descriptor.sealBindingCommitment!) : [] })
    row.protected = protectedAsset
    row.trackSource = ownedTrack ? 2 : 1; row.trackOrder = ownedTrack ? 23 : 2
    row.asset = null
    const scene = await f.resolve(); expect(scene.layers[0].asset).toEqual({ ...asset, mediaType: descriptor.mediaType })
    expect(scene.layers[0].selection.source).toBe('PACK')
    expect(scene.layers[0].trackOrder).toBe(ownedTrack ? 23 : 2)
    if (ownedTrack) {
      row.trackOrder = 2 // Matching Base order must not mask an owned-track mismatch.
      await expect(f.resolve()).rejects.toThrow('Manifest/chain track mismatch')
      row.trackOrder = 23
    }
    expect(scene.layers[0].sourceAsset).toEqual(protectedAsset ? sourceAsset : null)
    row.violations = ['STYLE']
    f.source.visibility = { valid: false, violations: [{ selectionIndex: 3, levels: ['STYLE'] }] }
    const hidden = await f.resolve()
    expect(hidden.layers).toEqual([])
    expect(hidden.selectionIndexes).toEqual([3])
    expect(hidden.selections[3]).toEqual(row.selection)
    row.violations = []; f.source.visibility = { valid: true, violations: [] }
    expect(scene.layers[0]).toMatchObject({ transform: { x: 12.5, y: -8, scale: 0.5, rotation: 15 },
      opacity: 0.75, blendMode: 'multiply', displayOrder: 7 })
    const authored = content.authoring.document.parts[0].items[0].styles[0]
    const reset = structuredClone(authored)
    // Refresh every outer commitment: rejection must be semantic, not merely SHA drift.
    for (const change of [{ trackKey: 'wrong' }, { colorChannelKey: 'wrong' }, { defaultSwatchKey: 'wrong' },
      { assetId: 'wrong' }, { opacity: 2 }, { transform: { ...reset.transform, scale: 0 } }]) {
      Object.assign(authored, change)
      packManifest.contentCommitment = digest(json(semantic))
      row.pack!.content_commitment = bytes(packManifest.contentCommitment)
      f.blobs.set('pack-manifest', Buffer.from(json(packManifest)))
      row.pack!.manifest_sha256 = bytes(digest(json(packManifest)))
      await expect(f.resolve()).rejects.toThrow(/Pack authored/)
      Object.assign(authored, structuredClone(reset))
    }
    packManifest.contentCommitment = digest(json(semantic))
    row.pack!.content_commitment = bytes(packManifest.contentCommitment)
    row.pack!.manifest_sha256 = bytes(digest(json(packManifest)))
    packManifest.content.styles[0].asset.byteLength = 5
    f.blobs.set('pack-manifest', Buffer.from(json(packManifest)))
    await expect(f.resolve()).rejects.toThrow('SHA')
  })
  it('snapshots source before asynchronous manifest reads', async () => {
    const f = fixture(); let resolve!: (v: Uint8Array) => void
    const pending = resolveNativeRenderScene(f.source, { fetchBlob: () => new Promise(r => { resolve = r }) })
    f.source.layers[0].transform.x = 99; resolve(f.blobs.get('maker-manifest')!)
    expect((await pending).layers[0].transform.x).toBe(-1.25)
  })
})
describe('bounded native render storage', () => {
  const blob = Buffer.alloc(32, 3).toString('base64url')
  it('uses configured credential-free no-redirect transport and propagates abort', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2])))
    const controller = new AbortController()
    expect(await fetchNativeRenderBlob(blob, 3, controller.signal, fetcher)).toEqual(new Uint8Array([1, 2]))
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(blob), expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
    controller.abort(); expect((fetcher.mock.calls as any)[0][1].signal.aborted).toBe(true)
  })
  it.each(['url', 'declared', 'stream'])('rejects %s before unchecked decoding', async mode => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), mode === 'declared' ? { headers: { 'content-length': '99' } } : undefined))
    await expect(fetchNativeRenderBlob(mode === 'url' ? 'https://bad.example' : blob, 2, undefined, fetcher)).rejects.toThrow()
    if (mode === 'url') expect(fetcher).not.toHaveBeenCalled()
  })
})
