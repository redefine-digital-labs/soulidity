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
    fetch('/api/categories')
      .then(r => (r.ok ? r.json() : []))
      .then(setCategories)
    fetch('/api/directions?featured=true')
      .then(r => (r.ok ? r.json() : []))
      .then(setFeatured)
    fetch('/api/directions?sort=userCount')
      .then(r => (r.ok ? r.json() : []))
      .then((data: Direction[]) => setTop(data.slice(0, 20)))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-1">OpenClaw 养成方向</h1>
        <p className="text-gray-500 mb-8">探索 OpenClaw 的各种应用场景</p>

        {/* Category cards */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">分类</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map(cat => (
              <Link
                key={cat.id}
                href={`/directions/${cat.name}`}
                className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow text-center"
              >
                <div className="text-3xl mb-2">{cat.icon}</div>
                <div className="font-medium text-gray-900">{cat.nameZh}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {cat._count.directions} 个方向
                </div>
              </Link>
            ))}
            {categories.length === 0 && (
              <div className="col-span-full text-center text-gray-400 py-8">
                暂无分类
              </div>
            )}
          </div>
        </section>

        {/* Featured directions */}
        {featured.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4">推荐方向</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {featured.map(d => (
                <Link
                  key={d.id}
                  href={`/directions/${d.category.name}/${d.slug}`}
                  className="bg-white rounded-lg border p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">{d.icon}</span>
                    <div>
                      <div className="font-medium text-gray-900">
                        {d.nameZh}
                      </div>
                      <div className="text-xs text-gray-400">
                        {d.category.icon} {d.category.nameZh}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span>{d.userCount} 用户</span>
                    <span>评分 {d.rating.toFixed(1)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Hot ranking table */}
        {top.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-4">热门排行</h2>
            <div className="bg-white rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-gray-500 text-left">
                    <th className="px-4 py-3 w-10">#</th>
                    <th className="px-4 py-3">方向</th>
                    <th className="px-4 py-3">分类</th>
                    <th className="px-4 py-3 text-right">用户数</th>
                    <th className="px-4 py-3 text-right">评分</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((d, i) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400 font-medium">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/directions/${d.category.name}/${d.slug}`}
                          className="flex items-center gap-2 hover:text-blue-600"
                        >
                          <span>{d.icon}</span>
                          <span className="font-medium text-gray-900">
                            {d.nameZh}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {d.category.icon} {d.category.nameZh}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {d.userCount}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {d.rating.toFixed(1)}
                      </td>
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
