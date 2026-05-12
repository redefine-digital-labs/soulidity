import type { Metadata } from 'next'
import Link from 'next/link'

const pageTitle = 'User Guide'
const pageDescription =
  'The full Soulidity user journey: connect wallet, browse the market, buy your first Soul, create your own, manage agent grants, configure paid access, bind the desktop companion, and sell or transfer Souls.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: '/resources/user-guide' },
  openGraph: {
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
    url: '/resources/user-guide',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} · Soulidity`,
    description: pageDescription,
  },
}

export default function UserGuidePage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">User Guide</h1>
        <p className="text-sm text-muted">
          The full Soulidity user journey, end to end. Each section is also linked from the in-app surfaces it describes — bookmark or skim. For a five-minute quick start, see <Link href="/resources/getting-started" className="text-purple hover:text-foreground transition">Getting Started</Link>.
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

      <nav aria-label="On this page" className="rounded-2xl border border-border bg-card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted mb-2">On this page</div>
        <ol className="text-sm text-foreground/90 space-y-1 list-decimal ml-5">
          <li><a href="#wallet" className="hover:text-purple transition">Wallet connect &amp; USDC setup</a></li>
          <li><a href="#browse" className="hover:text-purple transition">Browsing the market</a></li>
          <li><a href="#buy" className="hover:text-purple transition">Buying your first Soul</a></li>
          <li><a href="#create" className="hover:text-purple transition">Creating a Soul</a></li>
          <li><a href="#append" className="hover:text-purple transition">Append-only updates &amp; auto-grant</a></li>
          <li><a href="#grants" className="hover:text-purple transition">Managing agent grants</a></li>
          <li><a href="#paid" className="hover:text-purple transition">Paid access</a></li>
          <li><a href="#desktop" className="hover:text-purple transition">Desktop companion</a></li>
          <li><a href="#sell" className="hover:text-purple transition">Selling &amp; transferring</a></li>
          <li><a href="#faq" className="hover:text-purple transition">FAQ &amp; troubleshooting</a></li>
        </ol>
      </nav>

      <Section id="wallet" title="1. Wallet connect & USDC setup">
        <p>
          Soulidity uses a Sui wallet challenge-response for login. The web app issues a server-signed challenge, your wallet signs it, and the server sets an HTTP-only session cookie. No purchase or mint transaction is sent at login.
        </p>
        <ul className="space-y-1.5 ml-5 list-disc">
          <li>Click <strong className="text-foreground">Login</strong> in the navbar and pick any Sui wallet. Each account is bound to one primary wallet — the wallet you first sign in with is the one Soulidity uses for ownership lookups.</li>
          <li>Fund the wallet with <strong className="text-foreground">SUI</strong> (for gas + Walrus storage) and <strong className="text-foreground">USDC on Sui</strong> (for purchases and paid access). All Soulidity prices are denominated in atomic USDC on-chain.</li>
          <li>If you do not yet have a personal kiosk, the first publish or purchase transaction creates one for you automatically. All your Souls are held in this single kiosk.</li>
        </ul>
      </Section>

      <Section id="browse" title="2. Browsing the market">
        <p>
          Listed Souls appear on the <Link href="/market" className="text-purple hover:text-foreground transition">market</Link>. Each card shows the cover image, name, creator, USDC price, and tag chips. Unlisted (held) Souls are private to the owner.
        </p>
        <ul className="space-y-1.5 ml-5 list-disc">
          <li>Use the tag filter and search to narrow listings.</li>
          <li>Click any card to open the Soul detail page — description, full preview, current owner, creator royalty rate, collection membership, and any active grants.</li>
          <li>If the Soul belongs to a <Link href="/collections" className="text-purple hover:text-foreground transition">Collection</Link>, the collection page also shows its peers, an extra collection royalty rate, and the on-chain supply cap.</li>
        </ul>
      </Section>

      <Section id="buy" title="3. Buying your first Soul">
        <ol className="space-y-2 ml-5 list-decimal">
          <li>Open a listing and click <strong className="text-foreground">Buy</strong>. The price is shown in human USDC; the on-chain value is in atomic units (1 USDC = 1&nbsp;000&nbsp;000 atomic).</li>
          <li>Review the fee split — platform fee + creator royalty (+ optional collection royalty). All splits are applied atomically by the market module; the price you pay is the final amount.</li>
          <li>Approve the transaction in your wallet. The TX calls <code>market::buy_from_personal_kiosk</code>, which moves the Soul from the seller&apos;s personal kiosk into yours in a single step.</li>
          <li>The app then mirrors the new owner in the database. <strong className="text-foreground">All active SoulGrants and paid-access entries on this Soul are invalidated immediately</strong> via the <code>ownership_epoch</code> bump — anything the previous owner authorized stops working before you take possession.</li>
          <li>The Soul appears in <Link href="/my-souls" className="text-purple hover:text-foreground transition">My Souls</Link>. From there you can list it, transfer it into a collection, grant agents access, or bind it to the desktop companion.</li>
        </ol>
      </Section>

      <Section id="create" title="4. Creating a Soul">
        <p>
          Go to <Link href="/create" className="text-purple hover:text-foreground transition">Create</Link>. You will need the following inputs — all live as typed content slots under one unified <code>SoulContent</code> object (see <Link href="/resources/kind-registry" className="text-purple hover:text-foreground transition">Kind Registry</Link>).
        </p>
        <ul className="space-y-2 ml-5 list-disc">
          <li><strong className="text-foreground">soul.md</strong> (<code>KIND_SOUL_DOC</code>) — the five-section character document. Appended once at mint and forever immutable. See <Link href="/resources/content-format" className="text-purple hover:text-foreground transition">Content Format</Link> for the template.</li>
          <li><strong className="text-foreground">memory.md</strong> (<code>KIND_MEMORY</code>, optional) — the founding memory entry. Append-only timeline you (or granted agents) can extend later.</li>
          <li><strong className="text-foreground">skills.zip</strong> (<code>KIND_SKILL</code>, optional) — an initial skills bundle. The ZIP must contain a <code>SKILL.md</code> with a <code>name</code> front-matter field.</li>
          <li><strong className="text-foreground">Sprite</strong> (<code>KIND_SPRITE</code>, optional) — persona art for the desktop companion. Can be made public, paid-gated, or grant-gated.</li>
          <li><strong className="text-foreground">Audio</strong> (<code>KIND_AUDIO</code>, optional) — persona voice for the desktop companion. Same read-mode options as sprite.</li>
          <li>A cover image URL, description, tags, and creator royalty (basis points) for the marketplace listing.</li>
          <li>SUI for gas plus any Walrus blob registration fees charged by the storage network.</li>
        </ul>
        <p>
          After signing the publish TX, your Soul appears in your profile. You can list it for sale at any time from the Soul detail page. Mint creates the on-chain <code>SoulContent</code> typed-content root and a per-Soul <code>SoulPaidAccessList</code> bound 1:1 to the Soul.
        </p>
      </Section>

      <Section id="append" title="5. Append-only updates & auto-grant on append">
        <p>
          Once a Soul is minted, you can keep appending new versions to mutable kinds (<code>memory</code>, <code>skill</code>, <code>sprite</code>, <code>audio</code>). Only <code>soul_doc</code> is permanently sealed at mint.
        </p>
        <ul className="space-y-2 ml-5 list-disc">
          <li><strong className="text-foreground">Append</strong> — adds a new immutable version. Past versions remain queryable (subject to read mode).</li>
          <li><strong className="text-foreground">Soft delete</strong> — flags a version as deleted; encrypted blob stays on Walrus.</li>
          <li><strong className="text-foreground">Hard purge</strong> — clears the on-chain pointer entirely. Owner only.</li>
          <li><strong className="text-foreground">Active binding</strong> (sprite / audio only) — selects which uploaded version is the live persona. The desktop companion reads from the active slot.</li>
        </ul>
        <p>
          When you append a <em>non-public</em> version, Soulidity automatically issues scope-matched SoulGrants to every active agent on your account that doesn&apos;t already hold the required scope. This lets your agents (e.g. OpenClaw, Hermes) keep reading newly added content without manual re-authorization. If the auto-grant call fails — for example during a deploy window — the My Souls page surfaces a <span className="text-amber-300">yellow banner</span> telling you exactly which agents are missing which scopes, and you can retry from there.
        </p>
        <p>
          See <Link href="/resources/agent-integration" className="text-purple hover:text-foreground transition">Agent Integration</Link> for the full auto-grant rules.
        </p>
      </Section>

      <Section id="grants" title="6. Managing agent grants">
        <p>
          A <strong className="text-foreground">SoulGrant</strong> is an on-chain delegation that lets a specific wallet (typically an AI agent) read or write specific Soul data channels without transferring ownership. Each grant carries a <code>scope_mask</code>:
        </p>
        <ul className="space-y-1 ml-5 list-disc text-sm">
          <li><code>SCOPE_SEAL = 1</code> → decrypt the <code>soul_doc</code> bundle</li>
          <li><code>SCOPE_MEMORY = 2</code> → read memory entries and append new ones</li>
          <li><code>SCOPE_SKILLS = 4</code> → read private skill versions and publish new ones</li>
          <li><code>SCOPE_ASSETS = 8</code> → read private sprite/audio versions and publish new ones</li>
        </ul>
        <p>
          Each Soul has one grant slot per grantee. Issuing a second grant to the same grantee <strong className="text-foreground">supersedes</strong> the first — the new <code>scope_mask</code> fully replaces the old one (it is not union-ed). Use the pre-check endpoint <code>POST /api/souls/grant-merge-masks</code> to compute the intended <code>existing | added</code> mask before signing if you want to extend rather than overwrite. The Soulidity SDK helpers handle this for you.
        </p>
        <p>
          <strong className="text-foreground">All grants are invalidated automatically when the Soul changes hands</strong> via the <code>ownership_epoch</code> snapshot on each grant. You never need to revoke before selling — the rotation is implicit.
        </p>
        <p>
          See <Link href="/resources/soulgrant-api" className="text-purple hover:text-foreground transition">SoulGrant API</Link> for the full lifecycle (issue / supersede / revoke / expire).
        </p>
      </Section>

      <Section id="paid" title="7. Paid access">
        <p>
          Sprite and audio kinds support paid access — viewers can purchase time-bound (or lifetime) access to your persona assets in USDC. Memory, skill, and soul_doc kinds do <strong className="text-foreground">not</strong> support paid access; those channels stay owner + granted-agent only.
        </p>
        <p>
          As the Soul owner, you configure <code>KindPaidConfig</code> per kind: price in atomic USDC, scope mask (pinned to the kind&apos;s default), and an optional duration. Buyers call the purchase route, USDC is split per platform / creator / collection fees, and a <code>KindPaidEntry</code> is recorded under their address.
        </p>
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-foreground">
          <strong className="text-amber-300">Important:</strong> paid access is an <em>owner-revocable subscription</em>, not a permanent purchase. You may call <code>paid_access::revoke_access</code> at any time and <strong className="text-foreground">no on-chain refund is issued</strong>. Entries also auto-invalidate when the Soul changes ownership. Anyone purchasing access should treat this as a recurring subscription on your goodwill, not a sale.
        </p>
        <p>
          See <Link href="/resources/paid-access" className="text-purple hover:text-foreground transition">Paid Access</Link> for the full revocation, renewal, and stale-entry-cleanup model.
        </p>
      </Section>

      <Section id="desktop" title="8. Desktop companion">
        <p>
          The <Link href="/download" className="text-purple hover:text-foreground transition">Soulidity desktop app</Link> renders any Soul you own (or hold a grant for) as a live persona on your desktop — sprite animation, voice, memory-aware chat. The web → desktop handoff is:
        </p>
        <ol className="space-y-1.5 ml-5 list-decimal">
          <li>Mint By Web can notify the desktop app with <code>soulidity://mint-completed?token=...</code> so the desktop clears its local extract draft and returns to the scan step. The current desktop handler does not deep-link a Soul ID or purchase directly into the persona library.</li>
          <li>If the sprite / audio version is paid- or grant-gated, the desktop app prompts you to authorize: it issues a <code>SoulGrant</code> with <code>SCOPE_ASSETS</code> to itself.</li>
          <li>Protected sprite decryption happens locally through the <code>soul:decrypt-protected-sprite</code> IPC. The main process decrypts the Walrus blob and returns sprite bytes to the renderer, which immediately passes them back to <code>soul:cache-persona</code> for the local desktop cache.</li>
        </ol>
        <p>
          See <Link href="/resources/desktop-companion" className="text-purple hover:text-foreground transition">Desktop Companion</Link> for installation, upgrade, and IPC protocol details.
        </p>
      </Section>

      <Section id="sell" title="9. Selling & transferring">
        <ul className="space-y-2 ml-5 list-disc">
          <li><strong className="text-foreground">List for sale.</strong> Open My Souls → pick the Soul → <strong>List</strong>. Set the USDC price (and optionally bind to a collection). Listed Souls cannot be moved into collections until you cancel the listing.</li>
          <li><strong className="text-foreground">Cancel a listing.</strong> The shared listing object is consumed by <code>market::cancel_soul_listing</code>; storage rebate is reclaimed. Any caller may also reap inactive listings via <code>delete_soul_listing</code>.</li>
          <li><strong className="text-foreground">Transfer to a collection.</strong> If you control a collection, you can bind a Soul into it via <code>collection::add_soul</code>. The Soul cannot be in an active listing at the time. The collection&apos;s <code>max_supply</code> cap is enforced on-chain.</li>
          <li><strong className="text-foreground">On ownership change.</strong> The Soul&apos;s <code>ownership_epoch</code> bumps. Every outstanding SoulGrant and every <code>KindPaidEntry</code> is automatically invalidated through the epoch snapshot. The new owner inherits a clean slate; old grants can be reaped by anyone via <code>grant::destroy_invalidated_grant</code> to reclaim storage rebate.</li>
        </ul>
      </Section>

      <Section id="faq" title="10. FAQ & troubleshooting">
        <Faq q="My agent stopped seeing new memory entries after I bought a Soul.">
          On purchase, the Soul&apos;s ownership_epoch bumped and all of the previous owner&apos;s grants — including any to your agent — were invalidated. Re-issue the grant from the new owner (you) via the My Souls page or the SoulGrant API.
        </Faq>
        <Faq q="I configured paid access for sprite but nobody can buy.">
          Three things to check: (1) the kind&apos;s <code>read_mode_mask</code> must allow <code>READ_PAID</code> — built-in sprite/audio kinds do; built-in memory/skill kinds do not. (2) The config&apos;s <code>ownership_epoch_snapshot</code> must match the current Soul epoch — if you transferred ownership and back, you need to reconfigure. (3) The scope mask must equal the kind&apos;s <code>default_grant_scope_mask</code>.
        </Faq>
        <Faq q="The yellow auto-grant banner is showing — what do I do?">
          The auto-grant call after an append failed (commonly during a deploy window race). Click the banner to retry. It lists the exact agents missing the exact scopes; the retry posts a single PTB that catches them up.
        </Faq>
        <Faq q="Can I have multiple wallets per account?">
          No. Each Soulidity account is bound to one primary Sui wallet, set on first login. To use a different wallet you need to register a new account.
        </Faq>
        <Faq q="What happens if I delete a soul_doc version?">
          You cannot. <code>KIND_SOUL_DOC</code> is mint-only and forever immutable — its <code>op_mask</code> on-chain has no append, delete, or purge bits set. The soul.md you ship at mint is the soul.md forever.
        </Faq>
        <Faq q="Where is my data stored?">
          Encrypted blobs live on <Link href="/resources/walrus-seal" className="text-purple hover:text-foreground transition">Walrus</Link>. Access control is enforced by <Link href="/resources/walrus-seal" className="text-purple hover:text-foreground transition">Seal</Link> policy objects derived from the on-chain Soul state. Soulidity&apos;s database mirrors on-chain state but is never authoritative — the chain wins.
        </Faq>
      </Section>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Where next</h2>
        <div className="flex flex-col gap-2">
          {[
            { href: '/resources/content-format', label: 'Soul Content Format', desc: 'soul.md / memory.md / skills.zip templates' },
            { href: '/resources/soulgrant-api', label: 'SoulGrant API', desc: 'Issue, supersede, revoke agent access' },
            { href: '/resources/paid-access', label: 'Paid Access', desc: 'Subscriptions, revocation, ownership-epoch rules' },
            { href: '/resources/desktop-companion', label: 'Desktop Companion', desc: 'Sprite IPC + mint deep-link callback' },
            { href: '/resources/agent-integration', label: 'Agent Integration Guide', desc: 'For OpenClaw / Hermes / third-party agents' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex justify-between items-center rounded-xl border border-border bg-card2/40 px-4 py-3 hover:border-purple transition"
            >
              <div>
                <div className="text-sm font-semibold">{item.label}</div>
                <div className="text-xs text-muted">{item.desc}</div>
              </div>
              <span className="text-muted text-sm">→</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-border bg-card p-5 space-y-3 scroll-mt-20">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-sm text-muted space-y-3">{children}</div>
    </section>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-border/70 bg-card2/30 p-4 group">
      <summary className="cursor-pointer text-sm font-semibold text-foreground list-none flex justify-between items-center">
        <span>{q}</span>
        <span className="text-muted text-xs transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="text-sm text-muted mt-2 space-y-2">{children}</div>
    </details>
  )
}
