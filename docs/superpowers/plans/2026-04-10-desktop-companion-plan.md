# Desktop Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop persona manager that renders Soul-based sprite animations driven by LLM CLI status, with on-chain asset storage and access control.

**Architecture:** Three independent phases — Move contracts (SoulAssets + ContentAccessList), Web/API layer (Prisma + mirror + routes), Desktop app (status protocol + overlay + sprite rendering + agent wallet). Phase 1 and Phase 3 can run in parallel. Phase 2 depends on Phase 1.

**Tech Stack:** Sui Move, Tauri v2 + React 19, Canvas API, TypeScript, Prisma, Next.js API routes, Ed25519, `notify` crate for file watching.

**Spec:** `docs/superpowers/specs/2026-04-10-desktop-companion-design.md`

---

## Phase 1 — Move Contracts

### Task 1: SoulAssets Module

**Files:**
- Create: `move/soulidity/sources/assets.move`

This module mirrors `skills.move` exactly. Same struct pattern, same function signatures, with an added `asset_type` field.

- [ ] **Step 1: Create `assets.move` with structs and events**

```move
module soulidity::assets {
    use std::string::String;
    use sui::table;
    use sui::event;
    use sui::clock::Clock;
    use walrus::blob::Blob;
    use soulidity::soul::{Self, SoulState};
    use soulidity::grant::{Self, SoulGrant};

    // ── Error codes ──
    const EAssetsMismatch: u64 = 1;
    const EAssetNotFound: u64 = 2;
    const EVersionOutOfBounds: u64 = 3;
    const EAssetVersionDeleted: u64 = 4;

    // ── Asset type constants ──
    const ASSET_TYPE_SPRITE: u8 = 0;
    const ASSET_TYPE_LIVE2D: u8 = 1;
    const ASSET_TYPE_AUDIO: u8 = 2;

    // ── Structs ──

    public struct AssetSlot has copy, drop, store {
        blob_object_id: ID,
        is_public: bool,
        deleted: bool,
        asset_type: u8,
        created_at_ms: u64,
    }

    public struct SoulAssets has key {
        id: UID,
        soul_id: ID,
        assets: table::Table<String, vector<AssetSlot>>,
        asset_count: u64,
    }

    public struct AssetBlobKey has copy, drop, store {
        asset_name: String,
        version_index: u64,
    }

    // ── Events ──

    public struct SoulAssetsCreated has copy, drop {
        assets_id: ID,
        soul_id: ID,
    }

    public struct AssetVersionAppended has copy, drop {
        assets_id: ID,
        soul_id: ID,
        asset_name: String,
        version_index: u64,
        is_public: bool,
        asset_type: u8,
        created_at_ms: u64,
        blob_object_id: ID,
    }

    public struct AssetVersionDeleted has copy, drop {
        assets_id: ID,
        soul_id: ID,
        asset_name: String,
        version_index: u64,
        deleted_by: address,
    }
```

- [ ] **Step 2: Add internal helpers (matching `skills.move` pattern)**

```move
    // ── Internal helpers ──

    fun assert_assets_matches_state(assets: &SoulAssets, state: &SoulState) {
        let expected_id = soul::assets_id(state);
        assert!(expected_id.is_some() && *expected_id.borrow() == object::id(assets), EAssetsMismatch);
    }

    fun borrow_slot(assets: &SoulAssets, asset_name: String, version_index: u64): &AssetSlot {
        assert!(assets.assets.contains(asset_name), EAssetNotFound);
        let versions = &assets.assets[asset_name];
        assert!(version_index < versions.length(), EVersionOutOfBounds);
        &versions[version_index]
    }

    fun borrow_slot_mut(assets: &mut SoulAssets, asset_name: String, version_index: u64): &mut AssetSlot {
        assert!(assets.assets.contains(asset_name), EAssetNotFound);
        let versions = &mut assets.assets[asset_name];
        assert!(version_index < versions.length(), EVersionOutOfBounds);
        &mut versions[version_index]
    }

    fun append_version_impl(
        assets: &mut SoulAssets,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        _ctx: &mut TxContext,
    ): u64 {
        let blob_object_id = object::id(&content_blob);
        let now_ms = clock.timestamp_ms();
        let slot = AssetSlot {
            blob_object_id,
            is_public,
            deleted: false,
            asset_type,
            created_at_ms: now_ms,
        };

        if (!assets.assets.contains(asset_name)) {
            assets.assets.add(copy asset_name, vector[slot]);
            assets.asset_count = assets.asset_count + 1;
            transfer::public_transfer(content_blob, @0x0); // burn blob wrapper
            event::emit(AssetVersionAppended {
                assets_id: object::id(assets),
                soul_id: assets.soul_id,
                asset_name,
                version_index: 0,
                is_public,
                asset_type,
                created_at_ms: now_ms,
                blob_object_id,
            });
            0
        } else {
            let versions = &mut assets.assets[copy asset_name];
            let version_index = versions.length();
            versions.push_back(slot);
            transfer::public_transfer(content_blob, @0x0);
            event::emit(AssetVersionAppended {
                assets_id: object::id(assets),
                soul_id: assets.soul_id,
                asset_name,
                version_index,
                is_public,
                asset_type,
                created_at_ms: now_ms,
                blob_object_id,
            });
            version_index
        }
    }
```

- [ ] **Step 3: Add public functions (create, getters, append, delete)**

