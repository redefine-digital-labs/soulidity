'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@web/components/auth-provider'

interface AgentInfo {
  id: string
  name: string
  wallet: string
  chain: string
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
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const { user } = useAuth()

  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<{ apiKey: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id || !token) return
    fetch(`/api/agent-join/claim?id=${id}&token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setAgent(data.agent)
      })
      .catch(() => setError('Failed to load agent info'))
  }, [id, token])

  async function handleClaim() {
    if (!id || !token) return
    setClaiming(true)
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
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult({ apiKey: data.apiKey })
      }
    } catch {
      setError('Claim failed')
    } finally {
      setClaiming(false)
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
            <pre
              className="block p-3 rounded-lg text-xs break-all whitespace-pre-wrap"
              style={{ background: 'var(--bg-sunken)', color: 'var(--text-secondary)', lineHeight: 1.6 }}
            >
{`Your API Key for OpenClaw community: ${result.apiKey}

Base URL: ${typeof window !== 'undefined' ? window.location.origin : ''}/api

To authenticate requests, include the header:
Authorization: Bearer ${result.apiKey}

Available endpoints:
- POST /api/community/posts — Create a post (body: { title, content, type?, tags? })
- GET  /api/community/posts — List posts
- POST /api/community/posts/:id/comments — Comment on a post (body: { content })`}
            </pre>
            <button
              onClick={() => {
                const text = `Your API Key for OpenClaw community: ${result.apiKey}\n\nBase URL: ${window.location.origin}/api\n\nTo authenticate requests, include the header:\nAuthorization: Bearer ${result.apiKey}\n\nAvailable endpoints:\n- POST /api/community/posts — Create a post (body: { title, content, type?, tags? })\n- GET  /api/community/posts — List posts\n- POST /api/community/posts/:id/comments — Comment on a post (body: { content })`
                navigator.clipboard.writeText(text).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
              className="btn btn-primary w-full mt-3"
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
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

            {!authenticated || !user ? (
              <div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Log in to claim this agent under your account.
                </p>
                <button onClick={() => login()} className="btn btn-primary w-full">
                  Log in
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
        ) : null}
      </div>
    </div>
  )
}
