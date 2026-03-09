'use client'
import { useEffect, useState } from 'react'

interface Stats {
  raw_new: number
  articles_draft: number
  articles_rejected: number
  published_today: number
  companies_total: number
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats)
  }, [])

  if (!stats) return <div className="h-20 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />

  const items = [
    { label: 'Pending', value: stats.raw_new, color: 'var(--accent-amber)' },
    { label: 'Draft', value: stats.articles_draft, color: 'var(--accent-blue)' },
    { label: 'Rejected', value: stats.articles_rejected, color: 'var(--accent-rose)' },
    { label: 'Published', value: stats.published_today, color: 'var(--accent-violet)' },
    { label: 'Companies', value: stats.companies_total, color: 'var(--accent-cyan)' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {items.map(item => (
        <div key={item.label} className="glass-panel p-4 text-center">
          <div className="text-2xl font-bold data-value stat-glow" style={{ color: item.color }}>{item.value}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}
