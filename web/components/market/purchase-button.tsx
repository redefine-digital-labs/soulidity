'use client'

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction as SolanaTransaction } from '@solana/web3.js'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'
import { USDC_DECIMALS } from '@web/lib/solana'
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@web/lib/solana-spl'

interface PurchaseButtonProps {
  listingId: string
  disabled?: boolean
  onSuccess?: () => void
}

export function PurchaseButton({ listingId, disabled, onSuccess }: PurchaseButtonProps) {
  const suiAccount = useCurrentAccount()
  const { user, getAuthHeaders } = useAuth()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const [status, setStatus] = useState<'idle' | 'creating' | 'signing' | 'confirming' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [chain, setChain] = useState<'sui' | 'solana'>('sui')

  async function handlePurchase() {
    if (!user) return
    if (chain === 'sui' && !suiAccount) return
    if (chain === 'solana' && !publicKey) return

    setStatus('creating')
    setError('')

    try {
      // 1. Create purchase intent
      const authHeaders = await getAuthHeaders()
      const intentRes = await fetch('/api/market/purchase-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          listingId,
          chain,
        }),
      })
      const intent = await intentRes.json()
      if (!intentRes.ok) throw new Error(intent.error || 'Failed to create intent')

      // 2. Build and sign transaction
      setStatus('signing')
      let txDigest: string

      if (chain === 'solana') {
        if (!publicKey) throw new Error('Please connect a Solana wallet first')

        if (!intent.mint || !intent.recipientTokenAccount) {
          throw new Error('Missing USDC payment details')
        }

        const transaction = new SolanaTransaction()
        const mint = new PublicKey(intent.mint)
        const sourceAta = await getAssociatedTokenAddress(mint, publicKey)
        transaction.add(
          createTransferCheckedInstruction(
            sourceAta,
            mint,
            new PublicKey(intent.recipientTokenAccount),
            publicKey,
            BigInt(intent.amount),
            USDC_DECIMALS,
          ),
        )

        txDigest = await sendTransaction(transaction, connection)
        await connection.confirmTransaction(txDigest, 'confirmed')
      } else {
        const tx = new Transaction()
        const [payment] = tx.splitCoins(tx.gas, [intent.priceMist])
        tx.transferObjects([payment], intent.recipientAddress)

        const result = await signAndExecute({ transaction: tx })
        txDigest = result.digest
      }

      // 3. Confirm purchase
      setStatus('confirming')
      const confirmRes = await fetch('/api/market/confirm-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ intentId: intent.intentId, txDigest }),
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

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setChain('sui')}
          className="glass-card px-3 py-1.5 text-xs font-semibold transition-opacity"
          style={{ color: chain === 'sui' ? 'var(--accent-cyan)' : 'var(--text-muted)', opacity: chain === 'sui' ? 1 : 0.8 }}
        >
          SUI
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

      {chain === 'sui' && !suiAccount && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先连接 Sui 钱包</p>
      )}

      {chain === 'solana' && !publicKey && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先连接 Solana 钱包</p>
      )}

      <button
        onClick={handlePurchase}
        disabled={
          disabled ||
          status === 'creating' ||
          status === 'signing' ||
          status === 'confirming' ||
          status === 'done' ||
          (chain === 'sui' ? !suiAccount : !publicKey)
        }
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
