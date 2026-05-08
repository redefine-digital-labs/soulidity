import Link from 'next/link'
import {
  FOUNDING_MEMORY_MD_TEMPLATE,
  SOUL_MD_TEMPLATE,
} from '@soulidity/sdk'

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
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Soul Content Format</h1>
        <p className="text-sm text-muted">
          Fresh-deploy content contract for `soul.md`, `memory.md`, and `skills.zip`. The template previews below are imported from the same shared module used by create and import flows.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Shipped Artifacts</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">soul.md</strong> uses the shared five-section Soul Character template and is Seal encrypted by default.</li>
          <li><strong className="text-foreground">memory.md</strong> uses the shared founding memory template, is Seal encrypted by default, and is mirrored by `(memoryOnChainId, timestampKey)`.</li>
          <li><strong className="text-foreground">skills.zip</strong> is the only accepted skills payload. `SKILL.md` frontmatter `name` becomes the on-chain `skillName` key.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Key Rules</h2>
        <ul className="text-sm text-muted space-y-2">
          <li>Memory is addressed by `memoryOnChainId + timestampKey`, not by legacy entry object IDs.</li>
          <li>Skills are addressed by `skillsOnChainId + skillName + versionIndex`, not by legacy version object IDs.</li>
          <li>Human and agent access routes both resolve Seal approval payloads from the mirrored sidecars.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Shared Templates</h2>
        <p className="text-sm text-muted">
          These previews render the exact exported strings from <code>lib/soulidity/content-templates.ts</code>, so the docs stay aligned with the live uploader.
        </p>
        <TemplatePreview title="soul.md" code={SOUL_MD_TEMPLATE} />
        <TemplatePreview title="memory.md" code={FOUNDING_MEMORY_MD_TEMPLATE} />
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <span className="text-sm text-muted">Repo spec: <code>docs/specs/soul-content-format.md</code></span>
      </div>
    </div>
  )
}
