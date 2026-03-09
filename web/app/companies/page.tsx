'use client'
import { useEffect, useState, useCallback } from 'react'
import { PublicNav } from '@web/components/public-nav'

interface Company {
  id: string
  name: string
  slug: string
  description: string | null
  category: string
  mentionCount: number
}

const CATEGORY_COLORS: Record<string, string> = {
  'AI': 'badge-cyan',
  'DeFi': 'badge-emerald',
  'Infrastructure': 'badge-amber',
  'L1/L2': 'badge-violet',
  'Gaming': 'badge-rose',
  'NFT': 'badge-amber',
  'DAO': 'badge-cyan',
  'Exchange': 'badge-rose',
  'Wallet': 'badge-blue',
  'Other': 'badge-muted',
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filter, setFilter] = useState<string>('')

  const fetchCompanies = useCallback(() => {
    const url = filter ? `/api/companies?category=${filter}` : '/api/companies'
    fetch(url).then(r => r.ok ? r.json() : []).then(setCompanies)
  }, [filter])

  useEffect(() => { fetchCompanies() }, [fetchCompanies])

  const categories = ['', 'AI', 'DeFi', 'Infrastructure', 'L1/L2', 'Exchange', 'Other']

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">Companies</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Tracked entities across the crypto ecosystem</p>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap animate-fade-up" style={{ animationDelay: '50ms' }}>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`filter-pill ${filter === c ? 'filter-pill-active' : ''}`}
            >
              {c || 'All'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 stagger-children">
          {companies.map(company => (
            <div key={company.id} className="glass-card glow-cyan p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{company.name}</span>
                  <span className={`badge ${CATEGORY_COLORS[company.category] ?? 'badge-muted'}`}>{company.category}</span>
                </div>
                {company.description && (
                  <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{company.description}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>{company.mentionCount}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>mentions</div>
              </div>
            </div>
          ))}
          {companies.length === 0 && (
            <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>No companies</div>
          )}
        </div>
      </div>
    </div>
  )
}
