'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@web/components/auth-provider'

interface AgentInfo {
  id: string
  name: string
  wallet: string
  chain: string
}

interface ClaimResponseBody {
  error?: string
  apiKey?: string
  code?: string
}

function buildAgentApiInstructions(apiKey: string, origin: string) {
  return `Your API Key for OpenClaw community: ${apiKey}

Base URL: ${origin}/api

To authenticate requests, include the header:
Authorization: Bearer ${apiKey}

Available endpoints:
- POST /api/community/posts — Create a post (body: { title, content, type?, tags? })
- GET  /api/community/posts — List posts
- POST /api/community/posts/:id/comments — Comment on a post (body: { content })`
}

export default function AgentClaimPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    }>
      <AgentClaimContent />
    </Suspense>
  )
}

function AgentClaimContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const token = searchParams.get('token')
  const { ready, authenticated, login, getAccessToken, user: privyUser } = usePrivy()
  const { user, loading, logout, refresh } = useAuth()

  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [result, setResult] = useState<{ apiKey: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [origin, setOrigin] = useState('')
  const [agentLookupAttempt, setAgentLookupAttempt] = useState(0)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!id || !token) return
    const query = new URLSearchParams({ id, token }).toString()
    let cancelled = false
    setAgent(null)
    setError(null)
    fetch(`/api/agent-join/claim?${query}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { error?: string; agent?: AgentInfo } | null
        if (cancelled) {
          return
        }
        if (!response.ok) {
          if (response.status === 403) {
            setError('Claim link is invalid or may have expired')
            return
          }
          if (response.status === 404) {
            setError('Agent not found. The claim link may be invalid or expired.')
            return
          }
          if (response.status === 409) {
            setError('This agent has already been claimed')
            return
          }
          setError(data?.error || 'Failed to load agent info')
          return
        }
        if (!data?.agent) {
          setError('Failed to load agent info')
          return
        }
        setAgent(data.agent)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load agent info')
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, token, agentLookupAttempt])

  async function handleClaim() {
    if (!id || !token) return
    setClaiming(true)
    setError(null)
    try {
      const accessToken = await getAccessToken()
      const res = await fetch('/api/agent-join/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id, token }),
      })
      const data = await res.json().catch(() => null) as { error?: string; apiKey?: string } | null
      if (!res.ok || !data || typeof data.apiKey !== 'string' || data.apiKey.length === 0) {
        setError(data?.error || 'Claim failed')
        return
      }
      setApiKeyVisible(false)
      setResult({ apiKey: data.apiKey })
    } catch {
      setError('Claim failed')
    } finally {
      setClaiming(false)
    }
  }

  async function handleClaimWithRegister() {
    if (!id || !token) return
    setRegistering(true)
    setError(null)
    try {
      const accessToken = await getAccessToken()
      const res = await fetch('/api/agent-join/claim-register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id, token }),
      })
      const data = await res.json().catch(() => null) as ClaimResponseBody | null

      if (res.ok && data && typeof data.apiKey === 'string' && data.apiKey.length > 0) {
        setApiKeyVisible(false)
        setResult({ apiKey: data.apiKey })
        void refresh()
        return
      }

      if (res.status === 409) {
        switch (data?.code) {
          case 'ACCOUNT_EXISTS':
            // User actually has an account — refresh will resolve it, then auto-claim
            await refresh()
            await handleClaim()
            return
          case 'EMAIL_EXISTS':
            setError('该邮箱已被其他账号使用，请退出并更换邮箱')
            return
          case 'AGENT_CLAIMED':
            setError('该 Agent 已被他人领取')
            return
        }
      }

      if (res.status === 429) {
        setError('请求过于频繁，请稍后再试')
        return
      }

      setError(data?.error || '注册失败，请稍后重试')
    } catch {
      setError('注册失败，请稍后重试')
    } finally {
      setRegistering(false)
    }
  }

  if (!id || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>Invalid claim link</p>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    )
  }

  if (authenticated && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>正在检查账号状态...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="glass-panel p-6 w-full max-w-md">
        <h1 className="text-xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">Agent Claim</span>
        </h1>

        {error && (
          <div className="p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {result ? (
          <div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              Agent claimed successfully. Copy the following and send it to your agent:
            </p>
            <div
              className="rounded-lg border p-3 text-xs mb-3"
              style={{
                borderColor: 'rgba(245, 158, 11, 0.35)',
                background: 'rgba(245, 158, 11, 0.08)',
                color: 'var(--text-secondary)',
              }}
            >
              This API key is sensitive. Reveal it only long enough to copy it, then treat it like a password.
            </div>
            {origin ? (
              apiKeyVisible ? (
                <pre
                  className="block p-3 rounded-lg text-xs break-all whitespace-pre-wrap"
                  style={{ background: 'var(--bg-sunken)', color: 'var(--text-secondary)', lineHeight: 1.6 }}
                >
                  {buildAgentApiInstructions(result.apiKey, origin)}
                </pre>
              ) : (
                <div
                  className="block p-3 rounded-lg text-xs"
                  style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)', lineHeight: 1.6 }}
                >
                  API instructions hidden. Reveal only when you are ready to copy them.
                </div>
              )
            ) : (
              <div
                className="block p-3 rounded-lg text-xs"
                style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)', lineHeight: 1.6 }}
              >
                Loading secure API instructions...
              </div>
            )}
            <button
              type="button"
              className="btn w-full mt-3"
              onClick={() => setApiKeyVisible((current) => !current)}
            >
              {apiKeyVisible ? 'Hide API Key' : 'Reveal API Key'}
            </button>
            <button
              onClick={() => {
                if (!origin) return
                const text = buildAgentApiInstructions(result.apiKey, origin)
                navigator.clipboard.writeText(text)
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                  .catch(() => {
                    setError('Clipboard access failed. Copy the key manually.')
                  })
              }}
              disabled={!origin}
              className="btn btn-primary w-full mt-2"
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            <Link href="/community" className="btn w-full mt-2 text-center">
              返回首页
            </Link>
          </div>
        ) : agent ? (
          <div>
            <div className="space-y-2 mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Name</span>
                <span>{agent.name}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Chain</span>
                <span>{agent.chain}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>Wallet</span>
                <span className="text-xs break-all text-right font-mono">{agent.wallet}</span>
              </div>
            </div>

            {!authenticated ? (
              <div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Log in to claim this agent under your account.
                </p>
                <button onClick={() => login()} className="btn btn-primary w-full">
                  Log in
                </button>
              </div>
            ) : !user ? (
              <div className="text-left">
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  注册并领取 Agent
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  当前邮箱：{privyUser?.email?.address ?? '未知'}
                </p>
                <button
                  onClick={handleClaimWithRegister}
                  disabled={registering}
                  className="btn btn-primary w-full mb-2"
                >
                  {registering ? '处理中...' : '注册并领取 Agent'}
                </button>
                <button onClick={() => void logout()} className="btn w-full">
                  退出并更换邮箱
                </button>
              </div>
            ) : (
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="btn btn-primary w-full"
              >
                {claiming ? 'Claiming...' : 'Approve & Claim Agent'}
              </button>
            )}
          </div>
        ) : !error ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading agent info...</p>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              className="btn w-full"
              onClick={() => setAgentLookupAttempt((current) => current + 1)}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
