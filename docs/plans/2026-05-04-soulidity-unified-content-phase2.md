# Soulidity Unified Content Kind Matrix — Phase 2 Hard Cut

> Phase 1 (`docs/plans/2026-05-04-soulidity-typed-content-nebula.md`) 把 `skills / assets / metadata / content_access` 合进 `SoulContent + KindRegistry`。Phase 2 是同一思路的极限版：把 **`Soul.protected_blob`（soul.md）和 `SoulMemory`（memory.md）也并入** `SoulContent`，并把"管理员可配置每个 kind 支持的操作 + 读取模式"做成一等公民。

## Context

Phase 1 目前的 baseline：

- `HEAD = a3922a6` 只提交了 Phase 1 计划文件，不包含 Move 实现。
- 本计划依赖的 Phase 1 实现基线是当前 dirty checkout 中的 `kind_registry.move` / `content.move` / `paid_access.move` 草案，以及删除 `assets.move` / `skills.move` / `metadata.move` / `content_access.move` 的 hard-cut 方向。Phase 2 开工前必须先把 Phase 1 实现落成一个可编译、可测试的提交，或在 fresh context 中重新应用同等改动；不能把 clean `a3922a6` 当作已实现 baseline。
- Phase 1 目标闭合面：skill / sprite / audio 单根、grant scope 缓存、paid_access 通用 seal 入口、market mint 接受 `vector<InitialContentEntry>`、metadata.move 删除。
- Phase 1 **未闭合的 4 个缺口**（用户在 2026-05-04 review 中确认）：
  1. `memory.move` 没有 delete / purge 路径；user 要求 memory.md "可删除"。
  2. `content.move` 没有 `seal_approve_content_public`；`download_policy=PUBLIC` 是 slot 上的元信息，不被任何 seal 入口 enforce。
  3. `KindDescriptor` 只配置 `has_active_binding / requires_download_policy / default_grant_scope_mask`，不配置 op 矩阵（append / delete / purge / modify / active-bind）和 read 矩阵（owner / grant / paid / public）。所有 kind 都被硬编码为全 CRUD + 全 owner+grant+paid 读。
  4. `Soul.protected_blob`（soul.md）与 `SoulMemory`（memory.md）**不在 KindRegistry 抽象内**：soul.md 字段化、memory.md 独立模块、各自一套 seal_policy，统一抽象失效。

Phase 2 一次性闭合这 4 个缺口，方法是把 KindRegistry 升级为合约级别的"内容类型 op/read 矩阵"，并把 soul.md / memory.md 折回 `SoulContent`。

## Decision

按 user 在 2026-05-04 拍板的"最激进 hard-cut"执行 5 项决策：

| # | 决策 | 选 |
|---|---|---|
| D1 | memory 在 SoulContent 中的 name 维度 | **单一 name + version 递增**（最对称；memory `(kind=KIND_MEMORY, name="default", version=N)`） |
| D2 | soul.md 是否进 SoulContent | **是**。删除 `Soul.protected_blob` 字段，soul.md 作为 `(kind=KIND_SOUL_DOC, name="soul", version=0)` 的唯一不可变 entry |
| D3 | READ_PUBLIC 语义 | slot 仍必须包含 `READ_OWNER`，公共可读用 `READ_PUBLIC + DOWNLOAD_POLICY_PUBLIC` 表达。所有 slot 保持 Seal encryption，`seal_approve_content_public` 对含 `READ_PUBLIC` 的混合 slot 生效；`READ_PUBLIC` only 在 append 阶段 abort `EOwnerReadModeRequired` |
| D4 | paid_access 是否变 per-kind | **是**。`SoulPaidAccessList` 改为 `Table<u32, KindPaidConfig>`，每个 kind 独立 price / scope / duration |
| D5 | DB / TS / 前端联动范围 | **全 hard cut**。旧 mainnet 数据全弃；DB schema 重置；TS SDK 无兼容层；前端 hooks 全替换 |

**用户约束**："不考虑迁移，旧文件该删就删。所有 Move 变更都要加 Move 测试。"

由此衍生出的硬规则：

- 任何 `register_kind` / `append_*` / `delete_*` / `purge_*` / `set_active_*` / `seal_approve_*` 入口的新增、修改或语义变化，必须在 `protocol_tests.move`（或拆出的子测试文件）里有对应的 **正向 + 反向**（abort）测试。
- 路径删除（memory.move / seal_policy.move / Soul.protected_blob）也要有"旧路径不再存在"的回归测试 —— 通过 ABI 层面的"该 fn 不再 export"和测试调用路径替换体现。
- 每个 Move 实施步骤结束时必须处于可编译、可跑对应测试的状态；禁止先删除被 caller import 的模块，再把 caller 改造留到后一步。

## Architecture

### 1. `kind_registry.move`（修改）

`KindDescriptor` 扩展为完整 op + read 矩阵描述符。

