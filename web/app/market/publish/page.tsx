'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { WalletConnect } from '@web/components/market/wallet-connect'
import { useAuth } from '@web/components/auth-provider'

export default function PublishPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({ name: '', description: '', category: '', tags: '', readme: '', priceSUI: '' })
  const [bundlePath, setBundlePath] = useState('')
  const [contentHash, setContentHash] = useState('')
  const [previewPaths, setPreviewPaths] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  async function uploadFile(file: File, type: 'bundle' | 'preview') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('type', type)
    const res = await fetch('/api/market/upload', { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Upload failed')
    }
    return res.json()
  }

  async function handleBundleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadFile(file, 'bundle')
      setBundlePath(result.storagePath)
      setContentHash(result.contentHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handlePreviewUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setUploading(true)
    setError('')
    try {
      const paths: string[] = []
      for (const file of Array.from(files)) {
        const result = await uploadFile(file, 'preview')
        paths.push(result.storagePath)
      }
      setPreviewPaths(prev => [...prev, ...paths])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handlePublish() {
    if (!bundlePath || !contentHash) { setError('请先上传模板包'); return }
    setPublishing(true)
    setError('')
    try {
      const priceMist = String(BigInt(Math.round(parseFloat(form.priceSUI) * 1e9)))
      const res = await fetch('/api/market/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
          storagePath: bundlePath,
          contentHash,
          previewImages: previewPaths,
          readme: form.readme || null,
          priceMist,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      router.push(`/market/${data.listing.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-2xl mx-auto px-6 py-10 text-center">
          <p style={{ color: 'var(--text-muted)' }}>请先 <a href="/login" style={{ color: 'var(--accent-cyan)' }}>登录</a></p>
        </div>
      </div>
    )
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const canPublish = form.name && form.description && form.category && form.priceSUI && bundlePath && !uploading && !publishing

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6 animate-fade-up" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">发布模板</span>
        </h1>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <WalletConnect />
        </div>

        <div className="space-y-4 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>名称 *</label>
            <input value={form.name} onChange={set('name')} className="input-dark w-full" placeholder="模板名称" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>描述 *</label>
            <textarea value={form.description} onChange={set('description')} className="input-dark w-full" rows={3} placeholder="简短描述" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>分类 *</label>
            <input value={form.category} onChange={set('category')} className="input-dark w-full" placeholder="如: 内容媒体, 交易金融, 开发工具" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>标签（逗号分隔）</label>
            <input value={form.tags} onChange={set('tags')} className="input-dark w-full" placeholder="AI, 新闻, 自动化" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>价格 (SUI) *</label>
            <input value={form.priceSUI} onChange={set('priceSUI')} type="number" step="0.01" min="0.01" className="input-dark w-full" placeholder="1.00" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>模板包 (.zip) *</label>
            <input type="file" accept=".zip" onChange={handleBundleUpload} className="text-sm" style={{ color: 'var(--text-muted)' }} />
            {bundlePath && <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>已上传</p>}
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>预览图</label>
            <input type="file" accept="image/*" multiple onChange={handlePreviewUpload} className="text-sm" style={{ color: 'var(--text-muted)' }} />
            {previewPaths.length > 0 && <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>已上传 {previewPaths.length} 张</p>}
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>详细说明</label>
            <textarea value={form.readme} onChange={set('readme')} className="input-dark w-full" rows={6} placeholder="详细的使用说明（支持纯文本）" />
          </div>

          {error && <p className="text-sm" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</p>}

          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all disabled:opacity-30"
            style={{ color: 'var(--accent-cyan)' }}
          >
            {uploading ? '上传中...' : publishing ? '发布中...' : '发布模板'}
          </button>
        </div>
      </div>
    </div>
  )
}
