'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import type { TagColor } from '@/components/ui/tag'
import { useAdminFetch } from '../_hooks/use-admin-fetch'

interface Company {
  id: string
  name: string
  slug: string
  description: string | null
  category: string
  mentionCount: number
}

const CATEGORY_COLOR: Record<string, TagColor> = {
  AI: 'teal',
  DeFi: 'teal',
  Infrastructure: 'gold',
  'L1/L2': 'purple',
  Exchange: 'danger',
  Wallet: 'purple',
  Gaming: 'gold',
  NFT: 'gold',
  DAO: 'teal',
  Other: 'muted',
}

const CATEGORIES = ['', 'AI', 'DeFi', 'Infrastructure', 'L1/L2', 'Exchange', 'Other']

const CATEGORY_TABS = CATEGORIES.map((c) => ({ id: c, label: c || '全部' }))

export default function AdminCompaniesPage() {
  const adminFetch = useAdminFetch()
  const [companies, setCompanies] = useState<Company[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(() => {
    setLoading(true)
    const url = filter ? `/api/admin/companies?category=${filter}` : '/api/admin/companies'
    adminFetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCompanies(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [filter, adminFetch])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  return (
    <PageContainer>
      <SectionHeader label="Admin" title="项目追踪" subtitle="追踪加密生态中的项目与实体" />

      <FilterTabs
        tabs={CATEGORY_TABS}
        activeId={filter}
        onChange={setFilter}
        className="mb-6"
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="card" className="h-16" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <EmptyState icon="🏢" label="暂无项目" />
      ) : (
        <div className="flex flex-col gap-2">
          {companies.map((company) => (
            <div
              key={company.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-foreground">{company.name}</span>
                  <Tag color={CATEGORY_COLOR[company.category] ?? 'muted'}>
                    {company.category}
                  </Tag>
                </div>
                {company.description && (
                  <p className="text-[13px] text-muted truncate">{company.description}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-bold text-teal">{company.mentionCount}</div>
                <div className="text-xs text-muted">次提及</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
