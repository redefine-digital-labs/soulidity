'use client'

import { useEffect, useState } from 'react'
import { PublicNav } from '@web/components/public-nav'

interface Skill {
  id: string
  slug: string
  displayName: string
  summary: string
  version: string
  downloads: number
  stars: number
  versions: number
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/skills')
      .then(r => (r.ok ? r.json() : []))
      .then(setSkills)
      .finally(() => setLoading(false))
  }, [])

  const filtered = search
    ? skills.filter(s =>
        s.displayName.toLowerCase().includes(search.toLowerCase()) ||
        s.slug.toLowerCase().includes(search.toLowerCase()) ||
        s.summary.toLowerCase().includes(search.toLowerCase())
      )
    : skills

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">OpenClaw 技能</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {loading ? '加载中...' : `共 ${filtered.length.toLocaleString()} 个技能，每日自动同步`}
          </p>
        </div>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索技能名称或描述..."
            className="input-dark"
            style={{ maxWidth: '20rem' }}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>暂无匹配技能</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {filtered.map(skill => (
              <a
                key={skill.id}
                href={`https://clawhub.ai/skills/${skill.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card p-5 transition-all hover:scale-[1.02] hover:shadow-lg"
                style={{ textDecoration: 'none' }}
              >
                <h2 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {skill.displayName}
                </h2>
                <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
                  {skill.summary.length > 100 ? skill.summary.slice(0, 100) + '...' : skill.summary}
                </p>
                <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span title="下载量">↓ {formatNum(skill.downloads)}</span>
                  <span title="星标">★ {formatNum(skill.stars)}</span>
                  <span className="ml-auto badge badge-cyan">{skill.version}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
