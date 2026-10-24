# Soulidity market / collection / soul custody review (independent, static)

Scope: `move/soulidity/sources/market.move` (3239 lines, read fully), `collection.move`, `soul.move` (ownership / listing / rotation / equipment binding), `animacraft_v8_binding.move` and `animacraft_equipment_adapter_v8.move` only where they touch listing / transfer / rotation. Tests used as intent reference. Dependency semantics verified against source: `sui::kiosk`, `sui::transfer_policy`, `sui::derived_object` (mainnet checkout; the a4185da checkout pre-dates `derived_object`), `kiosk::personal_kiosk`, `kiosk_lock_rule`, `personal_kiosk_rule`, `witness_rule`. `animacraft_v8_*` treated as a trusted external boundary (sources not available). No build / test run was possible (local deps missing). `docs/audits/` was not read.

Legend: file = `market.move` unless stated. Line numbers refer to the worktree at HEAD (`claude/sui-move-security-audit-a4d203`).

## (a) Findings table

| ID | Severity | Location | Title | Confidence |
|----|----------|----------|-------|------------|
| MK-1 | Medium | market.move:1515-1529, 1574-1603, 2593-2603; soul.move:465-479; content.move:521-539 | Reserved `content_seal_envelope_v1:` state-config namespace is only protected at mint; the current owner can overwrite / delete Seal envelopes post-mint via `set_state_config*` / `delete_state_config*` (silent pre-sale content rug, invariant broken) | Medium |
| MK-2 | Low | collection.move:193-222; market.move:600-614 (610), 1617, 1668, 1723, 1751 | `collection::add_soul` accepts Animacraft-native Souls; binding is irreversible, so the Soul becomes permanently unlistable on every path | High |
| MK-3 | Low | collection.move:193-222; market.move:1669-1676, 2790-2795, 557-567 | `add_soul` does not check `platform + creator + extra <= 10_000`; a high-royalty Soul bound into a collection cannot be listed (solo path requires no collection) until admin lowers the platform fee | High |
| MK-4 | Low | market.move:924-948, 984-1016, 3049-3079 | Kiosk registration (`ensure_personal_kiosk_registered*`, `rebind_primary_kiosk*`) does not require the kiosk to be a shared object; owned kiosks yield unsettleable listings and Souls bought into them become permanently untradeable (owned objects cannot be shared later) | Medium |
| MK-5 | Informational | market.move:120-126, 876-898, 1036-1075, 1607-1711, 1808-1875, 2908-2998 | Full V1 (`MarketConfig`) entry-point surface retained; unreachable on a fresh publish (no V1 constructor) but version-agnostic settlement (`buy_soul_impl` accepts listing `version` 1 or 2 interchangeably) and a parallel pause model would become live if this source is published as an upgrade of a deployment holding a V1 config | High |
| MK-6 | Informational | soul.move:264-272, 444-449, 589-608; animacraft_equipment_adapter_v8.move:21-38, 74-84 | Equipment binding (DF10) blocks `set_listed(true)` and `rotate_owner`; the only release path needs the `MakerLoadoutV8` object by value. If that object is lost/moved, the Soul is permanently unlistable; no admin recovery exists | Low (external abilities unverified) |
| MK-7 | Informational | market.move:2982-2985, 753-756, 2162-2165, 3130-3136 | Purchase flows hard-code exactly three receipts; the admin-held `TransferPolicyCap` can add a rule (bricks all buys until removed) or remove `witness_rule` (then raw `kiosk::list/purchase` moves Souls between kiosks without touching `SoulState`, desyncing owner/kiosk/epoch) | High (admin-trust) |
| MK-8 | Informational | market.move:2530-2532, 1280-1283, 1328-1331, 2416-2466, 163-166 | `KioskRegistry` is `&mut` on every mint (derived-object claim + joined-source marker) -> global sequencing hot spot and unbounded dynamic-field growth; `delete_*_listing` lets anyone capture the storage rebate; `commit_mint_manifest` is unauthenticated event spam | High |
| MK-9 | Informational | market.move:1260-1353 | `mint_joined_in_personal_kiosk*<T>`: `T` unconstrained (any `key+store`, including `Soul`/`Coin`), source id not recorded on the Soul or in any event, and `JoinedSourceKey` permanently reserves object ids the caller merely held in their kiosk | High |
| MK-10 | Informational | market.move:2924-2931 vs 696-706 | `buy_soul_impl` does not cross-check `listing.seller == soul::current_owner(state)` / `listing.seller_kiosk_id == soul::current_kiosk_id(state)` (the V8 path does); currently no reachable divergence, defense-in-depth only | High |
| MK-11 | Informational | soul.move:625-626; market.move:1168-1174 | `Display.link` / `project_url` render the unverified free-form `origin_ref` of imported / joined Souls (wallet phishing surface) | High |
| MK-12 | Informational | market.move:629, 667 | Native (V8) list / buy require `platform_fee_bps == 250` exactly; any admin fee change freezes the whole native secondary market (cancel still works) | High |

