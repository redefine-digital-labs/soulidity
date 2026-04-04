'use client'

import { useEffect, useState } from 'react'
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

const steps = ['Choose Source', 'Upload File', 'Map Fields', 'Soul Awakened', 'Pay Gas', 'On-chain']

export default function ImportPreviewPage() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} current={3} />

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Import Soul</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 4 — Soul Awakened</h1>
        <p className="text-muted text-sm mb-8">Preview how your imported Soul will appear in the marketplace.</p>

        {/* Soul preview card */}
        <div
          className="transition-all duration-700"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(18px)',
          }}
        >
          <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
            {/* Card header */}
            <div
              className="h-24 flex items-end px-5 pb-4"
              style={{ background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)' }}
            >
              <div className="w-14 h-14 rounded-xl border-2 border-border bg-card flex items-center justify-center text-2xl -mb-7">
                🤖
              </div>
            </div>

            {/* Card body */}
            <div className="px-5 pt-9 pb-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="font-display font-bold text-lg leading-tight">AlphaScout</h2>
                  <p className="text-muted text-xs">by you</p>
                </div>
                <span className="bg-purple/15 text-purple text-[11px] font-semibold px-2.5 py-1 rounded-full">
                  Imported
                </span>
              </div>

              <p className="text-sm text-muted mb-4 leading-relaxed">
                On-chain signal agent for DeFi alpha detection. Analytical and data-driven, anchored on Walrus with Seal-encrypted memory.
              </p>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {['trading', 'defi', 'signals'].map((tag) => (
                  <span
                    key={tag}
                    className="bg-card2 border border-border text-muted text-[11px] px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted border-t border-border pt-3">
                <span>🔐 Walrus · Seal encrypted</span>
                <span className="text-teal">● On-chain</span>
              </div>
            </div>
          </div>

          {/* Info note */}
          <div className="bg-purple/10 border border-purple/30 rounded-xl px-4 py-3 mb-6 flex items-start gap-2.5 text-xs text-purple">
            <span>✨</span>
            <span>This preview reflects the mapped fields from your import. Once deployed, the Soul is immutably anchored on Sui.</span>
          </div>
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/import/map"
            className="bg-transparent text-foreground border border-border rounded-lg px-4.5 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <Link
            href="/import/gas"
            className="flex-1 text-center bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-xl hover:bg-purple-deep transition"
          >
            Proceed to Pay Gas →
          </Link>
        </div>
      </div>
    </div>
  )
}
