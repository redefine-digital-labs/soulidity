# Typed-Content Nebula — Soulidity Content 抽象统一

## Context

用户观察到 `skill / sprite / voice` 三者在 CRUD 形态上完全同构（per-name 多 version、is_public 标志、Walrus blob、Seal document、owner / granted-agent 双轨写入），实际只是 metadata 的不同类型。当前 `move/soulidity/sources/skills.move` 和 `move/soulidity/sources/assets.move` 是**有意拷贝**（`docs/plans/2026-04-11-soul-assets-and-content-access-plan.md:96` 字面写的"与 skills.move 同构，新增 asset_type，不另起存储语义"），把 isomorphism 当作 Seal 域 / grant scope 的安全边界。

但用户的诉求是：

1. **不接受为 ABI 冻结让步**——直接改合约
2. **不接受硬编码 kind 枚举**——管理员要能后续通过合约调用注册新 kind（视频、文本提示、自定义资产类型……）
3. **顺便把 voice 客户端打通**——builder 已齐，hook/UI 缺失

这次落地的目标是把 `skills / assets / metadata::active_*` 三处合并到一个 **可扩展、运行时可注册** 的 typed-content 抽象，**硬切废弃** `skills.move` 和 `assets.move`（源代码直接删，不留 legacy 子目录、不留 dispatch、不留 308 重定向），让 voice 自然落进新框架。Memory 不并入（append-only、timestamp-keyed、无 version、无 delete，强行合会污染抽象）。

**用户约束**："不用考虑迁移，旧文件该删就删"——本计划按硬切语义执行：新包不包含 `skills.move` / `assets.move`；新前端不读旧 Prisma 表；旧 mainnet 包上的 `SoulSkills` / `SoulAssets` 对象继续在链上但**不在产品 UI 范围内**（Sui 不能删对象，但产品视角等于不存在）。

## Why This vs Status Quo

**质变维度（这次最大的收益）**：加新 metadata 类型从"发 Move 包 + 重审计 + multisig Cap handoff（数周）"变成"admin 一笔 TX 调 register_kind（数分钟）"。任何未来的 video / 3D / text-prompt / biometric 等需求都不再触发 ABI break。

**量化对比（基于 Phase 1 探索 + Plan 设计的实际数字）**：

| 维度 | 现状（2-sigs 落地后） | 统一后 |
|---|---|---|
| 加新 metadata 类型 | 一次完整 ABI break + 审计 | 一笔 admin TX |
| mint 入参 | 18 个 sprite/voice/skill 散参 | 1 个 `vector<InitialContentEntry>` |
| 总代码量 | ~2540 LOC（skills/assets Move + use-skills/use-assets + 两套 mirror） | ~1740 LOC |
| document-id 字节布局 | 两份独立实现，bug 要双修 | 单处 |
| voice 客户端 | builder 齐但 **无 hook、无 UI** | 与 sprite 对称、自然接通 |
| TS recovery state | 两份 ~100 LOC 几乎逐行复制 | 单份 generic helper |
| Seal 域 | `soul-skill:` + `soul-asset:` 两 prefix | `soul-content:` + kind 字节入布局（等价安全） |

**诚实成本**：

- 一次 mainnet 重发（**与 2-sigs runbook 合并就是同一次发包**，所以不增加发包次数）
- 2-3 周工程：Move 重写 + TS 合并 + Prisma 重置 + smoke 重跑 + testnet 7a → mainnet 7b 闭环（硬切比共存少 1 周 dispatch / 308 / legacy 收尾工作）
- 一次重审计预算
- **硬切代价**：现有 mainnet 包上的 `SoulSkills` / `SoulAssets` 对象、对应 `SoulSkillVersionRecord` / `SoulAssetVersionRecord` Prisma 行**全部从产品视角放弃**——链上对象 Sui 不能删，但 UI 不再展示，新前端只识别新 packageId 下的 Soul
- 重写引入新 bug 的可能（靠 165+ Move 测试 + ~1450 TS 测试兜底）

