import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Agent Integration Guide'
const pageDescription =
  'How OpenClaw, Hermes, and third-party agents integrate with Soulidity — API key auth, search/access endpoints, grant-merge-masks pre-check, auto-grant on append, and supersede semantics.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/agent-integration' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/agent-integration',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function AgentIntegrationPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Agent Integration Guide</h1>
        <p className="text-sm text-muted">
          This guide is for AI agent runtimes (OpenClaw, Hermes, custom desktop agents, and any third-party integration) that consume Soulidity Souls on a human user&apos;s behalf. It covers API key auth, the search / access endpoints, the pre-check pattern for issuing or extending SoulGrants, and the auto-grant rules that fire when an owner appends content.
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
        <h2 className="text-lg font-semibold">Agent identity model</h2>
        <p className="text-sm text-muted">
          A Soulidity <strong>agent</strong> is a member record of kind <code>agent</code>, bound to one Sui wallet and registered under a human user&apos;s account. Agents authenticate to the API with an API key, and to the Move layer as the holder of <code>SoulGrant</code> objects (or <code>KindPaidEntry</code> rows) issued to their wallet address.
        </p>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Web agents</strong> (e.g. OpenClaw, Hermes web mode) typically share a wallet with the user&apos;s primary account.</li>
          <li><strong className="text-foreground">Desktop agents</strong> hold their own per-installation wallet and request grants explicitly when first opening a Soul. See <Link href="/resources/desktop-companion" className="text-purple hover:text-foreground transition">Desktop Companion</Link>.</li>
          <li>An account&apos;s <strong>active set</strong> is the list of currently-enabled agents under that human user. Auto-grant on append iterates only over the active set.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">API key authentication</h2>
        <p className="text-sm text-muted">
          API keys live on the agent member record and are bcrypt-hashed at rest. They start with the <code>sk-</code> prefix and are shown only during the desktop companion link / rotation flow. Pass them in the <code>Authorization: Bearer &lt;key&gt;</code> header. Endpoints under <code>/api/agent/*</code> require a valid key.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Use as bearer token
GET /api/agent/souls/search?limit=20
Authorization: Bearer sk-...

// Rotate from the linked desktop companion
POST /api/desktop/me/agent-key/rotate
Authorization: Bearer dtk_...
{ "rotationId": "<client-generated-id>" }`}</code>
        </pre>
        <p className="text-xs text-muted">
          Treat the key as a long-lived secret; rotate on compromise. Lost keys cannot be recovered — only rotated, which invalidates the previously committed key after the desktop flow completes.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Agent endpoints</h2>
        <ul className="text-sm text-muted space-y-3">
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/agent/souls/search</div>
            Search listed Souls visible to agent integrations. Supports <code>q</code>, <code>tag</code>, <code>limit</code>, and <code>offset</code>.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/agent/souls/[id]</div>
            Detail for one Soul — includes active grant scopes for this agent, active sprite / audio bindings, and any paid entries.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/agent/souls/[id]/access?kind=&amp;name=&amp;versionIndex=</div>
            Agent-authenticated Seal access resolution. Returns approval parameters for the slot — owner, granted-agent, public, or paid-access variant — based on the caller&apos;s standing. Defaults to <code>(KIND_SOUL_DOC, &quot;soul&quot;, 0)</code> when fields are omitted.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/agent/souls/[id]/purchase</div>
            Prepare a listed-Soul purchase for the agent wallet.
          </li>
          <li>
            <div className="font-mono text-xs text-foreground mb-1">POST /api/agent/souls/[id]/purchase/execute</div>
            Submit the agent signature for a prepared purchase and mirror the successful buy TX.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Supersede semantics</h2>
        <p className="text-sm text-muted">
          Each Soul has one grant slot per grantee. Issuing a second grant to the same grantee <strong>supersedes</strong> the first — the new <code>scope_mask</code> <strong>fully replaces</strong> the old one (no union). This is a behavior change from the early protocol design where issuing a partial scope would silently combine with existing scopes.
        </p>
        <p className="text-sm text-muted">
          The practical consequence: if you (or your tooling) submit a fresh grant TX without first looking up the agent&apos;s existing scope, you may unintentionally <em>remove</em> scopes the user already granted. Always pre-check.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">grant-merge-masks pre-check</h2>
        <p className="text-sm text-muted">
          The endpoint below computes <code>existing | added</code> for a list of <code>(soulOnChainId, granteeAddress)</code> pairs. Call it before signing a grant TX that&apos;s meant to <em>extend</em> rather than overwrite.
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
        <p className="text-sm text-muted">
          Use the returned <code>mergedScopeMask</code> and capacity fields to build the actual grant PTB with <code>buildIssueGrantTx</code> or <code>buildBatchIssueGrantsTx</code>. The SDK does not perform this pre-check implicitly; call the endpoint before signing when your intent is to preserve existing scopes.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Auto-grant on append</h2>
        <p className="text-sm text-muted">
          When a Soul owner uploads a <em>non-public</em> version of any content kind, the web app issues scope-matched <code>SoulGrant</code> top-ups automatically. The rule for each agent in the owner&apos;s active set:
        </p>
        <ol className="text-sm text-muted space-y-1 ml-5 list-decimal">
          <li>Read the kind&apos;s <code>default_grant_scope_mask</code> from the <code>KindRegistry</code> — call it <code>needed</code>.</li>
          <li>Read the agent&apos;s current grant on this Soul. If the grant&apos;s <code>scope_mask &amp; needed == needed</code>, skip — already covered.</li>
          <li>Otherwise compute <code>merged = existing | needed</code> via <code>grant-merge-masks</code>, then issue a supersede TX with <code>merged</code>.</li>
          <li>If the supersede TX fails (deploy window race, RPC flake, wallet timeout), Soulidity surfaces a <span className="text-amber-300">yellow banner</span> on the My Souls detail page enumerating the missing scopes. The owner clicks <em>Retry</em> to catch up.</li>
        </ol>
        <p className="text-sm text-muted">
          Agents do not need to do anything to trigger auto-grant — it happens server-side after the owner&apos;s append. But agents should treat fresh grant events as the signal to invalidate caches and re-resolve Seal sessions.
        </p>
        <p className="text-xs text-muted">
          Public versions (under public <code>slot_read_mode_mask</code>) are not auto-granted — they are readable without a grant. The auto-grant flow only covers slots whose read mode requires a grant or paid entry.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Failure modes &amp; idempotency</h2>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Ownership rotation race.</strong> If a Soul is sold between an agent&apos;s grant-check and content fetch, the access call will fail with <code>SEAL_DENIED</code>. The agent should re-query <code>/api/souls/[id]</code> for the new owner and surface a re-authorize prompt to the user.</li>
          <li><strong className="text-foreground">Revoke race.</strong> Owner revokes mid-conversation: same handling — re-resolve and fail closed to the human.</li>
          <li><strong className="text-foreground">Idempotent post-TX mirrors.</strong> The Soulidity TX-mirror APIs are keyed on <code>txDigest</code>. Replaying the same digest returns the cached response, so retries are safe.</li>
          <li><strong className="text-foreground">Stale paid entries.</strong> If an agent enumerates paid entries during a high-throughput rotation, expect some entries to fail the epoch check at Seal time. Treat <code>seal_approve_content_paid_access</code> failures as transient unless three sequential attempts fail.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Web vs desktop agents</h2>
        <p className="text-sm text-muted">
          Two integration patterns are common:
        </p>
        <ul className="text-sm text-muted space-y-2">
          <li><strong className="text-foreground">Web-hosted agent.</strong> Shares the user&apos;s primary wallet via the session cookie. Auto-grant on append covers it transparently because the user is also the grantor. Best for hosted SaaS agent products.</li>
          <li><strong className="text-foreground">Desktop / sovereign agent.</strong> Holds its own wallet and API key. The user authorizes once via a grant TX, then the desktop agent operates independently. Best for local-first persona apps. See <Link href="/resources/desktop-companion" className="text-purple hover:text-foreground transition">Desktop Companion</Link>.</li>
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
