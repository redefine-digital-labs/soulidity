# SoulAssets + ContentAccessList — 合约及依赖层实施计划

> 从 Desktop Companion 完整设计中抽取的**合约 + 数据层 + SDK/API 层**独立实施计划。
> 不含桌面端 (Tauri/状态协议/Sprite/Agent 钱包/LLM 配置)。

**目标:** 为 Soul 新增通用资产存储层 (SoulAssets) 和独立于 grant 的内容访问权售卖机制 (ContentAccessList)，支撑桌面形象、语音等可售内容。

**原始设计:** `docs/superpowers/specs/2026-04-10-desktop-companion-design.md` — Module 5 / Module 6

**依赖:** 无外部服务依赖；但必须与当前仓库已有的 `move/soulidity + prisma + web/lib/soulidity + web/app/api` 契约保持一致。本计划完成后，桌面端和 marketplace UI 才能独立接入。

**验收:**
1. `sui move build --path move/soulidity` 通过
2. `sui move test --path move/soulidity` 全部通过
3. `npx prisma migrate dev --schema=prisma/schema.prisma` 成功
4. `npm --prefix web run typecheck` 通过
5. `npm --prefix web run build` 通过
6. `npm test -- tests/new-web/** tests/web/**` 中相关测试通过

## 关键修订（以下 Task 均以本节为准）

1. 本仓库当前运行时目录是 `web/`，不是 `new-web/`；文内凡涉及前端/SDK/API 路径和验收，均以 `web/**` 为准，测试则覆盖 `tests/new-web/**` 与 `tests/web/**` 的相关用例。
2. `SoulAssets` 的 `Blob` 存储必须与现有 `memory.move` / `skills.move` 一致：使用 `sui::dynamic_object_field` 挂在 `SoulAssets.id` 下，并记录 `blob_object_id`。禁止把 `Blob` wrapper `transfer` 到 `@0x0`。
3. `ContentAccessList` 一期支付语义采用“精确付款”而非“允许多付”：`purchase_content_access` 必须要求 `payment.value() == price_atomic`，否则链上多收款且无找零路径。若后续要支持自动拆分/找零，需单独补 tx builder 与测试。
4. mint 签名一旦扩展，必须同轮修改 `web/lib/soulidity/tx/publish.ts`、`tx/import.ts`、`tx/personal-join.ts` 以及对应的 publish/import/wrap-link sync 路由；仅改 Move 签名不改 SDK builder 视为未完成。
5. `assetsOnChainId` / `accessListOnChainId` 不能靠“后续手查对象”补录，必须在 mint 后通过事件提取 + projection patch 落到 `SoulAsset` 主记录，方式与当前 `skillsOnChainId` fallback patch 同级。
6. 资产私读不能复用旧的 `web/lib/services/seal.ts` allowlist descriptor；必须新增与 `skill-access.ts` 同模式的资产访问响应类型、document-id 生成器、审批 PTB builder、human/agent 两套路由。
7. 事件闭环必须覆盖 `AssetVersionAppended`、`AssetVersionDeleted`、`ContentAccessListCreated`、`ContentAccessGranted`、`ContentAccessRevoked`；只做 append/grant extractor 不足以支撑 projection 与 API。

---

## Phase 1 — Move 合约

### Task 1: 新建 `assets.move` — SoulAssets 模块

**文件:** 新建 `move/soulidity/sources/assets.move`

与 `skills.move` 同构，新增 `asset_type` 字段；`Blob` 生命周期、document-id 校验、测试辅助函数均按 `skills.move` 的现有模式复制，不另起一套存储语义。

- [ ] **Step 1: 创建 structs + events + 常量**

