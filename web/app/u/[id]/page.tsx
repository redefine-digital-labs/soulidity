'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'

interface MemberProfile {
  id: string
  tgId: string
  tgName: string | null
  wallet: string | null
  level: number
  inviteCode: string | null
  avatar: string | null
  bio: string | null
  exp: number
  joinedAt: string
  posts: Array<{
    id: string
    title: string
    content: string
    likeCount: number
    commentCount: number
    createdAt: string
    direction: { nameZh: string; icon: string } | null
  }>
  achievements: Array<{
    memberId: string
    achievementId: string
    earnedAt: string
    achievement: {
      id: string
      name: string
      nameZh: string
      description: string | null
      icon: string
      condition: string | null
    }
  }>
}

const LEVELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '🥚', label: '孵化中' },
  2: { emoji: '🦐', label: '初蜕壳' },
  3: { emoji: '🦞', label: '成长期' },
  4: { emoji: '🦞🦞', label: '达人' },
  5: { emoji: '🦞🦞🦞', label: '导师' },
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

export default function UserProfilePage() {
  const params = useParams()
  const id = params.id as string
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/community/profile/${id}`)
      .then(r => {
        if (r.status === 404) {
          setNotFound(true)
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data) setProfile(data)
      })
      .finally(() => setLoading(false))
  }, [id])

  const displayName = profile?.tgName ?? '匿名'
  const avatarChar = displayName.charAt(0).toUpperCase()
  const levelInfo = profile ? (LEVELS[profile.level] ?? LEVELS[1]) : null
  const totalLikes = profile ? profile.posts.reduce((sum, p) => sum + p.likeCount, 0) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-2xl mx-auto p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-24">加载中...</div>
        ) : notFound || !profile ? (
          <div className="text-center text-gray-400 py-24">用户不存在</div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Profile header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl font-semibold text-gray-600 shrink-0">
                  {avatarChar}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Name */}
                  <h1 className="text-xl font-bold text-gray-900 mb-1">{displayName}</h1>

                  {/* Level badge */}
                  {levelInfo && (
                    <div className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full mb-2">
                      <span>Lv.{profile.level}</span>
                      <span>{levelInfo.emoji}</span>
                      <span>{levelInfo.label}</span>
                    </div>
                  )}

                  {/* EXP */}
                  <p className="text-sm text-gray-500 mb-2">经验值: {profile.exp}</p>

                  {/* Bio */}
                  {profile.bio && (
                    <p className="text-sm text-gray-600 leading-relaxed mb-3">{profile.bio}</p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    <span className="font-medium text-gray-800">{profile.posts.length}</span>
                    <span>篇日志</span>
                    <span className="mx-1">·</span>
                    <span className="font-medium text-gray-800">{totalLikes}</span>
                    <span>获赞</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Achievement badges */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">成就徽章</h2>
              {profile.achievements.length === 0 ? (
                <p className="text-sm text-gray-400">暂无成就</p>
              ) : (
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                  {profile.achievements.map(item => (
                    <div
                      key={item.achievementId}
                      title={item.achievement.description ?? item.achievement.nameZh}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-default"
                    >
                      <span className="text-2xl">{item.achievement.icon}</span>
                      <span className="text-xs text-gray-600 text-center leading-tight">
                        {item.achievement.nameZh}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent posts */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">最近日志</h2>
              {profile.posts.length === 0 ? (
                <p className="text-sm text-gray-400">暂无日志</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {profile.posts.map(post => (
                    <div
                      key={post.id}
                      className="border border-gray-100 rounded-lg p-4 hover:border-gray-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-2 mb-1.5">
                        <Link
                          href={`/community/${post.id}`}
                          className="flex-1 font-medium text-gray-900 hover:text-blue-600 transition-colors leading-snug"
                        >
                          {post.title}
                        </Link>
                        {post.direction && (
                          <span className="shrink-0 text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5 mt-0.5">
                            {post.direction.icon} {post.direction.nameZh}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>👍 {post.likeCount}</span>
                        <span>💬 {post.commentCount}</span>
                        <span className="ml-auto">{timeAgo(post.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
