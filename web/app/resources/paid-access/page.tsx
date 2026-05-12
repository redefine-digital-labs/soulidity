import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Paid Access'
const pageDescription =
  'How SoulPaidAccessList works on Soulidity — 1:1 per Soul, per-kind configs, owner-revocable subscriptions, no refunds, ownership-epoch auto-invalidation, stale-entry cleanup.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/paid-access' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/paid-access',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function PaidAccessPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Paid Access</h1>
        <p className="text-sm text-muted">
          Paid access lets viewers buy time-bound (or lifetime) USDC access to specific Soul content kinds. This page documents the on-chain model and the owner / buyer / cleanup paths.
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

      <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5 space-y-2">
        <h2 className="text-base font-semibold text-amber-300">Read this first: paid access is owner-revocable, non-refundable</h2>
        <p className="text-sm text-foreground">
          The Soul owner may revoke a buyer&apos;s access at any time by calling <code>paid_access::revoke_access</code>. No on-chain refund is issued. Entries also auto-invalidate when the Soul changes hands. Any UI taking payment for a kind <strong>must</strong> disclose this revocability and non-refundability — see <Link href="/terms" className="text-purple hover:text-foreground transition">Terms</Link>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">The 1:1 SoulPaidAccessList model</h2>
        <p className="text-sm text-muted">
          Every Soul minted on phase 2 has exactly one <code>SoulPaidAccessList</code> shared object, created at mint and bound to the Soul via <code>SoulState.access_list_id</code>. It holds:
        </p>
        <ul className="text-sm text-muted space-y-2 ml-5 list-disc">
          <li>A <code>kind_configs: Table&lt;u32, KindPaidConfig&gt;</code> — one config per kind the owner has opened up to paid access. Configs are added with <code>configure_paid_access_kind</code> and removed with <code>delete_paid_access_kind</code>.</li>
          <li>An <code>entries: Table&lt;address, Table&lt;u32, KindPaidEntry&gt;&gt;</code> — buyer rows, keyed by address then by kind. Inner rows are created lazily on first purchase and reaped when emptied.</li>
        </ul>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct KindPaidConfig has copy, drop, store {
    version: u64,
    price_atomic: u64,
    scope_mask: u64,            // pinned to kind's default_grant_scope_mask
    duration_ms: Option<u64>,   // None = lifetime
    ownership_epoch_snapshot: u64,
}