```move
module soulidity::assets {
    use std::string::{Self as string, String};
    use sui::dynamic_object_field as dof;
    use sui::table;
    use sui::event;
    use sui::clock::Clock;
    use walrus::blob::{Self as blob, Blob};
    use soulidity::soul::{Self, SoulState};
    use soulidity::grant::{Self, SoulGrant};

    // ── Error codes ──
    const EAssetsMismatch: u64 = 1;
    const EAssetNotFound: u64 = 2;
    const EVersionOutOfBounds: u64 = 3;
    const EAssetVersionDeleted: u64 = 4;
    const EEmptyAssetName: u64 = 5;

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

- [ ] **Step 2: 内部 helpers (与 skills.move 同模式)**

```move
    // ── Internal helpers ──

    fun assert_assets_matches_state(assets: &SoulAssets, state: &SoulState) {
        assert!(assets.soul_id == soul::soul_id(state), EAssetsMismatch);
        let expected_id = soul::assets_id(state);
        assert!(expected_id.is_some() && *expected_id.borrow() == object::id(assets), EAssetsMismatch);
    }

    fun borrow_slot(assets: &SoulAssets, asset_name: String, version_index: u64): &AssetSlot {
        assert!(table::contains(&assets.assets, copy asset_name), EAssetNotFound);
        let versions = table::borrow(&assets.assets, asset_name);
        assert!(version_index < versions.length(), EVersionOutOfBounds);
        vector::borrow(versions, version_index)
    }

    fun borrow_slot_mut(assets: &mut SoulAssets, asset_name: String, version_index: u64): &mut AssetSlot {
        assert!(table::contains(&assets.assets, copy asset_name), EAssetNotFound);
        let versions = table::borrow_mut(&mut assets.assets, asset_name);
        assert!(version_index < versions.length(), EVersionOutOfBounds);
        vector::borrow_mut(versions, version_index)
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
        assert!(!string::is_empty(&asset_name), EEmptyAssetName);
        let created_at_ms = clock.timestamp_ms();
        let blob_object_id = blob::object_id(&content_blob);
        let slot = AssetSlot {
            blob_object_id,
            is_public,
            deleted: false,
            asset_type,
            created_at_ms,
        };

        let version_index = if (table::contains(&assets.assets, copy asset_name)) {
            let versions = table::borrow_mut(&mut assets.assets, copy asset_name);
            let next_index = versions.length();
            vector::push_back(versions, slot);
            next_index
        } else {
            table::add(&mut assets.assets, copy asset_name, vector[slot]);
            assets.asset_count = assets.asset_count + 1;
            0
        };

        dof::add(
            &mut assets.id,
            AssetBlobKey {
                asset_name: copy asset_name,
                version_index,
            },
            content_blob,
        );
        event::emit(AssetVersionAppended {
            assets_id: object::id(assets),
            soul_id: assets.soul_id,
            asset_name,
            version_index,
            is_public,
            asset_type,
            created_at_ms,
            blob_object_id,
        });

        version_index
    }
```

- [ ] **Step 3: public 函数 (create / getters / append / delete)**

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
```

- [ ] **Step 4: Seal approval 函数 + document ID 匹配**

```move
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
    // Format: [prefix "soul-asset:" ++ version_byte ++ assets_id ++ asset_name ++ 0x00 ++ version_index ++ nonce]

    fun assert_matching_document_id(
        id: vector<u8>,
        expected_assets_id: ID,
        expected_asset_name: String,
        expected_version_index: u64,
    ) {
        // Follow the same sentinel-based pattern used by skills.move
        let prefix = b"soul-asset:";
        let prefix_len = prefix.length();
        let asset_name_bytes = string::as_bytes(&expected_asset_name);
        let asset_name_len = asset_name_bytes.length();
        assert!(id.length() >= prefix_len + 1 + 32 + asset_name_len + 1 + 8 + 16, 100);
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
        i = 0;
        while (i < asset_name_len) {
            assert!(id[offset + i] == asset_name_bytes[i], 100);
            i = i + 1;
        };
        assert!(id[offset + asset_name_len] == 0x00, 100);
        let offset = offset + asset_name_len + 1;
        // version_index (8 bytes big-endian)
        let mut vi = expected_version_index;
        i = 0;
        while (i < 8) {
            let byte_pos = 7 - i;
            assert!(id[offset + byte_pos] == ((vi & 0xff) as u8), 100);
            vi = vi >> 8;
            i = i + 1;
        };
        // Remaining 16 bytes are nonce — no validation needed
    }
}
```

- [ ] **Step 5: 编译验证**

```bash
sui move build --path move/soulidity 2>&1 | tail -5
```

预期: 可能因 `soul::assets_id` 和 `grant::scope_assets` 缺失而失败 — Task 2 补齐。

- [ ] **Step 6: 提交**

```bash
git add move/soulidity/sources/assets.move
git commit -m "feat(move): add SoulAssets module — asset storage with versioning and seal approval"
```

