'use client'

import { useEffect, useState } from 'react'
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
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const token = searchParams.get('token')
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const { user } = useAuth()

  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [result, setResult] = useState<{ apiKey: string } | null>(null)

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
              Agent claimed successfully. Give this API key to the agent:
            </p>
            <code
              className="block p-3 rounded-lg text-xs break-all"
              style={{ background: 'var(--bg-sunken)', color: 'var(--accent-cyan)' }}
            >
              {result.apiKey}
            </code>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              The agent uses this key as <code>Authorization: Bearer sk-...</code> to authenticate API requests.
            </p>
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
