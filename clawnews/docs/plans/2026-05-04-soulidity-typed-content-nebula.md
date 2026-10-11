# Typed-Content Nebula - Soulidity Content 抽象统一

## Context

用户观察到 `skill / sprite / voice` 三者在 CRUD 形态上同构：per-name 多 version、`is_public` 标志、Walrus blob、Seal document、owner / granted-agent 双轨写入。当前 `move/soulidity/sources/skills.move` 和 `move/soulidity/sources/assets.move` 是有意拷贝（`docs/plans/2026-04-11-soul-assets-and-content-access-plan.md:96` 写明 "与 skills.move 同构，新增 asset_type，不另起存储语义"），但这份同构已经把产品演进绑在 ABI break 上。

本次目标不是在旧结构旁边加第三套能力，而是把 `skills / assets / metadata::active_* / paid-access Seal policies` 四块合并成一个可扩展、运行时可注册的 typed-content 抽象：

1. 新包不再包含 `skills.move` / `assets.move`。
2. 每个新 mint 的 Soul 都有且只有一个 `SoulContent` root。
3. `SoulState`、事件、mirror、API 都能发现这个 `content_id`。
4. Seal owner / granted-agent / paid-access 三条审批链都改走 content 通用入口。
5. 管理员后续通过 `KindAdminCap` 注册新 kind，不再为 video / text-prompt / custom asset 重新发包。
6. Voice 作为 `KIND_AUDIO` 落进同一套 hook/UI/API，不再停在 builder 层。

**命名决策**：`content` 专属 typed-content blob/version 抽象；现有 Soul 级付费访问从 `content_access` 整体改名为 `paid_access`，避免 `ContentAccessList` / `ContentAccessRecord` 与 `SoulContent` / `SoulContentVersionRecord` 在审计、mirror 和路由里混淆。对应重命名必须贯穿 Move、Prisma、TS、routes、tests：`content_access.move -> paid_access.move`、`ContentAccessList -> SoulPaidAccessList`、`ContentAccessRecord -> SoulPaidAccessRecord`、`purchase_content_access -> purchase_paid_access`、`upsert-content-access.ts -> upsert-paid-access.ts`。

**用户约束**："不用考虑迁移，旧文件该删就删"。因此本计划按 hard cut 执行：不保留 legacy module、旧 URL 不做 308、旧 TS builder/hook/route/test 直接删除。旧 mainnet 包上的 `SoulSkills` / `SoulAssets` 链上对象不会被删除（Sui 对象不可物理删除），但产品视角通过 mirror reset + current-package filter 保证不可见。

**当前仓库基线要求**：typed-content 计划更新时，repo 基线已刷新为 `HEAD=a3922a6`，且 `38d4170` 的 2-sigs runbook + content batch builders 已合并。实现只能从包含 `a3922a6` 的 clean tree 开工；更早的 dirty checkout 描述不再作为 baseline 判定标准。

## Why This vs Status Quo

**质变收益**：加新 metadata 类型从"发 Move 包 + 重审计 + multisig cap handoff"变成"admin 一笔 `register_kind` 交易"。只要产品路线图还会出现 video / 3D / prompt / biometric / custom media，typed-content 会立刻回本。

| 维度 | 现状（2-sigs 落地后） | 统一后 |
|---|---|---|
| 新 metadata 类型 | 完整 ABI break + 审计 | `KindAdminCap` 注册 |
| mint 入参 | 多组 skill/sprite/voice 散参 | `vector<InitialContentEntry>` |
| content root | `SoulSkills` + `SoulAssets` 双根 | `SoulContent` 单根 |
| Seal document-id | `soul-skill:` / `soul-asset:` 两套 | `soul-content:` + kind 入字节布局 |
| Paid Seal access | `content_access` 绑定 skills/assets 类型 | `paid_access` 授权 generic `SoulContent` version |
| voice 客户端 | builder 齐，hook/UI 缺 | 与 sprite 对称接通 |
| DB mirror | skill/asset 双表 + old row 漏出风险 | content 单表 + current-package filter |

**成本**：

- 一次 mainnet 重发、一次审计、一次 multisig cap handoff。
- Move / TS / Prisma / smoke 全链路重写，预计 2-3 周。
- 旧 mainnet package 的 Soul 不迁移。旧链上对象保留在链上，但新产品查询不读旧 package，不读旧 mirror 行。
- `grant.move` scope 不在本次重设计；custom kind 只能在 `SCOPE_SKILLS` 与 `SCOPE_ASSETS` 二选一，独立 scope 需要单独 ABI 工作。

**已知产品限制**：

- `sprite` 与 `audio` 都复用 `SCOPE_ASSETS`。因此"授权 agent 听音色但不能换 sprite"这类细粒度权限在本方案里做不到；要拆开必须改 `grant.move` scope ABI。
- 旧 package 上的 `SoulSkills` / `SoulAssets` / `ContentAccessList` 等所有运行时数据**全部放弃**：不导出、不迁移、不退款、不重新授权。Sui 链上对象保留（无法物理删除），但产品 UI / API / mirror 一律不读旧 package id。这是用户对历史生产数据的明确决策。

## Decision

做一次性 hard-cut ABI break，必须同时完成八件事：

1. 新增 `kind_registry.move`：`KindRegistry` 共享对象 + `KindAdminCap`，publish 时预注册 `skill / sprite / audio`。`KindDescriptor` 注册后**全字段不可变**（`reactivate_kind` 仅切 `deprecated` 标志，不能改 `default_grant_scope_mask` / `requires_download_policy` / `has_active_binding`），保证 `ContentSlot` 缓存的 `grant_scope_mask` 与历史 Seal 授权决策永远一致。
2. 新增 `content.move`：`SoulContent` 单根、per-kind/per-name/per-version 存储、统一 append/delete/purge/read getter；**同时承载 `ActiveBinding` 表**（`active: Table<u32, ActiveBinding>`），把"当前激活 sprite/voice"与 typed-content 收在同一根。删除-while-active 守卫从此变成 intra-module 检查，不再跨模块 borrow。
3. 修改 `soul.move`：`SoulState` 新增 `content_id: Option<ID>` 与 `config_ext: Table<String, vector<u8>>`（吸收原 `metadata::ext` 通道，存 `sprite_config_json` / `sprite_mood_map_json` 等小 JSON）。`SoulCreated` / `SoulMintedToKiosk` 携带 `content_id`；任何 `share_object(state)` 路径之前必须 `set_content_id`，不变量由 `soul::share_state` 包装函数 + protocol_test 双重保证。
4. **删除 `metadata.move` 整个模块**：`active_sprite/voice` 已被 `content::ActiveBinding` 吸收；`metadata::ext` 下沉到 `SoulState.config_ext`；`SoulMetadata` 对象、`metadata_id` 字段、`SoulMetadataCreated/Sprite/Voice/Blob*` 五个事件全部移除。`soul.move` 同步删除 `metadata_id` 字段与 setter / getter / `EMetadataAlreadyBound`。
5. 将 `content_access.move` 改名为 `paid_access.move`：删除对 `skills` / `assets` 的类型依赖，新增 `seal_approve_content_paid_access`，保留 paid access 作为 Soul 级付费访问 rail。**deprecated kind 的历史 slot 仍能 seal-approve 通过**——deprecation 只阻断 append，不影响读授权（slot 自带 `grant_scope_mask` 缓存）。
6. 修改 `market.move`：mint 入参收敛为 `vector<InitialContentEntry>`；新增 `set_active_content` / `clear_active_content` 包装（操作 `&mut SoulContent`，非 metadata）；新增 `set_state_config` / `delete_state_config` 包装（操作 `&mut SoulState.config_ext`）；删除所有 `*_skills` / `*_assets` / `set_active_sprite/voice` / metadata blob 相关 wrapper。
7. 修改 publish / manifest / cap handoff：捕获 `KindRegistry` 与 `KindAdminCap`，写入 deployment manifest，把 `KindAdminCap` 纳入 multisig transfer。**deployer 持 `KindAdminCap` 期间禁止 `register_kind`**；smoke 不需要 admin cap；cap transfer 与现有 `MarketCap` 走同一 multisig PTB；precheck 校验 `kindAdminCapId != deployerAddr` 与目标 multisig 非空。
8. 删除旧源文件、旧 routes、旧 hooks、旧 builders、旧 Prisma tables，全 query 改走集中 `requireCurrentPackageId(prisma)` 工厂，配 ESLint 规则禁止 `prisma.soulAsset.findMany` 直调，防止 `/api/souls`、`/api/collections`、`/api/market/*`、`/api/souls/[id]/grants` 漏旧 rows。

新包发布后，产品世界只认 `SoulContent`。不存在 package dispatch、legacy route、旧表只读兼容层、`metadata.move` 模块。

## Architecture

### 1. `kind_registry.move`（新）

```move
module soulidity::kind_registry;

const EKindNameEmpty: u64 = 1;
const EKindNameTaken: u64 = 2;
const EKindNotFound: u64 = 3;
const EKindDeprecated: u64 = 4;
const EInvalidDefaultGrantScope: u64 = 5;
const EKindNameInvalidLength: u64 = 6;
const EKindNameInvalidChar: u64 = 7;

public struct KindRegistry has key {
    id: UID,
    next_kind: u32,                    // starts at 16; 0..15 reserved for built-ins
    kinds: table::Table<u32, KindDescriptor>,
    name_to_kind: table::Table<String, u32>,
}

public struct KindDescriptor has copy, drop, store {
    kind: u32,
    name: String,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,     // exactly SCOPE_SKILLS or SCOPE_ASSETS
    deprecated: bool,
}

public struct KindAdminCap has key, store { id: UID }

public struct KindRegistryCreated has copy, drop {
    registry_id: ID,
    admin_cap_id: ID,
}

public struct KindRegistered has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
}

public struct KindDeprecated has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
}

public struct KindReactivated has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
}

public fun register_kind(
    registry: &mut KindRegistry,
    cap: &KindAdminCap,
    name: String,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
    ctx: &mut TxContext,
): u32

public fun deprecate_kind(
    registry: &mut KindRegistry,
    cap: &KindAdminCap,
    kind: u32,
    ctx: &TxContext,
)

public fun reactivate_kind(
    registry: &mut KindRegistry,
    cap: &KindAdminCap,
    kind: u32,
    ctx: &TxContext,
)
```

