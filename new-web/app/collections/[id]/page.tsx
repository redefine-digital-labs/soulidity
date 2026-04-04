'use client'

import { use } from 'react'
import Link from 'next/link'
import { useCollectionDetail } from '@/lib/hooks/use-collections'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function buildHeroStyle(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }
  }

  return {
    backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.2), rgba(44,20,98,0.65)), url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

export default function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: collection, isLoading, error } = useCollectionDetail(id)

  if (isLoading) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="h-[420px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (error || !collection) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <EmptyState
          icon="📦"
          label="Collection not found"
          sublabel="The Soulidity projection does not have this collection yet."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  const listedPrice = collection.listedPriceAtomic
    ? formatAtomicAmountForDisplay(collection.listedPriceAtomic)
    : 'Not listed'
  const totalPrice = collection.quote?.totalAtomic
    ? formatAtomicAmountForDisplay(collection.quote.totalAtomic)
    : listedPrice

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <Link href="/market" className="text-muted text-xs hover:text-foreground transition block">
        ← Back to Market
      </Link>

      <div className="w-full h-[220px] rounded-xl flex items-end p-6 relative overflow-hidden" style={buildHeroStyle(collection.imageUrl)}>
        <div className="relative z-10 flex flex-wrap gap-2">
          <Tag color={collection.listingStatus === 'listed' ? 'gold' : collection.tradeable ? 'muted' : 'danger'}>
            {collection.listingStatus === 'listed' ? 'Listed' : collection.tradeable ? 'Held' : 'Non-tradeable'}
          </Tag>
          <Tag color="teal">{collection.soulCount} Souls</Tag>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold">{collection.name}</h1>
            <p className="text-sm text-muted mt-2">{collection.description}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card2 border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Listed price</div>
              <div className="font-bold text-gold">{listedPrice}</div>
            </div>
            <div className="bg-card2 border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Checkout total</div>
              <div className="font-bold">{totalPrice}</div>
            </div>
            <div className="bg-card2 border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Royalty</div>
              <div className="font-bold text-teal">{(collection.extraRoyaltyBps / 100).toFixed(2)}%</div>
            </div>
            <div className="bg-card2 border border-border rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Holder</div>
              <div className="font-bold">{formatAddress(collection.currentHolderAddress)}</div>
            </div>
          </div>

          <div className="bg-card2 border border-border rounded-xl p-4 space-y-3">
            <div className="page-kicker text-muted">Protocol State</div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Collection object</span>
              <span className="font-mono text-xs text-teal">{formatAddress(collection.onChainId)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Right object</span>
              <span className="font-mono text-xs text-teal">{formatAddress(collection.rightOnChainId)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Creator</span>
              <span>{formatAddress(collection.creatorAddress)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Current holder kiosk</span>
              <span className="font-mono text-xs text-teal">{formatAddress(collection.currentHolderKioskId)}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-xl font-bold">Souls in this collection</h2>
              <span className="text-xs text-muted">{collection.souls.length} mirrored Souls</span>
            </div>

            {collection.souls.length === 0 ? (
              <EmptyState
                icon="🫥"
                label="No Souls mirrored yet"
                sublabel="Souls will appear here after mint or sync."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {collection.souls.map((soul) => (
                  <Link
                    key={soul.id}
                    href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                    className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple hover:-translate-y-0.5 transition block"
                  >
                    <div className="h-28 flex items-end p-3" style={buildHeroStyle(soul.imageUrl)}>
                      <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'}>{soul.listingStatus}</Tag>
                    </div>
                    <div className="p-4">
                      <div className="font-bold text-sm">{soul.name}</div>
                      <div className="text-xs text-muted mt-1 line-clamp-2">{soul.description}</div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-muted">{formatAddress(soul.currentOwnerAddress)}</span>
                        <span className="text-gold font-semibold">
                          {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-gold rounded-xl p-5">
            <div className="text-[11px] font-bold text-gold uppercase tracking-[0.1em] mb-3">Collection Right</div>
            <div className="font-display text-2xl font-bold text-gold mb-2">{totalPrice}</div>
            <p className="text-xs text-muted mb-4">
              Buying the collection right transfers royalty participation for Souls already bound to this collection.
            </p>
            {collection.listingStatus === 'listed' ? (
              <Link
                href={`/collections/${encodeURIComponent(collection.onChainId)}/buy`}
                className={buttonStyles({ variant: 'gold', full: true })}
              >
                Buy Collection Right
              </Link>
            ) : (
              <div className="text-xs text-muted">The current holder has not listed this right.</div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="text-[11px] font-bold text-muted uppercase tracking-[0.1em] mb-3">Notes</div>
            <ul className="space-y-2 text-xs text-muted leading-relaxed">
              <li>Royalty enforcement is on chain and follows the collection transfer policy.</li>
              <li>Only tradable collection rights can be listed or purchased.</li>
              <li>Projection state is mirrored from Soulidity events and kiosk ownership.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
