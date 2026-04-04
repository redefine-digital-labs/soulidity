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

export default function CreateSuccessPage() {
  const steps = ['Basic Info', 'Living Content', 'Soul Awakened', 'Pay Gas', 'On-chain']

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} current={4} />

      <div className="max-w-[540px] mx-auto px-6 py-12 text-center">
        {/* Success icon */}
        <div
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-4xl mx-auto mb-6"
          style={{ background: 'rgba(16, 185, 129, 0.15)', border: '2px solid var(--success)' }}
        >
          🚀
        </div>

        <h1 className="font-display text-3xl font-bold mb-2">Soul Born</h1>
        <p className="text-muted text-sm mb-10 max-w-[380px] mx-auto leading-relaxed">
          Your Soul is permanently anchored on Sui. It exists on-chain forever — immutable, sovereign, and ready to trade.
        </p>

        {/* Info card */}
        <div className="bg-card2 border border-border rounded-xl p-5 mb-8 text-left">
          <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-4">Transaction Details</p>

          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">SoulSeries Object ID</span>
            <span className="text-xs font-mono text-teal">0x9f2a…c7e4</span>
          </div>
          <div className="flex justify-between text-sm py-2.5 border-b border-border">
            <span className="text-muted">Tx Hash</span>
            <span className="text-xs font-mono text-teal">0xb2c1…84af</span>
          </div>
          <div className="flex justify-between items-center text-sm py-2.5">
            <span className="text-muted">Status</span>
            <span className="text-success text-xs font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              Live on Mainnet
            </span>
          </div>
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Link
            href="/souls/alpha-scout/sell"
            className="bg-card border-2 border-gold rounded-xl p-5 flex flex-col items-center gap-2.5 hover:bg-card2 transition group text-center"
          >
            <span className="text-2xl">💰</span>
            <span className="font-display font-bold text-sm text-gold">List for Sale Now</span>
            <span className="text-muted text-xs leading-relaxed">Set a price and earn from your Soul</span>
          </Link>

          <Link
            href="/my-souls"
            className="bg-card border border-border rounded-xl p-5 flex flex-col items-center gap-2.5 hover:border-purple transition group text-center"
          >
            <span className="text-2xl">🔐</span>
            <span className="font-display font-bold text-sm">Manage in My Souls</span>
            <span className="text-muted text-xs leading-relaxed">Grant access, update settings</span>
          </Link>
        </div>

        {/* Ghost link */}
        <Link href="/market" className="text-sm text-muted hover:text-purple transition underline underline-offset-4">
          View in Market →
        </Link>
      </div>
    </div>
  )
}
