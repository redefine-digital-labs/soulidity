# Soulidity Move 合约安全审计报告

**审计日期**: 2026-05-04
**审计员**: Claude (web3-audit-sui-scanner skill)
**二次复核**: Codex，2026-05-04；`UpgradeCap` / Admin Cap 集中化项按用户确认排除，本轮不作为待修复问题。
**范围**: `move/soulidity/sources/` （Phase 2 typed-content nebula 重构后）
**模块**: soul, grant, kind_registry, content (新), paid_access (新), collection, market

---

## 总评（先结论）

整体评估：中等成熟度，结构清晰。架构正确实施了多个核心系统不变量（owner-epoch、单 SoulState、单 SoulContent、SoulPaidAccessList 1:1、seal doc ID 长度精确匹配等）。**未发现可直接造成资产盗失或权限提升的 Critical 漏洞**。

排除后续转多签处理的 Cap 治理项后，主要风险集中在：

- **1 个 Medium** — paid access 收款后，owner 仍可无退款撤销访问或删除/purge 相关内容
- **3 个 Low** — paid_access 外层空表残留、active solo listing 可被 collection 绑定变成不可购买、import `origin_ref` 未验证
- **1 个 Accepted Design** — personal-join 支持任意当前拥有的 Sui NFT；这与产品文档一致，不按漏洞处理

---

## Critical 检查项 — 全部通过

| 检查项 | 状态 | 说明 |
|---|---|---|
| Shared object 无 auth 修改 | ✓ | 所有 `&mut` shared 修改路径均有 cap 或 sender 检查 |
| OTW 模式正确 | ✓ | `SOUL`/`COLLECTION`/`MARKET` 均符合 OTW 规则 |
| Witness rule 不可绕过 | ✓ | `SoulMarketProof`/`CollectionMarketProof` 模块私有，PurchaseCap 仅市场可访问 |
| Seal 文档 ID 精确长度匹配 | ✓ | `assert!(id.length() == expected_len)` + 逐字节比对 |
| Owner-epoch 绑定 grant/paid 失效 | ✓ | rotate_owner 后所有 grant/paid 条目自动失效 |
| 单 SoulContent / SoulPaidAccessList 强绑定 | ✓ | `set_content_id`/`set_access_list_id` 单次绑定保护 |
| 重复 mint 防护（join key） | ✓ | `JoinedSourceKey` df 防止同一 source 重复 join |
| 单 personal kiosk 注册 | ✓ | 注册项 1 owner 1 kiosk，rebind 需空 kiosk |
| TransferPolicy 三规则齐全 | ✓ | kiosk_lock + personal_kiosk + witness 三层守门 |
| 支付金额精确等于报价 | ✓ | `payment.value() == total` 严格相等 |
| Coin split 不会下溢 | ✓ | `combined_bps <= MAX_BPS` + total = price + sum(fees) 数学保证 |
| u128 quote 防溢出 | ✓ | `assert!(total <= MAX_U64_AS_U128)` |

---

## 已排除项 #1 — High：UpgradeCap 与 Admin Cap 集中化风险

**严重度**: High（治理风险；本轮不处理，后续转多签）
**类别**: 升级安全 / 治理
**模块**: market, kind_registry
**二次复核结论**: 成立，但用户已确认后续交给多签承接；不计入本轮待修复发现。

### 描述

3 个 Cap 在 init 时直接转给 deployer EOA：

```move
// market.move:1831
transfer::transfer(admin_cap, admin);  // MarketAdminCap → deployer
// kind_registry.move:281
transfer::transfer(admin_cap, ctx.sender());  // KindAdminCap → deployer
```

外加 Sui publish 自动产生的 `UpgradeCap` 同样落在 deployer 地址。

### 影响

如果 deployer 私钥泄漏：

- `MarketAdminCap` 可：
  1. 改 fee_recipient → 抽走未来手续费
  2. `paused=true` 永久 DoS 市场
  3. `platform_fee_bps=10000` 让所有 listing 因 combined_bps 超限无法成交
- `KindAdminCap` 可：批量 deprecate kinds → 阻断新 append（旧 slot 因缓存仍可读，但用户无法上传新内容）
- `UpgradeCap` 可：替换合约逻辑 → 完全控制协议

**注意**：admin 不能直接盗 Soul / 改 ownership / 改内容，攻击面有限于平台级 DoS 和未来手续费分流。

