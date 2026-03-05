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
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Directions Admin</h1>

      {/* Add Category */}
      <section className="mb-8 p-4 border rounded">
        <h2 className="text-lg font-semibold mb-4">Add Category</h2>
        <form onSubmit={createCategory} className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col text-sm">
            Name
            <input value={catName} onChange={e => setCatName(e.target.value)} required
              className="mt-1 border rounded px-2 py-1 w-40" />
          </label>
          <label className="flex flex-col text-sm">
            Name (ZH)
            <input value={catNameZh} onChange={e => setCatNameZh(e.target.value)} required
              className="mt-1 border rounded px-2 py-1 w-40" />
          </label>
          <label className="flex flex-col text-sm">
            Icon
            <input value={catIcon} onChange={e => setCatIcon(e.target.value)}
              className="mt-1 border rounded px-2 py-1 w-16" />
          </label>
          <button type="submit" className="px-4 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-700">
            Add
          </button>
        </form>
        {categories.length > 0 && (
          <div className="mt-3 text-sm text-gray-500">
            Existing: {categories.map(c => `${c.icon} ${c.nameZh} (${c.name})`).join(', ')}
          </div>
        )}
      </section>

      {/* Add Direction */}
      <section className="mb-8 p-4 border rounded">
        <h2 className="text-lg font-semibold mb-4">Add Direction</h2>
        <form onSubmit={createDirection} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col text-sm">
              Category
              <select value={dirCategoryId} onChange={e => setDirCategoryId(e.target.value)} required
                className="mt-1 border rounded px-2 py-1 w-48">
                <option value="">Select...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.nameZh}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              Name
              <input value={dirName} onChange={e => setDirName(e.target.value)} required
                className="mt-1 border rounded px-2 py-1 w-40" />
            </label>
            <label className="flex flex-col text-sm">
              Name (ZH)
              <input value={dirNameZh} onChange={e => setDirNameZh(e.target.value)} required
                className="mt-1 border rounded px-2 py-1 w-40" />
            </label>
            <label className="flex flex-col text-sm">
              Icon
              <input value={dirIcon} onChange={e => setDirIcon(e.target.value)}
                className="mt-1 border rounded px-2 py-1 w-16" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col text-sm">
              Description (ZH)
              <input value={dirDescZh} onChange={e => setDirDescZh(e.target.value)}
                className="mt-1 border rounded px-2 py-1 w-64" />
            </label>
            <label className="flex flex-col text-sm">
              User Count
              <input type="number" value={dirUserCount} onChange={e => setDirUserCount(Number(e.target.value))}
                className="mt-1 border rounded px-2 py-1 w-24" />
            </label>
            <label className="flex flex-col text-sm">
              Rating
              <input type="number" step="0.1" value={dirRating} onChange={e => setDirRating(Number(e.target.value))}
                className="mt-1 border rounded px-2 py-1 w-24" />
            </label>
            <label className="flex items-center gap-2 text-sm pt-5">
              <input type="checkbox" checked={dirFeatured} onChange={e => setDirFeatured(e.target.checked)} />
              Featured
            </label>
            <button type="submit" className="px-4 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-700">
              Add
            </button>
          </div>
        </form>
      </section>

      {/* Directions Table */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Directions ({directions.length})</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="p-2">Name (ZH)</th>
              <th className="p-2">Category</th>
              <th className="p-2">Users</th>
              <th className="p-2">Rating</th>
              <th className="p-2">Featured</th>
              <th className="p-2">Slug</th>
            </tr>
          </thead>
          <tbody>
            {directions.map(d => (
              <tr key={d.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{d.icon} {d.nameZh}</td>
                <td className="p-2 text-sm text-gray-500">{d.category.nameZh}</td>
                <td className="p-2 text-sm">{d.userCount.toLocaleString()}</td>
                <td className="p-2 text-sm">{d.rating.toFixed(1)}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${d.featured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.featured ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="p-2 font-mono text-sm text-gray-500">{d.slug}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {directions.length === 0 && <div className="text-center text-gray-400 py-8">No directions yet</div>}
      </section>
    </div>
  )
}