No Critical or High finding was verified.

## (b) Finding details

### MK-1 (Medium) Reserved Seal-envelope namespace is writable / deletable by the current owner after mint

Location: `market.move:1515-1529` (`set_state_config`), `1574-1588` (`set_state_config_v2`), `1531-1544` / `1590-1603` (`delete_state_config*`), `2575-2603` (`apply_initial_state_config` + `assert_initial_config_key_unreserved`), `soul.move:465-479` (`upsert_state_config` / `delete_state_config`), `content.move:521-539` (`envelope_config_key`, `persist_append_envelope`).

Description. Every appended content version stores its encrypted Seal envelope in `SoulState.config_ext` under the deterministic key `content_seal_envelope_v1:<sha256(ContentEnvelopeKeyV1)>` (`content.move:534-539`). Mint-time user config entries are rejected if they use that prefix (`assert_initial_config_key_unreserved`, `market.move:2593-2603`), and the SDK mirrors that rule client-side (`packages/soulidity-sdk/src/tx/shared.ts:251`). The post-mint wallet paths `set_state_config` / `set_state_config_v2` / `delete_state_config` / `delete_state_config_v2` only check owner + non-empty key and call `soul::upsert_state_config` / `soul::delete_state_config`, which have no namespace check. The SDK exposes `set_state_config_v2` (`packages/soulidity-sdk/src/tx/content.ts:419`). The emitted `SoulStateConfigUpserted` event is identical to the one `persist_append_envelope` emits (both use `updater = ctx.sender()`), so the forged write is indistinguishable on-chain from a legitimate envelope write.

Attack / failure path.
1. Seller S owns Soul A (state `st`), whose content root has versions with envelopes `E_k` stored under keys `K_k = envelope_config_key(content, kind, name, v)` (computable off-chain; `web/lib/soulidity/content-envelope.ts:38-43`).
2. S calls `market::set_state_config_v2(config_v2, &mut st, K_k, garbage_or_other_envelope, ctx)` for every `K_k` (requires only `primary_enabled` and `current_owner == sender`), or `delete_state_config_v2(..., K_k, ...)`.
3. `SoulContent` is untouched: no version is marked `deleted`/`purged`, `version_count` unchanged, so every on-chain integrity signal a buyer can inspect still looks healthy.
4. S lists A (`list_soul_fixed_price_v2`); buyer B pays price + fees and receives A. B (and any grantee / paid-access buyer) cannot recover the DEK of any version: `decodeContentEnvelope` validates structure and slot identity but cannot detect a wrong DEK before decryption.
5. Nothing lets B detect this before purchase (decrypting requires ownership). The same owner can also do it after selling paid access / issuing grants (already documented as "owner-revocable", so that part is accepted risk; the pre-sale rug is not).

