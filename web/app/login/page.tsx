'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@web/components/auth-provider'

function TelegramLoginButton() {
  const containerRef = useRef<HTMLDivElement>(null)
  const completingRef = useRef(false)
  const router = useRouter()
  const { refresh } = useAuth()
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  const [showFallback, setShowFallback] = useState(false)
  const [fallbackLoading, setFallbackLoading] = useState(false)
  const [widgetLoaded, setWidgetLoaded] = useState(false)
  const [challenge, setChallenge] = useState<{ telegramUrl: string; token: string } | null>(null)

  const handleTelegramAuth = useCallback(async (tgUser: Record<string, unknown>) => {
    setError('')
    setLogging(true)
    try {
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tgUser),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '登录失败')
        return
      }
      await refresh()
      router.push('/community')
      router.refresh()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLogging(false)
    }
  }, [refresh, router])

  useEffect(() => {
    const botUsername = process.env.NEXT_PUBLIC_TG_BOT_USERNAME
    if (!botUsername || !containerRef.current) return

    ;(window as unknown as Record<string, unknown>).__tg_login_callback = handleTelegramAuth

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-onauth', '__tg_login_callback(user)')
    script.setAttribute('data-request-access', 'write')
    containerRef.current.appendChild(script)

    const syncWidgetState = () => {
      const loaded = Boolean(containerRef.current?.querySelector('iframe'))
      if (loaded) {
        setWidgetLoaded(true)
        setShowFallback(false)
      }
      return loaded
    }

    const interval = window.setInterval(() => {
      if (syncWidgetState()) {
        window.clearInterval(interval)
      }
    }, 250)

    const timer = window.setTimeout(() => {
      if (!syncWidgetState()) {
        setShowFallback(true)
      }
    }, 2500)

    script.onerror = () => setShowFallback(true)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timer)
      delete (window as unknown as Record<string, unknown>).__tg_login_callback
    }
  }, [handleTelegramAuth])

  const completeChallengeLogin = useCallback(async (token: string) => {
    if (completingRef.current) return

    completingRef.current = true
    setFallbackLoading(true)

    try {
      const res = await fetch('/api/auth/telegram/challenge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '登录失败')
        setChallenge(null)
        return
      }

      await refresh()
      router.push('/community')
      router.refresh()
    } catch {
      setError('网络错误，请重试')
      setChallenge(null)
    } finally {
      completingRef.current = false
      setFallbackLoading(false)
    }
  }, [refresh, router])

  useEffect(() => {
    if (!challenge) return

    let stopped = false

    const poll = async () => {
      if (stopped || completingRef.current) return

      try {
        const res = await fetch(`/api/auth/telegram/challenge?token=${encodeURIComponent(challenge.token)}`, {
          cache: 'no-store',
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || '登录状态检查失败')
          setChallenge(null)
          return
        }

        if (data.status === 'verified') {
          await completeChallengeLogin(challenge.token)
          return
        }

        if (data.status === 'expired') {
          setError('登录请求已过期，请重新发起')
          setChallenge(null)
        }
      } catch {
        setError('网络错误，请重试')
        setChallenge(null)
      }
    }

    void poll()
    const interval = window.setInterval(() => { void poll() }, 2000)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [challenge, completeChallengeLogin])

  const startFallbackLogin = useCallback(async () => {
    const popup = window.open('about:blank', '_blank')

    setError('')
    setFallbackLoading(true)

    try {
      const res = await fetch('/api/auth/telegram/challenge', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        popup?.close()
        setError(data.error || '无法创建登录请求')
        return
      }

      setChallenge({
        telegramUrl: data.telegramUrl,
        token: data.token,
      })
      popup?.location.assign(data.telegramUrl)
    } catch {
      popup?.close()
      setError('网络错误，请重试')
    } finally {
      setFallbackLoading(false)
    }
  }, [])

  return (
    <div>
      <div
        ref={containerRef}
        className="flex justify-center min-h-[40px]"
        style={{ display: widgetLoaded || !showFallback ? undefined : 'none' }}
      />

      {showFallback && !widgetLoaded && (
        <div className="space-y-3">
          <button
            onClick={startFallbackLogin}
            disabled={fallbackLoading || Boolean(challenge)}
            className="btn btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            {challenge ? '等待 Telegram 确认...' : fallbackLoading ? '创建登录请求...' : '在 Telegram 中继续登录'}
          </button>

          {challenge && (
            <div className="rounded-lg p-4 text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              <p>已打开 Telegram，请在机器人中确认登录。</p>
              <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
                如果没有自动打开，请
                {' '}
                <a href={challenge.telegramUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)' }}>
                  点这里继续
                </a>
                。
              </p>
            </div>
          )}
        </div>
      )}

      {(logging || fallbackLoading) && <p className="text-sm text-center mt-2" style={{ color: 'var(--text-muted)' }}>登录中...</p>}
      {error && <p className="text-sm text-center mt-2" style={{ color: 'var(--accent-rose)' }}>{error}</p>}
    </div>
  )
}

export default function LoginPage() {
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

        <TelegramLoginButton />
      </div>
    </div>
  )
}