### 推荐修复

部署 mainnet 前：

1. `package::make_immutable(upgrade_cap)` 或转给 Multisig
2. `MarketAdminCap` / `KindAdminCap` 转给 Multisig（建议 3-of-5）
3. `soul_policy_cap` / `collection_policy_cap` 同样转 Multisig（控制 TransferPolicy 规则增删）
4. CLAUDE.md `# System Invariants` 增加一条："admin caps must be held by multisig"

---

## 发现 #2 — Medium：paid access 收款后仍可撤销访问或删除内容（"访问 rug"）

**严重度**: Medium
**类别**: 经济安全 / 信任边界
**模块**: content, paid_access

### 描述

`SoulPaidAccessList.kind_configs` 按 **kind 级**收费，而内容是 **slot 级**。买家购买 `kind=KIND_SPRITE` 的访问后：

```move
// paid_access.move:510
public fun revoke_access(...)  // owner 可删除 buyer 的 kind entry，无退款
// content.move:647
public fun delete_version_as_owner(...)  // owner 软删任意 slot
// content.move:722
public fun purge_deleted_version_as_owner(...)  // owner 永久销毁 Walrus blob
```

owner 可在收款后：

1. 直接 `revoke_access` 删除 buyer 的 kind entry，协议不退款；
2. 或删除/purge 该 kind 下 buyer 想访问的 slot。若 buyer 的 `KindPaidEntry` 仍存在（epoch 一致、未到期），`paid_access::has_access` 仍可返回 true，但 `seal_approve_content_paid_access` 会先经 `content::assert_valid_content_seal_request` 在 `assert!(!slot.deleted, EVersionDeleted)` / `assert!(!slot.purged, EVersionPurged)` 阶段失败。

内置可付费 kind 主要是 `SPRITE` / `AUDIO`，active binding 会阻止直接删除当前 active version；但 owner 可以先清空/切换 active binding，再删除旧版本。因此如果产品承诺的是“购买后在期限内持续可读”，当前链上 contract 没有强约束。

### PoC 流程

```
1. seller 上传 popular_sprite (kind=SPRITE, name="hero", v0)
2. seller 配置 paid_access kind=SPRITE, price=10 USDC
3. buyer 购买 → SoulPaidAccessKindConfigured + SoulPaidAccessGranted 事件
4. seller 收款 ✓
5. seller 调 revoke_access(buyer, SPRITE)；或清/换 active 后调 delete_version_as_owner(SPRITE, "hero", 0)
6. 如走删除路径，seller 再调 purge_deleted_version_as_owner → blob::burn → Walrus blob 永久丢失
7. buyer 调 seal_approve → 失败（entry 缺失，或 slot.deleted/slot.purged）
8. buyer 已付款，无法获得任何内容
```

### 影响

- 链上无追索机制，所有退款须在协议外
- 没有触发的事件能让 buyer 在购买时识别风险

### 推荐修复（取决于产品承诺）

如果 paid access 是“可撤销订阅/当前内容访问权”，则这是产品信任边界：购买页、事件索引和资源页必须明确标成 owner 可撤销、内容可更新/删除，避免用户理解成不可撤销许可证。

如果 paid access 是“期限内可持续读取的购买权益”，需要协议级修改：

- `KindPaidEntry` 增加 purchase provenance（例如 `price_paid_atomic` / `is_paid_purchase`），`revoke_access` 不允许无退款撤销 paid purchase，或必须走显式 refund rail。
- 将 paid access 从 kind 级改为 slot/version 级 receipt：`(kind, name, version_index)` 进入购买记录，sold slot 在 receipt 有效期内禁止 delete/purge。
- 因为 Sui `Table` 不可枚举，不能靠“遍历 `entries`”实现守卫。若要做删除锁，必须维护可按 kind/slot 查询的计数或索引，并在 purchase / revoke / cleanup / expiry cleanup 路径同步更新。
- 加入退款托管：owner 收款先进入 escrow，购后 N 天或访问窗口结束后释放。

短期至少加链上事件或 mirror 标记，让 buyer 索引能监控付费 kind 对应内容被删除/purge。

---

## 发现 #3 — Low：`paid_access::entries[buyer]` 外层空表残留 — RESOLVED (second-pass 2026-05-04)