Impact. Breaks the stated on-chain invariant that the envelope namespace is protocol-owned (the mint path and the SDK both enforce it, the hot wallet path does not), and enables a silent, undetectable-before-purchase denial of all encrypted content of a Soul being sold. A seller could alternatively purge content, but that is visible in `SoulContent` slots; this is not.

Fix. Call `assert_initial_config_key_unreserved(&key)` (rename it) in all four wallet wrappers (`set_state_config`, `set_state_config_v2`, `delete_state_config`, `delete_state_config_v2`), or move the check into `soul::upsert_state_config` / `soul::delete_state_config` behind a `public(package)` bypass used only by `content::persist_append_envelope`. Consider a dedicated `envelope` table instead of sharing `config_ext`.

Evidence verified: `market.move:1522-1527` (owner + empty-key checks only), `1581-1586`, `1537-1542`, `1596-1601`; `soul.move:465-473` (no prefix check); `market.move:2584-2585` (mint-only check); `content.move:534-538` (envelope written through the same `upsert_state_config`); `content.move:1091-1095` (nothing reads envelopes on-chain; readers are off-chain).

### MK-2 (Low) `collection::add_soul` accepts Animacraft-native Souls -> permanent unlistability

Location: `collection.move:193-222`; `market.move:600-614` (`assert_animacraft_native_v8_provenance`, line 610 `assert!(soul::collection_id(state).is_none(), ECollectionMismatch)`), `market.move:1617`, `1668`, `1723`, `1751` (`!has_animacraft_provenance` on all V1/V2 list paths); `soul.move:436-439` (`bind_collection` is once-only, no unbind).

Path. Creator/owner C of a native Soul (creator == owner at mint, `market.move:2518-2525`) also owns a collection (same creator). C calls `collection::add_soul(&mut collection, &mut state, ctx)`; all preconditions pass (creator match, owner, not listed, supply). Afterwards: `list_animacraft_v8_soul_fixed_price` aborts (`ECollectionMismatch`, via `quote_animacraft_v8_soul_sale -> assert_animacraft_native_v8_provenance`), `list_soul_fixed_price[_with_collection][_v2]` abort (`EAnimacraftListingPathRequired`). `collection_id` can never be cleared. The Soul is permanently non-transferable through the only sanctioned transfer channel (buy_*); it also consumes a supply slot.

Impact. Self-inflicted by the creator-owner, but irreversible with no recovery function; a public function silently produces an unsellable asset. Fix: `assert!(!soul::has_animacraft_provenance(state), E...)` in `add_soul`, or support collections on the V8 path.

### MK-3 (Low) `add_soul` ignores the combined-bps cap

Location: `collection.move:193-222`; `market.move:1669-1676` / `2790-2795` (list-with-collection requires `platform + creator + extra <= 10_000`), `market.move:2492-2495` (mint only checks `platform + creator`), `collection.move:150` (extra <= 10_000), `market.move:1623` / `1724` (solo listing requires `collection_id.is_none()`).

Path. Mint Soul with `creator_royalty_bps = 9_750` (allowed with platform 250). Create collection with `extra_royalty_bps = 500` (allowed: 250 + 500 <= 10_000). `add_soul` succeeds. Listing: solo path rejects (collection bound); collection path rejects (`ECombinedFeesTooHigh`, 250 + 9_750 + 500 > 10_000). Recoverable only if the admin lowers `platform_fee_bps` enough (here to 0 would still fail: 9_750 + 500 > 10_000) -> permanent for sufficiently high values. Fix: have `add_soul` take the market fee (or enforce `creator + extra <= 10_000 - platform` at bind time), and/or cap creator royalty at mint to leave headroom.

### MK-4 (Low) Registration does not require a shared kiosk

Location: `market.move:924-948` (`ensure_personal_kiosk_registered[_v2]` register any `PersonalKioskCap` the sender owns), `984-1016` (`rebind_primary_kiosk_impl`), `3049-3079`. Contrast `init_personal_kiosk[_v2]` (`889`, `913`) which always `public_share_object`s the kiosk.