---

### Task 2: 修改 `soul.move` + `grant.move` — 支持 Assets

**文件:**
- 修改: `move/soulidity/sources/soul.move`
- 修改: `move/soulidity/sources/grant.move`

- [ ] **Step 1: SoulState 新增 `assets_id` 字段**

在 `SoulState` struct 的 `skills_id` 之后加:

```move
    assets_id: Option<ID>,
```

`create_state` 函数体中 `skills_id: option::none()` 之后加:

```move
        assets_id: option::none(),
```

新增 getter + setter:

```move
public fun assets_id(self: &SoulState): &Option<ID> {
    &self.assets_id
}

public(package) fun set_assets_id(state: &mut SoulState, assets_id: ID) {
    assert!(state.assets_id.is_none(), EAssetsAlreadyBound);
    state.assets_id = option::some(assets_id);
}
```

新增错误码 (用下一个可用编号):

```move
const EAssetsAlreadyBound: u64 = 12;
```

- [ ] **Step 2: grant.move 新增 `SCOPE_ASSETS`**

在 `SCOPE_SKILLS` 之后加:

```move
const SCOPE_ASSETS: u64 = 8;
```

新增 getter:

```move
public fun scope_assets(): u64 { SCOPE_ASSETS }
```

- [ ] **Step 3: 更新所有 SoulState 解构模式**

搜索 `soul.move` 和 `protocol_tests.move` 中所有 `SoulState { ... }` 解构，补 `assets_id: _,`。

- [ ] **Step 4: 编译验证**

```bash
sui move build --path move/soulidity 2>&1 | tail -5
```

- [ ] **Step 5: 提交**

```bash
git add move/soulidity/sources/soul.move move/soulidity/sources/grant.move
git commit -m "feat(move): add assets_id to SoulState and SCOPE_ASSETS to grant"
```

---

### Task 3: 新建 `content_access.move` — ContentAccessList 模块

**文件:** 新建 `move/soulidity/sources/content_access.move`

独立于 grant 体系。不随 Soul 所有权转移失效。按 address 索引 O(1) 查找。

- [ ] **Step 1: 创建完整模块**

```move
module soulidity::content_access {
    use std::string::String;
    use sui::table;
    use sui::event;
    use sui::clock::Clock;
    use sui::coin::Coin;
    use sui::usdc::USDC;
    use soulidity::soul::{Self, SoulState};
    // ── Error codes ──
    const ENotCreatorOrOwner: u64 = 1;
    const EAlreadyHasAccess: u64 = 2;
    const ENoAccessEntry: u64 = 3;
    const EAccessExpired: u64 = 4;
    const EScopeMismatch: u64 = 5;
    const EIncorrectPaymentAmount: u64 = 6;
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
        assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
        assert!(!access_list.entries.contains(buyer), EAlreadyHasAccess);
        let paid = payment.value();
        assert!(paid == access_list.price_atomic, EIncorrectPaymentAmount);

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

- [ ] **Step 2: 编译验证**

```bash
sui move build --path move/soulidity 2>&1 | tail -10
```

注意: USDC import 路径需与 `market.move` 现有用法一致。

- [ ] **Step 3: 提交**

```bash
git add move/soulidity/sources/content_access.move
git commit -m "feat(move): add ContentAccessList module — allowlist-based content access control"
```

---

### Task 4: 修改 `market.move` — mint 集成 SoulAssets + ContentAccessList

**文件:**
- 修改: `move/soulidity/sources/market.move`
- 修改: `web/lib/soulidity/tx/publish.ts`
- 修改: `web/lib/soulidity/tx/import.ts`
- 修改: `web/lib/soulidity/tx/personal-join.ts`
- 修改: `web/app/api/souls/publish/route.ts`
- 修改: `web/app/api/import/route.ts`
- 修改: `web/app/api/wrap-link/personal/route.ts`

- [ ] **Step 1: 更新 `mint_native_in_personal_kiosk` 签名**

新增参数 (在 `skills_public` 之后):

```move
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
```

- [ ] **Step 2: `mint_soul_in_personal_kiosk_impl` 内新增创建逻辑**

在 skills 创建块之后:

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

新增 import:

```move
    use soulidity::assets;
    use soulidity::content_access;
