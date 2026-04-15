import Link from 'next/link'

export default function GettingStartedPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Getting Started</h1>
        <p className="text-sm text-muted">
          This guide covers connecting your wallet, browsing Souls, making your first purchase, and understanding the ownership model.
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
        <h2 className="text-lg font-semibold">1. Connect Your Wallet</h2>
        <p className="text-sm text-muted">
          Soulidity uses <strong className="text-foreground">Privy</strong> for authentication. Privy generates an embedded Sui wallet tied to your login (email, Google, or other social login). You do not need an external browser wallet.
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>Click <strong className="text-foreground">Connect</strong> in the top navigation bar.</li>
          <li>Choose your preferred login method. Privy creates a Sui wallet automatically on first login.</li>
          <li>Your wallet address is visible in your profile. Each account has exactly one Sui wallet — no multi-wallet binding is supported.</li>
          <li>USDC on Sui Testnet is required for purchases. Get testnet tokens from the Sui Discord faucet or the Testnet portal.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">2. Browse Souls</h2>
        <p className="text-sm text-muted">
          All listed Souls are visible on the <Link href="/market" className="text-purple hover:text-foreground transition">marketplace</Link>. Each card shows the Soul name, creator, listed price in USDC, and tags.
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>Use the tag filter and search to narrow results.</li>
          <li>Click a Soul card to view its detail page — description, preview images, and grant status.</li>
          <li>The Soul detail page shows the current owner, creator royalty rate, and any active collection membership.</li>
          <li>Unlisted (held) Souls are not shown in the public marketplace.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">3. Make Your First Purchase</h2>
        <ol className="text-sm text-muted space-y-2 list-decimal ml-5">
          <li>Open a Soul listing and click <strong className="text-foreground">Buy</strong>. The price is shown in USDC atomic units.</li>
          <li>Review the fee breakdown — platform fee + creator royalty (+ optional collection royalty). Fees are deducted from the purchase amount on-chain atomically.</li>
          <li>Approve the transaction in the Privy wallet modal. The TX calls <code>market::buy_from_personal_kiosk</code> which moves the Soul from the seller's kiosk to your personal kiosk in a single atomic step.</li>
          <li>After the TX confirms, the app calls the post-TX API to mirror the new owner in the DB. All active grants on the Soul are invalidated automatically at this point.</li>
          <li>The Soul now appears in your <Link href="/my-souls" className="text-purple hover:text-foreground transition">My Souls</Link> page.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">4. Ownership Model</h2>
        <p className="text-sm text-muted">
          Soulidity uses a <strong className="text-foreground">personal kiosk</strong> ownership model. Every user has one personal kiosk on Sui that holds their Souls. You cannot transfer Souls directly to an address — all transfers go through the kiosk and market contract.
        </p>
        <ul className="text-sm text-muted space-y-2">
          <li>
            <strong className="text-foreground">Soul object:</strong> The actual NFT held inside your kiosk. It contains the encrypted content blob.
          </li>
          <li>
            <strong className="text-foreground">SoulState:</strong> A shared object that tracks ownership, grants, and bound IDs (memory, skills, collection). Anyone can read it; only the owner can modify it.
          </li>
          <li>
            <strong className="text-foreground">On-chain is authoritative:</strong> The DB is a mirror. If the DB and chain disagree, chain wins. Access routes fetch live chain state before issuing decryption keys.
          </li>
          <li>
            <strong className="text-foreground">Ownership epoch:</strong> Each ownership transfer increments an epoch counter on <code>SoulState</code>. All outstanding SoulGrants are invalidated immediately on transfer — previously issued agent grants stop working the moment you buy or sell a Soul.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">5. Publish Your First Soul</h2>
        <p className="text-sm text-muted">
          To publish a Soul, go to <Link href="/create" className="text-purple hover:text-foreground transition">Create</Link>. You will need:
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li><strong className="text-foreground">soul.md</strong> — a five-section character document. See the <Link href="/resources/content-format" className="text-purple hover:text-foreground transition">Content Format guide</Link> for the template.</li>
          <li><strong className="text-foreground">memory.md (optional)</strong> — a founding memory entry. Encrypted at upload.</li>
          <li><strong className="text-foreground">skills.zip (optional)</strong> — an initial skills bundle. The ZIP must contain a <code>SKILL.md</code> with a <code>name</code> frontmatter field.</li>
          <li>A cover image URL and description for the marketplace listing.</li>
          <li>USDC on Sui for the Walrus blob registration fee (paid to the Walrus storage network).</li>
        </ul>
        <p className="text-sm text-muted">
          After signing the publish TX, your Soul appears in your profile. You can list it for sale at any time from the Soul detail page.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Next Steps</h2>
        <div className="flex flex-col gap-2">
          {[
            { href: '/resources/content-format', label: 'Soul Content Format', desc: 'Canonical soul.md and memory.md templates' },
            { href: '/resources/soulgrant-api', label: 'SoulGrant API', desc: 'Authorize AI agents to access your Soul data' },
            { href: '/resources/walrus-seal', label: 'Walrus & Seal Integration', desc: 'How encryption and access control work' },
            { href: '/resources/smart-contracts', label: 'Smart Contract Reference', desc: 'On-chain structs, events, and entry functions' },
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
