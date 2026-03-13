'use client'

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

interface PurchaseButtonProps {
  listingId: string
  priceMist: string
  disabled?: boolean
  onSuccess?: () => void
}

export function PurchaseButton({ listingId, priceMist, disabled, onSuccess }: PurchaseButtonProps) {
  const account = useCurrentAccount()
  const { user, getAuthHeaders } = useAuth()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [status, setStatus] = useState<'idle' | 'creating' | 'signing' | 'confirming' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handlePurchase() {
    if (!account || !user) return
    setStatus('creating')
    setError('')

    try {
      // 1. Create purchase intent
      const authHeaders = await getAuthHeaders()
      const intentRes = await fetch('/api/market/purchase-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ listingId }),
      })
      const intent = await intentRes.json()
      if (!intentRes.ok) throw new Error(intent.error || 'Failed to create intent')

      // 2. Build and sign transaction
      setStatus('signing')
      const tx = new Transaction()
      const [payment] = tx.splitCoins(tx.gas, [intent.priceMist])
      tx.transferObjects([payment], intent.recipientAddress)

      const result = await signAndExecute({ transaction: tx })

      // 3. Confirm purchase
      setStatus('confirming')
      const confirmRes = await fetch('/api/market/confirm-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ intentId: intent.intentId, txDigest: result.digest }),
      })
      const confirmData = await confirmRes.json()
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Confirmation failed')

      setStatus('done')
      onSuccess?.()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Purchase failed')
    }
  }

  const labels = {
    idle: '购买',
    creating: '创建订单...',
    signing: '请在钱包中确认...',
    confirming: '验证支付...',
    done: '购买成功',
    error: '重试',
  }

  if (!user) {
    return <a href="/login" className="glass-card px-6 py-3 text-sm font-semibold block text-center" style={{ color: 'var(--accent-cyan)' }}>登录后购买</a>
  }

  if (!account) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先连接 Sui 钱包</p>
  }

  return (
    <div>
      <button
        onClick={handlePurchase}
        disabled={disabled || status === 'creating' || status === 'signing' || status === 'confirming' || status === 'done'}
        className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all"
        style={{
          color: status === 'done' ? 'var(--accent-green, #10b981)' : 'var(--accent-cyan)',
          opacity: (disabled || status === 'done') ? 0.6 : 1,
        }}
      >
        {labels[status]}
      </button>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</p>}
    </div>
  )
}