```move
    // ── Creation ──

    public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulAssets {
        let assets = SoulAssets {
            id: object::new(ctx),
            soul_id,
            assets: table::new(ctx),
            asset_count: 0,
        };
        event::emit(SoulAssetsCreated {
            assets_id: object::id(&assets),
            soul_id,
        });
        assets
    }

    public(package) fun share_assets(assets: SoulAssets) {
        transfer::share_object(assets);
    }

    public(package) fun append_initial_version(
        assets: &mut SoulAssets,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64 {
        append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
    }

    // ── Getters ──

    public fun soul_id(self: &SoulAssets): ID { self.soul_id }
    public fun assets_id(self: &SoulAssets): ID { object::id(self) }
    public fun asset_count(self: &SoulAssets): u64 { self.asset_count }
    public fun contains_asset(self: &SoulAssets, asset_name: String): bool { self.assets.contains(asset_name) }
    public fun version_count(self: &SoulAssets, asset_name: String): u64 {
        assert!(self.assets.contains(asset_name), EAssetNotFound);
        self.assets[asset_name].length()
    }
    public fun blob_object_id_for(self: &SoulAssets, asset_name: String, version_index: u64): ID {
        borrow_slot(self, asset_name, version_index).blob_object_id
    }
    public fun version_is_public(self: &SoulAssets, asset_name: String, version_index: u64): bool {
        borrow_slot(self, asset_name, version_index).is_public
    }
    public fun version_is_deleted(self: &SoulAssets, asset_name: String, version_index: u64): bool {
        borrow_slot(self, asset_name, version_index).deleted
    }
    public fun version_asset_type(self: &SoulAssets, asset_name: String, version_index: u64): u8 {
        borrow_slot(self, asset_name, version_index).asset_type
    }
    public fun version_created_at_ms(self: &SoulAssets, asset_name: String, version_index: u64): u64 {
        borrow_slot(self, asset_name, version_index).created_at_ms
    }

    // ── Write as owner ──

    public fun append_version_as_owner(
        assets: &mut SoulAssets,
        state: &SoulState,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64 {
        assert_assets_matches_state(assets, state);
        soul::assert_owner(state, ctx.sender());
        append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
    }

    // ── Write as granted agent ──

    public fun append_version_as_granted_agent(
        assets: &mut SoulAssets,
        state: &SoulState,
        soul_grant: &SoulGrant,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64 {
        assert_assets_matches_state(assets, state);
        grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
        append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
    }

    // ── Delete ──

    public fun delete_version_as_owner(
        assets: &mut SoulAssets,
        state: &SoulState,
        asset_name: String,
        version_index: u64,
        ctx: &TxContext,
    ) {
        assert_assets_matches_state(assets, state);
        soul::assert_owner(state, ctx.sender());
        let slot = borrow_slot_mut(assets, copy asset_name, version_index);
        assert!(!slot.deleted, EAssetVersionDeleted);
        slot.deleted = true;
        event::emit(AssetVersionDeleted {
            assets_id: object::id(assets),
            soul_id: assets.soul_id,
            asset_name,
            version_index,
            deleted_by: ctx.sender(),
        });
    }

    public fun delete_version_as_granted_agent(
        assets: &mut SoulAssets,
        state: &SoulState,
        asset_name: String,
        version_index: u64,
        soul_grant: &SoulGrant,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_assets_matches_state(assets, state);
        grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
        let slot = borrow_slot_mut(assets, copy asset_name, version_index);
        assert!(!slot.deleted, EAssetVersionDeleted);
        slot.deleted = true;
        event::emit(AssetVersionDeleted {
            assets_id: object::id(assets),
            soul_id: assets.soul_id,
            asset_name,
            version_index,
            deleted_by: ctx.sender(),
        });
    }

    // ── Seal approval (private reads) ──

    entry fun seal_approve_asset_read_owner(
        id: vector<u8>,
        state: &SoulState,
        assets: &SoulAssets,
        asset_name: String,
        version_index: u64,
        ctx: &TxContext,
    ) {
        assert_matching_document_id(id, object::id(assets), copy asset_name, version_index);
        soul::assert_owner(state, ctx.sender());
        assert_assets_matches_state(assets, state);
        let slot = borrow_slot(assets, asset_name, version_index);
        assert!(!slot.deleted, EAssetVersionDeleted);
    }

    entry fun seal_approve_asset_read_granted_agent(
        id: vector<u8>,
        state: &SoulState,
        assets: &SoulAssets,
        asset_name: String,
        version_index: u64,
        soul_grant: &SoulGrant,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_matching_document_id(id, object::id(assets), copy asset_name, version_index);
        assert_assets_matches_state(assets, state);
        let slot = borrow_slot(assets, asset_name, version_index);
        assert!(!slot.deleted, EAssetVersionDeleted);
        grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
    }

    // ── Document ID matching ──
    // Format: [prefix "soul-asset:" ++ version_byte ++ assets_id ++ asset_name_len ++ asset_name ++ version_index ++ nonce]

    fun assert_matching_document_id(
        id: vector<u8>,
        expected_assets_id: ID,
        expected_asset_name: String,
        expected_version_index: u64,
    ) {
        // Follows same pattern as skills.move assert_matching_document_id
        // Prefix: b"soul-asset:" (11 bytes) + version byte (1) + assets_id (32) + name_len (2) + name + version_index (8) + nonce (32)
        let prefix = b"soul-asset:";
        let prefix_len = prefix.length();
        assert!(id.length() > prefix_len, 100);
        let mut i = 0;
        while (i < prefix_len) {
            assert!(id[i] == prefix[i], 100);
            i = i + 1;
        };
        // Version byte
        assert!(id[prefix_len] == 1, 100);
        let offset = prefix_len + 1;
        // assets_id (32 bytes)
        let expected_id_bytes = object::id_to_bytes(&expected_assets_id);
        i = 0;
        while (i < 32) {
            assert!(id[offset + i] == expected_id_bytes[i], 100);
            i = i + 1;
        };
        let offset = offset + 32;
        // asset_name length (2 bytes big-endian) + asset_name bytes
        let name_bytes = expected_asset_name.as_bytes();
        let name_len = name_bytes.length();
        assert!(id[offset] == ((name_len >> 8) as u8), 100);
        assert!(id[offset + 1] == ((name_len & 0xff) as u8), 100);
        let offset = offset + 2;
        i = 0;
        while (i < name_len) {
            assert!(id[offset + i] == name_bytes[i], 100);
            i = i + 1;
        };
        let offset = offset + name_len;
        // version_index (8 bytes big-endian)
        let mut vi = expected_version_index;
        i = 0;
        while (i < 8) {
            let byte_pos = 7 - i;
            assert!(id[offset + byte_pos] == ((vi & 0xff) as u8), 100);
            vi = vi >> 8;
            i = i + 1;
        };
        // Remaining bytes are nonce — no validation needed
    }
}
```

- [ ] **Step 4: Run Move build to verify compilation**

Run: `sui move build --path move/soulidity 2>&1 | tail -5`
Expected: Build may fail due to missing `soul::assets_id` and `grant::scope_assets` — these are added in Task 3.

- [ ] **Step 5: Commit**

```bash
git add move/soulidity/sources/assets.move
git commit -m "feat(move): add SoulAssets module — asset storage with versioning and seal approval"
```

---

### Task 2: Extend SoulState and Grant for Assets

**Files:**
- Modify: `move/soulidity/sources/soul.move` (add `assets_id` field + setter + getter)
- Modify: `move/soulidity/sources/grant.move` (add `SCOPE_ASSETS` constant + getter)

- [ ] **Step 1: Add `assets_id` to SoulState in `soul.move`**

Add field to `SoulState` struct (after `skills_id`):

```move
    assets_id: Option<ID>,
```

Add to `create_state` function body (after `skills_id: option::none()`):

```move
        assets_id: option::none(),
```

Add getter and setter:

```move
public fun assets_id(self: &SoulState): &Option<ID> {
    &self.assets_id
}

public(package) fun set_assets_id(state: &mut SoulState, assets_id: ID) {
    assert!(state.assets_id.is_none(), EAssetsAlreadyBound);
    state.assets_id = option::some(assets_id);
}
```

Add error constant (near existing error constants):

```move
const EAssetsAlreadyBound: u64 = 12;  // use next available number
```

- [ ] **Step 2: Add `SCOPE_ASSETS` to `grant.move`**

Add constant (after `SCOPE_SKILLS`):

```move
const SCOPE_ASSETS: u64 = 8;
```

Add public getter:

```move
public fun scope_assets(): u64 { SCOPE_ASSETS }
```

- [ ] **Step 3: Update SoulState destructure patterns in `soul.move`**

Find all `SoulState { ... }` destructure patterns and add `assets_id: _,` field. Check `protocol_tests.move` as well.

- [ ] **Step 4: Run Move build**

Run: `sui move build --path move/soulidity 2>&1 | tail -5`
Expected: May still fail due to market.move integration (Task 4). Fix any compilation errors.

- [ ] **Step 5: Commit**

```bash
git add move/soulidity/sources/soul.move move/soulidity/sources/grant.move
git commit -m "feat(move): add assets_id to SoulState and SCOPE_ASSETS to grant"
```

---

### Task 3: ContentAccessList Module

**Files:**
- Create: `move/soulidity/sources/content_access.move`

- [ ] **Step 1: Create `content_access.move`**