Publish-time built-ins:

| kind | name | active binding | download policy | grant scope |
|---:|---|---|---|---|
| 0 | `skill` | false | false | current `SCOPE_SKILLS` |
| 1 | `sprite` | true | true | current `SCOPE_ASSETS` |
| 2 | `audio` | true | true | current `SCOPE_ASSETS` |
| 3-15 | reserved unused | reserved | reserved | future built-ins such as `video`, `model3d`, `prompt` |

`register_kind` accepts only exactly one of `SCOPE_SKILLS` or `SCOPE_ASSETS`. It must reject `SCOPE_SEAL`, combined masks such as `SCOPE_SKILLS | SCOPE_ASSETS`, unknown bits, and any future bit because `grant.move` is not changing in this plan; a future kind that needs independent permission is a separate ABI change, not a registry-only operation.

**KindDescriptor 不可变性（hard invariant）**：一旦 `register_kind` 成功，`name` / `has_active_binding` / `requires_download_policy` / `default_grant_scope_mask` 永久冻结。`KindRegistry` 不提供 `update_kind` / `set_kind_*` 类 API；`reactivate_kind` 仅切 `deprecated: false`，**不能**修改任何其他字段。理由：`ContentSlot.grant_scope_mask` 在 append 时缓存自 `KindDescriptor`，Seal read 路径只读 slot 缓存不再读 registry——若 registry 端可改，历史 slot 的授权决策会被静默改变，违反 epoch-snapshot / ownership-rotation 的等价不变量。任何"换 scope"或"改 active 语义"的需求必须走新一次 ABI 升级，不允许在 registry 内热改。

Kind ids are never recycled. Deprecation only prevents new appends; it does not free the id, does not renumber existing kinds, and does not change historical `ContentSlot.grant_scope_mask` values. `next_kind` remains monotonic from 16 upward; 3-15 are publish-time reserved slots and stay unused until a future built-in ABI release explicitly assigns them.

`KindAdminCap` must be transferred to the same multisig ownership boundary used for the other production caps. The publish script must fail closed if it cannot identify both `registry_id` and `admin_cap_id`.

Kind names are canonical bytes, not display labels. `register_kind` must reject instead of normalizing:

- length outside `[1, 32]`
- any byte outside `[a-z0-9_-]`
- `0x00`
- uppercase forms like `Skill`

The `KindRegistry` shared object is low-frequency admin state. Concurrent writes are not optimized; if two admins register/deprecate concurrently, normal shared-object contention is acceptable.

### 2. `content.move`（新）

```move
module soulidity::content;

const EKindUnknown: u64 = 1;
const EKindDeprecated: u64 = 2;
const EContentMismatch: u64 = 3;
const ENameNotFound: u64 = 4;
const EVersionOutOfBounds: u64 = 5;
const EVersionDeleted: u64 = 6;
const EVersionPurged: u64 = 7;
const EDocumentIdInvalidLength: u64 = 8;
const EDocumentIdPrefixMismatch: u64 = 9;
const EKindRequiresDownloadPolicy: u64 = 10;
const EInvalidDownloadPolicy: u64 = 11;
const EContentNameInvalidLength: u64 = 12;
const EContentNameInvalidChar: u64 = 13;
const EKindActiveBindingNotSupported: u64 = 14;
const EActiveVersionDeleted: u64 = 15;

public struct ContentKey has copy, drop, store {
    kind: u32,
    name: String,
}

public struct ContentBlobKey has copy, drop, store {
    kind: u32,
    name: String,
    version_index: u64,
}

public struct ContentSlot has copy, drop, store {
    kind: u32,
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    purged: bool,
    download_policy: u8,
    grant_scope_mask: u64,
    created_at_ms: u64,
}

/// Soul 级"当前激活"指针。承载原 `metadata::active_sprite` /
/// `metadata::active_voice` 的语义，但泛化到任何 `has_active_binding=true` 的 kind。
public struct ActiveBinding has copy, drop, store {
    kind: u32,
    name: String,
    version_index: u64,
    download_policy: u8,
}

public struct SoulContent has key {
    id: UID,
    soul_id: ID,
    items: table::Table<ContentKey, vector<ContentSlot>>,
    count_by_kind: table::Table<u32, u64>,
    /// per-kind 当前激活版本（只对 `KindDescriptor.has_active_binding=true` 的 kind 有意义）。
    /// 之前由独立 `SoulMetadata` 持有，现下沉到 content root，保证"激活的版本不能被删"
    /// 这一不变量是 intra-module 检查，不再跨模块 borrow。
    active: table::Table<u32, ActiveBinding>,
}

public struct SoulContentCreated has copy, drop {
    content_id: ID,
    soul_id: ID,
}

public struct ContentVersionAppended has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
    is_public: bool,
    download_policy: u8,
    grant_scope_mask: u64,
    blob_object_id: ID,
    created_at_ms: u64,
}

public struct ContentVersionDeleted has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
}

public struct ContentVersionPurged has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
}

public struct ActiveBindingUpdated has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    binding: Option<ActiveBinding>,
    updater: address,
}
```

Required API shape:

```move
public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulContent
public(package) fun share_content(content: SoulContent)
public fun content_id(content: &SoulContent): ID
public fun soul_id(content: &SoulContent): ID

public fun append_version_as_owner(
    content: &mut SoulContent,
    state: &mut SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    is_public: bool,
    download_policy: u8,
    blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64

public fun append_version_as_granted_agent(
    content: &mut SoulContent,
    state: &mut SoulState,
    registry: &KindRegistry,
    grant: &SoulGrant,
    kind: u32,
    name: String,
    is_public: bool,
    download_policy: u8,
    blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64

public fun delete_version_as_owner(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
)

public fun delete_version_as_granted_agent(...)
public fun purge_deleted_version_as_owner(...)

public(package) fun set_active(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    binding: ActiveBinding,
    ctx: &TxContext,
)

public(package) fun clear_active(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    ctx: &TxContext,
)

public fun active_binding(content: &SoulContent, kind: u32): &Option<ActiveBinding>
public fun is_version_active(content: &SoulContent, kind: u32, name: String, version_index: u64): bool
public fun assert_version_not_active(content: &SoulContent, kind: u32, name: String, version_index: u64)

entry fun seal_approve_content_owner(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &mut TxContext,
)

entry fun seal_approve_content_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    grant: &SoulGrant,
    kind: u32,
    name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Blob storage follows the current skills/assets pattern: the actual Walrus `Blob` object is stored under dynamic object field key `ContentBlobKey { kind, name, version_index }`, and purge removes/burns the dynamic field object after the logical delete guard has passed.

Append caches access scope into each version. `append_version_*` reads `KindDescriptor.default_grant_scope_mask` from `KindRegistry` once, validates it is exactly `SCOPE_SKILLS` or `SCOPE_ASSETS`, and stores the value in `ContentSlot.grant_scope_mask`. Seal read paths use the cached slot mask and do not take `&KindRegistry`. This keeps the registry out of high-frequency Seal reads and makes historical versions independent from subsequent kind deprecation/reactivation.

Delete-while-active protection 现在是 intra-module 检查，不再跨模块 borrow `&SoulMetadata`：

1. `delete_version_*` 取 `KindDescriptor`。
2. 若 `has_active_binding=false`，跳过 active 检查。
3. 若 `has_active_binding=true`，调用本模块 `assert_version_not_active(content, kind, name, version_index)`，直接读 `content.active[kind]`，匹配则 abort `EActiveVersionDeleted`。
4. 删除版本仍可寻址（用于审计），purged 版本不能 approve Seal。

**Active 路径的 Seal 不变量**：deprecated kind 的历史 slot 仍可走 `seal_approve_content_owner` / `seal_approve_content_granted_agent` / `paid_access::seal_approve_content_paid_access`。deprecation 只阻断 `append_version_*`，不影响读授权——Seal 路径只读 `ContentSlot.grant_scope_mask` 缓存，不再触碰 `KindRegistry`，配合 §1 的 KindDescriptor 不可变性，已购付费访问不会因 deprecation/reactivate 失效。

**`set_active` / `clear_active` 可见性**：保持 `public(package)`，只能由 `market::set_active_content` / `clear_active_content` 包装调用。包装层做 owner 校验、kind 支持检查、version 非 deleted/purged 检查，最后再 delegate；钱包不能直接调 `content::set_active`。

Content item names use the same canonical byte rules as kind names: length `[1, 32]`, only `[a-z0-9_-]`, no `0x00`, and no uppercase aliases. `content::append_*` must reject invalid names before writing `ContentKey` or creating a document id.

Download policy semantics are explicit:

- If `KindDescriptor.requires_download_policy=false`, callers must pass `download_policy == 0`; non-zero aborts with `EInvalidDownloadPolicy`.
- If `requires_download_policy=true`, callers must pass a valid policy enum value accepted by the existing asset download policy contract.
- Builders/hooks may default omitted policy to `0` only after resolving that the kind does not require a policy.

Document ID layout:

```text
"soul-content:"                 // 13 bytes
+ doc_id_version                // u8 = 1
+ kind_be                       // u32 big-endian
+ content_id                    // 32 bytes
+ name_utf8
+ 0x00
+ version_index_be              // u64 big-endian
+ nonce                         // 16 bytes
```

`kind` is part of the byte layout, so `skill:intro:v0` and `sprite:intro:v0` cannot collide even under the same `SoulContent`.

### 3. `soul.move`（修改）

`SoulContent` must be discoverable from the canonical Soul root, not only from indexer side effects. Current `SoulState.skills_id` / `SoulState.assets_id` / `SoulState.metadata_id` 都要在 ABI hard cut 中删除；`SoulState` 同时吸收原 `metadata::ext` 通道作为 `config_ext`。

```move
public struct SoulState has key {
    id: UID,
    // existing non-content fields (owner, ownership_epoch, access_list_id, ...)
    content_id: option::Option<ID>,
    /// 吸收原 metadata::ext。仅 owner 可写；通过 market::set_state_config /
    /// market::delete_state_config 入口操作。典型 key:
    /// `sprite_config_json` / `sprite_mood_map_json`。
    config_ext: table::Table<String, vector<u8>>,
}