Background verified: `PersonalKioskCap` is `key`-only and only moves via `transfer_to_sender` / `create_for` (`personal_kiosk.move:15-18, 113-115`), so the cap holder is always `personal_kiosk::owner(kiosk)`. But `Kiosk` has `key, store` (`kiosk.move:32`), so a PTB `kiosk::new -> personal_kiosk::new -> transfer::public_transfer(kiosk, self)` yields an owned personal kiosk. `transfer::share_object` on an object not created in the same tx aborts (`ESharedNonNewObject`, `transfer.move:21,115,126`), so such a kiosk can never become shared later.

Paths. (i) Owner O registers an owned kiosk, mints or buys a Soul into it, lists it: the shared `SoulListing` is visible but no buyer can pass `seller_kiosk: &mut Kiosk` (owned by O) -> phantom listings; (ii) buyer B registers an owned kiosk and buys a listed Soul (allowed: B passes their own owned kiosk as `buyer_kiosk`); the Soul is now permanently untradeable because every later buyer would need B's owned kiosk as a transaction input; B's only exit is `rebind_primary_kiosk`, which requires the kiosk to be empty (`995`), impossible while the Soul is locked inside.

Impact. Mostly self-inflicted liquidity loss, plus marketplace noise from unsettleable listings. Fix: only accept kiosks created by `init_personal_kiosk*`, or record a "shared" attestation at registration (e.g., require registration to happen in the same tx as `kiosk::new` + `public_share_object`), or add a buyer-side check in the SDK.

### MK-5 (Informational) Retained V1 surface and version-agnostic settlement

Location: V1 config type `market.move:120-126`; V1 entries `876-898`, `924-935`, `962-971`, `1036-1075`, `1175-1215`, `1260-1305`, `1355-1386`, `1487-1544`, `1607-1711`, `1808-1875`, `1949-1983`, `2043-2069`, `2197-2217`, `2293-2315`, `2341-2363`, `2389-2398`; `buy_soul_impl` has no `listing.version` check (`2908-2998`).

Verified facts. Production `init` (`403-405`) only constructs `MarketConfigV2` (`3111-3119`); there is no non-test constructor of `MarketConfig` in the current source, so on a fresh publish every V1 function is unreachable (requires `&MarketConfig`). Git history: the existing mainnet package (`Published.toml` original-id `0xa43c...`, version 2) was initialised with `init_impl(..., start_paused = true)` at both v5 (88a0dfb0) and v6 (e18a942f), i.e. a V1 `MarketConfig` exists on that deployment; its historical `retire_legacy_market` consumed the V1 `MarketAdminCap`, so that config can no longer be unpaused if the migration was executed (not verifiable offline).

Risk. If this source were published as an upgrade of a deployment that still has an unpaused V1 config with a live V1 admin cap, V1 mint/list/buy would run under the V1 `paused` flag only, bypassing the V2 fail-closed gates, and V1 `buy_soul_fixed_price` would settle V2 listings (and vice versa) with the V1 fee/recipient. Recommendation: delete the V1 type and entry points before the fresh publish (they are dead code there), or add `assert!(listing.version == MARKET_VERSION_V2)` to V2 buy paths.

### MK-6 (Informational) Equipment binding has no recovery path

Location: `soul.move:264-272` (bind/unbind DF10), `444-449` (`set_listed(true)` aborts while equipped), `589-595` (`rotate_owner` aborts while equipped); `animacraft_equipment_adapter_v8.move:21-38` (`create_equipment_v8` binds), `74-84` (`close_empty_equipment_v8` is the only unbind and needs `equipment: MakerLoadoutV8` by value).