```move
module soulidity::content_access {
    use std::string::String;
    use sui::table;
    use sui::event;
    use sui::clock::Clock;
    use sui::coin::Coin;
    use sui::usdc::USDC;
    use soulidity::soul::{Self, SoulState};
    use soulidity::market::MarketConfig;

    // ── Error codes ──
    const ENotCreatorOrOwner: u64 = 1;
    const EAlreadyHasAccess: u64 = 2;
    const ENoAccessEntry: u64 = 3;
    const EAccessExpired: u64 = 4;
    const EScopeMismatch: u64 = 5;
    const EInsufficientPayment: u64 = 6;
    const EAccessListMismatch: u64 = 7;

    // ── Structs ──

    public struct ContentAccessEntry has copy, drop, store {
        scope_mask: u64,
        price_paid_atomic: u64,
        granted_at_ms: u64,
        expires_at_ms: Option<u64>,
    }

    public struct ContentAccessList has key {
        id: UID,
        soul_id: ID,
        creator: address,
        price_atomic: u64,
        default_scope_mask: u64,
        entries: table::Table<address, ContentAccessEntry>,
        entry_count: u64,
    }

    // ── Events ──

    public struct ContentAccessListCreated has copy, drop {
        access_list_id: ID,
        soul_id: ID,
        creator: address,
        price_atomic: u64,
        default_scope_mask: u64,
    }

    public struct ContentAccessGranted has copy, drop {
        soul_id: ID,
        access_list_id: ID,
        grantee: address,
        scope_mask: u64,
        price_paid_atomic: u64,
    }

    public struct ContentAccessRevoked has copy, drop {
        soul_id: ID,
        access_list_id: ID,
        grantee: address,
    }

    public struct ContentAccessPriceUpdated has copy, drop {
        soul_id: ID,
        access_list_id: ID,
        old_price_atomic: u64,
        new_price_atomic: u64,
    }

    // ── Creation ──

    public(package) fun create(
        soul_id: ID,
        creator: address,
        price_atomic: u64,
        default_scope_mask: u64,
        ctx: &mut TxContext,
    ): ContentAccessList {
        let list = ContentAccessList {
            id: object::new(ctx),
            soul_id,
            creator,
            price_atomic,
            default_scope_mask,
            entries: table::new(ctx),
            entry_count: 0,
        };
        event::emit(ContentAccessListCreated {
            access_list_id: object::id(&list),
            soul_id,
            creator,
            price_atomic,
            default_scope_mask,
        });
        list
    }

    public(package) fun share_access_list(list: ContentAccessList) {
        transfer::share_object(list);
    }

    // ── Getters ──

    public fun soul_id(self: &ContentAccessList): ID { self.soul_id }
    public fun creator(self: &ContentAccessList): address { self.creator }
    public fun price_atomic(self: &ContentAccessList): u64 { self.price_atomic }
    public fun entry_count(self: &ContentAccessList): u64 { self.entry_count }

    public fun has_access(
        self: &ContentAccessList,
        addr: address,
        required_scope: u64,
        clock: &Clock,
    ): bool {
        if (!self.entries.contains(addr)) { return false };
        let entry = &self.entries[addr];
        if (entry.scope_mask & required_scope != required_scope) { return false };
        if (entry.expires_at_ms.is_some()) {
            let expires = *entry.expires_at_ms.borrow();
            if (clock.timestamp_ms() >= expires) { return false };
        };
        true
    }

    // ── Purchase (on-chain USDC payment) ──

    public entry fun purchase_content_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        payment: Coin<USDC>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let buyer = ctx.sender();
        assert!(!access_list.entries.contains(buyer), EAlreadyHasAccess);
        let paid = payment.value();
        assert!(paid >= access_list.price_atomic, EInsufficientPayment);

        // Transfer payment to creator (simplified — full version splits via MarketConfig)
        transfer::public_transfer(payment, access_list.creator);

        let now_ms = clock.timestamp_ms();
        let entry = ContentAccessEntry {
            scope_mask: access_list.default_scope_mask,
            price_paid_atomic: paid,
            granted_at_ms: now_ms,
            expires_at_ms: option::none(),
        };
        access_list.entries.add(buyer, entry);
        access_list.entry_count = access_list.entry_count + 1;

        event::emit(ContentAccessGranted {
            soul_id: access_list.soul_id,
            access_list_id: object::id(access_list),
            grantee: buyer,
            scope_mask: access_list.default_scope_mask,
            price_paid_atomic: paid,
        });
    }

    // ── Manual add (creator or owner) ──

    public entry fun add_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        grantee: address,
        scope_mask: u64,
        expires_at_ms: Option<u64>,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        assert!(
            sender == access_list.creator || sender == soul::current_owner(state),
            ENotCreatorOrOwner,
        );
        assert!(!access_list.entries.contains(grantee), EAlreadyHasAccess);

        let now_ms = clock.timestamp_ms();
        let entry = ContentAccessEntry {
            scope_mask,
            price_paid_atomic: 0,
            granted_at_ms: now_ms,
            expires_at_ms,
        };
        access_list.entries.add(grantee, entry);
        access_list.entry_count = access_list.entry_count + 1;

        event::emit(ContentAccessGranted {
            soul_id: access_list.soul_id,
            access_list_id: object::id(access_list),
            grantee,
            scope_mask,
            price_paid_atomic: 0,
        });
    }

    // ── Revoke ──

    public entry fun revoke_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        grantee: address,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        assert!(
            sender == access_list.creator || sender == soul::current_owner(state),
            ENotCreatorOrOwner,
        );
        assert!(access_list.entries.contains(grantee), ENoAccessEntry);

        access_list.entries.remove(grantee);
        access_list.entry_count = access_list.entry_count - 1;

        event::emit(ContentAccessRevoked {
            soul_id: access_list.soul_id,
            access_list_id: object::id(access_list),
            grantee,
        });
    }

    // ── Set price ──

    public entry fun set_content_price(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        new_price_atomic: u64,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        assert!(
            sender == access_list.creator || sender == soul::current_owner(state),
            ENotCreatorOrOwner,
        );
        let old_price = access_list.price_atomic;
        access_list.price_atomic = new_price_atomic;
        event::emit(ContentAccessPriceUpdated {
            soul_id: access_list.soul_id,
            access_list_id: object::id(access_list),
            old_price_atomic: old_price,
            new_price_atomic,
        });
    }

    // ── Seal approval for allowlisted users (skills) ──

    public entry fun seal_approve_skill_allowlisted(
        _id: vector<u8>,
        state: &SoulState,
        access_list: &ContentAccessList,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
        let sender = ctx.sender();
        assert!(has_access(access_list, sender, 4, clock), EScopeMismatch); // SCOPE_SKILLS = 4
    }

    // ── Seal approval for allowlisted users (assets) ──

    public entry fun seal_approve_asset_allowlisted(
        _id: vector<u8>,
        state: &SoulState,
        access_list: &ContentAccessList,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
        let sender = ctx.sender();
        assert!(has_access(access_list, sender, 8, clock), EScopeMismatch); // SCOPE_ASSETS = 8
    }
}
```

- [ ] **Step 2: Run Move build**

Run: `sui move build --path move/soulidity 2>&1 | tail -10`
Expected: May need to adjust USDC import path — check existing usage in `market.move` for the correct coin type.

- [ ] **Step 3: Commit**

```bash
git add move/soulidity/sources/content_access.move
git commit -m "feat(move): add ContentAccessList module — allowlist-based content access control"
```

---

### Task 4: Market Integration — Create SoulAssets on Mint

**Files:**
- Modify: `move/soulidity/sources/market.move`

- [ ] **Step 1: Update `mint_native_in_personal_kiosk` signature**

Add new parameters after `skills_public`:

```move
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
```

- [ ] **Step 2: Add SoulAssets creation in `mint_soul_in_personal_kiosk_impl`**

After the skills creation block, add (following the same conditional pattern):

```move
    // Create SoulAssets if asset_blob provided
    let mut asset_blob = asset_blob;
    if (asset_blob.is_some()) {
        let ab = option::extract(&mut asset_blob);
        let mut assets_book = assets::create(soul_id, ctx);
        let _ = assets::append_initial_version(
            &mut assets_book,
            initial_asset_name,
            asset_public,
            asset_type,
            ab,
            clock,
            ctx,
        );
        soul::set_assets_id(&mut state, object::id(&assets_book));
        assets::share_assets(assets_book);
    };
    asset_blob.destroy_none();

    // Create ContentAccessList
    let access_list = content_access::create(
        soul_id,
        ctx.sender(),
        content_access_price_atomic,
        content_access_default_scope_mask,
        ctx,
    );
    content_access::share_access_list(access_list);
```

Add imports at the top of market.move:

```move
    use soulidity::assets;
    use soulidity::content_access;
```

- [ ] **Step 3: Update `mint_imported_in_personal_kiosk` and `mint_joined_in_personal_kiosk` signatures similarly**

Apply the same parameter additions and SoulAssets/ContentAccessList creation logic.

- [ ] **Step 4: Run Move build**

Run: `sui move build --path move/soulidity 2>&1 | tail -10`
Expected: PASS (fix any remaining compile errors)

- [ ] **Step 5: Commit**

```bash
git add move/soulidity/sources/market.move
git commit -m "feat(move): integrate SoulAssets and ContentAccessList into mint flow"
```

---

### Task 5: Move Tests