```

- [ ] **Step 3: 同样更新 `mint_imported_in_personal_kiosk` 和 `mint_joined_in_personal_kiosk`**

应用相同参数和逻辑。

- [ ] **Step 4: 同步修改 Web tx builders 和 mint sync**

必须同轮完成：

```text
1. 扩展 `web/lib/soulidity/tx/publish.ts` / `tx/import.ts` / `tx/personal-join.ts`
   - 透传 `asset_blob` / `initial_asset_name` / `asset_public` / `asset_type`
   - 透传 `content_access_price_atomic` / `content_access_default_scope_mask`
2. 扩展 publish/import/wrap-link sync 路由
   - 提取 `AssetVersionAppended`
   - 提取 `ContentAccessListCreated`
   - 在 `syncSoulProjectionFromChain(...)` 之后做与 `skillsOnChainId` 同级的 patch：
     - `assetsOnChainId`
     - `accessListOnChainId`
```

- [ ] **Step 5: 编译验证**

```bash
sui move build --path move/soulidity 2>&1 | tail -10
```

- [ ] **Step 6: 提交**

```bash
git add \
  move/soulidity/sources/market.move \
  web/lib/soulidity/tx/publish.ts \
  web/lib/soulidity/tx/import.ts \
  web/lib/soulidity/tx/personal-join.ts \
  web/app/api/souls/publish/route.ts \
  web/app/api/import/route.ts \
  web/app/api/wrap-link/personal/route.ts
git commit -m "feat(move): integrate SoulAssets and ContentAccessList into mint flow"
```

---

### Task 5: Move 测试

**文件:** 修改 `move/soulidity/sources/protocol_tests.move`

- [ ] **Step 1: 更新现有 test helpers**

所有 `mint_test_soul_*` helper 补新参数，旧测试传 `option::none()` 保持通过。

- [ ] **Step 2: 新增 assets 测试**

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

- [ ] **Step 3: 新增 content access 测试**

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

- [ ] **Step 4: 运行测试**

```bash
sui move test --path move/soulidity 2>&1 | tail -20
```

- [ ] **Step 5: 提交**

```bash
git add move/soulidity/sources/protocol_tests.move
git commit -m "test(move): add SoulAssets and ContentAccessList protocol tests"
```

---

## Phase 2 — Prisma Schema

### Task 6: 新增数据模型

**文件:** 修改 `prisma/schema.prisma`

- [ ] **Step 1: 新增 `SoulAssetVersionRecord` model**

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
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz
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

- [ ] **Step 2: 新增 `ContentAccessRecord` model**

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
  revokedAt           DateTime? @map("revoked_at") @db.Timestamptz
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([accessListOnChainId, granteeAddress], map: "content_access_unique")
  @@index([soulOnChainId])
  @@index([granteeAddress])
  @@map("content_access_records")
}
```

- [ ] **Step 3: 扩展 `SoulAsset` model 添加关系**

```prisma
  assetVersions       SoulAssetVersionRecord[] @relation("SoulAssetAssetVersions")
  contentAccess       ContentAccessRecord[]    @relation("SoulContentAccess")
  assetsOnChainId     String?                  @unique @map("assets_on_chain_id")
  accessListOnChainId String?                  @unique @map("access_list_on_chain_id")
```

- [ ] **Step 4: 生成 migration + client**

```bash
npx prisma migrate dev --schema=prisma/schema.prisma --name add_soul_assets_and_content_access
npx prisma generate --schema=prisma/schema.prisma
```

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add SoulAssetVersionRecord and ContentAccessRecord models"
```

---

## Phase 3 — SDK / 查询 / 事件 / Mirror

### Task 7: 查询 / 类型 / 事件契约

**文件:**
- 修改: `web/lib/soulidity/types.ts`
- 修改: `web/lib/soulidity/queries.ts`
- 修改: `web/lib/soulidity/repository.ts`
- 修改: `web/lib/soulidity/events.ts`

- [ ] **Step 1: 扩展现有查询/类型契约**

必须先补当前运行时对象查询能力，否则后续 mirror 与 access route 没法落地：

```text
1. `SoulStateObject` 新增 `assetsId: string | null`
2. `getSoulStateObject()` 解析 `assets_id`
3. `SoulAssetSummary` / `SoulAssetDetail` 新增
   - `assetsOnChainId`
   - `accessListOnChainId`
   - `assetVersions`
   - `contentAccess`