const EContentRootMissing: u64 = ...;
const EContentAlreadyBound: u64 = ...;
const EStateConfigKeyEmpty: u64 = ...;
const EStateConfigKeyMissing: u64 = ...;

public(package) fun set_content_id(state: &mut SoulState, content_id: ID)
public fun content_id(state: &SoulState): &Option<ID>
public fun require_content_id(state: &SoulState): ID
public fun has_content_id(state: &SoulState): bool

public(package) fun upsert_state_config(state: &mut SoulState, key: String, value: vector<u8>)
public(package) fun delete_state_config(state: &mut SoulState, key: String)
public fun state_config(state: &SoulState, key: String): &vector<u8>
public fun has_state_config(state: &SoulState, key: String): bool

/// 唯一允许 share `SoulState` 的入口；强制要求 `content_id.is_some()`。
/// 任何旧 `transfer::share_object(state)` 直调都要换成它，protocol_test
/// 覆盖"未 set_content_id 即 share 应该 abort"场景。
public(package) fun share_state(state: SoulState)
```

Delete list:

- Remove fields `skills_id: Option<ID>`、`assets_id: Option<ID>`、`metadata_id: Option<ID>`。
- Remove getters / setters / `EMetadataAlreadyBound` / `ESkillsAlreadyBound` / `EAssetsAlreadyBound`。
- Remove destructure ignores for these three fields in any destroy/burn/test helper paths.
- Remove protocol tests that only assert old root binding behavior, or rewrite them to `EContentAlreadyBound`.
- Remove TS/query/mirror assumptions that read `skills_id` / `assets_id` / `metadata_id` from raw `SoulState`.

Event schema is fixed, not "as needed"：

```move
public struct SoulCreated has copy, drop {
    soul_id: ID,
    state_id: ID,
    content_id: ID,
    creator: address,
    owner: address,
    provenance_kind: u8,
}