public struct KindPaidEntry has copy, drop, store {
    version: u64,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Which kinds support paid access</h2>
        <p className="text-sm text-muted">
          Paid access only applies to kinds whose <code>read_mode_mask</code> includes <code>READ_PAID</code>. Among the five built-in kinds:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Kind</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">READ_PAID</th>
                <th className="text-left py-2 text-foreground font-semibold">Scope on purchase</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">soul_doc</td>
                <td className="py-2 pr-4 text-xs">❌</td>
                <td className="py-2 text-xs">—</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">memory</td>
                <td className="py-2 pr-4 text-xs">❌</td>
                <td className="py-2 text-xs">—</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">skill</td>
                <td className="py-2 pr-4 text-xs">❌</td>
                <td className="py-2 text-xs">—</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">sprite</td>
                <td className="py-2 pr-4 text-xs">✅</td>
                <td className="py-2 text-xs font-mono">SCOPE_ASSETS (8)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">audio</td>
                <td className="py-2 pr-4 text-xs">✅</td>
                <td className="py-2 text-xs font-mono">SCOPE_ASSETS (8)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Custom kinds registered through <code>kind_registry::register_kind</code> may opt into <code>READ_PAID</code> (admin-only registration). See <Link href="/resources/kind-registry" className="text-purple hover:text-foreground transition">Kind Registry</Link>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Purchase flow</h2>
        <ol className="text-sm text-muted space-y-2 ml-5 list-decimal">
          <li>Owner configures the kind with <code>configure_paid_access_kind</code>: price in atomic USDC, scope mask (must equal the kind&apos;s <code>default_grant_scope_mask</code>), and an optional <code>duration_ms</code>. The config snapshots the current ownership epoch.</li>
          <li>Buyer signs a purchase TX. The market module splits USDC (platform fee + creator royalty + optional collection royalty) and calls <code>paid_access::record_purchase</code> internally.</li>
          <li><code>record_purchase</code> asserts the config&apos;s epoch matches the current epoch (rejecting purchases against a stale config from a previous owner), computes the new <code>expires_at_ms</code> from the renewal base, and writes a fresh <code>KindPaidEntry</code> under the buyer&apos;s row.</li>
          <li>The post-TX API mirrors the entry into <code>SoulPaidAccessEntry</code> for the My Souls UI and any indexers.</li>
        </ol>
        <p className="text-sm text-muted">
          Free access can be granted by the owner via <code>paid_access::add_access</code>, which writes the same entry shape with <code>price_paid_atomic = 0</code> and a <code>SoulPaidAccessGranted</code> event.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Renewal &amp; expiry</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Time-bound entry.</strong> When <code>duration_ms</code> is <code>Some(d)</code>, the entry&apos;s <code>expires_at_ms = renewal_base + d</code>. The renewal base is <code>max(now, previous_expires_at_ms)</code> — re-purchasing before expiry extends from the existing end, not from <em>now</em>.</li>
          <li><strong className="text-foreground">Lifetime entry.</strong> When <code>duration_ms</code> is <code>None</code>, the entry has no expiry and a re-purchase aborts with <code>EAlreadyHasAccess</code> — there is nothing to renew.</li>
          <li><strong className="text-foreground">Stale-epoch overwrite.</strong> If the entry pre-dates the current ownership epoch, the buyer&apos;s next purchase overwrites it instead of aborting — the old entry was already invalidated.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Owner revoke</h2>
        <p className="text-sm text-muted">
          <code>paid_access::revoke_access(grantee, kind)</code> removes the buyer&apos;s entry and emits <code>SoulPaidAccessRevoked</code>. Subsequent <code>seal_approve_content_paid_access</code> calls for that buyer fail until they re-purchase. The owner may also <code>content::delete_*</code> or <code>purge_*</code> the underlying slot, which makes the entry useless even without explicit revoke.
        </p>
        <p className="text-sm text-muted">
          No on-chain refund rail exists. Any refund or credit policy must be handled off-chain. If you intend to offer guaranteed-term access, build a slot-level delete lock and an explicit refund path into your front-end — the protocol does not enforce one.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Ownership-epoch auto-invalidation</h2>
        <p className="text-sm text-muted">
          Every <code>KindPaidEntry</code> snapshots <code>ownership_epoch</code> at write time. <code>has_access</code> and <code>seal_approve_content_paid_access</code> require the snapshot to equal the Soul&apos;s current <code>ownership_epoch</code>, so all entries auto-invalidate when the Soul changes hands. The new owner inherits an effectively-empty list. Buyers can re-purchase under the new owner, which overwrites the stale row.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Stale-entry cleanup</h2>
        <p className="text-sm text-muted">
          Invalidated entries hold no value; reaping them reclaims storage rebate. <code>paid_access::cleanup_stale_entries</code> is <strong>callable by anyone</strong> and takes parallel <code>vector&lt;address&gt;</code> + <code>vector&lt;u32&gt;</code> arguments. It removes entries whose snapshot is stale, and drops the outer buyer row when its inner table is empty. Indexers and bots typically run a periodic cleanup pass after high-volume ownership rotations.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Paid access vs SoulGrant</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">&nbsp;</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">SoulGrant</th>
                <th className="text-left py-2 text-foreground font-semibold">Paid access</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs font-semibold">Issued by</td>
                <td className="py-2 pr-4 text-xs">Soul owner</td>
                <td className="py-2 text-xs">Anyone buying (with config in place); owner via add_access</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs font-semibold">Payment</td>
                <td className="py-2 pr-4 text-xs">No (free delegation)</td>
                <td className="py-2 text-xs">Yes (atomic USDC, split by fees)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs font-semibold">Storage</td>
                <td className="py-2 pr-4 text-xs">Per-grantee object</td>
                <td className="py-2 text-xs">Per-(buyer, kind) row in shared list</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs font-semibold">Scope</td>
                <td className="py-2 pr-4 text-xs">Multi-bit (seal | memory | skills | assets)</td>
                <td className="py-2 text-xs">Single bit, pinned to kind&apos;s default_grant_scope_mask</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 text-xs font-semibold">Owner revoke</td>
                <td className="py-2 pr-4 text-xs">Yes</td>
                <td className="py-2 text-xs">Yes (no refund)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-xs font-semibold">Auto-invalidation</td>
                <td className="py-2 pr-4 text-xs">Ownership epoch</td>
                <td className="py-2 text-xs">Ownership epoch + expiry</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">REST API</h2>
        <ul className="text-sm text-muted space-y-2">
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/souls/[id]/paid-access</div>
            Mirror an owner revoke paid-access TX. Body includes <code>action: &quot;revoke&quot;</code>, <code>txDigest</code>, <code>buyerAddress</code>, and <code>kind</code>. The route is idempotent on digest.
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/soulgrant-api" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: SoulGrant API →
        </Link>
      </div>
    </div>
  )
}