4. `repository.ts` 的 select / mapper / detail query 同步扩展
```

- [ ] **Step 2: types.ts 新增资产类型**

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

- [ ] **Step 3: events.ts 新增事件提取器**

模式与现有 `extractSkillVersionAppendedEvent` / `extractSkillVersionDeletedEvent` / `extractSoulPurchasedEvent` 一致：

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
    pricePaidAtomic: readBigInt(event.price_paid_atomic, 'ContentAccessGranted price_paid_atomic'),
  }
}

export function extractAssetVersionDeletedEvent(...) { ... }
export function extractContentAccessListCreatedEvent(...) { ... }
export function extractContentAccessRevokedEvent(...) { ... }
```

- [ ] **Step 4: 提交**

```bash
git add \
  web/lib/soulidity/types.ts \
  web/lib/soulidity/queries.ts \
  web/lib/soulidity/repository.ts \
  web/lib/soulidity/events.ts
git commit -m "feat(sdk): add SoulAssets query, type, repository, and event contracts"
```

---

### Task 8: Mirror/Sync 函数

**文件:**
- 新建: `web/lib/soulidity/mirror/upsert-asset.ts`
- 新建: `web/lib/soulidity/mirror/upsert-content-access.ts`
- 修改: `web/lib/soulidity/mirror/sync-helpers.ts`
- 修改: `web/lib/soulidity/projection-scalars.ts`
- 修改: `web/lib/soulidity/mirror/upsert-soul.ts`
- 修改: `web/app/api/souls/publish/route.ts`
- 修改: `web/app/api/import/route.ts`
- 修改: `web/app/api/wrap-link/personal/route.ts`

- [ ] **Step 0: 主记录 patch 契约**

`SoulAsset` 主记录必须在 mint/import/personal-join 后立即持久化：

```text
- `assetsOnChainId`
- `accessListOnChainId`
```

补丁策略与当前 `skillsOnChainId` fallback 相同：先 `syncSoulProjectionFromChain(...)`，若链查询暂时未命中则用事件里的 object id patch 主记录，避免 RPC indexing lag 造成后续路由拿不到根对象 ID。

- [ ] **Step 1: 新建 `upsert-asset.ts`**

与 `upsert-skill.ts` 同构:

```typescript
import { prisma } from '@web/lib/prisma'
import type { AssetVersionObject } from '../types'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

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

- [ ] **Step 2: 新建 `upsert-content-access.ts`**

```typescript
import { prisma } from '@web/lib/prisma'
import { toProjectionBigInt } from '@/lib/soulidity/projection-scalars'

export async function upsertContentAccessProjection(params: {
  soulOnChainId: string
  accessListOnChainId: string
  granteeAddress: string
  scopeMask: number
  pricePaidAtomic: bigint
  grantedAtMs: bigint
  expiresAtMs?: bigint | null
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

同时补 `web/lib/soulidity/projection-scalars.ts`，让 projection helper 能直接接受 `bigint`：

```typescript
export function toProjectionBigInt(value: number | bigint, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`${fieldName} must not be negative`)
    }
    return value
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} is outside the supported integer range`)
  }
  return BigInt(value)
}
```

- [ ] **Step 3: sync-helpers.ts 扩展**

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

export async function syncContentAccessProjectionFromChain(params: {
  soulOnChainId: string
  accessListOnChainId: string
  granteeAddress: string
  scopeMask: number
  pricePaidAtomic: bigint
  grantedAtMs: bigint
  expiresAtMs?: bigint | null
}) {
  return upsertContentAccessProjection(params)
}

export async function markContentAccessRevokedFromChain(params: {
  accessListOnChainId: string
  granteeAddress: string
}) {
  return markContentAccessRevoked(params)
}
```

- [ ] **Step 4: revoke / delete sync**

还需补：

```text
- `markAssetVersionDeleted(...)`
- `markContentAccessRevoked(...)`
- purchase / add / revoke 路由调用 `syncContentAccessProjectionFromChain(...)` / `markContentAccessRevokedFromChain(...)`
```

- [ ] **Step 5: 提交**

