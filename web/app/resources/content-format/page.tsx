import type { Metadata } from 'next'
import Link from 'next/link'
import {
  FOUNDING_MEMORY_MD_TEMPLATE,
  SOUL_MD_TEMPLATE,
} from '@soulidity/sdk'

const pageTitle = 'Soul Content Format'
const pageDescription =
  'Canonical soul.md, founding memory, and skills.zip — inputs to the unified Phase 2 SoulContent matrix. Kind ids, names, version-indexing rules, and access addressing.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/content-format' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/content-format',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

function TemplatePreview({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export default function ContentFormatPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Soul Content Format</h1>
        <p className="text-sm text-muted">
          Soul content lives as typed slots under a single <code>SoulContent</code> object — one per Soul, bound once at mint. This page covers the three artifacts uploaded at mint time (<code>soul.md</code>, <code>memory.md</code>, <code>skills.zip</code>) plus persona assets (sprite / audio), how they map to <code>KindRegistry</code> kinds, and the addressing rules for every slot.
        </p>
      </div>

      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b-[1.5px] border-border" style={{ scrollbarWidth: 'none' }}>
        <button className="bg-transparent border-none px-5 py-2.5 text-sm font-bold text-foreground border-b-[2.5px] border-purple -mb-[1.5px] cursor-pointer">
          📄 Documentation
        </button>
        <Link href="/resources/stats" className="bg-transparent border-none px-5 py-2.5 text-sm font-semibold text-muted cursor-pointer hover:text-foreground transition">
          📊 Protocol Stats
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Mint artifacts ↔ kinds</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Artifact</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Kind</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Name</th>
                <th className="text-left py-2 text-foreground font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">soul.md</td>
                <td className="py-2 pr-4 font-mono text-xs">KIND_SOUL_DOC (0)</td>
                <td className="py-2 pr-4 font-mono text-xs">&quot;soul&quot;</td>
                <td className="py-2 text-xs">Appended once at mint. Immutable forever — no delete or purge.</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">memory.md (founding)</td>
                <td className="py-2 pr-4 font-mono text-xs">KIND_MEMORY (1)</td>
                <td className="py-2 pr-4 font-mono text-xs">&quot;default&quot;</td>
                <td className="py-2 text-xs">Single canonical name. Append-only log; soft delete &amp; hard purge permitted.</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">skills.zip</td>
                <td className="py-2 pr-4 font-mono text-xs">KIND_SKILL (2)</td>
                <td className="py-2 pr-4 font-mono text-xs">from <code>SKILL.md</code> <code>name:</code></td>
                <td className="py-2 text-xs">Multi-name. Each <code>name</code> has its own version vector indexed by 0-based <code>version_index</code>.</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">sprite</td>
                <td className="py-2 pr-4 font-mono text-xs">KIND_SPRITE (3)</td>
                <td className="py-2 pr-4 font-mono text-xs">free-form</td>
                <td className="py-2 text-xs">Persona art. Active binding selects the live sprite. Supports public / paid / grant reads.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-xs">audio</td>
                <td className="py-2 pr-4 font-mono text-xs">KIND_AUDIO (4)</td>
                <td className="py-2 pr-4 font-mono text-xs">free-form</td>
                <td className="py-2 text-xs">Persona voice. Active binding + same read modes as sprite.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          See <Link href="/resources/kind-registry" className="text-action-label hover:text-foreground transition">Kind Registry</Link> for the op-mask / read-mode-mask cells per kind and the rules for admin-registered custom kinds.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Key rules</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">SOUL_DOC is mint-only and immutable.</strong> <code>op_mask = 0</code> — no append, delete, or purge after mint. Read mode is <code>OWNER | GRANT</code>. The soul.md you ship is the soul.md forever.</li>
          <li><strong className="text-foreground">Memory uses one canonical name.</strong> Memory slots always have <code>name = &quot;default&quot;</code>; each append pushes a new version_index. Time order is encoded by index, not by timestamps.</li>
          <li><strong className="text-foreground">Skills are multi-name.</strong> The <code>name</code> front-matter field in <code>SKILL.md</code> becomes the on-chain key. Re-uploading the same name appends a new version_index; a new name creates a fresh slot starting at <code>version_index = 0</code>.</li>
          <li><strong className="text-foreground">Sprites / audio use active bindings.</strong> Multiple versions can be present; one is marked active via <code>content::set_active</code>. The desktop companion reads from the active slot.</li>
          <li><strong className="text-foreground">Everything is Seal-encrypted at rest.</strong> Public slots still require <code>READ_OWNER</code>; <code>seal_encrypted = true</code> on every slot. Public reads use a different Seal approval entry, not bypass Seal.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Slot addressing</h2>
        <p className="text-sm text-muted">
          Every content slot is addressed by the triple <code>(kind, name, version_index)</code>. This is the canonical addressing scheme across the on-chain layer, the access API, and DB mirrors. Legacy phase 1 addressing — separate <code>SoulMemory</code> / <code>SoulSkills</code> object IDs, <code>timestamp_key</code>, etc. — does not exist post-phase 2.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Legacy Soul document route — fixed to (KIND_SOUL_DOC, "soul", 0)
GET /api/souls/[id]/access

// Content-slot access route
GET /api/souls/[id]/content/1/default/3/access
GET /api/souls/[id]/content/2/my-skill/0/access
GET /api/souls/[id]/content/3/idle/2/access`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Shared templates</h2>
        <p className="text-sm text-muted">
          These previews render the exact exported strings from <code>@soulidity/sdk</code>, so the docs stay aligned with the live uploader. Drop these into <code>soul.md</code> and <code>memory.md</code> verbatim and customize.
        </p>
        <TemplatePreview title="soul.md" code={SOUL_MD_TEMPLATE} />
        <TemplatePreview title="memory.md" code={FOUNDING_MEMORY_MD_TEMPLATE} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">skills.zip layout</h2>
        <p className="text-sm text-muted">
          Skills must be uploaded as <code>.zip</code> archives. The upload validator enforces this before Walrus upload. Inside the ZIP, a <code>SKILL.md</code> with a <code>name</code> front-matter field is required.
        </p>
        <div className="rounded-xl border border-border/70 bg-black/20 p-4 space-y-2">
          <div className="text-xs font-semibold text-foreground">Required: SKILL.md front-matter</div>
          <pre className="text-xs leading-6 text-foreground/90">
            <code>{`---
name: my-skill-name       # on-chain slot name (canonical lowercase + hyphens)
version: 1.0.0            # human-readable version label
description: |
  What this skill does.
---

# Skill content here`}</code>
          </pre>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/kind-registry" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Kind Registry →
        </Link>
      </div>
    </div>
  )
}