```move
// op_mask bits
const OP_APPEND: u64       = 1 << 0;  // 用户可调 append_version_as_owner / granted_agent
const OP_DELETE: u64       = 1 << 1;  // 用户可调 delete_version_as_owner / granted_agent
const OP_PURGE: u64        = 1 << 2;  // 用户可调 purge_deleted_version_as_owner
const OP_ACTIVE_BIND: u64  = 1 << 3;  // 用户可调 set_active_content / clear_active_content

// read_mode_mask bits
const READ_OWNER: u64      = 1 << 0;  // seal_approve_content_owner 通过
const READ_GRANT: u64      = 1 << 1;  // seal_approve_content_granted_agent 通过
const READ_PAID: u64       = 1 << 2;  // seal_approve_content_paid_access 通过
const READ_PUBLIC: u64     = 1 << 3;  // seal_approve_content_public 通过 / 明文 blob 路径

public struct KindDescriptor has copy, drop, store {
    kind: u32,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,            // 必须等价于 (op_mask & OP_ACTIVE_BIND != 0)
    requires_download_policy: bool,      // 仅对 read_mode_mask 含 PUBLIC 的 kind 强制 true
    default_grant_scope_mask: u64,       // grant/paid 读共用的 scope cache；无 GRANT/PAID 时必须为 0
    deprecated: bool,
}
```

#### 内置 kind 一次性预注册

| kind id | name | op_mask | read_mode_mask | grant_scope | active_binding |
|---:|---|---|---|---|---|
| 0 | `soul_doc` | `0`（mint-only） | `OWNER\|GRANT` | `SCOPE_SEAL` | false |
| 1 | `memory` | `OP_APPEND\|OP_DELETE\|OP_PURGE` | `OWNER\|GRANT` | `SCOPE_MEMORY` | false |
| 2 | `skill` | `OP_APPEND\|OP_DELETE\|OP_PURGE` | `OWNER\|GRANT` | `SCOPE_SKILLS` | false |
| 3 | `sprite` | `OP_APPEND\|OP_DELETE\|OP_PURGE\|OP_ACTIVE_BIND` | `OWNER\|GRANT\|PAID\|PUBLIC` | `SCOPE_ASSETS` | true |
| 4 | `audio` | `OP_APPEND\|OP_DELETE\|OP_PURGE\|OP_ACTIVE_BIND` | `OWNER\|GRANT\|PAID\|PUBLIC` | `SCOPE_ASSETS` | true |
| 5–15 | reserved | — | — | — | — |
| 16+ | admin 注册 | admin 给 | admin 给 | admin 给 | admin 给 |

注意 phase 1 把 `KIND_SKILL` 的 `default_grant_scope_mask` 限制为 `SCOPE_SKILLS \| SCOPE_ASSETS` 二选一。Phase 2 放宽这条约束 —— `soul_doc / memory` 用 `SCOPE_SEAL / SCOPE_MEMORY`，必须支持。`assert_valid_default_grant_scope` 改为：

```move
fun assert_valid_default_grant_scope(mask: u64, read_mode_mask: u64) {
    let needs_scoped_read = (read_mode_mask & (READ_GRANT | READ_PAID)) != 0;
    if (!needs_scoped_read) {
        // 不允许 grant/paid 读时，scope 必须是 0
        assert!(mask == 0, EInvalidDefaultGrantScope);
    } else {
        // 允许 grant/paid 读时，scope 必须命中 grant.move 已知单 bit 之一
        let allowed = grant::scope_seal()
            | grant::scope_memory()
            | grant::scope_skills()
            | grant::scope_assets();
        assert!(mask != 0 && (mask & allowed) == mask && popcnt(mask) == 1, EInvalidDefaultGrantScope);
    };
}
```

#### `register_kind` 入参扩展

```move
public fun register_kind(
    registry: &mut KindRegistry,
    _: &KindAdminCap,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
    _ctx: &mut TxContext,
): u32
```

新增不变量（在 `register_kind` 与 `insert_descriptor_unchecked` 都强制）：

- `op_mask` 必须是已知 4 bits 的子集；非 0 bit abort `EOpMaskUnknownBit`。
- `read_mode_mask` 必须是已知 4 bits 的子集；至少含 `READ_OWNER` —— "owner（含 owner 授权 agent）必须能读"是 user 给的硬规则。
- `(op_mask & OP_ACTIVE_BIND != 0) == has_active_binding`（双向等价）。
- `read_mode_mask & READ_PUBLIC != 0` ⇒ `requires_download_policy == true`（PUBLIC 必须能选择 PUBLIC policy）。
- `read_mode_mask & (READ_GRANT | READ_PAID) != 0` ⇒ `default_grant_scope_mask != 0`；反之必为 0。
- `seal_approve_content_granted_agent` 与 `seal_approve_content_paid_access` 都读 `ContentSlot.grant_scope_mask`；字段名沿用 Phase 1，但语义是 scoped read cache，不只服务 grant。
- 描述符 register 后**仍然 immutable**（同 phase 1）；`reactivate_kind` 仅切 `deprecated`。

`KindAdminCap` 的 multisig handoff 流程沿用 phase 1。

### 2. `content.move`（修改）

#### `ContentSlot` 扩展

```move
public struct ContentSlot has copy, drop, store {
    kind: u32,
    blob_object_id: ID,
    is_public: bool,             // 派生自 slot_read_mode_mask & READ_PUBLIC != 0，用于 event / mirror
    deleted: bool,
    purged: bool,
    download_policy: u8,         // 沿用
    grant_scope_mask: u64,       // append-time 缓存 grant/paid scoped read mask
    read_mode_mask: u64,         // 新增：append-time 缓存 caller 选择的 slot_read_mode_mask
    op_mask: u64,                // 新增：append-time 缓存自 KindDescriptor
    seal_encrypted: bool,        // 新增：append-time 由 slot_read_mode_mask 决定，纯 PUBLIC = false
    created_at_ms: u64,
}
```

