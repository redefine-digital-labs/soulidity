# Soulidity Phase 2 — Publish + Smoke Runbook

Companion to `2026-05-04-soulidity-unified-content-phase2.md`. Captures the
manual steps that must run after the TS/SDK/API hard-cut lands.

## Prerequisites

- `move/soulidity` builds + tests cleanly: `cd move/soulidity && sui move build && sui move test` → 98/98.
- `npx prisma format --schema=prisma/schema.prisma` succeeds.
- `npx prisma generate --schema=prisma/schema.prisma` succeeds.
- Web type-check is clean: `cd web && npx tsc --noEmit`.

## Step 8.6/8.7 — Apply the schema migration

The migration SQL was written by hand at:

```
prisma/migrations/20260504150000_phase2_unified_content/migration.sql
```

It drops the four phase-1 tables (`soul_memory_entries`,
`soul_skill_version_records`, `soul_asset_version_records`,
`content_access_records`), prunes deleted columns from `soul_assets`, and
creates the three new tables (`soul_content_version_records`,
`soul_paid_access_kind_configs`, `soul_paid_access_entries`).

Apply against the dev / testnet DB only — D5 of the plan accepts that the old
mainnet data is dropped. Recommended invocation:

```bash
# Verify the SQL one more time before apply.
less prisma/migrations/20260504150000_phase2_unified_content/migration.sql

# Apply against the configured DATABASE_URL/DIRECT_URL.
npx prisma migrate deploy --schema=prisma/schema.prisma

# Re-run client generation just in case.
npx prisma generate --schema=prisma/schema.prisma
```

If the dev DB is shared and prisma deploy is blocked, run the SQL directly via
psql or the Supabase SQL editor. The migration is idempotent on a fresh schema
but **NOT** on a half-migrated one — drop it manually if needed.

## Step 11 — Publish a fresh package

The publish script (`scripts/publish-soulidity-and-sync.ts`) already extracts
the `KindRegistryCreated` event and writes `kindRegistryId` into
`web/lib/soulidity/deployment-manifest.json`. The deployment.ts loader exposes
it as `NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID` via `getRequiredSoulidityEnv`,
so the new tx builders pick it up automatically.

Sample invocation (testnet):

```bash
sui client switch --env testnet
npm run publish:soulidity   # or whatever entrypoint runs publish-soulidity-and-sync.ts
```

What to verify after publish:

- `deployment-manifest.json.testnet.kindRegistryId` is populated and matches the
  `KindRegistryCreated.registry_id` event from `publishTxDigest`.
- All five built-in kinds were registered by the package's `init`. Inspect with:
  ```bash
  sui client object <kindRegistryId> --json | jq '.content.fields'
  ```
  Expected `next_kind: 16` (since 0..4 are pre-allocated, custom kinds start at 16).
- The `KindAdminCap` is held by the deployer pending multisig handoff. The
  precheck inside the publish script asserts the cap exists; the multisig
  handoff is a separate ceremony.

## Step 11.2 — Multisig handoff

`KindAdminCap` / `MarketAdminCap` / `UpgradeCap` should be transferred to the
multisig in the same PTB used for phase 1. Reuse the existing
`scripts/transfer-soulidity-caps.ts` flow (or whatever phase 1 used) — the
caps' Move types haven't changed.

Precheck the multisig owner:

```bash
sui client object <kindAdminCapId> --json | jq '.owner'
# expect: { "AddressOwner": "<multisig-address>" }
# NOT:    { "AddressOwner": "<deployer-address>" }
```

## Step 12 — Smoke tests

Each smoke runs against the freshly-published testnet package. The suggested
order matches the plan's acceptance gate:

### 12.1 Mint smoke (positive)

PTB body:

```ts
import { buildPublishSoulTx } from '@/lib/soulidity/tx/publish'
import { KIND_SOUL_DOC, KIND_MEMORY, KIND_SKILL, KIND_SPRITE,
  CANONICAL_SOUL_DOC_NAME, CANONICAL_MEMORY_NAME,
  READ_OWNER, READ_GRANT, READ_PUBLIC } from '@/lib/soulidity/kinds'

const tx = await buildPublishSoulTx({
  name, description, imageUrl, creatorRoyaltyBps: 250,
  initialContent: [
    { kind: KIND_SOUL_DOC, name: CANONICAL_SOUL_DOC_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT, downloadPolicy: 'owner_only',
      setActive: false, blobObjectId: soulMdBlob },
    { kind: KIND_MEMORY, name: CANONICAL_MEMORY_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT, downloadPolicy: 'owner_only',
      setActive: false, blobObjectId: foundingMemoryBlob },
    { kind: KIND_SKILL, name: 'default',
      slotReadModeMask: READ_OWNER | READ_GRANT, downloadPolicy: 'owner_only',
      setActive: false, blobObjectId: skillsBlob },
    { kind: KIND_SPRITE, name: 'persona-sprite',
      slotReadModeMask: READ_OWNER | READ_GRANT | READ_PUBLIC, downloadPolicy: 'public',
      setActive: true, blobObjectId: spriteBlob },
  ],
  initialStateConfig: [
    { key: 'sprite_config_json', valueUtf8: JSON.stringify(spriteConfig) },
    { key: 'sprite_mood_map_json', valueUtf8: JSON.stringify(moodMap) },
  ],
})
```