**严重度**: Low（存储泄漏，无安全风险）
**类别**: 资源管理
**模块**: paid_access
**修复证据**: `paid_access.move:587` `drop_empty_buyer_row` 实现，从 `revoke_access:536` 与 `cleanup_stale_entries:576` 调用。详见文末 second-pass 纪要。

### 描述

`paid_access.move:67`:

```move
entries: Table<address, Table<u32, KindPaidEntry>>,
```

每位买家首次购买时延迟创建 `Table<u32, KindPaidEntry>`：

```move
// paid_access.move:386
if (!paid_access_list.entries.contains(buyer)) {
    paid_access_list.entries.add(buyer, table::new<u32, KindPaidEntry>(ctx));
};
```

但 `cleanup_stale_entries`、`revoke_access` 仅删 inner kind entry，**从不删除空的外层 `entries[addr]` 行**。一个长寿 Soul 的买家集合会随时间无限增长。

### 影响

- 每位历史买家占用一行 + 一个空 sub-table
- 无法回收 Sui storage rebate
- 不影响 `has_access` 正确性，也不会导致全表遍历型 DoS，因为读路径按 `addr` / `kind` 定点查询

### 推荐修复

`revoke_access` 与 `cleanup_stale_entries` 在删除 inner entry 后检查 inner table 是否为空；为空时把 outer row remove 出来并 `table::destroy_empty(inner)`。Sui `Table` 有 `is_empty` / `destroy_empty`，但要注意先结束对 inner table 的 mutable borrow，再 remove outer row。

```move
{
    let by_kind = paid_access_list.entries.borrow_mut(addr);
    if (by_kind.contains(kind)) {
        let entry = &by_kind[kind];
        if (entry.ownership_epoch_snapshot != current_epoch) {
            let _ = by_kind.remove(kind);
        };
    };
};
if (paid_access_list.entries.contains(addr)) {
    let by_kind = paid_access_list.entries.borrow(addr);
    let empty = by_kind.is_empty();
    if (empty) {
        let inner = paid_access_list.entries.remove(addr);
        table::destroy_empty(inner);
    };
}
```

---

## 发现 #4 — Low：solo listing 后绑定 Collection 会使 active listing 不可购买 — RESOLVED (second-pass 2026-05-04)

**严重度**: Low（UX/liveness bug，无资产损失；卖家可 cancel 后重挂）
**类别**: 业务逻辑
**模块**: market, collection
**修复证据**: `soul.move:81` 增 `is_listed` 字段；`market.move:833/888/917/1704` 在 list/cancel/buy 各路径调 `set_listed`；`collection.move:193` `assert!(!soul::is_listed(state), ESoulCurrentlyListed)`。详见文末 second-pass 纪要。

### 描述

`list_soul_fixed_price`（独立路径）断言 `state.collection_id.is_none()` 才能上架。但上架后，所有者仍可调 `collection::add_soul` 把 Soul 加入 collection（`add_soul` 不检查 listing 状态）：

```move
// collection.move:178
public fun add_soul(
    collection: &mut SoulCollection,
    state: &mut SoulState,
    ctx: &TxContext,
) {
    assert!(collection.creator == ctx.sender(), ENotCollectionCreator);
    assert!(soul::state_creator(state) == collection.creator, ECreatorMismatch);
    soul::assert_owner(state, ctx.sender());
    // 没检查是否有 listing
    ...
    soul::bind_collection(state, object::id(collection));
}
```

绑定后：

- `buy_soul_fixed_price`（solo path）→ `assert!(soul::collection_id(state).is_none())` **失败**
- `buy_soul_fixed_price_with_collection` → `assert!(listing.collection_id.contains(&collection_id))` **失败**（listing 是 solo 创建的，无 collection_id）

→ 当前 active listing 无法成交，卖家须先 `cancel_soul_listing`，再以 `list_soul_fixed_price_with_collection` 路径重新上架。

### 推荐修复

`collection::add_soul` 增加守卫：要求 Soul 当前不在任何 active listing 中。

最简方案：在 `SoulState` 加 `is_listed: bool`（list_* 时置 true，cancel/buy 时置 false），`add_soul` 断言 `!state.is_listed`。

或反向：把 listing 状态放进 market-owned registry，再让 `collection::add_soul` 读 registry 断言无 active listing。需要补 Move regression：solo list → add_soul 应 abort；cancel 后 add_soul 应成功。

---

## 发现 #5 — Low：`mint_imported_in_personal_kiosk` 的 `origin_ref` 完全无验证

