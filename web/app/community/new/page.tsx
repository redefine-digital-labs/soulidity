'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface DirectionOption {
  id: string
  nameZh: string
  icon: string
}

export default function NewCommunityPostPage() {
  const router = useRouter()

  // MVP: use first member. Auth integration later.
  // TEMP_MEMBER_ID will be replaced when auth is added
  const [memberId, setMemberId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [directionId, setDirectionId] = useState('')
  const [tags, setTags] = useState('')
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/directions')
      .then(r => (r.ok ? r.json() : []))
      .then((data: DirectionOption[]) => setDirections(data))
      .catch(() => setDirections([]))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const body: Record<string, string> = {
        memberId,
        title,
        content,
      }
      if (directionId) body.directionId = directionId
      if (tags.trim()) body.tags = tags.trim()

      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `发布失败 (${res.status})`)
        return
      }

      const post = await res.json()
      router.push(`/community/${post.id}`)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link
            href="/community"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; 返回社区
          </Link>
        </div>

        <div className="bg-white rounded-lg border shadow-sm p-6">
          <h1 className="text-xl font-bold mb-6">发布新帖子</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Temporary member ID field — remove when auth is integrated */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                用户ID (临时)
              </label>
              <input
                type="text"
                value={memberId}
                onChange={e => setMemberId(e.target.value)}
                placeholder="粘贴你的成员 UUID"
                required
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <p className="text-xs text-gray-400 mt-1">
                临时字段，auth 集成后将自动填充
              </p>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="帖子标题"
                required
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="写下你的内容..."
                required
                rows={8}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
              />
            </div>

            {/* Direction */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                方向 (可选)
              </label>
              <select
                value={directionId}
                onChange={e => setDirectionId(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                <option value="">不关联方向</option>
                {directions.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.icon} {d.nameZh}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                标签 (可选)
              </label>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="用逗号分隔，例如：DeFi,NFT,Sui"
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <p className="text-xs text-gray-400 mt-1">多个标签用逗号分隔</p>
            </div>

            {error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !memberId || !title || !content}
              className="w-full py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '发布中...' : '发布'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