**Files:**
- Modify: `move/soulidity/sources/protocol_tests.move`

- [ ] **Step 1: Update existing test helpers to include new parameters**

Update `mint_test_soul_*` helper functions to pass the new `asset_blob`, `initial_asset_name`, `asset_public`, `asset_type`, `content_access_price_atomic`, `content_access_default_scope_mask` parameters. Use `option::none()` for `asset_blob` in existing tests to keep them passing.

- [ ] **Step 2: Add asset-specific test**

```move
#[test]
fun assets_append_and_read_works() {
    // 1. Mint a soul with an initial asset
    // 2. Verify SoulAssetsCreated event
    // 3. Verify AssetVersionAppended event
    // 4. Read back asset slot — assert is_public, asset_type, blob_object_id
    // 5. Append a second version — verify version_index = 1
    // 6. Delete version 0 — verify AssetVersionDeleted event
}
```

- [ ] **Step 3: Add content access test**

```move
#[test]
fun content_access_purchase_and_verify_works() {
    // 1. Mint soul → ContentAccessList created
    // 2. Verify ContentAccessListCreated event
    // 3. Buyer calls purchase_content_access with USDC
    // 4. Verify ContentAccessGranted event
    // 5. has_access returns true for buyer
    // 6. has_access returns false for non-buyer
    // 7. Creator revokes → has_access returns false
}
```

- [ ] **Step 4: Run Move tests**

Run: `sui move test --path move/soulidity 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add move/soulidity/sources/protocol_tests.move
git commit -m "test(move): add SoulAssets and ContentAccessList protocol tests"
```

---

## Phase 2 — Web/API Layer

### Task 6: Prisma Schema Extensions

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `SoulAssetVersionRecord` model**

```prisma
model SoulAssetVersionRecord {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId   String    @map("soul_on_chain_id")
  soul            SoulAsset @relation("SoulAssetAssetVersions", fields: [soulOnChainId], references: [onChainId], onDelete: Cascade)
  assetsOnChainId String    @map("assets_on_chain_id")
  assetName       String    @map("asset_name")
  versionIndex    Int       @map("version_index")
  assetType       String    @map("asset_type")
  visibility      String
  deletedAt       DateTime? @map("deleted_at")
  blobObjectId    String    @map("blob_object_id")
  blobId          String?   @map("blob_id")
  sealSidecar     Json?     @map("seal_sidecar")
  createdAtMs     BigInt    @map("created_at_ms")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @default(now()) @updatedAt @map("updated_at")

  @@unique([assetsOnChainId, assetName, versionIndex], map: "soul_asset_version_unique")
  @@index([soulOnChainId, assetName, versionIndex(sort: Desc)])
  @@map("soul_asset_version_records")
}
```

- [ ] **Step 2: Add `ContentAccessRecord` model**

```prisma
model ContentAccessRecord {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId       String    @map("soul_on_chain_id")
  soul                SoulAsset @relation("SoulContentAccess", fields: [soulOnChainId], references: [onChainId], onDelete: Cascade)
  accessListOnChainId String    @map("access_list_on_chain_id")
  granteeAddress      String    @map("grantee_address")
  scopeMask           Int       @map("scope_mask")
  pricePaidAtomic     BigInt    @map("price_paid_atomic")
  grantedAtMs         BigInt    @map("granted_at_ms")
  expiresAtMs         BigInt?   @map("expires_at_ms")
  revokedAt           DateTime? @map("revoked_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @default(now()) @updatedAt @map("updated_at")

  @@unique([accessListOnChainId, granteeAddress], map: "content_access_unique")
  @@index([soulOnChainId])
  @@index([granteeAddress])
  @@map("content_access_records")
}
```

- [ ] **Step 3: Add relations to `SoulAsset` model**

In the existing `SoulAsset` model, add:

```prisma
  assetVersions    SoulAssetVersionRecord[] @relation("SoulAssetAssetVersions")
  contentAccess    ContentAccessRecord[]    @relation("SoulContentAccess")
  assetsOnChainId  String?                  @map("assets_on_chain_id")
  accessListOnChainId String?               @map("access_list_on_chain_id")
```

- [ ] **Step 4: Generate migration and Prisma client**

Run: `npx prisma migrate dev --schema=prisma/schema.prisma --name add_soul_assets_and_content_access`
Run: `npx prisma generate --schema=prisma/schema.prisma`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add SoulAssetVersionRecord and ContentAccessRecord models"
```

---

### Task 7: SDK Types and Events for SoulAssets

**Files:**
- Modify: `web/lib/soulidity/types.ts` (add asset types)
- Modify: `web/lib/soulidity/events.ts` (add asset event extractors)

- [ ] **Step 1: Add types to `types.ts`**

```typescript
// ── Asset types ──

export type AssetType = 'sprite' | 'live2d' | 'audio'

export interface AssetVersionObject {
  soulId: string
  assetsId: string
  assetName: string
  versionIndex: number
  visibility: 'public' | 'private'
  assetType: AssetType
  blobObjectId: string
  blobId?: string | null
  createdAtMs: number
}
```

- [ ] **Step 2: Add event extractors to `events.ts`**

Follow the exact pattern of `extractSkillVersionAppendedEvent`:

```typescript
export function extractAssetVersionAppendedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::assets::AssetVersionAppended`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('AssetVersionAppended event is missing from the transaction')
  }
  return {
    assetsId: readObjectId(event.assets_id, 'AssetVersionAppended assets_id'),
    soulId: readObjectId(event.soul_id, 'AssetVersionAppended soul_id'),
    assetName: readString(event.asset_name, 'AssetVersionAppended asset_name'),
    versionIndex: readNumber(event.version_index, 'AssetVersionAppended version_index'),
    visibility: Boolean(event.is_public) ? 'public' as const : 'private' as const,
    assetType: mapAssetType(readNumber(event.asset_type, 'AssetVersionAppended asset_type')),
    createdAtMs: readNumber(event.created_at_ms, 'AssetVersionAppended created_at_ms'),
    blobObjectId: readObjectId(event.blob_object_id, 'AssetVersionAppended blob_object_id'),
  }
}

function mapAssetType(value: number): AssetType {
  switch (value) {
    case 0: return 'sprite'
    case 1: return 'live2d'
    case 2: return 'audio'
    default: return 'sprite'
  }
}

export function extractContentAccessGrantedEvent(
  transaction: TransactionLike,
  packageId: string,
  trustedPackageIds?: string[],
) {
  const event = extractTypedEvent(transaction, `${packageId}::content_access::ContentAccessGranted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('ContentAccessGranted event is missing from the transaction')
  }
  return {
    soulId: readObjectId(event.soul_id, 'ContentAccessGranted soul_id'),
    accessListId: readObjectId(event.access_list_id, 'ContentAccessGranted access_list_id'),
    grantee: readAddress(event.grantee, 'ContentAccessGranted grantee'),
    scopeMask: readNumber(event.scope_mask, 'ContentAccessGranted scope_mask'),
    pricePaidAtomic: readNumber(event.price_paid_atomic, 'ContentAccessGranted price_paid_atomic'),
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/soulidity/types.ts web/lib/soulidity/events.ts
git commit -m "feat(sdk): add SoulAssets and ContentAccess types and event extractors"
```

---

### Task 8: Mirror/Sync for SoulAssets and ContentAccess

**Files:**
- Create: `web/lib/soulidity/mirror/upsert-asset.ts`
- Create: `web/lib/soulidity/mirror/upsert-content-access.ts`
- Modify: `web/lib/soulidity/mirror/sync-helpers.ts`

- [ ] **Step 1: Create `upsert-asset.ts`**

Follow `upsert-skill.ts` pattern exactly:

```typescript
import { prisma } from '@web/lib/prisma'
import type { AssetVersionObject } from '../types'
import { toProjectionBigInt } from './sync-helpers'

export async function upsertAssetVersionProjection(params: {
  version: AssetVersionObject
  soulOnChainId: string
  assetsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: object | null
}) {
  return prisma.soulAssetVersionRecord.upsert({
    where: {
      soul_asset_version_unique: {
        assetsOnChainId: params.assetsOnChainId,
        assetName: params.version.assetName,
        versionIndex: params.version.versionIndex,
      },
    },
    update: {
      soulOnChainId: params.soulOnChainId,
      assetsOnChainId: params.assetsOnChainId,
      assetName: params.version.assetName,
      versionIndex: params.version.versionIndex,
      assetType: params.version.assetType,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt === undefined ? undefined : params.deletedAt,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'AssetVersion createdAtMs'),
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      assetsOnChainId: params.assetsOnChainId,
      assetName: params.version.assetName,
      versionIndex: params.version.versionIndex,
      assetType: params.version.assetType,
      visibility: params.version.visibility,
      deletedAt: params.deletedAt ?? null,
      blobObjectId: params.version.blobObjectId,
      blobId: params.version.blobId,
      sealSidecar: params.sealSidecar ?? undefined,
      createdAtMs: toProjectionBigInt(params.version.createdAtMs, 'AssetVersion createdAtMs'),
    },
  })
}
```

- [ ] **Step 2: Create `upsert-content-access.ts`**

```typescript
import { prisma } from '@web/lib/prisma'
import { toProjectionBigInt } from './sync-helpers'