**严重度**: Low（设计选择）
**类别**: 数据完整性
**模块**: market

### 描述

```move
// market.move:588
public fun mint_imported_in_personal_kiosk(
    ...
    origin_ref: String,
    ...
)
```

任何人可声称自己 import 了任何外部 Soul，origin_ref 仅作为字符串记录到 `Soul.origin_ref`，没有签名验证或链下证明。

### 影响

- 链上层信任声明，仿冒 import 可在前端误导用户
- 不影响合约安全，但 marketplace UI 必须明确显示"未验证 import"

### 推荐

文档化此为"链下声明"。如要强制验证，应引入 oracle/multisig 签名鉴证 path。

---

## 已接受设计 #6 — `mint_joined_in_personal_kiosk<T>` 支持任意当前拥有的 Sui NFT

**严重度**: Accepted Design（不按漏洞处理）
**类别**: 数据完整性
**模块**: market

### 描述

```move
// market.move:625
public fun mint_joined_in_personal_kiosk<T: key + store>(
    ...
    source_object_id: ID,
    ...
) {
    assert!(kiosk::has_item_with_type<T>(kiosk_obj, source_object_id), ECollectionMismatch);
    ...
    df::add(&mut registry.id, JoinedSourceKey { source_object_id }, true);
    ...
}
```

T 可以是任何 `key + store` 类型。链上约束是：source object 必须已经在调用者 personal kiosk 内，且同一 `source_object_id` 只能 join 一次。

### 二次复核结论

当前 web 资源页明确把 Personal Join 定义为“add a Soul layer on top of any existing Sui NFT”，并由 TS builder 先把 source NFT `kiosk::place` 到同一 personal kiosk，再调用 `mint_joined_in_personal_kiosk<T>`。因此“任意 Sui NFT”是产品范围，不是合约漏洞。

仍需注意：`origin_ref` 是 UI 写入的人类可读字符串，链上真正证明的是 `kiosk::has_item_with_type<T>(source_object_id)` 在 mint 当下成立，以及 `JoinedSourceKey` 防重复。UI 不应把 personal-join 表述成某个官方 collection 的认证，除非另加 allowlist / oracle / admin-attestation。

若未来产品改成“只允许 X 系列 NFT join”，再引入 admin 维护的 allowed source type list。

---

## 设计良好的部分（值得保留）

| 设计 | 评价 |
|---|---|
| **Owner epoch 两段式失效** | rotate_owner 仅 epoch++ + count=0，旧 grant 通过 epoch 比对失效；`destroy_invalidated_grant` 任何人可清理 — 优雅且 gas 高效 |
| **slot op_mask/read_mode_mask/grant_scope_mask 三缓存** | 在 append 时快照 KindDescriptor，后续 deprecate/reactivate 不影响历史 slot — 强不变量 |
| **SoulState/SoulContent 限制 `key`-only** | 阻止 `public_transfer` 和 wrap，强制 share_state 单一通道，且 share_state 断言 content_id 已绑定 |
| **InitialContentEntry 在 mint 钱包边界做 SOUL_DOC=1, MEMORY>=1 预检** | 失败时 blob 仍归属用户，比内部 abort UX 更好 |
| **listing PurchaseCap 锁在 listing 内 + key-only** | 完美 hot potato 模式，witness rule 不可绕过 |
| **finalize_* 包装强制 share** | SoulState/SoulContent/SoulListing 没 store + 没 drop，PTB 必须显式 share 才能完成 tx |
| **Walrus blob 通过 dof 持有，purge 时 burn** | 标准模式，正确管理 Walrus 存储 rebate |
| **paid_access renewal_base_ms 防时间倒退** | 续费基线取 max(now, prev_expiry)，确保已购时间不丢失 |

---

## 后续处理建议

下列问题需要根据用户/产品意图判断，建议进入 `tasks/todo.md` 或对应 plan：

1. **Cap 集中化处置**：用户已确认后续多签接管，本轮不处理。
2. **paid access 产品承诺**：若承诺不可撤销/期限内持续可读，必须上协议级 receipt / refund / delete-lock；若承诺可撤销订阅，则需 UI 和文档明确。
3. **listing 期间 add_soul 锁定**：是否在合约层补 active listing guard，还是仅前端约束。
4. **paid_access entries 外层 GC**：低风险资源优化，可和 paid access 数据结构调整一起做。

