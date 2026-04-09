'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import type { TagColor } from '@/components/ui/tag'
import { useAdminFetch } from '../../_hooks/use-admin-fetch'

interface Company {
  id: string
  name: string
  category: string
}

interface Article {
  id: string
  status: string
  titleZh: string | null
  titleEn: string | null
  summaryZh: string | null
  summaryEn: string | null
  analysisZh: string | null
  tags: string | null
  createdAt: string
  source_url: string | null
  source_name: string | null
  companies: Company[]
}

const STATUS_COLOR: Record<string, TagColor> = {
  draft: 'gold',
  published: 'teal',
  rejected: 'danger',
}

export default function ArticleEditorPage() {
  const adminFetch = useAdminFetch()
  const params = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  const id = params.id as string

  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // Editable fields
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    adminFetch(`/api/admin/articles/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then((data: Article) => {
        setArticle(data)
        setTitle(data.titleZh ?? '')
        setSummary(data.summaryZh ?? '')
        setAnalysis(data.analysisZh ?? '')
        const parsed: string[] = (() => {
          try {
            return data.tags ? JSON.parse(data.tags) : []
          } catch {
            return []
          }
        })()
        setTags(parsed.join(', '))
      })
      .catch(() => setError(true))
  }, [id, adminFetch])

  async function handleSave() {
    setSaving(true)
    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const res = await adminFetch(`/api/admin/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleZh: title,
          summaryZh: summary,
          analysisZh: analysis,
          tags: JSON.stringify(parsedTags),
        }),
      })
      if (res.ok) {
        showToast('保存成功', 'success')
      } else {
        const err = await res.json()
        showToast(err.error || '保存失败', 'danger')
      }
    } catch {
      showToast('网络错误', 'danger')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setPublishing(true)
    try {
      const res = await adminFetch(`/api/admin/articles/${id}/publish`, { method: 'POST' })
      if (res.ok) {
        showToast('已发布到 Telegram', 'success')
        setArticle((prev) => (prev ? { ...prev, status: 'published' } : prev))
      } else {
        const err = await res.json()
        showToast(err.error || '发布失败', 'danger')
      }
    } catch {
      showToast('网络错误', 'danger')
    } finally {
      setPublishing(false)
    }
  }

  async function handleReject() {
    try {
      const res = await adminFetch(`/api/admin/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      if (res.ok) {
        showToast('已拒绝', 'default')
        setArticle((prev) => (prev ? { ...prev, status: 'rejected' } : prev))
      } else {
        showToast('操作失败', 'danger')
      }
    } catch {
      showToast('网络错误', 'danger')
    }
  }

  if (error) {
    return (
      <PageContainer size="md">
        <EmptyState icon="🔍" label="文章未找到" sublabel="该文章不存在或已被删除" />
      </PageContainer>
    )
  }

  if (!article) {
    return (
      <PageContainer size="md">
        <div className="flex flex-col gap-4">
          <Skeleton variant="text" className="w-1/3 h-6" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="md">
      <SectionHeader
        label="Admin / 文章"
        title="编辑文章"
        action={
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}>
            返回
          </Button>
        }
      />

      {/* Meta info */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tag color={STATUS_COLOR[article.status] ?? 'muted'}>
          {article.status === 'draft'
            ? '草稿'
            : article.status === 'published'
              ? '已发布'
              : article.status === 'rejected'
                ? '已拒绝'
                : article.status}
        </Tag>
        {article.source_name && (
          <span className="text-[13px] text-muted">{article.source_name}</span>
        )}
        {article.source_url && (
          <a
            href={article.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-purple hover:underline"
          >
            原文链接 ↗
          </a>
        )}
        <span className="text-[13px] text-muted ml-auto">
          {new Date(article.createdAt).toLocaleString('zh-CN')}
        </span>
      </div>

      {/* Edit form */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">标题</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="中文标题"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">摘要</label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="中文摘要"
            className="min-h-[100px]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">深度解读</label>
          <Textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            placeholder="深度解读（可选）"
            className="min-h-[120px]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">
            标签（逗号分隔）
          </label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="AI, Web3, DeFi"
          />
        </div>

        {/* Linked companies */}
        {article.companies.length > 0 && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-muted">关联项目</label>
            <div className="flex flex-wrap gap-2">
              {article.companies.map((c) => (
                <Tag key={c.id} color="purple">
                  {c.name}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
        {article.status === 'draft' && (
          <>
            <Button variant="teal" onClick={handlePublish} disabled={publishing}>
              {publishing ? '发布中...' : '发布到 TG'}
            </Button>
            <Button variant="danger" onClick={handleReject}>
              拒绝
            </Button>
          </>
        )}
      </div>
    </PageContainer>
  )
}
