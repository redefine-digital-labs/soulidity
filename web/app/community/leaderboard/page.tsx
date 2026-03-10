'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface RankedMember {
  rank: number
  id: string
  tgName: string | null
  avatar: string | null
  level: number
  score: number
  postCount?: number
  commentCount?: number
  acceptedCount?: number
}

function levelBadge(level: number): string {
  return ['🥚', '🦐', '🦞', '🦞🦞', '🦞🦞🦞'][level - 1] ?? '🥚'
}

type Dimension = 'active' | 'helpful'

export default function LeaderboardPage() {
  const [dimension, setDimension] = useState<Dimension>('active')
  const [members, setMembers] = useState<RankedMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/community/leaderboard?dimension=${dimension}`)
      .then(r => (r.ok ? r.json() : []))
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [dimension])

  const dims: { key: Dimension; label: string }[] = [
    { key: 'active', label: '🔥 活跃度' },
    { key: 'helpful', label: '🤝 贡献度' },
  ]

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 animate-fade-up">
          <div>
            <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="text-gradient">🏆 排行榜</span>
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>社区活跃成员排名</p>
          </div>
          <Link href="/community" className="text-sm transition-colors" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link>
        </div>

        <div className="flex gap-2 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          {dims.map(d => (
            <button key={d.key} onClick={() => setDimension(d.key)}
              className={`filter-pill ${dimension === d.key ? 'filter-pill-active' : ''}`}>
              {d.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>暂无数据</div>
        ) : (
          <div className="flex flex-col gap-2 stagger-children">
            {members.map(m => {
              const displayName = m.tgName ?? '匿名'
              const avatarChar = displayName.charAt(0).toUpperCase()
              const medal = m.rank <= 3 ? ['🥇', '🥈', '🥉'][m.rank - 1] : `#${m.rank}`

              return (
                <div key={m.id} className="glass-card p-4 flex items-center gap-4">
                  <span className="text-lg font-bold w-10 text-center" style={{ fontFamily: 'var(--font-mono)', color: m.rank <= 3 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                    {medal}
                  </span>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    {avatarChar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/u/${m.id}`} className="font-semibold text-sm transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)' }}>
                      {displayName}
                    </Link>
                    <span className="ml-2 text-xs">{levelBadge(m.level)}</span>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {dimension === 'active' && `${m.postCount ?? 0} 帖子 · ${m.commentCount ?? 0} 评论`}
                      {dimension === 'helpful' && `${m.acceptedCount ?? 0} 个回答被采纳`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>{m.score}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>积分</div>
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
