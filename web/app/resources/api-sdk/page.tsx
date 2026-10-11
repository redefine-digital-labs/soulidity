import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'API & SDK Reference'
const pageDescription =
  'Soulidity REST API and TypeScript SDK reference — content access, agent routes, grant-merge-masks, paid-access revoke mirroring, and the @soulidity/sdk module layout.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/api-sdk' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/api-sdk',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

type Method = 'GET' | 'POST'
type RouteRow = [Method, string, string]

const soulRoutes: RouteRow[] = [
  ['GET', '/api/souls/[id]', 'Get soul detail by on-chain object ID or DB slug.'],
  ['GET', '/api/souls/personal-kiosk', "Resolve the personal kiosk for the authenticated user's wallet."],
  ['POST', '/api/souls/publish', 'Mirror a publish TX. Body: txDigest + client-built Seal sidecar object(s) for every initial content slot. Returns soul + state + content mirror.'],
  ['POST', '/api/souls/[id]/list', 'Mirror a fixed-price list TX (atomic USDC).'],
  ['POST', '/api/souls/[id]/delist', 'Mirror a cancel-listing TX.'],
  ['POST', '/api/souls/[id]/purchase', 'Mirror a buy TX (kiosk transfer + fee split).'],
  ['POST', '/api/souls/grant-merge-masks', 'Remaining Pet workflow only; the Soul grant form uses direct chain snapshots and does not use this pre-check.'],
  ['GET', '/api/souls/[id]/access', "Legacy Soul document access. Resolves only (KIND_SOUL_DOC, 'soul', 0)."],
]

const agentRoutes: RouteRow[] = [
  ['GET', '/api/agent/souls/search', 'Search listed Souls visible to agent integrations. Supports q, tag, limit, and offset.'],
  ['GET', '/api/agent/souls/[id]', 'Soul detail visible to the agent — includes active grant state and paid entries for this agent.'],
  ['GET', '/api/agent/souls/[id]/access', 'Resolve a content slot for the authenticated agent. Query params: kind, name, versionIndex.'],
  ['POST', '/api/agent/souls/[id]/purchase', 'Prepare a listed-Soul purchase for the authenticated agent wallet.'],
  ['POST', '/api/agent/souls/[id]/purchase/execute', 'Submit the agent signature for a prepared purchase and mirror the successful buy TX.'],
]

