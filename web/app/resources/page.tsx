import type { Metadata } from 'next'
import Link from 'next/link'

const resourcesTitle = 'Documentation'
const resourcesDescription =
  'Soulidity documentation — getting started, Soul content format, SoulGrant API, smart contracts, Walrus/Seal integration, and SDK reference.'

export const metadata: Metadata = {
  title: resourcesTitle,
  description: resourcesDescription,
  alternates: { canonical: '/resources' },
  openGraph: {
    title: `${resourcesTitle} · Soulidity`,
    description: resourcesDescription,
    url: '/resources',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${resourcesTitle} · Soulidity`,
    description: resourcesDescription,
  },
}

const docs = [
  { emoji: '🚀', title: 'Getting Started', desc: 'Connect your wallet, browse Souls, make your first purchase, and understand the ownership model.', href: '/resources/getting-started' },
  { emoji: '📐', title: 'Soul Content Format', desc: 'Canonical soul.md, founding memory, and skill.zip contract for the fresh-deploy content architecture.', href: '/resources/content-format' },
  { emoji: '🔐', title: 'SoulGrant — Authorization API', desc: 'Issue, scope, supersede, and revoke AI agent access to Soul data via Seal, Memory, and Skills.', href: '/resources/soulgrant-api' },
  { emoji: '📜', title: 'Smart Contract Reference', desc: 'SoulSeries, SoulRelease, SoulGrant, SoulCollection — Move module docs, object schemas, event types.', href: '/resources/smart-contracts' },
  { emoji: '🌊', title: 'Walrus & Seal Integration', desc: 'How Soul data is encrypted at rest on Walrus and access-controlled via Seal policy objects.', href: '/resources/walrus-seal' },
  { emoji: '📖', title: 'Soul Memory Architecture', desc: 'Append-only memory on Walrus — Memory at mint, SoulGrant write-back flow, and immutability guarantees.', href: '/resources/memory-architecture' },
  { emoji: '🧠', title: 'Skills & Docs Revisions', desc: 'How skill.zip bundles map to skillName/versionIndex, privacy modes, and soft-delete behavior.', href: '/resources/skills-revisions' },
  { emoji: '🔗', title: 'Wrap + Link Guide', desc: 'Add a Soul layer on top of any existing NFT without touching the original contract.', href: '/resources/wrap-link' },
  { emoji: '⚙️', title: 'API & SDK Reference', desc: 'REST endpoints, TypeScript SDK, and integration patterns for builders on Soulidity.', href: '/resources/api-sdk' },
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
