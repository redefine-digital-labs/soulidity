import { getBlobUrl, parseWalrusAssetId } from '@soulidity/sdk'

/** Asset locations may be quilt patches; contract-backed Soul bundles remain raw Blob IDs. */
export function nativeAssetStorageId(value: string): boolean {
  return parseWalrusAssetId(value) !== null
}
export function nativeAssetStorageUrl(value: string): string {
  const location = parseWalrusAssetId(value)
  if (!location) throw new Error('Invalid certified asset storage identity.')
  const url = getBlobUrl(location.blobId)
  if (location.kind === 'blob') return url
  const suffix = `/v1/blobs/${location.blobId}`
  if (!url.endsWith(suffix)) throw new Error('Invalid asset aggregator path.')
  return `${url.slice(0, -suffix.length)}/v1/blobs/by-quilt-patch-id/${location.id}`
}
