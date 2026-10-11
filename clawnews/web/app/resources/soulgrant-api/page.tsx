import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'SoulGrant — Authorization API'
const pageDescription =
  'Issue, supersede, revoke, and expire SoulGrants. Scope bitmask, ownership-epoch invalidation, grant-merge-masks pre-check, and auto-grant on append.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/soulgrant-api' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/soulgrant-api',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function SoulGrantApiPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">SoulGrant — Authorization API</h1>
        <p className="text-sm text-muted">
          SoulGrant is the on-chain access delegation system. It lets the Soul owner authorize AI agents or other wallets to decrypt the Soul bundle, read or append memory entries, publish skill versions, or manage private sprite / audio versions — without transferring ownership.
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
        <h2 className="text-lg font-semibold">Scope bitmask</h2>
        <p className="text-sm text-muted">
          Every grant carries a <code>scope_mask</code> — a bitfield that determines which Soul data channels the grantee can access. Each bit maps to one or more content kinds via <code>KindDescriptor.default_grant_scope_mask</code> (single-bit). Scope bits are combinable; <code>scope_mask = 0</code> and any unknown bits are rejected on issue.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Constant</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Value</th>
                <th className="text-left py-2 text-foreground font-semibold">Grants access to (kind → scope)</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_SEAL</td>
                <td className="py-2 pr-4 font-mono text-xs">1</td>
                <td className="py-2 text-xs">KIND_SOUL_DOC — decrypt the immutable soul.md bundle</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_MEMORY</td>
                <td className="py-2 pr-4 font-mono text-xs">2</td>
                <td className="py-2 text-xs">KIND_MEMORY — read memory entries and append new ones</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_SKILLS</td>
                <td className="py-2 pr-4 font-mono text-xs">4</td>
                <td className="py-2 text-xs">KIND_SKILL — read private skill versions and publish new ones</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_ASSETS</td>
                <td className="py-2 pr-4 font-mono text-xs">8</td>
                <td className="py-2 text-xs">KIND_SPRITE + KIND_AUDIO — read private persona versions and publish new ones</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          To grant all four scopes, use <code>scope_mask = 15</code>. The Move module rejects a mask of <code>0</code> and any bits outside these four. Admin-registered custom kinds <em>must</em> pick exactly one of the four scopes for their <code>default_grant_scope_mask</code>; combined masks are rejected at registration time.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Supersede semantics — full replacement, not union</h2>
        <p className="text-sm text-muted">
          Each Soul has one grant slot per grantee. Issuing a second grant to the same grantee <strong>fully replaces</strong> the previous <code>scope_mask</code> — Soulidity does <em>not</em> union the two masks. If you intend to extend an existing grant, you must compute the merged mask yourself first.
        </p>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Issue.</strong> Owner calls <code>grant::issue_to_grantee</code> with <code>SoulState</code>, grantee, <code>scope_mask</code>, optional <code>expires_at_ms</code>. Emits <code>SoulGrantIssued</code>.</li>
          <li><strong className="text-foreground">Supersede.</strong> Issuing a second grant to the same grantee transfers a fresh <code>SoulGrant</code> object to them, emits <code>SoulGrantSuperseded</code> + new <code>SoulGrantIssued</code>, and leaves the prior grant object invalidated (epoch snapshot mismatch) for storage reclaim by any caller.</li>
          <li><strong className="text-foreground">Revoke-scope.</strong> Owner calls <code>grant::revoke_scope_to_grantee</code> to strip specific scope bits and write a replacement grant in one atomic step.</li>
          <li><strong className="text-foreground">Revoke.</strong> Owner calls <code>grant::revoke</code> to remove a grantee&apos;s slot entirely. Emits <code>SoulGrantRevoked</code>.</li>
          <li><strong className="text-foreground">Expiry.</strong> If <code>expires_at_ms</code> is set, it must be in the future at issue time. Grants fail validation once the Sui clock reaches that timestamp.</li>
          <li><strong className="text-foreground">Ownership invalidation.</strong> Every grant is invalidated automatically when the Soul changes hands. The <code>ownership_epoch_snapshot</code> on the grant must equal the current <code>SoulState.ownership_epoch</code>; rotation bumps the epoch and lazily kills all grants. Reclaim storage rebate on dead grants via <code>grant::destroy_invalidated_grant</code> — any caller may invoke.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">grant-merge-masks pre-check</h2>
        <p className="text-sm text-muted">
          Because supersede replaces (not unions) scope, you must look up the agent&apos;s current mask before issuing a fresh grant if your intent is to extend access. The pre-check endpoint computes <code>existing | added</code> in one round-trip and returns the on-chain object to supersede.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`POST /api/souls/grant-merge-masks
{
  "items": [
    {
      "soulOnChainId": "0x...",
      "granteeAddress": "0x...",
      "addedScopeMask": 4    // SCOPE_SKILLS
    }
  ]
}
→ {
  "items": [
    {
      "soulOnChainId": "0x...",
      "granteeAddress": "0x...",
      "addedScopeMask": 4,
      "existingScopeMask": 2,   // pre-existing SCOPE_MEMORY
      "mergedScopeMask": 6,     // memory | skills
      "isNewGrantee": false,
      "currentCapacity": 16,
      "activeGrantCount": 3,
      "requiredCapacity": 16
    }
  ]
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          Use the returned <code>mergedScopeMask</code> and capacity fields to build the grant PTB with <code>buildIssueGrantTx</code> or <code>buildBatchIssueGrantsTx</code>. The SDK does not run this pre-check implicitly, so callers must invoke the endpoint before signing when they want to preserve existing scopes.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Auto-grant on append</h2>
        <p className="text-sm text-muted">
          When the Soul owner uploads a <em>non-public</em> version of any kind, Soulidity automatically issues scope-matched grants to every active agent on the owner&apos;s account that doesn&apos;t already cover the required scope. The merge is done with the same <code>grant-merge-masks</code> pre-check so existing scopes are preserved.
        </p>
        <ol className="text-sm text-muted space-y-1.5 ml-5 list-decimal">
          <li>Read the kind&apos;s <code>default_grant_scope_mask</code>.</li>
          <li>For each active agent on the account: skip if their existing scope already covers it.</li>
          <li>Compute <code>merged = existing | needed</code> and submit a supersede TX.</li>
          <li>On failure (deploy window race, RPC flake, wallet timeout), the Soul detail page surfaces a <span className="text-amber-300">yellow banner</span> enumerating missing scopes; the owner clicks <em>Retry</em>.</li>
        </ol>
        <p className="text-xs text-muted">
          Public slots are not auto-granted because they require no grant to read. See <Link href="/resources/agent-integration" className="text-purple hover:text-foreground transition">Agent Integration</Link> for the full rules.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">On-chain object: SoulGrant</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct SoulGrant has key, store {
    id: UID,
    version: u64,
    soul_id: ID,
    grantee: address,
    issued_by: address,
    ownership_epoch_snapshot: u64,  // invalidated on ownership transfer
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          <code>issue_to_grantee</code> transfers the <code>SoulGrant</code> object to the grantee wallet. The grantee must pass it as an argument to any guarded Move entry — content reads, memory appends, skill publishes. The <code>ownership_epoch_snapshot</code> must equal the current <code>SoulState.ownership_epoch</code>; ownership rotation bumps the epoch and lazily kills the grant without per-grant events.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">REST API endpoints</h2>
        <ul className="text-sm text-muted space-y-3">
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/souls/[id]/grant</div>
            Mirror a grant TX after it succeeds on-chain. Body: <code>txDigest</code>, <code>action</code> (<code>&quot;issue&quot;</code> | <code>&quot;revoke&quot;</code> | <code>&quot;revoke-scope&quot;</code>), and <code>granteeAddress</code> for revoke / revoke-scope. Idempotent on <code>txDigest</code>.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/souls/[id]/grant-capacity</div>
            Mirror a grant-capacity adjustment TX (raise the <code>SoulState.grant_capacity</code> ceiling).
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/souls/grant-merge-masks</div>
            Pre-check for <code>existing | added</code> across <code>(soulOnChainId, granteeAddress)</code> pairs. Returns merged masks and capacity planning fields.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/souls/[id]</div>
            Soul detail includes <code>activeGrantCount</code> from the DB mirror. For live on-chain grant state use the SDK <code>queries.ts</code> helpers.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Access resolution flow</h2>
        <p className="text-sm text-muted">
          When a viewer calls <code>GET /api/souls/[id]/content/[kind]/[name]/[versionIndex]/access</code>, the server runs <code>resolveContentAccessPayload</code> for that exact slot. The legacy <code>/api/souls/[id]/access</code> route resolves only the canonical Soul document at <code>(KIND_SOUL_DOC, &quot;soul&quot;, 0)</code>.
        </p>
        <ol className="text-sm text-muted space-y-1 list-decimal ml-5">
          <li>Fetch live <code>SoulState</code> from chain to get the current owner and the active grant table.</li>
          <li>If the viewer is the owner → return <code>seal_approve_content_owner</code> approval params.</li>
          <li>Else, if the slot&apos;s <code>read_mode_mask</code> permits <code>READ_PUBLIC</code> and the slot&apos;s <code>download_policy</code> is public → return <code>seal_approve_content_public</code> params.</li>
          <li>Else, look up a SoulGrant whose <code>scope_mask</code> includes the slot&apos;s cached <code>grant_scope_mask</code> → return <code>seal_approve_content_granted_agent</code> params (with the grant object ID).</li>
          <li>Else, look up an active <code>KindPaidEntry</code> for the viewer satisfying the same scope → return <code>seal_approve_content_paid_access</code> params.</li>
          <li>The client constructs a Seal session, builds the approval TX, and decrypts the blob client-side.</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/walrus-seal" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Walrus &amp; Seal →
        </Link>
      </div>
    </div>
  )
}
