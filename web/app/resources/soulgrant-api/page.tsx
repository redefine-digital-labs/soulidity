import Link from 'next/link'

export default function SoulGrantApiPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">SoulGrant — Authorization API</h1>
        <p className="text-sm text-muted">
          SoulGrant is the on-chain access delegation system for Soulidity. It lets the Soul owner authorize AI agents or other wallets to read Seal-protected content, append memory entries, or publish new skill versions — without transferring ownership.
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
        <h2 className="text-lg font-semibold">Scope Bitmask</h2>
        <p className="text-sm text-muted">
          Every grant carries a <code>scope_mask</code> — a bitfield that determines which Soul data channels the grantee can access. Scopes are additive and can be combined.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Constant</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Value</th>
                <th className="text-left py-2 text-foreground font-semibold">Grants access to</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_SEAL</td>
                <td className="py-2 pr-4 font-mono text-xs">1</td>
                <td className="py-2 text-xs">Decrypt the Soul content blob via Seal</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_MEMORY</td>
                <td className="py-2 pr-4 font-mono text-xs">2</td>
                <td className="py-2 text-xs">Read encrypted memory entries and append new ones</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">SCOPE_SKILLS</td>
                <td className="py-2 pr-4 font-mono text-xs">4</td>
                <td className="py-2 text-xs">Read private skill versions and publish new ones</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          To grant all three scopes, use <code>scope_mask = 7</code> (1 | 2 | 4). The Move module rejects a mask of 0 and any bits outside 1–4.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Grant Lifecycle</h2>
        <ul className="text-sm text-muted space-y-2">
          <li>
            <strong className="text-foreground">Issue:</strong> Owner calls <code>grant::issue</code> on-chain, passing the <code>SoulState</code>, grantee address, scope mask, and optional expiry timestamp in milliseconds. One grant slot per grantee is enforced — issuing a second grant to the same grantee supersedes the first. The default <code>grant_capacity</code> is 1.
          </li>
          <li>
            <strong className="text-foreground">Supersede (revoke-scope):</strong> Owner calls <code>grant::revoke_scope</code> to strip specific scope bits and issue a replacement grant in one atomic transaction. The event log records both <code>SoulGrantSuperseded</code> and a new <code>SoulGrantIssued</code>.
          </li>
          <li>
            <strong className="text-foreground">Revoke:</strong> Owner calls <code>grant::revoke</code> to remove a grantee&apos;s slot entirely. Emits <code>SoulGrantRevoked</code>.
          </li>
          <li>
            <strong className="text-foreground">Expiry:</strong> If <code>expires_at_ms</code> is set, the grant silently fails validation once the Sui clock passes that timestamp. Expired grants are cleaned up lazily on the next write operation. Emits <code>SoulGrantExpired</code>.
          </li>
          <li>
            <strong className="text-foreground">Ownership invalidation:</strong> All active grants are invalidated automatically when the Soul changes hands (buy, transfer). Each slot emits <code>SoulGrantInvalidated</code>. The <code>ownership_epoch_snapshot</code> on the grant object must match the current <code>SoulState.ownership_epoch</code> for validation to pass.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">On-Chain Object: SoulGrant</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct SoulGrant has key, store {
    id: UID,
    soul_id: ID,
    grantee: address,
    issued_by: address,
    ownership_epoch_snapshot: u64,  // invalidated on ownership transfer
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The <code>SoulGrant</code> object is transferred to the grantee wallet after <code>grant::issue</code>. The grantee must pass it as an argument to any guarded Move entry function. The <code>ownership_epoch_snapshot</code> must equal the current <code>SoulState.ownership_epoch</code> — any ownership rotation increments the epoch and invalidates all outstanding grants.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">REST API Endpoints</h2>
        <ul className="text-sm text-muted space-y-3">
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/souls/[id]/grant</div>
            Mirror a grant transaction after it succeeds on-chain. Required body fields:
            <ul className="mt-1 ml-4 space-y-1 text-xs list-disc">
              <li><code>txDigest</code> — the Sui transaction digest</li>
              <li><code>action</code> — <code>&quot;issue&quot;</code> | <code>&quot;revoke&quot;</code> | <code>&quot;revoke-scope&quot;</code></li>
              <li><code>granteeAddress</code> — required for revoke and revoke-scope actions</li>
            </ul>
            Returns <code>grantOnChainId</code>, <code>activeGrantCount</code>, and the TX digest. Idempotent — replaying the same <code>txDigest</code> returns the cached response.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/souls/[id]</div>
            The Soul detail response includes <code>activeGrantCount</code> from the DB mirror. To read live on-chain grant state use the Soulidity SDK query helpers.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Access Resolution Flow</h2>
        <p className="text-sm text-muted">
          When a viewer calls an access route (Soul content, memory, skills), the server runs <code>resolveSoulAccessPayload</code> / <code>resolveMemoryAccessPayload</code>:
        </p>
        <ol className="text-sm text-muted space-y-1 list-decimal ml-5">
          <li>Fetch live <code>SoulState</code> from chain to get the current owner and active grant list.</li>
          <li>If the viewer address matches the owner → issue <code>seal_approve_owner</code> approval params.</li>
          <li>Otherwise scan <code>activeGrants</code> for a slot whose <code>granteeAddress</code> matches and whose <code>scopes</code> includes the required scope.</li>
          <li>Fetch the <code>SoulGrant</code> object from chain and validate expiry and ownership epoch.</li>
          <li>If valid → issue <code>seal_approve_granted_agent</code> approval params with the grant object ID.</li>
          <li>The client uses these params to construct a Seal session key + approval transaction, then decrypts the blob client-side.</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/walrus-seal" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Walrus & Seal →
        </Link>
      </div>
    </div>
  )
}
