'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { TabStrip } from '@/components/nav/tab-strip'
import { useToast } from '@/components/ui/toast'
import { useAdminFetch } from '../_hooks/use-admin-fetch'

type Tab = 'url' | 'markdown'

const TABS = [
  { id: 'url', label: '粘贴链接' },
  { id: 'markdown', label: '上传 Markdown' },
]

export default function AdminSubmitPage() {
  const adminFetch = useAdminFetch()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    articleId?: string
    title?: string
    error?: string
  } | null>(null)

  async function handleSubmit() {
    if (!url.trim()) return
    if (tab === 'markdown' && (!title.trim() || !content.trim())) return

    setLoading(true)
    setResult(null)

    try {
      const body =
        tab === 'url'
          ? { url: url.trim() }
          : { url: url.trim(), title: title.trim(), content: content.trim() }

      const res = await adminFetch('/api/admin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (res.ok) {
        setResult({ success: true, articleId: data.articleId, title: data.title })
        showToast('文章已创建', 'success')
        setUrl('')
        setTitle('')
        setContent('')
      } else {
        setResult({ success: false, error: data.error })
        showToast(data.error || '提交失败', 'danger')
      }
    } catch {
      setResult({ success: false, error: '网络错误，请重试' })
      showToast('网络错误，请重试', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit =
    !loading &&
    url.trim().length > 0 &&
    (tab === 'url' || (title.trim().length > 0 && content.trim().length > 0))

  return (
    <PageContainer size="md">
      <SectionHeader label="Admin" title="投稿" />

      <TabStrip
        tabs={TABS}
        activeId={tab}
        onChange={(id) => setTab(id as Tab)}
        className="mb-6"
      />

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-muted">文章链接</label>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
          />
        </div>

        {tab === 'markdown' && (
          <>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted">标题</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="文章标题"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted">
                内容（Markdown）
              </label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴 Markdown 内容..."
                className="min-h-[240px] font-mono text-[13px]"
              />
            </div>
          </>
        )}

        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {loading ? '处理中...' : '提交'}
        </Button>
      </div>

      {result && (
        <div
          className={`mt-6 rounded-xl border p-4 ${
            result.success
              ? 'border-success/30 bg-success/10'
              : 'border-danger/30 bg-danger/10'
          }`}
        >
          {result.success ? (
            <p className="text-sm text-success">
              文章已创建:{' '}
              <Link
                href={`/admin/articles/${result.articleId}`}
                className="font-medium underline"
              >
                {result.title}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-danger">{result.error}</p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