`op_mask / read_mode_mask` 缓存在 slot 上，与 `grant_scope_mask` 一样 —— Seal 路径只读 slot 缓存，不读 KindRegistry，保证 deprecate 不影响历史读授权。

`KindDescriptor.read_mode_mask` 是该 kind 的能力上限；`ContentSlot.read_mode_mask` 是每个 version append 时选择的有效子集。append 必须强制：

- `slot_read_mode_mask != 0`。
- `(slot_read_mode_mask & descriptor.read_mode_mask) == slot_read_mode_mask`，否则 abort `EReadModeNotAllowed`。
- `slot_read_mode_mask & READ_OWNER != 0`，否则 abort `EOwnerReadModeRequired`。
- `slot_read_mode_mask & READ_PUBLIC != 0` ⇒ `download_policy == DOWNLOAD_POLICY_PUBLIC`，`is_public=true`，`seal_encrypted=true`。
- `slot_read_mode_mask & READ_PUBLIC == 0` ⇒ `is_public=false`，`seal_encrypted=true`。

`seal_encrypted` 保留为 slot 快照字段，但当前语义固定为 `true`。公共读与 owner 读不再拆成明文 / Seal 双轨，避免 owner 被纯 public slot 锁在 Seal 路径外。

#### `append_version_impl` 增加 op 断言

```move
fun append_version_impl(content, registry, kind, name, slot_read_mode_mask, download_policy,
                       content_blob, clock, enforce_op) -> u64 {
    assert_valid_content_name(&name);
    kind_registry::assert_kind_active(registry, kind);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    assert_canonical_name_for_kind(kind, &name);
    if (enforce_op) {
        assert!(kind_registry::descriptor_op_mask(descriptor) & OP_APPEND != 0, EOpNotAllowed);
    };
    assert_slot_read_mode_allowed(slot_read_mode_mask, kind_registry::descriptor_read_mode_mask(descriptor));
    let is_public = slot_read_mode_mask & READ_PUBLIC != 0;
    let seal_encrypted = slot_read_mode_mask != READ_PUBLIC;
    // 其余沿用 phase 1
}
```

`append_initial_version`（`public(package)`）拆成两条内部路径，避免 caller-supplied initial content 绕过 op 矩阵：

- `append_initial_invariant_version`：只允许 `(KIND_SOUL_DOC, "soul")` 与 `(KIND_MEMORY, "default")`，不读 `OP_APPEND`，因为这两类是 mint invariant。
- `append_initial_user_version`：用于 initial content 中的 skill / sprite / audio / custom kind，必须读 `OP_APPEND`，与普通 owner append 一致。

`KIND_MEMORY` 在所有 append/delete/purge/seal 路径都必须 `name == "default"`；`KIND_SOUL_DOC` 在所有路径都必须 `name == "soul"`。这不是只在 mint 入口检查的 UI 约定，而是 `content.move` 内部 invariant。

#### `delete_version_*` / `purge_*` / `set_active_*` 同步加 op 断言

```move
public fun delete_version_as_owner(...) {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    assert!(kind_registry::descriptor_op_mask(descriptor) & OP_DELETE != 0, EOpNotAllowed);
    // ... 其余沿用
}
```

`set_active` 已被 `kind_registry::descriptor_has_active_binding` 拦截；新增 `OP_ACTIVE_BIND` 与 `has_active_binding` 等价不变量后，二者保持一致。

#### `seal_approve_*` 入口加 read_mode 断言

```move
public fun seal_approve_content_owner(id, state, content, kind, name, version, ctx) {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    assert_matching_document_id(id, ...);
    let slot = borrow_slot(content, kind, name, version);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    assert!(slot.read_mode_mask & READ_OWNER != 0, EReadModeNotAllowed);
}

public fun seal_approve_content_granted_agent(... soul_grant, ...) {
    // 同上 + grant 检查
    let slot = borrow_slot(content, kind, name, version);
    assert!(slot.read_mode_mask & READ_GRANT != 0, EReadModeNotAllowed);
    grant::assert_active_with_scope(state, soul_grant, slot.grant_scope_mask, clock, ctx);
}

public fun seal_approve_content_public(id, state, content, kind, name, version, _ctx) {
    assert_content_matches_state(content, state);
    assert_matching_document_id(id, ...);
    let slot = borrow_slot(content, kind, name, version);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    assert!(slot.read_mode_mask & READ_PUBLIC != 0, EReadModeNotAllowed);
    assert!(slot.seal_encrypted, EPublicSlotNoSeal);  // 当前所有合法 slot 都保持 Seal encryption
}
```

`seal_approve_content_paid_access` 在 `paid_access.move` 里同步加 `READ_PAID` 断言（见下）。

#### 新增错误码

```
const EOpNotAllowed: u64 = 18;
const EReadModeNotAllowed: u64 = 19;
const EPublicSlotNoSeal: u64 = 20;
const ESoulDocAlreadyExists: u64 = 21;   // mint 时 SOUL_DOC 重复初始化
const EMemoryNameMismatch: u64 = 22;     // memory entry 必须 name == "default"
const ESoulDocNameMismatch: u64 = 23;    // soul_doc entry 必须 name == "soul"
const EInitialKindOpNotAllowed: u64 = 24; // initial content 中非 invariant kind 必须允许 OP_APPEND
const EOwnerReadModeRequired: u64 = 29;  // 每个 slot 必须保留 READ_OWNER
```

### 3. `paid_access.move`（修改）

D4 决策落地：per-kind 配置。

#### 数据结构

