import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Skills & Docs Revisions'
const pageDescription =
  'Phase 2 Soul skills under KIND_SKILL — skills.zip bundles indexed by name + version_index, public vs private visibility, soft delete, and the unified content access API.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/skills-revisions' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/skills-revisions',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function SkillsRevisionsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Skills &amp; Docs Revisions</h1>
        <p className="text-sm text-muted">
          Skills under Phase 2 live as <code>(kind=KIND_SKILL, name=&lt;skillName&gt;, version_index=N)</code> slots in the unified <code>SoulContent</code> object. Each skill name has its own independent version vector, with public vs private visibility chosen per version.
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
        <h2 className="text-lg font-semibold">On-chain shape</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// All versions of one skill:
items[ContentKey { kind: 2 /* KIND_SKILL */, name: "my-skill-name" }]
  → vector<ContentSlot>

// One version:
ContentSlot {
  version: u64,
  kind: 2,
  blob_object_id: ID,             // Walrus Blob
  is_public: bool,                // chosen per version at append
  deleted: bool,
  purged: bool,
  download_policy: u8,            // 0=public, 1=owner_only, 2=allowlist
  grant_scope_mask: 4,            // SCOPE_SKILLS
  read_mode_mask: OWNER | GRANT,
  op_mask: APPEND | DELETE | PURGE,
  seal_encrypted: true,
  created_at_ms: u64,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          <code>version_index</code> is the 0-based index into the slot vector. There is no shared <code>SoulSkills</code> object after Phase 2 — skills live alongside memory, sprites, audio, and soul.md under the single <code>SoulContent</code> root.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">ZIP-only upload</h2>
        <p className="text-sm text-muted">
          Skills must be uploaded as <code>.zip</code> archives. The upload validator enforces this before the Walrus upload. The ZIP root must contain a <code>SKILL.md</code> with a <code>name</code> front-matter field.
        </p>
        <div className="rounded-xl border border-border/70 bg-black/20 p-4 space-y-2">
          <div className="text-xs font-semibold text-foreground">Required: SKILL.md front-matter</div>
          <pre className="text-xs leading-6 text-foreground/90">
            <code>{`---
name: my-skill-name       # on-chain slot name (lowercase, digits, dash, underscore)
version: 1.0.0            # human-readable version label (not the index)
description: |
  What this skill does.
---

# Skill content here`}</code>
          </pre>
        </div>
        <p className="text-xs text-muted">
          The <code>name</code> front-matter becomes the on-chain slot name. Re-uploading the same name appends a new <code>version_index</code> on the same slot vector. A fresh name creates a new slot starting at <code>version_index = 0</code>. The human-readable <code>version</code> is informational only; canonical version is the on-chain index.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Public vs private visibility</h2>
        <p className="text-sm text-muted">
          Each version is individually marked <code>is_public</code> at append time. Built-in <code>KIND_SKILL</code> uses <code>read_mode_mask = OWNER | GRANT</code> — there is no <code>READ_PAID</code> or <code>READ_PUBLIC</code> on built-in skills, so visibility is binary on the slot via the <code>is_public</code> flag combined with <code>download_policy</code>:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Visibility</th>
                <th className="text-left py-2 text-foreground font-semibold">Access model</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">public</td>
                <td className="py-2 text-xs">Walrus blob URL returned directly. No Seal session required. The slot is still Seal-encrypted at rest with the owner Seal path always available.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">private</td>
                <td className="py-2 text-xs">Requires owner wallet or active SoulGrant with <code>SCOPE_SKILLS</code>. Client builds the approval TX and runs Seal decryption.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-1">
          Visibility is immutable per version. To change visibility you must append a new version with the desired setting.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Auto-grant on append (private versions)</h2>
        <p className="text-sm text-muted">
          When the owner appends a private skill version, Soulidity auto-issues scope-matched grants to every active agent that doesn&apos;t already cover <code>SCOPE_SKILLS</code>. Existing scopes are preserved via the <code>grant-merge-masks</code> pre-check. Failures surface on the My Souls page for retry — see <Link href="/resources/agent-integration" className="text-action-label hover:text-foreground transition">Agent Integration</Link>.
        </p>
        <p className="text-xs text-muted">
          Public versions are not auto-granted — they require no grant to read.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Soft delete &amp; hard purge</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Soft delete</strong> (<code>content::delete_version_as_owner</code> or <code>delete_version_as_granted_agent</code>) flips <code>deleted = true</code>. The version index is preserved; reads abort with <code>EVersionDeleted</code>.</li>
          <li><strong className="text-foreground">Hard purge</strong> (<code>content::purge_deleted_version_as_owner</code>) is owner-only and only valid after soft delete. It clears the on-chain blob pointer.</li>
          <li>Re-deleting an already-deleted slot aborts. Re-purging an already-purged slot aborts.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Skills access API</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`GET /api/souls/[id]/content/2/my-skill/N/access

// Public response
{
  visibility: "public",
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId }
}

// Private response
{
  visibility: "private",
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId },
  accessPolicy: {
    packageId,
    stateObjectId,
    contentObjectId,
    kind: 2,
    name: "my-skill",
    versionIndex: N,
    moduleName: "content",
    functionName:
      "seal_approve_content_owner"
      | "seal_approve_content_granted_agent",
    soulGrantObjectId: string | null,
    documentIdHex: string,
  },
  seal: { ... },
  sealSidecar: { ... },
  viewerAddress, accessKind, sessionTtlMin
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The content-slot access endpoint <code>/api/souls/[id]/content/[kind]/[name]/[versionIndex]/access</code> serves specific skill versions. The legacy <code>/api/souls/[id]/access</code> route resolves only the canonical Soul document at <code>(KIND_SOUL_DOC, &quot;soul&quot;, 0)</code>.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/wrap-link" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Wrap + Link →
        </Link>
      </div>
    </div>
  )
}