Expected events: `SoulMintedToKiosk`, `SoulContentCreated`, four
`ContentVersionAppended`, one `ActiveBindingUpdated`, one
`SoulPaidAccessListCreated`, two `SoulStateConfigUpserted`. The post-tx
sync route should mirror every projection.

### 12.2 Mint smoke (reverse — invariant violations)

- Drop SOUL_DOC from `initialContent` → expect `EInitialSoulDocCountMismatch`.
- Pass `name='other'` for SOUL_DOC → expect `EInitialSoulDocNameMismatch`.
- Drop MEMORY entry → expect `EInitialMemoryCountMismatch`.
- Pass MEMORY `name='custom'` → expect `EMemoryNameMismatch`.
- Pass SOUL_DOC `slot_read_mode_mask=READ_OWNER` only → expect
  `mint_rejects_owner_only_soul_doc_read_mode` abort path.

### 12.3 Grant smoke

Issue an active grant with `SCOPE_SEAL` to a viewer wallet, then call
`/api/souls/[id]/access` from that wallet → expect `accessKind: 'granted-agent'`
and a sealed payload referencing `seal_approve_content_granted_agent`.

Repeat with `SCOPE_MEMORY` and the route for `/api/souls/[id]/content/memory/default/versions/<latest>/access`.

Repeat with `SCOPE_ASSETS` and a sprite version → should grant.

`SCOPE_SKILLS` against a sprite should `403`.

### 12.4 Paid-access smoke

```bash
# Owner configures sprite paid access (kind=3, scope=SCOPE_ASSETS=8, price=1_000_000)
buildConfigurePaidAccessKindTx({
  paidAccessListObjectId, stateObjectId, kindRegistryObjectId,
  kind: KIND_SPRITE, priceAtomic: 1_000_000n,
  scopeMask: 8, durationMs: null,
})
# Buyer purchases
buildPurchasePaidAccessTx({
  paidAccessListObjectId, stateObjectId,
  kind: KIND_SPRITE, paymentCoinObjectIds: [...], totalAtomic: 1_025_000n, // includes platform fee
})
# Buyer requests access for the active sprite version → expect accessKind: 'paid'.
```

### 12.5 Public sprite smoke

Mint a sprite with `slotReadModeMask = READ_OWNER | READ_PUBLIC` and
`downloadPolicy = 'public'`. Anonymous viewer should hit the route and receive
either:

- `visibility: 'public-plaintext'` (when `sealEncrypted=false`, which Phase 2
  rejects at append time — so this branch should not appear today), OR
- `visibility: 'sealed'` with `accessKind: 'public'` and
  `functionName: 'seal_approve_content_public'`.

Pure-PUBLIC slot append (without READ_OWNER) must abort `EOwnerReadModeRequired`.

### 12.6 Memory delete smoke

```bash
# Append a second memory entry as owner.
buildAppendContentVersionAsOwnerTx({ ..., kind: KIND_MEMORY, name: CANONICAL_MEMORY_NAME, ... })
# Delete the entry as owner.
buildDeleteContentVersionAsOwnerTx({ ..., kind: KIND_MEMORY, name: CANONICAL_MEMORY_NAME, versionIndex: 1 })
# Attempt seal_approve on the deleted version → expect EVersionDeleted.
# Purge the deleted version.
buildPurgeContentVersionAsOwnerTx({ ..., versionIndex: 1 })
# Attempt seal_approve again → expect EVersionPurged.
```

### 12.7 Ownership rotation smoke

List + buy a Soul. After the purchase:

- All `SoulGrant` rows for the prior owner should auto-invalidate
  (ownership_epoch_snapshot mismatch).
- All `SoulPaidAccessEntry` rows for the prior buyer should fail
  `has_access` checks.
- A new owner reconfiguring `paid_access_kind` issues a config with the new
  ownership_epoch_snapshot, so the old buyer cannot use any prior entry until
  they re-purchase under the new owner.

Run `buildCleanupStalePaidAccessTx` against the rotated entries to reclaim
storage rebate.

## Acceptance gate

Step 12 passes when every above smoke matches the expected outcomes. Update
`tasks/todo.md` and the parent plan's Acceptance section as items complete.
