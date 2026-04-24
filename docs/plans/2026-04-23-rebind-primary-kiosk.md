# Primary Kiosk Rebind — Split-API Recovery Path

**Status**: Implemented 2026-04-23. Contract + SDK landed; frontend exposure deferred.

**Goal**: Close the M-1 "silent kiosk overwrite orphans locked Souls" gap surfaced during the follow-up Sui audit (see `docs/audits/2026-04-03-soulidity-audit.md` Fix Log). Preserve the ability to repoint a user's primary personal kiosk when needed, but hard-block the path that could strand Soul objects.

## Background

Every Soul mint in `market.move` locks the `Soul` into the caller's personal kiosk via `kiosk::lock` and an enforced triple-rule transfer policy (`kiosk_lock_rule` + `personal_kiosk_rule` + `witness_rule<SoulMarketProof>`). Only `market::buy_soul_impl` can construct `SoulMarketProof`, so Souls cannot leave their origin kiosk outside a market purchase.

The shared `KioskRegistry` maps `PersonalKioskOwnerKey { owner } → PersonalKioskRegistration { kiosk_id, kiosk_cap_id }` (one entry per owner). Every list/buy entrypoint asserts both `state.current_kiosk_id == object::id(kiosk_obj)` AND the registry points at that same kiosk.

Prior behaviour: `register_existing_personal_kiosk` and `ensure_personal_kiosk_registered` upserted the registry. A user re-registering with a second cap silently repointed the registry to a new kiosk; any Soul locked in the old one became unreachable from list/buy paths with no recovery.

## Design

Split the API into two entrypoints with separate invariants:

1. **Idempotent registration** (`ensure_personal_kiosk_registered` / `register_existing_personal_kiosk`) — backed by a renamed helper `insert_or_assert_personal_kiosk_registration`:
   - First call inserts the registration and emits `PersonalKioskRegistrationUpdated`.
   - Repeat calls with the same `(kiosk_id, kiosk_cap_id)` are silent no-ops.
   - Re-registration with a different kiosk/cap hard-aborts `EPersonalKioskMismatch`.

2. **Explicit rebind** (`rebind_primary_kiosk`) — the only public path that may change which kiosk an owner's registration points at:
   - Caller must already be registered (`EPersonalKioskNotInitialized`).
   - `old_kiosk: &Kiosk` must match the currently-registered kiosk id (`EOldKioskMismatch`).
   - `kiosk::item_count(old_kiosk) == 0` — old kiosk must be empty (`EOldKioskNotEmpty`).
   - Old and new kiosks must be distinct objects (`ERebindSameKiosk`).
   - Emits `PersonalKioskRebound { owner, old_kiosk_id, old_kiosk_cap_id, new_kiosk_id, new_kiosk_cap_id }` for indexer observability.

This keeps the "rebind to a replacement kiosk" capability (existed as the now-renamed `stale_personal_kiosk_registration_can_be_rebound_to_current_cap` test) while making it impossible to orphan Souls via the ordinary register/ensure entrypoints.

## Changes Landed

### Contract (`move/soulidity/sources/market.move`)

- New error codes: `EOldKioskNotEmpty=31`, `EOldKioskMismatch=32`, `ERebindSameKiosk=33`.
- New event: `PersonalKioskRebound`.
- New public function: `rebind_primary_kiosk(config, registry, old_kiosk, new_personal_kiosk_cap, ctx)`.
- Renamed helper: `upsert_personal_kiosk_registration` → `insert_or_assert_personal_kiosk_registration` with the stricter semantics described above.

### Tests (`move/soulidity/sources/protocol_tests.move`)

Renamed/updated:
- `stale_personal_kiosk_registration_can_be_rebound_to_current_cap` → `rebind_primary_kiosk_succeeds_when_old_kiosk_is_empty` (now exercises the new entrypoint).
- `personal_kiosk_mismatch_fails` comment updated: abort now fires at the registry boundary rather than at `list_soul_fixed_price`.

Added:
- `rebind_primary_kiosk_fails_when_old_kiosk_has_soul` — mints a Soul then tries to rebind.
- `rebind_primary_kiosk_fails_when_caller_unregistered` — sender has no registration.
- `rebind_primary_kiosk_fails_on_mismatched_old_kiosk` — `old_kiosk` does not match registry.
- `rebind_primary_kiosk_fails_on_same_kiosk` — rebind to self aborts.
- `ensure_personal_kiosk_registered_is_idempotent_for_same_cap` — confirms repeat-with-same-cap is a silent match.

Total Move tests: 147/147 passing.

### SDK (`web/lib/soulidity/tx/kiosk-management.ts`)

- New `buildRebindPrimaryKioskTx({ oldKioskId, newKioskCapOnChainId })` — single `rebind_primary_kiosk` move call, validates required params and non-collision.
- Unit tests in `tests/new-web/soulidity-tx-builders.test.ts` (4 cases: happy path, empty oldKioskId, empty newCap, collision). 119/119 builder tests passing.

Existing callers of `ensure_personal_kiosk_registered` (`shared.ts::buildBuyerKioskArgs`, `list.ts`, `update-price.ts`, `update-collection-price.ts`, `scripts/batch-publish.ts`) remain correct under the tighter semantics — they always present the user's current cap, which matches the registered record.

### Documentation

- `docs/audits/2026-04-03-soulidity-audit.md` — L-1 and I-4 annotated as resolved; new Fix Log section documents the change.
- This plan file for future reference.

## Deferred

- **Frontend UI**: No rebind affordance is exposed in any current screen. The SDK builder is available for when an operator flow needs it (e.g. a settings page "switch primary kiosk" action). Adding UI would also need an API endpoint if mirror state needs to reflect the new `primaryKioskId` — at present the mirror only tracks per-Soul `currentKioskId`, so observing `PersonalKioskRebound` is indexer-only.
- **Desktop SDK**: `desktop/apps/desktop/src/renderer/lib/soulidity/tx/` currently only carries `publish.ts` and `shared.ts`. Rebind is not a publish flow, so no desktop builder is needed yet.

## Verification

- `sui move test` → 147 pass, 0 fail.
- `npx vitest run tests/new-web/soulidity-tx-builders.test.ts` → 119 pass.
- `npm run typecheck:web` → clean.
