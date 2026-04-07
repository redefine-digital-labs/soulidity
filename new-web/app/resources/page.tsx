import Link from 'next/link'

const docs = [
  { emoji: '🚀', title: 'Getting Started', desc: 'Connect your wallet, browse Souls, make your first purchase, and understand the ownership model.' },
  { emoji: '📐', title: 'Soul Content Format', desc: 'Canonical soul.md, founding memory, and skills.zip contract for the fresh-deploy content architecture.', href: '/resources/content-format' },
  { emoji: '🔐', title: 'SoulGrant — Authorization API', desc: 'Issue, scope, supersede, and revoke AI agent access to Soul data via Seal, Memory, and Skills.' },
  { emoji: '📜', title: 'Smart Contract Reference', desc: 'SoulSeries, SoulRelease, SoulGrant, SoulCollection — Move module docs, object schemas, event types.' },
  { emoji: '🌊', title: 'Walrus & Seal Integration', desc: 'How Soul data is encrypted at rest on Walrus and access-controlled via Seal policy objects.' },
  { emoji: '📖', title: 'Soul Memory Architecture', desc: 'Append-only memory on Walrus — Memory at mint, SoulGrant write-back flow, and immutability guarantees.' },
  { emoji: '🧠', title: 'Skills & Docs Revisions', desc: 'How skills.zip bundles map to skillName/versionIndex, privacy modes, and soft-delete behavior.' },
  { emoji: '🔗', title: 'Wrap + Link Guide', desc: 'Add a Soul layer on top of any existing NFT without touching the original contract.' },
  { emoji: '⚙️', title: 'API & SDK Reference', desc: 'REST endpoints, TypeScript SDK, and integration patterns for builders on Soulidity.' },
]

export default function ResourcesDocsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
      <h1 className="font-display text-2xl font-bold mb-0">Documentation</h1>

      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b-[1.5px] border-border mt-4 mb-7" style={{ scrollbarWidth: 'none' }}>
        <button className="bg-transparent border-none px-5 py-2.5 text-sm font-bold text-foreground border-b-[2.5px] border-purple -mb-[1.5px] cursor-pointer">
          📄 Documentation
        </button>
        <Link href="/resources/stats" className="bg-transparent border-none px-5 py-2.5 text-sm font-semibold text-muted cursor-pointer hover:text-foreground transition">
          📊 Protocol Stats
        </Link>
      </div>

      <p className="text-muted text-sm mb-5">Technical guides, protocol specs, and integration references for builders on Soulidity.</p>

      <div className="flex flex-col gap-3">
        {docs.map((doc) => {
          const card = (
            <div
            key={doc.title}
            className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-purple transition"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-bold mb-1">{doc.emoji} {doc.title}</div>
                <div className="text-sm text-muted">{doc.desc}</div>
              </div>
              <span className="text-muted">→</span>
            </div>
          </div>
          )

          if (doc.href) {
            return (
              <Link key={doc.title} href={doc.href}>
                {card}
              </Link>
            )
          }

          return card
        })}
      </div>
    </div>
  )
}
