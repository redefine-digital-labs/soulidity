import { formatAtomicSuiForDisplay } from '@web/lib/souls/price-format'

export function SoulPricing({ listedPriceSui, listingStatus }: {
  listedPriceSui: string | null
  listingStatus: 'listed' | 'held'
}) {
  if (listingStatus !== 'listed' || !listedPriceSui) {
    return (
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Not for sale
      </span>
    )
  }

  return (
    <span className="text-sm font-semibold" style={{ color: 'var(--accent-cyan)' }}>
      {formatAtomicSuiForDisplay(listedPriceSui)}
    </span>
  )
}
