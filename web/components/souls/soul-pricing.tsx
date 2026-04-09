import { formatAtomicSoulPaymentForDisplay } from '@web/lib/souls/price-format'

export function SoulPricing({ listedPriceAtomic, listingStatus }: {
  listedPriceAtomic: string | null
  listingStatus: 'listed' | 'held'
}) {
  if (listingStatus !== 'listed' || !listedPriceAtomic) {
    return (
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Not for sale
      </span>
    )
  }

  return (
    <span className="text-sm font-semibold" style={{ color: 'var(--accent-cyan)' }}>
      {formatAtomicSoulPaymentForDisplay(listedPriceAtomic)}
    </span>
  )
}
