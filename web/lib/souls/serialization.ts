import { materializeWalrusBlobUrls } from '@web/lib/services/walrus'

type SeriesWithPreviewImages = {
  previewImages: string[]
}

export function serializeSoulPreviewImages<T extends SeriesWithPreviewImages>(series: T): T {
  return {
    ...series,
    previewImages: materializeWalrusBlobUrls(series.previewImages),
  }
}

export function serializeSoulPreviewImageList<T extends SeriesWithPreviewImages>(seriesList: T[]): T[] {
  return seriesList.map(serializeSoulPreviewImages)
}
