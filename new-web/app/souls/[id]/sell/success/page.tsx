'use client'

import { use } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'

function resolvePriceDisplay(rawPrice: string | null, listedPriceAtomic: string | null) {
  if (rawPrice) {
    try {
      return formatAtomicAmountForDisplay(parseDisplayAmountToAtomic(rawPrice))
    } catch {
      return rawPrice
    }
  }

  if (listedPriceAtomic) {
    return formatAtomicAmountForDisplay(listedPriceAtomic)
  }

  return 'Pending sync'
}

export default function SellSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { user, getAuthHeaders } = useAuth()
  const { data: soul } = useSoulDetail(id, getAuthHeaders, user?.id)

  const priceDisplay = resolvePriceDisplay(searchParams.get('price'), soul?.listedPriceAtomic ?? null)

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <div className="bg-card border border-border rounded-xl p-6 text-center pt-10">
        <div className="w-[72px] h-[72px] rounded-full bg-success/15 border-2 border-success flex items-center justify-center text-3xl mx-auto mb-5">
          🏷️
        </div>

        <h2 className="font-display text-xl font-bold mb-2">Soul listed</h2>
        <p className="text-muted mb-7">
          {soul ? (
            <>
              <span className="font-semibold text-foreground">{soul.name}</span> is now offered at{' '}
              <span className="text-gold font-semibold">{priceDisplay}</span>.
            </>
          ) : (
            'The listing digest has been submitted and the projection is syncing.'
          )}
        </p>

        <div className="bg-card2 border border-border rounded-xl p-4 text-left mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Soul</span>
            <span className="font-semibold">{soul?.name ?? id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Listing price</span>
            <span className="text-gold font-semibold">{priceDisplay}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Status</span>
            <span className="text-success">● Live in kiosk market</span>
          </div>
        </div>

        <div className="bg-purple/10 border border-purple/20 rounded-xl px-4 py-3 mb-7 text-left text-xs text-purple/80 leading-relaxed">
          The Soul stays in the owner kiosk flow and can be delisted later by the current owner. Any active grant is no longer durable across a completed transfer.
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/market"
            className="flex-1 bg-purple text-white font-bold text-sm px-4.5 py-2.5 rounded-lg hover:bg-purple-deep transition text-center"
          >
            View Market
          </Link>
          <Link
            href="/my-souls"
            className="flex-1 bg-transparent text-foreground border border-border font-semibold text-sm px-4.5 py-2.5 rounded-lg hover:border-purple transition text-center"
          >
            My Souls
          </Link>
        </div>
      </div>
    </div>
  )
}
