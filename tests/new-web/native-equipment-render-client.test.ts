import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { renderNativeEquipmentScene } from '../../web/lib/animacraft/native-equipment-render-client'
import type { NativeEquipmentRenderTarget } from '../../web/lib/animacraft/native-equipment-render-types'
import type { NativeEquipmentReadTarget } from '../../web/lib/animacraft/native-equipment-read-types'
import { renderSelectionFixture } from './fixtures/native-render-source'

const mocks = vi.hoisted(() => ({ decrypt: vi.fn() }))
vi.mock('../../web/lib/animacraft/native-equipment-read-client', async original => ({
  ...await original<any>(), decryptNativeEquipmentLayer: mocks.decrypt,
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const content = new Uint8Array([1, 2, 3])
const sha = createHash('sha256').update(content).digest('hex')
const blobId = Buffer.alloc(32, 20).toString('base64url')
const canvases: Canvas[] = []
const decoded: { bytes: Uint8Array; type: string }[] = []
const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = []
class Canvas {
  width: number; height: number
  context = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    scale: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) })),
    putImageData: vi.fn() }
  constructor(width: number, height: number) { this.width = width; this.height = height; canvases.push(this) }
  getContext() { return this.context }
  async convertToBlob() { return new Blob([new Uint8Array([9])], { type: 'image/png' }) }
}
const defer = <T,>() => { let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function fixture(kind: 'base' | 'owned-base' | 'pack' = 'base') {
  const target: NativeEquipmentReadTarget = { schema: 'native-equipment-read-v1', soulId: id(1), stateId: id(2),
    owner: id(3), ownershipEpoch: '4', bindingId: id(4), rootId: id(5), protocolConfigId: id(6), catalogId: id(7),
    releaseConfigId: id(8), sealRegistryId: id(9), sealPolicyId: id(10), paymentCoinType: '0x2::sui::SUI',
    loadoutId: id(11), loadoutRevision: '7', loadoutCommitment: 'aa'.repeat(32), runtimeDefinitionsId: id(12),
    baseRegistryId: id(13), packRegistryId: id(14), makerAccessId: id(15), selectionIndex: 3,
    slot: { partKey: 'body', itemKey: 'coat', styleKey: 'blue', colorChannelKey: 'coat-tint', swatchKey: 'red',
      layerTrackKey: 'body', sourceClass: kind === 'pack' ? 1 : 0, sourceDefinitionId: kind === 'pack' ? id(16) : id(5),
      sourceSemanticId: kind === 'pack' ? 'pack' : '', accessSubject: kind === 'pack' ? id(17) : kind === 'owned-base' ? id(18) : id(15),
      sourceEpoch: kind === 'owned-base' ? '2' : '0', pricingCommitment: 'bb'.repeat(32),
      assetContentCommitment: 'cc'.repeat(32), sealBindingCommitment: 'dd'.repeat(32) },
    release: { originalPackageId: id(19), callablePackageId: id(20), callableDigest: '1'.repeat(32) },
    ciphertext: { blobId, sha256: sha, sealId: Array(32).fill(1), aadBase64: 'AQ==',
      ciphertextBlobCommitment: 'ee'.repeat(32), certificationCommitment: 'ff'.repeat(32) },
    policy: { keyServers: [{ objectId: id(22), weight: 1 }], threshold: 1, maxPlaintextBytes: 1024,
      cipherSuite: 'BonehFranklinBLS12381DemCCA/AesGcm256',
      keyDerivation: 'SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00', ciphertextFormat: 'Seal/EncryptedObject/BCS/v0' },
    ...(kind === 'pack' ? { kind, packReleaseId: id(16), packPassId: id(17) }
      : kind === 'owned-base' ? { kind, ownedBaseItemId: id(18) } : { kind }),
  }
  const view: Extract<NativeEquipmentRenderTarget, { status: 'AVAILABLE' }> = {
    schema: 'native-equipment-render-v1', scope: 'CURRENT_EQUIPMENT_ONLY', status: 'AVAILABLE', soulId: id(1),
    stateId: id(2), rootId: id(5), owner: id(3), ownershipEpoch: '4', snapshot: {
      loadoutId: id(11), loadoutRevision: '7', loadoutCommitment: 'aa'.repeat(32) }, selectionIndexes: [3],
    scene: { schemaVersion: 'soulidity.native-render-scene.v1', rootId: id(5), makerVersion: '1',
      rootContentCommitment: 'ab'.repeat(32), document: { canvas: { width: 4, height: 4, pixelMode: 'pixelated' } },
      selectionIndexes: [3], visibility: { valid: true, violations: [] },
      selections: [null, null, null, renderSelectionFixture({ selection_index: '3', part_key: 'body', item_key: 'coat', style_key: 'blue',
        source_class: kind === 'pack' ? 1 : 0, source_definition_id: target.slot.sourceDefinitionId,
        source_semantic_id: target.slot.sourceSemanticId, access_subject: target.slot.accessSubject,
        asset_blob_id: blobId, asset_sha256: [...Buffer.from(sha, 'hex')], protected: true,
        color_channel_key: 'coat-tint', swatch_key: 'red', seal_binding_commitment: Array(32).fill(0xdd) })],
      layers: [{ selectionIndex: 3, selection: { source: kind === 'pack' ? 'PACK' : 'BASE', partKey: 'body', itemKey: 'coat', styleKey: 'blue' },
        asset: { assetId: 'coat-blue', blobId, sha256: sha, byteLength: content.length, mediaType: 'application/vnd.animacraft.seal-ciphertext' },
        sourceAsset: { sha256: createHash('sha256').update(new Uint8Array([4, 5, 6])).digest('hex'), mediaType: 'image/png', byteLength: 3 },
        transform: { x: 2, y: -3, scale: 0.5, rotation: 90 }, opacity: 0.5, blendMode: 'multiply',
        displayOrder: 0, trackOrder: 0, swatch: { key: 'red', rgba: '#ff0000ff', stops: [] }, protected: true }],
    },
  }
  let owner: string | null = view.owner
  const controller = new AbortController(), plain = new Uint8Array([4, 5, 6])
  const readScene = vi.fn(async () => structuredClone(view)), readLayer = vi.fn(async () => structuredClone(target))
  const fetcher = vi.fn(async () => new Response(content))
  mocks.decrypt.mockImplementation(async (params: any) => ({ target: await params.read(), bytes: plain }))
  const params = { soulId: view.soulId, owner: view.owner, client: {} as any, signal: controller.signal,
    getAddress: () => owner, signPersonalMessage: vi.fn(), readScene, readLayer, fetcher: fetcher as typeof fetch }
  return { view, target, params, controller, plain, readLayer, readScene, fetcher, setOwner: (v: string | null) => { owner = v } }
}
beforeEach(() => {
  vi.clearAllMocks(); canvases.length = 0; decoded.length = 0; bitmaps.length = 0
  vi.stubGlobal('OffscreenCanvas', Canvas)
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    decoded.push({ bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
    const bitmap = { width: 4, height: 4, close: vi.fn() }; bitmaps.push(bitmap); return bitmap
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each(['base', 'owned-base', 'pack'] as const)('renders %s using original transforms/color/core and exact sparse slot, clearing private resources', async kind => {
  const s = fixture(kind)
  const result = await renderNativeEquipmentScene(s.view, s.params)
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([9])
  expect(s.readScene).toHaveBeenCalledTimes(2); expect(s.readLayer).toHaveBeenCalledWith(3)
  expect(s.fetcher).toHaveBeenCalledTimes(1)
  expect(mocks.decrypt.mock.calls[0][0]).toMatchObject({ selectionIndex: 3, ciphertextBytes: content,
    expectedEquipment: { ...s.view.snapshot, ownershipEpoch: s.view.ownershipEpoch } })
  expect(decoded[0].bytes).toEqual(new Uint8Array([4, 5, 6])); expect(s.plain).toEqual(new Uint8Array(3))
  expect(decoded[0].type).toBe('image/png')
  expect(canvases[0].context.translate.mock.calls).toEqual([[3, -2], [-2, -2]])
  expect(canvases[0].context.rotate).toHaveBeenCalledWith(Math.PI / 2)
  expect(canvases[0].context.scale).toHaveBeenCalledWith(0.5, 0.5)
  expect(canvases[1].context.putImageData).toHaveBeenCalled()
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
  expect(bitmaps[0].close).toHaveBeenCalledTimes(1)
})
it.each(['base', 'owned-base', 'pack'] as const)('rejects same-length substituted %s plaintext before image decoding', async kind => {
  const s = fixture(kind)
  s.plain[0] = 7
  await expect(renderNativeEquipmentScene(s.view, s.params)).rejects.toThrow()
  expect(createImageBitmap).not.toHaveBeenCalled()
  expect(s.plain).toEqual(new Uint8Array(3))
})
it('public External content uses the same renderer without protected approval', async () => {
  const s = fixture(); const layer = s.view.scene.layers[0]
  layer.protected = false; layer.selection.source = 'EXTERNAL'; layer.asset.mediaType = 'image/jpeg'
  s.view.scene.selections[3]!.protected = false; s.view.scene.selections[3]!.source_class = 2
  await renderNativeEquipmentScene(s.view, s.params)
  expect(mocks.decrypt).not.toHaveBeenCalled(); expect(s.readLayer).not.toHaveBeenCalled()
  expect(decoded[0]).toEqual({ bytes: content, type: 'image/jpeg' })
})
it('renders public equipment anonymously without an authorization client', async () => {
  const s=fixture(),layer=s.view.scene.layers[0]
  layer.protected=false;layer.selection.source='EXTERNAL';layer.asset.mediaType='image/jpeg'
  s.view.scene.selections[3]!.protected=false;s.view.scene.selections[3]!.source_class=2
  await renderNativeEquipmentScene(s.view,{publicOnly:true,soulId:s.view.soulId,owner:s.view.owner,
    signal:s.controller.signal,readScene:s.readScene,fetcher:s.params.fetcher})
  expect(mocks.decrypt).not.toHaveBeenCalled();expect(s.params.signPersonalMessage).not.toHaveBeenCalled()
})
it('rejects protected layers through public-only rendering before downloading or authorizing', async () => {
  const s=fixture()
  await expect(renderNativeEquipmentScene(s.view,{publicOnly:true,soulId:s.view.soulId,owner:s.view.owner,
    signal:s.controller.signal,readScene:s.readScene,fetcher:s.params.fetcher})).rejects.toThrow('authorized preview')
  expect(s.fetcher).not.toHaveBeenCalled();expect(mocks.decrypt).not.toHaveBeenCalled()
})
it.each(['base', 'pack'] as const)('all-hidden protected %s stays selected, renders transparently, and never fetches or decrypts', async kind => {
  const s = fixture(kind)
  s.view.scene.layers = []
  s.view.scene.visibility = { valid: false, violations: [{ selectionIndex: 3, levels: [kind === 'pack' ? 'PART' : 'STYLE'] }] }
  const original = structuredClone(s.view)
  expect(await renderNativeEquipmentScene(s.view, s.params)).toBeInstanceOf(Blob)
  expect(s.view).toEqual(original); expect(s.view.status).toBe('AVAILABLE')
  expect(s.view.selectionIndexes).toEqual([3]); expect(s.view.scene.selectionIndexes).toEqual([3])
  expect(s.readScene).toHaveBeenCalledTimes(2)
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.readLayer).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
  expect(decoded).toEqual([]); expect(canvases[0].context.clearRect).toHaveBeenCalled()
  expect(canvases[0].context.drawImage).not.toHaveBeenCalled()
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
})
it.each(['visible-missing', 'indices-truncated', 'valid-forged'])('refuses %s selection/visible subset contract', async mode => {
  const s = fixture()
  if (mode === 'visible-missing') s.view.scene.layers = []
  if (mode === 'indices-truncated') s.view.selectionIndexes = []
  if (mode === 'valid-forged') s.view.scene.visibility.valid = false
  await expect(renderNativeEquipmentScene(s.view, s.params)).rejects.toThrow()
  expect(s.fetcher).not.toHaveBeenCalled(); expect(s.readLayer).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})
it.each(['stateId', 'rootId', 'loadoutRevision', 'styleKey', 'swatchKey', 'blobId', 'sha256', 'source'])(
  'rejects %s metadata drift before the decrypt adapter can release plaintext', async field => {
    const s = fixture(); const t = s.target as any
    if (field === 'stateId' || field === 'rootId') t[field] = id(99)
    else if (field === 'loadoutRevision') t[field] = '8'
    else if (field === 'styleKey' || field === 'swatchKey') t.slot[field] = 'changed'
    else if (field === 'blobId') t.ciphertext.blobId = Buffer.alloc(32, 99).toString('base64url')
    else if (field === 'sha256') t.ciphertext.sha256 = '99'.repeat(32)
    else s.view.scene.layers[0].selection.source = 'PACK'
    await expect(renderNativeEquipmentScene(s.view, s.params)).rejects.toThrow()
    expect(decoded).toHaveLength(0); expect(canvases.every(c => c.width === 0)).toBe(true)
  })
it.each([1, 2])('rejects scene drift at read %s with no returned artifact', async call => {
  const s = fixture(); let count = 0
  s.readScene.mockImplementation(async () => { const copy = structuredClone(s.view)
    if (++count === call) copy.snapshot.loadoutRevision = '8'; return copy })
  await expect(renderNativeEquipmentScene(s.view, s.params)).rejects.toThrow('changed')
  expect(canvases.every(c => c.width === 0)).toBe(true)
  if (call === 1) expect(s.fetcher).not.toHaveBeenCalled()
})
it('snapshots caller scene mutation before awaiting reads', async () => {
  const s = fixture(), snapshot = structuredClone(s.view)
  s.readScene.mockImplementation(async () => snapshot)
  const pending = renderNativeEquipmentScene(s.view, s.params); s.view.scene.layers[0].transform.x = 999
  await pending
  expect(canvases[0].context.translate.mock.calls).toEqual([[3, -2], [-2, -2]])
})
it('closes late bitmap and clears canvases when cancelled during decode', async () => {
  const s = fixture(), wait = defer<ImageBitmap>(), entered = defer<void>()
  vi.mocked(createImageBitmap).mockImplementation(() => { entered.resolve(); return wait.promise })
  const pending = renderNativeEquipmentScene(s.view, s.params)
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await entered.promise; s.controller.abort(new Error('cancelled')); await rejected
  expect(s.plain).toEqual(new Uint8Array(3)); expect(canvases.every(c => c.width === 0)).toBe(true)
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap; wait.resolve(bitmap)
  await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledTimes(1))
  expect(canvases[0].context.drawImage).not.toHaveBeenCalled()
})
it('returns no artifact and clears canvases when cancelled during PNG encoding', async () => {
  const s = fixture(), wait = defer<Blob>(), entered = defer<void>()
  vi.spyOn(Canvas.prototype, 'convertToBlob').mockImplementation(() => { entered.resolve(); return wait.promise })
  const pending = renderNativeEquipmentScene(s.view, s.params); const rejected = expect(pending).rejects.toThrow('cancelled')
  await entered.promise; s.controller.abort(new Error('cancelled')); await rejected
  expect(canvases.every(c => c.width === 0)).toBe(true)
  wait.resolve(new Blob([new Uint8Array([9])]))
})
it('rejects wallet changes before returning rendered content', async () => {
  const s = fixture(); s.readScene.mockImplementation(async () => { s.setOwner(id(99)); return s.view })
  await expect(renderNativeEquipmentScene(s.view, s.params)).rejects.toThrow('wallet changed')
  expect(s.fetcher).not.toHaveBeenCalled()
})
it.each(['NOT_CREATED', 'EMPTY'] as const)('does not render %s equipment as an empty final Soul', async status => {
  const s = fixture(); const view = { ...s.view, status, scene: null, selectionIndexes: [] } as NativeEquipmentRenderTarget
  await expect(renderNativeEquipmentScene(view, s.params)).rejects.toThrow('No current')
  expect(s.readScene).not.toHaveBeenCalled(); expect(s.fetcher).not.toHaveBeenCalled()
})
