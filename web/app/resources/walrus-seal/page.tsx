import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Walrus & Seal Integration'
const pageDescription =
  'How Soulidity encrypts content at rest on Walrus and gates access via Seal — unified content document IDs, sidecar structure, and the four Seal approval entries.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/walrus-seal' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/walrus-seal',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function WalrusSealPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Walrus &amp; Seal Integration</h1>
        <p className="text-sm text-muted">
          Soulidity stores every content blob — soul.md, memory entries, skill versions, sprites, audio — on <strong>Walrus</strong>, a decentralized blob storage network on Sui. Access is gated by <strong>Seal</strong>, which uses threshold-encrypted key shares released only after on-chain approval. This page documents the Phase 2 unified content encryption model.
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
        <h2 className="text-lg font-semibold">Encryption model</h2>
        <p className="text-sm text-muted">
          Content is encrypted client-side with a freshly generated 256-bit AES-GCM data encryption key (DEK). The DEK is threshold-encrypted by the Seal key-server network and can only be reconstructed by parties Seal approves on-chain.
        </p>
        <ol className="text-sm text-muted space-y-1.5 list-decimal ml-5">
          <li>Generate a random DEK + IV client-side.</li>
          <li>Encrypt the plaintext blob with AES-GCM-256.</li>
          <li>Upload the ciphertext to Walrus → receive a <code>blobId</code> and a registered <code>Blob</code> object on Sui.</li>
          <li>Bind the DEK + a SHA-256 content hash inside a Seal ciphertext, keyed by the slot&apos;s canonical document ID.</li>
          <li>Persist the Seal ciphertext, IV, file metadata, and content hash as a <strong>sidecar</strong> alongside the on-chain slot.</li>
        </ol>
        <p className="text-xs text-muted">
          Every slot keeps <code>seal_encrypted = true</code>. Public slots remain Seal-encrypted at rest — they use a separate public approval entry, not a bypass.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Unified content document ID</h2>
        <p className="text-sm text-muted">
          Phase 2 collapsed the per-channel document IDs (soul-seal, soul-memory, soul-skill) into a single deterministic format for every slot under <code>SoulContent</code>. The Move module verifies the exact byte layout with <code>==</code> (not <code>&gt;=</code>) for every <code>seal_approve_content_*</code> entry — any off-by-one length is rejected.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
          <code>{`"soul-content:"                 // 13-byte domain prefix
  + version_byte(1)            // document-id schema version
  + kind_be(4)                 // KindRegistry kind id, big-endian u32
  + content_object_id(32)      // SoulContent shared-object ID bytes
  + name_bytes(..)             // canonical name bytes for this kind/slot
  + 0x00                       // NUL terminator
  + version_index_be(8)        // slot version index, big-endian u64
  + nonce(16)                  // per-encrypt random nonce`}</code>
        </pre>
        <p className="text-xs text-muted">
          The TypeScript builder for this lives in <code>web/lib/soulidity/content-document-id.ts</code>. Always use it — hand-rolled clients risk byte-misalignment that the Move check will reject.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Seal approval entries</h2>
        <p className="text-sm text-muted">
          Four Seal-callable entries cover every read path. Each takes the document ID plus the typed-content references and either an owner-sender check, a SoulGrant object, an explicit public-mode check, or a per-(buyer, kind) paid-access lookup.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Module</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Function</th>
                <th className="text-left py-2 text-foreground font-semibold">Required slot read mode</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">content</td>
                <td className="py-2 pr-4 font-mono text-xs">seal_approve_content_owner</td>
                <td className="py-2 text-xs">READ_OWNER (mandatory on every slot)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">content</td>
                <td className="py-2 pr-4 font-mono text-xs">seal_approve_content_granted_agent</td>
                <td className="py-2 text-xs">READ_GRANT (+ SoulGrant covering slot&apos;s scope_mask)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">content</td>
                <td className="py-2 pr-4 font-mono text-xs">seal_approve_content_public</td>
                <td className="py-2 text-xs">READ_PUBLIC (slot keeps Seal encryption)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">paid_access</td>
                <td className="py-2 pr-4 font-mono text-xs">seal_approve_content_paid_access</td>
                <td className="py-2 text-xs">READ_PAID (+ KindPaidEntry with sufficient scope)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Slots cache <code>read_mode_mask</code> and <code>grant_scope_mask</code> at append time — the approval functions consult only those caches, never the registry. So a kind being later deprecated does not retroactively invalidate older slots&apos; approvals.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Scope-mask mapping for Seal</h2>
        <p className="text-sm text-muted">
          Granted-agent approval requires the <code>SoulGrant.scope_mask</code> to cover the slot&apos;s cached <code>grant_scope_mask</code>. Each built-in kind has a single grant-scope bit:
        </p>
        <ul className="text-sm text-muted space-y-1 font-mono">
          <li>KIND_SOUL_DOC (0) → SCOPE_SEAL (1)</li>
          <li>KIND_MEMORY (1) → SCOPE_MEMORY (2)</li>
          <li>KIND_SKILL (2) → SCOPE_SKILLS (4)</li>
          <li>KIND_SPRITE (3) → SCOPE_ASSETS (8)</li>
          <li>KIND_AUDIO (4) → SCOPE_ASSETS (8)</li>
        </ul>
        <p className="text-xs text-muted">
          The bit map is enforced by <code>kind_registry::assert_valid_default_grant_scope</code> at descriptor registration. Combined masks for a single kind are rejected. See <Link href="/resources/kind-registry" className="text-purple hover:text-foreground transition">Kind Registry</Link>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Sidecar structure</h2>
        <p className="text-sm text-muted">
          The sidecar is a JSON object stored alongside each slot. It contains everything the client needs to decrypt — excluding the DEK itself, which lives inside the Seal ciphertext.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`{
  encryptedDek: string,   // base64 — Seal ciphertext of DEK + contentHash
  iv: string,             // base64 — 12-byte AES-GCM IV
  cipher: "AES-GCM-256",
  fileName: string,
  mimeType: string,
  contentHash: string,    // hex — SHA-256 of plaintext; bound inside encryptedDek
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The <code>contentHash</code> is bound inside the Seal-encrypted DEK envelope (<code>DEK_BYTES || CONTENT_HASH_BYTES</code>). After decryption the client verifies the decrypted hash matches the sidecar hash, and verifies the plaintext SHA-256 matches the same value — preventing substitution attacks.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Client-side sidecar build</h2>
        <p className="text-sm text-muted">
          Mint and append flows encrypt in the browser, ask the wallet to pay Walrus storage, then build sidecar objects after the on-chain TX exposes the final <code>SoulContent</code> object ID. Mirror APIs verify and store the sidecars; they never receive raw DEKs.
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>The DEK and IV stay in browser memory plus short-lived recovery state until mirror sync succeeds.</li>
          <li>The Seal client encrypts the DEK under the canonical document ID bound to the newly minted slot.</li>
          <li>The mirror API rejects sidecars whose <code>encryptedDek</code> does not decrypt against the expected document ID at access time.</li>
          <li>Wallet signing does not start until the shared Walrus cost preview is confirmed.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Client decryption flow</h2>
        <ol className="text-sm text-muted space-y-1.5 list-decimal ml-5">
          <li>Call <code>GET /api/souls/[id]/content/[kind]/[name]/[versionIndex]/access</code> for the exact slot. The route returns the sidecar, Walrus blob URL, Seal server config, and an approval policy (module + function + required object IDs). The legacy <code>/api/souls/[id]/access</code> route resolves only the canonical Soul document.</li>
          <li>Create a <code>SessionKey</code> via <code>SessionKey.create</code>, sign the personal message with the viewer wallet.</li>
          <li>Build the approval transaction bytes matching the returned policy (one of the four <code>seal_approve_content_*</code> entries).</li>
          <li>Fetch the encrypted blob from Walrus.</li>
          <li>Call <code>SealClient.decrypt</code> with the sidecar <code>encryptedDek</code> — the Seal key servers verify the approval TX before releasing key shares.</li>
          <li>AES-GCM decrypt the blob with the recovered DEK + IV.</li>
          <li>Verify the plaintext SHA-256 matches the bound <code>contentHash</code>.</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/memory-architecture" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Memory Architecture →
        </Link>
      </div>
    </div>
  )
}
