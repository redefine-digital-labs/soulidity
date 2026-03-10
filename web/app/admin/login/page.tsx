'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message) } else { router.push('/admin'); router.refresh() }
    } catch { setError('网络错误，请重试') } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
      </div>

      <form onSubmit={handleSubmit} className="glass-panel p-8 w-full max-w-sm animate-fade-up relative">
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">CryptoOpenClaw</span>
        </h1>
        <p className="text-center text-sm mb-8" style={{ color: 'var(--text-muted)' }}>管理员登录</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-dark" placeholder="you@example.com" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-dark" placeholder="••••••••" />
          </div>
        </div>

        {error && <p className="text-sm mt-4" style={{ color: 'var(--accent-rose)' }}>{error}</p>}

        <button type="submit" disabled={loading || !email || !password} className="btn btn-primary w-full mt-6">
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
