import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Smart Contract Reference'
const pageDescription =
  'Phase 2 Soulidity Move modules — content, kind_registry, paid_access, grant, soul, market, collection. Object schemas, key events, and structural invariants.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/smart-contracts' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/smart-contracts',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function SmartContractsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Smart Contract Reference</h1>
        <p className="text-sm text-muted">
          Soulidity is a set of Sui Move modules deployed under a single package. All state lives in shared objects. The DB is a mirror — on-chain is the source of truth. Phase 2 (mainnet 2026-05-04) collapsed the legacy <code>metadata</code> / <code>memory</code> / <code>skills</code> / <code>seal_policy</code> / <code>content_access</code> modules into the unified <code>content</code> + <code>kind_registry</code> + <code>paid_access</code> trio.
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
        <h2 className="text-lg font-semibold">Module overview</h2>
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
                ['soul', 'Core Soul + SoulState shared object. Mint, ownership rotation, active grant list, listed flag, config_ext.'],
                ['content', 'Typed-content matrix root (SoulContent). Every kind / name / version_index slot, active bindings, append / delete / purge / set_active, and Seal approval entries.'],
                ['kind_registry', 'KindRegistry shared object with built-in kinds (SOUL_DOC / MEMORY / SKILL / SPRITE / AUDIO) and admin path for custom kinds. KindDescriptor immutability is enforced here.'],
                ['paid_access', 'SoulPaidAccessList per Soul (1:1). KindPaidConfig per kind + KindPaidEntry per (buyer, kind). Owner-revocable, no refund.'],
                ['grant', 'SoulGrant delegation. Issue, supersede (replace scope), revoke, expire, ownership-epoch invalidation, destroy_invalidated_grant for storage rebate.'],
                ['market', 'Personal-kiosk marketplace. Mint variants (native / imported / personal-join), fixed-price listing, buy + fee split, set_state_config.'],
                ['collection', 'SoulCollection shared object + SoulCollectionRight tradeable. On-chain max_supply cap, extra royalty, mutually exclusive with active listing.'],
              ].map(([mod, desc]) => (
                <tr key={mod} className="border-b border-border/30">
                  <td className="py-2 pr-4 font-mono text-xs align-top">{mod}</td>
                  <td className="py-2 text-xs">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          See <Link href="/resources/kind-registry" className="text-purple hover:text-foreground transition">Kind Registry</Link> for the descriptor schema and <Link href="/resources/paid-access" className="text-purple hover:text-foreground transition">Paid Access</Link> for purchase / revoke / cleanup details.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Soul + SoulState</h2>
        <p className="text-sm text-muted">
          Every Soulidity asset is two objects: a <code>Soul</code> NFT held inside the owner&apos;s personal kiosk, and a shared <code>SoulState</code> that tracks ownership, grants, the content root, the paid-access list, and configuration blobs.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`// Held inside personal kiosk (kiosk::place / kiosk::take)
public struct Soul has key, store {
    id: UID,
    version: u64,
    name: String,
    description: String,
    image_url: String,
    provenance_kind: u8,           // 0=native, 1=imported, 2=personal-join
    origin_ref: Option<String>,    // set for personal-join (source NFT type::id)
    creator: address,
}

// Shared object — readable by anyone, mutable by owner / market / paid_access
public struct SoulState has key {
    id: UID,
    version: u64,
    soul_id: ID,
    creator: address,
    creator_royalty_bps: u16,
    current_owner: address,
    current_kiosk_id: ID,
    ownership_epoch: u64,          // bumps on every ownership change
    grant_capacity: u64,
    active_grants: Table<address, ActiveGrantSlot>,
    active_grant_ids: Table<ID, address>,
    active_grant_count: u64,
    content_id: Option<ID>,        // → SoulContent (bound once at mint)
    config_ext: Table<String, vector<u8>>,  // sprite_config_json etc.
    collection_id: Option<ID>,
    access_list_id: Option<ID>,    // → SoulPaidAccessList (bound once at mint)
    is_listed: bool,               // mutually exclusive with collection bind
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The legacy <code>metadata_id</code> / <code>memory_id</code> / <code>skills_id</code> fields are gone. All typed content (including the soul bundle, founding memory, skills, sprites, audio) lives under the single <code>content_id</code> root. Active sprite / voice selections live as <code>SoulContent.active[KIND_SPRITE]</code> / <code>active[KIND_AUDIO]</code> entries set via <code>content::set_active</code>; mirrored into <code>SoulAsset.activeSpriteName</code>, <code>spriteConfigJson</code>, <code>voiceConfigJson</code> columns.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulContent (typed-content root)</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct ContentKey has copy, drop, store {
    kind: u32,
    name: String,
}

public struct ContentSlot has copy, drop, store {
    version: u64,
    kind: u32,
    blob_object_id: ID,            // Walrus Blob object
    is_public: bool,
    deleted: bool,
    purged: bool,
    download_policy: u8,           // 0=public, 1=owner_only, 2=allowlist
    grant_scope_mask: u64,         // cached from KindDescriptor at append
    read_mode_mask: u64,           // owner | grant | paid | public subset
    op_mask: u64,                  // append | delete | purge | active_bind
    seal_encrypted: bool,
    created_at_ms: u64,
}

public struct ActiveBinding has copy, drop, store {
    version: u64,
    kind: u32,
    name: String,
    version_index: u64,
    download_policy: u8,
}

public struct SoulContent has key {
    id: UID,
    version: u64,
    soul_id: ID,
    items: Table<ContentKey, vector<ContentSlot>>,
    count_by_kind: Table<u32, u64>,
    active: Table<u32, ActiveBinding>,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          Slot data is cached on append: <code>grant_scope_mask</code>, <code>read_mode_mask</code>, and <code>op_mask</code> snapshot the <code>KindDescriptor</code> values, so historical slots keep working even if the kind is later deprecated. The Move guarantee is that <code>KindDescriptor</code> values never mutate after registration — only the <code>deprecated</code> flag flips — so the slot caches are forever-consistent.
        </p>
        <p className="text-xs text-muted">
          Canonical names: <code>KIND_SOUL_DOC</code> slots must use name <code>&quot;soul&quot;</code>; <code>KIND_MEMORY</code> slots must use name <code>&quot;default&quot;</code>. Skill / sprite / audio names are free-form (lowercase canonical bytes).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">KindRegistry</h2>
        <p className="text-sm text-muted">
          A single shared <code>KindRegistry</code> object holds the active kind table. Pre-registered ids <code>0..=4</code> are the five built-ins; <code>5..=15</code> are reserved; custom kinds are allocated from <code>FIRST_CUSTOM_KIND = 16</code> by the <code>KindAdminCap</code> holder. See <Link href="/resources/kind-registry" className="text-purple hover:text-foreground transition">Kind Registry Reference</Link> for the full schema.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulPaidAccessList</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct KindPaidConfig has copy, drop, store {
    version: u64,
    price_atomic: u64,
    scope_mask: u64,                 // pinned to kind's default_grant_scope_mask
    duration_ms: Option<u64>,        // None = lifetime
    ownership_epoch_snapshot: u64,
}

public struct KindPaidEntry has copy, drop, store {
    version: u64,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessList has key {
    id: UID,
    version: u64,
    soul_id: ID,
    creator: address,
    kind_configs: Table<u32, KindPaidConfig>,
    entries: Table<address, Table<u32, KindPaidEntry>>,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          One <code>SoulPaidAccessList</code> per Soul, bound via <code>SoulState.access_list_id</code>. Entries are reaped via <code>paid_access::cleanup_stale_entries</code> (any caller). See <Link href="/resources/paid-access" className="text-purple hover:text-foreground transition">Paid Access</Link>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">SoulGrant</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct SoulGrant has key, store {
    id: UID,
    version: u64,
    soul_id: ID,
    grantee: address,
    issued_by: address,
    ownership_epoch_snapshot: u64,   // invalidated on ownership transfer
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          One grant per (Soul, grantee). Issuing a second grant to the same grantee <strong>supersedes</strong> the first — new <code>scope_mask</code> fully replaces the old one. Storage rebate on invalidated grants can be reclaimed by anyone via <code>grant::destroy_invalidated_grant</code>. See <Link href="/resources/soulgrant-api" className="text-purple hover:text-foreground transition">SoulGrant API</Link>.
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
    tradeable: bool,
    current_holder: address,
    current_holder_kiosk_id: ID,
    right_id: ID,
    max_supply: Option<u64>,       // on-chain cap; None = unlimited
    current_supply: u64,           // monotonically increasing
}

// Held inside holder's kiosk
public struct SoulCollectionRight has key, store { ... }`}</code>
        </pre>
        <p className="text-xs text-muted">
          <code>max_supply</code> is locked at create time. <code>collection::add_soul</code> aborts with <code>ESoulCurrentlyListed</code> while the Soul has an active listing — solo listings must be cancelled first. <code>current_supply</code> is monotonically increasing and is the source of truth mirrored 1:1 into <code>SoulCollectionAsset.soulCount</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Key events</h2>
        <ul className="text-sm text-muted space-y-1.5">
          <li><code className="text-xs text-foreground">SoulCreated</code> — from <code>market</code> after any mint variant; carries <code>content_id</code>.</li>
          <li><code className="text-xs text-foreground">SoulOwnershipRotated</code> — from <code>soul::rotate_owner</code> on every purchase / transfer. Increments <code>ownership_epoch</code> and lazy-invalidates all grants and paid entries.</li>
          <li><code className="text-xs text-foreground">SoulContentCreated</code> — from <code>content::create</code> at mint.</li>
          <li><code className="text-xs text-foreground">ContentVersionAppended / Deleted / Purged</code> — every typed-content mutation; includes <code>kind</code>, <code>kind_name</code>, <code>name</code>, <code>version_index</code>.</li>
          <li><code className="text-xs text-foreground">ActiveBindingUpdated</code> — sprite / audio active selection changes.</li>
          <li><code className="text-xs text-foreground">SoulGrantIssued / Revoked / Superseded / Expired / Destroyed</code> — grant lifecycle.</li>
          <li><code className="text-xs text-foreground">SoulPaidAccessListCreated</code> — emitted once per mint.</li>
          <li><code className="text-xs text-foreground">SoulPaidAccessKindConfigured / Updated / Deleted</code> — owner kind-config changes.</li>
          <li><code className="text-xs text-foreground">SoulPaidAccessGranted / Revoked</code> — purchase and revoke events.</li>
          <li><code className="text-xs text-foreground">KindRegistered / Deprecated / Reactivated</code> — registry mutations (admin only).</li>
          <li><code className="text-xs text-foreground">SoulCollectionCreated / SoulAddedToCollection / CollectionHolderUpdated</code> — from <code>collection</code> module.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Provenance kinds</h2>
        <ul className="text-sm text-muted space-y-1">
          <li><code className="text-xs text-foreground">0 — native:</code> Fresh-deploy via <code>market::mint_native_in_personal_kiosk</code>. No prior NFT.</li>
          <li><code className="text-xs text-foreground">1 — imported:</code> Existing Walrus blob imported via <code>market::mint_imported_in_personal_kiosk</code>. <code>origin_ref</code> is an off-chain claim — surfaces must label it as unverified.</li>
          <li><code className="text-xs text-foreground">2 — personal-join:</code> An existing Sui NFT wrapped via <code>market::mint_joined_in_personal_kiosk</code>. The source NFT is placed into the personal kiosk first; <code>origin_ref</code> records the source type and object ID. See <Link href="/resources/wrap-link" className="text-purple hover:text-foreground transition">Wrap + Link</Link>.</li>
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
