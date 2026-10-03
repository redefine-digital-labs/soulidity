import type { RenderAssetEvidence } from '@soulidity/animacraft-render-core'
import { getBlobUrl } from '@soulidity/sdk'
import { fromBase64, toBase64 } from '@mysten/sui/utils'

/** Shared bounded ciphertext/public-media loader; never caches decrypted bytes. */
export function createNativeRenderAssetLoader(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const assets = new Map<string, Promise<RenderAssetEvidence & { bytesBase64: string }>>()
  const cachedSizes = new Map<string, number>(); let cachedBytes = 0
  const loadAsset = (asset: RenderAssetEvidence) => {
    const key = JSON.stringify(asset)
    if (!assets.has(key)) {
      // Bounded cache, not a total scene-size rejection: large valid Pack scenes
      // still render sequentially without retaining every base64 asset at once.
      while (cachedBytes + asset.byteLength > 16 * 1024 * 1024 && assets.size) {
        const oldest = assets.keys().next().value!
        cachedBytes -= cachedSizes.get(oldest)!; cachedSizes.delete(oldest); assets.delete(oldest)
      }
      cachedBytes += asset.byteLength; cachedSizes.set(key, asset.byteLength)
      assets.set(key, (async () => {
      signal.throwIfAborted()
      if (!asset.blobId || !/^[A-Za-z0-9_-]{43}$/.test(asset.blobId)
        || toBase64(fromBase64(asset.blobId.replaceAll('-', '+').replaceAll('_', '/') + '='))
          .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== asset.blobId) throw new Error('Invalid certified Blob ID.')
      const assetSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)])
      const response = await fetcher(getBlobUrl(asset.blobId), { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: assetSignal })
      if (!response.ok || !response.body) throw new Error('Original artwork media is unavailable. Retry when the connection recovers.')
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.byteLength)) {
        await response.body.cancel(); throw new Error('Original artwork media length changed.')
      }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
      try {
        for (;;) {
          assetSignal.throwIfAborted(); const result = await reader.read(); if (result.done) break
          total += result.value.length
          if (total > asset.byteLength || total > 8 * 1024 * 1024) throw new Error('Original artwork media exceeds its certified size.')
          chunks.push(result.value)
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      finally { reader.releaseLock() }
      assetSignal.throwIfAborted()
      const bytes = new Uint8Array(total); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      return { ...asset, bytesBase64: toBase64(bytes) }
      })())
    }
    return assets.get(key)!
  }
  return loadAsset
}
