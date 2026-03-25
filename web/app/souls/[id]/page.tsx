'use client'

import { use, useState } from 'react'
import { useAuth } from '@web/components/auth-provider'
import { useSoulDetail } from '@web/lib/souls/queries'
import { SoulPricing } from '@web/components/souls/soul-pricing'
import { PlanSelector } from '@web/components/souls/plan-selector'
import { PurchaseButton } from '@web/components/souls/purchase-button'
import { ReleaseList } from '@web/components/souls/release-list'
import { PassStatus } from '@web/components/souls/pass-status'

export default function SoulDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { getAuthHeaders } = useAuth()
  const { data: soul, isLoading } = useSoulDetail(id, getAuthHeaders)
  const [planType, setPlanType] = useState<'onetime' | 'subscription'>('onetime')

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="max-w-4xl mx-auto px-6 py-12 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        Loading...
      </div>
    )
  }
  if (!soul) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
        Soul not found
      </div>
    )
  }

  const effectivePlanType =
    soul.oneTimePriceUsdc == null && soul.subPriceUsdc != null
      ? 'subscription'
      : soul.oneTimePriceUsdc != null && soul.subPriceUsdc == null
        ? 'onetime'
        : planType

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Info */}
        <div className="md:col-span-2 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {soul.name}
            </h1>
            <div className="flex gap-2 flex-wrap mb-3">
              <span className="badge badge-cyan">{soul.category}</span>
              {soul.tags.map((tag) => (
                <span
                  key={tag}
                  className="badge badge-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {soul.description}
            </p>
          </div>

          {/* Preview Images */}
          {soul.previewImages.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {soul.previewImages.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt={`Preview image ${i + 1} for ${soul.name}`}
                  loading="lazy"
                  decoding="async"
                  className="h-40 rounded-lg object-cover flex-shrink-0"
                />
              ))}
            </div>
          )}

          {/* Readme */}
          {soul.readme && (
            <div className="glass-card p-4">
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                README
              </h2>
              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--text-secondary)' }}>
                {soul.readme}
              </div>
            </div>
          )}

          {/* Releases */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Releases
            </h2>
            <ReleaseList releases={soul.releases} />
          </div>
        </div>

        {/* Right: Purchase Card */}
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-4 sticky top-20">
            <SoulPricing
              oneTime={soul.oneTimePriceUsdc}
              subscription={soul.subPriceUsdc}
              periodDays={soul.subPeriodDays}
            />

            {soul.userPass ? (
              <PassStatus
                pass={soul.userPass}
                seriesOnChainId={soul.onChainId}
                subPlanOnChainId={soul.subPlanOnChainId}
                subPriceUsdc={soul.subPriceUsdc}
              />
            ) : (
              <>
                <PlanSelector
                  hasOneTime={soul.oneTimePriceUsdc != null}
                  hasSubscription={soul.subPriceUsdc != null}
                  selected={effectivePlanType}
                  onChange={setPlanType}
                />

                <PurchaseButton
                  planType={effectivePlanType}
                  seriesOnChainId={soul.onChainId}
                  releaseOnChainId={soul.latestRelease?.onChainId ?? null}
                  planId={
                    effectivePlanType === 'onetime'
                      ? (soul.oneTimePlanOnChainId ?? '')
                      : (soul.subPlanOnChainId ?? '')
                  }
                  amountAtomic={
                    effectivePlanType === 'onetime'
                      ? soul.oneTimePriceUsdc
                      : soul.subPriceUsdc
                  }
                />
              </>
            )}
          </div>

          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {soul._count.passSnapshots} holders
          </div>
        </div>
      </div>
    </div>
  )
}
