'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCreateWallet } from '@privy-io/react-auth/solana'
import { PublicNav } from '@web/components/public-nav'
import { useAuth } from '@web/components/auth-provider'

export default function PublishPage() {
  const { user, getAuthHeaders } = useAuth()
  const router = useRouter()
  const { createWallet } = useCreateWallet()
  const [form, setForm] = useState({ name: '', description: '', category: '', tags: '', readme: '', priceUSDC: '' })
  const [bundlePath, setBundlePath] = useState('')
  const [contentHash, setContentHash] = useState('')
  const [previewPaths, setPreviewPaths] = useState<string[]>([])
  const [uploadingBundle, setUploadingBundle] = useState(false)
  const [uploadingPreview, setUploadingPreview] = useState(false)
  const [bundleFileName, setBundleFileName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  async function uploadFile(file: File, type: 'bundle' | 'preview') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('type', type)
    const authHeaders = await getAuthHeaders()
    const res = await fetch('/api/market/upload', { method: 'POST', body: fd, headers: authHeaders })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Upload failed')
    }
    return res.json()
  }

  async function handleBundleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingBundle(true)
    setError('')
    try {
      const result = await uploadFile(file, 'bundle')
      setBundlePath(result.storagePath)
      setContentHash(result.contentHash)
      setBundleFileName(file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingBundle(false)
    }
  }

  async function handlePreviewUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setUploadingPreview(true)
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
      setUploadingPreview(false)
    }
  }

  async function handlePublish() {
    if (!bundlePath || !contentHash) { setError('请先上传模板包'); return }
    setPublishing(true)
    setError('')
    try {
      // Ensure Privy embedded Solana wallet exists (no-op if already created)
      try { await createWallet() } catch { /* wallet already exists */ }
      const priceUsdCents = Math.round(parseFloat(form.priceUSDC) * 100)
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/market/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
          storagePath: bundlePath,
          contentHash,
          previewImages: previewPaths,
          readme: form.readme || null,
          priceUsdCents,
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

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const uploading = uploadingBundle || uploadingPreview
  const canPublish = form.name && form.description && form.category && form.priceUSDC && bundlePath && !uploading && !publishing

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6 animate-fade-up" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">发布模板</span>
        </h1>

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
            <select value={form.category} onChange={set('category')} className="input-dark w-full">
              <option value="" disabled>请选择分类</option>
              <option value="内容媒体">内容媒体</option>
              <option value="交易金融">交易金融</option>
              <option value="开发工具">开发工具</option>
              <option value="游戏娱乐">游戏娱乐</option>
              <option value="教育学习">教育学习</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>标签（逗号分隔）</label>
            <input value={form.tags} onChange={set('tags')} className="input-dark w-full" placeholder="AI, 新闻, 自动化" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>价格 (USDC) *</label>
            <input value={form.priceUSDC} onChange={set('priceUSDC')} type="number" step="0.01" min="0.01" className="input-dark w-full" placeholder="1.00" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>模板包 (.zip) *</label>
            <input id="bundle-upload" type="file" accept=".zip" onChange={handleBundleUpload} className="hidden" />
            {bundlePath ? (
              <div
                className="glass-card flex items-center justify-between px-4 py-3"
                style={{ border: '2px solid var(--accent-cyan)' }}
              >
                <div className="flex items-center gap-2">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M7 10l2.5 2.5L13 8" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="10" cy="10" r="8" stroke="var(--accent-cyan)" strokeWidth="1.5"/>
                  </svg>
                  <span className="text-sm" style={{ color: 'var(--accent-cyan)' }}>{bundleFileName}</span>
                </div>
                <label
                  htmlFor="bundle-upload"
                  className="text-xs cursor-pointer px-3 py-1 rounded"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
                >
                  重新上传
                </label>
              </div>
            ) : (
              <label
                htmlFor="bundle-upload"
                className="block cursor-pointer rounded-lg text-center py-8 transition-colors"
                style={{
                  border: '2px dashed var(--border-default)',
                  background: 'var(--bg-elevated)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-bright)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              >
                {uploadingBundle ? (
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>上传中...</span>
                ) : (
                  <>
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="mx-auto mb-2">
                      <path d="M18 24V10m0 0l-5 5m5-5l5 5" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M8 18c0-2 0-4 1-5.5S12 10 14 10c.5-2.5 2-4.5 4-5s4 .5 5.5 2c1-.5 2.5-.5 3.5 0s2 2 2 3.5c1.5 1 2.5 2.5 2 4.5s-2 3-3.5 3" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>点击上传 .zip 文件</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>最大 50MB</p>
                  </>
                )}
              </label>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>预览图</label>
            <input id="preview-upload" type="file" accept="image/*" multiple onChange={handlePreviewUpload} className="hidden" />
            {previewPaths.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {previewPaths.map((path, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={path}
                      alt={`预览图 ${i + 1}`}
                      className="w-full object-cover rounded"
                      style={{ height: 80, borderRadius: 'var(--radius-sm, 6px)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setPreviewPaths(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label
              htmlFor="preview-upload"
              className="block cursor-pointer rounded-lg text-center py-6 transition-colors"
              style={{
                border: '2px dashed var(--border-default)',
                background: 'var(--bg-elevated)',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-bright)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
            >
              {uploadingPreview ? (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>上传中...</span>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="mx-auto mb-1">
                    <rect x="4" y="4" width="20" height="20" rx="3" stroke="var(--text-muted)" strokeWidth="1.5"/>
                    <circle cx="10" cy="11" r="2" stroke="var(--text-muted)" strokeWidth="1.5"/>
                    <path d="M4 19l5-5 3 3 4-4 8 8" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {previewPaths.length > 0 ? '继续添加预览图' : '点击上传预览图'}
                  </p>
                </>
              )}
            </label>
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
