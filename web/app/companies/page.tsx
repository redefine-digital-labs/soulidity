'use client'
import { useEffect, useState, useCallback } from 'react'

interface Company {
  id: string
  name: string
  slug: string
  description: string | null
  category: string
  mentionCount: number
}

const CATEGORY_COLORS: Record<string, string> = {
  'AI': 'bg-blue-100 text-blue-700',
  'DeFi': 'bg-green-100 text-green-700',
  'Infrastructure': 'bg-orange-100 text-orange-700',
  'L1/L2': 'bg-purple-100 text-purple-700',
  'Gaming': 'bg-pink-100 text-pink-700',
  'NFT': 'bg-yellow-100 text-yellow-700',
  'DAO': 'bg-teal-100 text-teal-700',
  'Exchange': 'bg-red-100 text-red-700',
  'Wallet': 'bg-cyan-100 text-cyan-700',
  'Other': 'bg-gray-100 text-gray-700',
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filter, setFilter] = useState<string>('')

  const fetchCompanies = useCallback(() => {
    const url = filter ? `/api/companies?category=${filter}` : '/api/companies'
    fetch(url).then(r => r.ok ? r.json() : []).then(setCompanies)
  }, [filter])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  const categories = ['', 'AI', 'DeFi', 'Infrastructure', 'L1/L2', 'Exchange', 'Other']

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Companies</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1 rounded text-sm ${filter === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {c || 'All'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {companies.map(company => (
          <div
            key={company.id}
            className="bg-white rounded-lg p-4 shadow-sm border flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{company.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[company.category] ?? CATEGORY_COLORS['Other']}`}>
                  {company.category}
                </span>
              </div>
              {company.description && (
                <div className="text-sm text-gray-500 mt-1 truncate">{company.description}</div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-bold text-gray-900">{company.mentionCount}</div>
              <div className="text-xs text-gray-400">mentions</div>
            </div>
          </div>
        ))}
        {companies.length === 0 && (
          <div className="text-center text-gray-400 py-8">No companies</div>
        )}
      </div>
    </div>
  )
}