export async function upsertContentAccessProjection(params: {
  soulOnChainId: string
  accessListOnChainId: string
  granteeAddress: string
  scopeMask: number
  pricePaidAtomic: number
  grantedAtMs: number
  expiresAtMs?: number | null
}) {
  return prisma.contentAccessRecord.upsert({
    where: {
      content_access_unique: {
        accessListOnChainId: params.accessListOnChainId,
        granteeAddress: params.granteeAddress,
      },
    },
    update: {
      scopeMask: params.scopeMask,
      pricePaidAtomic: toProjectionBigInt(params.pricePaidAtomic, 'ContentAccess pricePaidAtomic'),
      grantedAtMs: toProjectionBigInt(params.grantedAtMs, 'ContentAccess grantedAtMs'),
      expiresAtMs: params.expiresAtMs != null ? toProjectionBigInt(params.expiresAtMs, 'ContentAccess expiresAtMs') : null,
      revokedAt: null,
    },
    create: {
      soulOnChainId: params.soulOnChainId,
      accessListOnChainId: params.accessListOnChainId,
      granteeAddress: params.granteeAddress,
      scopeMask: params.scopeMask,
      pricePaidAtomic: toProjectionBigInt(params.pricePaidAtomic, 'ContentAccess pricePaidAtomic'),
      grantedAtMs: toProjectionBigInt(params.grantedAtMs, 'ContentAccess grantedAtMs'),
      expiresAtMs: params.expiresAtMs != null ? toProjectionBigInt(params.expiresAtMs, 'ContentAccess expiresAtMs') : null,
    },
  })
}

export async function markContentAccessRevoked(params: {
  accessListOnChainId: string
  granteeAddress: string
}) {
  return prisma.contentAccessRecord.update({
    where: {
      content_access_unique: {
        accessListOnChainId: params.accessListOnChainId,
        granteeAddress: params.granteeAddress,
      },
    },
    data: { revokedAt: new Date() },
  })
}
```

- [ ] **Step 3: Add sync helpers to `sync-helpers.ts`**

```typescript
export async function syncAssetVersionProjectionFromChain(params: {
  version: AssetVersionObject
  soulOnChainId: string
  assetsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: SealEnvelopeSidecar | null
}) {
  return upsertAssetVersionProjection({
    version: params.version,
    soulOnChainId: params.soulOnChainId,
    assetsOnChainId: params.assetsOnChainId,
    deletedAt: params.deletedAt ?? null,
    sealSidecar: params.sealSidecar ?? null,
  })
}
```

- [ ] **Step 4: Commit**

```bash
git add web/lib/soulidity/mirror/upsert-asset.ts web/lib/soulidity/mirror/upsert-content-access.ts web/lib/soulidity/mirror/sync-helpers.ts
git commit -m "feat(sdk): add mirror/sync for SoulAssets and ContentAccess"
```

---

### Task 9: API Routes for Assets Access

**Files:**
- Create: `web/app/api/souls/[id]/assets/route.ts` (list assets)
- Create: `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts`

- [ ] **Step 1: Create list route**

```typescript
// web/app/api/souls/[id]/assets/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: soulOnChainId } = await params

  const versions = await prisma.soulAssetVersionRecord.findMany({
    where: { soulOnChainId, deletedAt: null },
    orderBy: [{ assetName: 'asc' }, { versionIndex: 'desc' }],
  })

  return NextResponse.json({ assets: versions })
}
```

- [ ] **Step 2: Create access route**

Mirror `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts` exactly, replacing skill-specific references with asset equivalents:
- `skillName` → `assetName`
- `skillsObjectId` → `assetsObjectId`
- `soulSkillVersionRecord` → `soulAssetVersionRecord`
- `seal_approve_private_read_owner` → `seal_approve_asset_read_owner`
- `seal_approve_private_read_granted_agent` → `seal_approve_asset_read_granted_agent`
- Module name: `'assets'` instead of `'skills'`
- Add allowlist check: after grant check, query `ContentAccessRecord` for viewer address with `SCOPE_ASSETS` (8) in `scopeMask`, return `seal_approve_asset_allowlisted` function name

- [ ] **Step 3: Commit**

```bash
git add web/app/api/souls/\[id\]/assets/
git commit -m "feat(api): add asset list and access routes"
```

---

### Task 10: API Routes for Content Access Management

**Files:**
- Create: `web/app/api/souls/[id]/access-list/route.ts` (GET: query)
- Create: `web/app/api/souls/[id]/access-list/purchase/route.ts` (POST: sync after purchase TX)
- Create: `web/app/api/souls/[id]/access-list/add/route.ts` (POST: manual add sync)
- Create: `web/app/api/souls/[id]/access-list/revoke/route.ts` (POST: revoke sync)

- [ ] **Step 1: Create query route**

```typescript
// web/app/api/souls/[id]/access-list/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: soulOnChainId } = await params

  const records = await prisma.contentAccessRecord.findMany({
    where: { soulOnChainId, revokedAt: null },
    orderBy: { grantedAtMs: 'desc' },
  })

  return NextResponse.json({ accessList: records })
}
```

- [ ] **Step 2: Create purchase sync route**

Follow the pattern of `web/app/api/souls/[id]/purchase/route.ts` — extract `ContentAccessGranted` event from TX, upsert `ContentAccessRecord`.

- [ ] **Step 3: Create add and revoke sync routes**

Same pattern — verify TX success, extract events, update DB.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/souls/\[id\]/access-list/
git commit -m "feat(api): add content access list management routes"
```

---

## Phase 3 — Desktop App

### Task 11: Status Protocol — Claude Code Adapter

**Files:**
- Create: `desktop/adapters/soulidity-claude-hook.js`

- [ ] **Step 1: Create the hook script**

Mirror the Confirmo hook pattern (`confirmo-hook.js`) with Soulidity paths:

