'use client'

import { useEffect, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { useAdminFetch } from '../_hooks/use-admin-fetch'

interface TweetItem {
  id: string
  title: string
  content: string | null
  url: string
  score: number
  status: string
  rawData: string | null
  createdAt: string
}

interface TweetMeta {
  author?: string
  display_name?: string
  like_count?: number
  retweet_count?: number
  reply_count?: number
  view_count?: number
  tweet_type?: string
  posted_at?: string
}

function parseTweetMeta(rawData: string | null): TweetMeta | null {
  if (!rawData) return null
  try {
    const parsed = JSON.parse(rawData)
    return parsed && typeof parsed === 'object' ? (parsed as TweetMeta) : null
  } catch {
    return null
  }
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export default function TweetsReviewPage() {
  const adminFetch = useAdminFetch()
  const { showToast } = useToast()
  const [items, setItems] = useState<TweetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [tweetTags, setTweetTags] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const res = await adminFetch('/api/admin/tweets')
      if (cancelled) {
        return
      }

      if (res.ok) {
        const nextItems = await res.json()
        if (!cancelled) {
          setItems(nextItems)
        }
      } else if (res.status === 401 || res.status === 403) {
        showToast('无权限访问此页面', 'danger')
      }

      if (!cancelled) {
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [adminFetch, showToast])

  async function handleApprove(id: string) {
    const tags = parseTags(tweetTags[id] ?? '')
    if (tags.length === 0) {
      showToast('请至少填写一个标签', 'danger')
      return
    }
    setActionLoading(id)
    const res = await adminFetch(`/api/admin/tweets/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id))
      showToast('已通过', 'success')
    } else {
      const err = await res.json()
      showToast(err.error || '审核通过失败', 'danger')
    }
    setActionLoading(null)
  }

  async function handleReject(id: string) {
    setActionLoading(id)
    const res = await adminFetch(`/api/admin/tweets/${id}/reject`, { method: 'POST' })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id))
      showToast('已拒绝', 'default')
    } else {
      showToast('操作失败', 'danger')
    }
    setActionLoading(null)
  }

  if (loading) {
    return (
      <PageContainer>
        <SectionHeader label="Admin" title="推文审核" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="card" className="h-36" />
          ))}
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <SectionHeader label="Admin" title="推文审核" subtitle={`${items.length} 条待审核`} />

      {items.length === 0 ? (
        <EmptyState icon="🐦" label="没有待审核的推文" />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const meta = parseTweetMeta(item.rawData)
            const isProcessing = actionLoading === item.id
            const hasTags = parseTags(tweetTags[item.id] ?? '').length > 0

            return (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-purple">
                    {meta?.author ?? '未知'}
                  </span>
                  {meta?.display_name && (
                    <span className="text-xs text-muted">{meta.display_name}</span>
                  )}
                  <Tag color="muted">
                    {meta?.tweet_type === 'SHORT' ? '短推' : '长推'}
                  </Tag>
                  <span className="text-xs text-muted ml-auto">评分: {item.score}</span>
                </div>

                {/* Content */}
                <p className="text-sm text-foreground/80 whitespace-pre-wrap mb-3 line-clamp-4">
                  {item.content}
                </p>

                {/* Engagement */}
                <div className="flex items-center gap-4 text-xs text-muted mb-4">
                  <span>❤️ {meta?.like_count ?? 0}</span>
                  <span>🔁 {meta?.retweet_count ?? 0}</span>
                  <span>💬 {meta?.reply_count ?? 0}</span>
                  <span>👁 {meta?.view_count ?? 0}</span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple hover:underline ml-auto"
                  >
                    原文 ↗
                  </a>
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={tweetTags[item.id] ?? ''}
                    onChange={(e) =>
                      setTweetTags((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    placeholder="标签（逗号分隔）"
                    className="w-48 text-xs"
                  />
                  <Button
                    variant="teal"
                    size="sm"
                    onClick={() => handleApprove(item.id)}
                    disabled={isProcessing || !hasTags}
                  >
                    {isProcessing ? '处理中...' : '通过'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleReject(item.id)}
                    disabled={isProcessing}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </PageContainer>
  )
}