---

## 审计统计

| 严重度 | 数量 |
|---|---|
| Critical | 0 |
| High | 0（Cap 集中化已按用户确认排除，后续转多签） |
| Medium | 1 |
| Low | 3 |
| Accepted Design | 1 |
| Informational | 多处（已在"设计良好"列出） |

模块代码总量：约 4500 行 Move（含测试外）。每行平均断言密度高（接近防御式编程），事件覆盖完整。Phase 2 的 typed-content 重构相比删除前的 5 模块（assets/skills/memory/metadata/seal_policy/content_access）显著提升了一致性 — 单 SoulContent 聚合、kind_registry 抽象、统一 seal_approve 路径、单 SoulPaidAccessList 都消除了之前可能的不一致状态。

---

## Second-pass 复审纪要 — 2026-05-04

**复审说明**: 首轮审计稿写于 13:26；代码于 14:03–14:06 进一步落实修复。本纪要记录 second-pass 对当前 `move/soulidity/sources/` 的全文复读结果，作为首轮稿的增量。

### 修复确认

| 旧编号 | 严重度 | 状态 | 修复证据 |
|---|---|---|---|
| **#3** paid_access 外层空表残留 | Low | ✅ RESOLVED | `paid_access.move:587-594` 新增 `drop_empty_buyer_row(addr)` 私有函数：检查 `entries[addr]` inner table 是否 `is_empty`，为空时 `entries.remove(addr)` 并 `table::destroy_empty(inner)`。`revoke_access:536` 与 `cleanup_stale_entries:576` 在删除 inner entry 后均调用之。新增 `has_buyer_row(addr): bool` getter 供 indexer / 测试验证外层 row 已回收。 |
| **#4** solo listing 后绑定 Collection 致 active listing 不可购买 | Low | ✅ RESOLVED | `soul.move:81` 新增 `is_listed: bool` 字段；`soul.move:354` `set_listed(state, listed)` 包级 setter；`market.move:833 / 888 / 917 / 1704` 在 `list_soul_fixed_price` / `list_soul_fixed_price_with_collection` / `cancel_soul_listing` / `buy_soul_impl` 全部路径同步翻转；`collection.move:193` `add_soul` 增 `assert!(!soul::is_listed(state), ESoulCurrentlyListed)` 守卫。flow 改成：solo list 后 → `add_soul` 直接 abort，强制卖家走 cancel → `list_with_collection`。 |

### 仍然成立的项

| 编号 | 严重度 | 状态变化 |
|---|---|---|
| **#2** paid access 收款后 owner 仍可撤销访问或删除内容 | Medium | 已正式纳入 `CLAUDE.md` `# System Invariants` 第 "Paid access is owner-revocable subscription" 条；`market.move:1118-1135` `purchase_paid_access` 上方注释明确披露此信任边界，并指出 `SoulPaidAccessRevoked` / `ContentVersionDeleted` / `ContentVersionPurged` 事件可供 buyer-side indexer 检测。属产品边界，前端付费购买页必须显式披露"owner 可撤销 / 内容可被删除"。如未来要承诺"期限内可读"，需引入 slot-level receipt、delete-lock window 或显式 refund rail。 |
| **#5** `mint_imported_in_personal_kiosk` 的 `origin_ref` 不验证 | Low | 无变化。`market.move:588-594` 函数注释明示 "free-form, **unverified** human-readable string"。UI 责任标注。 |
| **#6** `mint_joined_in_personal_kiosk<T>` 接受任意 `key+store` 类型 | Accepted Design | 无变化。`JoinedSourceKey` df 全局防重复 join；产品语义为"在任意 Sui NFT 上叠加 Soul 层"。 |

### 关键不变量复测 — 全部通过

