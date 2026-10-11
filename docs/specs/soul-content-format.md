# Soul Content Format Specification

**Version:** 2.0  
**Date:** 2026-04-07  
**Status:** Implemented  
**Scope:** Fresh-deploy `move/soulidity` package plus `new-web` publish/import/personal-join/collection flows

---

## 0. Deployment Assumption

This specification is for the new content architecture only.

- It assumes a **fresh deploy** of the Move package and shared objects.
- It does not preserve legacy object IDs, legacy route params, or old DB projection shapes.
- It does not describe migration behavior for historical linked-list memory or single-version skill chains.

---

## 1. Canonical Content Artifacts

Every Soul can ship three user-authored artifacts:

| Artifact | Product contract | Upload mode | On-chain binding |
| --- | --- | --- | --- |
| `soul.md` | OpenClaw-style five-section markdown | encrypted by default | Soul-level Seal document (`soul-seal:`) |
| `memory.md` | founding memory markdown | encrypted by default | memory-level Seal document (`soul-memory:`) |
| `skills.zip` | ZIP bundle with `SKILL.md` frontmatter `name` | encrypted by default | skill-level Seal document (`soul-skill:`) |

Only explicit public skill uploads remain as an advanced path. Default UX for create, import, personal-join, collection publish, and skill append is private.

---

## 2. Soul Layer

`soul.md` is stored as the immutable encrypted Soul payload.

- The UI template uses the five OpenClaw-style sections:
  - `## Core Truths`
  - `## Boundaries`
  - `## Vibe`
  - `## Knowledge`
  - `## Continuity`
- The mirrored sidecar is built from the raw DEK envelope returned by upload.
- Human and agent read access both use the Soul access routes backed by Soul Seal approval.

---

## 3. Memory Layer

Memory uses timestamp-keyed storage, not linked entry objects.

```move
struct SoulMemory has key {
    id: UID,
    soul_id: ID,
    entries: table::Table<u64, ID>,
    entry_count: u64,
}
```

Contract details:

- `timestampKey = clock.timestamp_ms()`
- Table key is `timestampKey`
- Table value is `blob_object_id`
- External identity is `(memoryOnChainId, timestampKey)`
- Projection identity is the same composite key
- Seal document binding is `memory_id + timestampKey`

Mirror and access behavior:

- Founding memory and appended memory both upload encrypted blobs.
- Mirror writes always carry the memory Seal sidecar when a DEK envelope exists.
- Human route: `/api/souls/[id]/memory/[entryKey]/access`
- Agent route: `/api/agent/souls/[id]/memory/[entryKey]/access`
- Shared founding memory template sections are:
  - `## Origin Snapshot`
  - `## Initial Direction`

---

## 4. Skills Layer

Skills use a multi-skill registry keyed by bundle name and version index.

```move
struct SkillSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    created_at_ms: u64,
}

struct SoulSkills has key {
    id: UID,
    soul_id: ID,
    skills: table::Table<String, vector<SkillSlot>>,
    skill_count: u64,
}
```

Contract details:

- `skillName` comes from `skills.zip` -> `SKILL.md` frontmatter `name`
- `versionIndex` is the vector index for that `skillName`
- External identity is `(skillsOnChainId, skillName, versionIndex)`
- Delete is soft delete on the slot
- Default UX is encrypted/private, public remains explicit-only

Routes:

- Access: `/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access`
- Agent access: `/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access`
- Delete: `/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/delete`

---

## 5. Product Constraints

- Skills upload is **`.zip only`**
- ZIP validation requires `SKILL.md`
- `SKILL.md` frontmatter `name` is mandatory and becomes the canonical `skillName`
- Create/import content templates and the Resources preview page are sourced from shared template modules, not page-local inline strings

---

## 6. Removed Legacy Shapes

This implementation no longer treats the following as current-state contracts:

- `MemoryEntry` linked-list objects
- `entryIndex`-based external identity
- `SkillVersion` shared objects
- `versionOnChainId` route identity
- `latestSkillVersionOnChainId`
- single-version-chain assumptions in mirror/UI/API layers

If code or docs still depend on those shapes, that is a regression.
