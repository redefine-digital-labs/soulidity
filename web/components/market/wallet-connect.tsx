'use client'

import { ConnectButton, useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

export function WalletConnect() {
  const account = useCurrentAccount()
  const { mutateAsync: signMessage } = useSignPersonalMessage()
  const { user } = useAuth()
  const [binding, setBinding] = useState(false)
  const [bound, setBound] = useState(false)
  const [error, setError] = useState('')

  async function handleBind() {
    if (!account || !user) return
    setBinding(true)
    setError('')

    try {
      // 1. Get challenge
      const challengeRes = await fetch('/api/wallet/bind/challenge', { method: 'POST' })
      const { nonce, message } = await challengeRes.json()
      if (!nonce) throw new Error('Failed to get challenge')

      // 2. Sign message with wallet
      const { signature } = await signMessage({ message: new TextEncoder().encode(message) })

      // 3. Confirm binding
      const confirmRes = await fetch('/api/wallet/bind/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, signature }),
      })
      const result = await confirmRes.json()
      if (!confirmRes.ok) throw new Error(result.error || 'Binding failed')

      setBound(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Binding failed')
    } finally {
      setBinding(false)
    }
  }

  if (!user) {
    return (
      <a href="/login" className="glass-card px-4 py-2 text-sm" style={{ color: 'var(--accent-cyan)' }}>
        登录后连接钱包
      </a>
    )
  }

  if (!account) {
    return <ConnectButton />
  }

  if (bound) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="badge badge-cyan">已绑定</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {account.address.slice(0, 6)}...{account.address.slice(-4)}
      </span>
      <button
        onClick={handleBind}
        disabled={binding}
        className="glass-card px-4 py-2 text-sm transition-colors"
        style={{ color: 'var(--accent-cyan)', opacity: binding ? 0.5 : 1 }}
      >
        {binding ? '签名中...' : '绑定钱包'}
      </button>
      {error && <span className="text-sm" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</span>}
    </div>
  )
}
