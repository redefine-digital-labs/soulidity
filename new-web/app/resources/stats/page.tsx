import Link from 'next/link'

const stats = [
  { label: 'Total Souls on-chain', value: '2,418', color: 'text-purple' },
  { label: 'Total volume', value: '1.24M USDC', color: 'text-teal' },
  { label: 'Active SoulGrants', value: '312', color: 'text-gold' },
  { label: 'Souls sold (30 days)', value: '84', color: 'text-foreground' },
  { label: 'Creator count', value: '847', color: 'text-purple' },
  { label: 'Average Soul price', value: '512 USDC', color: 'text-gold' },
  { label: 'Royalty paid (lifetime)', value: '62,400 USDC', color: 'text-success' },
  { label: 'Collections launched', value: '38', color: 'text-teal' },
]

export default function ResourcesStatsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
      <h1 className="font-display text-2xl font-bold mb-0">Protocol Stats</h1>

      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b-[1.5px] border-border mt-4 mb-7" style={{ scrollbarWidth: 'none' }}>
        <Link href="/resources" className="bg-transparent border-none px-5 py-2.5 text-sm font-semibold text-muted cursor-pointer hover:text-foreground transition">
          📄 Documentation
        </Link>
        <button className="bg-transparent border-none px-5 py-2.5 text-sm font-bold text-foreground border-b-[2.5px] border-purple -mb-[1.5px] cursor-pointer">
          📊 Protocol Stats
        </button>
      </div>

      <p className="text-muted text-sm mb-6">Live protocol metrics from the Soulidity network on Sui.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-5">
            <div className="text-xs text-muted mb-2">{stat.label}</div>
            <div className={`font-display text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
