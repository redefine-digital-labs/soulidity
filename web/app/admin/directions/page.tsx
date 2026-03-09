'use client'
import { useEffect, useState } from 'react'

interface Category {
  id: string
  name: string
  nameZh: string
  icon: string
  sortOrder: number
}

interface Direction {
  id: string
  categoryId: string
  name: string
  nameZh: string
  slug: string
  description: string | null
  descriptionZh: string | null
  icon: string
  userCount: number
  rating: number
  featured: boolean
  status: string
  category: { name: string; nameZh: string }
}

export default function DirectionsAdminPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [directions, setDirections] = useState<Direction[]>([])

  // Category form
  const [catName, setCatName] = useState('')
  const [catNameZh, setCatNameZh] = useState('')
  const [catIcon, setCatIcon] = useState('📦')

  // Direction form
  const [dirCategoryId, setDirCategoryId] = useState('')
  const [dirName, setDirName] = useState('')
  const [dirNameZh, setDirNameZh] = useState('')
  const [dirDescZh, setDirDescZh] = useState('')
  const [dirIcon, setDirIcon] = useState('🔧')
  const [dirUserCount, setDirUserCount] = useState(0)
  const [dirRating, setDirRating] = useState(0)
  const [dirFeatured, setDirFeatured] = useState(false)

  useEffect(() => {
    loadCategories()
    loadDirections()
  }, [])

  function loadCategories() {
    fetch('/api/admin/categories').then(r => r.json()).then(setCategories)
  }

  function loadDirections() {
    fetch('/api/admin/directions').then(r => r.json()).then(setDirections)
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: catName, nameZh: catNameZh, icon: catIcon }),
    })
    setCatName('')
    setCatNameZh('')
    setCatIcon('📦')
    loadCategories()
  }

  async function createDirection(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/admin/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoryId: dirCategoryId,
        name: dirName,
        nameZh: dirNameZh,
        descriptionZh: dirDescZh || null,
        icon: dirIcon,
        userCount: dirUserCount,
        rating: dirRating,
        featured: dirFeatured,
      }),
    })
    setDirName('')
    setDirNameZh('')
    setDirDescZh('')
    setDirIcon('🔧')
    setDirUserCount(0)
    setDirRating(0)
    setDirFeatured(false)
    loadDirections()
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">Directions Admin</span>
        </h1>
      </div>

      {/* Add Category */}
      <section className="glass-panel p-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Add Category
        </h2>
        <form onSubmit={createCategory} className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
            Name
            <input value={catName} onChange={e => setCatName(e.target.value)} required
              className="input-dark mt-1" style={{ width: '10rem' }} />
          </label>
          <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
            Name (ZH)
            <input value={catNameZh} onChange={e => setCatNameZh(e.target.value)} required
              className="input-dark mt-1" style={{ width: '10rem' }} />
          </label>
          <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
            Icon
            <input value={catIcon} onChange={e => setCatIcon(e.target.value)}
              className="input-dark mt-1" style={{ width: '4rem' }} />
          </label>
          <button type="submit" className="btn btn-primary">
            Add
          </button>
        </form>
        {categories.length > 0 && (
          <div className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            Existing: {categories.map(c => `${c.icon} ${c.nameZh} (${c.name})`).join(', ')}
          </div>
        )}
      </section>

      {/* Add Direction */}
      <section className="glass-panel p-6 mb-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Add Direction
        </h2>
        <form onSubmit={createDirection} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Category
              <select value={dirCategoryId} onChange={e => setDirCategoryId(e.target.value)} required
                className="input-dark mt-1" style={{ width: '12rem' }}>
                <option value="">Select...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.nameZh}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Name
              <input value={dirName} onChange={e => setDirName(e.target.value)} required
                className="input-dark mt-1" style={{ width: '10rem' }} />
            </label>
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Name (ZH)
              <input value={dirNameZh} onChange={e => setDirNameZh(e.target.value)} required
                className="input-dark mt-1" style={{ width: '10rem' }} />
            </label>
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Icon
              <input value={dirIcon} onChange={e => setDirIcon(e.target.value)}
                className="input-dark mt-1" style={{ width: '4rem' }} />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Description (ZH)
              <input value={dirDescZh} onChange={e => setDirDescZh(e.target.value)}
                className="input-dark mt-1" style={{ width: '16rem' }} />
            </label>
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              User Count
              <input type="number" value={dirUserCount} onChange={e => setDirUserCount(Number(e.target.value))}
                className="input-dark mt-1" style={{ width: '6rem' }} />
            </label>
            <label className="flex flex-col text-sm" style={{ color: 'var(--text-secondary)' }}>
              Rating
              <input type="number" step="0.1" value={dirRating} onChange={e => setDirRating(Number(e.target.value))}
                className="input-dark mt-1" style={{ width: '6rem' }} />
            </label>
            <label className="flex items-center gap-2 text-sm pt-5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={dirFeatured} onChange={e => setDirFeatured(e.target.checked)}
                className="accent-[var(--accent-cyan)]" />
              Featured
            </label>
            <button type="submit" className="btn btn-primary">
              Add
            </button>
          </div>
        </form>
      </section>

      {/* Directions Table */}
      <section className="animate-fade-up" style={{ animationDelay: '150ms' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Directions <span style={{ color: 'var(--text-muted)' }}>({directions.length})</span>
        </h2>
        <div className="glass-panel overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Name (ZH)</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Users</th>
                <th style={{ textAlign: 'right' }}>Rating</th>
                <th>Featured</th>
                <th>Slug</th>
              </tr>
            </thead>
            <tbody>
              {directions.map(d => (
                <tr key={d.id}>
                  <td style={{ color: 'var(--text-primary)' }}>{d.icon} {d.nameZh}</td>
                  <td>{d.category.nameZh}</td>
                  <td className="data-value" style={{ textAlign: 'right', color: 'var(--accent-cyan)' }}>{d.userCount.toLocaleString()}</td>
                  <td className="data-value" style={{ textAlign: 'right', color: 'var(--accent-amber)' }}>{d.rating.toFixed(1)}</td>
                  <td>
                    <span className={`badge ${d.featured ? 'badge-emerald' : 'badge-muted'}`}>
                      {d.featured ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="data-value" style={{ color: 'var(--text-muted)' }}>{d.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {directions.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>No directions yet</div>
          )}
        </div>
      </section>
    </div>
  )
}
