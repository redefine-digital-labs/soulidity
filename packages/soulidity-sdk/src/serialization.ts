import { materializeWalrusBlobUrls } from './walrus'

type SoulWithPreviewImages = {
  previewImages: string[]
  listedPriceAtomic?: { toString(): string } | string | number | bigint | null
}

function normalizeAtomicString(value: SoulWithPreviewImages['listedPriceAtomic']) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  return value.toString()
}

export function serializeSoulPreviewImages<T extends SoulWithPreviewImages>(soul: T): T {
  return {
    ...soul,
    previewImages: materializeWalrusBlobUrls(soul.previewImages),
    ...('listedPriceAtomic' in soul ? {
      listedPriceAtomic: normalizeAtomicString(soul.listedPriceAtomic),
    } : {}),
  }
}

export function serializeSoulPreviewImageList<T extends SoulWithPreviewImages>(souls: T[]): T[] {
  return souls.map(serializeSoulPreviewImages)
}
