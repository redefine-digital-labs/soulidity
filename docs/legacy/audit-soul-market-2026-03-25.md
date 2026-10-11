# Soul Market Move Security Audit Report

> Historical audit of the legacy `soul_market` package. The `grant` / pass wording below is archival and does not describe the current allowlist Soul contract.

**Package**: `soul_market` | **Chain**: Sui | **Version**: 1 (testnet) | **Modules**: 6 (`series`, `pass`, `purchase`, `grant`, `seal_policy`, `events`)
**Date**: 2026-03-25 | **Auditor**: Claude Opus 4.6 (automated)

---

## Executive Summary

**Overall Risk: LOW**. The contract is well-architected with no critical or high-severity findings. The codebase demonstrates strong Sui/Move security practices: proper capability management, comprehensive access control, event emission, and comprehensive test coverage (112 tests covering all error branches).

---

## Abilities & Capability Audit

| Struct | Abilities | Assessment |
|--------|-----------|------------|
| `AuthorCap` | `key` only | **SECURE** — no `store`, prevents `public_transfer` bypass |
| `SoulSeries` | `key` only | **SECURE** — shared object, no free transfer |
| `SoulRelease` | `key` only | **SECURE** — frozen via `transfer::freeze_object` |
| `PerpetualPass` | `key` only | **SECURE** — no `store`, forces package transfer |
| `SubscriptionPass` | `key` only | **SECURE** — same as perpetual |
| `PlatformConfig` | `key` only | **SECURE** — shared singleton |
| `PricingPlan` | `key` only | **SECURE** — shared, deactivatable |
| All events | `copy, drop` | **OK** — correct for events |

No struct has `copy` or `drop` on value-holding types. No capability leak vectors.

---

## Access Control Matrix

| Function | Auth Mechanism | Verified |
|----------|---------------|----------|
| `create_series_entry` | `ctx.sender()` becomes author | OK |
| `publish_release` | `cap.series_id == id(series)` **AND** `series.author == sender` | OK |
| `update_series_metadata` | Same double-check | OK |
| `transfer_author_cap` | Same + `recipient != 0x0` + no self-transfer | OK |
| `create_pricing_plan` | AuthorCap + sender match | OK |
| `deactivate_pricing_plan` | AuthorCap + sender match + plan active + registry match | OK |
| `buy_perpetual` / `buy_subscription` | Anyone with correct USDC payment | OK |
| `renew_subscription` | Pass owner OR granted agent | OK |
| `set/revoke agent grant` | Pass owner only | OK |
| `transfer pass` | Pass owner only + clears agent grant | OK |
| `seal_approve_*` | Owner OR agent grant holder | OK |
| `update_platform_config` | Admin only | OK |
| `pause_platform` / `unpause_platform` | Admin only | OK |
| `propose/accept admin transfer` | 2-step (current admin proposes, new admin accepts) | OK |

---

## Findings

### ~~MEDIUM — M1: Missing event for `update_platform_config`~~ **RESOLVED**

**Status**: Fixed. `update_platform_config` now emits `PlatformConfigUpdated { fee_recipient, fee_bps }` on every call.

---

### ~~MEDIUM — M2: Subscription renewal locked out on plan period change~~ **RESOLVED**

**Status**: Fixed. Renewal now adopts the current plan's `period_ms`, naturally migrating subscribers to new terms on their next renewal. The `E_PERIOD_MISMATCH` check and constant have been removed. See `renew_subscription_migrates_to_new_plan_period` test.

---

### LOW — L1: Duplicate perpetual purchases allowed

**File**: `purchase.move:213-214`

```move
/// Note: Duplicate purchases for the same release are allowed by design.
/// Frontend callers should warn users before repeat purchases.
```

Already documented. No on-chain prevention of accidental double-buy. Acceptable given the comment, but frontend must guard this.

---

### ~~LOW — L2: Empty description allowed~~ **RESOLVED**

**Status**: Fixed. `validate_metadata` now asserts `description.length() > 0` via `E_DESCRIPTION_EMPTY`. See `create_series_rejects_empty_description` test.

---

### LOW — L3: No refund or cancellation mechanism

Once USDC is transferred in `buy_perpetual`, `buy_subscription`, or `renew_subscription`, there is no refund path. This is standard for on-chain marketplaces but worth documenting for buyers.

---

### ~~LOW — L4: No pause/emergency stop~~ **RESOLVED**

**Status**: Fixed. `PlatformConfig` now has a `paused: bool` field. Admin can call `pause_platform` / `unpause_platform`. All purchase and renewal functions check `!config.paused` as first assertion. Events: `PlatformPaused`, `PlatformUnpaused`.

