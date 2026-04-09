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
