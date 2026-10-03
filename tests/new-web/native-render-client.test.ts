import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createNativeRenderAssetLoader } from '../../web/lib/animacraft/native-render-client'
import { renderResolvedMakerV8RecipePngV8 } from '@soulidity/animacraft-render-core'
import { renderSelectionFixture } from './fixtures/native-render-source'

vi.mock('@soulidity/animacraft-render-core', async original => {
  const core = await original<typeof import('@soulidity/animacraft-render-core')>()
  return { ...core, renderResolvedMakerV8RecipePngV8: (options: any) => core.renderResolvedMakerV8RecipePngV8({ ...options,
    canvasFactory: () => ({ getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {} }),
      convertToBlob: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }) }) as any,
    decodeImage: async () => ({ source: { width: 8, height: 8 } as CanvasImageSource }),
  }) }
})
const blobId = Buffer.alloc(32, 3).toString('base64url')
const content = new Uint8Array([1, 2, 3])
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
function fixture() {
  return { status: 'AVAILABLE', artwork: { status: 'PUBLIC', soulId: 'soul' }, scene: {
    selections: [renderSelectionFixture({ asset_blob_id: blobId, asset_sha256: [...Buffer.from(sha(content), 'hex')] })],
    selectionIndexes: [0], visibility: { valid: true, violations: [] },
    document: { canvas: { width: 8, height: 8, pixelMode: 'smooth' } }, layers: [{
      selectionIndex: 0, selection: { source: 'BASE', partKey: 'body', itemKey: 'hat', styleKey: 'red' },
      asset: { assetId: 'hat', blobId, sha256: sha(content), byteLength: 3, mediaType: 'image/png' },
      transform: { x: 0, y: 0, scale: 1, rotation: 0 }, opacity: 1, blendMode: 'normal',
      displayOrder: 0, trackOrder: 0, swatch: null, protected: false,
    }],
  } }
}
async function renderFixture(view: ReturnType<typeof fixture>, signal: AbortSignal, fetcher: typeof fetch) {
  const result = await renderResolvedMakerV8RecipePngV8({ ...view.scene,
    loadAsset: createNativeRenderAssetLoader(signal, fetcher) } as any)
  return new Blob([new Uint8Array(Buffer.from(result.bytesBase64, 'base64'))], { type: 'image/png' })
}
afterEach(() => vi.restoreAllMocks())
it('runs the real shared asset hash gate and renderer with fixture Canvas only', async () => {
  const fetcher = vi.fn(async () => new Response(content)); const controller = new AbortController()
  const result = await renderFixture(fixture(), controller.signal, fetcher)
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([9])
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(blobId), expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
})
it.each(['sha', 'length', 'stream', 'url'])('rejects %s media drift', async mode => {
  const view = fixture()
  if (mode === 'sha') view.scene.layers[0].asset.sha256 = '0'.repeat(64)
  if (mode === 'url') view.scene.layers[0].asset.blobId = 'https://attacker.example'
  const fetcher = vi.fn(async () => new Response(mode === 'stream' ? new Uint8Array(4) : content,
    mode === 'length' ? { headers: { 'content-length': '99' } } : undefined))
  await expect(renderFixture(view, new AbortController().signal, fetcher)).rejects.toThrow()
  if (mode === 'url') expect(fetcher).not.toHaveBeenCalled()
})
it('timeout aborts a pending asset fetch; a fresh retry succeeds', async () => {
  const timeout = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  const fetcher = vi.fn((_url: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
  }))
  const pending = renderFixture(fixture(), new AbortController().signal, fetcher)
  const rejected = expect(pending).rejects.toThrow('timed out')
  timeout.abort(new Error('timed out')); await rejected
  vi.restoreAllMocks()
  await expect(renderFixture(fixture(), new AbortController().signal,
    vi.fn(async () => new Response(content)))).resolves.toBeInstanceOf(Blob)
})
it('evicts old cached media rather than rejecting large valid scenes or retaining all bytes', async () => {
  const view = fixture(); const original = view.scene.layers[0]
  const data = new Uint8Array(8 * 1024 * 1024)
  view.scene.layers = [0, 1, 2, 0].map((value, index) => ({ ...original, selectionIndex: index,
    asset: { ...original.asset, assetId: `item${value}`, blobId: Buffer.alloc(32, value + 1).toString('base64url'),
      byteLength: data.length, sha256: sha(data) } }))
  view.scene.selectionIndexes = [0, 1, 2, 3]
  view.scene.selections = view.scene.layers.map(row => renderSelectionFixture({ selection_index: String(row.selectionIndex),
    asset_blob_id: row.asset.blobId!, asset_sha256: [...Buffer.from(row.asset.sha256, 'hex')] }))
  const fetcher = vi.fn(async () => new Response(data))
  await renderFixture(view, new AbortController().signal, fetcher)
  expect(fetcher).toHaveBeenCalledTimes(4) // first asset was evicted at 16 MiB
}, 20_000) // Hash/base64 four 8 MiB assets under the full suite's worker contention.