```move
public struct KindPaidConfig has copy, drop, store {
    price_atomic: u64,
    scope_mask: u64,               // 必须命中 KindDescriptor.default_grant_scope_mask
    duration_ms: Option<u64>,
}

public struct KindPaidEntry has copy, drop, store {
    kind: u32,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessList has key {
    id: UID,
    soul_id: ID,
    creator: address,
    kind_configs: Table<u32, KindPaidConfig>,             // per-kind 配置
    entries: Table<address, Table<u32, KindPaidEntry>>,   // per-buyer per-kind
}
```

`record_purchase` / `add_access` / `revoke_access` / `set_paid_access_*` 全部加 `kind: u32` 入参。`has_access` 改签名：

```move
public fun has_access(self, state, addr, kind, required_scope, clock) -> bool
```

#### `seal_approve_content_paid_access` 改造

```move
public fun seal_approve_content_paid_access(
    id, state, paid_access_list, content, kind, name, version, clock, ctx,
) {
    assert_paid_access_list_matches_state(paid_access_list, state);
    let slot_scope_mask = content::assert_valid_content_seal_request(
        id, state, content, kind, name, version,
    );
    let slot = content::borrow_slot(content, kind, name, version);
    assert!(content::slot_read_mode_mask(slot) & READ_PAID != 0, EReadModeNotAllowed);
    let sender = ctx.sender();
    assert!(slot_scope_mask != 0, EScopeNotPermittedForKind);
    assert!(
        has_access(paid_access_list, state, sender, kind, slot_scope_mask, clock),
        EScopeMismatch,
    );
}
```

#### 错误码新增

```
const EKindNotConfigured: u64 = 7;
const EKindAlreadyConfigured: u64 = 8;
const EKindScopeMismatch: u64 = 9;
const EReadModeNotAllowed: u64 = 10;
```

### 4. `soul.move`（修改）

#### 字段裁剪

```move
public struct Soul has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: String,
    // protected_blob 删除（搬到 SoulContent KIND_SOUL_DOC v0）
    provenance_kind: u8,
    origin_ref: Option<String>,
    creator: address,
}

public struct SoulState has key {
    // ...
    // memory_id: Option<ID> 删除（KIND_MEMORY 在 SoulContent 内）
    content_id: Option<ID>,
    config_ext: Table<String, vector<u8>>,
    collection_id: Option<ID>,
    access_list_id: Option<ID>,
    // 其他不变
}
```

`SoulCreated` / `SoulMintedToKiosk` 事件中 `memory_id` 字段移除，`content_id` 沿用。

#### mint 入口移除 protected_blob 入参

```move
public(package) fun mint(
    name, description, image_url,
    creator, creator_royalty_bps,
    provenance_kind, origin_ref,
    ctx,
): Soul
```

#### 强制 invariant 升级

`emit_created_after_content_bound` / `share_state` 仍要求 `content_id.is_some()`，**额外**新增：

```move
public(package) fun assert_initial_content_complete(
    state: &SoulState,
    content: &SoulContent,
) {
    // SOUL_DOC 必须存在 v0
    assert!(content::version_count(content, KIND_SOUL_DOC, "soul".to_string()) == 1,
            EInitialSoulDocMissing);
    // MEMORY 至少存在 v0（founding entry）
    assert!(content::version_count(content, KIND_MEMORY, "default".to_string()) >= 1,
            EInitialMemoryMissing);
}
```

mint 流必须在 `share_state` 之前过这个断言。

### 5. `memory.move`（删除整个模块）

- 删除 `SoulMemory` / `MemoryBlobKey` / `SoulMemoryCreated` / `MemoryEntryAppended` / 全部 `append_*` 函数。
- 删除 `seal_policy::seal_approve_memory_owner / seal_approve_memory_granted_agent`（连同 `seal_policy.move` 整体删除，见下）。
- 旧 mainnet 上的 `SoulMemory` 对象保留在链上不动，新 package 不读。

### 6. `seal_policy.move`（删除整个模块）

- 删除 `seal_approve_owner` / `seal_approve_granted_agent` / `seal_approve_memory_*` 共 4 个 entry。
- soul.md 的 Seal 入口由 `content::seal_approve_content_owner / granted_agent` 取代（kind=KIND_SOUL_DOC）。
- memory.md 的 Seal 入口同上（kind=KIND_MEMORY）。
- domain bytes `b"soul-seal:"` / `b"soul-memory:"` 全部下线，统一走 `b"soul-content:"`。

### 7. `market.move`（修改）

#### mint wrapper 入参

`mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk` 移除 `protected_blob: Blob` 与 `founding_memory_blob: Option<Blob>`，**`initial_content` 改为必填且必须包含**：

- 恰好 1 条 `(kind=KIND_SOUL_DOC, name="soul")` —— soul.md。
- 至少 1 条 `(kind=KIND_MEMORY, name="default")` —— founding memory。

`InitialContentEntry` 同步把 `is_public` 替换为 `slot_read_mode_mask`；`is_public` 只由合约按 `READ_PUBLIC` 派生：

```move
public struct InitialContentEntry has store {
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
}
```

`apply_initial_content_entries` 新增前置断言：

