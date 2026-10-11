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

export default function CollectionSuccessPage() {
  return (
    <div className="relative z-10">
      <FlowBar steps={['Collection Info', 'Configure', 'Preview', 'Gas', 'Success']} current={5} />

      <div className="max-w-[540px] mx-auto px-6 py-12 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <p className="text-[11px] font-bold text-success uppercase tracking-[0.1em] mb-2">Transaction Confirmed</p>
        <h1 className="font-display text-3xl font-bold mb-2">Collection Soul Live!</h1>
        <p className="text-muted text-sm mb-8">
          Each NFT holder can now interact with the Soul layer. The collection-level template is anchored on Sui.
        </p>

        <div className="bg-card border border-border rounded-xl p-5 mb-8 text-left">
          <div className="flex flex-col gap-2.5 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Collection</span>
              <span className="font-semibold">Cyber Agents Genesis</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Soul Object ID</span>
              <span className="font-mono text-xs text-teal">0xd2c9…4f1a</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Wrap Type</span>
              <span className="text-action-label text-xs font-semibold">Collection</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted">Eligible Holders</span>
              <span className="text-xs">28 wallets</span>
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

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 text-xs text-muted text-left flex items-start gap-2.5">
          <span>ℹ️</span>
          <span>Share the collection page link with your holders so they can begin interacting with the Soul layer. Each holder activates their own Soul instance independently.</span>
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
