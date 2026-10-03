/** Internal display reference, not a network URL. The browser verifies native
 * provenance before loading bytes; walrus is not a claim of public content. */
export function soulArtworkUrl(imageUrl: string, soulId: string): string
export function soulArtworkUrl(imageUrl: null, soulId: string): null
export function soulArtworkUrl(imageUrl: string | null, soulId: string): string | null
export function soulArtworkUrl(imageUrl: string | null, soulId: string): string | null {
  return imageUrl?.startsWith('walrus://')
    ? `soulidity-artwork:${soulId}` : imageUrl
}

export function isNativeArtworkUrl(url: string): boolean {
  return /^soulidity-artwork:0x[0-9a-f]{64}$/.test(url)
}
