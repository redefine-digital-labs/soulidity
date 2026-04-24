# Sprite Lifecycle E2E Playbook

End-to-end verification of Soul persona sprite add/update/delete on Sui
testnet → Web mirror → Desktop consumption.

## Scope

- Script `web/scripts/e2e-sprite-lifecycle.ts` exercises `append` (public +
  Seal-private) / `activate` (public + owner_only) / `delete` / `clear` against
  an existing Soul, hitting both on-chain Move modules and the shared mirror
  helpers.
- Owner UI at `/souls/<id>` (block `PersonaAssetPanel`) publishes a new
  version + activates it in a single PTB.
- Desktop Electron app pulls the manifest via `/api/desktop/catalog/<id>`,
  downloads via Walrus or Seal, and renders through `SpriteRenderer`.
- `tests/new-web/desktop-sprite-contract.test.ts` covers the mirrored-contract
  reducer (policy flips, version drift, missing binding).
- `desktop/apps/desktop/e2e/sprite-flow.spec.ts` is a Playwright Electron
  smoke + opt-in live flow.

## Fixtures

Two real asset sets are bundled under `desktop/data/assets/`:

| Key | Path | Frame size | Cols × rows |
| --- | --- | --- | --- |
| `wusaqi` | `desktop/data/assets/wusaqi/sprite.png` + `manifest.json` | 512×512 | 8 × 7 |
| `walrus` | `desktop/data/assets/walrus/sprite.png` + `manifest.json` | 512×541 | 8 × 7 |

The script loads these directly. Each row is mapped to canonical animation
names (`idle`, `thinking`, `completed`, `working`, `needs-attention`, `error`,
`dragging`) via `buildSpriteConfig`.

## Environment

```
# Required for all flows
DATABASE_URL=postgresql://...
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_SOULIDITY_PACKAGE_ID=0x0b79af1ffb805632236370bba9539aacbb8f917e4a26a2761bc189f193b95205
NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID=0x0b79af1ffb805632236370bba9539aacbb8f917e4a26a2761bc189f193b95205

# Required for the script (owner-side)
OWNER_PRIVATE_KEY=suiprivkey1...   # must own the target Soul
SOUL_ON_CHAIN_ID=0x...

# Optional — override testnet Seal key servers / aggregator
NEXT_PUBLIC_SEAL_SERVER_CONFIGS=
NEXT_PUBLIC_SEAL_THRESHOLD=

# Required for Playwright live-flow gate
SOUL_SPRITE_LIVE=1                 # default: spec skips deep flow
SOULIDITY_WEB_URL=http://localhost:3100
```

Testnet Seal ships with a sane default key server (`0x73d05d…356db75`);
no extra env is required for private-path verification on testnet.

## Prerequisite Soul

The script mutates an existing Soul; it does not mint one. Use an already
published Soul (see `docs/e2e-test-results-new-web.md` for past runs) or
mint a fresh one via `/souls/create`. Record the `onChainId` as
`SOUL_ON_CHAIN_ID`.

## Three-terminal manual run

```
# T1 — web dev server
cd web
npm run dev              # :3100

# T2 — desktop dev
pnpm --dir desktop dev   # electron-vite dev window opens

# T3 — scripted lifecycle (with both public + private paths)
cd web
npx tsx scripts/e2e-sprite-lifecycle.ts run-all
```

Expected sequence:

1. `append wusaqi public` → Walrus blob uploaded, TX succeeds, DB
   `SoulAssetVersionRecord` row visible=public appears.
2. `activate versionIndex(0) wusaqi public` → on-chain metadata blob is
   upserted, `set_active_sprite` emits mutation; `SoulAsset.activeSpriteVersionIndex`
   turns 0, `downloadPolicy`=public.
3. Desktop → Library → **Refresh** → the target Soul surfaces in `My Souls`.
   Click **Download** → public path (direct Walrus URL) → **Activate** → the
   main window/floating ball renders wusaqi frames.
