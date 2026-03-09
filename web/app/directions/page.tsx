'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface Category {
  id: string
  name: string
  nameZh: string
  icon: string
  _count: { directions: number }
}

interface Direction {
  id: string
  name: string
  nameZh: string
  slug: string
  icon: string
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

export default function DirectionsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [featured, setFeatured] = useState<Direction[]>([])
  const [top, setTop] = useState<Direction[]>([])

  useEffect(() => {
    fetch('/api/categories').then(r => (r.ok ? r.json() : [])).then(setCategories)
    fetch('/api/directions?featured=true').then(r => (r.ok ? r.json() : [])).then(setFeatured)
    fetch('/api/directions?sort=userCount').then(r => (r.ok ? r.json() : [])).then((data: Direction[]) => setTop(data.slice(0, 20)))
  }, [])

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-10 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">OpenClaw 养成方向</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>探索 OpenClaw 的各种应用场景</p>
        </div>

        {/* Category cards */}
        <section className="mb-12 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>分类</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categories.map(cat => (
              <Link
                key={cat.id}
                href={`/directions/${cat.name}`}
                className="glass-card glow-cyan p-4 text-center group"
              >
                <div className="text-3xl mb-2">{cat.icon}</div>
                <div className="font-medium text-sm group-hover:text-[var(--accent-cyan)] transition-colors" style={{ color: 'var(--text-primary)' }}>{cat.nameZh}</div>
                <div className="text-xs mt-1 data-value" style={{ color: 'var(--text-muted)' }}>
                  {cat._count.directions} 个方向
                </div>
              </Link>
            ))}
            {categories.length === 0 && (
              <div className="col-span-full text-center py-8" style={{ color: 'var(--text-muted)' }}>暂无分类</div>
            )}
          </div>
        </section>

        {/* Featured directions */}
        {featured.length > 0 && (
          <section className="mb-12 animate-fade-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>推荐方向</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {featured.map(d => (
                <Link key={d.id} href={`/directions/${d.category.name}/${d.slug}`} className="glass-card glow-cyan p-5 group">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">{d.icon}</span>
                    <div>
                      <div className="font-medium group-hover:text-[var(--accent-cyan)] transition-colors" style={{ color: 'var(--text-primary)' }}>{d.nameZh}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.category.icon} {d.category.nameZh}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="data-value" style={{ color: 'var(--accent-cyan)' }}>{d.userCount}</span>
                    <span style={{ color: 'var(--text-muted)' }}>用户</span>
                    <span className="data-value" style={{ color: 'var(--accent-amber)' }}>{d.rating.toFixed(1)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>评分</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Hot ranking table */}
        {top.length > 0 && (
          <section className="animate-fade-up" style={{ animationDelay: '150ms' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>热门排行</h2>
            <div className="glass-panel overflow-hidden">
              <table className="dark-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>方向</th>
                    <th>分类</th>
                    <th style={{ textAlign: 'right' }}>用户数</th>
                    <th style={{ textAlign: 'right' }}>评分</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((d, i) => (
                    <tr key={d.id}>
                      <td className="data-value" style={{ color: i < 3 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                        {i + 1}
                      </td>
                      <td>
                        <Link
                          href={`/directions/${d.category.name}/${d.slug}`}
                          className="flex items-center gap-2 transition-colors hover:text-[var(--accent-cyan)]"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <span>{d.icon}</span>
                          <span className="font-medium">{d.nameZh}</span>
                        </Link>
                      </td>
                      <td>{d.category.icon} {d.category.nameZh}</td>
                      <td className="data-value" style={{ textAlign: 'right', color: 'var(--accent-cyan)' }}>{d.userCount}</td>
                      <td className="data-value" style={{ textAlign: 'right', color: 'var(--accent-amber)' }}>{d.rating.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
