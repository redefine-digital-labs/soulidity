'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'

interface PostDetail {
  id: string
  title: string
  content: string
  tags: string | null
  likeCount: number
  commentCount: number
  createdAt: string
  updatedAt: string
  member: { id: string; tgName: string | null; avatar: string | null; level: number }
  direction: { nameZh: string; icon: string; slug: string; category: { name: string } } | null
  comments: Array<{
    id: string
    content: string
    createdAt: string
    member: { id: string; tgName: string | null; avatar: string | null; level: number }
  }>
}

function levelBadge(level: number): string {
  const badges: Record<number, string> = {
    1: '🥚', 2: '🦐', 3: '🦞', 4: '🦞🦞', 5: '🦞🦞🦞'
  }
  return badges[level] ?? '🥚'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Comment form state
  const [memberId, setMemberId] = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function fetchPost() {
    try {
      const res = await fetch(`/api/community/posts/${id}`)
      if (!res.ok) throw new Error('加载失败')
      const data: PostDetail = await res.json()
      setPost(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) fetchPost()
  }, [id])

  async function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!memberId.trim() || !commentContent.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/community/posts/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberId.trim(), content: commentContent.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? '发表失败')
      }
      setCommentContent('')
      await fetchPost()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '发表失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PublicNav />
        <div className="max-w-4xl mx-auto p-6 text-center text-gray-400 py-16">加载中...</div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PublicNav />
        <div className="max-w-4xl mx-auto p-6">
          <Link href="/community" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block">
            ← 返回社区
          </Link>
          <div className="text-center text-gray-400 py-16">{error ?? '帖子不存在'}</div>
        </div>
      </div>
    )
  }

  const displayName = post.member.tgName ?? '匿名'
  const avatarChar = displayName.charAt(0).toUpperCase()
  const tags = post.tags ? post.tags.split(',').map(t => t.trim()).filter(Boolean) : []

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Back link */}
        <Link
          href="/community"
          className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-block transition-colors"
        >
          ← 返回社区
        </Link>

        {/* Post card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          {/* Post header */}
          <div className="flex items-center gap-3 mb-4">
            {/* Avatar */}
            <Link href={`/u/${post.member.id}`} className="shrink-0">
              <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600 hover:ring-2 hover:ring-blue-300 transition-all">
                {avatarChar}
              </div>
            </Link>

            {/* Name + level */}
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/u/${post.member.id}`}
                  className="text-sm font-medium text-gray-800 hover:text-blue-600 transition-colors truncate"
                >
                  {displayName}
                </Link>
                <span className="text-xs shrink-0" title={`Level ${post.member.level}`}>
                  {levelBadge(post.member.level)}
                </span>
              </div>
              <span className="text-xs text-gray-400">{formatDate(post.createdAt)}</span>
            </div>

            {/* Direction tag */}
            {post.direction && (
              <span className="ml-auto text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 shrink-0">
                {post.direction.icon} {post.direction.nameZh}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-tight">
            {post.title}
          </h1>

          {/* Content */}
          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap mb-4">
            {post.content}
          </p>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="text-xs bg-gray-100 text-gray-500 rounded-full px-3 py-1"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-400 pt-4 border-t border-gray-100">
            <span>👍 {post.likeCount}</span>
            <span>💬 {post.commentCount}</span>
          </div>
        </div>

        {/* Comments section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            评论 ({post.comments.length})
          </h2>

          {post.comments.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">暂无评论，来留下第一条吧</p>
          ) : (
            <div className="flex flex-col gap-5">
              {post.comments.map(comment => {
                const cName = comment.member.tgName ?? '匿名'
                const cChar = cName.charAt(0).toUpperCase()
                return (
                  <div key={comment.id} className="flex gap-3">
                    <Link href={`/u/${comment.member.id}`} className="shrink-0">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 hover:ring-2 hover:ring-blue-300 transition-all">
                        {cChar}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          href={`/u/${comment.member.id}`}
                          className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                        >
                          {cName}
                        </Link>
                        <span className="text-xs" title={`Level ${comment.member.level}`}>
                          {levelBadge(comment.member.level)}
                        </span>
                        <span className="text-xs text-gray-400 ml-auto shrink-0">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                        {comment.content}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Comment form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">发表评论</h2>
          <form onSubmit={handleCommentSubmit} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1" htmlFor="comment-member-id">
                用户ID (临时)
              </label>
              <input
                id="comment-member-id"
                type="text"
                value={memberId}
                onChange={e => setMemberId(e.target.value)}
                placeholder="输入你的用户 ID"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1" htmlFor="comment-content">
                内容
              </label>
              <textarea
                id="comment-content"
                value={commentContent}
                onChange={e => setCommentContent(e.target.value)}
                placeholder="写下你的评论..."
                rows={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all resize-none"
                required
              />
            </div>
            {submitError && (
              <p className="text-sm text-red-500">{submitError}</p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {submitting ? '提交中...' : '发表评论'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
