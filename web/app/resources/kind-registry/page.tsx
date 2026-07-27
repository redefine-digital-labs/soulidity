import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'Kind Registry Reference'
const pageDescription =
  'Phase 2 unified content kinds — SOUL_DOC, MEMORY, SKILL, SPRITE, AUDIO. Op-mask and read-mode bitfields, scope-mask mapping, and custom kind registration.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/kind-registry' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/kind-registry',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function KindRegistryPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Kind Registry Reference</h1>
        <p className="text-sm text-muted">
          Phase 2 collapsed six legacy Move modules (memory, skills, assets, metadata, content_access, seal_policy) into a single typed-content matrix on the <code>SoulContent</code> root. Every content slot belongs to a <strong>kind</strong>, and the on-chain <code>KindRegistry</code> is the source of truth for what each kind can do.
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
        <h2 className="text-lg font-semibold">Built-in kinds</h2>
        <p className="text-sm text-muted">
          Five built-in kinds are pre-registered at <code>kind_registry::init</code>. Their ids are reserved (<code>0..=4</code>) and cannot be re-issued. Ids <code>5..=15</code> are reserved for future built-ins; custom kinds start at <code>FIRST_CUSTOM_KIND = 16</code>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-3 text-foreground font-semibold">Kind</th>
                <th className="text-left py-2 pr-3 text-foreground font-semibold">Id</th>
                <th className="text-left py-2 pr-3 text-foreground font-semibold">op_mask</th>
                <th className="text-left py-2 pr-3 text-foreground font-semibold">read_mode_mask</th>
                <th className="text-left py-2 pr-3 text-foreground font-semibold">Active bind</th>
                <th className="text-left py-2 text-foreground font-semibold">grant_scope</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-3 font-mono text-xs">soul_doc</td>
                <td className="py-2 pr-3 text-xs">0</td>
                <td className="py-2 pr-3 text-xs">∅ (mint-only)</td>
                <td className="py-2 pr-3 text-xs">OWNER | GRANT</td>
                <td className="py-2 pr-3 text-xs">no</td>
                <td className="py-2 text-xs font-mono">SCOPE_SEAL (1)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-3 font-mono text-xs">memory</td>
                <td className="py-2 pr-3 text-xs">1</td>
                <td className="py-2 pr-3 text-xs">APPEND | DELETE | PURGE</td>
                <td className="py-2 pr-3 text-xs">OWNER | GRANT</td>
                <td className="py-2 pr-3 text-xs">no</td>
                <td className="py-2 text-xs font-mono">SCOPE_MEMORY (2)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-3 font-mono text-xs">skill</td>
                <td className="py-2 pr-3 text-xs">2</td>
                <td className="py-2 pr-3 text-xs">APPEND | DELETE | PURGE</td>
                <td className="py-2 pr-3 text-xs">OWNER | GRANT</td>
                <td className="py-2 pr-3 text-xs">no</td>
                <td className="py-2 text-xs font-mono">SCOPE_SKILLS (4)</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-2 pr-3 font-mono text-xs">sprite</td>
                <td className="py-2 pr-3 text-xs">3</td>
                <td className="py-2 pr-3 text-xs">APPEND | DELETE | PURGE | ACTIVE_BIND</td>
                <td className="py-2 pr-3 text-xs">OWNER | GRANT | PAID | PUBLIC</td>
                <td className="py-2 pr-3 text-xs">yes</td>
                <td className="py-2 text-xs font-mono">SCOPE_ASSETS (8)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-mono text-xs">audio</td>
                <td className="py-2 pr-3 text-xs">4</td>
                <td className="py-2 pr-3 text-xs">APPEND | DELETE | PURGE | ACTIVE_BIND</td>
                <td className="py-2 pr-3 text-xs">OWNER | GRANT | PAID | PUBLIC</td>
                <td className="py-2 pr-3 text-xs">yes</td>
                <td className="py-2 text-xs font-mono">SCOPE_ASSETS (8)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          <code>soul_doc</code> is the immutable Soul bundle — appended exactly once at mint, never deleted or amended. The other four kinds support post-mint mutation.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">KindDescriptor schema</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public struct KindDescriptor has copy, drop, store {
    version: u64,
    kind: u32,
    name: String,                   // canonical lowercase bytes [a-z0-9_-]
    op_mask: u64,                   // APPEND | DELETE | PURGE | ACTIVE_BIND
    read_mode_mask: u64,            // OWNER | GRANT | PAID | PUBLIC (OWNER required)
    has_active_binding: bool,       // lock-step with OP_ACTIVE_BIND
    requires_download_policy: bool, // double-implication with READ_PUBLIC
    default_grant_scope_mask: u64,  // single grant-scope bit when GRANT/PAID allowed
    deprecated: bool,
}`}</code>
        </pre>
        <ul className="text-sm text-muted space-y-1.5">
          <li><code>op_mask</code> is snapshotted onto each <code>ContentSlot</code> at append time. Historical slots keep working even if the kind is later deprecated.</li>
          <li><code>read_mode_mask</code> picks which Seal approval functions a kind exposes. <code>READ_OWNER</code> is mandatory — owner approval never disappears, even for public slots (they remain Seal-encrypted at rest).</li>
          <li><code>default_grant_scope_mask</code> is exactly one of <code>SCOPE_SEAL</code> / <code>SCOPE_MEMORY</code> / <code>SCOPE_SKILLS</code> / <code>SCOPE_ASSETS</code> when grant or paid reads are allowed, and zero otherwise. The single-bit rule is enforced by <code>assert_valid_default_grant_scope</code> — combined masks are rejected so the slot&apos;s cached scope stays unambiguous at Seal time.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Bit constants</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted mb-2">op_mask</div>
            <ul className="text-sm text-muted space-y-1 font-mono">
              <li>OP_APPEND = 1</li>
              <li>OP_DELETE = 2</li>
              <li>OP_PURGE = 4</li>
              <li>OP_ACTIVE_BIND = 8</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted mb-2">read_mode_mask</div>
            <ul className="text-sm text-muted space-y-1 font-mono">
              <li>READ_OWNER = 1 (mandatory)</li>
              <li>READ_GRANT = 2</li>
              <li>READ_PAID = 4</li>
              <li>READ_PUBLIC = 8</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted mb-2">default_grant_scope_mask values</div>
            <ul className="text-sm text-muted space-y-1 font-mono">
              <li>SCOPE_SEAL = 1</li>
              <li>SCOPE_MEMORY = 2</li>
              <li>SCOPE_SKILLS = 4</li>
              <li>SCOPE_ASSETS = 8</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Active binding (sprite / audio)</h2>
        <p className="text-sm text-muted">
          Kinds with <code>OP_ACTIVE_BIND</code> in their op mask support an <strong>active table</strong> on the <code>SoulContent</code> root — <code>active_table[KIND_SPRITE]</code> and <code>active_table[KIND_AUDIO]</code> hold the currently-selected name + version. Owners set or clear bindings via the unified <code>content::set_active</code> / <code>clear_active</code> entries.
        </p>
        <p className="text-sm text-muted">
          The desktop companion reads these active bindings to pick which persona art and voice to render. Switching personas is a single <code>OP_ACTIVE_BIND</code> TX — no content reupload required.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Custom kind registration</h2>
        <p className="text-sm text-muted">
          Custom kinds are admin-only. Holding the <code>KindAdminCap</code> object, an admin can call:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`public fun register_kind(
    registry: &mut KindRegistry,
    _: &KindAdminCap,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
    _ctx: &mut TxContext,
): u32`}</code>
        </pre>
        <ul className="text-sm text-muted space-y-2">
          <li>Names follow canonical bytes <code>[a-z0-9_-]</code>, length 1..=32; duplicates are rejected.</li>
          <li>The next kind id is allocated from a monotonic <code>next_kind</code> counter starting at 16; allocation is fail-closed.</li>
          <li>All cross-field invariants from <code>assert_descriptor_well_formed</code> apply: subset op/read bits, owner-required, active-binding lock-step, public ↔ download-policy double-implication, and the single-bit grant-scope rule when grant or paid reads are allowed.</li>
          <li>Admins may also deprecate a kind (<code>deprecate_kind</code>) or reactivate one (<code>reactivate_kind</code>). Deprecation blocks new appends but keeps existing slots operable through their cached op masks.</li>
        </ul>
        <p className="text-xs text-muted">
          The <code>KindRegistryCreated</code>, <code>KindRegistered</code>, <code>KindDeprecated</code>, and <code>KindReactivated</code> events stream all registry mutations for indexers.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">How content::append consumes kinds</h2>
        <p className="text-sm text-muted">
          On every append the <code>content</code> module:
        </p>
        <ol className="text-sm text-muted space-y-1 ml-5 list-decimal">
          <li>Asserts the kind is registered and not deprecated via <code>kind_registry::assert_kind_active</code>.</li>
          <li>Borrows the descriptor and validates the requested op against <code>op_mask</code>.</li>
          <li>Picks an in-mask, non-empty subset of <code>read_mode_mask</code> as the slot&apos;s <code>slot_read_mode_mask</code>; this is cached onto the slot.</li>
          <li>Caches <code>op_mask</code> and <code>default_grant_scope_mask</code> onto the slot. Future delete / purge / set_active checks consult the slot, not the registry — so the kind&apos;s rules at append time remain authoritative for the lifetime of that slot.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Client-side mirror</h2>
        <p className="text-sm text-muted">
          The TypeScript SDK exports the same constants and a frozen <code>BUILTIN_KIND_DESCRIPTORS</code> table in <code>@soulidity/sdk</code> (<code>web/lib/soulidity/kinds.ts</code>). Always import from there rather than hard-coding the numbers in client code — the table is the single client-side source so any drift between Move and TS is caught at compile time.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-action-label hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/content-format" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Soul Content Format →
        </Link>
      </div>
    </div>
  )
}
