import { formatAtomicSoulPaymentForDisplay } from '@web/lib/souls/price-format'

type PriceBreakdownProps = {
  listedPriceAtomic: string
  purchasePlatformFeeAtomic: string | null
  purchaseCreatorRoyaltyAtomic: string | null
  purchaseTotalAtomic: string | null
}

export function PriceBreakdown({
  listedPriceAtomic,
  purchasePlatformFeeAtomic,
  purchaseCreatorRoyaltyAtomic,
  purchaseTotalAtomic,
}: PriceBreakdownProps) {
  const hasFees = purchasePlatformFeeAtomic && purchaseCreatorRoyaltyAtomic

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p
          className="text-[11px] uppercase tracking-[0.12em] font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          Price
        </p>
        <p
          className="data-value text-[2rem] font-semibold leading-tight"
          style={{ color: 'var(--accent-cyan)' }}
        >
          {formatAtomicSoulPaymentForDisplay(listedPriceAtomic)}
        </p>
      </div>

      {hasFees ? (
        <div
          className="flex flex-col gap-1 pt-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-muted)' }}>Platform fee</span>
            <span className="data-value" style={{ color: 'var(--text-secondary)' }}>
              {formatAtomicSoulPaymentForDisplay(purchasePlatformFeeAtomic)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-muted)' }}>Creator royalty</span>
            <span className="data-value" style={{ color: 'var(--text-secondary)' }}>
              {formatAtomicSoulPaymentForDisplay(purchaseCreatorRoyaltyAtomic)}
            </span>
          </div>
          {purchaseTotalAtomic ? (
            <div
              className="flex justify-between text-xs font-medium pt-1"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span style={{ color: 'var(--text-primary)' }}>Total</span>
              <span className="data-value" style={{ color: 'var(--accent-cyan)' }}>
                {formatAtomicSoulPaymentForDisplay(purchaseTotalAtomic)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