**ROI 判断**：统一只在"未来还会加新 metadata 类型"时是赚的。对应产品路线图：

- 路线图含 video / 3D / text-prompt / 任何新 kind → 立刻回本
- 永远只有 skill/sprite/audio → 纯技术债清理，~800 LOC + voice 接通 + 入参可读性，ROI 中等不亏

**不做这次的代价**：每加一个 kind 都要再发一次 Move 包；TS/API 重复以 30% 比例继续累积；voice 永远停在"builder 齐了但用户调不到"。

## Decision

**做一次性硬切 ABI break**，包含四件事一并完成：

1. 新增 `kind_registry.move` —— 管理员持 `KindAdminCap`，可在 mainnet 上 `register_kind(name, has_active_binding, requires_download_policy, default_grant_scope)`
2. 新增 `content.move` —— `SoulContent` 单根 + per-version `kind: u32` 鉴别
3. 修改 `metadata.move` + `market.move` —— `ActiveBinding` 通用化、mint 入参收敛为 `vector<InitialContentEntry>`、新增 `finalize_soul_content`，删除 `set_active_sprite/voice` 等老入口
4. **直接删除** `skills.move` + `assets.move` 源文件、对应 TS builders、hooks、API routes、Prisma 表

新包发布后产品视角只认得 `SoulContent`；旧 mainnet 包对象不在 UI 范围内。

**与当前 2-sigs runbook（uncommitted 6 commits）的关系**：80% 的 2-sigs 工作在统一后仍然有效（mint 返回 SoulState、list 返回 SoulListing、create_collection 返回 SoulCollection、finalize wrapper 模式、batch builder 形态、recovery v12、smoke 谐振、bench 脚本）。**需要替换的部分**：`init_skills_and_append_as_owner` / `init_assets_and_append_sprite_as_owner` / `finalize_soul_skills` / `finalize_soul_assets` / `buildInitAndBatchAppendSkillsTx` / `buildInitAndBatchAppendAssetsTx` 全部删除，统一替换为 `content::append_version_as_owner` 系列 + `finalize_soul_content`。Acceptance 矩阵的 "First skills/assets root + N versions: 2 sigs" 行变成 "First content versions of any kind: 2 sigs"。

## Architecture

### 1. `kind_registry.move`（新）

```move
module soulidity::kind_registry;

const EKindNameEmpty: u64 = 1;
const EKindNameTaken: u64 = 2;
const EKindNotFound: u64 = 3;
const EKindDeprecated: u64 = 4;

public struct KindRegistry has key {
    id: UID,
    next_kind: u32,                    // monotonic, starts at 16 (0..15 reserved for built-ins)
    kinds: table::Table<u32, KindDescriptor>,
    name_to_kind: table::Table<String, u32>,
}

public struct KindDescriptor has copy, drop, store {
    kind: u32,                          // stable u32, never renumbered
    name: String,                       // unique, e.g. "skill", "sprite", "audio", "model3d"
    has_active_binding: bool,           // sprite/voice = true; skill = false
    requires_download_policy: bool,     // sprite/voice/audio = true; skill = false
    default_grant_scope_bit: u64,       // SCOPE_SKILLS=4 / SCOPE_ASSETS=8 / future bits
    deprecated: bool,                    // soft-disable for new appends; reads still work
}

public struct KindAdminCap has key, store { id: UID }

// init() 在 publish 时预注册三个内置 kind:
//   0 = "skill"  (no active binding, no download policy, scope=SCOPE_SKILLS)
//   1 = "sprite" (active binding, download policy, scope=SCOPE_ASSETS)
//   2 = "audio"  (active binding, download policy, scope=SCOPE_ASSETS)
// next_kind 从 16 起，admin 注册的 kind 从 16 开始排号

public fun register_kind(
    registry: &mut KindRegistry,
    cap: &KindAdminCap,
    name: String,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_bit: u64,
    ctx: &mut TxContext,
): u32

public fun deprecate_kind(registry, cap, kind): ()
public fun reenable_kind(registry, cap, kind): ()

public fun has_kind(registry: &KindRegistry, kind: u32): bool
public fun describe(registry: &KindRegistry, kind: u32): &KindDescriptor
public fun lookup_by_name(registry: &KindRegistry, name: &String): u32
```