```javascript
#!/usr/bin/env node
// Soulidity Desktop — Claude Code Status Hook
const fs = require('fs')
const path = require('path')
const os = require('os')

const STATUS_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(STATUS_DIR, 'agent-status.json')
const SESSIONS_DIR = path.join(STATUS_DIR, 'sessions')

function ensureDirs() {
  if (!fs.existsSync(STATUS_DIR)) fs.mkdirSync(STATUS_DIR, { recursive: true })
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, filePath)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (_) {}
    throw e
  }
}

function readStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
  } catch (_) {}
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

function updateSession(sessionId, updates) {
  ensureDirs()
  const sf = path.join(SESSIONS_DIR, sessionId.replace(/[/\\:]/g, '_') + '.json')
  let session = { sessionId, startedAt: Date.now() }
  try { if (fs.existsSync(sf)) session = JSON.parse(fs.readFileSync(sf, 'utf-8')) } catch (_) {}
  Object.assign(session, updates, { lastUpdated: Date.now() })
  writeAtomic(sf, session)

  const status = readStatus()
  status.sessions[sessionId] = session
  status.lastUpdated = Date.now()
  // Cleanup sessions older than 24h
  const cutoff = Date.now() - 86400000
  for (const [id, s] of Object.entries(status.sessions)) {
    if (s.endedAt && s.endedAt < cutoff) {
      delete status.sessions[id]
      try { fs.unlinkSync(path.join(SESSIONS_DIR, id.replace(/[/\\:]/g, '_') + '.json')) } catch (_) {}
    }
  }
  writeAtomic(STATUS_FILE, status)
}

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  if (!input.trim()) process.exit(0)

  let data
  try { data = JSON.parse(input) } catch (_) { process.exit(0) }

  const { session_id, cwd, hook_event_name, tool_name, tool_input, prompt } = data
  if (!session_id) process.exit(0)
  const now = Date.now()

  switch (hook_event_name) {
    case 'SessionStart':
      updateSession(session_id, { clientType: 'claude-code', status: 'idle', workingDirectory: cwd, startedAt: now })
      break
    case 'UserPromptSubmit': {
      let title
      if (prompt) {
        let clean = String(prompt).replace(/<system[-_]?(?:instruction|reminder)[^>]*>[\s\S]*?<\/system[-_]?(?:instruction|reminder)>/gi, '').trim()
        if (clean) title = clean.slice(0, 100).split('\n')[0].trim()
      }
      updateSession(session_id, { status: 'working', workingDirectory: cwd, sessionTitle: title, currentAction: { type: 'prompt', timestamp: now } })
      break
    }
    case 'PreToolUse': {
      let details = tool_name || 'unknown'
      if (tool_input) {
        if (tool_input.command) details += ': ' + String(tool_input.command).slice(0, 50)
        else if (tool_input.file_path) details += ': ' + path.basename(String(tool_input.file_path))
        else if (tool_input.pattern) details += ': ' + String(tool_input.pattern).slice(0, 30)
      }
      const attentionTools = ['ExitPlanMode', 'AskUserQuestion']
      updateSession(session_id, {
        status: 'working',
        needsAttention: attentionTools.includes(tool_name) ? tool_name : null,
        currentAction: { tool: tool_name, details, timestamp: now },
      })
      break
    }
    case 'PostToolUse':
      updateSession(session_id, { status: 'working', currentAction: null })
      break
    case 'Stop':
      updateSession(session_id, { status: 'completed', currentAction: null })
      break
    case 'SessionEnd':
      updateSession(session_id, { status: 'idle', endedAt: now, currentAction: null })
      break
  }
}
main().catch(() => process.exit(0))
```

- [ ] **Step 2: Commit**

```bash
git add desktop/adapters/soulidity-claude-hook.js
git commit -m "feat(desktop): add Claude Code status hook adapter"
```

---

### Task 12: Status Protocol — Codex Adapter

**Files:**
- Create: `desktop/adapters/soulidity-codex-hook.js`

- [ ] **Step 1: Create the Codex hook**

```javascript
#!/usr/bin/env node
// Soulidity Desktop — Codex Status Hook
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const STATUS_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(STATUS_DIR, 'agent-status.json')
const SESSIONS_DIR = path.join(STATUS_DIR, 'sessions')
const ORIGINAL_NOTIFY_FILE = path.join(os.homedir(), '.soulidity', 'hooks', 'codex-original-notify.json')

// ... same ensureDirs, writeAtomic, readStatus, updateSession as Claude hook ...

function forwardToOriginalNotify(jsonArg) {
  try {
    if (!fs.existsSync(ORIGINAL_NOTIFY_FILE)) return
    const saved = JSON.parse(fs.readFileSync(ORIGINAL_NOTIFY_FILE, 'utf-8'))
    if (!saved || !Array.isArray(saved.notify) || saved.notify.length === 0) return
    const [command, ...args] = saved.notify
    spawnSync(command, [...args, jsonArg], { stdio: 'ignore', timeout: 30000 })
  } catch (_) {}
}

function extractTitle(inputMessages) {
  if (!inputMessages || !Array.isArray(inputMessages)) return undefined
  for (const msg of inputMessages) {
    if (msg.role === 'user' && msg.content) {
      if (typeof msg.content === 'string') return msg.content.slice(0, 100).split('\n')[0].trim()
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if ((part.type === 'text' || part.type === 'input_text') && part.text) {
            return part.text.slice(0, 100).split('\n')[0].trim()
          }
        }
      }
    }
  }
}

function main() {
  const jsonArg = process.argv[2]
  if (!jsonArg) { forwardToOriginalNotify(''); process.exit(0) }
  forwardToOriginalNotify(jsonArg)

  let data
  try { data = JSON.parse(jsonArg) } catch (_) { process.exit(0) }
  if (data.type !== 'agent-turn-complete') process.exit(0)

  const sessionId = data['thread-id'] || 'unknown'
  const title = extractTitle(data['input-messages'])

  updateSession(sessionId, {
    clientType: 'codex',
    status: 'completed',
    workingDirectory: data.cwd,
    sessionTitle: title,
    currentAction: null,
  })
}
try { main() } catch (_) { process.exit(0) }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/adapters/soulidity-codex-hook.js
git commit -m "feat(desktop): add Codex status hook adapter"
```

---

### Task 13: Rust File Watcher and Agent Status Command

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml` (add `notify` dependency)
- Create: `desktop/src-tauri/src/agent_status.rs`
- Modify: `desktop/src-tauri/src/lib.rs` (register command + setup watcher)

- [ ] **Step 1: Add dependency**

Add to `[dependencies]` in `Cargo.toml`:

```toml
notify = { version = "7", default-features = false, features = ["macos_fsevent"] }
```

- [ ] **Step 2: Create `agent_status.rs`**

```rust
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub session_id: String,
    pub client_type: Option<String>,
    pub status: String,
    pub working_directory: Option<String>,
    pub session_title: Option<String>,
    pub current_action: Option<serde_json::Value>,
    pub needs_attention: Option<String>,
    pub started_at: Option<u64>,
    pub last_updated: Option<u64>,
    pub ended_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusFile {
    pub version: u32,
    pub last_updated: u64,
    pub sessions: std::collections::HashMap<String, AgentSession>,
}

fn status_file_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".soulidity").join("agent-status.json")
}

#[tauri::command]
pub fn get_current_agent_status() -> Result<Option<AgentStatusFile>, String> {
    let path = status_file_path();
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read agent status: {e}"))?;
    serde_json::from_str::<AgentStatusFile>(&contents)
        .map(Some)
        .map_err(|e| format!("Failed to parse agent status: {e}"))
}

pub fn setup_status_watcher(app: &AppHandle) {
    let app_handle = app.clone();
    let status_path = status_file_path();

    // Ensure directory exists
    if let Some(parent) = status_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(_) => return,
        };

        let watch_dir = status_path.parent().unwrap();
        if watcher.watch(watch_dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        for event in rx {
            if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                if event.paths.iter().any(|p| p.ends_with("agent-status.json")) {
                    if let Ok(contents) = fs::read_to_string(&status_path) {
                        if let Ok(status) = serde_json::from_str::<AgentStatusFile>(&contents) {
                            let _ = app_handle.emit("agent-status-changed", &status);
                        }
                    }
                }
            }
        }
    });
}
```

- [ ] **Step 3: Register in `lib.rs`**

Add module declaration at top:

```rust
mod agent_status;
```

Add command to invoke_handler:

```rust
agent_status::get_current_agent_status
```

Add watcher setup in `run()` after Builder, using `.setup()`:

```rust
.setup(|app| {
    agent_status::setup_status_watcher(app.handle());
    Ok(())
})
```

- [ ] **Step 4: Add `dirs` dependency to Cargo.toml**

```toml
dirs = "6"
```

- [ ] **Step 5: Build and verify**

Run: `cd desktop && npm run tauri -- build -- --debug 2>&1 | tail -10` (or just `cargo check` in src-tauri)

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/
git commit -m "feat(desktop): add agent status file watcher with Tauri event emission"
```

---

