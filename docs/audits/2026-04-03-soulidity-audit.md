# Soulidity Smart Contract Security Audit

**Date**: 2026-04-03
**Scope**: `move/soulidity/sources/` (8 modules, ~1150 LOC)
**Framework**: Sui Move (edition 2024.beta)
**Dependencies**: Sui framework, Kiosk extensions (personal_kiosk, kiosk_lock_rule, personal_kiosk_rule, witness_rule), Walrus blob storage, USDC
**Test coverage**: 29 test functions in `protocol_tests.move`

---

## Architecture

| Module | Role | Key Objects |
|--------|------|-------------|
| `soul` | Core NFT + ownership state | `Soul` (kiosk-locked), `SoulState` (shared) |
| `market` | Marketplace, kiosk management, minting | `MarketConfig` (shared), `SoulListing` / `CollectionListing` (shared) |
| `grant` | Scoped, time-limited access delegation | `SoulGrant` (owned by grantee) |
| `skills` | Versioned skill blob storage + Seal read approval | `SoulSkills` (shared), `SkillVersion` (shared) |
| `memory` | Append-only memory log | `SoulMemory` (shared), `MemoryEntry` (shared) |
| `collection` | Soul groupings with extra royalties | `SoulCollection` (shared), `SoulCollectionRight` (kiosk-locked) |
| `seal_policy` | Seal document access control | entry functions only |

**Payment model**: USDC payment handled outside kiosk mechanism; kiosk purchase at 0 SUI for transfer policy compliance.

**Transfer policy**: Triple rule — `kiosk_lock_rule` + `personal_kiosk_rule` + `witness_rule` (module-scoped proof types `SoulMarketProof` / `CollectionMarketProof`).

---

## Security Checklist

| Check | Result |
|-------|--------|
| One-Time Witness pattern (SOUL, COLLECTION, MARKET) | Pass |
| Transfer policy triple-rule enforced on all transfers | Pass |
| Admin cap isolation (MarketAdminCap, no public leak) | Pass |
| Shared object authorization (sender checks on mutations) | Pass |
| Object ID / soul_id cross-validation in all entry points | Pass |
| Grant epoch-pinning + invalidation on ownership rotation | Pass |
| Overflow protection (u128 intermediates, MAX_U64 bound) | Pass |
| Payment exact-match assertion (no over/underpayment) | Pass |
| No reentrancy vectors (Sui object model, no callbacks) | Pass |
| Seal document_id domain prefix + nonce length validation | Pass |
| Scope mask bitmask validation against `all_scopes()` | Pass |
| Grant expiry cleanup before capacity check | Pass |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Informational | 5 |

---

### L-1: Personal kiosk registration has no rotation or recovery path

**Status (2026-04-23)**: RESOLVED — fixed together with M-1 (see §Fix Log).

**Location**: `market.move:1070-1086`

`register_personal_kiosk` stores `PersonalKioskOwnerKey { owner }` as a dynamic field on `MarketConfig`. The mapping is one-to-one and permanent: no admin or user function exists to update or remove the registration.

`PersonalKioskCap` is `key` only (no `store`), limiting transfer vectors to `transfer_to_sender` within the defining module. This significantly reduces the realistic probability of loss compared to `key + store` capabilities. The finding is a UX/operational gap rather than a high-risk asset-lock scenario.

**Impact**: If a user somehow loses access to their registered kiosk context, there is no on-chain recovery path through the market module.

**Recommendation**: Consider adding an admin-gated `reset_personal_kiosk_registration` for exceptional recovery cases. Priority is low given the `key`-only constraint on the cap.

---

### Informational

#### I-1: Grant return-to-caller requires same-PTB transfer

`grant::issue()` and `grant::revoke_scope()` return `SoulGrant` to the owner (caller). The owner must `transfer::public_transfer` the grant to the grantee within the same Programmable Transaction Block. Frontend TX builders already handle this correctly (`new-web/lib/soulidity/tx/grant.ts`).

#### I-2: Basis-point rounding truncates to zero on micro prices

`bps_amount` (`market.move:1066`) rounds down: `(price * bps) / 10_000`. For sub-unit prices (e.g., price=9, bps=1000), royalty computes to 0. Negligible for realistic USDC amounts (6 decimal places).

#### I-3: Publisher burned in init — Display templates require upgrade to change

`soul::init`, `collection::init`, and `market::init` all burn the `Publisher` after creating Display objects. Display field updates require a package upgrade. This is an operational flexibility trade-off, not a security concern.

