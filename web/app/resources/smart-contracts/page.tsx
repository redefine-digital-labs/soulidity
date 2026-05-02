import Link from 'next/link'

export default function SmartContractsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Smart Contract Reference</h1>
        <p className="text-sm text-muted">
          Soulidity is a set of Sui Move modules deployed under a single package. All state lives in shared objects. The DB is a mirror — on-chain is source of truth.
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
        <h2 className="text-lg font-semibold">Module Overview</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Module</th>
                <th className="text-left py-2 text-foreground font-semibold">Responsibility</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {[
                ['soul', 'Core Soul + SoulState shared object. Mint, ownership rotation, active grant list.'],
                ['metadata', 'SoulMetadata shared object. Active sprite/voice bindings + JSON ext blobs for desktop/web presentation.'],
                ['market', 'Personal-kiosk marketplace. Publish, list, delist, buy, import, personal-join.'],
                ['grant', 'SoulGrant delegation. Issue, revoke, scope-mask, expiry, invalidation on transfer.'],
                ['seal_policy', 'Seal approval entry functions for owner and granted-agent access to Soul and Memory blobs.'],
                ['memory', 'SoulMemory shared object. Append-only Table<u64, ID> with dynamic blob fields.'],
                ['skills', 'SoulSkills shared object. Table<String, vector<SkillSlot>> with private/public visibility.'],
                ['collection', 'SoulCollection shared object + SoulCollectionRight tradeable object.'],
              ].map(([mod, desc]) => (
                <tr key={mod} className="border-b border-border/30">
                  <td className="py-2 pr-4 font-mono text-xs align-top">{mod}</td>
                  <td className="py-2 text-xs">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Soul + SoulState</h2>
        <p className="text-sm text-muted">
          Every Soulidity asset is two objects: a <code>Soul</code> NFT held inside the owner&apos;s personal kiosk, and a shared <code>SoulState</code> that tracks ownership, grants, and bound sub-object IDs.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Held inside personal kiosk (kiosk::place / kiosk::take)
public struct Soul has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: String,
    protected_blob: Blob,          // Walrus Blob object (Seal-encrypted content)
    provenance_kind: u8,           // 0=native, 1=imported, 2=personal-join
    origin_ref: Option<String>,    // set for personal-join (source NFT type::id)
    creator: address,
}

// Shared object — readable by anyone, mutable by owner via grant module
public struct SoulState has key {
    id: UID,
    soul_id: ID,
    creator: address,
    creator_royalty_bps: u16,      // basis points, max 10 000
    current_owner: address,
    current_kiosk_id: ID,          // personal kiosk holding the Soul
    ownership_epoch: u64,          // increments on every ownership change
    grant_capacity: u64,           // max concurrent active grants
    active_grants: Table<address, ActiveGrantSlot>,
    active_grant_ids: Table<ID, address>,
    active_grant_count: u64,
    memory_id: Option<ID>,         // bound SoulMemory object ID
    metadata_id: Option<ID>,       // bound SoulMetadata object ID
    skills_id: Option<ID>,         // bound SoulSkills object ID
    collection_id: Option<ID>,     // bound SoulCollection object ID
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          Persona / voice presentation metadata now lives in a separate shared <code>SoulMetadata</code> object. The owner updates active bindings via <code>market::set_active_sprite</code> / <code>set_active_voice</code>; the lower-level active binding setters are package-only so every external update keeps the asset/type/policy checks.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulMemory</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Shared object — one per Soul
public struct SoulMemory has key {
    id: UID,
    soul_id: ID,
    entries: Table<u64, ID>,       // timestamp_key → blob_object_id
    entry_count: u64,
}
// Walrus Blob stored as dynamic object field keyed by MemoryBlobKey
public struct MemoryBlobKey has copy, drop, store { timestamp_key: u64 }`}</code>
        </pre>
        <p className="text-xs text-muted">
          Entries are addressed by their <code>timestamp_key</code> (milliseconds from <code>Clock</code>, collision-resolved by increment). Writer kinds: 0 = founder (at mint), 1 = owner, 2 = granted agent (requires SCOPE_MEMORY).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulSkills</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Shared object — one per Soul
public struct SoulSkills has key {
    id: UID,
    soul_id: ID,
    skills: Table<String, vector<SkillSlot>>,   // skillName → version history
    skill_count: u64,
}
public struct SkillSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    purged: bool,
    created_at_ms: u64,
}
// Walrus Blob stored as dynamic object field keyed by SkillBlobKey
public struct SkillBlobKey has copy, drop, store {
    skill_name: String,
    version_index: u64,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          Skills use append-only versioning. The <code>versionIndex</code> is the 0-based index into the slot vector. Soft delete sets <code>deleted = true</code>; owner purge burns the stored Walrus Blob and sets <code>purged = true</code>. Public versions are readable without a grant; private versions require SCOPE_SKILLS.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulCollection</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Shared object — one per collection
public struct SoulCollection has key {
    id: UID,
    creator: address,
    extra_royalty_bps: u16,        // stacked on top of per-Soul creator royalty
    tradeable: bool,               // whether the SoulCollectionRight can be transferred
    current_holder: address,
    current_holder_kiosk_id: ID,
    right_id: ID,
}
// Held inside holder's kiosk
public struct SoulCollectionRight has key, store { ... }`}</code>
        </pre>
        <p className="text-xs text-muted">
          Only the collection creator can add Souls (both creator and Soul creator must match). The <code>SoulCollectionRight</code> is a tradeable object that conveys the collection extra royalty claim.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Key Events</h2>
        <ul className="text-sm text-muted space-y-1.5">
          <li><code className="text-xs text-foreground">SoulCreated</code> — emitted by <code>market</code> after any mint variant (native, import, personal-join).</li>
          <li><code className="text-xs text-foreground">SoulOwnershipRotated</code> — emitted by <code>soul::rotate_owner</code> on every purchase or transfer. Increments <code>ownership_epoch</code>.</li>
          <li><code className="text-xs text-foreground">SoulGrantIssued / Revoked / Superseded / Expired / Destroyed</code> — grant rows are indexed by Table; ownership rotation uses epoch mismatch instead of per-grant invalidation events.</li>
          <li><code className="text-xs text-foreground">MemoryEntryAppended</code> — includes <code>timestamp_key</code>, <code>writer_kind</code>, and <code>blob_object_id</code>.</li>
          <li><code className="text-xs text-foreground">SkillVersionAppended / Deleted / Purged</code> — includes <code>skill_name</code>, <code>version_index</code>, and <code>is_public</code>.</li>
          <li><code className="text-xs text-foreground">ContentAccessGranted / Revoked / ScopeUpdated</code> — entries are epoch-pinned; stale rows can be cleaned permissionlessly.</li>
          <li><code className="text-xs text-foreground">SoulCollectionCreated / SoulAddedToCollection / CollectionHolderUpdated</code> — from <code>collection</code> module.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Provenance Kinds</h2>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">0 — native:</code> Fresh-deploy via <code>market::mint_native_in_personal_kiosk</code>. No prior NFT.</li>
          <li><code className="text-xs text-foreground">1 — imported:</code> Existing Walrus blob imported via <code>market::mint_imported_in_personal_kiosk</code>.</li>
          <li><code className="text-xs text-foreground">2 — personal-join:</code> An existing Sui NFT wrapped via <code>market::mint_joined_in_personal_kiosk</code>. The source NFT is placed into the personal kiosk first; <code>origin_ref</code> records the source type and object ID.</li>
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
