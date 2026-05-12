import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Soul Memory Architecture'
const pageDescription =
  'Phase 2 Soul memory under KIND_MEMORY — single canonical name, append-only versions, auto-grant on append, soft delete and hard purge, immutability guarantees.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/memory-architecture' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/memory-architecture',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function MemoryArchitecturePage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Soul Memory Architecture</h1>
        <p className="text-sm text-muted">
          Soul memory under Phase 2 is the <code>(kind=KIND_MEMORY, name=&quot;default&quot;, version_index=N)</code> column of the unified <code>SoulContent</code> object. Each entry is a Seal-encrypted blob on Walrus, with an immutable on-chain pointer and a strict append + soft-delete + hard-purge lifecycle.
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
        <p className="text-sm text-muted">
          Memory lives as <code>ContentSlot</code> rows under the <code>SoulContent</code> object. There is no separate <code>SoulMemory</code> shared object after Phase 2.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// All memory versions for a Soul:
items[ContentKey { kind: 1 /* KIND_MEMORY */, name: "default" }]
  → vector<ContentSlot>

// One entry:
ContentSlot {
  version: u64,
  kind: 1,
  blob_object_id: ID,          // Walrus Blob
  is_public: false,            // memory is never public
  deleted: bool,
  purged: bool,
  download_policy: 1,          // OWNER_ONLY
  grant_scope_mask: 2,         // SCOPE_MEMORY
  read_mode_mask: OWNER | GRANT,
  op_mask: APPEND | DELETE | PURGE,
  seal_encrypted: true,
  created_at_ms: u64,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The canonical name for memory is <code>&quot;default&quot;</code>; the on-chain assertion <code>content::assert_canonical_name_for_kind</code> rejects any other name for <code>KIND_MEMORY</code>. The version index is the 0-based vector index — the first founding memory is <code>(1, &quot;default&quot;, 0)</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Writer paths</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Caller</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Entry</th>
                <th className="text-left py-2 text-foreground font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">creator at mint</td>
                <td className="py-2 pr-4 font-mono text-xs">market::mint_*</td>
                <td className="py-2 text-xs">Optional founding memory is appended as <code>(1, &quot;default&quot;, 0)</code> in the same PTB.</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs">owner</td>
                <td className="py-2 pr-4 font-mono text-xs">content::append_version_as_owner</td>
                <td className="py-2 text-xs">Pushes a new version. version_index is auto-incremented.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-xs">granted agent</td>
                <td className="py-2 pr-4 font-mono text-xs">content::append_version_as_granted_agent</td>
                <td className="py-2 text-xs">Requires <code>SoulGrant</code> with <code>SCOPE_MEMORY</code> (bit 2) covering this Soul.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Auto-grant on append</h2>
        <p className="text-sm text-muted">
          When the owner appends a new memory version, the web app issues scope-matched grants to every active agent that doesn&apos;t already cover <code>SCOPE_MEMORY</code>. Existing scopes are preserved via the <code>grant-merge-masks</code> pre-check; supersede is the on-chain mechanism. Failures surface as a yellow banner with retry — see <Link href="/resources/agent-integration" className="text-purple hover:text-foreground transition">Agent Integration</Link>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Always Seal-encrypted</h2>
        <p className="text-sm text-muted">
          Memory slots always have <code>read_mode_mask = OWNER | GRANT</code> and never include <code>READ_PUBLIC</code> or <code>READ_PAID</code>. There is no public-memory mode. Every entry is Seal-bound to the canonical Phase 2 document ID:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
          <code>{`"soul-content:" + version_byte(1) + kind_be(4 = 0x00000001)
  + content_object_id(32) + "default" + 0x00
  + version_index_be(8) + nonce(16)`}</code>
        </pre>
        <p className="text-xs text-muted">
          See <Link href="/resources/walrus-seal" className="text-purple hover:text-foreground transition">Walrus &amp; Seal</Link> for the universal doc-id format and approval entries.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Soft delete &amp; hard purge</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Soft delete</strong> (<code>content::delete_version_as_owner</code> or <code>delete_version_as_granted_agent</code>) flips <code>deleted = true</code> on the slot. The Walrus blob remains; reads abort with <code>EVersionDeleted</code>. <code>version_index</code> is preserved.</li>
          <li><strong className="text-foreground">Hard purge</strong> (<code>content::purge_deleted_version_as_owner</code>) is owner-only and only valid after soft delete. It clears the on-chain blob pointer entirely and emits <code>ContentVersionPurged</code>.</li>
          <li>Re-deleting an already-deleted slot aborts. Re-purging an already-purged slot aborts.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">DB mirror</h2>
        <p className="text-sm text-muted">
          After a successful TX, the API mirrors a <code>SoulContentVersionRecord</code> row keyed by <code>(soulId, contentId, kind, name, versionIndex)</code> with these key fields:
        </p>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">contentOnChainId</code> — the <code>SoulContent</code> shared-object ID</li>
          <li><code className="text-xs text-foreground">kind</code> — <code>1</code> for memory</li>
          <li><code className="text-xs text-foreground">name</code> — <code>&quot;default&quot;</code></li>
          <li><code className="text-xs text-foreground">versionIndex</code> — bigint / decimal string</li>
          <li><code className="text-xs text-foreground">writerAddress</code> — address that signed the append TX</li>
          <li><code className="text-xs text-foreground">writerKind</code> — <code>&quot;creator&quot;</code> | <code>&quot;owner&quot;</code> | <code>&quot;granted-agent&quot;</code></li>
          <li><code className="text-xs text-foreground">blobObjectId</code> — Sui object ID of the Walrus <code>Blob</code></li>
          <li><code className="text-xs text-foreground">blobId</code> — Walrus blob ID (used to build the download URL)</li>
          <li><code className="text-xs text-foreground">sealSidecar</code> — encrypted DEK envelope for client-side decryption</li>
          <li><code className="text-xs text-foreground">deletedAt</code> / <code className="text-xs text-foreground">purgedAt</code> — set by mirror writes on the respective TXs</li>
        </ul>
        <p className="text-xs text-muted mt-2">
          Memory entries are looked up by the triple <code>(kind, name, versionIndex)</code>. There is no legacy <code>timestampKey</code> addressing post-phase 2.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Memory access API</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`GET /api/souls/[id]/content/1/default/N/access

// Owner / granted-agent response (memory has no public or paid path)
{
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId },
  accessPolicy: {
    packageId,
    stateObjectId,
    contentObjectId,
    kind: 1,
    name: "default",
    versionIndex: N,
    moduleName: "content",
    functionName:
      "seal_approve_content_owner"
      | "seal_approve_content_granted_agent",
    soulGrantObjectId: string | null,
    documentIdHex: string,
  },
  seal: { network, threshold, serverConfigs, verifyKeyServers },
  sealSidecar: { encryptedDek, iv, cipher, fileName, mimeType, contentHash },
  viewerAddress: string,
  accessKind: "owner" | "granted-agent",
  sessionTtlMin: number,
}`}</code>
        </pre>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/skills-revisions" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Skills &amp; Revisions →
        </Link>
      </div>
    </div>
  )
}
