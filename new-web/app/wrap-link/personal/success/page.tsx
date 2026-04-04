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

export default function PersonalSuccessPage() {
  return (
    <div className="relative z-10">
      <FlowBar steps={['Select NFT', 'Configure', 'Preview', 'Gas', 'Success']} current={5} />

      <div className="max-w-[540px] mx-auto px-6 py-12 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <p className="text-[11px] font-bold text-success uppercase tracking-[0.1em] mb-2">Transaction Confirmed</p>
        <h1 className="font-display text-3xl font-bold mb-2">Soul Layer Live!</h1>
        <p className="text-muted text-sm mb-8">Your Soul layer is now anchored on Sui. CyberBeast #0042 has a living Soul.</p>

        <div className="bg-card border border-border rounded-xl p-5 mb-8 text-left">
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">NFT</span>
              <span className="font-semibold">CyberBeast #0042</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Soul Object ID</span>
              <span className="font-mono text-xs text-teal">0xf3a1…b8d2</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Wrap Type</span>
              <span className="text-purple text-xs font-semibold">Personal</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Activation Policy</span>
              <span className="text-xs">🔑 Holder-only</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted">Status</span>
              <span className="text-success text-xs font-semibold">● Active</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href="/my-souls"
            className="flex-1 block bg-transparent border border-border text-foreground font-semibold text-sm text-center px-5 py-3 rounded-xl hover:border-purple transition"
          >
            My Souls
          </Link>
          <Link
            href="/market"
            className="flex-1 block bg-purple text-white font-bold text-sm text-center px-5 py-3 rounded-xl hover:opacity-90 transition"
          >
            View Market →
          </Link>
        </div>
      </div>
    </div>
  )
}
