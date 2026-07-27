'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import type { ProtocolStats } from '@/app/api/stats/route'

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function StatCard({
  label,
  value,
  color,
  isLoading,
}: {
  label: string
  value: string
  color: string
  isLoading: boolean
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs text-muted mb-2">{label}</div>
      {isLoading ? (
        <Skeleton className="h-8 w-28 mt-1" />
      ) : (
        <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
      )}
    </div>
  )
}

export default function ResourcesStatsPage() {
  const { data, isLoading } = useQuery<ProtocolStats>({
    queryKey: ['protocol-stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch stats')
      return res.json()
    },
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
  })

  const stats: { label: string; value: string; color: string }[] = [
    {
      label: 'Total Souls on-chain',
      value: data ? formatCount(data.totalSouls) : '—',
      color: 'text-action-label',
    },
    {
      label: 'Est. trade volume',
      value: data ? formatAtomicAmountForDisplay(data.totalVolumeAtomic) : '—',
      color: 'text-teal',
    },
    {
      label: 'Active SoulGrants',
      value: data ? formatCount(data.activeSoulGrants) : '—',
      color: 'text-gold',
    },
    {
      label: 'Souls traded (30d est.)',
      value: data ? formatCount(data.soulsSold30d) : '—',
      color: 'text-foreground',
    },
    {
      label: 'Creator count',
      value: data ? formatCount(data.creatorCount) : '—',
      color: 'text-action-label',
    },
    {
      label: 'Avg listing price',
      value: data ? formatAtomicAmountForDisplay(data.avgSoulPriceAtomic) : '—',
      color: 'text-gold',
    },
    {
      label: 'Royalty paid (lifetime)',
      // No direct royalty tracking field in DB schema — placeholder until tracked
      value: '—',
      color: 'text-success',
    },
    {
      label: 'Collections launched',
      value: data ? formatCount(data.collectionsLaunched) : '—',
      color: 'text-teal',
    },
  ]

  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
      <h1 className="font-display text-2xl font-bold mb-0">Protocol Stats</h1>

      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b-[1.5px] border-border mt-4 mb-7" style={{ scrollbarWidth: 'none' }}>
        <Link
          href="/resources"
          className="bg-transparent border-none px-5 py-2.5 text-sm font-semibold text-muted cursor-pointer hover:text-foreground transition"
        >
          📄 Documentation
        </Link>
        <button className="bg-transparent border-none px-5 py-2.5 text-sm font-bold text-foreground border-b-[2.5px] border-purple -mb-[1.5px] cursor-pointer">
          📊 Protocol Stats
        </button>
      </div>

      <p className="text-muted text-sm mb-6">Mirror-based protocol estimates from on-chain Soulidity state on Sui.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            color={stat.color}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  )
}
