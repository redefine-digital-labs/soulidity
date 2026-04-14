import Link from 'next/link'

export default function ApiSdkPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">API & SDK Reference</h1>
        <p className="text-sm text-muted">
          Soulidity exposes REST API endpoints for post-TX mirroring, soul browsing, and access resolution — plus a TypeScript SDK in <code>web/lib/soulidity/</code> for transaction building, on-chain queries, and client-side decryption.
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
        <h2 className="text-lg font-semibold">REST API — Soul Routes</h2>
        <p className="text-sm text-muted">All routes are under <code>/api/souls/</code> in <code>web/app/api/souls/</code>.</p>
        <div className="space-y-3">
          {[
            ['GET', '/api/souls', 'Browse all public souls. Supports pagination, category, and tag filters.'],
            ['GET', '/api/souls/my', 'List souls owned by the authenticated user.'],
            ['GET', '/api/souls/categories', 'List available soul categories.'],
            ['GET', '/api/souls/[id]', 'Get soul detail by on-chain object ID or DB slug.'],
            ['POST', '/api/souls/publish', 'Mirror a publish TX. Body: txDigest + Seal envelope(s). Returns soul + state mirror.'],
            ['POST', '/api/souls/upload', 'Upload content files to Walrus and return blob object IDs + sealed DEK envelopes.'],
            ['GET', '/api/souls/personal-kiosk', 'Resolve the personal kiosk for the authenticated user\'s wallet.'],
            ['POST', '/api/souls/[id]/grant', 'Mirror a grant issue/revoke TX. See SoulGrant API docs.'],
            ['GET', '/api/souls/[id]/memory/[entryKey]/access', 'Resolve Seal access params for a memory entry.'],
            ['GET', '/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access', 'Resolve Seal access params for a private skill version.'],
          ].map(([method, path, desc]) => (
            <div key={path} className="text-sm">
              <div className="flex items-start gap-2 mb-0.5">
                <span className={`font-mono text-xs px-1.5 py-0.5 rounded font-bold ${method === 'GET' ? 'bg-teal/15 text-teal' : 'bg-purple/15 text-purple'}`}>{method}</span>
                <code className="text-xs text-foreground">{path}</code>
              </div>
              <p className="text-xs text-muted ml-14">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">REST API — Agent Routes</h2>
        <p className="text-sm text-muted">Agent-specific routes are under <code>/api/agent/</code> in <code>web/app/api/agent/</code>. Authentication uses an API key in the <code>Authorization: Bearer &lt;key&gt;</code> header.</p>
        <div className="space-y-3">
          {[
            ['POST', '/api/agent/api-key', 'Generate or rotate an API key for an agent member. Requires human auth and ownership of the agent account. Rate-limited to 1 rotation/hour per agent.'],
            ['GET', '/api/agent/souls', 'Search and list souls accessible to the authenticated agent.'],
            ['GET', '/api/agent/souls/[id]', 'Get soul detail visible to the agent (includes active grant state).'],
          ].map(([method, path, desc]) => (
            <div key={path} className="text-sm">
              <div className="flex items-start gap-2 mb-0.5">
                <span className={`font-mono text-xs px-1.5 py-0.5 rounded font-bold ${method === 'GET' ? 'bg-teal/15 text-teal' : 'bg-purple/15 text-purple'}`}>{method}</span>
                <code className="text-xs text-foreground">{path}</code>
              </div>
              <p className="text-xs text-muted ml-14">{desc}</p>
            </div>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
          <code>{`// Generate API key (human-authenticated)
POST /api/agent/api-key
{ "agentMemberId": "<uuid>" }
→ { "apiKey": "snk_..." }

// Use API key as bearer token
GET /api/agent/souls
Authorization: Bearer snk_...`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">TypeScript SDK Structure</h2>
        <p className="text-sm text-muted">All SDK files live in <code>web/lib/soulidity/</code>.</p>
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
                ['types.ts', 'All shared TypeScript types: SoulObject, SoulStateObject, SoulGrantScope, access response shapes, etc.'],
                ['queries.ts', 'On-chain read helpers: getSoulStateObject, getSoulGrantObject, getSuccessfulTransactionBlock.'],
                ['access.ts', 'resolveSoulAccessPayload — owner vs granted-agent Seal access resolution for Soul content.'],
                ['memory-access.ts', 'resolveMemoryAccessPayload — same pattern for memory entry access.'],
                ['skill-access.ts', 'fetchSkillAccess + loadDecryptedPrivateSkillVersion — full client-side decryption flow for private skills.'],
                ['events.ts', 'extractSoulGrantIssuedEvent, extractSoulGrantRevokedEvent, etc. — parse Move events from TX blocks.'],
                ['repository.ts', 'DB query helpers: findSoulAssetDetailByRouteId, toSoulAssetDetail.'],
                ['server.ts', 'requireHumanWalletIdentity, assertTransactionSender — server-side auth guards.'],
                ['personal-kiosk.ts', 'resolvePersonalKiosk — on-chain kiosk lookup for a wallet address.'],
                ['tx/publish.ts', 'buildPublishSoulTx — native mint PTB builder.'],
                ['tx/personal-join.ts', 'buildPersonalJoinSoulTx — wrap+link PTB builder.'],
                ['tx/grant.ts', 'buildIssueSoulGrantTx, buildRevokeSoulGrantTx.'],
                ['tx/buy.ts', 'buildBuySoulTx — purchase + kiosk transfer PTB.'],
                ['tx/memory.ts', 'buildAppendMemoryTx — append memory entry PTB.'],
                ['tx/skills.ts', 'buildAppendSkillVersionTx, buildDeleteSkillVersionTx.'],
                ['mirror/', 'Server-side DB sync helpers — sync-helpers.ts, build-seal-sidecars.ts, tx-sync.ts.'],
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
        <h2 className="text-lg font-semibold">Key Types</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Scope values
type SoulGrantScope = 'seal' | 'memory' | 'skills' | 'assets'

// Provenance
type SoulProvenanceKind = 'native' | 'imported' | 'personal-join'

// Access responses
type SoulAccessKind = 'owner' | 'granted-agent'

// Grant lifecycle
type SoulGrantStatus = 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'

// SoulState from on-chain (queries.ts)
interface SoulStateObject {
  objectId, packageId, soulId,
  creatorAddress, creatorRoyaltyBps,
  currentOwnerAddress, currentKioskId,
  ownershipEpoch, grantCapacity,
  activeGrantCount,
  activeGrants: ActiveGrantSlotObject[],
  memoryId, skillsId, collectionId,
}

interface ActiveGrantSlotObject {
  grantId, granteeAddress,
  scopeMask: number,
  scopes: SoulGrantScope[],
  expiresAtMs: number | null,
}`}</code>
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Path Aliases</h2>
        <p className="text-sm text-muted">
          <code>web</code> uses two aliases relevant to Soulidity work:
        </p>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">@/*</code> → <code>web/*</code> — local SDK, components, hooks</li>
          <li><code className="text-xs text-foreground">@web/*</code> → <code>web/*</code> — shared services (Walrus, Seal, Prisma, auth)</li>
        </ul>
        <p className="text-xs text-muted mt-1">
          The Prisma client is generated at <code>web/generated/prisma/</code> and imported via <code>@web/lib/prisma</code>. Run <code>npm --prefix web run prisma:generate</code> after schema changes.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
      </div>
    </div>
  )
}
