import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { renderResolvedMakerV8RecipePngV8 } from '@soulidity/animacraft-render-core'
import type { NativeEquipmentRenderTarget } from './native-equipment-render-types'
import { assertNativeEquipmentReadTarget, decryptNativeEquipmentLayer } from './native-equipment-read-client'
import { completeReadStep, type NativeSealReadParams } from './native-complete-read-client'
import { createNativeRenderAssetLoader } from './native-render-client'
import { assertNativeSceneVisibility } from './native-visibility'

type Available = Extract<NativeEquipmentRenderTarget, { status: 'AVAILABLE' }>
type AuthorizedParams = Omit<NativeSealReadParams, 'read'> & {
  readLayer: (selectionIndex: number) => Promise<unknown>
  readScene: () => Promise<unknown>
}
type Params = AuthorizedParams | {
  publicOnly: true; soulId: string; owner: string; signal: AbortSignal
  readScene: () => Promise<unknown>; fetcher?: typeof fetch
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const u64 = (value: unknown) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
  && BigInt(value) <= 18446744073709551615n

/** Render the complete current equipment only, never overlay the historical
 * completion PNG. Empty Parts remain empty under the confirmed Soul rule. */
export async function renderNativeEquipmentScene(value: NativeEquipmentRenderTarget, params: Params): Promise<Blob> {
  const view = structuredClone(value)
  check(view?.schema === 'native-equipment-render-v1' && view.scope === 'CURRENT_EQUIPMENT_ONLY'
    && view.status === 'AVAILABLE', 'No current equipped scene is available.')
  check(view.soulId === params.soulId && view.owner === params.owner
    && [view.soulId, view.stateId, view.rootId, view.owner, view.snapshot?.loadoutId].every(id)
    && u64(view.ownershipEpoch) && u64(view.snapshot?.loadoutRevision)
    && /^[0-9a-f]{64}$/.test(view.snapshot?.loadoutCommitment), 'Invalid equipment scene identity.')
  check(view.scene?.schemaVersion === 'soulidity.native-render-scene.v1' && view.scene.rootId === view.rootId
    && Array.isArray(view.selectionIndexes) && Array.isArray(view.scene.layers)
    && view.selectionIndexes.length > 0 && Array.isArray(view.scene.selectionIndexes)
    && view.scene.selectionIndexes.length === view.selectionIndexes.length
    && view.scene.selectionIndexes.every((slot, index) => slot === view.selectionIndexes[index]),
  'The equipped render slots changed.')
  assertNativeSceneVisibility(view.scene)
  if ('publicOnly' in params) check(!view.scene.layers.some(layer => layer.protected),
    'Protected equipment requires authorized preview.')
  return render(view, params)
}

async function render(view: Available, params: Params) {
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(120000)])
  const guard = () => {
    signal.throwIfAborted()
    if (!('publicOnly' in params)) check(params.getAddress() === view.owner, 'The wallet changed. Reopen equipment with the current wallet.')
  }
  const expected = { ...view.snapshot, ownershipEpoch: view.ownershipEpoch }
  const unchanged = async () => {
    guard()
    const current = await completeReadStep(signal, params.readScene)
    guard()
    check(JSON.stringify(current) === JSON.stringify(view), 'Equipment or its render source changed. Please retry.')
  }
  const load = createNativeRenderAssetLoader(signal, params.fetcher)
  const canvases = new Set<HTMLCanvasElement | OffscreenCanvas>()
  await unchanged()
  try {
    const result = await completeReadStep(signal, () => renderResolvedMakerV8RecipePngV8({
      ...view.scene,
      canvasFactory: () => {
        guard()
        const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
        canvases.add(canvas)
        return canvas
      },
      loadAsset: async asset => { guard(); return completeReadStep(signal, () => load(asset)) },
      decryptProtectedSelection: async ({ selectionIndex, ciphertext }) => {
        guard()
        check(!('publicOnly' in params), 'Protected equipment requires authorized preview.')
        const layer = view.scene.layers.find(row => row.selectionIndex === selectionIndex)
        check(layer?.protected && layer.selection.source !== 'EXTERNAL'
          && layer.asset.assetId === ciphertext.assetId && layer.asset.blobId === ciphertext.blobId
          && layer.asset.sha256 === ciphertext.sha256 && layer.asset.byteLength === ciphertext.byteLength
          && layer.asset.mediaType === ciphertext.mediaType,
        'The protected render layer changed.')
        const read = async () => {
          const target = assertNativeEquipmentReadTarget(await params.readLayer(selectionIndex), view.soulId,
            view.owner, selectionIndex, expected)
          check(target.stateId === view.stateId && target.rootId === view.rootId
            && (target.kind === 'pack' ? 'PACK' : 'BASE') === layer.selection.source
            && target.slot.partKey === layer.selection.partKey && target.slot.itemKey === layer.selection.itemKey
            && target.slot.styleKey === layer.selection.styleKey && target.slot.swatchKey === (layer.swatch?.key ?? null)
            && target.ciphertext.blobId === ciphertext.blobId && target.ciphertext.sha256 === ciphertext.sha256,
          'The protected layer no longer matches this render scene.')
          return target
        }
        const decrypted = await decryptNativeEquipmentLayer({ ...params, signal, read, selectionIndex,
          expectedEquipment: expected, ciphertextBytes: fromBase64(ciphertext.bytesBase64) })
        try {
          guard()
          return { selectionIndex, bytesBase64: toBase64(decrypted.bytes), byteLength: decrypted.bytes.length }
        } finally { decrypted.bytes.fill(0) }
      },
      decodeImage: async (bytes, mediaType) => {
        try {
          guard()
          // The original renderer owns another decoded plaintext copy. Clear it
          // here as well, including decode failure/cancellation and late bitmaps.
          const bitmap = await completeReadStep(signal, () => createImageBitmap(new Blob([new Uint8Array(bytes)],
            { type: mediaType })), bitmap => bitmap.close())
          try { guard(); return { source: bitmap, close: () => bitmap.close() } }
          catch (error) { bitmap.close(); throw error }
        } finally { bytes.fill(0) }
      },
    }))
    await unchanged()
    guard()
    const bytes = fromBase64(result.bytesBase64)
    try { return new Blob([new Uint8Array(bytes)], { type: 'image/png' }) }
    finally { bytes.fill(0) }
  } finally {
    // Includes color-processing canvases; never leave private pixels in a
    // retained canvas following a completed, failed or cancelled operation.
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0 }
    canvases.clear()
  }
}
