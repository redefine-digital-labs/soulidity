'use client'
import { useEffect, useState } from 'react'

interface Stats {
  raw_new: number
  articles_draft: number
  articles_reviewed: number
  published_today: number
  companies_total: number
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats)
  }, [])

  if (!stats) return <div className="animate-pulse h-16 bg-gray-100 rounded" />

  const items = [
    { label: 'Pending', value: stats.raw_new, color: 'text-yellow-600' },
    { label: 'Draft', value: stats.articles_draft, color: 'text-blue-600' },
    { label: 'Reviewed', value: stats.articles_reviewed, color: 'text-green-600' },
    { label: 'Published Today', value: stats.published_today, color: 'text-purple-600' },
    { label: 'Companies', value: stats.companies_total, color: 'text-indigo-600' },
  ]

  return (
    <div className="grid grid-cols-5 gap-4">
      {items.map(item => (
        <div key={item.label} className="bg-white rounded-lg p-4 shadow-sm border">
          <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
          <div className="text-sm text-gray-500">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
