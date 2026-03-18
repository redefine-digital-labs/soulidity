'use client'

import { ConnectButton, useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

export function WalletConnect() {
  const suiAccount = useCurrentAccount()
  const { mutateAsync: signMessage } = useSignPersonalMessage()
  const { publicKey, signMessage: signSolanaMessage } = useWallet()
  const { user, getAuthHeaders } = useAuth()
  const [binding, setBinding] = useState(false)
  const [bound, setBound] = useState<{ sui: boolean; solana: boolean }>({ sui: false, solana: false })
  const [error, setError] = useState('')
  const [chain, setChain] = useState<'sui' | 'solana'>('sui')

  async function handleBind() {
    if (!user) return
    if (chain === 'sui' && !suiAccount) return
    if (chain === 'solana' && !publicKey) return

    setBinding(true)
    setError('')

    try {
      // 1. Get challenge
      const authHeaders = await getAuthHeaders()
      const challengeRes = await fetch('/api/wallet/bind/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ chain }),
      })
      const { nonce, message } = await challengeRes.json()
      if (!nonce) throw new Error('Failed to get challenge')

      let payload: Record<string, string> = { nonce, chain }
      if (chain === 'solana') {
        if (!publicKey || !signSolanaMessage) {
          throw new Error('Connected Solana wallet does not support message signing')
        }

        const signed = await signSolanaMessage(new TextEncoder().encode(message))
        payload = {
          ...payload,
          address: publicKey.toBase58(),
          signature: bs58.encode(signed),
        }
      } else {
        const { signature } = await signMessage({ message: new TextEncoder().encode(message) })
        payload = {
          ...payload,
          signature,
        }
      }

      // 3. Confirm binding
      const confirmRes = await fetch('/api/wallet/bind/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      })
      const result = await confirmRes.json()
      if (!confirmRes.ok) throw new Error(result.error || 'Binding failed')

      setBound((current) => ({ ...current, [chain]: true }))
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

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setChain('sui')}
          className="glass-card px-3 py-1.5 text-xs font-semibold transition-opacity"
          style={{ color: chain === 'sui' ? 'var(--accent-cyan)' : 'var(--text-muted)', opacity: chain === 'sui' ? 1 : 0.8 }}
        >
          Sui
        </button>
        <button
          type="button"
          onClick={() => setChain('solana')}
          className="glass-card px-3 py-1.5 text-xs font-semibold transition-opacity"
          style={{ color: chain === 'solana' ? 'var(--accent-cyan)' : 'var(--text-muted)', opacity: chain === 'solana' ? 1 : 0.8 }}
        >
          Solana
        </button>
      </div>

      {chain === 'sui' ? (
        !suiAccount ? (
          <ConnectButton />
        ) : bound.sui ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="badge badge-cyan">已绑定</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {suiAccount.address.slice(0, 6)}...{suiAccount.address.slice(-4)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {suiAccount.address.slice(0, 6)}...{suiAccount.address.slice(-4)}
            </span>
            <button
              onClick={handleBind}
              disabled={binding}
              className="glass-card px-4 py-2 text-sm transition-colors"
              style={{ color: 'var(--accent-cyan)', opacity: binding ? 0.5 : 1 }}
            >
              {binding ? '签名中...' : '绑定钱包'}
            </button>
          </div>
        )
      ) : !publicKey ? (
        <WalletMultiButton />
      ) : bound.solana ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="badge badge-cyan">已绑定</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
          </span>
          <button
            onClick={handleBind}
            disabled={binding}
            className="glass-card px-4 py-2 text-sm transition-colors"
            style={{ color: 'var(--accent-cyan)', opacity: binding ? 0.5 : 1 }}
          >
            {binding ? '签名中...' : '绑定钱包'}
          </button>
        </div>
      )}

      {error && <span className="text-sm" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</span>}
    </div>
  )
}