---

### ~~LOW — L5: Incomplete test coverage for error branches~~ **RESOLVED**

**Status**: Fixed. 32 new tests added (112 total, up from 80). All error branches now have `#[expected_failure]` tests:
- **purchase.move**: `E_NOT_ADMIN` (x3: update_config, propose_transfer, pause), `E_INVALID_PLAN_TYPE`, `E_INVALID_PRICE`, `E_WRONG_PLAN_TYPE` (x2), `E_RELEASE_MISMATCH`, `E_INVALID_FEE_BPS`, `E_PERIOD_EXCEEDS_MAX`, `E_NO_PENDING_ADMIN`, `E_NOT_PENDING_ADMIN`, `E_PLATFORM_PAUSED` (x3)
- **series.move**: `E_NAME_EMPTY`, `E_CATEGORY_EMPTY`, `E_DESCRIPTION_EMPTY`, `E_NAME_TOO_LONG`, `E_DESCRIPTION_TOO_LONG`, `E_CATEGORY_TOO_LONG`, `E_TAG_TOO_LONG`, `E_TOO_MANY_PREVIEW_IMAGES`, `E_PREVIEW_IMAGE_TOO_LONG`, `E_RELEASE_BLOB_ID_TOO_LONG`, `E_RELEASE_PUBLIC_METADATA_ID_TOO_LONG`, `E_PLAN_TYPE_NOT_ACTIVE`
- **seal_policy.move**: `ESeriesMismatch` (x2: perpetual + subscription), `EReleaseMismatch`

---

### INFO — I1: Deactivated PricingPlan shared objects persist forever

Sui shared objects cannot be deleted. Deactivated plans remain on-chain, contributing to state growth. This is inherent to the Sui model.

---

### INFO — I2: No secondary market royalties

Pass transfers via `transfer_perpetual_pass`/`transfer_subscription_pass` are free — no fee to author or platform. If secondary market revenue is desired, this needs a custom transfer policy or Kiosk integration.

---

### ~~INFO — I3: Agent cannot renew subscription on behalf of owner~~ **RESOLVED**

**Status**: Fixed. `renew_subscription` now checks `is_owner || is_agent` (same pattern as `seal_approve_subscription`). See `renew_subscription_allows_granted_agent` test.

---

### INFO — I4: UpgradeCap on-chain state not verifiable from repo

**File**: `Published.toml:12`

```
upgrade-capability = "0x7c86...56d1"
```

`Published.toml` records the UpgradeCap object ID, but the repository contains no evidence of its current on-chain control status (single holder / multisig / immutable). Before mainnet, verify the UpgradeCap's actual state on-chain and consider calling `sui::package::make_immutable` or transferring it to a multisig.

---

## Positive Security Patterns

| Pattern | Implementation |
|---------|---------------|
| **No capability leak** | AuthorCap lacks `store` — forced through `transfer_author_cap` |
| **Double auth check** | All author operations verify both cap and sender |
| **2-step admin transfer** | Prevents accidental admin loss |
| **Agent grant cleared on pass transfer** | Prevents lingering access |
| **Releases are frozen** | Immutable after creation via `freeze_object` |
| **Exact payment matching** | Rejects both over- and underpayment |
| **Active plan registry** | Prevents use of stale/deactivated plans in purchases |
| **Input validation** | Length limits on all string fields + non-empty checks on all required fields (name, description, category, version, blob_id, content_hash, public_metadata_id) |
| **u128 intermediate for fee calc** | Prevents overflow in `fee_amount_for_price` |
| **Seal document ID binding** | Perpetual: binds to series+release. Subscription: requires nonce suffix |
| **Comprehensive test suite** | 112 tests covering happy paths and all error branches |
| **Emergency pause** | Admin can halt all purchases/renewals via `pause_platform`; events emitted |

---

## Summary Table

| Severity | Count | Findings |
|----------|-------|----------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | ~~M1~~ resolved, ~~M2~~ resolved |
| Low | 2 | L1 (duplicate buy), ~~L2~~ resolved, L3 (no refund). ~~L4~~ resolved, ~~L5~~ resolved |
| Info | 3 | I1 (state growth), I2 (no royalties), ~~I3~~ resolved, I4 (UpgradeCap state unverified) |

**Verdict**: All medium and actionable low findings resolved. Remaining L1 (duplicate buy by design) and L3 (no refund, standard) are accepted design trade-offs. UpgradeCap on-chain state should be verified before mainnet (see I4). 112 tests, emergency pause, full event coverage. The contract demonstrates solid Sui Move security practices.