```move
fun assert_initial_content_well_formed(registry: &KindRegistry, entries: &vector<InitialContentEntry>) {
    let mut soul_doc_count = 0;
    let mut memory_count = 0;
    let len = entries.length();
    let mut i = 0;
    while (i < len) {
        let entry = vector::borrow(entries, i);
        let kind = initial_entry_kind(entry);
        if (kind == KIND_SOUL_DOC) {
            assert!(initial_entry_name(entry) == &"soul".to_string(), EInitialSoulDocNameMismatch);
            soul_doc_count = soul_doc_count + 1;
        } else if (kind == KIND_MEMORY) {
            assert!(initial_entry_name(entry) == &"default".to_string(), EMemoryNameMismatch);
            memory_count = memory_count + 1;
        } else {
            let descriptor = kind_registry::borrow_descriptor(registry, kind);
            assert!(kind_registry::descriptor_op_mask(descriptor) & OP_APPEND != 0, EInitialKindOpNotAllowed);
        };
        i = i + 1;
    };
    assert!(soul_doc_count == 1, EInitialSoulDocCountMismatch);
    assert!(memory_count >= 1, EInitialMemoryCountMismatch);
}
```

`apply_initial_content_entries` 调度规则：

- `KIND_SOUL_DOC / KIND_MEMORY` 调 `content::append_initial_invariant_version`，不读 `OP_APPEND`，但读 name / read-mode / document policy invariant。
- 其他 kind 调 `content::append_initial_user_version`，必须读 `OP_APPEND`，这样 admin 注册但禁止 append 的 custom kind 不能借 mint 初始内容绕过 op 矩阵。

#### 新增 paid_access 配置 wrapper

```move
public fun configure_paid_access_kind(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
)

public fun delete_paid_access_kind(
    config: &MarketConfig,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
)
```

#### 删除清单

- 所有 `protected_blob` / `founding_memory_blob` 相关入参与构造。
- `purchase_paid_access` 改 `(kind: u32)` 入参。

### 8. PTB Economics & Cap Handoff

继承 phase 1 的 multisig 流程：

- 重新发包；`KindAdminCap` / `MarketCap` / `UpgradeCap` 一起 multisig handoff。
- `register_kind` 在 deployer 持 cap 期间禁用。
- precheck 必须读取 `KindAdminCap` object owner，校验 owner 是目标 multisig address，且不是 `AddressOwner(deployerAddr)`。不能用 `kindAdminCapId != deployerAddr` 这类 object id vs address 比较替代 owner 校验。

## Move Test Plan（per user 强约束：所有 Move 变更都要测试）

测试组织：在 `protocol_tests.move` 内按模块拆 `#[test_only] mod` 子组。每个新增/修改 Move 入口都要至少 1 个正向 + 1 个反向测试。

### 8.1 `kind_registry`

| 测试名 | 类型 | 期望 |
|---|---|---|
| `built_in_kinds_present_with_correct_masks` | 正向 | 5 个内置 kind 注册成功，op_mask / read_mode_mask 与决策表一致 |
| `non_admin_cannot_register_kind` | 反向 | 没有 `KindAdminCap` 的 sender 无法取得 cap，`register_kind` 不会运行 |
| `admin_registered_kind_enforces_configured_ops_and_reads` | 正/反向 | admin 注册 custom kind 后，其 `op_mask` / `read_mode_mask` 被 slot 缓存并实际门禁 delete / read |
| `register_kind_rejects_invalid_op_mask` | 反向 | op_mask 含未知 bit（`1<<5`）abort `EOpMaskUnknownBit` |
| `register_kind_rejects_zero_read_mode` | 反向 | `read_mode_mask=0` abort `ENoReadModeMask`（必含 OWNER） |
| `register_kind_rejects_active_binding_inconsistency` | 反向 | `op_mask & OP_ACTIVE_BIND != has_active_binding` abort `EActiveBindingMaskInconsistent` |
| `register_kind_rejects_public_without_download_policy` | 反向 | `READ_PUBLIC` 置位但 `requires_download_policy=false` abort `EPublicRequiresDownloadPolicy` |
| `register_kind_rejects_grant_without_scope` | 反向 | `READ_GRANT` 置位但 `default_grant_scope_mask=0` abort `EInvalidDefaultGrantScope` |
| `register_kind_rejects_paid_without_scope` | 反向 | `READ_PAID` 置位但 `default_grant_scope_mask=0` abort `EInvalidDefaultGrantScope` |
| `register_kind_rejects_unscoped_read_with_scope` | 反向 | `READ_GRANT/READ_PAID` 都不置位但 `default_grant_scope_mask != 0` abort `EInvalidDefaultGrantScope` |
| `deprecate_kind_blocks_new_append` | 正向 | deprecate 后 `append_version_as_owner` abort `EKindDeprecated` |
| `deprecate_kind_does_not_break_existing_seal` | 正向 | deprecate 前 append 的 slot，deprecate 后 owner 仍能 seal_approve（slot 缓存隔离） |
| `reactivate_kind_does_not_modify_descriptor` | 正向 | reactivate 后 `op_mask / read_mode_mask` 不变（KindDescriptor immutable invariant） |

### 8.2 `content` — op 断言

