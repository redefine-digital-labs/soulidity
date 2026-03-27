import { materializeWalrusBlobUrls } from '@web/lib/services/walrus'
import { serializeAtomicSuiAmount } from '@web/lib/souls/price-format'

type SoulWithPreviewImages = {
  previewImages: string[]
}

export function serializeSoulPreviewImages<T extends SoulWithPreviewImages>(soul: T): T {
  return {
    ...soul,
    previewImages: materializeWalrusBlobUrls(soul.previewImages),
    ...('listedPriceSui' in soul ? {
      listedPriceSui: serializeAtomicSuiAmount(
        soul.listedPriceSui as { toString(): string } | string | number | bigint | null | undefined,
      ),
    } : {}),
  }
}

export function serializeSoulPreviewImageList<T extends SoulWithPreviewImages>(souls: T[]): T[] {
  return souls.map(serializeSoulPreviewImages)
}
