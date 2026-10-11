'use client'

import { useEffect, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import type { TagColor } from '@/components/ui/tag'
import { useAdminFetch } from '../_hooks/use-admin-fetch'

interface Member {
  id: string
  tgId: string | null
  tgName: string | null
  level: number
  joinedAt: string
}

const LEVEL_LABELS: Record<number, string> = {
  0: '新人',
  1: '成长中',
  2: '资深',
}

const LEVEL_COLORS: Record<number, TagColor> = {
  0: 'muted',
  1: 'gold',
  2: 'purple',
}

export default function AdminMembersPage() {
  const adminFetch = useAdminFetch()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminFetch('/api/admin/members')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [adminFetch])

  return (
    <PageContainer>
      <SectionHeader
        label="Admin"
        title="成员管理"
        subtitle={loading ? undefined : `共 ${members.length} 名成员`}
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="card" className="h-12" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState icon="👥" label="暂无成员" />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card2">
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  TG ID
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  昵称
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  等级
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  加入时间
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => (
                <tr
                  key={m.id}
                  className={`border-b border-border last:border-0 ${
                    idx % 2 === 0 ? 'bg-card' : 'bg-card/60'
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-foreground">
                    {m.tgId ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {m.tgName ?? <span className="text-muted">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Tag color={LEVEL_COLORS[m.level] ?? 'muted'}>
                      {LEVEL_LABELS[m.level] ?? `L${m.level}`}
                    </Tag>
                  </td>
                  <td className="px-4 py-3 text-muted text-[13px]">
                    {new Date(m.joinedAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  )
}
