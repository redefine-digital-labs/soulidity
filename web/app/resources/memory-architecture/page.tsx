import Link from 'next/link'

export default function MemoryArchitecturePage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Soul Memory Architecture</h1>
        <p className="text-sm text-muted">
          Soul Memory is an append-only, timestamp-indexed log of encrypted blobs on Walrus. Each entry is permanently anchored on-chain. Entries cannot be deleted or modified after writing.
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
        <h2 className="text-lg font-semibold">On-Chain Structure</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Shared object — one per Soul, bound at mint
public struct SoulMemory has key {
    id: UID,
    soul_id: ID,
    entries: Table<u64, ID>,      // timestamp_key (ms) → blob_object_id
    entry_count: u64,
}

// Walrus Blob stored as dynamic object field
public struct MemoryBlobKey has copy, drop, store {
    timestamp_key: u64,
}`}</code>
        </pre>
        <p className="text-sm text-muted">
          The <code>entries</code> table maps a <code>timestamp_key</code> (milliseconds from the Sui clock at write time) to the Walrus <code>Blob</code> object ID. If two entries land in the same millisecond, the contract increments the key until it finds a free slot. The <code>Blob</code> object itself is stored as a dynamic object field under <code>MemoryBlobKey</code>, making it inspectable on-chain.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Writer Kinds</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Kind</th>
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Value</th>
                <th className="text-left py-2 text-foreground font-semibold">Who</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">founder</td>
                <td className="py-2 pr-4 font-mono text-xs">0</td>
                <td className="py-2 text-xs">Called during mint — the creator&apos;s founding memory entry</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">owner</td>
                <td className="py-2 pr-4 font-mono text-xs">1</td>
                <td className="py-2 text-xs">Soul owner appending via <code>memory::append_as_owner</code></td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">granted-agent</td>
                <td className="py-2 pr-4 font-mono text-xs">2</td>
                <td className="py-2 text-xs">Agent with active SCOPE_MEMORY grant via <code>memory::append_as_granted_agent</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          The <code>MemoryEntryAppended</code> event records <code>writer_kind</code>, <code>writer</code> address, <code>timestamp_key</code>, and <code>blob_object_id</code>. The DB mirrors these from the event log.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Encrypted by Default</h2>
        <p className="text-sm text-muted">
          All memory entries are Seal-encrypted at upload time. The document ID is bound to the <code>SoulMemory</code> object ID and the <code>timestamp_key</code>:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
          <code>{`"soul-memory:" + version_byte(1) + memory_id_bytes(32) + timestamp_key_be(8) + nonce(16)`}</code>
        </pre>
        <p className="text-sm text-muted">
          This means only the Soul owner (or a holder of an active SCOPE_MEMORY grant) can decrypt any entry. There is no public memory mode.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">DB Mirror Fields</h2>
        <p className="text-sm text-muted">
          After a successful on-chain append, the API mirrors a <code>SoulMemoryEntry</code> row with these key fields:
        </p>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">memoryOnChainId</code> — the <code>SoulMemory</code> shared object ID</li>
          <li><code className="text-xs text-foreground">timestampKey</code> — the on-chain table key (bigint, stored as decimal string in JSON)</li>
          <li><code className="text-xs text-foreground">writerAddress</code> — the address that signed the append TX</li>
          <li><code className="text-xs text-foreground">writerKind</code> — <code>&quot;founder&quot;</code> | <code>&quot;owner&quot;</code> | <code>&quot;granted-agent&quot;</code></li>
          <li><code className="text-xs text-foreground">blobObjectId</code> — Sui object ID of the Walrus <code>Blob</code></li>
          <li><code className="text-xs text-foreground">blobId</code> — Walrus blob ID (used to build the download URL)</li>
          <li><code className="text-xs text-foreground">sealSidecar</code> — encrypted DEK envelope for client-side decryption</li>
        </ul>
        <p className="text-xs text-muted mt-2">
          The entry is looked up by <code>(memoryOnChainId, timestampKey)</code> — not by a legacy entry object ID. This is the canonical addressing scheme.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Memory Access API</h2>
        <ul className="text-sm text-muted space-y-2">
          <li>
            <div className="font-mono text-xs text-foreground mb-1">GET /api/souls/[id]/memory/[entryKey]/access</div>
            Returns a <code>MemoryAccessResponse</code> containing the Walrus blob URL, sidecar, Seal server config, and approval policy. The <code>entryKey</code> path segment is the decimal <code>timestamp_key</code>.
          </li>
          <li>
            The route validates the viewer identity from the wallet session or agent API key, checks rate limits (30 req/min), and resolves the access via <code>resolveMemoryAccessPayload</code> — which fetches live <code>SoulState</code> from chain to verify ownership or active grant.
          </li>
          <li>
            Credentialed Seal server configs are not permitted for browser access. Server-side agent access uses a separate code path.
          </li>
        </ul>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Access response shape
{
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId },
  accessPolicy: {
    packageId, stateObjectId, memoryObjectId, timestampKey,
    moduleName: "seal_policy",
    functionName: "seal_approve_memory_owner" | "seal_approve_memory_granted_agent",
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
          Next: Skills & Revisions →
        </Link>
      </div>
    </div>
  )
}
