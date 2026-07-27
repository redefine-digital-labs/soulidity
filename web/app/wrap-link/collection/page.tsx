'use client'

import { useState } from 'react'
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

export default function CollectionSelectPage() {
  const [contractAddress, setContractAddress] = useState('')
  const [collectionName, setCollectionName] = useState('')

  const isValid = contractAddress.trim().length > 10 && collectionName.trim().length > 0

  return (
    <div className="relative z-10">
      <FlowBar steps={['Collection Info', 'Configure', 'Preview', 'Gas', 'Success']} current={0} />

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Collection Expand</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 1 — Collection Info</h1>
        <p className="text-muted text-sm mb-6">Provide the NFT contract address and collection name to attach a shared Soul layer.</p>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">
            Contract Address <span className="text-danger">*</span>
          </label>
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border font-mono"
            placeholder="0x..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
          />
          <div className="text-[11px] text-muted mt-1">The Sui object ID of the NFT collection contract.</div>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">
            Collection Name <span className="text-danger">*</span>
          </label>
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
            placeholder="e.g. Cyber Agents Genesis"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
          />
        </div>

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 flex items-start gap-2.5 text-xs text-muted">
          <span>ℹ️</span>
          <span>You must be the collection contract authority to attach a collection-level Soul. Ownership is verified on-chain before the transaction proceeds.</span>
        </div>

        <Link
          href="/wrap-link/collection/configure"
          className={`block w-full font-bold text-[15px] text-center px-7 py-3 rounded-xl transition ${
            isValid
              ? 'bg-purple text-white hover:opacity-90'
              : 'bg-border text-muted cursor-not-allowed pointer-events-none'
          }`}
        >
          Next Step →
        </Link>
      </div>
    </div>
  )
}
