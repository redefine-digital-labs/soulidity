import { materializeWalrusBlobUrls } from '@web/lib/services/walrus'
import { serializeAtomicUsdcAmount } from '@web/lib/souls/price-format'

type SeriesWithPreviewImages = {
  previewImages: string[]
}

function reorderReleasesWithLatestFirst(releases: unknown, latestRelease: unknown): unknown {
  if (!Array.isArray(releases) || releases.length === 0 || !latestRelease || typeof latestRelease !== 'object') {
    return releases
  }

  const latestId = typeof latestRelease === 'object' && latestRelease != null && 'id' in latestRelease
    ? latestRelease.id
    : null
  const latestOnChainId = typeof latestRelease === 'object' && latestRelease != null && 'onChainId' in latestRelease
    ? latestRelease.onChainId
    : null

  const latestIndex = releases.findIndex((release) => (
    typeof release === 'object'
    && release != null
    && (
      ('id' in release && release.id === latestId)
      || ('onChainId' in release && release.onChainId === latestOnChainId)
    )
  ))

  if (latestIndex <= 0) {
    return releases
  }

  return [
    releases[latestIndex],
    ...releases.slice(0, latestIndex),
    ...releases.slice(latestIndex + 1),
  ]
}

export function serializeSoulPreviewImages<T extends SeriesWithPreviewImages>(series: T): T {
  return {
    ...series,
    previewImages: materializeWalrusBlobUrls(series.previewImages),
    ...('oneTimePriceUsdc' in series ? {
      oneTimePriceUsdc: serializeAtomicUsdcAmount(series.oneTimePriceUsdc as { toString(): string } | string | number | bigint | null | undefined),
    } : {}),
    ...('subPriceUsdc' in series ? {
      subPriceUsdc: serializeAtomicUsdcAmount(series.subPriceUsdc as { toString(): string } | string | number | bigint | null | undefined),
    } : {}),
    ...('releases' in series ? {
      releases: reorderReleasesWithLatestFirst(series.releases, 'latestRelease' in series ? series.latestRelease : null),
    } : {}),
  }
}

export function serializeSoulPreviewImageList<T extends SeriesWithPreviewImages>(seriesList: T[]): T[] {
  return seriesList.map(serializeSoulPreviewImages)
}