#### I-4: `ensure_personal_kiosk_registered` silent return on re-registration

**Status (2026-04-23)**: RESOLVED — now insert-or-assert; a mismatched `(kiosk_id, kiosk_cap_id)` hard-aborts with `EPersonalKioskMismatch` instead of silently overwriting. First-time registrations still emit `PersonalKioskRegistrationUpdated`; idempotent repeat calls remain no-ops by design (see §Fix Log).

`market.move:298-313` — when the kiosk is already registered, the function returns without emitting an event. Off-chain indexers cannot distinguish first-time from repeat registration calls without querying dynamic fields directly.

#### I-5: Cancellation works when market is paused (good design)

`cancel_soul_listing` and `cancel_collection_listing` do not check `config.paused`. This is correct — sellers must always be able to recover their `PurchaseCap` regardless of market pause state.

---

## Overall Assessment

**Rating: Strong**

The Soulidity contract suite demonstrates solid Sui Move security practices:

- **Kiosk-locked ownership** with enforced transfer policies prevents unauthorized Soul/CollectionRight extraction.
- **Grant epoch-pinning** ensures all active grants are automatically invalidated on ownership rotation, preventing stale-grant access after purchase.
- **Proper OTW patterns** and Publisher handling follow Sui best practices.
- **Arithmetic safety** uses u128 intermediates with explicit overflow bounds.
- **Shared object mutations** are correctly gated by `assert_owner` / `assert_active_with_scope` checks.

No critical, high, or medium severity security vulnerabilities were identified. The single low-severity finding is an operational recovery gap with limited real-world exploitability.

---

## Fix Log

### 2026-04-23 — Registry rebind split (L-1 + I-4)

A follow-up audit pass flagged a UX-trap variant of L-1: `ensure_personal_kiosk_registered` (and `register_existing_personal_kiosk`) previously upserted the registry. A user re-registering with a second `PersonalKioskCap` would silently repoint `PersonalKioskOwnerKey { owner }` at the new kiosk, orphaning any Soul still locked in the old one (every list/buy path asserts `SoulState.current_kiosk_id == object::id(kiosk_obj)` AND the registry match — once the pointer moves, those Souls can no longer be listed or purchased, and `kiosk::lock` + `witness_rule<SoulMarketProof>` blocks any non-market extraction).

**Changes** (`move/soulidity/sources/market.move`):

- `insert_or_assert_personal_kiosk_registration` — renamed from `upsert_personal_kiosk_registration`. Inserts on first call; subsequent calls with the same `(kiosk_id, kiosk_cap_id)` are no-ops; mismatched re-registration aborts with `EPersonalKioskMismatch`. Backs both `register_existing_personal_kiosk` and `ensure_personal_kiosk_registered`.
- `rebind_primary_kiosk(config, registry, old_kiosk: &Kiosk, new_personal_kiosk_cap, ctx)` — new public recovery path. Enforces:
  - caller already has a registration (`EPersonalKioskNotInitialized`),
  - `old_kiosk` matches the currently-registered kiosk id (`EOldKioskMismatch`),
  - `old_kiosk` holds zero items via `kiosk::item_count` (`EOldKioskNotEmpty`),
  - old and new kiosks are different objects (`ERebindSameKiosk`).
  Emits `PersonalKioskRebound { owner, old_kiosk_id, old_kiosk_cap_id, new_kiosk_id, new_kiosk_cap_id }`.
- New error codes: `EOldKioskNotEmpty=31`, `EOldKioskMismatch=32`, `ERebindSameKiosk=33`.

**Test coverage** (`move/soulidity/sources/protocol_tests.move`):

- `rebind_primary_kiosk_succeeds_when_old_kiosk_is_empty` — rebind from fresh empty kiosk to replacement succeeds; `reuse_personal_kiosk` returns the new id.
- `rebind_primary_kiosk_fails_when_old_kiosk_has_soul` — mint a Soul first, rebind aborts `EOldKioskNotEmpty`.
- `rebind_primary_kiosk_fails_when_caller_unregistered` — unrelated sender without registration aborts `EPersonalKioskNotInitialized`.
- `rebind_primary_kiosk_fails_on_mismatched_old_kiosk` — passing a non-registered kiosk as `old_kiosk` aborts `EOldKioskMismatch`.
- `rebind_primary_kiosk_fails_on_same_kiosk` — old == new aborts `ERebindSameKiosk`.
- `ensure_personal_kiosk_registered_is_idempotent_for_same_cap` — replays the same cap twice; second call is a silent match.
- `personal_kiosk_mismatch_fails` — existing test; abort now fires earlier at the registry boundary rather than at `list_soul_fixed_price`. Test comment updated accordingly.

