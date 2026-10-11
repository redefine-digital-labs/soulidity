'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

function FlowBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      {steps.map((label, i) => (
        <span key={label} className="contents">
          {i > 0 && <span className="mx-2.5 text-border text-[11px]">›</span>}
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i < current ? 'bg-success' : i === current ? 'bg-purple' : 'bg-border'
            }`}>{i < current ? '✓' : i + 1}</div>
            <span className={i < current ? 'text-success' : i === current ? 'text-foreground font-semibold' : 'text-muted'}>
              {label}
            </span>
          </div>
        </span>
      ))}
    </div>
  )
}

export default function PersonalGasPage() {
  const router = useRouter()
  const [signing, setSigning] = useState(false)

  function handleSign() {
    setSigning(true)
    setTimeout(() => {
      setSigning(false)
      router.push('/wrap-link/personal/success')
    }, 2000)
  }

  return (
    <div className="relative z-10">
      <FlowBar steps={['Select NFT', 'Configure', 'Preview', 'Gas', 'Success']} current={3} />

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Personal Join</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 4 — Gas</h1>
        <p className="text-muted text-sm mb-6">Review the transaction before signing.</p>

        <div className="bg-card2 border border-purple rounded-xl p-5 mb-4">
          <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-4">Wallet Request</p>

          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Contract</span>
            <span className="text-teal text-xs font-mono">SoulFactory::wrap_personal</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Network</span>
            <span>Sui Mainnet</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">NFT Reference</span>
            <span className="text-xs font-mono text-muted">0x9f2a…c7e4 · #0042</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Character CID</span>
            <span className="text-xs font-mono text-muted">bafkrei…a3f8c</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Memory CID</span>
            <span className="text-xs font-mono text-muted">bafkrei…7m2q</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Activation Policy</span>
            <span className="text-xs">Holder-only</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Seal Policy</span>
            <span className="text-success text-xs">Registered ✓</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 font-semibold">
            <span className="text-muted">Estimated Gas</span>
            <span>~0.003 SUI <span className="text-muted font-normal text-xs">(~$0.02)</span></span>
          </div>
        </div>

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 flex items-start gap-2.5 text-xs text-muted">
          <span>ℹ️</span>
          <span>Signing this transaction wraps the Soul layer on-chain. The NFT is not transferred. The Soul character and memory are content-addressed and immutable after deployment.</span>
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/wrap-link/personal/preview"
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <button
            onClick={handleSign}
            disabled={signing}
            className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50"
          >
            {signing ? '⟳ Signing…' : '✓ Sign & Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
