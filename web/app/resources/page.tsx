import type { Metadata } from 'next'
import Link from 'next/link'

const resourcesTitle = 'Documentation'
const resourcesDescription =
  'Soulidity documentation — user guide, getting started, Soul content format, SoulGrant API, paid access, smart contracts, Walrus/Seal integration, desktop companion, and SDK reference.'

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

type Doc = { emoji: string; title: string; desc: string; href: string }

const userDocs: Doc[] = [
  { emoji: '🚀', title: 'Getting Started', desc: 'Quick start — connect your wallet, browse Souls, make your first purchase.', href: '/resources/getting-started' },
  { emoji: '📖', title: 'User Guide', desc: 'Full user journey — buying, creating, managing grants, paid access, desktop companion, and selling.', href: '/resources/user-guide' },
  { emoji: '💎', title: 'Paid Access', desc: 'How SoulPaidAccessList works — owner-revocable subscriptions, no refund, ownership-epoch auto-invalidation.', href: '/resources/paid-access' },
  { emoji: '🖥️', title: 'Desktop Companion', desc: 'Bind a Soul to the desktop app — sprite grant flow, protected sprite IPC, mint deep-link callback.', href: '/resources/desktop-companion' },
]

const builderDocs: Doc[] = [
  { emoji: '📐', title: 'Soul Content Format', desc: 'Canonical soul.md, founding memory, and skills.zip — the inputs to the unified SoulContent matrix.', href: '/resources/content-format' },
  { emoji: '🧩', title: 'Kind Registry Reference', desc: 'Five built-in kinds (SOUL_DOC / MEMORY / SKILL / SPRITE / AUDIO), scope-mask mapping, and custom kind registration.', href: '/resources/kind-registry' },
  { emoji: '🔐', title: 'SoulGrant — Authorization API', desc: 'Issue, supersede, and revoke AI agent access to Soul data. Scope masks, ownership-epoch invalidation, supersede semantics.', href: '/resources/soulgrant-api' },
  { emoji: '🤖', title: 'Agent Integration Guide', desc: 'For OpenClaw / Hermes / third-party agents — API key auth, search/access, grant-merge-masks pre-check, auto-grant on append.', href: '/resources/agent-integration' },
  { emoji: '📜', title: 'Smart Contract Reference', desc: 'Phase 2 Move modules — content / kind_registry / paid_access / grant / soul / market / collection.', href: '/resources/smart-contracts' },
  { emoji: '🌊', title: 'Walrus & Seal Integration', desc: 'How Soul data is encrypted at rest on Walrus and access-controlled via Seal policy objects.', href: '/resources/walrus-seal' },
  { emoji: '🧠', title: 'Soul Memory Architecture', desc: 'Append-only memory under KIND_MEMORY — auto-grant on append, deletion semantics, immutability.', href: '/resources/memory-architecture' },
  { emoji: '⚙️', title: 'Skills & Docs Revisions', desc: 'How skills.zip bundles map to skill name + version index under KIND_SKILL, privacy modes, and soft-delete behavior.', href: '/resources/skills-revisions' },
  { emoji: '🔗', title: 'Wrap + Link Guide', desc: 'Add a Soul layer on top of any existing NFT without touching the original contract.', href: '/resources/wrap-link' },
  { emoji: '🛠️', title: 'API & SDK Reference', desc: 'REST endpoints, TypeScript SDK (@soulidity/sdk), and integration patterns for builders on Soulidity.', href: '/resources/api-sdk' },
]

export default function ResourcesDocsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
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

      <p className="text-muted text-sm mb-7">
        Technical guides, protocol specs, and integration references for users and builders on Soulidity.
      </p>

      <DocGroup
        title="For Users"
        subtitle="Buying, creating, managing your Souls."
        docs={userDocs}
      />

      <div className="mt-8">
        <DocGroup
          title="For Builders"
          subtitle="Protocol reference, SDK, and agent integration."
          docs={builderDocs}
        />
      </div>
    </div>
  )
}

function DocGroup({ title, subtitle, docs }: { title: string; subtitle: string; docs: Doc[] }) {
  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-foreground mb-1">{title}</h2>
      <p className="text-xs text-muted mb-3">{subtitle}</p>
      <div className="flex flex-col gap-3">
        {docs.map((doc) => (
          <Link key={doc.href} href={doc.href}>
            <div className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-purple transition">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold mb-1">{doc.emoji} {doc.title}</div>
                  <div className="text-sm text-muted">{doc.desc}</div>
                </div>
                <span className="text-muted">→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
