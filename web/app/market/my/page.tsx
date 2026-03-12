'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'
import { useAuth } from '@web/components/auth-provider'

interface MyEntitlement {
  id: string
  status: string
  grantedAt: string
  bundle: { id: string; name: string; category: string; version: string }
  order: { priceMist: string; txDigest: string; createdAt: string }
}

function formatSUI(mist: string): string {
  const sui = Number(BigInt(mist)) / 1e9
  return sui.toFixed(2)
}

export default function MyMarketPage() {
  const { user } = useAuth()
  const [entitlements, setEntitlements] = useState<MyEntitlement[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    fetch('/api/market/my')
      .then(r => r.ok ? r.json() : { entitlements: [] })
      .then(data => setEntitlements(data.entitlements || []))
      .finally(() => setLoading(false))
  }, [user])

  async function handleDownload(bundleId: string) {
    setDownloading(bundleId)
    try {
      const res = await fetch(`/api/market/download?bundleId=${bundleId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.open(data.downloadUrl, '_blank')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-3xl mx-auto px-6 py-10 text-center">
          <p style={{ color: 'var(--text-muted)' }}>请先 <a href="/login" style={{ color: 'var(--accent-cyan)' }}>登录</a></p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6 animate-fade-up" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">我的购买</span>
        </h1>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : entitlements.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }}>暂无购买记录</p>
            <Link href="/market" className="text-sm mt-2 inline-block" style={{ color: 'var(--accent-cyan)' }}>浏览市场</Link>
          </div>
        ) : (
          <div className="space-y-4 stagger-children">
            {entitlements.map(ent => (
              <div key={ent.id} className="glass-card p-5 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {ent.bundle.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="badge badge-cyan">{ent.bundle.category}</span>
                    <span>v{ent.bundle.version}</span>
                    <span>{formatSUI(ent.order.priceMist)} SUI</span>
                    <span>{new Date(ent.grantedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(ent.bundle.id)}
                  disabled={downloading === ent.bundle.id}
                  className="glass-card px-4 py-2 text-sm transition-all"
                  style={{ color: 'var(--accent-cyan)', opacity: downloading === ent.bundle.id ? 0.5 : 1 }}
                >
                  {downloading === ent.bundle.id ? '生成链接...' : '下载'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
