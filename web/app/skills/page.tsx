'use client'

import { useEffect, useState } from 'react'
import { PublicNav } from '@web/components/public-nav'

interface Skill {
  id: string
  name: string
  description: string
  emoji: string
  githubUrl: string
  updatedAt: string
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
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
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
            {loading ? '加载中...' : `共 ${filtered.length} 个技能，每日自动同步自 GitHub`}
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
                href={skill.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card p-5 transition-all hover:scale-[1.02] hover:shadow-lg"
                style={{ textDecoration: 'none' }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{skill.emoji}</span>
                  <h2 className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {skill.name}
                  </h2>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {skill.description.length > 120 ? skill.description.slice(0, 120) + '...' : skill.description}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