`KindAdminCap` 用 multisig 持有（与现有 `MarketUpgradeState.tracked_upgrade_cap_id` 同一组多签）。

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

public struct ContentKey has copy, drop, store { kind: u32, name: String }
public struct ContentBlobKey has copy, drop, store { kind: u32, name: String, version_index: u64 }

public struct ContentSlot has copy, drop, store {
    kind: u32,
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    purged: bool,
    download_policy: u8,                // 0 if !requires_download_policy
    created_at_ms: u64,
}

public struct SoulContent has key {
    id: UID,
    soul_id: ID,
    items: table::Table<ContentKey, vector<ContentSlot>>,
    // counts indexed by kind (用 Table<u32, u64> 而不是固定字段，对未来 kind 友好)
    count_by_kind: table::Table<u32, u64>,
}

// Mint 内部 always create+share。每个 Soul 必有 SoulContent 共享对象。
public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulContent
public(package) fun share_content(content: SoulContent)

// 公共写入入口 (owner / granted-agent):
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
    content, state, registry, grant: &SoulGrant, kind, name, is_public, download_policy, blob, clock, ctx
): u64

public fun delete_version_as_owner(
    content: &mut SoulContent,
    metadata: &SoulMetadata,            // for active-binding check
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
)

public fun delete_version_as_granted_agent(...)
public fun purge_deleted_version_as_owner(...)

// Seal 审批入口（取代 skills::seal_approve_* 与 assets::seal_approve_*）:
entry fun seal_approve_content_owner(
    id: vector<u8>, state, content, kind, name, version_index, ctx
)
entry fun seal_approve_content_granted_agent(
    id, state, content, grant, kind, name, version_index, clock, ctx
)
```

**Delete-while-active 保护**：`delete_version_as_owner` 内部检查 `registry.describe(kind).has_active_binding`；为真则调用 `metadata::assert_version_not_active(metadata, kind, name, version_index)`。Skills 这类无 active binding 的 kind 跳过这一步，但 metadata 参数仍然必传（统一 ABI）。

**Document ID 字节布局**（`soul-content:` 取代 `soul-skill:` / `soul-asset:`）：

```
"soul-content:"               (13 bytes)
+ doc_id_version (1)           u8 = 1
+ kind_be (4)                  u32 big-endian
+ content_id (32)              SoulContent UID 字节
+ name_utf8 (var)              kind 内的 name
+ 0x00 (1)                     separator
+ version_index_be (8)
+ nonce (16)
                               total = 75 + |name|
```

`kind` 入字节布局，确保 sprite-name="intro" 与 skill-name="intro" 即使 content_id+version 相同也产生不同 doc id。

### 3. `metadata.move`（修改）

```move
public struct ActiveBinding has copy, drop, store {
    kind: u32,                  // 通用化
    name: String,
    version_index: u64,
    download_policy: u8,
}

public struct SoulMetadata has key {
    id: UID,
    soul_id: ID,
    active: table::Table<u32, ActiveBinding>,    // 替换 active_sprite/active_voice
    ext: table::Table<String, vector<u8>>,
}

