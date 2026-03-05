'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface PostItem {
  id: string
  title: string
  content: string
  likeCount: number
  commentCount: number
  createdAt: string
  member: { id: string; tgName: string | null; avatar: string | null; level: number }
  direction: { nameZh: string; icon: string; slug: string } | null
}

interface CategoryItem {
  id: string
  name: string
  nameZh: string
  icon: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

export default function CommunityPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [posts, setPosts] = useState<PostItem[]>([])
  const [activeDirection, setActiveDirection] = useState<string>('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/categories')
      .then(r => (r.ok ? r.json() : []))
      .then(setCategories)
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeDirection) params.set('direction', activeDirection)
    params.set('sort', sort)
    fetch(`/api/community/posts?${params.toString()}`)
      .then(r => (r.ok ? r.json() : []))
      .then(setPosts)
      .finally(() => setLoading(false))
  }, [activeDirection, sort])

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Header row */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">社区日志</h1>
            <p className="text-gray-500 text-sm">分享你的养成历程与心得</p>
          </div>
          <Link
            href="/community/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            发布日志
          </Link>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* Direction tabs */}
          <div className="flex gap-2 flex-wrap flex-1">
            <button
              onClick={() => setActiveDirection('')}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                activeDirection === ''
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveDirection(cat.name)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  activeDirection === cat.name
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {cat.icon} {cat.nameZh}
              </button>
            ))}
          </div>

          {/* Sort toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white shrink-0">
            <button
              onClick={() => setSort('latest')}
              className={`text-sm px-3 py-1.5 transition-colors ${
                sort === 'latest'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              最新
            </button>
            <button
              onClick={() => setSort('popular')}
              className={`text-sm px-3 py-1.5 transition-colors ${
                sort === 'popular'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              热门
            </button>
          </div>
        </div>

        {/* Post list */}
        {loading ? (
          <div className="text-center text-gray-400 py-16">加载中...</div>
        ) : posts.length === 0 ? (
          <div className="text-center text-gray-400 py-16">暂无日志</div>
        ) : (
          <div className="flex flex-col gap-3">
            {posts.map(post => {
              const displayName = post.member.tgName ?? '匿名'
              const avatarChar = displayName.charAt(0).toUpperCase()
              const preview = post.content.length > 100
                ? post.content.slice(0, 100) + '…'
                : post.content

              return (
                <div
                  key={post.id}
                  className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow"
                >
                  {/* Author row */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                      {avatarChar}
                    </div>
                    <span className="text-sm text-gray-600">{displayName}</span>
                    {post.direction && (
                      <span className="ml-auto text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5">
                        {post.direction.icon} {post.direction.nameZh}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <Link
                    href={`/community/${post.id}`}
                    className="block font-medium text-gray-900 hover:text-blue-600 mb-1 transition-colors"
                  >
                    {post.title}
                  </Link>

                  {/* Content preview */}
                  {preview && (
                    <p className="text-sm text-gray-500 leading-relaxed mb-3">
                      {preview}
                    </p>
                  )}

                  {/* Footer row */}
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>👍 {post.likeCount}</span>
                    <span>💬 {post.commentCount}</span>
                    <span className="ml-auto">{timeAgo(post.createdAt)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