| 测试名 | kind | op | 期望 |
|---|---|---|---|
| `soul_doc_append_as_owner_aborts` | SOUL_DOC | append | abort `EOpNotAllowed` |
| `soul_doc_delete_aborts` | SOUL_DOC | delete | abort `EOpNotAllowed` |
| `soul_doc_purge_aborts` | SOUL_DOC | purge | abort `EOpNotAllowed` |
| `soul_doc_set_active_aborts` | SOUL_DOC | set_active | abort `EKindActiveBindingNotSupported` |
| `memory_append_as_owner_succeeds` | MEMORY | append | OK，version 递增 |
| `memory_append_wrong_name_aborts` | MEMORY | append name!="default" | abort `EMemoryNameMismatch` |
| `memory_delete_as_owner_succeeds` | MEMORY | delete | OK；slot.deleted=true |
| `memory_delete_wrong_name_aborts` | MEMORY | delete name!="default" | abort `EMemoryNameMismatch` |
| `memory_purge_after_delete_succeeds` | MEMORY | purge | OK；slot.purged=true，blob 被 burn |
| `memory_set_active_aborts` | MEMORY | set_active | abort `EKindActiveBindingNotSupported`（has_active_binding=false） |
| `skill_full_crud` | SKILL | append/delete/purge | 全 OK |
| `skill_set_active_aborts` | SKILL | set_active | abort（has_active_binding=false） |
| `sprite_full_crud_with_active` | SPRITE | append/delete/purge/set_active | 全 OK |
| `sprite_delete_active_aborts` | SPRITE | delete active version | abort `EActiveVersionDeleted` |
| `audio_full_crud_with_active` | AUDIO | 全部 | 全 OK |

### 8.3 `content` — read_mode 断言

| 测试名 | slot 配置 | 调用入口 | 期望 |
|---|---|---|---|
| `soul_doc_owner_reads` | KIND_SOUL_DOC v0 | `seal_approve_content_owner` (sender=owner) | OK |
| `soul_doc_grant_reads` | KIND_SOUL_DOC v0, grant SCOPE_SEAL | `seal_approve_content_granted_agent` | OK |
| `soul_doc_public_aborts` | KIND_SOUL_DOC v0 | `seal_approve_content_public` | abort `EReadModeNotAllowed`（read_mode_mask 不含 PUBLIC） |
| `soul_doc_paid_access_aborts` | KIND_SOUL_DOC v0 | `configure_paid_access_kind` | abort `EKindReadPaidNotAllowed` |
| `memory_owner_and_grant_seal_read` | KIND_MEMORY v0 + grant SCOPE_MEMORY | owner + grant 入口 | OK |
| `memory_paid_access_aborts` | KIND_MEMORY v0 | `configure_paid_access_kind` | abort `EKindReadPaidNotAllowed` |
| `memory_public_aborts` | KIND_MEMORY v0 | public 入口 | abort `EReadModeNotAllowed` |
| `skill_owner_and_grant_seal_read` | KIND_SKILL v0 + grant SCOPE_SKILLS | owner + grant 入口 | OK |
| `skill_public_aborts` | KIND_SKILL v0 | public | abort |
| `skill_paid_access_aborts` | KIND_SKILL v0 | `configure_paid_access_kind` | abort `EKindReadPaidNotAllowed` |
| `sprite_all_four_modes` | KIND_SPRITE seal_encrypted=true | owner / grant / paid / public 各一次 | 全 OK |
| `audio_owner_public_paid_and_active_paths` | KIND_AUDIO active public slot | owner / public / paid + active binding | 全 OK |
| `sprite_pure_public_slot_append_aborts` | KIND_SPRITE read_mode={PUBLIC} only | append/mint | abort `EOwnerReadModeRequired` |

### 8.4 `paid_access` — per-kind 行为

| 测试名 | 操作 | 期望 |
|---|---|---|
| `configure_kind_creates_config` | configure SPRITE 价格 | OK；`kind_configs` 含 SPRITE |
| `soul_doc_paid_access_aborts` / `memory_paid_access_aborts` / `skill_paid_access_aborts` | configure 不含 `READ_PAID` 的 kind | abort `EKindReadPaidNotAllowed` |
| `configure_kind_rejects_scope_mismatch` | scope=SCOPE_MEMORY，kind=SPRITE（descriptor scope=ASSETS） | abort `EKindScopeMismatch` |
| `paid_access_purchase_aborts_for_unconfigured_kind` | purchase 未配置 paid access 的 kind | abort `EPaidAccessKindMismatch` |
| `record_purchase_per_kind` | 买家先买 SPRITE，再买 AUDIO | 两条独立 entry |
| `add_access_per_kind_free` | owner 免费白名单 SPRITE | OK；buyer has_access 通过 SPRITE 不通过 AUDIO |
| `revoke_kind_revokes_only_that_kind` | 撤回 SPRITE entry，AUDIO 仍在 | OK |
| `delete_paid_access_kind_removes_config` | delete SPRITE 配置 | 既存 SPRITE entry 仍可读直到 ownership rotate |
| `ownership_rotate_invalidates_all_kinds` | rotate 后 has_access 全 false | OK；`cleanup_stale_entries` 可批量回收 |

### 8.5 `market` — mint invariants

| 测试名 | 操作 | 期望 |
|---|---|---|
| `mint_succeeds_with_soul_doc_and_memory` | initial_content 含 SOUL_DOC v0 + MEMORY v0 | OK；SoulCreated emit；assert_initial_content_complete pass |
| `mint_aborts_without_soul_doc` | initial_content 缺 SOUL_DOC | abort `EInitialSoulDocCountMismatch` |
| `mint_aborts_with_two_soul_docs` | initial_content 含 2 条 SOUL_DOC | abort `EInitialSoulDocCountMismatch` |
| `mint_aborts_without_memory` | initial_content 缺 MEMORY | abort `EInitialMemoryCountMismatch` |
| `mint_aborts_with_wrong_soul_doc_name` | SOUL_DOC name="other" | abort `EInitialSoulDocNameMismatch` |
| `mint_aborts_with_wrong_memory_name` | MEMORY name="custom" | abort `EMemoryNameMismatch` |
| `mint_aborts_when_initial_custom_kind_lacks_append_op` | custom kind `op_mask=0` in initial_content | abort `EInitialKindOpNotAllowed` |
| `share_state_aborts_without_content_complete` | 绕过 `apply_initial_content_entries` 的伪测试 | abort `EInitialSoulDocMissing` |

