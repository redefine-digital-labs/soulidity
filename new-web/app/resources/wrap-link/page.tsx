import Link from 'next/link'

export default function WrapLinkPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Wrap + Link Guide</h1>
        <p className="text-sm text-muted">
          Personal Join lets you add a Soul layer on top of any existing Sui NFT. Your original NFT stays unchanged — you gain Soul identity, encrypted content, memory, and skills without a new token contract.
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
        <h2 className="text-lg font-semibold">What Personal Join Does</h2>
        <ul className="text-sm text-muted space-y-2">
          <li>Calls <code>market::mint_joined_in_personal_kiosk</code> with your source NFT's object ID and type.</li>
          <li>The source NFT is placed into your personal kiosk (using <code>kiosk::place</code>) before the Soul is minted — the contract requires co-location to prove current ownership.</li>
          <li>A fresh <code>Soul</code> object is created with <code>provenance_kind = 2</code> (personal-join) and <code>origin_ref</code> set to a string encoding the source type and object ID.</li>
          <li>A <code>SoulState</code> shared object is created and linked to the new Soul.</li>
          <li>Optionally creates a founding memory entry and an initial skills bundle in the same transaction.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Step-by-Step: Personal Join Flow</h2>
        <ol className="text-sm text-muted space-y-3 list-decimal ml-5">
          <li>
            <strong className="text-foreground">Go to /wrap-link</strong> and choose Personal Join. You must be logged in with a Privy wallet.
          </li>
          <li>
            <strong className="text-foreground">Select your NFT.</strong> The page reads your personal kiosk on-chain and lists all NFTs with Sui Display metadata. Only Sui-native NFTs are supported in the current release.
          </li>
          <li>
            <strong className="text-foreground">Configure the Soul.</strong> Fill in name, description, image URL, and upload your Soul content (<code>soul.md</code>), optional founding memory (<code>memory.md</code>), and optional skills bundle (<code>skills.zip</code>). These are encrypted and uploaded to Walrus before the TX is built.
          </li>
          <li>
            <strong className="text-foreground">Sign the transaction.</strong> The client calls <code>buildPersonalJoinSoulTx</code> which assembles the full PTB: borrow the kiosk cap, place the source NFT, call <code>market::mint_joined_in_personal_kiosk</code>, return the kiosk cap.
          </li>
          <li>
            <strong className="text-foreground">Post-TX sync.</strong> After the TX succeeds, the app calls the publish API which mirrors the <code>SoulAsset</code>, <code>SoulState</code>, <code>SoulMemory</code>, and optionally <code>SoulSkills</code> rows into the DB.
          </li>
        </ol>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Transaction Builder</h2>
        <p className="text-sm text-muted">
          The TX is built in <code>new-web/lib/soulidity/tx/personal-join.ts</code> via <code>buildPersonalJoinSoulTx</code>:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`buildPersonalJoinSoulTx({
  currentKioskId?,             // reuse existing personal kiosk if present
  currentKioskCapOnChainId?,
  sourceObjectId,              // the NFT to wrap
  sourceObjectType,            // full Move type string e.g. "0xabc::nft::MyNFT"
  name, description, imageUrl,
  metadataRef?,
  protectedBlobObjectId,       // Walrus Blob object already registered on-chain
  foundingMemoryBlobObjectId?, // optional founding memory Blob
  skillsBlobObjectId?,         // optional initial skills Blob
  initialSkillName?,           // defaults to "default"
  skillsVisibility?,           // "public" | "private", defaults to "private"
  originRef,                   // provenance string — typically "type::objectId"
  creatorRoyaltyBps,           // 0–10000
})`}</code>
        </pre>
        <p className="text-xs text-muted mt-1">
          The function validates that <code>originRef</code> and <code>sourceObjectType</code> are non-empty before building. Soulidity deployment IDs are loaded from <code>lib/soulidity/deployment-manifest.json</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Kiosk Mechanics</h2>
        <p className="text-sm text-muted">
          Soulidity uses the Sui personal kiosk extension. The transaction handles kiosk creation if you do not already have one:
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>If <code>currentKioskId</code> is null, a new personal kiosk is created in the same PTB.</li>
          <li>The source NFT is placed via <code>kiosk::place</code> using a borrowed <code>KioskOwnerCap</code> extracted with <code>personal_kiosk::borrow_val</code> / <code>return_val</code>.</li>
          <li>The market contract requires the source NFT to be inside the same kiosk where the Soul is minted. It reads the NFT's object ID from the kiosk directly on-chain.</li>
          <li>After mint the source NFT remains in your kiosk alongside the new Soul.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Provenance on-chain</h2>
        <p className="text-sm text-muted">
          The <code>origin_ref</code> field on the <code>Soul</code> object permanently records the wrapped NFT's identity. It is a human-readable string set by the UI at wrap time. The <code>SoulCreated</code> event carries <code>provenance_kind = 2</code> so indexers can distinguish personal-join Souls from native mints.
        </p>
        <p className="text-sm text-muted">
          The source NFT is never locked, burned, or modified. You can still trade the source NFT independently. The Soul layer is purely additive — revoking it would require the Soul owner to manually burn or abandon the Soul object.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/api-sdk" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: API & SDK Reference →
        </Link>
      </div>
    </div>
  )
}
