import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'SoulGrant — Authorization API'
const pageDescription =
  'Issue, supersede, revoke, and expire SoulGrants. Scope bitmask, ownership-epoch invalidation, frozen chain snapshots, exact-byte recovery, and auto-grant on append.'

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
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
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
          Each Soul has one grant slot per grantee. Issuing a second grant to the same grantee <strong>fully replaces</strong> the previous <code>scope_mask</code> — the low-level Move operation does <em>not</em> union the two masks. The browser grant workflow reads and freezes the live merged mask before issuing; direct SDK callers must do the same when extending access.
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
        <h2 className="text-lg font-semibold">Browser grant management</h2>
        <p className="text-sm text-muted">
          The original Soul Grants form reads the current owner, epoch, physical grant slot, chain Clock, active count and capacity directly. New scopes are merged only with a live same-epoch grant; expired or old-owner scopes are not resurrected. A new grantee can raise capacity within the contract limit of 10,000.
        </p>
        <p className="text-sm text-muted">
          Readonly transaction checks bind those observations before any capacity or grant write. A concurrent scope, capacity or ownership change rejects the stale attempt. These checks do not grant permissions: the existing owner-only Move operations still enforce authorization. The form supports optional expiry, whole-grant revocation and explicit per-scope revocation.
        </p>
        <p className="text-sm text-muted">
          The account GrantModal can add a grantee without revoking anyone else. Replacing a selected grantee is an explicit two-transaction action; if the second action fails, the old grant remains revoked and recovery is shown.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Auto-grant on append</h2>
        <p className="text-sm text-muted">
          Private account discovery suggests addresses for the uploaded kind&apos;s required scope. The append plan checks those suggestions against raw live grants, merges current scopes, and places scope-preservation and capacity checks before the atomic content/grant writes. An unknown upload or transaction must be recovered before another attempt.
        </p>
        <p className="text-xs text-muted">
          Private wallet-to-Agent membership and pairing are still a separate cutover dependency. A failed discovery service is visible, not an empty agent list or permission to publish private membership. The remaining Pet workflow still has its own server pre-check; it is not used by the Soul grant form.
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
        <h2 className="text-lg font-semibold">Direct transactions and recovery</h2>
        <p className="text-sm text-muted">The browser persists the exact prepared transaction before requesting a signature, then persists and verifies the signed bytes before broadcast. Access changes &amp; recovery provides read-only original-result checks, explicit same-byte Resume, pre-sign cancellation and public receipt export. A later ownership or grant change does not erase the original transaction receipt.</p>
        <p className="text-xs text-muted">SDK integrations must compose the applicable snapshot checks and existing grant builders against one explicit deployment, use exact u64 values, and preserve unresolved transaction evidence. The removed human grant and capacity mirror routes are not a synchronization step.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Access resolution flow</h2>
        <p className="text-sm text-muted">
          The original content Open/Read controls now resolve the exact slot directly from verified chain data. They do not use a human access endpoint or SQL permission mirror. The connected wallet authorizes an explicit Seal personal-message session.
        </p>
        <ol className="text-sm text-muted space-y-1 list-decimal ml-5">
          <li>Fetch live <code>SoulState</code> from chain to get the current owner and the active grant table.</li>
          <li>Check the slot&apos;s matching read-mode bit for each channel: owner, scoped grant, paid, then public.</li>
          <li>Grant and paid access must match the current ownership epoch and remain unexpired against the chain Clock; a grant also needs its matching live slot and object.</li>
          <li>Build the exact <code>seal_approve_content_*</code> policy for the selected channel. Current public slots are also encrypted, not a plaintext fallback.</li>
          <li>Verify the per-version envelope and Blob, request explicit Seal approval, decrypt and verify the content hash, then recheck live authority before releasing bytes.</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/walrus-seal" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Walrus &amp; Seal →
        </Link>
      </div>
    </div>
  )
}