### 8.6 删除路径回归

| 测试名 | 期望 |
|---|---|
| `seal_policy_module_absent` | 通过编译保证 —— Move 编译器在 `seal_policy::*` 调用处 fail；测试以"不再 import"形式存在 |
| `memory_module_absent` | 同上 |
| `protected_blob_field_absent_on_soul` | 通过 destructure 测试断言 `Soul` 字段集合不含 `protected_blob` |
| `soul_state_memory_id_absent` | 同上对 `SoulState` |

### 8.7 grant scope 共存

| 测试名 | 期望 |
|---|---|
| `grant_scope_seal_reads_soul_doc` | 持 `SCOPE_SEAL` grant 通过 `seal_approve_content_granted_agent` 读 KIND_SOUL_DOC |
| `grant_scope_memory_reads_memory` | 同上 KIND_MEMORY |
| `grant_scope_skills_reads_skill` | 同上 KIND_SKILL |
| `grant_scope_assets_reads_sprite_and_audio` | 单 grant 同时读 sprite+audio（确认 phase 1 的 ASSETS 共享 scope 仍生效） |
| `grant_scope_mismatch_aborts` | scope=SKILLS 试图读 KIND_SPRITE abort（slot 的 grant_scope_mask=SCOPE_ASSETS） |

## Hard-Cut Scope（D5）

### 删除文件

```
move/soulidity/sources/memory.move
move/soulidity/sources/seal_policy.move
```

### Prisma schema 重置

- 删 `SoulMemoryEntry` 表、删 `SoulSkillVersionRecord`（已被 `SoulContentVersionRecord` 取代时直接删）。
- `SoulAsset.protectedBlobObjectId` / `SoulAsset.memoryOnChainId` 字段直接删。
- 新增/确认 `SoulContentVersionRecord` 作为唯一 content version mirror，至少包含 `kind / kindName / name / versionIndex / blobObjectId / blobId / readModeMask / opMask / grantScopeMask / isPublic / sealEncrypted / downloadPolicy / sealSidecar / deletedAt / purgedAt`。`sealSidecar` 仅对 `sealEncrypted=true` 的 slot 必填；纯 PUBLIC slot 必须允许 `sealSidecar=null`。
- 新增 `SoulPaidAccessKindConfig` 表（per-kind 价格配置），主键 `(soulPaidAccessListId, kind)`。
- 重写 `SoulPaidAccessRecord` 主键为 `(buyerAddress, soulPaidAccessListId, kind)`。

### TS / SDK / API 改造

- 删除 `web/lib/soulidity/tx/memory.ts`、`web/lib/seal/memory-helpers.ts`（如有）。
- 删除 `seal_approve_owner / seal_approve_granted_agent / seal_approve_memory_*` 客户端构造器；统一走 `content::*`。
- 新增 `tx/content-public.ts` 调 `seal_approve_content_public`。
- `tx/paid-access.ts` 增 `configure_paid_access_kind` / `purchase_paid_access(kind)`。
- tx builders / upload routes 把旧 `isPublic` 输入替换为 `slotReadModeMask`；`isPublic` 只作为链上 event / DB mirror 的派生字段。
- publish / import / batch sync 的 sidecar gate 改为按 `sealEncrypted` 判定：sealed slot 必须有对应 `sealSidecar`，`slotReadModeMask == READ_PUBLIC` 的纯 PUBLIC slot 必须允许无 sidecar 并走明文 Walrus URL。
- routes：
  - 删 `/api/souls/[id]/memory/*`，新建 `/api/souls/[id]/content?kind=memory`。
  - 删 `/api/souls/[id]/seal-token`（旧 soul-seal: 域），改 `/api/souls/[id]/content/[kind]/[name]/[version]/seal-token`。
  - `/api/souls/[id]/paid-access` 加 `kind` 入参。
- 前端 hooks：`useMemory` → `useContent({ kind: KIND_MEMORY })`；soul detail 页面把 protected blob 视图改为读 KIND_SOUL_DOC v0 的 content URL。

### Mainnet 旧数据

旧 package 上的 `Soul / SoulState / SoulMemory / SoulMetadata / SoulSkills / SoulAssets / ContentAccessList / SoulPaidAccessList`（phase 1 / phase 0）**全部放弃**。Sui 物理对象保留，产品视角通过 current-package filter 过滤。

## Sequencing

按以下顺序落，每步结束都必须可编译、可跑对应测试：

