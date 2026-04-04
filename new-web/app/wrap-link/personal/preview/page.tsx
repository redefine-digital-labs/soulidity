'use client'

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

export default function PersonalPreviewPage() {
  return (
    <div className="relative z-10">
      <FlowBar steps={['Select NFT', 'Configure', 'Preview', 'Gas', 'Success']} current={2} />

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Personal Join</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 3 — Preview</h1>
        <p className="text-muted text-sm mb-6">Review how this Soul layer will appear on-chain.</p>

        {/* Soul card preview */}
        <div className="bg-card border border-purple rounded-xl overflow-hidden mb-4">
          {/* Card header / banner */}
          <div
            className="h-24 flex items-end px-4 pb-3 relative"
            style={{ background: 'linear-gradient(135deg, #1a0535 0%, #2d1060 50%, #1a0535 100%)' }}
          >
            <div className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'radial-gradient(circle, #A855F7 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />
            <div className="relative flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-card2 border-2 border-purple flex items-center justify-center text-2xl">
                🤖
              </div>
              <div>
                <div className="font-bold text-base leading-tight">CyberBeast #0042</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-bold text-teal border border-teal px-2 py-0 rounded-full">🔗 Expanded</span>
                  <span className="text-[10px] text-muted">Cyber Agents Genesis</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card body */}
          <div className="p-4">
            <div className="flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted">Soul Layer</span>
                <span className="text-purple font-semibold">Personal Wrap</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted">Character File</span>
                <span className="font-mono text-xs text-teal">cyberbeast_soul.md</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted">Memory Seed</span>
                <span className="text-xs text-muted">Included ✓</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted">Activation Policy</span>
                <span className="text-xs">🔑 Holder-only</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted">NFT Reference</span>
                <span className="font-mono text-xs text-muted">0x9f2a…c7e4 · #0042</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted">Storage</span>
                <span className="text-xs text-muted">Walrus · Seal encrypted</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 flex items-start gap-2.5 text-xs text-muted">
          <span>ℹ️</span>
          <span>The Soul layer is additive — your original NFT is unchanged. This preview reflects the on-chain state after the wrap transaction is signed.</span>
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/wrap-link/personal/configure"
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <Link
            href="/wrap-link/personal/gas"
            className="flex-1 block bg-purple text-white font-bold text-[15px] text-center px-7 py-3 rounded-xl hover:opacity-90 transition"
          >
            Next Step →
          </Link>
        </div>
      </div>
    </div>
  )
}