**SDK**: `web/lib/soulidity/tx/kiosk-management.ts::buildRebindPrimaryKioskTx` wires the on-chain call; validation tests live in `tests/new-web/soulidity-tx-builders.test.ts`. Existing `shared.ts` / `list.ts` / `update-price.ts` / `update-collection-price.ts` builders that call `ensure_personal_kiosk_registered` remain correct under the tighter semantics because they always pass the user's current cap (idempotent match).

**Known residuals**: Frontend does not yet expose a UI affordance for rebind. The SDK builder is in place for when an operator flow needs it.

### 2026-04-23 — Content access entries are now epoch-pinned (M-2)

Follow-up audit identified an economic and access-control asymmetry: `ContentAccessList.entries` persisted across Soul ownership transfer even though `purchase_content_access` pays the *current* owner. Consequences: (1) a selling owner could batch-sell cheap entries just before listing the Soul, sticking the next owner with "free-riding" subscribers; (2) entries bypassed the `ownership_epoch_snapshot` contract that `SoulGrant` uses for auto-invalidation on transfer. Upstream `SoulGrant.invalidate_all_for_owner_rotation` wipes active grants on sale — content access now has the equivalent guarantee.

**Changes** (`move/soulidity/sources/content_access.move`):

- `ContentAccessEntry` — new `ownership_epoch_snapshot: u64` field, written at `record_purchase` / `add_access` time from `soul::ownership_epoch(state)`.
- `ContentAccessGranted` — event adds `ownership_epoch_snapshot` for mirror parity.
- `has_access(list, state, addr, scope, clock)` — signature now requires `&SoulState`; asserts `list.soul_id == soul::soul_id(state)` and returns false whenever the entry's epoch snapshot no longer matches the state's current epoch (in addition to the existing scope / expiry checks).
- `record_purchase(list, state, buyer, price, clock)` — signature gains `state: &SoulState`; the "renewal" branch now treats stale-epoch entries as overwritable in addition to expired entries, so a previous buyer can re-purchase under the new owner.
- `add_access` — same epoch-aware renewal logic.
- `seal_approve_skill_allowlisted` / `seal_approve_asset_allowlisted` — pass `state` to `has_access`.
- `market::purchase_content_access` — threads `state` into `record_purchase`.

**Test coverage** (`move/soulidity/sources/protocol_tests.move`):

- `content_access_invalidates_and_allows_repurchase_after_ownership_rotation` — end-to-end: buyer purchases under creator, Soul sells to secondary, `has_access` flips false, entry row retained (`entry_count == 1`), buyer can repurchase under new owner to regain access.
- `seal_approve_asset_allowlisted_fails_after_ownership_rotation` — same ownership rotation, seal approval aborts `EScopeMismatch` because the wrapping `has_access` returns false.
- All 11 existing `content_access::has_access` test call sites updated to the new signature. Total Move tests: 149/149 pass.

**Mirror / API** (Prisma + TS):

- `prisma/schema.prisma::ContentAccessRecord` — adds `ownershipEpochSnapshot: Int @map("ownership_epoch_snapshot")`.
- Migration `prisma/migrations/20260423130000_content_access_epoch_snapshot/` — `ADD COLUMN NOT NULL DEFAULT 0`, then `DROP DEFAULT`.
- `web/lib/soulidity/events.ts` — `extractContentAccessGrantedEvent` and `extractMatchedContentAccessGrantedEvent` return `ownershipEpochSnapshot`.
- `web/lib/soulidity/mirror/upsert-content-access.ts` + `web/lib/soulidity/mirror/sync-helpers.ts` — write the snapshot on both insert and update branches.
- `web/app/api/souls/[id]/access-list/add/route.ts` + `…/purchase/route.ts` — persist the snapshot from the grant event.
- `web/lib/soulidity/asset-version-access.ts` + `web/app/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts` — `findFirst` filters on `ownershipEpochSnapshot: state.ownershipEpoch`; stale entries return 403 before a Seal round-trip.

**Deferred**: No UI changes. `GET /api/souls/[id]/access-list` already returns the snapshot via Prisma's default selection; if a subscriber-dashboard ever wants to render "stale" badges, it can join against the Soul's current epoch client-side.