```bash
git add \
  web/lib/soulidity/mirror/upsert-asset.ts \
  web/lib/soulidity/mirror/upsert-content-access.ts \
  web/lib/soulidity/mirror/sync-helpers.ts \
  web/lib/soulidity/projection-scalars.ts \
  web/lib/soulidity/mirror/upsert-soul.ts \
  web/app/api/souls/publish/route.ts \
  web/app/api/import/route.ts \
  web/app/api/wrap-link/personal/route.ts
git commit -m "feat(sdk): add mirror/sync for SoulAssets and ContentAccess"
```

---

## Phase 4 — API Routes

### Task 9: 资产访问 API

**文件:**
- 新建: `web/app/api/souls/[id]/assets/route.ts`
- 新建: `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts`
- 新建: `web/app/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts`
- 新建: `web/lib/soulidity/asset-access.ts`
- 修改: `web/lib/services/seal-crypto.ts`
- 修改: `web/lib/soulidity/types.ts`

- [ ] **Step 0: 资产 Seal 客户端契约**

不能复用旧 `seal.ts` allowlist descriptor；必须新增与 `skill-access.ts` 对齐的一整套资产访问流：

```text
1. `generateAssetDocumentIdForVersion(assetsObjectId, assetName, versionIndex)`
2. `AssetAccessResponse`
3. `fetchAssetAccess(...)`
4. `loadDecryptedPrivateAssetVersion(...)`
5. human / agent 两套路由都返回同一 accessPolicy 形状
```

- [ ] **Step 1: 列表路由**

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

- [ ] **Step 2: 访问路由**

镜像 `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts`，替换:
- `skillName` → `assetName`
- `skillsObjectId` → `assetsObjectId`
- `soulSkillVersionRecord` → `soulAssetVersionRecord`
- `seal_approve_private_read_owner` → `seal_approve_asset_read_owner`
- `seal_approve_private_read_granted_agent` → `seal_approve_asset_read_granted_agent`
- Module: `'assets'`
- 新增 allowlist 检查: grant 检查之后查 `ContentAccessRecord` (viewer address + `SCOPE_ASSETS=8` in scopeMask)，返回 `seal_approve_asset_allowlisted`

agent 路由同步镜像 `web/app/api/agent/souls/[id]/skills/.../access/route.ts`。

**访问判定优先级:**
1. viewer 是 owner → `seal_approve_asset_read_owner`
2. viewer 有 active grant (含 SCOPE_ASSETS) → `seal_approve_asset_read_granted_agent`
3. viewer 在 ContentAccessList (含 SCOPE_ASSETS) → `seal_approve_asset_allowlisted`
4. 均不满足 → 403

- [ ] **Step 3: 提交**

```bash
git add \
  web/app/api/souls/\[id\]/assets/ \
  web/app/api/agent/souls/\[id\]/assets/ \
  web/lib/soulidity/asset-access.ts \
  web/lib/services/seal-crypto.ts \
  web/lib/soulidity/types.ts
git commit -m "feat(api): add asset list and access routes"
```

---

### Task 10: 内容访问管理 API

**文件:**
- 新建: `web/app/api/souls/[id]/access-list/route.ts` (GET)
- 新建: `web/app/api/souls/[id]/access-list/purchase/route.ts` (POST)
- 新建: `web/app/api/souls/[id]/access-list/add/route.ts` (POST)
- 新建: `web/app/api/souls/[id]/access-list/revoke/route.ts` (POST)
- 新建: `web/lib/soulidity/tx/content-access.ts`

- [ ] **Step 1: 查询路由**

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

- [ ] **Step 2: purchase 同步路由**

模式同 `web/app/api/souls/[id]/purchase/route.ts` — 从 TX 提取 `ContentAccessGranted` 事件，upsert `ContentAccessRecord`。

- [ ] **Step 3: add / revoke 同步路由**

同模式 — 验证 TX 成功，提取事件，更新 DB。

- [ ] **Step 4: SDK tx builders**

补 `web/lib/soulidity/tx/content-access.ts`：

```text
- `buildPurchaseContentAccessTx`
- `buildAddContentAccessTx`
- `buildRevokeContentAccessTx`
- `buildSetContentAccessPriceTx`
```

- [ ] **Step 5: 提交**