| 不变量 | 验证点 |
|---|---|
| Owner-epoch 双写：rotate_owner → epoch++ + count=0 | `soul.move:489` `rotate_owner` + `grant.move:383` `invalidate_all_for_owner_rotation` 调用 `clear_active_grant_count_for_owner_rotation` |
| grant 三段验证（soul_id / grantee=sender / epoch_snapshot） | `grant.move:400-402` |
| 单 SoulContent / SoulPaidAccessList 1:1 强绑定 | `soul.move:358/363` `EContentAlreadyBound` / `EAccessListAlreadyBound` |
| Seal 文档 ID 精确长度匹配 + 全字段逐字节比对 | `content.move:1027-1102` `assert_matching_document_id` |
| Witness rule 不可绕过 | `SoulMarketProof` / `CollectionMarketProof` 模块私有，仅 buy 路径构造 |
| Slot 三缓存（op_mask / read_mode_mask / grant_scope_mask）append 时快照 | `content.move:586-599`；`KindDescriptor` 仅 `deprecated` 可变（`kind_registry.move:174`） |
| 支付精确等值 | `payment.value() == total` 在 `buy_soul_impl:1677` / `buy_collection:1077` / `purchase_paid_access:1157` |
| Coin split 不会下溢 | `combined_bps <= MAX_BPS=10000` + `total = price + Σfees` 数学恒等保证 |
| u128 quote 防溢出 | `MAX_U64_AS_U128` 上界检查（`market.move:391/402/412`） |
| 单 personal kiosk 注册 | `PersonalKioskOwnerKey { owner }` 一对一 + `rebind_primary_kiosk` 要求 `item_count==0` |
| TransferPolicy 三层规则 | kiosk_lock + personal_kiosk + witness 全部添加在 `init_impl:1849-1855` |
| Listing 与 add_soul 互斥 | `is_listed` 双向同步 + `collection::add_soul` 守卫（见 #4 修复） |
| 重复 mint_joined 防护 | `JoinedSourceKey` df 全局唯一（Sui object id 全局唯一性背书） |
| ContentAccessList paid 路径 epoch-pinned | `paid_access::has_access:221` 比对 entry epoch 与 state.ownership_epoch |
| 非活跃 listing 任何人可清理收 rebate | `delete_soul_listing` / `delete_collection_listing` |
| 失效 grant 任何人可销毁收 rebate | `grant::destroy_invalidated_grant` |

### 新观察 — 加固建议（非安全级，可选）

下列项不构成漏洞，记录在此供产品节奏决定是否纳入后续加固。

1. **`set_state_config` value 无大小上限**
   - `market.move:764` `set_state_config(... value: vector<u8>, ...)` 接受任意大小 vector。owner 可塞入大块数据，买家接手 Soul 时继承存储成本（可调 `delete_state_config` 拿回 storage rebate）。
   - **建议**：在 `soul::upsert_state_config` 顶部加 `MAX_VALUE_BYTES`（例如 64 KiB）上限断言，从源头防 griefing。
2. **`bps_amount` 向上取整**
   - `market.move:1741` `bps_amount` 使用 `(numerator + 9_999) / 10_000`，每笔 fee 最多多收 1 atomic。属轻微让利平台方，与 marketplace 惯例相符。
   - **建议**：如产品强调"精确收费"，可改向下取整并同步 `total = price + Σfees` 路径；当前实现没有数学问题，仅是经济选择。
3. **`bps_amount` 末尾 `as u64` 无下游断言**
   - 当前由 `MAX_BPS=10000` 上游强保证不溢出；如未来某次重构放宽 bps 上限，u128→u64 的 cast 会静默截断。
   - **建议（防御性）**：`bps_amount` 末尾加 `assert!(result <= price + 1)` 之类上界 sanity check（取整方向决定是否带 +1）。

### 测试覆盖建议

`protocol_tests.move` ~4000 行 / 143KB，规模充足。建议确认以下 second-pass 修复路径已被覆盖（若已覆盖可忽略）：

- **`is_listed` 状态流转**：solo list → `add_soul` 应 abort `ESoulCurrentlyListed`；cancel 后 `add_soul` 成功；buy 后 `is_listed=false`；with-collection list / cancel 路径同样回归。
- **`drop_empty_buyer_row`**：`revoke_access` 删完 inner 唯一 entry 后 `has_buyer_row=false`；`cleanup_stale_entries` 在 epoch 不匹配场景下同样回收外层 row。
- **rotate_owner 后 re-issue grant 给同一 grantee**：`cleanup_inactive_grant_for_grantee` 在 `issue` 头部触发，移除 stale slot；新 grant 通过 capacity check 入表。

### 总评

无新增漏洞。Phase 2 typed-content 重构完整、不变量声明清晰、断言密度高、事件覆盖到位。本轮 second-pass 主要价值在于确认 #3 / #4 已闭环；剩余 Medium 已是声明性产品边界，Low / Accepted 均为既定设计。可放心进入主网部署前的 Cap 集中化（多签）落地阶段。