export default function ApiSdkPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">API &amp; SDK Reference</h1>
        <p className="text-sm text-muted">
          Public Market discovery, wallet portfolios and content reads use chain-backed browser services and <code>@soulidity/sdk</code>. The remaining REST entries below identify integrations still being converted; they are not a completed static deployment interface.
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
        <h2 className="text-lg font-semibold">REST API — Soul routes</h2>
        <p className="text-sm text-muted">All routes are under <code>/api/souls/</code> in <code>web/app/api/souls/</code>.</p>
        <RouteList rows={soulRoutes} />
        <p className="text-sm text-muted">My Souls now reads the connected wallet’s registered Kiosk inventory, Collection rights and verified grant/purchase history directly. Its browser portfolio reader exposes independent scan progress, partial results and retry; it does not aggregate SQL account rows or require a public Profile.</p>
        <p className="text-sm text-muted">Specific content versions now open directly in the browser from verified chain slots and encrypted Walrus envelopes. The former human content-access endpoint has been removed. Remaining mutation and agent APIs are still being converted; this list is not a claim of completed backend removal.</p>
        <p className="text-sm text-muted">Market scans Soul and Collection candidates through bounded public chain discovery, verifies current raw objects, then filters, sorts and paginates the cumulative results. Tags come from verified listings; creator names and handles use public wallet Profiles. Partial scans and unavailable identities remain explicit. The former public Souls, tags and Collections list endpoints have been removed.</p>
        <p className="text-sm text-muted">Collection detail reads the requested chain ID and discovers its verified member Souls separately. The public detail endpoint and SQL identity DTOs are removed. Add-Soul preflight checks the raw creator and exact supply; CollectionRight ownership does not grant creator authority. Current reads are not transaction authorization or historical purchase proof.</p>
        <p className="text-sm text-muted">Collection Right purchases now save an exact transaction and full seller-plus-platform-fee quote before a separate signing action. Historical transaction, checkpoint and Kiosk custody proof establish success; current custody is refreshed separately. Unknown signed payments remain query-first across refreshes, wallet changes and releases. Public recovery can be exported or imported. The former Collection purchase mirror endpoint is removed; Collection creation and batch publishing are still being converted.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">REST API — Agent routes</h2>
        <p className="text-sm text-muted">Agent routes are under <code>/api/agent/</code>. Authentication uses an API key in the <code>Authorization: Bearer &lt;key&gt;</code> header. See <Link href="/resources/agent-integration" className="text-action-label hover:text-foreground transition">Agent Integration</Link>.</p>
        <RouteList rows={agentRoutes} />
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
          <code>{`// Use the desktop-issued agent key as a bearer token
GET /api/agent/souls/search?limit=20
Authorization: Bearer sk-...

// Resolve a specific content slot for the agent
GET /api/agent/souls/0x.../access?kind=3&name=memory&versionIndex=0
Authorization: Bearer sk-...`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">TypeScript SDK structure</h2>
        <p className="text-sm text-muted">
          The SDK is packaged as <code>@soulidity/sdk</code> (workspace package at <code>packages/soulidity-sdk</code>). Web app code imports from <code>web/lib/soulidity/</code> which re-exports the package.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">File</th>
                <th className="text-left py-2 text-foreground font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {[
                ['types.ts', 'All shared TypeScript types: SoulObject, SoulStateObject, SoulContentObject, SoulPaidAccessListObject, SoulGrantScope, access response shapes.'],
                ['kinds.ts', 'KIND_* / OP_* / READ_* constants and BUILTIN_KIND_DESCRIPTORS table mirroring kind_registry.move. Single client-side source of truth.'],
                ['content-document-id.ts', 'Canonical Seal document-id builder for SoulContent slots. Must match content::assert_matching_document_id byte-for-byte.'],
                ['content-version-pagination.ts', 'Cursor pagination over SoulContent versions for browsing memory / skill / sprite history.'],
                ['queries.ts', 'On-chain read helpers: getSoulStateObject, getSoulContentObject, getSoulPaidAccessListObject, getSoulGrantObject, getSuccessfulTransactionBlock.'],
                ['access.ts', 'resolveContentAccessPayload — owner / granted-agent / paid-access / public Seal access resolution for any SoulContent slot.'],
                ['events.ts', 'extractSoulGrantIssuedEvent, ContentVersionAppended, SoulPaidAccessGranted, etc. — parse Move events from TX blocks.'],
                ['repository.ts', 'DB query helpers: findSoulAssetDetailByRouteId, toSoulAssetDetail.'],
                ['server.ts', 'requireHumanWalletIdentity, assertTransactionSender — server-side auth guards.'],
                ['personal-kiosk.ts', 'resolvePersonalKiosk — on-chain kiosk lookup for a wallet address.'],
                ['tx/publish.ts', 'buildPublishSoulTx — native mint PTB builder.'],
                ['tx/personal-join.ts', 'buildPersonalJoinSoulTx — wrap+link PTB builder.'],
                ['tx/content.ts', 'buildAppendContentTx, buildSetActiveBindingTx, buildClearActiveBindingTx, buildDeleteContentVersionTx, buildPurgeContentVersionTx — unified PTBs for every kind.'],
                ['tx/paid-access.ts', 'buildConfigureKindPaidAccessTx, buildRecordPurchaseTx, buildAddPaidAccessTx, buildRevokePaidAccessTx — KindPaidConfig + KindPaidEntry PTBs.'],
                ['tx/mint-helpers.ts', 'Shared PTB primitives reused by publish / import / personal-join (Walrus blob refs, content envelope serialization).'],
                ['tx/grant.ts', 'buildIssueGrantTx, buildBatchIssueGrantsTx, buildRevokeGrantTx, buildBatchRevokeGrantsTx. Use grant-merge-masks first when preserving existing scopes.'],
                ['tx/buy.ts', 'buildBuySoulTx — purchase + kiosk transfer PTB.'],
                ['tx/list.ts, tx/delist.ts, tx/update-price.ts', 'Fixed-price listing PTBs (atomic USDC).'],
                ['mirror/', 'Server-side DB sync helpers — parse-content-sidecars, upsert-content-version, upsert-paid-access, tx-sync.'],
                ['content-templates.ts', 'SOUL_MD_TEMPLATE, FOUNDING_MEMORY_MD_TEMPLATE — single source for uploader scaffolds.'],
              ].map(([file, desc]) => (
                <tr key={file} className="border-b border-border/30">
                  <td className="py-2 pr-4 font-mono text-xs align-top whitespace-nowrap">{file}</td>
                  <td className="py-2 text-xs">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Key types</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Scope values
type SoulGrantScope = 'seal' | 'memory' | 'skills' | 'assets'

// Provenance
type SoulProvenanceKind = 'native' | 'imported' | 'personal-join'

// Access responses
type SoulAccessKind = 'owner' | 'granted-agent' | 'paid-access' | 'public'

// Grant lifecycle
type SoulGrantStatus = 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'

// SoulState from on-chain (queries.ts) — phase 2 unified content
interface SoulStateObject {
  objectId, packageId, soulId,
  creatorAddress, creatorRoyaltyBps,
  currentOwnerAddress, currentKioskId,
  ownershipEpoch, grantCapacity,
  activeGrantCount,
  activeGrants: ActiveGrantSlotObject[],
  contentId,         // → SoulContent (typed-content root)
  paidAccessListId,  // → SoulPaidAccessList (per-Soul 1:1)
  collectionId,
  isListed,
}

interface ActiveGrantSlotObject {
  grantId, granteeAddress,
  scopeMask: number,
  scopes: SoulGrantScope[],
  expiresAtMs: number | null,
  ownershipEpochSnapshot: number | null,
}`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Path aliases</h2>
        <p className="text-sm text-muted">
          The web app uses these aliases relevant to Soulidity work:
        </p>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">@/*</code> → <code>web/*</code> — local components, hooks, app routes</li>
          <li><code className="text-xs text-foreground">@web/*</code> → <code>web/*</code> — shared services (Walrus, Seal, Prisma, auth)</li>
          <li><code className="text-xs text-foreground">@soulidity/sdk</code> → <code>packages/soulidity-sdk</code> — workspace SDK package; re-exported under <code>web/lib/soulidity/</code></li>
        </ul>
        <p className="text-xs text-muted mt-1">
          The Prisma client is generated once at <code>generated/prisma/</code>, exposed through <code>src/db/prisma-client.ts</code>, and used from web via <code>@web/lib/prisma</code>. Run <code>npm run prisma:generate</code> after schema changes.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/agent-integration" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Agent Integration →
        </Link>
      </div>
    </div>
  )
}

function RouteList({ rows }: { rows: RouteRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map(([method, path, desc]) => (
        <div key={`${method}-${path}`} className="text-sm">
          <div className="flex items-start gap-2 mb-0.5">
            <span className={`font-mono text-xs px-1.5 py-0.5 rounded font-bold ${method === 'GET' ? 'bg-teal/15 text-teal' : 'bg-purple/15 text-action-label'}`}>{method}</span>
            <code className="text-xs text-foreground">{path}</code>
          </div>
          <p className="text-xs text-muted ml-14">{desc}</p>
        </div>
      ))}
    </div>
  )
}