### Task 14: Agent Keypair Generation

**Files:**
- Create: `desktop/src-tauri/src/agent_wallet.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies to Cargo.toml**

```toml
ed25519-dalek = { version = "2", features = ["rand_core"] }
rand = "0.8"
hex = "0.4"
```

- [ ] **Step 2: Create `agent_wallet.rs`**

```rust
use std::fs;
use std::path::PathBuf;

use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentKeypairInfo {
    pub address: String,
    pub public_key_hex: String,
}

#[derive(Serialize, Deserialize)]
struct StoredKeypair {
    secret_key_hex: String,
    public_key_hex: String,
    address: String,
}

fn keypair_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("state/agent_keypair.json", BaseDirectory::AppData)
        .map_err(|e| format!("Failed to resolve keypair path: {e}"))
}

fn sui_address_from_ed25519_pubkey(pubkey_bytes: &[u8; 32]) -> String {
    use sha2::{Digest, Sha256};
    // Sui address = SHA256(0x00 || pubkey)[0..32] as hex with 0x prefix
    let mut hasher = Sha256::new();
    hasher.update([0x00]); // ED25519 scheme flag
    hasher.update(pubkey_bytes);
    let hash = hasher.finalize();
    format!("0x{}", hex::encode(&hash[..32]))
}

#[tauri::command]
pub fn generate_agent_keypair(app: AppHandle) -> Result<AgentKeypairInfo, String> {
    let path = keypair_path(&app)?;

    // Return existing if already generated
    if path.exists() {
        let contents = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read keypair: {e}"))?;
        let stored: StoredKeypair = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse keypair: {e}"))?;
        return Ok(AgentKeypairInfo {
            address: stored.address,
            public_key_hex: stored.public_key_hex,
        });
    }

    // Generate new keypair
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let pubkey_bytes = verifying_key.to_bytes();
    let address = sui_address_from_ed25519_pubkey(&pubkey_bytes);

    let stored = StoredKeypair {
        secret_key_hex: hex::encode(signing_key.to_bytes()),
        public_key_hex: hex::encode(pubkey_bytes),
        address: address.clone(),
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create keypair directory: {e}"))?;
    }

    let payload = serde_json::to_string_pretty(&stored)
        .map_err(|e| format!("Failed to encode keypair: {e}"))?;
    fs::write(&path, payload)
        .map_err(|e| format!("Failed to write keypair: {e}"))?;

    Ok(AgentKeypairInfo {
        address,
        public_key_hex: stored.public_key_hex,
    })
}

#[tauri::command]
pub fn load_agent_keypair(app: AppHandle) -> Result<Option<AgentKeypairInfo>, String> {
    let path = keypair_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read keypair: {e}"))?;
    let stored: StoredKeypair = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse keypair: {e}"))?;
    Ok(Some(AgentKeypairInfo {
        address: stored.address,
        public_key_hex: stored.public_key_hex,
    }))
}
```

- [ ] **Step 3: Register in `lib.rs`**

Add `mod agent_wallet;` and register commands:

```rust
agent_wallet::generate_agent_keypair,
agent_wallet::load_agent_keypair,
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/
git commit -m "feat(desktop): add agent Ed25519 keypair generation and Sui address derivation"
```

---

### Task 15: PetOverlay Window

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs` (add overlay window commands)
- Create: `desktop/src/overlay.tsx` (overlay React entry)
- Create: `desktop/overlay.html` (overlay HTML entry)
- Modify: `desktop/vite.config.ts` (add overlay entry point)

- [ ] **Step 1: Add Rust commands for overlay window management**

In `lib.rs`, add:

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn spawn_pet_overlay(app: AppHandle, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    if app.get_webview_window("pet-overlay").is_some() {
        return Ok(()); // Already open
    }

    let mut builder = WebviewWindowBuilder::new(&app, "pet-overlay", WebviewUrl::App("overlay.html".into()))
        .title("Soulidity Pet")
        .inner_size(256.0, 256.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false);

    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }

    builder.build()
        .map_err(|e| format!("Failed to create overlay window: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn close_pet_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pet-overlay") {
        window.close().map_err(|e| format!("Failed to close overlay: {e}"))?;
    }
    Ok(())
}
```

Register both commands in `invoke_handler`.

- [ ] **Step 2: Create `desktop/overlay.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Soulidity Pet</title>
  <style>
    * { margin: 0; padding: 0; }
    html, body { background: transparent; overflow: hidden; width: 256px; height: 256px; }
    canvas { width: 256px; height: 256px; cursor: grab; }
    canvas:active { cursor: grabbing; }
  </style>
</head>
<body>
  <div id="overlay-root"></div>
  <script type="module" src="/src/overlay.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create `desktop/src/overlay.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

interface AgentSession {
  status: string
  sessionTitle?: string
  currentAction?: { tool?: string; details?: string }
}

interface AgentStatusFile {
  sessions: Record<string, AgentSession>
}

function PetOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<string>('idle')

  useEffect(() => {
    // Listen for status changes from file watcher
    const unlisten = listen<AgentStatusFile>('agent-status-changed', (event) => {
      const sessions = Object.values(event.payload.sessions)
      // Use the most recently updated active session
      const active = sessions
        .filter(s => s.status !== 'idle')
        .sort((a, b) => (b as any).lastUpdated - (a as any).lastUpdated)[0]
      setStatus(active?.status ?? 'idle')
    })

    // Load initial status
    invoke<AgentStatusFile | null>('get_current_agent_status').then(file => {
      if (!file) return
      const sessions = Object.values(file.sessions)
      const active = sessions.filter(s => s.status !== 'idle')[0]
      setStatus(active?.status ?? 'idle')
    })

    return () => { unlisten.then(fn => fn()) }
  }, [])

  // Sprite rendering will be wired in Task 16
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Placeholder: draw status text
    ctx.clearRect(0, 0, 256, 256)
    ctx.fillStyle = '#f3b562'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(status, 128, 128)
  }, [status])

  return <canvas ref={canvasRef} width={256} height={256} />
}

ReactDOM.createRoot(document.getElementById('overlay-root')!).render(<PetOverlay />)
```

- [ ] **Step 4: Update `vite.config.ts` for multi-page**

Add overlay as a second entry point:

```typescript
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      overlay: resolve(__dirname, 'overlay.html'),
    },
  },
},
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs desktop/overlay.html desktop/src/overlay.tsx desktop/vite.config.ts
git commit -m "feat(desktop): add PetOverlay transparent window with status listener"
```

---

### Task 16: Sprite Sheet Renderer

**Files:**
- Create: `desktop/src/lib/sprite-renderer.ts`

- [ ] **Step 1: Create sprite renderer class**

```typescript
export interface SpriteAnimation {
  frames: number[]
  fps: number
  loop: boolean
}

export interface SpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, SpriteAnimation>
}

