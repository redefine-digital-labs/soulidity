'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'
import { isInviteCode } from '@shared/invite-code-format'

function RegisterForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const code = (searchParams.get('code') ?? '').toUpperCase().trim()
  const { ready, authenticated, login, getAccessToken, user: privyUser } = usePrivy()
  const { user, refresh, logout, loading: authLoading } = useAuth()

  const [email, setEmail] = useState('')
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  const authenticatedEmail = privyUser?.email?.address ?? ''
  const hasCode = code.length > 0
  const codeValid = hasCode && isInviteCode(code)
  const codeError = !hasCode
    ? '缺少邀请码，请从 Telegram 机器人获取'
    : !codeValid
      ? '邀请码格式无效，请重新从 Telegram 机器人获取'
      : ''

  // Redirect if already logged in
  useEffect(() => {
    if (user) router.push('/community')
  }, [user, router])

  const completeRegistration = useCallback(async () => {
    if (!authenticated || registering) return
    setRegistering(true)
    setError('')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('无法获取认证令牌')

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (res.ok) {
        await refresh()
        router.push('/community')
      } else {
        setError(data.error ?? '注册失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setRegistering(false)
    }
  }, [authenticated, getAccessToken, code, refresh, router, registering])

  function handleLogin() {
    if (!email.trim()) return
    login({ loginMethods: ['email'], prefill: { type: 'email', value: email.trim() } })
  }

  async function handleLogoutToLogin() {
    await logout()
    router.push('/login')
  }

  if (!ready) {
    return <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  if (authenticated && authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-panel p-8 max-w-md w-full text-center animate-fade-up">
          <p style={{ color: 'var(--text-muted)' }}>正在检查账号状态...</p>
        </div>
      </div>
    )
  }

  // Already authenticated and still on a valid registration path — complete registration
  if (authenticated && !user && codeValid !== false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-panel p-8 max-w-md w-full text-center animate-fade-up">
          <p className="mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            确认后将使用当前登录邮箱完成邀请码绑定。
          </p>
          {authenticatedEmail ? (
            <p className="mb-4 text-sm" style={{ color: 'var(--text-primary)' }}>
              当前邮箱：{authenticatedEmail}
            </p>
          ) : null}
          {registering ? (
            <p style={{ color: 'var(--text-muted)' }}>正在完成注册...</p>
          ) : error ? (
            <>
              <p className="mb-4" style={{ color: 'var(--accent-rose)' }}>{error}</p>
              <div className="flex flex-col gap-3">
                {error === '该邮箱已注册' ? (
                  <button onClick={() => void handleLogoutToLogin()} className="btn btn-primary">
                    退出并去登录
                  </button>
                ) : (
                  <button onClick={() => void completeRegistration()} className="btn btn-primary">
                    重试
                  </button>
                )}
                <button onClick={() => void logout()} className="btn">
                  退出并更换邮箱
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <button onClick={() => void completeRegistration()} className="btn btn-primary">
                完成注册
              </button>
              <button onClick={() => void logout()} className="btn">
                退出并更换邮箱
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
      </div>
      <div className="glass-panel p-8 max-w-md w-full animate-fade-up relative">
        <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">注册 OpenClaw</span>
        </h1>

        {codeValid === false && (
          <div className="mt-4">
            <p className="mb-4" style={{ color: 'var(--accent-rose)' }}>{codeError}</p>
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>如何获取邀请码：</p>
              <ol className="text-sm space-y-1" style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
                <li>1. 关注 <a href="https://t.me/CryptoOpenclaw" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)' }}>t.me/CryptoOpenclaw</a> 频道</li>
                <li>2. 点击频道消息下方的按钮添加机器人</li>
                <li>3. 按照机器人指示完成验证</li>
              </ol>
            </div>
            <Link href="/login" className="block text-center text-sm mt-4" style={{ color: 'var(--accent-cyan)' }}>
              已有账号？去登录
            </Link>
          </div>
        )}

        {/* Email input */}
        {codeValid === true && !authenticated && (
          <div className="mt-4">
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>请输入邮箱继续注册，系统会在验证后绑定邀请码</p>
            <input
              type="email"
              className="input-dark mb-3"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
            />

            <button onClick={handleLogin} disabled={!email.trim()} className="btn btn-primary w-full">
              发送验证码
            </button>

            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              使用邀请码绑定邮箱。若该邮箱已注册，验证后会直接登录或提示你返回登录页。
            </p>

            {error && <p className="text-sm mt-3" style={{ color: 'var(--accent-rose)' }}>{error}</p>}

            <Link href="/login" className="block text-center text-sm mt-4" style={{ color: 'var(--accent-cyan)' }}>
              已有账号？去登录
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div style={{ color: 'var(--text-muted)' }}>加载中...</div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  )
}
