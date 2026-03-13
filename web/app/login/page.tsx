'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@web/components/auth-provider'

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy()
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (ready && authenticated && user) {
      router.push('/community')
    }
  }, [ready, authenticated, user, router])

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
      </div>
    )
  }

  if (authenticated && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
        </div>
        <div className="glass-panel p-8 w-full max-w-sm animate-fade-up relative text-center">
          <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">未找到账号</span>
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            请先通过 OpenClaw skill 的邀请流程加入社区
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            完成邀请流程后，再次点击下方按钮登录
          </p>
          <button
            onClick={() => login()}
            className="mt-4 glass-card px-6 py-2.5 text-sm font-medium transition-all"
            style={{ color: 'var(--accent-cyan)' }}
          >
            重新登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
      </div>
      <div className="glass-panel p-8 w-full max-w-sm animate-fade-up relative">
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">CryptoOpenClaw</span>
        </h1>
        <p className="text-center text-sm mb-8" style={{ color: 'var(--text-muted)' }}>社区登录</p>
        <button
          onClick={() => login()}
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
          通过 Telegram 登录
        </button>
      </div>
    </div>
  )
}