1. **kind_registry 扩展** — 加 `op_mask / read_mode_mask`，5 内置 kind 重新注册，`register_kind` 入参扩展。同步加 8.1 全部测试。
2. **content 扩展** — `ContentSlot` 加缓存字段，append 接口改 `slot_read_mode_mask`，所有 op / seal 入口加断言，新增 `seal_approve_content_public`，新增错误码。同步加 8.2 / 8.3 全部测试。
3. **paid_access per-kind** — 数据结构改 `Table<u32, KindPaidConfig>`，所有 entry/route 加 `kind` 入参。同步加 8.4 全部测试。
4. **soul.move + market.move mint cutover** — 同一步删除 `Soul.protected_blob / SoulState.memory_id`、移除 mint wrapper 的 `protected_blob / founding_memory_blob` 入参、实现 `assert_initial_content_well_formed` 与 `append_initial_*` 分流，确保 `market.move` 不再 import `memory`。同步加 8.5 全部测试。
5. **memory/seal_policy 删除** — 在所有 caller 都已替换后，删除整个 `memory.move` / `seal_policy.move`，并清掉 protocol tests / TS builders / docs 中旧 import。同步加 8.6 / 8.7 全部测试。
6. **运行 `sui move test`** 全绿后，Move 工作交付完毕。
7. **DB schema reset + Prisma migration** — schema 改完跑 `prisma generate`，重置 dev DB（mainnet 数据已弃）。
8. **TS SDK 改造** — tx builders + hooks + routes 替换；ESLint rule 拦旧符号。
9. **前端 hooks / pages 替换** — soul detail / market list / paid_access 卡片全改。
10. **publish 新包** — multisig handoff 含 `KindAdminCap`，precheck 通过。
11. **smoke + bench** — 在 testnet 跑 mint → list → buy → grant → paid_access → seal_approve_public 全链路。

每步在 `tasks/todo.md` 内一一对应可勾选项。

## Risks

| 风险 | 缓解 |
|---|---|
| Move 编译失败：`KindDescriptor` 字段扩展导致 PTB 输入兼容断 | hard cut，不维护 ABI 兼容；新包发布即新 ABI |
| `seal_approve_content_public` 缺 enforce 让明文 blob 与 Seal blob 混淆 | `slot_read_mode_mask` 由 caller 传入并必须是 descriptor 子集；`seal_encrypted` 缓存在 slot；单一 PUBLIC slot 不走 Seal，public seal 入口 abort |
| initial content 绕过 OP_APPEND | 只有 SOUL_DOC/MEMORY 的 invariant append 可绕过；其他 initial entries 走 `append_initial_user_version` 并强制 `OP_APPEND` |
| memory name 分叉成多个 key | `content.move` 所有 MEMORY 路径统一断言 `name=="default"`，不只在 mint wrapper 检查 |
| paid_access per-kind 数据结构嵌套 Table 在 `record_purchase` 高并发下 gas 增加 | per-buyer per-kind 双层 Table，写入 O(1)；只在初次配置 kind 时多一次 add，可接受 |
| soul.md 进 SoulContent 后 mint TX 体积增加 | initial_content 已支持 `vector<InitialContentEntry>`；SOUL_DOC + MEMORY 各一条对体积影响 < 5% |
| 删除 seal_policy.move 影响合约外其他模块 | 全文已搜，仅 `protocol_tests.move` 与 web/seal helpers 依赖，全在 hard cut 范围 |
| Move 测试覆盖不充分被 user 拒收 | 8.1–8.7 矩阵共 50+ 测试用例，每入口正反双覆盖 |

## Acceptance（Spec 对照）

1. **soul.md 一经加入不可变** — `mint_*` 时 SOUL_DOC v0 由合约强制塞入；`append_version_as_owner(kind=SOUL_DOC)` abort `EOpNotAllowed`；`delete_version_as_owner(kind=SOUL_DOC)` abort `EOpNotAllowed`。✅
2. **memory.md 不可修改 / 可删除 / 可附加 / owner 或 owner 授权 agent 可读** — KIND_MEMORY 的 `op_mask = APPEND|DELETE|PURGE`；`read_mode_mask = OWNER|GRANT`（grant 即 owner 主动授权 agent）；所有路径强制 `name=="default"`。✅
3. **skills.zip 可附加 / 可修改（new version）/ 可删除 / owner 或 owner 授权 agent 可读** — KIND_SKILL 的 `op_mask = APPEND|DELETE|PURGE`；`read_mode_mask = OWNER|GRANT`（grant 即 owner 主动授权 agent）。✅
4. **sprite.zip / voice.zip 可附加 / 可修改 / 可删除 / 可选 owner / public / allowlist 可读** — KIND_SPRITE / KIND_AUDIO 的 `op_mask = APPEND|DELETE|PURGE|ACTIVE_BIND`；descriptor `read_mode_mask = OWNER|GRANT|PAID|PUBLIC`；每个 slot 通过 `slot_read_mode_mask` 在 descriptor 子集内选择实际读模式；paid_access per-kind 充当 allowlist 通道。✅
5. **未来内容类型由管理员注册并配置操作** — `register_kind` 接受 `op_mask` / `read_mode_mask` / `default_grant_scope_mask` 全部维度；`KindAdminCap` multisig 持有；register 后 immutable。✅
6. **所有 Move 变更都有 Move 测试** — 测试矩阵 8.1–8.7 共覆盖 5 个内置 kind × 4 op × 4 read mode + paid_access per-kind + mint invariants + 删除路径回归。✅

## Out of Scope

- `grant.move` 的 scope 增加新 bit（例如把 sprite / audio 拆开）。仍二选一 + SEAL/MEMORY，沿用 phase 1 决策。
- 旧 mainnet package 上数据的导出 / 用户回填工具。
- 第三方索引器：依然 post-TX direct write，不引入独立 indexer。
- Walrus 明文 blob 的 CDN / 缓存策略：D3 决策只到合约层 `seal_encrypted` 标记，前端按标记走 URL；CDN 由 web 层独立决定。
