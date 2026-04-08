import Link from 'next/link'

export default function SkillsRevisionsPage() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <div>
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Resources</p>
        <h1 className="font-display text-2xl font-bold mb-2">Skills & Docs Revisions</h1>
        <p className="text-sm text-muted">
          Soul Skills are versioned ZIP bundles stored on Walrus and indexed on-chain by skill name and version index. Each skill has an independent revision history, and versions can be marked public or private.
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
          <code>{`// Shared object — one per Soul
public struct SoulSkills has key {
    id: UID,
    soul_id: ID,
    skills: Table<String, vector<SkillSlot>>,
    skill_count: u64,              // unique skill names
}

public struct SkillSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    created_at_ms: u64,
}

// Walrus Blob stored as dynamic object field
public struct SkillBlobKey has copy, drop, store {
    skill_name: String,
    version_index: u64,            // 0-based index into slot vector
}`}</code>
        </pre>
        <p className="text-sm text-muted">
          The <code>skills</code> table maps a <code>skillName</code> string to a vector of <code>SkillSlot</code> values. Each append pushes a new slot; the index into the vector is the <code>versionIndex</code>. Both are required to address a specific version.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">ZIP-Only Upload</h2>
        <p className="text-sm text-muted">
          Skills must be uploaded as <code>.zip</code> archives. The upload validation layer enforces this before the Walrus upload occurs. Inside the ZIP, a <code>SKILL.md</code> file at the root is required.
        </p>
        <div className="rounded-xl border border-border/70 bg-black/20 p-4 space-y-2">
          <div className="text-xs font-semibold text-foreground">Required: SKILL.md frontmatter</div>
          <pre className="text-xs leading-6 text-foreground/90">
            <code>{`---
name: my-skill-name       # becomes the on-chain skillName key
version: 1.0.0            # human-readable version label
description: |
  What this skill does.
---

# Skill content here`}</code>
          </pre>
        </div>
        <p className="text-xs text-muted">
          The <code>name</code> field from the frontmatter becomes the <code>skillName</code> used as the table key on-chain. If the name already exists in the <code>SoulSkills</code> table, the new version is appended to that skill's vector (versionIndex increments). If it is new, a fresh entry is created (versionIndex = 0).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Public vs Private Visibility</h2>
        <p className="text-sm text-muted">
          Each version is individually marked <code>is_public</code> at upload time. This controls whether Seal encryption is required to read the blob.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-foreground font-semibold">Visibility</th>
                <th className="text-left py-2 text-foreground font-semibold">Access model</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-border/30">
                <td className="py-2 pr-4 font-mono text-xs">public</td>
                <td className="py-2 text-xs">Walrus blob URL is returned directly. No Seal session required. Anyone can download.</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">private</td>
                <td className="py-2 text-xs">Seal-encrypted. Requires owner wallet or active SCOPE_SKILLS SoulGrant. Client must build approval TX and run Seal decryption.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-1">
          Visibility is immutable after mint. To change visibility you must append a new version with the desired setting.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Soft Delete</h2>
        <p className="text-sm text-muted">
          The owner (or a holder of SCOPE_SKILLS grant) can call <code>skills::delete_version_as_owner</code> or <code>delete_version_as_granted_agent</code>. This sets <code>deleted = true</code> on the slot — it does not remove the slot from the vector or free the Walrus blob.
        </p>
        <ul className="text-sm text-muted space-y-1.5">
          <li>The <code>versionIndex</code> is preserved. Attempting to read a deleted version returns an error from both the Move approval functions and the API.</li>
          <li>A <code>SkillVersionDeleted</code> event is emitted with <code>skills_id</code>, <code>skill_name</code>, <code>version_index</code>, and <code>deleted_by</code>.</li>
          <li>Re-deleting an already-deleted slot aborts with <code>ESkillVersionDeleted</code>.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Skills Access API</h2>
        <pre className="overflow-x-auto rounded-xl border border-border/70 bg-black/20 p-4 text-xs leading-6 text-foreground/90">
          <code>{`GET /api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access

// Public response
{
  visibility: "public",
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId }
}

// Private response
{
  visibility: "private",
  artifact: { walrusBlobUrl, walrusBlobId, blobObjectId },
  accessPolicy: {
    packageId, stateObjectId, skillsObjectId,
    skillName, versionIndex,
    moduleName: "skills",
    functionName: "approve_private_read_owner" | "approve_private_read_granted_agent",
    soulGrantObjectId: string | null,
    documentIdHex: string,
  },
  seal: { ... },
  sealSidecar: { ... },
  viewerAddress, accessKind, sessionTtlMin
}`}</code>
        </pre>
        <p className="text-xs text-muted">
          The client SDK function <code>fetchSkillAccess</code> in <code>new-web/lib/soulidity/skill-access.ts</code> handles this request and returns a typed <code>SkillAccessResponse</code>. For private versions, call <code>loadDecryptedPrivateSkillVersion</code> to run the full Seal decryption flow and receive the plaintext ZIP bytes.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/resources" className="text-sm font-medium text-purple hover:text-foreground transition">
          ← Back to resources
        </Link>
        <Link href="/resources/wrap-link" className="text-sm font-medium text-muted hover:text-foreground transition">
          Next: Wrap + Link →
        </Link>
      </div>
    </div>
  )
}