public struct SoulStateConfigUpserted has copy, drop {
    state_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

public struct SoulStateConfigDeleted has copy, drop {
    state_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

public(package) fun emit_created_after_content_bound(
    state: &SoulState,
    creator: address,
    owner: address,
    provenance_kind: u8,
)
```

注意：`SoulCreated` 不再携带 `metadata_id`（该字段已随 `metadata.move` 模块一起删除）。

Emission timing：

- `soul::new()` no longer emits `SoulCreated`.
- Market mint/import flow creates `SoulState`, creates `SoulContent`, calls `soul::set_content_id`, optionally calls `upsert_state_config` for sprite_config / mood_map, then calls `soul::emit_created_after_content_bound`, finally `soul::share_state`.
- `SoulCreated.content_id` is a plain `ID`, never `Option<ID>`. If content is missing, both `emit_created_after_content_bound` and `share_state` abort with `EContentRootMissing`.

**Share-time content_id 不变量（hard invariant）**：任何被 `share_object` 出去的 `SoulState` 必须 `content_id.is_some()`。强制方式：(a) `share_state` 包装函数 assert；(b) `soul::new` / `set_content_id` 都是 `public(package)`，外部不能绕开包装直接 `transfer::share_object`；(c) protocol_test 用 reflection / negative test 覆盖"未 set_content_id 即 share" 路径必须 abort。这一不变量是 mirror、API、UI 都依赖的"产品视角下不存在 content-less Soul"。

Any external view/tool that reads raw `SoulState` JSON must be treated as a contract consumer. Release notes must announce removal of `skills_id` / `assets_id` / `metadata_id`，addition of `content_id` / `config_ext`；API/mirror tests must confirm the product code no longer depends on raw old fields.

Projection and API must persist this id as `SoulAsset.contentOnChainId`，并把 `config_ext` 投到 `SoulAsset.spriteConfigJson` / `spriteMoodMapJson` 现有字段（mirror 端只换数据来源，schema 不变）。Old `skillsOnChainId` / `assetsOnChainId` / `metadataOnChainId` are removed in the same schema migration.

### 4. `metadata.move`（删除整个模块）

`metadata.move` 全部职责被吸收掉：

| 原职责 | 新位置 |
|---|---|
| `ActiveBinding` 结构 + `active_sprite/voice` 状态 | `content.move` 的 `ActiveBinding` + `SoulContent.active: Table<u32, ActiveBinding>`（见 §2） |
| `set_active_sprite/voice` / `clear_active_*` 包装 | `market::set_active_content` / `clear_active_content`（见 §6） |
| `metadata::ext: Table<String, vector<u8>>` 通道 | `SoulState.config_ext`（见 §3） |
| `upsert_metadata_blob` / `delete_metadata_blob` 入口 | `market::set_state_config` / `market::delete_state_config`（见 §6） |
| `assert_version_not_active` 跨模块工具 | `content::assert_version_not_active`（intra-module，见 §2） |
| `SoulMetadata` 对象本身 | 不存在；取消一类 shared object，PTB 输入 -1 |
| 5 个 metadata 事件（`SoulMetadataCreated/Sprite/Voice/Blob*`） | `content::ActiveBindingUpdated` + `soul::SoulStateConfigUpserted/Deleted` 替代 |

删除清单（hard cut，全部一并落地）：

- `move/soulidity/sources/metadata.move` 整文件删除。
- `soul.move` 的 `metadata_id: Option<ID>` 字段、`metadata_id()` getter、`set_metadata_id()` setter、`EMetadataAlreadyBound` 错误码全部删除。
- 任何 `import` / `use soulidity::metadata` 全部删除。
- `web/lib/soulidity/tx/metadata.ts` 删除（旧 `upsert_metadata_blob` / `delete_metadata_blob` builder 不再存在）；调用方迁移到新的 `tx/state-config.ts`（见 §TS 段）。
- protocol_tests 中 metadata-only scenarios 全部删除或重写为 content / state_config 等价测试。

**理由**：metadata 模块的两块职责（active binding + ext）现在分别属于"content 自己"和"state 自己"，没有继续作为独立模块存在的语义价值。删模块同时减少：(a) mint PTB 多 share 一个 object 的开销；(b) 跨模块 borrow（`content::delete` 不再需要 `&SoulMetadata`）；(c) 5 个事件解析路径。**严格遵守 hard cut 原则**——不留 metadata.move 作只读兼容。

### 5. `paid_access.move`（rename from `content_access.move`）

Current `content_access.move` imports both `skills` and `assets`; that would make `skills.move` / `assets.move` deletion fail at compile time and would leave paid Seal entries on the old ABI. The module name is also misleading once typed-content owns the word "content". Hard cut renames this rail to paid access.

Required rename map:

| Current | New |
|---|---|
| `move/soulidity/sources/content_access.move` | `move/soulidity/sources/paid_access.move` |
| `ContentAccessList` | `SoulPaidAccessList` |
| `ContentAccessEntry` | `SoulPaidAccessEntry` |
| `ContentAccessListCreated` | `SoulPaidAccessListCreated` |
| `ContentAccessPurchased` | `SoulPaidAccessPurchased` |
| `purchase_content_access` | `purchase_paid_access` |
| `content_access_records` | `soul_paid_access_records` |
| `ContentAccessRecord` | `SoulPaidAccessRecord` |
| `web/lib/soulidity/mirror/upsert-content-access.ts` | `web/lib/soulidity/mirror/upsert-paid-access.ts` |

Required Move changes:

- Delete `use soulidity::skills` and `use soulidity::assets`.
- Replace skill/asset-specific paid access approvals with:

```move
entry fun seal_approve_content_paid_access(
    id: vector<u8>,
    state: &SoulState,
    paid_access_list: &SoulPaidAccessList,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

- Do not pass `&KindRegistry` into any Seal approval entry. The approval reads `ContentSlot.grant_scope_mask`, validates paid access against that cached scope, and validates document id through content helpers.
- Validate ownership/state epoch exactly as the current paid access path does after the epoch-snapshot hardening.
- Emit content-shaped paid access events containing `content_id`, `kind`, `name`, `version_index`, and `grant_scope_mask`.
- **Deprecated-kind 历史 slot 仍可付费授权**：`seal_approve_content_paid_access` 不读 `KindRegistry`，已购买 paid access 的历史 slot 即使该 kind 后来被 `deprecate_kind` 标记，也照常 seal-approve 通过。这与 §1 的 `KindDescriptor` 不可变性、§2 的 slot scope 缓存共同保证"已付费访问不会因管理操作失效"。失效的唯一路径仍是 ownership_epoch 不匹配。

Human and agent routes must both call `paid_access::seal_approve_content_paid_access` and must return Seal transaction metadata with `moduleName="paid_access"`, `functionName="seal_approve_content_paid_access"`, `contentObjectId`, `kind`, `name`, and `versionIndex`.

### 6. `market.move`（修改）

Mint entry points receive one vector instead of separate skill/asset arguments:

```move
const EInitialEntryActiveNotSupported: u64 = ...;

public struct InitialContentEntry has copy, drop, store {
    kind: u32,
    name: String,
    is_public: bool,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
}

public fun mint_native_in_personal_kiosk(
    config: &MarketConfig,
    kind_registry: &KindRegistry,
    /* existing non-content args */
    initial_content: vector<InitialContentEntry>,
    /* existing kiosk/listing args */
): SoulState

public fun mint_imported_in_personal_kiosk(
    config: &MarketConfig,
    kind_registry: &KindRegistry,
    /* existing non-content import args */
    initial_content: vector<InitialContentEntry>,
    /* existing kiosk/listing args */
): SoulState

public struct SoulMintedToKiosk has copy, drop {
    soul_id: ID,
    state_id: ID,
    content_id: ID,
    memory_id: ID,
    kiosk_id: ID,
    owner: address,
    provenance_kind: u8,
}
```

注意：`SoulMintedToKiosk` 不再携带 `metadata_id`（metadata.move 已删除）。

`mint_native_in_personal_kiosk` and `mint_imported_in_personal_kiosk` must have the same content ABI shape. Both replace `skills_blob`, `asset_blob`, `initial_sprite_*`, and `initial_voice_*` with `vector<InitialContentEntry>`，并接受**可选的初始 `state_config_entries: vector<StateConfigEntry>`**（每条形如 `{ key, value }`），用于在 mint 同 PTB 内写入 sprite_config / mood_map：

```move
public struct StateConfigEntry has copy, drop, store {
    key: String,
    value: vector<u8>,
}
```

Mint/import sequence：

1. Create `SoulState`（含空 `config_ext` table）。
2. Create `SoulContent` for `object::id(&state)`（含空 `active` table）。
3. Link `soul::set_content_id(&mut state, content::content_id(&content))`.
4. For each `StateConfigEntry`，调用 `soul::upsert_state_config(&mut state, entry.key, entry.value)`。
5. For each `InitialContentEntry`, resolve `KindDescriptor` before mutation.
6. If `entry.set_active=true` and `descriptor.has_active_binding=false`, abort in `market.move` with `EInitialEntryActiveNotSupported`; do not let this failure surface from `content::set_active`.
7. Append every entry through `content::append_version_as_owner`.
8. For `set_active=true`, call `content::set_active`（写入 `SoulContent.active[kind]`）。
9. Emit projection events with `content_id`.
10. Finalize：`content::share_content(content)` → `soul::share_state(state)` → `memory::share_memory(memory)`。**`share_state` 强制要求 `content_id.is_some()`**，是 §3 share-time 不变量的执行点。

Public active-binding wallet wrappers replace old sprite/voice wrappers：

```move
public fun set_active_content(
    config: &MarketConfig,
    registry: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
)

public fun clear_active_content(
    config: &MarketConfig,
    registry: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
)
```

注意：wrappers 现在持 `&mut SoulContent`，不再持 `&mut SoulMetadata`（metadata 已删除）。Wallets 不能直接调 `content::set_active`（保持 `public(package)`）。这些 market wrappers 必须校验 owner 权限、kind active-binding 支持、content version 存在且非 deleted/purged、download-policy 兼容，再 delegate 到 `content::set_active`。

新增 `config_ext` 钱包入口：

```move
public fun set_state_config(
    config: &MarketConfig,
    state: &mut SoulState,
    key: String,
    value: vector<u8>,
    ctx: &TxContext,
)

public fun delete_state_config(
    config: &MarketConfig,
    state: &mut SoulState,
    key: String,
    ctx: &TxContext,
)
```

两者都校验 `ctx.sender() == soul::current_owner(state)` + `key` 非空，然后 delegate 到 `soul::upsert_state_config` / `delete_state_config` 并 `event::emit(SoulStateConfigUpserted/Deleted)`。

Deleted wrappers：

- `finalize_soul_skills`
- `finalize_soul_assets`
- `finalize_soul_metadata`（metadata 删除后这个包装也消失）
- `init_skills_and_append_as_owner`
- `init_assets_and_append_sprite_as_owner`
- market-level `set_active_sprite` / `set_active_voice` / `clear_active_sprite/voice`
- 任何走 `metadata::upsert_metadata_blob` / `metadata::delete_metadata_blob` 的 wrapper（市场端被 `set_state_config` / `delete_state_config` 替代）

Replacement wrapper：

```move
public fun finalize_soul_content(content: SoulContent) {
    content::share_content(content)
}
```

**Cap handoff 窗口策略（§Architecture-level invariant）**：publish 完成后到 multisig 接管 `KindAdminCap` 之前，deployer 持 cap 的窗口必须满足：(a) 该窗口内**禁止**调用任何 `register_kind` / `deprecate_kind` / `reactivate_kind`；(b) smoke / bench 不需要 admin cap，全程不触发 admin TX；(c) cap transfer 与现有 `MarketCap` 同 multisig 同 PTB 完成（最少 2 笔签名内交付）；(d) `precheck-live-soulidity-collections.ts` 必须校验 `kindAdminCapId != deployerAddress` 且目标 multisig 地址非空，缺一项 fail closed 拒绝继续。该窗口的存在性记录到 release 文档，作为 audit 关注项。

### 7. PTB Economics Proof Gate

The smoke matrix assumes "first content of kind X: 2 sigs". That is an ABI requirement, not a post-facto hope. Before mainnet publish, implementation must include a short proof in the smoke notes covering:

- Function visibility: external wallets call market entry points; `content::create`, `content::share_content`, `content::set_active`, `soul::set_content_id`, `soul::upsert_state_config`, `soul::share_state` 全部保持 `public(package)`，只能在 market wrapper 内组装。
- Hot-potato flow: no intermediate hot-potato value may escape the package entry boundary; all created roots are consumed, linked, or shared in the same PTB step that creates them.
- Share timing: 只有三个 shared object —— `SoulContent`、`SoulMemory`、`SoulState`（`SoulMetadata` 已删除）。三者在 `content_id` 已 link、初始 append、active binding、初始 `state_config` 全部完成后，**通过 `content::share_content` / `memory::share_memory` / `soul::share_state` 各 share 一次**。`share_state` 内部 assert `content_id.is_some()`，是 share-time 不变量的执行点。
- Signature count: dry-run/smoke must prove first `skill`, first `sprite`, first `audio`, and first custom-kind content remain at 2 signatures. Subsequent owner append to same kind/name, subsequent owner append to different kind/name, and granted-agent append must each remain 1 signature. If any first-content path requires 3 signatures or any subsequent append path requires 2 signatures, the ABI entry split is wrong and must be fixed before audit.
- Shared-object overhead: append PTB 多带一个 `&KindRegistry` 输入。Bench 必须比对"新 owner append 含 `&KindRegistry`" vs "旧 skills::append_version_as_owner 不含 registry" 的 gas 差，门槛 ≤ 5%，超过则要在 audit 前定位原因。同时记录 `register_kind` admin TX 的 gas 上限作 capacity 参考。

## Hard Cut Strategy

New package is the only product world. Hard cut includes source deletion, mirror reset, and query filters.

| Existing artifact | Required handling |
|---|---|
| `move/soulidity/sources/skills.move` | Delete |
| `move/soulidity/sources/assets.move` | Delete |
| `move/soulidity/sources/metadata.move` | **Delete** (整模块移除；`ActiveBinding` → `content.move`，`ext` → `SoulState.config_ext`) |
| `move/soulidity/sources/content_access.move` | Rename to `paid_access.move`; replace skill/asset approvals with content paid-access approval |
| `SoulState.skills_id` / `assets_id` / `metadata_id` | Remove; add `content_id`、`config_ext` |
| Chain old `SoulSkills` / `SoulAssets` / `SoulMetadata` objects | Leave on chain, never project into new UI |
| `SoulSkillVersionRecord` / `SoulAssetVersionRecord` | Drop tables |
| Existing Soulidity mirror rows from old package | Wipe via reset before switching manifest |
| `SoulAsset.skillsOnChainId` / `assetsOnChainId` / `metadataOnChainId` | Drop columns |
| `SoulAsset.contentOnChainId` | Add and require for new rows |
| `SoulAsset.spriteConfigJson` / `spriteMoodMapJson` | Keep schema；mirror 数据来源从 `metadata.ext` 切到 `SoulState.config_ext` |
| `/api/souls` and `/api/souls/my` | Filter to current manifest package id and non-null `contentOnChainId` via 集中 `requireCurrentPackageId` |
| `/api/collections` | Must not expose old-package collection supply/listing rows |
| `/api/market/*` | Must not expose old-package listing rows or prepared purchase rows |
| `/api/souls/[id]/grants` | Must not expose old-package grants |
| `/api/souls/[id]/skills/**` | Delete; old clients receive 404 |
| `/api/souls/[id]/assets/**` | Delete; old clients receive 404 |
| `web/lib/hooks/use-skills.ts` / `use-assets.ts` | Delete; replace with `use-content.ts` |
| `web/lib/soulidity/tx/skills.ts` / `assets.ts` / `metadata.ts` | Delete; `metadata.ts` 由 `state-config.ts` 替代；其余由 content builder 替代 |

Mirror reset is not optional. Dropping only version tables is insufficient because old rows can still appear through souls, collections, market, grants, memory, or access APIs. Required wipe/export scope:

| Prisma model / table | Reset handling |
|---|---|
| `SoulAsset` / `soul_assets` | Wipe old-package rows; cascade owned version/grant/memory/access/bookmark rows where relations apply |
| `SoulCollectionAsset` / `soul_collection_assets` | Wipe old-package collection mirror rows and stale `soulCount` / `maxSoulSupply` projections |
| `SoulSkillVersionRecord` / `soul_skill_version_records` | Drop table |
| `SoulAssetVersionRecord` / `soul_asset_version_records` | Drop table |
| `SoulGrantRecord` / `soul_grant_records` | Wipe old-package grants before `/api/souls/[id]/grants` can serve new package data |
| `SoulMemoryEntry` / `soul_memory_entries` | Wipe old-package memory mirror rows; memory is not migrated |
| `ContentAccessRecord` / `content_access_records` | Rename/drop into `SoulPaidAccessRecord` / `soul_paid_access_records`; **直接 wipe 不导出**（用户明确不保留生产历史数据） |
| `SoulPreparedPurchase` / `soul_prepared_purchases` | Cancel/wipe old-package prepared purchases and listing tx bytes |
| `SoulTxSync` / `soul_tx_syncs` | Wipe old-package route/resource sync cache entries |
| `Bookmark` / `bookmarks` | Delete or cascade rows pointing at wiped `SoulAsset` ids |

Required production sequence：

1. Backup DB（安全网，与历史数据保留无关；destructive migration 通用做法）。
2. Publish and verify new package on testnet。
3. Apply schema migration `drop_skills_assets_metadata_add_content_destructive`（含删 `metadata_on_chain_id` 列、加 `content_on_chain_id` / `package_id` 列、`spriteConfigJson` / `spriteMoodMapJson` mirror 来源切换）。
4. Run `scripts/reset-soulidity-mirror.ts --apply --package-id=<newPackageId>` 或等价的 full Soulidity mirror reset。
5. Sync only events from the new package id（旧 package id 完全不读）。
6. Run `/api/souls`、`/api/souls/my`、`/api/collections`、`/api/market/*`、`/api/souls/[id]/grants` 断言，确认无旧 package rows 漏出，且全部走集中 `requireCurrentPackageId` 工厂。

This is still hard cut, not migration: 旧数据 abandoned，不导出、不翻译、不退款。

## Sequencing

1. **Baseline preflight**
   - Start from a clean tree at or after `a3922a6`; ancestry must include `38d4170`.
   - Record `git rev-parse HEAD`, package manager versions, and current passing verification in the implementation log.
   - Do not start ABI deletion while unrelated dirty changes are mixed in. The only acceptable pre-implementation diff is this plan/doc update.

2. **Move contract root**
   - Add `kind_registry.move` and `content.move`（后者承载 `ActiveBinding` + `SoulContent.active`）。
   - Modify `soul.move`（加 `content_id` / `config_ext`、`share_state` 包装、删 `metadata_id` 字段与相关 setter / getter / 错误码）。
   - Rename `content_access.move` to `paid_access.move`（删 skills/assets imports）。
   - Modify `market.move`（mint 入参 → `vector<InitialContentEntry>` + `vector<StateConfigEntry>`；新增 `set_active_content` / `clear_active_content` / `set_state_config` / `delete_state_config` wrappers；删除全部 sprite/voice/metadata-blob wrappers）。
   - **Delete `skills.move`、`assets.move`、`metadata.move`** —— 三个旧模块全部移除。
   - Rewrite protocol tests around content / kind registry / state_config / paid access invariants。
   - Produce the PTB economics proof before changing smoke expectations to "2 sigs"。

3. **Publish and cap plumbing**
   - Update `web/lib/soulidity/deployment.ts`, `web/lib/soulidity/env.ts`, and `web/lib/soulidity/deployment-manifest.json`.
   - Update `scripts/publish-soulidity-and-sync.ts` to capture `kindRegistryId` and `kindAdminCapId` by parsing the `KindRegistryCreated` event, not by object-change heuristic scanning.
   - Include `KindAdminCap` in the cap transfer/resume manifest.
   - Fail precheck if manifest lacks `packageId`, `kindRegistryId`, `kindAdminCapId`, or `content` module ABI.

4. **Projection, DB, and API**
   - Update event extraction for `SoulCreated`、`SoulMintedToKiosk`、`SoulContentCreated`、`ContentVersionAppended`、`ContentVersionDeleted`、`ContentVersionPurged`、`ActiveBindingUpdated`、`SoulStateConfigUpserted`、`SoulStateConfigDeleted`。
   - Add `SoulAsset.contentOnChainId`、`SoulAsset.packageId`、`SoulCollectionAsset.packageId`、`SoulContentVersionRecord`、`SoulActiveContentBindingRecord`。
   - Drop old skill/asset version tables、`metadataOnChainId` 列、其他旧 root 列。
   - 引入 **`web/lib/db/require-current-package.ts`**：单一工厂 `requireCurrentPackageId(prisma)` 返回带 `packageId = currentDeployment.packageId` 过滤的命名查询。所有 Soul / Collection / Listing / Grant / PaidAccess query 必须经它取数据；配 ESLint 自定义规则禁止 `prisma.soulAsset.findMany` / `findFirst` / `findUnique` 在 `web/app/api/**` 与 `web/lib/soulidity/**` 下直调。
   - Replace human and agent skill/asset access routes with content routes；rename paid access mirror code；`spriteConfigJson` / `spriteMoodMapJson` mirror 改读 `SoulState.config_ext`。

5. **Frontend and recovery**
   - Replace `use-skills` / `use-assets` with `use-content`.
   - Update create/publish/list/detail flows to pass `InitialContentEntry[]`.
   - Replace recovery storage with kind-keyed content recovery.
   - Detect old `sessionStorage` recovery schema rows, show a one-time toast explaining that stale pre-content recovery state was cleared, then wipe these keys/prefixes: `soul-mint-recovery`, `soul-import-recovery`, `soul-wrap-personal-recovery`, `collection-mint-recovery`, `soul-skill-append-recovery:*`, `soul-sprite-append-recovery:*`, plus legacy `assetsSealMaterial` fields embedded in those recovery payloads by `legacy-mint-asset-recovery`.
   - Wire voice through the same sprite-like active binding UI.

6. **Testnet candidate proof**
   - Publish candidate to testnet, sync, run smoke, run bench, and attach tx digests / gas / signature counts to the release record.
   - This candidate output is the audit input. If testnet smoke or bench changes ABI, restart this step before audit.

7. **Audit gate**
   - Run internal contract review against `kind_registry.move`、`content.move`、`paid_access.move`、`soul.move`、`market.move`（不含 `metadata.move`，已删除）。
   - Complete external/security audit sign-off for the ABI hard cut。审计材料显式包含：(a) KindDescriptor 不可变性论证；(b) cap handoff 窗口策略；(c) share-time `content_id.is_some()` 不变量证明；(d) deprecated kind 历史 slot seal-approve 仍有效的语义。
   - Mainnet publish is blocked until audit findings are fixed or explicitly accepted in the release record。

8. **Production runbook**
   - Mainnet backup → publish → migration → mirror reset → smoke → cap handoff。
   - Cap handoff 阶段强制走 multisig PTB；deployer 持 `KindAdminCap` 全程不调任何 `register_kind`。
   - Record package id、registry id、admin cap transfer tx、smoke txs、rollback point。

## TS / Hook / API Surface

### `web/lib/soulidity/tx/content.ts`（新）

```ts
export function buildAppendContentBatchTx(args: {
  stateObjectId: string
  contentObjectId: string
  kindRegistryId: string
  kindDescriptors: ReadonlyMap<number, {
    hasActiveBinding: boolean
    requiresDownloadPolicy: boolean
  }>
  versions: ReadonlyArray<{
    kind: number
    name: string
    visibility: 'public' | 'private'
    blobObjectId: string
    downloadPolicy?: SoulDownloadPolicy
    setActive?: boolean
  }>
}): Transaction
```

Note：builder 不再接受 `metadataObjectId`（metadata.move 已删除）。`set_active` 直接调 `market::set_active_content` 操作 `&mut SoulContent`，无需 metadata 引用。

The builder must refuse to build if `contentObjectId`, `kindRegistryId`, or the relevant `KindDescriptor` is missing. It must not infer old skills/assets/metadata root ids. It must fail client-side when `setActive=true` for a non-active kind or when a non-policy kind receives a non-zero `downloadPolicy`; Move still enforces the same rules.

### `web/lib/soulidity/tx/state-config.ts`（新）

```ts
export function buildSetStateConfigTx(args: {
  stateObjectId: string
  marketConfigId: string
  key: string
  valueBytes: Uint8Array
}): Transaction

export function buildDeleteStateConfigTx(args: {
  stateObjectId: string
  marketConfigId: string
  key: string
}): Transaction
```

替代旧 `web/lib/soulidity/tx/metadata.ts`（删除）。所有原本调 `metadata::upsert_metadata_blob` / `delete_metadata_blob` 的代码全部改用这两个 builder。`use-assets` 中写 `sprite_config_json` / `sprite_mood_map_json` 的路径迁移到 `use-content.sprite.upsertConfig` 包装（内部组合 `buildSetStateConfigTx`）。

### `web/lib/soulidity/tx/kind-registry.ts`（新）

```ts
export function buildRegisterKindTx(args: {
  registryId: string
  kindAdminCapId: string
  name: string
  hasActiveBinding: boolean
  requiresDownloadPolicy: boolean
  defaultGrantScopeMask: bigint
}): Transaction
```

Admin tooling uses the deployment manifest. No env-only fallback for `kindAdminCapId`; cap id must come from the synced publish manifest. `defaultGrantScopeMask` must be exactly `SCOPE_SKILLS` or `SCOPE_ASSETS`; combined masks and `SCOPE_SEAL` are client-side errors and Move aborts.

### `web/lib/hooks/use-content.ts`（新）

```ts
export function useContent(soul: SoulAssetDetail | null) {
  return {
    skill: { versions, append, appendBatch, delete, open, pending },
    sprite: {
      versions, append, appendBatch, delete,
      setActive, clearActive,
      upsertConfig,                         // 写 sprite_config_json 到 SoulState.config_ext
      upsertMoodMap,                        // 写 sprite_mood_map_json 到 SoulState.config_ext
      pending,
    },
    voice: { versions, append, appendBatch, delete, setActive, clearActive, pending },
    custom: (kind: number) => ({ versions, append, appendBatch, delete, pending }),
    stateConfig: { upsert, delete: del },   // 通用 SoulState.config_ext 入口（admin / advanced）
    isLoading,
    error,
  }
}
```

`use-content` is the only public hook. Compatibility re-export from `use-skills` / `use-assets` / 旧 metadata blob hook 一律不允许。

### Routes

Required new routes:

- `web/app/api/souls/[id]/content/route.ts` - list/append content versions.
- `web/app/api/souls/[id]/content/access/route.ts?kind=<kind>&name=<name>&version=<versionIndex>` - human Seal access.
- `web/app/api/souls/[id]/content/delete/route.ts?kind=<kind>&name=<name>&version=<versionIndex>` - delete/purge.
- `web/app/api/agent/souls/[id]/content/access/route.ts?kind=<kind>&name=<name>&version=<versionIndex>` - agent Seal access.

Use query parameters for `kind`, `name`, and `version` instead of a 7-segment dynamic route. This keeps curl/debug paths readable and does not change authorization because all security checks remain on object ids, document id validation, owner/grant/access state, and package id.

Deleted routes:

- `web/app/api/souls/[id]/skills/**`
- `web/app/api/souls/[id]/assets/**`
- Any existing `web/app/api/agent/souls/[id]/skills/**`
- Any existing `web/app/api/agent/souls/[id]/assets/**`

### Seal helpers

`web/lib/services/seal-crypto.ts` becomes the single document-id implementation:

- `createContentDocumentId({ contentObjectId, kind, name, versionIndex, nonce })`
- `parseContentDocumentId(bytes)`
- `createContentSealEnvelopeSidecar(...)`

Delete or rewrite helpers that still produce `soul-skill:` or `soul-asset:` prefixes. `web/lib/upload/client-seal.ts`, `skill-access.ts`, `asset-access.ts`, `asset-version-access.ts`, and `desktop-asset-access.ts` must either call the content helper or be removed.

Paid-access helpers move to `paid-access.ts` / `upsert-paid-access.ts` naming. Do not create `content-access` helpers for the renamed paid rail.

## Prisma / Projection

Minimum schema shape:

```prisma
model SoulAsset {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  onChainId         String   @unique @map("on_chain_id")
  packageId         String   @map("package_id")
  stateOnChainId    String   @map("state_on_chain_id")
  contentOnChainId  String   @unique @map("content_on_chain_id")
  memoryOnChainId   String?  @map("memory_on_chain_id")
  // metadataOnChainId 已删除（metadata.move 模块整体移除）。

  // sprite/mood 配置 mirror 来源切到 SoulState.config_ext，schema 字段保留：
  spriteConfigJson  Json?    @map("sprite_config_json")
  spriteMoodMapJson Json?    @map("sprite_mood_map_json")

  contentVersions   SoulContentVersionRecord[]
  activeBindings    SoulActiveContentBindingRecord[]

  @@index([packageId])
  @@index([contentOnChainId])
}

model SoulContentVersionRecord {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId    String   @map("soul_on_chain_id")
  contentOnChainId String   @map("content_on_chain_id")
  kind             Int
  kindName         String   @map("kind_name")
  name             String
  versionIndex     Int      @map("version_index")
  visibility       String
  deleted          Boolean  @default(false)
  purged           Boolean  @default(false)
  blobObjectId     String   @map("blob_object_id")
  blobId           String?  @map("blob_id")
  downloadPolicy   String?  @map("download_policy")
  grantScopeMask   Int      @map("grant_scope_mask")
  sealSidecar      Json?    @map("seal_sidecar")
  createdAtMs      BigInt   @map("created_at_ms")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @default(now()) @updatedAt @map("updated_at")

  soul             SoulAsset @relation(fields: [soulOnChainId], references: [onChainId], onDelete: Cascade)

  @@unique([contentOnChainId, kind, name, versionIndex], map: "soul_content_version_unique")
  @@index([soulOnChainId, kind, name, versionIndex(sort: Desc)])
}

model SoulActiveContentBindingRecord {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId   String   @map("soul_on_chain_id")
  kind            Int
  kindName        String   @map("kind_name")
  name            String
  versionIndex    Int      @map("version_index")
  downloadPolicy  String?  @map("download_policy")
  updatedAtMs     BigInt   @map("updated_at_ms")

  soul            SoulAsset @relation(fields: [soulOnChainId], references: [onChainId], onDelete: Cascade)

  @@unique([soulOnChainId, kind], map: "soul_active_content_binding_unique")
}
```

Collection projection also needs current-package filtering:

```prisma
model SoulCollectionAsset {
  id        String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  onChainId String @unique @map("on_chain_id")
  packageId String @map("package_id")
  // existing fields...

  @@index([packageId])
}
```

Paid access rename shape:

```prisma
model SoulPaidAccessRecord {
  id                        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId             String    @map("soul_on_chain_id")
  soul                      SoulAsset @relation("SoulPaidAccess", fields: [soulOnChainId], references: [onChainId], onDelete: Cascade)
  paidAccessListOnChainId   String    @map("paid_access_list_on_chain_id")
  granteeAddress            String    @map("grantee_address")
  scopeMask                 Int       @map("scope_mask")
  pricePaidAtomic           BigInt    @map("price_paid_atomic")
  grantedAtMs               BigInt    @map("granted_at_ms")
  expiresAtMs               BigInt?   @map("expires_at_ms")
  ownershipEpochSnapshot    Int       @map("ownership_epoch_snapshot")
  revokedAt                 DateTime? @map("revoked_at") @db.Timestamptz

  @@unique([paidAccessListOnChainId, granteeAddress], map: "paid_access_unique")
  @@index([soulOnChainId])
  @@index([granteeAddress])
  @@map("soul_paid_access_records")
}
```

Migration name：`drop_skills_assets_metadata_add_content_destructive`。同步删除 `metadata_on_chain_id` 列、加 `content_on_chain_id` / `package_id`，sprite / mood JSON 字段保留但 mirror 来源切换。

### Centralized package-id 过滤工厂（D2 = A，已采纳）

新增 `web/lib/db/require-current-package.ts`：

```ts
export function requireCurrentPackageId(prisma: PrismaClient) {
  const packageId = currentDeployment.packageId
  return {
    soulAsset: {
      findMany: (args?) => prisma.soulAsset.findMany({ ...args, where: { ...args?.where, packageId } }),
      findFirst: (args?) => prisma.soulAsset.findFirst({ ...args, where: { ...args?.where, packageId } }),
      findUniqueByOnChainId: (onChainId) =>
        prisma.soulAsset.findUnique({ where: { onChainId, packageId } }),
    },
    soulCollection: { /* same shape */ },
    soulMarketListing: { /* same shape */ },
    soulGrant: { /* JOIN through SoulAsset.packageId */ },
    soulPaidAccess: { /* JOIN through SoulAsset.packageId */ },
  }
}
```

ESLint 规则 `soulidity/no-direct-prisma-soul`：禁止 `web/app/api/**` 与 `web/lib/soulidity/**` 下出现 `prisma.soulAsset.*` / `prisma.soulCollection*Asset.*` / `prisma.soulGrantRecord.*` / `prisma.soulPaidAccessRecord.*` 直调；只能调 `requireCurrentPackageId(prisma).*`。autofix 给最近 import suggestion。

Required repository changes：

- `/api/souls`、`/api/souls/my`、`/api/collections`、`/api/market/*`、`/api/souls/[id]/grants` 全部 only via `requireCurrentPackageId(prisma)`。直调 prisma 由 ESLint 一律拦截。
- Queries require `contentOnChainId` to be non-null（在工厂层强制 default filter）。
- Upserts for old skill/asset/metadata events are deleted, not left dormant。
- `SoulAssetDetail` exposes `contentOnChainId`、`contentVersions`、`activeBindings`、`spriteConfigJson`、`spriteMoodMapJson`。
- Old `skillsOnChainId`、`assetsOnChainId`、`metadataOnChainId`、`activeSprite`、`activeVoice` fields 全部从 server / client types 移除。
- `upsert-content-version.ts` writes `SoulAsset.contentOnChainId`、`SoulContentVersionRecord`、`SoulActiveContentBindingRecord` 在同一 Prisma transaction。Partial success invalid；任何写失败则整个 projection update 回滚，避免 zombie row。
- `upsert-content-access.ts` is renamed to `upsert-paid-access.ts`；do not keep both names in `web/lib/soulidity/mirror/`。
- 新增 `upsert-state-config.ts`：从 `SoulStateConfigUpserted/Deleted` 事件 mirror 到 `SoulAsset.spriteConfigJson` / `spriteMoodMapJson`（well-known key），其他 key 落到 generic `SoulAsset.stateConfigExtra: Json` 字段（如有需要）或 ignore。

## Test Surface

### Move

Required protocol scenario coverage：

- Kind registry register / lookup、duplicate rejection、admin-cap authorization、invalid scope-mask rejection、name validation、`KindRegistryCreated` event capture。
- **KindDescriptor 不可变性**：注册后 `KindRegistry` 不暴露任何 mutator；负面测试用 reflection / hand-crafted call 尝试改 `default_grant_scope_mask` / `requires_download_policy` / `has_active_binding` / `name` 必须编译失败或运行时 abort。
- **Slot scope cache 与 registry 状态独立**：构造 sequence "append → deprecate kind → reactivate kind"，验证历史 `ContentSlot.grant_scope_mask` 不变、`seal_approve_content_owner` / `granted_agent` / `paid_access::seal_approve_content_paid_access` 全部仍可通过。
- Kind lifecycle：deprecate / reactivate admin entries emit `KindDeprecated` / `KindReactivated`；deprecated kinds block new appends while existing reads remain valid。
- **Share-time content_id 不变量**：构造 `SoulState` 后未 `set_content_id` 即调 `share_state` / `emit_created_after_content_bound` 必须 abort `EContentRootMissing`。
- Mint projection：every mint sets `SoulState.content_id`、emits content-aware projection events、never returns/shares a product-visible Soul without content root。
- Content CRUD for built-ins：`skill` append/delete/purge with no active binding；`sprite` 和 `audio` append/delete/purge with intra-module `assert_version_not_active` guard。
- **Active binding intra-module 检查**：`set_active` 之后 `delete_version_*` 该 version 必须 abort `EActiveVersionDeleted`；`clear_active` 后再 delete 通过。
- Custom runtime kind：admin-registered kind can mint、append、approve Seal、project through mirror。
- Name / document invariants：invalid kind / content names reject；cross-kind document ids cannot collide；old `soul-skill:` / `soul-asset:` prefixes reject。
- Download-policy invariants：non-policy kinds require `download_policy == 0`；policy-required kinds require a valid policy。
- Initial content invariants：`set_active=true` for non-active kind aborts with `market::EInitialEntryActiveNotSupported`。
- **State config 入口**：`market::set_state_config` / `delete_state_config` 仅 owner 可调；非 owner 调 abort；空 key abort `EStateConfigKeyEmpty`；删除不存在 key abort `EStateConfigKeyMissing`；事件 `SoulStateConfigUpserted` / `SoulStateConfigDeleted` 正确 emit。
- Access invariants：owner、granted-agent、paid-access content approvals pass；stale ownership epoch and stale root bindings reject。
- PTB economics：first content for `skill`、`sprite`、`audio`、custom kind remains 2 signatures in dry-run/smoke notes。

Do not keep old skills/assets/metadata tests under renamed files. Delete them or rewrite them as content / state_config tests. Avoid hardcoding a final test count in the plan；the acceptance criterion is all current content / registry / state_config / paid access protocol scenarios passing and the final count recorded in smoke notes.

### TS / API

Suggested test file targets：

- `tests/new-web/soulidity-content-builder.test.ts`
- `tests/new-web/kind-registry-builder.test.ts`
- `tests/new-web/state-config-builder.test.ts`
- `tests/new-web/content-paid-access-route.test.ts`
- `tests/new-web/content-fast-path-regressions.test.ts`
- `tests/new-web/require-current-package-factory.test.ts`
- `tests/new-web/recovery-wipe-per-prefix.test.ts`
- `tests/scripts/publish-soulidity-and-sync.test.ts`
- `tests/scripts/reset-soulidity-mirror.test.ts`
- `tests/eslint/no-direct-prisma-soul.test.ts`

Required scenario assertions：

- Builders require `contentObjectId` and `kindRegistryId`；不再接 `metadataObjectId`。
- `buildRegisterKindTx` requires `kindAdminCapId`；拒绝 combined / SCOPE_SEAL mask。
- Publish script records `kindRegistryId` 和 `kindAdminCapId`；并校验 `kindAdminCapId != deployerAddress` + 目标 multisig 非空。
- Cap transfer / resume includes `KindAdminCap`。
- Human and agent query-form access routes call `paid_access::seal_approve_content_paid_access`。
- Seal document-id helper rejects old `soul-skill:` / `soul-asset:` prefixes。
- `/api/souls`、`/api/souls/my`、`/api/collections`、`/api/market/*`、`/api/souls/[id]/grants` 全部经 `requireCurrentPackageId(prisma)`，旧 package rows 永不漏出。
- ESLint 规则 `soulidity/no-direct-prisma-soul` 在 `web/app/api/**` 和 `web/lib/soulidity/**` 路径上拦截 `prisma.soulAsset.findMany` 类直调；故意违反必须报错。
- Reset script removes the full Soulidity mirror set, not only old version rows。
- **Recovery wipe per prefix**：每个旧前缀单独跑一次 wipe scenario，断言一次 toast + 对应数据清空。覆盖：`soul-mint-recovery`、`soul-import-recovery`、`soul-wrap-personal-recovery`、`collection-mint-recovery`、`soul-skill-append-recovery:*`、`soul-sprite-append-recovery:*`、`legacy-mint-asset-recovery.assetsSealMaterial` 嵌套字段。
- `upsert-content-version.ts` uses one Prisma transaction for root / version / active-binding writes。
- `upsert-state-config.ts` 把 `SoulStateConfigUpserted` 事件正确投到 `SoulAsset.spriteConfigJson` / `spriteMoodMapJson`（well-known key）。
- `state-config-builder.test.ts` 覆盖：空 key 客户端拒绝、超长 value 客户端拒绝、PTB 生成结果带 `MarketConfig` 引用。

### Smoke / Bench

Smoke acceptance matrix must include:

- first content of kind `skill`: 2 sigs
- first content of kind `sprite`: 2 sigs
- first content of kind `audio`: 2 sigs
- first content of admin-registered custom kind: 2 sigs
- subsequent owner append to same kind/name new version: 1 sig
- subsequent owner append to different kind/new name: 1 sig
- granted-agent append: 1 sig
- owner private read
- granted-agent private read
- paid-access Seal read
- **deprecated kind 历史 slot 仍可 owner / granted-agent / paid-access 读**（KindDescriptor 不可变性回归）
- active sprite set / clear（写入 `SoulContent.active`，事件 `ActiveBindingUpdated`）
- active audio set / clear
- state config upsert / delete（`sprite_config_json` + `sprite_mood_map_json` 走新通道）
- delete-while-active rejection（intra-module，不走 metadata）
- share-time `content_id.is_some()` 不变量（未 link 即 share 必须 abort）
- mirror reset + current-package-only listing（必须经 `requireCurrentPackageId` 工厂）
- 12-soul collection fast path remains within existing caps
- KindRegistry 含入 append PTB 的 gas overhead ≤ 5%（vs 旧 skills::append）

The 12-soul collection row must link back to the 2-sigs runbook's 1-30 cap table so reviewers can compare signature/gas assumptions without reconciling two independent documents.

Bench must measure mint + append-content batch PTB size and gas, using the same caps as the current fast-path runbook.

## Verification Commands

```bash
sui move build --path move/soulidity
sui move test --path move/soulidity

npm test -- tests/new-web/soulidity-content-builder.test.ts \
  tests/new-web/kind-registry-builder.test.ts \
  tests/new-web/state-config-builder.test.ts \
  tests/new-web/content-paid-access-route.test.ts \
  tests/new-web/content-fast-path-regressions.test.ts \
  tests/new-web/require-current-package-factory.test.ts \
  tests/new-web/recovery-wipe-per-prefix.test.ts \
  tests/scripts/publish-soulidity-and-sync.test.ts \
  tests/scripts/reset-soulidity-mirror.test.ts \
  tests/eslint/no-direct-prisma-soul.test.ts

npm test
npm run typecheck
npm --prefix web run lint
npm run build:web:production-env

NEXT_PUBLIC_SUI_NETWORK=testnet npm run publish:soulidity -- --testnet-e2e
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/reset-soulidity-mirror.ts --apply --package-id=<newPackageId>
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/smoke-soulidity.ts
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/bench-fast-path.ts

# Required before mainnet publish: attach PTB economics proof + audit sign-off to release notes.

NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/precheck-live-soulidity-collections.ts
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --mainnet-e2e
NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/reset-soulidity-mirror.ts --apply --package-id=<newPackageId>
NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/smoke-soulidity.ts
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --resume-cap-transfer-from-manifest --transfer-caps-to=<multisig>
```

注：mainnet 流程不再调 `export-soulidity-paid-access-impact.ts`（用户决策"不考虑生产历史数据"，旧 paid-access 直接 wipe）。

Mainnet `smoke-soulidity` must pass before cap transfer. If smoke fails after publish, rollback is product-side: keep old deployment manifest active and do not sync/list the new package until fixed. Since this plan is hard cut, rollback is not an on-chain object migration.

## Critical Files

**Add**

- `move/soulidity/sources/kind_registry.move`
- `move/soulidity/sources/content.move`
- `web/lib/soulidity/tx/content.ts`
- `web/lib/soulidity/tx/kind-registry.ts`
- `web/lib/soulidity/tx/state-config.ts`
- `web/lib/hooks/use-content.ts`
- `web/lib/soulidity/recovery/typed-append-recovery.ts`
- `web/lib/soulidity/paid-access.ts`
- `web/lib/soulidity/content-access.ts`（统一 `createContentDocumentId` / `parseContentDocumentId` 调用方；区别于 `paid-access.ts` 的付费 rail）
- `web/lib/db/require-current-package.ts`
- `eslint-rules/soulidity-no-direct-prisma-soul.ts`（custom ESLint rule）
- `web/app/api/souls/[id]/content/route.ts`
- `web/app/api/souls/[id]/content/access/route.ts`
- `web/app/api/souls/[id]/content/delete/route.ts`
- `web/app/api/agent/souls/[id]/content/access/route.ts`
- `web/lib/soulidity/mirror/upsert-content-version.ts`
- `web/lib/soulidity/mirror/upsert-paid-access.ts`
- `web/lib/soulidity/mirror/upsert-state-config.ts`
- `tests/new-web/soulidity-content-builder.test.ts`
- `tests/new-web/kind-registry-builder.test.ts`
- `tests/new-web/state-config-builder.test.ts`
- `tests/new-web/content-paid-access-route.test.ts`
- `tests/new-web/content-fast-path-regressions.test.ts`
- `tests/new-web/require-current-package-factory.test.ts`
- `tests/new-web/recovery-wipe-per-prefix.test.ts`
- `tests/scripts/publish-soulidity-and-sync.test.ts`
- `tests/scripts/reset-soulidity-mirror.test.ts`
- `tests/eslint/no-direct-prisma-soul.test.ts`

**Modify**

- `move/soulidity/sources/soul.move`（加 `content_id` / `config_ext` / `share_state` 包装；删 `metadata_id`）
- `move/soulidity/sources/paid_access.move`（renamed from `content_access.move`）
- `move/soulidity/sources/market.move`（mint 新 ABI；新 wrappers；删 sprite/voice/metadata-blob wrappers）
- `move/soulidity/sources/protocol_tests.move`
- `scripts/publish-soulidity-and-sync.ts`（捕获 `kindRegistryId` + `kindAdminCapId`，校验 cap 不在 deployer）
- `scripts/reset-soulidity-mirror.ts`
- `scripts/smoke-soulidity.ts`
- `scripts/bench-fast-path.ts`
- `scripts/precheck-live-soulidity-collections.ts`（新增 KindAdminCap 归属检查）
- `web/lib/soulidity/deployment.ts`
- `web/lib/soulidity/env.ts`
- `web/lib/soulidity/deployment-manifest.json`
- `web/lib/soulidity/events.ts`
- `web/lib/soulidity/queries.ts`（全部走 `requireCurrentPackageId`）
- `web/lib/soulidity/repository.ts`
- `web/lib/soulidity/types.ts`
- `web/lib/services/seal-crypto.ts`
- `web/lib/hooks/use-publish.ts`
- `web/lib/hooks/use-collection-publish.ts`
- `prisma/schema.prisma`
- `.eslintrc.cjs` / `eslint.config.ts`（注册新 rule `soulidity/no-direct-prisma-soul`）

**Delete**

- `move/soulidity/sources/content_access.move`（after rename to `paid_access.move`）
- `move/soulidity/sources/skills.move`
- `move/soulidity/sources/assets.move`
- **`move/soulidity/sources/metadata.move`**（整模块删除）
- `web/lib/soulidity/tx/skills.ts`
- `web/lib/soulidity/tx/assets.ts`
- `web/lib/soulidity/tx/metadata.ts`（被 `tx/state-config.ts` 替代）
- `web/lib/soulidity/skill-access.ts`（被 `content-access.ts` 替代）
- `web/lib/soulidity/asset-access.ts`（被 `content-access.ts` 替代）
- `web/lib/soulidity/asset-version-access.ts`（被 `content-access.ts` 替代）
- `web/lib/soulidity/desktop-asset-access.ts`（被 `content-access.ts` 替代）
- `web/lib/upload/client-seal.ts`（document-id 生成逻辑迁入 `seal-crypto.ts`，原文件删）
- `web/lib/hooks/use-skills.ts`
- `web/lib/hooks/use-assets.ts`
- `web/app/api/souls/[id]/skills/**`
- `web/app/api/souls/[id]/assets/**`
- Any existing `web/app/api/agent/souls/[id]/skills/**`
- Any existing `web/app/api/agent/souls/[id]/assets/**`
- `web/lib/soulidity/mirror/upsert-skill.ts`
- `web/lib/soulidity/mirror/upsert-asset.ts`
- `web/lib/soulidity/mirror/upsert-content-access.ts`（renamed to `upsert-paid-access.ts`）
- `web/lib/soulidity/legacy-mint-asset-recovery.ts`（recovery 改走 typed-append-recovery；旧路径不留兼容）
- tests whose only coverage is old skill/asset/metadata builders, hooks, routes, or event extractors

## Feature Parity Checklist

### Skills

| Current | Typed-content replacement |
|---|---|
| founding `skills_blob` | `InitialContentEntry{kind=KIND_SKILL}` |
| `init_skills_and_append_as_owner` | `append_version_as_owner(kind=KIND_SKILL)` |
| `skills::append_version_as_owner` | `content::append_version_as_owner(kind=KIND_SKILL, download_policy=0)` |
| `skills::append_version_as_granted_agent` | `content::append_version_as_granted_agent(kind=KIND_SKILL)` |
| `skills::delete_version_as_owner` | `content::delete_version_as_owner(kind=KIND_SKILL)` |
| `skills::purge_deleted_version_as_owner` | `content::purge_deleted_version_as_owner(kind=KIND_SKILL)` |
| owner Seal approval | `content::seal_approve_content_owner(kind=KIND_SKILL)` |
| granted-agent Seal approval | `content::seal_approve_content_granted_agent(kind=KIND_SKILL)` |
| paid-access Seal approval | `paid_access::seal_approve_content_paid_access(kind=KIND_SKILL)` |
| `skillsOnChainId` | `contentOnChainId` |

### Sprite

| Current | Typed-content replacement |
|---|---|
| founding asset blob with `asset_type=0` | `InitialContentEntry{kind=KIND_SPRITE, set_active=true}` |
| `init_assets_and_append_sprite_as_owner` | `append_version_as_owner(kind=KIND_SPRITE)` |
| `assets::append_version_as_owner(asset_type=0)` | `content::append_version_as_owner(kind=KIND_SPRITE)` |
| `assets::append_version_as_granted_agent` | `content::append_version_as_granted_agent(kind=KIND_SPRITE)` |
| delete + active guard | `content::delete_version_as_owner` calls intra-module `assert_version_not_active`（不再借 metadata） |
| owner Seal approval | `content::seal_approve_content_owner(kind=KIND_SPRITE)` |
| granted-agent Seal approval | `content::seal_approve_content_granted_agent(kind=KIND_SPRITE)` |
| paid-access Seal approval | `paid_access::seal_approve_content_paid_access(kind=KIND_SPRITE)` |
| `market::set_active_sprite` | `market::set_active_content(kind=KIND_SPRITE)`（操作 `&mut SoulContent`） |
| `market::clear_active_sprite` | `market::clear_active_content(kind=KIND_SPRITE)` |
| `metadata::upsert_metadata_blob(sprite_config_key, ...)` | `market::set_state_config("sprite_config_json", ...)` |
| `metadata::upsert_metadata_blob(sprite_mood_map_key, ...)` | `market::set_state_config("sprite_mood_map_json", ...)` |
| `assetsOnChainId` | `contentOnChainId` |

### Voice / Audio

| Current | Typed-content replacement |
|---|---|
| builder exists but no user hook | `use-content.voice.append/appendBatch` |
| active voice builder exists but no hook | `use-content.voice.setActive/clearActive` |
| delete through asset code path | `content::delete_version_as_owner(kind=KIND_AUDIO)` |
| no visible route contract | content route with `kind=KIND_AUDIO` |

### Invariants preserved

- Content visibility is immutable per version；changing visibility means append a new version.
- Private read requires valid owner、granted-agent、或 paid-access approval。
- Active content cannot be deleted or purged while active（intra-module 检查，不再依赖 metadata）。
- `SoulMemory` remains append-only、独立模块、独立 `seal_policy::seal_approve_memory_*` read 路径。
- `KindDescriptor` 注册后不可变；slot scope cache 独立于 registry 状态，deprecated kind 历史 slot 仍可读授权。
- `SoulState.content_id` 在被 share 时必有值（share-time 不变量）；mirror、API、UI 永远不会看到 content-less Soul。
- Soul burn remains unsupported.

## Hard-Cut Communications

Before mainnet reset，produce a short operator note：

```text
Typed-content hard cut publishes a new Soulidity package and resets product projection to that package only.
Existing on-chain old-package Soul / Skills / Assets / Metadata / ContentAccess objects remain on chain, but
they are not migrated, exported, refunded, or re-granted. Per product decision, historical paid-access entries
on the old package are abandoned wholesale; no compensation flow is shipped with this release.
Rollback before cap handoff is product-side: keep the old deployment manifest active and do not sync/list the
new package until a fix is shipped.
```

This note is required release evidence, not customer-facing copy by itself. Customer-facing 通告（如有）走独立产品沟通渠道，不绑定 release runbook。

## Out of Scope

- `memory.move` 不并入 typed-content 也不并入任何其他模块，保持独立。理由：(a) memory 是 timestamp-keyed history log（语义 = 历史日志），与 content 的 `(kind, name, version_index)` 键空间不兼容；(b) `seal_policy::seal_approve_memory_owner` / `seal_approve_memory_granted_agent` 是 memory 独有的 read 路径，不向 `paid_access` 迁移、也不并入 `content::seal_approve_content_*`；(c) 强行并入会逼 `KindDescriptor` 多挂 `append_only` / `timestamp_keyed` / `seal_read_skip` 等开关，descriptor 复杂度抵消 typed-content 的简化收益。
- `grant.move` 不增加新 scope 位。`KindDescriptor.default_grant_scope_mask` 必须恰好是 `SCOPE_SKILLS` 或 `SCOPE_ASSETS` 之一。
- 旧 package 数据全部放弃：不迁移、不导出、不退款、不重新授权、不发兼容 API。链上对象 Sui 不能物理删除，但产品视角通过 mirror reset + current-package filter 一刀切。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | clean | latest @ a3922a6: D1=no-migration / D2=A / E1=A / E2=A all accepted; 8 plan-text patches (1A/1B/1C/1D/1E/2A/3B/4A) folded; 3A + T2 dissolved by no-migration; metadata.move 整模块删除已合入 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0 decisions remaining. T1 / T3 / T4 已落到 `TODOS.md`（见仓库根）。

**VERDICT:** ENG REVIEW CLEAR — plan 已对齐为可实现态。注意：mainnet republish + audit + multisig cap handoff 仍是高 blast-radius 操作，建议落地时按 §Sequencing 严格执行，每个 milestone 卡 review checkpoint。