export class SpriteRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sheet: HTMLImageElement | null = null
  private config: SpriteSheetConfig | null = null
  private currentAnimation: string = ''
  private currentFrameIdx: number = 0
  private lastFrameTime: number = 0
  private animationId: number = 0
  private running: boolean = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  async load(config: SpriteSheetConfig): Promise<void> {
    this.config = config
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => { this.sheet = img; resolve() }
      img.onerror = reject
      img.src = config.src
    })
  }

  play(animationName: string): void {
    if (!this.config || !this.config.animations[animationName]) return
    if (this.currentAnimation === animationName && this.running) return

    this.currentAnimation = animationName
    this.currentFrameIdx = 0
    this.lastFrameTime = 0
    this.running = true

    if (!this.animationId) {
      this.animationId = requestAnimationFrame((t) => this.tick(t))
    }
  }

  stop(): void {
    this.running = false
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = 0
    }
  }

  private tick(timestamp: number): void {
    if (!this.running || !this.config || !this.sheet) return

    const anim = this.config.animations[this.currentAnimation]
    if (!anim) return

    const frameDuration = 1000 / anim.fps

    if (timestamp - this.lastFrameTime >= frameDuration) {
      this.drawFrame(anim.frames[this.currentFrameIdx])
      this.lastFrameTime = timestamp
      this.currentFrameIdx++

      if (this.currentFrameIdx >= anim.frames.length) {
        if (anim.loop) {
          this.currentFrameIdx = 0
        } else {
          this.running = false
          // Fall back to idle after non-loop animation
          if (this.config.animations['idle']) {
            this.play('idle')
          }
          return
        }
      }
    }

    this.animationId = requestAnimationFrame((t) => this.tick(t))
  }

  private drawFrame(frameIndex: number): void {
    if (!this.config || !this.sheet) return
    const { frameWidth, frameHeight, columns } = this.config
    const col = frameIndex % columns
    const row = Math.floor(frameIndex / columns)
    const sx = col * frameWidth
    const sy = row * frameHeight

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.drawImage(
      this.sheet,
      sx, sy, frameWidth, frameHeight,
      0, 0, this.canvas.width, this.canvas.height,
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/sprite-renderer.ts
git commit -m "feat(desktop): add Canvas-based sprite sheet renderer"
```

---

### Task 17: Wire Status Events to Sprite Animation in Overlay

**Files:**
- Modify: `desktop/src/overlay.tsx`
- Create: `desktop/src/lib/status-to-animation.ts`

- [ ] **Step 1: Create status-to-animation mapper**

```typescript
// desktop/src/lib/status-to-animation.ts

export interface PersonaStateMap {
  idle: string
  thinking: string
  working: string
  'needs-attention': string
  completed: string
  error: string
}

const DEFAULT_STATE_MAP: PersonaStateMap = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  'needs-attention': 'needs-attention',
  completed: 'completed',
  error: 'error',
}

export function resolveAnimationName(
  agentStatus: string,
  stateMap: PersonaStateMap = DEFAULT_STATE_MAP,
): string {
  return (stateMap as Record<string, string>)[agentStatus] ?? stateMap.idle
}
```

- [ ] **Step 2: Update `overlay.tsx` to use SpriteRenderer**

Replace the placeholder canvas drawing with:

```tsx
import { SpriteRenderer, type SpriteSheetConfig } from './lib/sprite-renderer'
import { resolveAnimationName } from './lib/status-to-animation'

// In the component:
const rendererRef = useRef<SpriteRenderer | null>(null)

useEffect(() => {
  const canvas = canvasRef.current
  if (!canvas) return

  const renderer = new SpriteRenderer(canvas)
  rendererRef.current = renderer

  // Load active persona's sprite sheet config from local storage
  invoke<string | null>('load_active_persona_sprite_config').then(configJson => {
    if (!configJson) return
    const config: SpriteSheetConfig = JSON.parse(configJson)
    renderer.load(config).then(() => renderer.play('idle'))
  })

  return () => renderer.stop()
}, [])

useEffect(() => {
  if (!rendererRef.current) return
  const animName = resolveAnimationName(status)
  rendererRef.current.play(animName)
}, [status])
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/overlay.tsx desktop/src/lib/status-to-animation.ts
git commit -m "feat(desktop): wire agent status events to sprite animation in overlay"
```

---

### Task 18: Agent Wallet UI and LLM Config Placeholder

**Files:**
- Modify: `desktop/src/App.tsx` (add /agents and /llm-settings routes)

- [ ] **Step 1: Add routes to `desktop/src/app/routes.ts`**

Add two new route definitions:

```typescript
{ id: 'agents', title: 'My Agents', path: '/agents' },
{ id: 'llm-settings', title: 'LLM Settings', path: '/llm-settings' },
```

- [ ] **Step 2: Add agents page content in `App.tsx`**

In the main render section, add handler for `isAgentsRoute`:

```tsx
// Shows agent address, grant status, and "Generate Keypair" button
// Calls invoke('generate_agent_keypair') on button click
// Displays agent address for copy
```

- [ ] **Step 3: Add LLM settings page content**

```tsx
// Simple form: provider dropdown, API key input, "use local" toggle
// Saves to local storage via invoke('save_llm_config')
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/
git commit -m "feat(desktop): add agent wallet and LLM config settings pages"
```

---

### Task 19: "Release to Desktop" Button in Library

**Files:**
- Modify: `desktop/src/App.tsx` (library route section)

- [ ] **Step 1: Add "Release to Desktop" button to library route**

In the library section of App.tsx, for the active persona, add a button that calls:

```typescript
invoke('spawn_pet_overlay', { x: null, y: null })
```

And a "Recall" button that calls:

```typescript
invoke('close_pet_overlay')
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/App.tsx
git commit -m "feat(desktop): add release/recall pet overlay controls in library"
```

---

## Phase 4 — Integration and Verification

### Task 20: Typecheck and Build Verification

- [ ] **Step 1: Run Move tests**

Run: `sui move test --path move/soulidity`
Expected: All tests PASS

- [ ] **Step 2: Run Prisma generate**

Run: `npx prisma generate --schema=prisma/schema.prisma`
Expected: Client generated successfully

- [ ] **Step 3: Run web typecheck**

Run: `npm --prefix new-web run typecheck 2>&1 | tail -20`
Expected: No errors (fix any type issues)

- [ ] **Step 4: Run web build**

Run: `npm --prefix new-web run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Run desktop typecheck**

Run: `cd desktop && npm run typecheck 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 6: Run existing tests**

Run: `npm test 2>&1 | tail -20`
Expected: All existing tests pass

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: fix typecheck and build issues from desktop companion integration"
```

---

## File Map Summary

### New Files
| File | Purpose |
|------|---------|
| `move/soulidity/sources/assets.move` | SoulAssets module (on-chain asset storage) |
| `move/soulidity/sources/content_access.move` | ContentAccessList module (allowlist access control) |
| `desktop/adapters/soulidity-claude-hook.js` | Claude Code status adapter |
| `desktop/adapters/soulidity-codex-hook.js` | Codex status adapter |
| `desktop/src-tauri/src/agent_status.rs` | File watcher + status command |
| `desktop/src-tauri/src/agent_wallet.rs` | Ed25519 keypair generation |
| `desktop/overlay.html` | Overlay window HTML entry |
| `desktop/src/overlay.tsx` | Overlay React component |
| `desktop/src/lib/sprite-renderer.ts` | Canvas sprite sheet renderer |
| `desktop/src/lib/status-to-animation.ts` | Status → animation mapper |
| `web/lib/soulidity/mirror/upsert-asset.ts` | Asset version DB sync |
| `web/lib/soulidity/mirror/upsert-content-access.ts` | Content access DB sync |
| `web/app/api/souls/[id]/assets/route.ts` | List assets API |
| `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts` | Asset access API |
| `web/app/api/souls/[id]/access-list/route.ts` | Content access list query API |
| `web/app/api/souls/[id]/access-list/purchase/route.ts` | Purchase sync API |
| `web/app/api/souls/[id]/access-list/add/route.ts` | Manual add sync API |
| `web/app/api/souls/[id]/access-list/revoke/route.ts` | Revoke sync API |

### Modified Files
| File | Change |
|------|--------|
| `move/soulidity/sources/soul.move` | Add `assets_id` field, getter, setter |
| `move/soulidity/sources/grant.move` | Add `SCOPE_ASSETS = 8` |
| `move/soulidity/sources/market.move` | Create SoulAssets + ContentAccessList on mint |
| `move/soulidity/sources/protocol_tests.move` | Add asset + content access tests |
| `prisma/schema.prisma` | Add 2 new models + relations |
| `web/lib/soulidity/types.ts` | Add asset types |
| `web/lib/soulidity/events.ts` | Add asset + content access event extractors |
| `web/lib/soulidity/mirror/sync-helpers.ts` | Add asset sync helper |
| `desktop/src-tauri/Cargo.toml` | Add notify, ed25519-dalek, dirs, hex, rand |
| `desktop/src-tauri/src/lib.rs` | Register new commands, setup watcher |
| `desktop/src/App.tsx` | Add agents + LLM settings routes, overlay controls |
| `desktop/src/app/routes.ts` | Add new route definitions |
| `desktop/vite.config.ts` | Multi-page build (main + overlay) |
