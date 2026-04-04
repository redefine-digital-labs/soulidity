'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function CreatePreviewPage() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="relative z-10">
      {/* Flow bar */}
      <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center text-[10px] font-bold">✓</div>
          <span className="text-success">Basic Info</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center text-[10px] font-bold">✓</div>
          <span className="text-success">Living Content</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-purple flex items-center justify-center text-[10px] font-bold">3</div>
          <span className="text-foreground font-semibold">Soul Awakened</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-border flex items-center justify-center text-[10px] font-bold">4</div>
          <span className="text-muted">Pay Gas</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-border flex items-center justify-center text-[10px] font-bold">5</div>
          <span className="text-muted">On-chain</span>
        </div>
      </div>

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Create Soul</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 3 — Soul Awakened</h1>
        <p className="text-muted text-sm mb-8">Preview how your Soul will appear in the marketplace.</p>

        {/* Soul card preview */}
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
                🧠
              </div>
            </div>

            {/* Card body */}
            <div className="px-5 pt-9 pb-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h2 className="font-display font-bold text-lg leading-tight">My Soul</h2>
                  <p className="text-muted text-xs">by you</p>
                </div>
                <span className="bg-gold/10 text-gold border border-gold/30 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                  35.00 USDC
                </span>
              </div>

              <p className="text-sm text-muted mb-4 leading-relaxed">
                This is the founding description of your Soul, encrypted and anchored on Walrus. It defines who this Soul is in the world.
              </p>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {['alpha', 'scouting', 'on-chain', 'DeFi'].map((tag) => (
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
            <span>This is a live preview. Your Soul will look exactly like this once deployed on-chain. Name and description come from Step 1.</span>
          </div>
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/create/content"
            className="bg-transparent text-foreground border border-border rounded-lg px-4.5 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <Link
            href="/create/gas"
            className="flex-1 bg-purple text-white font-bold text-[15px] text-center px-7 py-3 rounded-xl hover:bg-purple-deep transition"
          >
            Proceed to Pay Gas →
          </Link>
        </div>
      </div>
    </div>
  )
}
