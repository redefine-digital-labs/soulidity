import Link from 'next/link'

export default function WalrusSealPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Walrus & Seal Integration</h1>
        <p className="text-sm text-muted">
          Soulidity stores all Soul content, memory entries, and skill versions on Walrus — a decentralized blob storage network on Sui. Seal provides threshold-based encryption so only the on-chain authorized party can decrypt.
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
        <h2 className="text-lg font-semibold">Encryption Model</h2>
        <p className="text-sm text-muted">
          Before upload, the content is encrypted client-side with a freshly generated 256-bit AES-GCM data encryption key (DEK). The DEK is then threshold-encrypted by the Seal key server network. Only the parties that Seal approves on-chain can reconstruct the DEK to decrypt the blob.
        </p>
        <ol className="text-sm text-muted space-y-1.5 list-decimal ml-5">
          <li>Generate a random DEK + IV client-side.</li>
          <li>Encrypt the content blob with AES-GCM-256.</li>
          <li>Upload the ciphertext to Walrus → receive a <code>blobId</code> and a registered <code>Blob</code> object on Sui.</li>
          <li>The DEK + a SHA-256 content hash binding is encrypted by Seal under the Soul (or Memory / Skills) document ID.</li>
          <li>The resulting Seal ciphertext, IV, file metadata, and content hash are stored in the DB as a <strong>sidecar</strong>.</li>
        </ol>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Document ID Schemes</h2>
        <p className="text-sm text-muted">
          Seal ciphertext is bound to a deterministic document ID. The Move module verifies the document ID prefix matches the on-chain object IDs before approving decryption.
        </p>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Soul content</div>
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
              <code>{`"soul-seal:" + version_byte(1) + soul_id_bytes(32) + nonce(16)`}</code>
            </pre>
            <p className="text-xs text-muted mt-1">Approved by <code>seal_policy::seal_approve_owner</code> or <code>seal_approve_granted_agent</code> (requires SCOPE_SEAL).</p>
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Memory entry</div>
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
              <code>{`"soul-memory:" + version_byte(1) + memory_id_bytes(32) + timestamp_key_be(8) + nonce(16)`}</code>
            </pre>
            <p className="text-xs text-muted mt-1">Approved by <code>seal_policy::seal_approve_memory_owner</code> or <code>seal_approve_memory_granted_agent</code> (requires SCOPE_MEMORY).</p>
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Skill version (private only)</div>
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-3 text-xs leading-6 text-foreground/90">
              <code>{`"soul-skill:" + version_byte(1) + skills_id_bytes(32) + skill_name_bytes + NUL + version_index_be(8) + nonce(16)`}</code>
            </pre>
            <p className="text-xs text-muted mt-1">Approved by <code>skills::seal_approve_private_read_owner</code>, <code>skills::seal_approve_private_read_granted_agent</code>, or <code>content_access::seal_approve_skill_allowlisted</code> (requires SCOPE_SKILLS). Public skill versions bypass Seal entirely.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Sidecar Structure</h2>
        <p className="text-sm text-muted">
          The sidecar is a JSON object stored in the DB alongside each artifact. It contains everything the client needs to decrypt, excluding the DEK itself (which lives inside the Seal ciphertext).
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`{
  encryptedDek: string,   // base64 — Seal ciphertext of DEK + contentHash
  iv: string,             // base64 — 12-byte AES-GCM IV
  cipher: "AES-GCM-256",
  fileName: string,
  mimeType: string,
  contentHash: string,    // hex — SHA-256 of plaintext; bound inside encryptedDek
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The <code>contentHash</code> is bound inside the Seal-encrypted DEK payload (<code>DEK_BYTES || CONTENT_HASH_BYTES</code>). After decryption the client verifies the decrypted hash matches the sidecar hash and then verifies the decrypted plaintext hashes to the same value — preventing substitution attacks.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Client-Side Sidecar Build</h2>
        <p className="text-sm text-muted">
          Upload flows encrypt in the browser, ask the wallet to pay Walrus storage through the upload relay, then build Seal sidecar objects after the on-chain TX exposes the final Soul/Memory/Skills/Assets object IDs. Mirror APIs only verify and store those sidecars; they do not receive raw DEK envelopes.
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>The DEK and IV stay in browser memory plus short-lived recovery state until mirror sync succeeds.</li>
          <li>The browser Seal client encrypts the DEK with the document ID bound to the newly minted object.</li>
          <li>The mirror API rejects private artifacts without a sidecar object bound to the expected document ID.</li>
          <li>Wallet signing does not start until the shared Walrus cost review is confirmed.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Client Decryption Flow</h2>
        <ol className="text-sm text-muted space-y-1.5 list-decimal ml-5">
          <li>Call the access API endpoint — it returns the sidecar, Walrus blob URL, Seal server config, and an approval policy (module + function + required object IDs).</li>
          <li>Create a <code>SessionKey</code> with <code>SessionKey.create</code>, sign the personal message with the viewer wallet.</li>
          <li>Build the approval transaction bytes matching the policy (owner, granted-agent, or allowlisted path).</li>
          <li>Fetch the encrypted blob from Walrus.</li>
          <li>Call <code>SealClient.decrypt</code> with the sidecar <code>encryptedDek</code> — the Seal key servers verify the approval TX before releasing key shares.</li>
          <li>AES-GCM decrypt the blob with the recovered DEK + IV.</li>
          <li>Verify the plaintext SHA-256 matches the bound <code>contentHash</code>.</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/memory-architecture" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Memory Architecture →
        </Link>
      </div>
    </div>
  )
}