4. `append walrus private` → ciphertext uploaded, version 1 mirrored with
   `sealSidecar` populated (Seal envelope bound to
   `assetsObjectId|persona-sprite|1`).
5. `activate versionIndex(1) walrus owner_only` → `downloadPolicy`=owner_only.
6. Desktop → **Refresh** → card re-downloads, this time via Seal decrypt path
   (`/api/desktop/catalog/<id>?viewer=...` returns `visibility=private`,
   `accessPolicy.functionName` ∈ `seal_approve_*`). Sprite animation changes to
   walrus frames.
7. `delete versionIndex(0)` → `delete_version_as_owner` succeeds; DB row gets
   `deletedAt` stamp, `GET /api/souls/<id>/assets` no longer returns v0.
8. `clear` → `clear_active_sprite`. `activeSpriteAssetName` goes null; desktop
   after Refresh falls back to starter persona.

## UI-driven alternative

Log in as owner of `SOUL_ON_CHAIN_ID`, navigate to `/souls/<id>`, scroll to
the **Persona Sprite** panel:

- **Sprite sheet PNG** + **Sprite config JSON** dropzones, visibility toggle
  (`Public` / `Private (owner_only)`).
- **Upload & Set Active** signs one PTB that appends + upserts sprite.config
  + upserts sprite.mood_map + set_active_sprite, then mirrors via
  `POST /api/souls/<id>/assets` (which runs `syncSoulProjectionFromChain`
  and picks up the metadata changes automatically).
- Row **Delete** button runs `delete_version_as_owner` + mirror.
- **Clear Active** runs `clear_active_sprite` + `POST /api/souls/<id>/metadata`.

Match with a running desktop app to watch the sprite swap in real time.

## Automated vitest slice

```
cd /Users/admin/Desktop/nao/clawnews
npx vitest run tests/new-web/desktop-sprite-contract.test.ts
npx vitest run tests/desktop/sprite-animation-resolution.test.ts
```

Six manifest-reducer cases cover public/owner_only happy paths, version
drift, policy ↔ visibility mismatches, and the missing-binding fallback.

## Playwright Electron E2E

One-time setup:

```
cd desktop
pnpm install                 # picks up @playwright/test
pnpm --dir apps/desktop exec playwright install chromium
pnpm --filter @soulidity/desktop run build
```

Run smoke only (fast, no external services):

```
pnpm --filter @soulidity/desktop run e2e -- -g "boots"
```

Run live flow (requires T1 web + T3 script completed):

```
SOUL_SPRITE_LIVE=1 SOUL_ON_CHAIN_ID=0x... SOULIDITY_WEB_URL=http://localhost:3100 \
  pnpm --filter @soulidity/desktop run e2e
```

The spec launches the built Electron bundle at `out/main/index.js`, opens
the Library tab, clicks Refresh, waits for a persona card, and (in live
mode) drives the full download → activate path for the target Soul and
snapshots a canvas pixel hash to prove a sprite actually rendered.

## Cleanup

```
# on-chain — optional: delete inactive listings / free blobs
# script reuses ContentAccessList owner API; see e2e-content-access-lifecycle.

# DB rows created by the lifecycle
DELETE FROM soul_asset_version_records WHERE asset_name = 'persona-sprite' AND soul_on_chain_id = $1;
UPDATE soul_assets
  SET active_sprite_asset_name = NULL,
      active_sprite_version_index = NULL,
      active_sprite_download_policy = NULL,
      sprite_config_json = NULL,
      sprite_mood_map_json = NULL
  WHERE on_chain_id = $1;
```

## Acceptance

- Every script subcommand prints a JSON block with `digest` + DB read-back;
  no step reports a mismatch.
- Owner UI on a fresh sprite upload shows the new version in the list
  within one second of the mirror call returning.
- Desktop Refresh on either side transitions between public + private paths
  without errors in console (verified via DevTools `Ctrl+Shift+I`).
- Vitest + Playwright smoke pass in CI; live Playwright runs on-demand with
  the env gate.