```bash
git add \
  web/app/api/souls/\[id\]/access-list/ \
  web/lib/soulidity/tx/content-access.ts
git commit -m "feat(api): add content access list management routes"
```

---

## 文件变更总览

| 操作 | 文件 | 说明 |
|------|------|------|
| **新建** | `move/soulidity/sources/assets.move` | SoulAssets 模块 |
| **新建** | `move/soulidity/sources/content_access.move` | ContentAccessList 模块 |
| **修改** | `move/soulidity/sources/soul.move` | +assets_id 字段/getter/setter |
| **修改** | `move/soulidity/sources/grant.move` | +SCOPE_ASSETS 常量 |
| **修改** | `move/soulidity/sources/market.move` | mint 集成 assets + access list |
| **修改** | `move/soulidity/sources/protocol_tests.move` | 补参数 + 新测试 |
| **修改** | `prisma/schema.prisma` | +2 model, SoulAsset 扩展 |
| **修改** | `web/lib/soulidity/queries.ts` | SoulState / assets / access 查询扩展 |
| **修改** | `web/lib/soulidity/repository.ts` | detail select / mapper / route data 扩展 |
| **修改** | `web/lib/soulidity/types.ts` | +AssetType, AssetVersionObject |
| **修改** | `web/lib/soulidity/events.ts` | +asset/access 事件提取器 |
| **新建** | `web/lib/soulidity/mirror/upsert-asset.ts` | asset mirror |
| **新建** | `web/lib/soulidity/mirror/upsert-content-access.ts` | access mirror |
| **修改** | `web/lib/soulidity/mirror/sync-helpers.ts` | +asset/access sync helpers |
| **修改** | `web/lib/soulidity/projection-scalars.ts` | projection bigint helper 扩展 |
| **修改** | `web/lib/soulidity/mirror/upsert-soul.ts` | patch assets/access roots |
| **修改** | `web/lib/soulidity/tx/publish.ts` | mint 参数扩展 |
| **修改** | `web/lib/soulidity/tx/import.ts` | import 参数扩展 |
| **修改** | `web/lib/soulidity/tx/personal-join.ts` | personal-join 参数扩展 |
| **新建** | `web/lib/soulidity/tx/content-access.ts` | access list tx builders |
| **新建** | `web/lib/soulidity/asset-access.ts` | asset Seal client helper |
| **修改** | `web/lib/services/seal-crypto.ts` | asset document id 生成与审批 PTB |
| **新建** | `web/app/api/souls/[id]/assets/route.ts` | 列表 API |
| **新建** | `web/app/api/souls/[id]/assets/.../access/route.ts` | 资产访问 API |
| **新建** | `web/app/api/agent/souls/[id]/assets/.../access/route.ts` | agent 资产访问 API |
| **新建** | `web/app/api/souls/[id]/access-list/route.ts` | 查询 API |
| **新建** | `web/app/api/souls/[id]/access-list/purchase/route.ts` | 购买同步 API |
| **新建** | `web/app/api/souls/[id]/access-list/add/route.ts` | 手动添加 API |
| **新建** | `web/app/api/souls/[id]/access-list/revoke/route.ts` | 撤销 API |
| **修改** | `web/app/api/souls/publish/route.ts` | mint sync 事件扩展 |
| **修改** | `web/app/api/import/route.ts` | import sync 事件扩展 |
| **修改** | `web/app/api/wrap-link/personal/route.ts` | personal-join sync 事件扩展 |

## Scope 常量定义

| 常量 | 值 | 用途 |
|------|---|------|
| SCOPE_SEAL | 1 | soul.md 访问 |
| SCOPE_MEMORY | 2 | memory 访问 |
| SCOPE_SKILLS | 4 | skills 访问 |
| **SCOPE_ASSETS** | **8** | **persona/voice 资产访问 (新增)** |

## 执行顺序约束

```
Task 1 (assets.move) ─┐
Task 3 (content_access.move) ─┤
                              ├→ Task 4 (market.move 集成) → Task 5 (tests)
Task 2 (soul.move + grant.move) ─┘

Task 5 通过后
→ Task 6 (Prisma)
→ Task 7 (types / queries / repository / events)
→ Task 8 (mirror + publish/import/wrap sync patch)
→ Task 9 (asset access API + asset client helper)
→ Task 10 (content access API + tx builders，可与 Task 9 并行)
```