Observation. Listing and binding are mutually exclusive in both directions (`owner_witness` requires `!is_listed`, `binding.move:52-56`; `set_listed(true)` requires no DF10), so a listed Soul can always settle and a buyer can never receive an equipped Soul (verified). The residual risk is owner-side: if the `MakerLoadoutV8` object cannot be produced by value (transferred away, wrapped, or destroyed by the external runtime), DF10 can never be removed and the Soul can never be listed or rotated again. Abilities / lifecycle of `MakerLoadoutV8` could not be verified (external package). Consider an owner-only "force unbind when the loadout object no longer exists" path or an admin recovery.

### MK-7 (Informational) TransferPolicy mutability vs hard-coded receipts

Location: `market.move:3130-3136` (rules added at init), `2982-2985`, `753-756`, `2162-2165` (exactly three proofs then `confirm_request`); `transfer_policy.move:104-120` (`confirm_request` requires `receipts == rules.size()`); `protocol_tests.move:3812-3837` demonstrates admin rule add/remove.

Admin-trust note only: adding any fourth rule bricks all `buy_*` until removed; removing `witness_rule<SoulMarketProof>` lets a kiosk owner `kiosk::list` + `kiosk::purchase` (price 0) + prove lock/personal rules and confirm, moving a Soul between kiosks while `SoulState.current_owner/current_kiosk_id/ownership_epoch` stay stale (grants and paid access would then belong to the old owner's epoch). Keep the policy caps under the same multisig as the admin cap and document that the three rules are load-bearing.

### MK-8 (Informational) Hot spot, unbounded dynamic fields, rebate capture, event spam

- Every mint takes `registry: &mut KioskRegistry` and adds a `Claimed(id)` dynamic field (`derived_object::claim`, `content.move:417`, called at `market.move:2531`) plus, for joined mints, a `JoinedSourceKey` marker (`1283`, `1331`). All mints therefore serialise on one shared object and its dynamic-field set grows forever. Acceptable for current scale; consider per-author derivation parents if mint throughput matters.
- `delete_soul_listing` / `delete_collection_listing` (`2416-2466`) are callable by anyone for inactive listings; the storage rebate goes to the deleter, not to the seller/buyer who paid it. Documented in code as intended.
- `commit_mint_manifest` (`163-166`) emits an event for any 32-byte value from any sender; indexers must not trust it as authorisation (code comment agrees).

### MK-9 (Informational) `mint_joined_in_personal_kiosk*<T>`

`T` is any `key + store` type the caller holds in their kiosk (`kiosk::has_item_with_type<T>`, `1280`, `1328`), including `Soul` or `Coin`. The source object id is not stored on the Soul / state / event (only `origin_ref`, a free string), so the "joined from" claim is not verifiable on-chain, and `JoinedSourceKey { source_object_id }` permanently reserves that id in the registry even after the object leaves the caller's kiosk. Record the source id (and type name) on the Soul or in `SoulMintedToKiosk` if the provenance is meant to be meaningful.

### MK-10 (Informational) Defense-in-depth gap in `buy_soul_impl`

`buy_soul_impl` (`2924-2931`) checks listing/state ids and `personal_kiosk::owner(seller_kiosk) == listing.seller`, but not `listing.seller == soul::current_owner(state)` nor `listing.seller_kiosk_id == soul::current_kiosk_id(state)`; `assert_animacraft_native_v8_listing` (`704-705`) does. Today these cannot diverge (owner/kiosk only change in buy paths that also deactivate the listing; `rebind` requires an empty kiosk), so this is hardening only.

### MK-11 (Informational) Unverified `origin_ref` in Display

`soul.move:625-626` maps `link` and `project_url` to `{origin_ref}`, which is free-form for imported / joined Souls (`market.move:1168-1174` documents it as unverified). Wallets render these as clickable links. Consider dropping `link`/`project_url` from Display or namespacing the value.

### MK-12 (Informational) Native market frozen by any platform-fee change

`list_animacraft_v8_soul_fixed_price` (`629`) and `buy_animacraft_v8_soul_fixed_price` (`667`) require `config.platform_fee_bps == 250`. Changing the fee for the ordinary market freezes all native listings and purchases (cancel remains available, `709-717`). Intended per comment at `35-36`, but operationally couples two fee schedules.

## (c) Invariants checked that HOLD (with evidence)

1. No public function returns `SoulMarketProof`, `CollectionMarketProof`, a `PurchaseCap`, a `TransferRequest`, or a `KioskOwnerCap`. Proofs are constructed only inside `buy_soul_impl` (2984), `finish_animacraft_soul_purchase` (755) and `buy_collection_right_fixed_price_impl` (2164); `take_*_purchase_cap` are private (3000-3010); `SoulListing`/`CollectionListing` are `key`-only (189, 204) so the embedded `PurchaseCap` cannot be extracted or wrapped outside the module.
2. No `TransferRequest<Soul>` can be confirmed without the market: policy carries `witness_rule<Soul, SoulMarketProof>` (3132) and `confirm_request` demands a receipt per rule (`transfer_policy.move:111`). Raw `kiosk::list`/`kiosk::purchase`/`purchase_with_cap` by the owner therefore abort at confirm time; `kiosk::take` is blocked by the lock (`kiosk.move:149-160`, lock added by `kiosk::lock` 2555, 2976, 747, 1464, 2156). `Lock`/`Item`/`Listing` keys are not constructible outside `sui::kiosk`, so `uid_mut` cannot remove them.
3. One active listing per Soul: `list_with_purchase_cap` asserts `!is_listed` (`kiosk.move:216`); the exclusive `Listing` df is removed only by `return_purchase_cap` (cancel, 1797) or `purchase_with_cap` (buy, 2951/678). `SoulState.is_listed` is flipped in the same transaction as the kiosk listing (1644, 1700, 2818, 640 / 1799, 2975, 746). No function sets `is_active = true` after creation.
4. PurchaseCap double-spend impossible: `Option::extract` + `is_active` gate (3000-3003, 1789, 2925, 699).
5. Listing <-> state <-> kiosk binding: `state_id`/`soul_id` match (2926-2927, 1793-1794, 700), `seller_kiosk == listing.seller_kiosk_id` (2928) and `purchase_with_cap` re-checks `kiosk_id` (`kiosk.move:237`), purchased object id == `listing.soul_id` (2956, 679). Collections: `listing.collection_id == id(collection)` and `right_id` match (2117-2118, 2146); Soul-with-collection requires both listing and state to carry the same collection id (1857-1858, 1929-1930) and solo paths require both none (1822-1823, 1893-1894).
6. V8 vs ordinary separation is enforced on both list and buy sides via immutable provenance (`bind_animacraft_native_v8` only at mint, 1121; `soul.move:253-256`): 1617/1668/1723/1751/1821/1855/1892/1927 vs 604 and 697-698.
7. Snapshots cannot go stale: `creator`, `creator_royalty_bps`, `extra_royalty_bps` are immutable (`soul.move` has no setters; `collection.move` has no setter); `current_owner`/`current_kiosk_id` change only in `rotate_owner`, called only from buy paths (745, 2974); `rebind_primary_kiosk` requires the old kiosk to be empty (995) so a Soul's kiosk pointer cannot be orphaned.
8. Payment math: `bps_amount` is ceil with u128 intermediate (3012-3018); totals checked against `MAX_U64_AS_U128` before the cast (576, 765, 776, 786, 797, 2136, 2266); exact payment required (2948, 2138, 2268, 671); combined bps <= 10_000 re-checked at buy time with current fees (2941-2947); fee recipient non-zero (808, 858); `coin::zero<SUI>` satisfies `min_price = 0` and leaves `profits` unchanged (`kiosk.move:235-241`). V8 split (`floor_bps_amount`) sums to <= price given the external rights cap (see (d)).
9. Personal-kiosk identity: `PersonalKioskCap` is `key`-only and soulbound (`personal_kiosk.move:15, 113-115`); `OwnerMarker` is written once (`personal_kiosk.move:50-54`) and a second `personal_kiosk::new` on the same kiosk aborts on duplicate field; market never reads mutable `kiosk::owner`, only `personal_kiosk::owner` (633, 673, 736, 1102, 1445, 1628, 1684, 1792, 1966, 2003). Registry entries change only via `rebind_primary_kiosk_impl` (984-1016); `insert_or_assert` never mutates (3049-3079); buyers must use their registered kiosk (2934-2939, 738-743, 2126-2131).
10. Mint identity: `expected_content_id` must equal `derive_address(registry, ContentMintKeyV1{sender, nonce})` (2530) and `derived_object::claim` makes each `(author, nonce)` single-use (`derived_object.move:17-23`); `SoulState` is shared only through `share_state`, which requires a bound content root (`soul.move:614-617`, called from 2742); `SoulState` is `key`-only so a mint PTB must share it; `InitialContentEntry` is `store`-only so entries must be consumed (246-255). Initial content well-formedness is validated before any blob is consumed (2501) and re-asserted after (2547).
11. Equipment / listing mutual exclusion: `set_listed(true)` aborts with DF10 present (`soul.move:447`); `owner_witness` (used by `create_equipment_v8`, `begin_update_v8`, `close_empty_equipment_v8`) aborts if listed (`binding.move:52-56`); `rotate_owner` aborts with DF10 (`soul.move:594`), so no listed Soul can be equipped and no equipped Soul can be sold.
12. Collections: supply cap enforced before increment (`collection.move:209-213`); `tradeable` is immutable and checked on list and buy (1961, 1998, 2123); `update_holder` is `public(package)` and only called from the right purchase (2155) after the right has been pulled from the seller kiosk; `add_soul` rejects listed Souls (`collection.move:207`, test `protocol_tests.move:4213`).
13. Gating map (V2): primary gates mint/collection-create/content-active/state-config/paid-access config+purchase; secondary gates list/buy of Souls, rights and native Souls plus quotes; registration/rebind need either gate; cancel, delete, reuse, finalize, `collection::add_soul`, `commit_mint_manifest` are intentionally ungated (cancel keeps custody recoverable while paused, test `animacraft_native_market_v8_tests.move:109-121`).
14. Admin caps are bound to their config (`837`, `847`, `857`, `868`); `init_fresh_impl` shares exactly one `MarketConfigV2`, one `KioskRegistry`, two policies, and transfers caps to the deployer (3138-3144); the `Publisher` is burned (3145) so no second `TransferPolicy<Soul>` can be created.

## (d) Not verified / out of reach

- Anything inside `animacraft_v8_core` / `animacraft_v8_output` / `animacraft_v8_runtime`: `assert_rights_snapshot_v8` caps (needed for the `quote_animacraft_v8_soul_sale` subtraction at 597 to be underflow-free; with the documented 1000 bps pool it is), that `bind_native_soul_v8` snapshots the same rights as `root_rights_v2` (otherwise natively minted Souls would be permanently unlistable through `EAnimacraftNativeCreatorRoyaltyMismatch`), that `native_soul_binding_maker_creator_v8` is never `@0x0` (a zero recipient would burn the source royalty), and the abilities/lifecycle of `MakerLoadoutV8` (MK-6).
- On-chain state: whether the existing mainnet deployment executed `retire_legacy_market` (MK-5) and whether the planned release is a fresh publish (as `init_fresh_impl` assumes) or an upgrade.
- Build and tests could not be run; all reasoning is static. Line numbers of dependency files refer to comment-stripped listings except where quoted from the original.
- Sui adapter behaviour for passing the same shared `Kiosk` as both `seller_kiosk` and `buyer_kiosk` in one call was not confirmed from source; the only consequence would be an owner self-purchase that rotates their own epoch, which is already achievable through a second address and is bounded by the platform fee.