public(package) fun set_active(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    binding: ActiveBinding,
    ctx: &TxContext,
)
public(package) fun clear_active(metadata, state, kind: u32, ctx: &TxContext)
public fun is_active(metadata: &SoulMetadata, kind: u32, name: &String, version_index: u64): bool
public fun assert_version_not_active(metadata, kind, name, version_index)
```

老的 `set_active_sprite / set_active_voice / clear_active_sprite / clear_active_voice` 入口**直接删除**，前端调用方全部改用 `metadata::set_active(kind, ...)` / `metadata::clear_active(kind)`。

### 4. `market.move`（修改）

mint 入参精简（当前 ~18 个 sprite/voice/skill 相关参数 → 1 个 vector）：

```move
public struct InitialContentEntry has copy, drop, store {
    kind: u32,
    name: String,
    is_public: bool,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
}

public fun mint_native_in_personal_kiosk(
    config, registry: &KindRegistry, kind_registry: &KindRegistry,
    /* ... 现有不变参数 ... */,
    initial_content: vector<InitialContentEntry>,    // 替代 skills_blob / asset_blob / asset_type / initial_*_binding
    /* ... */
): SoulState
```

Mint 内部：
1. 先 `content::create(soul_id)` 拿到空 `SoulContent`
2. 遍历 `initial_content`，每条 `content::append_version_as_owner` + 视 `set_active` 调 `metadata::set_active`
3. 最后 `content::share_content(content)` + 现有的 metadata/memory share

Mint 出口仍然返回 `SoulState`（与 2-sigs runbook 兼容）；`finalize_soul_state` 不变。

新 finalize wrapper：
```move
public fun finalize_soul_content(content: SoulContent) {
    content::share_content(content)
}
```

`finalize_soul_skills` / `finalize_soul_assets` / `init_skills_and_append_as_owner` / `init_assets_and_append_sprite_as_owner` / `set_active_sprite` / `set_active_voice` / `clear_active_sprite` / `clear_active_voice` **直接删除**，无兼容 wrapper。

## 硬切策略 — 不留兼容尾巴

新包发布后：

| 现有产物 | 处理 |
|---|---|
| `move/soulidity/sources/skills.move` 源文件 | **删** |
| `move/soulidity/sources/assets.move` 源文件 | **删** |
| 链上旧 `SoulSkills` / `SoulAssets` 共享对象（旧 mint 出来的） | Sui 不能删；产品 UI 不展示；新前端只识别新 packageId 下 Soul |
| `web/lib/soulidity/tx/skills.ts` / `assets.ts` | **删** |
| `web/lib/hooks/use-skills.ts` / `use-assets.ts` | **删** |
| `web/app/api/souls/[id]/skills/**` | **删**，无重定向 |
| `web/app/api/souls/[id]/assets/**` | **删**，无重定向 |
| Prisma `SoulSkillVersionRecord` / `SoulAssetVersionRecord` 模型 | **删**，配套 migration drop 表 |
| `metadata::active_sprite` / `active_voice` 字段 | **删字段**，全部走新 `active: Table<u32, ActiveBinding>` |

无 `legacy/` 子目录、无 `_legacy` 后缀、无 308 重定向、无 packageId dispatch。新包就是唯一的世界。

## Sequencing

**推荐路径：把 2-sigs runbook 的 uncommitted 6 commits 改造后再 land**

理由：
- 2-sigs 已经修过 mint/list/create_collection 的 ABI，再叠一次同 release 的 typed-content ABI 是同一笔 mainnet 发布
- 否则 R 先把 `init_skills_and_append_as_owner` / `finalize_soul_skills` 推上去，R+1 又删，纯白工
- 加一次 ABI break 本身就比拆两次 release 成本低（一次审计、一次重发、一次 multisig handoff）

具体改造（在当前 uncommitted changeset 上施工）：

1. **删** `move/soulidity/sources/skills.move` 与 `assets.move`（源代码删除，不留 legacy 副本）
2. **新增** `move/soulidity/sources/kind_registry.move` + `content.move`
3. **改** `metadata.move`：`ActiveBinding` 通用化、`active_sprite` / `active_voice` 字段删除、改用 `active: Table<u32, ActiveBinding>`
4. **改** `market.move`：mint 入参收敛、删 `init_skills*` / `init_assets*` / `set_active_sprite` / `set_active_voice` / `clear_active_*` / `finalize_soul_skills` / `finalize_soul_assets`、加 `finalize_soul_content`
5. **重写** `protocol_tests.move`：删除所有引用 skills.move / assets.move 的测试；新增 ~9 个 content + registry 参数化测试
6. **TS 层**：删 `tx/skills.ts` + `tx/assets.ts`，新建 `tx/content.ts` + `tx/kind-registry.ts`
7. **Hooks**：删 `use-skills.ts` + `use-assets.ts`，新建 `use-content.ts`，输出 `{ skill, sprite, voice, custom(kind) }` 命名空间；voice 走这一步接通
8. **Routes**：删 `/api/souls/[id]/skills/**` + `/api/souls/[id]/assets/**`（**无 308 重定向**），新建 `/api/souls/[id]/content/route.ts`
9. **Prisma**：drop `SoulSkillVersionRecord` 和 `SoulAssetVersionRecord` 表（migration 用 `DROP TABLE`）；新增 `SoulContentVersionRecord(soulOnChainId, contentOnChainId, kind, kindName, name, versionIndex, ...)`
10. **Smoke harness**：acceptance 矩阵 kind-参数化，覆盖 skill / sprite / audio / 一个 admin 注册的 custom kind

## TS / Hook / API 影响

### `web/lib/soulidity/tx/content.ts`（新）

```typescript
export function buildAppendContentBatchTx({
  stateObjectId, contentObjectId, metadataObjectId, kindRegistryId,
  versions: ReadonlyArray<{
    kind: number,                         // u32, from kind registry
    name: string,
    visibility: 'public' | 'private',
    blobObjectId: string,
    downloadPolicy?: SoulDownloadPolicy,  // 当 kind 的 requires_download_policy 时必填
    setActive?: boolean,
  }>,
}): Transaction
```

替代 `buildInitAndBatchAppendSkillsTx` 和 `buildInitAndBatchAppendAssetsTx`。

### `web/lib/soulidity/tx/kind-registry.ts`（新）

```typescript
export function buildRegisterKindTx({ registryId, kindAdminCapId, name, hasActiveBinding, requiresDownloadPolicy, defaultGrantScopeBit }): Transaction
export function buildDeprecateKindTx({ registryId, kindAdminCapId, kind }): Transaction
```

仅 admin 工具使用。

### `web/lib/hooks/use-content.ts`（新，合并 use-skills + use-assets）

```typescript
export function useContent(soul: SoulAssetDetail | null) {
  return {
    skill:  { versions, append, appendBatch, delete, open, pending },
    sprite: { versions, append, appendBatch, delete, setActive, clearActive, pending },
    voice:  { versions, append, appendBatch, delete, setActive, clearActive, pending },
    custom: (kind: number) => { versions, append, ... },
    isLoading, error,
  }
}
```

复用 `web/lib/soulidity/recovery/typed-append-recovery.ts`（per-kind storage prefix）。

### `web/app/api/souls/[id]/content/route.ts`（新）

POST handler 用 `extractAllContentVersionAppendedEvents` + 一次 Prisma upsert 写 N 行 `SoulContentVersionRecord`。`/skills` 与 `/assets` 旧 URL **直接删除**，不做 308 重定向——任何还引用旧 URL 的客户端会得到 404，强制升级。

### Prisma schema

```prisma
model SoulContentVersionRecord {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId   String    @map("soul_on_chain_id")
  contentOnChainId String   @map("content_on_chain_id")
  kind            Int       // u32 from kind registry
  kindName        String    @map("kind_name")
  name            String
  versionIndex    Int       @map("version_index")
  visibility      String
  deleted         Boolean   @default(false)
  purged          Boolean   @default(false)
  blobObjectId    String    @map("blob_object_id")
  blobId          String?   @map("blob_id")
  downloadPolicy  String?   @map("download_policy")
  sealSidecar     Json?     @map("seal_sidecar")
  createdAtMs     BigInt    @map("created_at_ms")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @default(now()) @updatedAt @map("updated_at")

  @@unique([contentOnChainId, kind, name, versionIndex], map: "soul_content_version_unique")
  @@index([soulOnChainId, kind, name, versionIndex(sort: Desc)])
}
```

`SoulSkillVersionRecord` 和 `SoulAssetVersionRecord` 在 migration 里 `DROP TABLE` —— 不重命名、不保留只读副本。Prisma migration 名字 `drop_skills_assets_replace_with_content`。

## Test Surface

### Move (`protocol_tests.move`)

- `test_kind_registry_register_and_lookup` — admin 注册 + 重名 abort + lookup_by_name
- `test_kind_registry_only_admin_can_register` — 没 cap 拒绝
- `test_content_kind_skill_append_delete_purge` — kind=0 完整流程
- `test_content_kind_sprite_with_active_binding` — kind=1 + set_active + delete-while-active 拒绝
- `test_content_kind_audio` — kind=2 同上
- `test_content_custom_kind_registered_at_runtime` — admin 注册 kind=16，后续 mint+append+seal_approve 全部走通
- `test_content_cross_kind_doc_id_isolation` — 同 (content_id, name, version) 的 sprite vs skill 字节布局不冲突
- `test_content_delete_requires_metadata_check_only_when_kind_has_active_binding` — skill 跳过 active 检查，sprite 不跳过
- `test_mint_with_mixed_kinds` — 一个 PTB 内 mint 时挂 1 skill + 1 sprite + 1 audio，全部进同一 SoulContent
- `test_deprecated_kind_blocks_new_appends_but_allows_reads` — admin 调 deprecate_kind 之后新 append 拒绝，已存在的 version 仍可 seal_approve

总目标：删除约 60+ 个旧 skills/assets 测试，新增 ~10 个 content/registry 测试，net 测试数从 149 → ~100，全绿。

### TS 测试

- `tests/new-web/soulidity-content-builder.test.ts` 替换 skills/assets builder 测试
- `tests/new-web/kind-registry-builder.test.ts` 新增
- `tests/new-web/content-fast-path-regressions.test.ts` 替换 collection-fast-path-regressions（保留同等覆盖：dry-run caps、fastPathAttempt、PTB1 finality、v12 → v13 recovery 迁移）
- 删除所有引用 `buildAppendSkillVersionTx` / `buildAppendAssetVersionTx` / `buildInitAndBatchAppendSkillsTx` / `buildInitAndBatchAppendAssetsTx` 的测试（约 30+ 个）
- 删除所有引用 `useSkills` / `useAssets` 的测试

### 集成测试

- 改 `scripts/smoke-soulidity.ts`：新增 acceptance 行 "first content of kind=skill / sprite / audio / custom-16: 2 sigs"；保留 "12-soul collection fast-path: 2 sigs" 行（content abstraction 不影响 collection PTB）
- 改 `scripts/bench-fast-path.ts`：测 mint+append-content-batch 的 PTB 字节，确认仍在 96000 字节 / 5 SUI gas 上限内

## Verification Commands

```bash
sui move build --path move/soulidity
sui move test  --path move/soulidity                        # 期望 ~165 全绿
npm test                                                     # 现 1406 → 预计 ~1450
npm run typecheck
npm --prefix web run lint
npm run build:web:production-env

NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/smoke-soulidity.ts        # 完整 acceptance 矩阵
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/bench-fast-path.ts        # 字节/gas 在 caps 之内

# 然后是 mainnet stage 7b 流程，与现 runbook §7 完全一致
NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/precheck-live-soulidity-collections.ts
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --mainnet-e2e
NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/smoke-soulidity.ts        # 全绿后才 Cap handoff
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --resume-cap-transfer-from-manifest --transfer-caps-to=<multisig>
```

## Critical Files

**新增**
- `move/soulidity/sources/kind_registry.move`
- `move/soulidity/sources/content.move`
- `web/lib/soulidity/tx/content.ts`
- `web/lib/soulidity/tx/kind-registry.ts`
- `web/lib/hooks/use-content.ts`
- `web/lib/soulidity/recovery/typed-append-recovery.ts`
- `web/app/api/souls/[id]/content/route.ts`
- `tests/new-web/soulidity-content-builder.test.ts`
- `tests/new-web/kind-registry-builder.test.ts`
- `tests/new-web/content-fast-path-regressions.test.ts`

**改写**
- `move/soulidity/sources/market.move`（mint 入参 / finalize wrapper / 删 init_skills+init_assets+set_active_*+clear_active_*+finalize_soul_skills+finalize_soul_assets）
- `move/soulidity/sources/metadata.move`（ActiveBinding 通用化、active_sprite/active_voice 字段删）
- `move/soulidity/sources/protocol_tests.move`（重写为 content 参数化测试）
- `web/lib/soulidity/events.ts`（新增 `extractAllContentVersionAppendedEvents`，删 skill/asset 专用 extractor）
- `web/lib/soulidity/mirror/upsert-content.ts`（新增，替代 upsert-skill + upsert-asset）
- `web/lib/hooks/use-publish.ts`（mint 入参从 skills_blob/asset_blob 改成 vector<InitialContentEntry>）
- `web/lib/hooks/use-collection-publish.ts`（同上 + recovery v12 → v13 迁移）
- `prisma/schema.prisma`（`SoulContentVersionRecord` 新增、`SoulSkillVersionRecord` + `SoulAssetVersionRecord` **DROP TABLE**）
- `scripts/smoke-soulidity.ts` / `scripts/bench-fast-path.ts`（acceptance 矩阵 kind-参数化）
- `web/lib/soulidity/deployment-manifest.json`（新 packageId，无 dispatch 字段）

**直接删除（无 legacy 副本、无重定向、无 _legacy 后缀）**
- `move/soulidity/sources/skills.move`
- `move/soulidity/sources/assets.move`
- `web/lib/soulidity/tx/skills.ts`
- `web/lib/soulidity/tx/assets.ts`
- `web/lib/hooks/use-skills.ts`
- `web/lib/hooks/use-assets.ts`
- `web/app/api/souls/[id]/skills/**`（整个目录）
- `web/app/api/souls/[id]/assets/**`（整个目录）
- `web/lib/soulidity/mirror/upsert-skill.ts`
- `web/lib/soulidity/mirror/upsert-asset.ts`
- 所有 `tests/new-web/*skills*.test.ts` / `*assets*.test.ts` 中已经被新测试替换的旧测试文件

## Feature Parity — 现有 skill/sprite/voice 操作 1:1 覆盖核对

### Skills（10 项）

| 现状 | 统一后 |
|---|---|
| mint founding skills_blob | `mint(initial_content: vec[InitialContentEntry{kind=KIND_SKILL}])` |
| mint 后 `init_skills_and_append_as_owner` + first version | `content::append_version_as_owner(kind=KIND_SKILL)`（无 init 分支） |
| `skills::append_version_as_owner` | `content::append_version_as_owner(kind=KIND_SKILL, download_policy=0)` |
| `skills::append_version_as_granted_agent` | `content::append_version_as_granted_agent(kind=KIND_SKILL)` |
| `skills::delete_version_as_owner` | `content::delete_version_as_owner(kind=KIND_SKILL)`（KindDescriptor.has_active_binding=false → 跳过 active 检查） |
| `skills::delete_version_as_granted_agent` | `content::delete_version_as_granted_agent` |
| `skills::purge_deleted_version_as_owner` | `content::purge_deleted_version_as_owner` |
| `seal_approve_private_read_owner` | `content::seal_approve_content_owner(kind=KIND_SKILL)` |
| `seal_approve_private_read_granted_agent` | `content::seal_approve_content_granted_agent` |
| Read getters（skill_count / contains_skill / version_count / blob_object_id_for / version_is_public / version_is_deleted / version_is_purged / version_created_at_ms） | `content::*_for(kind, name, ...)` 参数化版本 |

### Sprite（13 项）

| 现状 | 统一后 |
|---|---|
| mint asset_blob asset_type=0 | `InitialContentEntry{kind=KIND_SPRITE, set_active=true}` |
| mint 后 `init_assets_and_append_sprite_as_owner` | `content::append_version_as_owner(kind=KIND_SPRITE)` |
| `assets::append_version_as_owner(asset_type=0)` | `content::append_version_as_owner(kind=KIND_SPRITE, download_policy)` |
| `assets::append_version_as_granted_agent` | `content::append_version_as_granted_agent` |
| `assets::delete_version_as_owner` + `metadata::assert_asset_version_not_active` | `content::delete_version_as_owner` 内部按 `KIND_SPRITE.has_active_binding=true` 自动调 `metadata::assert_version_not_active` |
| `assets::delete_version_as_granted_agent` | 同上 |
| `assets::purge_deleted_version_as_owner` | `content::purge_deleted_version_as_owner` |
| `seal_approve_asset_read_owner` | `content::seal_approve_content_owner(kind=KIND_SPRITE)` |
| `seal_approve_asset_read_granted_agent` | `content::seal_approve_content_granted_agent` |
| `market::set_active_sprite` | `metadata::set_active(ActiveBinding{kind=KIND_SPRITE,...})` |
| `market::clear_active_sprite` | `metadata::clear_active(kind=KIND_SPRITE)` |
| `metadata::upsert_metadata_blob`（sprite_config_json / sprite_mood_map_json） | **保留原样**（metadata::ext 不动） |
| `metadata::delete_metadata_blob` | 同上保留 |

### Voice（这次新接通）

| 操作 | 现状 | 新设计 |
|---|---|---|
| append voice version | builder 齐但无 hook | `use-content.voice.append/appendBatch` |
| set_active_voice | builder 齐但无 hook | `use-content.voice.setActive`（走 `metadata::set_active(KIND_AUDIO)`）|
| clear_active_voice | builder 齐但无 hook | `use-content.voice.clearActive` |
| delete voice version | 走通用 asset，无 UI | `content::delete_version_as_owner(kind=KIND_AUDIO)`（自动 active 检查） |

### 协议级不变量（继承不丢）

- 可见性 immutable（要改只能 delete + 重 append）
- memory 不可删、append-only
- Soul 不可 burn

### "看似丢失"实为简化项

- `EAssetsRootAlreadyExists` / `ESkillsRootAlreadyExists` 错误码消失（因为 SoulContent always 在 mint 创建，"root already exists" 边界条件不再存在）
- `init_skills_and_append_as_owner` / `init_assets_and_append_sprite_as_owner` 入口消失（统一走同一个 append 入口）
- 客户端 EAssetsRootAlreadyExists 重试 guard 不再需要（race 不存在）

## Out of Scope（明确不做）

- **Memory 不并入**：append-only / timestamp-keyed / 无 version / 无 delete，强行合会污染 typed-content 抽象。`memory.move` 保持现状。
- **Grant scope 不重设计**：新 kind 通过 `KindDescriptor.default_grant_scope_bit` 复用现有 `SCOPE_SKILLS / SCOPE_ASSETS` 位。如果以后某个 kind 需要独立 scope bit（譬如 KIND_BIOMETRIC），那是后续 ABI 工作。
- **`metadata::ext` 不动**：通用 metadata blob 表与 typed content 是不同关注点。
- **`SoulMemory` 不接入 use-content**：保留单独的 hook 缺口工单（`use-memory.ts`），与本计划解耦。
