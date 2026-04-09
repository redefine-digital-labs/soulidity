'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Button, buttonStyles } from '@/components/ui/button'
import { SkillsPanel } from '@/components/souls/skills-panel'
import { MemoryPanel } from '@/components/souls/memory-panel'
import { UpdatePriceModal, DelistModal } from '@/components/souls/listing-modals'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import type { SoulAssetDetail } from '@/lib/soulidity/types'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function buildHeroStyle(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }
  }

  return {
    backgroundImage: `linear-gradient(135deg, rgba(15, 17, 26, 0.2), rgba(44, 20, 98, 0.75)), url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

function ListingCta({
  soul,
  priceLabel,
  onUpdatePrice,
  onDelist,
}: {
  soul: SoulAssetDetail
  priceLabel: string
  onUpdatePrice: () => void
  onDelist: () => void
}) {
  const router = useRouter()
  const { requireAuth } = useRequireAuth()
  const listed = soul.listingStatus === 'listed'

  if (soul.isOwner) {
    if (listed) {
      return (
        <>
          <Button variant="gold" onClick={onUpdatePrice}>Update Price</Button>
          <Button variant="outline" onClick={onDelist}>Delist</Button>
        </>
      )
    }
    return (
      <Link href={`/souls/${encodeURIComponent(soul.onChainId)}/sell`} className={buttonStyles({ variant: 'gold' })}>
        List Soul
      </Link>
    )
  }

  if (!listed) {
    return null
  }

  return (
    <button
      type="button"
      onClick={() => {
        requireAuth(() => {
          router.push(`/souls/${encodeURIComponent(soul.onChainId)}/buy`)
        })
      }}
      className={buttonStyles({ variant: 'gold' })}
    >
      Buy for {priceLabel}
    </button>
  )
}

export default function SoulDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error } = useSoulDetail(id, getAuthHeaders, user?.id)
  const [showUpdatePrice, setShowUpdatePrice] = useState(false)
  const [showDelist, setShowDelist] = useState(false)

  if (isLoading) {
    return (
      <div className="max-w-[760px] w-full mx-auto px-4 sm:px-6 py-8">
        <div className="h-4 w-32 bg-card2 rounded animate-pulse mb-6" />
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="h-[220px] bg-card2 animate-pulse" />
          <div className="p-6 space-y-3">
            <div className="h-6 w-56 bg-card2 rounded animate-pulse" />
            <div className="h-4 w-40 bg-card2 rounded animate-pulse" />
            <div className="h-16 w-full bg-card2 rounded animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !soul) {
    return (
      <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-12">
        <EmptyState
          icon="🫥"
          label="Soul not found"
          sublabel="The Soulidity projection does not have this asset yet, or the route ID is invalid."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  const priceLabel = soul.quote?.totalAtomic
    ? formatAtomicAmountForDisplay(soul.quote.totalAtomic)
    : soul.listedPriceAtomic
      ? formatAtomicAmountForDisplay(soul.listedPriceAtomic)
      : 'Not listed'

  return (
    <div className="max-w-[760px] w-full mx-auto px-4 sm:px-6 py-8 relative z-10 space-y-6">
      <Link href="/market" className="text-muted text-xs hover:text-foreground transition block">
        ← Back to Market
      </Link>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="w-full h-[200px] sm:h-[240px] flex items-end p-6" style={buildHeroStyle(soul.imageUrl)}>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
            <span>{soul.provenanceKind === 'personal-join' ? 'Personal Join' : soul.provenanceKind === 'imported' ? 'Imported' : 'Native'}</span>
            <span className="text-white/50">·</span>
            <span>{soul.listingStatus === 'listed' ? 'Listed' : 'Held'}</span>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Tag color="purple">{soul.category}</Tag>
                {soul.tags.map((tag) => (
                  <Tag key={tag} color="muted">{tag}</Tag>
                ))}
                {soul.collection && <Tag color="teal">{soul.collection.name}</Tag>}
              </div>

              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold">{soul.name}</h1>
                <p className="mt-2 text-sm text-muted">
                  Creator {formatAddress(soul.creatorAddress)}
                  <span className="mx-2 text-border">·</span>
                  Owner {formatAddress(soul.currentOwnerAddress)}
                </p>
              </div>

              <p className="text-sm text-muted leading-7">{soul.description}</p>
            </div>

            <div className="min-w-[240px] rounded-xl border border-gold bg-card2 p-4">
              <div className="text-xs text-muted">Current checkout total</div>
              <div className="mt-1 font-display text-2xl font-bold text-gold">{priceLabel}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ListingCta
                  soul={soul}
                  priceLabel={priceLabel}
                  onUpdatePrice={() => setShowUpdatePrice(true)}
                  onDelist={() => setShowDelist(true)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-card2 border border-border rounded-xl p-4 space-y-3">
              <div className="page-kicker text-muted">Protocol State</div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Soul object</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.onChainId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">State object</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.stateOnChainId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Memory object</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.memoryOnChainId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Content blob</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.contentBlobObjectId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Skills root</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.skillsOnChainId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Created</span>
                <span>{formatDate(soul.createdAt)}</span>
              </div>
            </div>

            <div className="bg-card2 border border-border rounded-xl p-4 space-y-3">
              <div className="page-kicker text-muted">Access</div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Owner access</span>
                <span className="text-success">Active</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Grant capacity</span>
                <span>{soul.activeGrantCount} / {soul.grantCapacity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Skills versions</span>
                <span>{soul.skillVersionCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Creator royalty</span>
                <span>{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Collection royalty</span>
                <span>{soul.collection ? `${(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%` : 'None'}</span>
              </div>
            </div>
          </div>

          {soul.collection && (
            <div className="bg-card2 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="page-kicker text-muted mb-2">Collection</div>
                  <div className="font-semibold">{soul.collection.name}</div>
                  <div className="text-sm text-muted mt-1">{soul.collection.description}</div>
                </div>
                <Link href={`/collections/${encodeURIComponent(soul.collection.onChainId)}`} className={buttonStyles({ variant: 'outline' })}>
                  View Collection
                </Link>
              </div>
            </div>
          )}

          <div className="bg-card2 border border-border rounded-xl p-4">
            <div className="page-kicker text-muted mb-3">Active Grants</div>
            {soul.activeGrants.length > 0 ? (
              <div className="space-y-3">
                {soul.activeGrants.map((grant) => (
                  <div key={grant.id} className="rounded-lg border border-border/80 bg-white/[0.03] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag color="success">{grant.status}</Tag>
                      {grant.scopes.map((scope) => (
                        <Tag key={`${grant.id}:${scope}`} color="teal">{scope}</Tag>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted">Grantee</span>
                        <span>{formatAddress(grant.granteeAddress)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Issued by</span>
                        <span>{formatAddress(grant.issuedByAddress)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Expires</span>
                        <span>{formatDate(grant.expiresAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No active SoulGrant is attached to this Soul.</p>
            )}
          </div>

          <SkillsPanel soul={soul} />

          <MemoryPanel soul={soul} />
        </div>
      </div>

      {soul.isOwner && soul.listingStatus === 'listed' && (
        <>
          <UpdatePriceModal soul={soul} open={showUpdatePrice} onClose={() => setShowUpdatePrice(false)} />
          <DelistModal soul={soul} open={showDelist} onClose={() => setShowDelist(false)} />
        </>
      )}
    </div>
  )
}
