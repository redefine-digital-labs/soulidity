'use client'

import { formatAtomicAmountForDisplay, quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import type { NativeMarketListSnapshot } from '@/lib/animacraft/market-list-types'

/** Exact gross-price splits use the verified immutable native royalty schedule. */
export function NativeListingQuote({ snapshot, priceAtomic }: { snapshot: NativeMarketListSnapshot | null; priceAtomic: bigint | null }) {
  if (!snapshot) return <p className="text-xs text-muted">The verified listing quote is unavailable. Refresh before signing.</p>
  let quote: ReturnType<typeof quoteAnimacraftV8SoulSale> | null = null
  try { if (priceAtomic && priceAtomic > 0n) quote = quoteAnimacraftV8SoulSale(priceAtomic, snapshot) } catch { /* Invalid input cannot authorize a listing. */ }
  return <div className="rounded-xl border border-border bg-card2 overflow-hidden">
    <p className="px-4 py-3 text-xs text-muted">The buyer pays the gross price. Protocol and both royalty shares are included, not added again.</p>
    {quote && [
      ['Gross sale price', quote.priceAtomic], ['Protocol fee · included', quote.protocolFeeAtomic],
      ['Soul creator royalty · included', quote.soulCreatorRoyaltyAtomic], ['Maker-source royalty · included', quote.makerSourceRoyaltyAtomic],
      ['Seller payout', quote.sellerPayoutAtomic],
    ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-3 border-t border-border px-4 py-2.5 text-sm">
      <span className="text-muted">{String(label)}</span><span className="font-semibold text-right">{formatAtomicAmountForDisplay(value as bigint)}</span>
    </div>)}
    {!quote && <p className="px-4 pb-3 text-xs text-muted">Enter a valid price to see the exact amounts.</p>}
  </div>
}
