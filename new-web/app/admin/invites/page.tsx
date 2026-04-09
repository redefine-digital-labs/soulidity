'use client'

import { useEffect, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { useAdminFetch } from '../_hooks/use-admin-fetch'

interface Invite {
  code: string
  createdAt: string
  usedBy: string | null
  active: number
}

export default function AdminInvitesPage() {
  const adminFetch = useAdminFetch()
  const { showToast } = useToast()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function loadInvites() {
    const res = await adminFetch('/api/admin/invites')
    if (res.ok) {
      const data = await res.json()
      setInvites(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadInvites()
  }, [adminFetch])

  async function handleGenerate() {
    setGenerating(true)
    const res = await adminFetch('/api/admin/invites', { method: 'POST' })
    if (res.ok) {
      showToast('邀请码已生成', 'success')
      await loadInvites()
    } else {
      showToast('生成失败', 'danger')
    }
    setGenerating(false)
  }

  return (
    <PageContainer>
      <SectionHeader
        label="Admin"
        title="邀请码管理"
        action={
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? '生成中...' : '生成邀请码'}
          </Button>
        }
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="card" className="h-12" />
          ))}
        </div>
      ) : invites.length === 0 ? (
        <EmptyState icon="🎟" label="暂无邀请码" />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card2">
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  邀请码
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  状态
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  使用者
                </th>
                <th className="text-left px-4 py-3 text-[12px] font-semibold text-muted uppercase tracking-wider">
                  创建时间
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv, idx) => (
                <tr
                  key={inv.code}
                  className={`border-b border-border last:border-0 ${
                    idx % 2 === 0 ? 'bg-card' : 'bg-card/60'
                  }`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-foreground">
                    {inv.code}
                  </td>
                  <td className="px-4 py-3">
                    <Tag color={inv.active ? 'success' : 'muted'}>
                      {inv.active ? '可用' : '已使用'}
                    </Tag>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {inv.usedBy ?? <span className="text-muted">-</span>}
                  </td>
                  <td className="px-4 py-3 text-muted text-[13px]">
                    {new Date(inv.createdAt).toLocaleString('zh-CN')}
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
