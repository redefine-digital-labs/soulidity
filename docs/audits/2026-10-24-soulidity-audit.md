# Soulidity Move 合约安全审计报告

| 项 | 内容 |
|---|---|
| 审计日期 | 2026-10-24 |
| 审计对象 | `move/soulidity/sources/` 14 个生产模块（commit `0cfb60a2`，fresh release 候选源码） |
| 审计方式 | **双引擎交叉独立审计**：Claude Fable 5.1（主审计 + 2 名独立子审计员）× Codex `gpt-6.1-sol`（reasoning `ultra`，read-only sandbox）。两路均禁止读取历史审计报告，完成后逐条对照源码交叉核验 |
| 构建状态 | 本机**不可构建/不可跑测试**（`animacraft_v8_*` 为单机绝对路径 `local` 依赖），全部为静态审计 + 依赖源码核对 + mainnet 链上状态核对 |
| 上一版报告 | `docs/audits/2026-05-04-soulidity-audit.md` |

---

## 0. 先结论

- **未发现 Critical / High**。Kiosk 托管闭环、TransferPolicy 三规则、witness 不可构造、owner-epoch 轮转失效、Seal 文档 id 解析与命名空间隔离、支付精确等值与 bps 上限等核心不变量在三路 Claude 审计中全部逐行验证成立（见 §6）。
- **6 个 Medium**，集中在两类：
  1. **不可逆的生命周期缺口**：托管 Walrus Blob 无法续期（SOUL_DOC 在约 2 年内必然失效）、MEMORY 时间线被单对象大小硬封顶（≈3,150 版）、grantee 软删不可逆且 owner 无 undelete、原生 V8 Soul 加入 collection 后永久不可上架。
  2. **发布前必须补的护栏**：核心模块（content / grant / paid_access / collection）没有升级 kill-switch（旧 bytecode 永久可调，Seal key server 也不限定包版本）；售前内容与 envelope 可被卖家静默破坏（保留前缀只在 mint 期校验 + 上架期间内容不冻结）。
- **9 个 Low、10 余条 Informational**，多为"公开函数在绑定/注册时不检查后续出售路径的前置条件 → 自致不可逆"（高版税 Soul 入 collection、owned kiosk 注册、装备绑定无恢复）与工程卫生（V1 死代码且测试主要覆盖 V1、依赖路径不可复现）。
- **同日修复**：F-1 / F-5 / F-6 / F-7（及顺带 F-9）已按 TDD 实现、codex accept 复核 PASS WITH NITS 并补强，全套 522/522，见 §11；F-2 / F-3 / F-4 与 Low/Info 项待后续轮次。
- **2026-05-04 报告**中 #3/#4 修复确认有效；#2（paid access 为 owner 可撤销订阅）仍成立并已声明为产品边界；本轮无与旧报告重复的新漏洞。
- **链上核对**：mainnet 现网包 `0xa43c…`（version 2）是 v5/v6 Animacraft 集成的**旧一代**，模块集合与本源码不一致；本源码只能作为**全新发布**（`docs/plans/2026-10-01-single-release-entry.md`），不是对现网包的升级。因此本报告的发现针对**待发布新包**。

---

## 1. 审计对象与链上状态核对

| 项 | 结果 |
|---|---|
| 源码 | branch `claude/sui-move-security-audit-a4d203`，HEAD `0cfb60a2`，worktree 干净。生产模块 14 个约 8.8k 行；测试约 7.7k 行 |
| 构建 | `sui move build` 失败：`Move.toml:6-7` / `Move.lock:85-108` 把 `animacraft_v8_core/output`（传递 runtime/seal）指向 `/Users/naoer/Documents/Claude/Projects/soulidity/tmp/...`，本机不存在 |
| mainnet 现网 | `Published.toml`：original `0xa43c…d5d`、published-at `0x60bf…ecd`、version 2。GraphQL（`graphql.mainnet.sui.io`）读取 published-at 包：14 模块为 `animacraft_appearance_adapter_v6` / `animacraft_output_provenance_v5` / `appearance_v6` / `market`（含 `MarketConfigV6`、`AnimacraftV6SoulListing`）等；**不含**源码中的 `profile` / `social` / `community_*` / `named_loadout_v1` / `animacraft_v8_*`，而源码已删除全部 v5/v6 模块 |
| 推论 | Sui 升级禁止删除模块/结构体 → 本源码不可能作为 `0xa43c` 的升级发布；`2026-07-26` 升级/退役 runbook 已标注 HISTORICAL，当前入口为 fresh release。新包发布后将产生新的 `UpgradeCap` / `MarketAdminCapV2` / `KindAdminCap` / 两个 `TransferPolicyCap`，默认落 deployer，需移交多签 |
| 现网治理 | `MarketInitialized`（2026-08-02）admin = `0xadea…c52f`；`UpgradeCap 0xb89a…c21` owner 同地址（policy 0 = 兼容升级）。现网旧包不在本次范围 |
| 测试覆盖倒挂 | 生产 `init` 只构造 `MarketConfigV2`，V1 `MarketConfig` 仅 `#[test_only] init_impl` 可构造；但行为测试调用 V1/V2 比例：`purchase_paid_access` 8/0、`set_state_config` 2/0、`configure_paid_access_kind` 2/0、`set_active_content` 4/0、`list_soul_fixed_price` 5/2 |

---

## 2. 方法与威胁模型

1. **Claude 主审计**：全文阅读 14 模块 + 依赖清单；对照 `~/.move` 中 Sui framework（`kiosk` / `transfer_policy` / `derived_object` / `dynamic_field`）、Kiosk extensions（`personal_kiosk` + `kiosk_lock_rule` / `personal_kiosk_rule` / `witness_rule`）、Walrus（`blob` / `system`）源码核对 API 语义；核对 Sui `max_move_object_size = 250 * 1024`（protocol config）。
2. **两名 Claude 子审计员**（market 托管/经济流；content/seal/grant 授权面）在不共享主审计假设的前提下独立复审，各产出发现表与不变量清单。
3. **Codex 独立审计**：`gpt-6.1-sol` / `ultra` / read-only，禁止读取 `docs/audits/`，输出结构化报告。
4. **交叉核验**：每条发现回到源码逐行复核，标注 Confirmed / Rejected / 调级与置信度；统计重合。
5. **外部核对**：mainnet GraphQL（包模块、init 事件、UpgradeCap）；Seal key-server 源码（`crates/key-server/src/{valid_ptb,server}.rs`）确认其以**首个版本**包 id 为命名空间、**不要求** PTB 指向最新版本、以用户地址为模拟 sender；Walrus mainnet 参数（epoch 2 周、最长 53 epoch ≈ 2 年）。

**威胁模型**：Admin cap（`MarketAdminCapV2` / `KindAdminCap` / `UpgradeCap` / TransferPolicyCap）由多签持有，纯"中心化"不计入；仅记录非持有者可获权或 admin 操作有超出声明副作用的情况。`animacraft_v8_*` 视为可信外部接口，只审 soulidity 的调用方式。

---

## 3. 发现汇总表

严重度：Critical / High / Medium / Low / Info。来源：主 = Claude 主审计，M = market 子审计员，C = content 子审计员，CX = Codex。

| ID | 严重度 | 位置 | 标题 | 来源 | 置信度 |
|---|---|---|---|---|---|
| F-1 | Medium | content / grant / paid_access / soul / collection / named_loadout 全部入口 | 核心模块无升级 kill-switch：无 pause、无 `version` 门控，升级后旧 bytecode（含 `seal_approve_*`）永久可调 | 主, C | High |
| F-2 | Medium | content.move:728-732, 852-856; walrus system.move:177-190 | 托管 Walrus Blob 无 `&mut Blob` 出口 → 存储无法续期；SOUL_DOC（op_mask=0）不可替换 → soul.md 在 ≤ 2 年内必然失效 | 主, C | High |
| F-3 | Medium | content.move:655, 711-726, 816-818, 852-860 | MEMORY 单名 `"default"` 全部版本存于一个 dynamic-field 对象（81 B/slot），≈3,150 版后永久不可追加；slot 永不移除；grantee 可恶意填满 | 主, C, CX | High |
| F-4 | Medium | content.move:780-828; 976/996/1017/1074 | 软删不可逆且可委托：grantee 可删其 scope 内全部非 active 版本，所有 Seal 路径拒绝 deleted slot，owner 无 undelete | 主, C | High |
| F-5 | Medium | market.move:1515-1603 vs 2593-2603; content.move:447-870 | 售前内容可被卖家静默破坏：`content_seal_envelope_v1:` 前缀只在 mint 期保留（`set/delete_state_config*` 可覆盖/删除任意版本 envelope，事件与正常写入无异）+ 上架期间内容/envelope/config 不冻结，买家无原子内容断言 | 主, M, C, CX | High |
| F-6 | Medium | collection.move:193-222; market.move:610, 1617/1668/1723/1751/1821 | `add_soul` 接受 Animacraft 原生 Soul；绑定不可逆 → 永久不可上架/出售（测试注释自证 OPEN） | 主, M, CX | High |
| F-7 | Low | collection.move:193-222; market.move:1669-1676, 2790-2795 | `add_soul` 不校验 `platform + creator + extra ≤ 10000`；高版税 Soul 入 collection 后 solo/collection 路径均不可上架，且 admin 降费也可能救不回 | M, CX | High |
| F-8 | Low | market.move V1 全部包装器、`MarketConfig` / `MarketAdminCap` | fresh release 中 V1 市场面为不可达死代码，但测试主要覆盖 V1 → 生产 V2 ABI 覆盖弱、字节码膨胀；若误作升级发布则 V1 `paused` 可绕过 V2 门控 | 主, M | High |
| F-9 | Low | paid_access.move:308/352/396 vs market.move:2317-2409 | `configure/update/delete_paid_access_kind` 为 `public fun`，market `_v2` 包装器的 primary gate 可被直接绕过 | 主 | High |
| F-10 | Low | grant.move:197-204, 268-270, 347-358 | 过期 grant 占用容量直至显式 cleanup；`issue` 只清目标 grantee；对过期 grantee `revoke` 中止 | C | High |
| F-11 | Low | paid_access.move:483-497, 597-629 | `cleanup_stale_entries` 只清 epoch 陈旧项（过期项永存）；`duration_ms` 无上界，续费加法溢出使购买全部中止 | C | High |
| F-12 | Low | market.move:924-948, 984-1016 | `ensure_personal_kiosk_registered*` / `rebind_*` 不要求 kiosk 已共享；owned kiosk 产生无人能成交的"幽灵 listing"，买入 owned kiosk 的 Soul 永久不可再售 | M | High |
| F-13 | Low | Move.toml:6-7; Move.lock:85-108 | `animacraft_v8_*` 为单机绝对路径 `local` 依赖，仓库无法独立 build/test/源码验证 | 主 | High |
| F-14 | Low（待验证） | soul.move:264-272, 444-449, 589-594; adapter:21-38, 74-84 | 装备绑定期间 Soul 不可上架/轮转；唯一解绑路径需 `MakerLoadoutV8` by value，对象丢失即永久不可售（取决于外部 runtime 对象能力） | 主, M | Medium |
| F-15 | Low | soul.move:625-626 | Display `link` / `project_url` 直接渲染未验证的自由文本 `origin_ref`（imported / joined Soul），钱包可点击 → 钓鱼面 | M | High |
| F-16 | Info | market `_v2` 包装器 vs content/grant/paid_access | 门控不一致：owner 自身内容操作受 primary gate 约束，而 append/delete/purge/grant/add_access/revoke/add_soul/named_loadout 完全无门控 | 主 | High |
| F-17 | Info | soul.move:585-608; grant.move:434-442 | `rotate_owner` 不自行清零 `active_grant_count`，依赖调用方配对空壳包装；漏配对则容量永久耗尽 | C | High |
| F-18 | Info | content.move:1026-1036 | `seal_approve_upload_recovery` 为无状态、仅绑 sender 的 KMS；上传者（含 grantee）对自己上传的版本保留永久解密能力，"撤销"不覆盖 | C | High |
| F-19 | Info | kind_registry.move:457-475 | grant scope 位跨 kind 共享：admin 新 kind 复用 `SCOPE_MEMORY` 即被所有既有 MEMORY grant 覆盖 | C | High |
| F-20 | Info | content.move:694-695, 679-688 | append 不校验 Blob `certified_epoch` / `end_epoch`；ASSETS grantee 可把版本设为 `READ_PUBLIC` 全网可读 | C | High |
| F-21 | Info | market.move:3130-3136, 2982-2985 | TransferPolicy 规则可由 cap 持有者增删，而购买路径硬编码 3 个 receipt：加规则即全市场无法成交；删 witness_rule 即托管绕过 + SoulState 失同步 | M | High |
| F-22 | Info | market.move:2531, 1283, 2416-2466, 163-166 | 每次 mint 都 `&mut KioskRegistry`（热点 + df 无限增长）；`delete_*_listing` 任何人可收 rebate；`commit_mint_manifest` 为无鉴权事件 | M | High |
| F-23 | Info | market.move:1260-1353 | `mint_joined<T>` 不限制 T、不记录 source id 到 Soul/事件；`JoinedSourceKey` 永久占用曾持有过的 id | M | High |
| F-24 | Info | market.move:2924-2931 vs 696-706 | `buy_soul_impl` 缺 `listing.seller == current_owner` / `seller_kiosk_id == current_kiosk_id` 交叉校验（V8 路径有）；当前无可达分叉 | M | High |
| F-25 | Info | market.move:629, 667 | 原生 list/buy 要求 `platform_fee_bps == 250`：改普通市场费率即冻结原生市场（cancel 仍可用） | M | High |
| F-26 | Info | 多处 | `SoulPaidAccessPurchased` 缺 `kind`；`named_loadout` / `profile` 的 `head.version == VERSION` 读断言在升级 bump 后卡死旧 head；`#[test]` 断言 `@soulidity == @0x107` 使独立 `sui move test` 必失败；`set_state_config` value 无大小上限 | 主, C | High |
| 已知 | Medium（已接受） | paid_access.move:569-592 | paid access 为 owner 可撤销订阅、无退款轨（2026-05-04 #2），代码注释与 CLAUDE.md 已声明为产品边界 | — | High |

---

## 4. 发现详情

### F-1（Medium）核心模块缺少升级 kill-switch：旧 bytecode 升级后仍永久可调

- **位置**：`content.move` / `grant.move` / `paid_access.move` / `soul.move` / `collection.move` / `named_loadout_v1.move` 全部 public 入口；对照 `market.move` 的 V2 gate。grep 结果：对 `version == VERSION` 的断言数 content 0 / grant 0 / paid_access 0 / soul 0 / collection 0。
- **描述**：Sui 升级不会下线旧版本字节码；要让旧版本失效，旧字节码必须在运行时读到共享对象里的"版本/开关"并中止。本包只有 market `_v2` 包装器读取 `MarketConfigV2` 门控；content（含全部 `seal_approve_content_*`）、grant、paid_access（含 `seal_approve_content_paid_access`、`configure/update/delete_paid_access_kind`、`add_access`、`revoke_access`）、collection（`add_soul`）、named_loadout_v1 没有 pause，也不检查已存在的 `version` 字段。`profile` / `social` / `community_*` 虽断言 `registry.version == VERSION`，但没有 bump 函数（升级时可补）。
- **Seal 面已核实**：Seal key server（`server.rs` `fetch_first_pkg_id` / `valid_ptb.rs`）以首个版本包 id 作命名空间，**不要求** PTB 调用最新版本；因此升级修复后的旧 `seal_approve_*` 仍可被调用并释放密钥，除非函数自身读取带版本的共享对象。Seal 官方文档亦建议对共享对象做版本化。
- **失效路径**：发布后在 grant/content/paid_access 任一处发现授权缺陷 → 升级修复 → 攻击者继续调用旧版本包地址上的同名函数 → 缺陷持续可利用，无链上手段关停。
- **建议**：新增共享 `ProtocolGate`（或扩展 `MarketConfigV2`）：`content_version: u64` + `paused: bool`，所有 mutating 入口与 `seal_approve_*` 断言 `gate.version == VERSION && !gate.paused`，admin 可 bump / pause；或每个共享对象加 `assert!(obj.version == VERSION)` + admin `migrate`。**发布前落地**；发布后再加等同于先做一次升级。
- **置信度**：High。

### F-2（Medium）托管内容 Blob 无存储续期路径；SOUL_DOC 必然过期且不可替换

- **位置**：`content.move:728-732`（`dof::add`）、`:852-856`（唯一取出路径 purge → `dof::remove` + `blob::burn`）；全模块无 `dof::borrow_mut<ContentBlobKey, Blob>`。Walrus `system.move:177`（`extend_blob_with_resource(&System, blob: &mut Blob, Storage)`）、`:183`（`extend_blob(&mut System, blob: &mut Blob, epochs, payment)`）。
- **描述**：Walrus 存储有有限期限（`Blob.storage.end_epoch`，mainnet 单次最长 53 epoch × 2 周 ≈ 2 年）。续期需要 `&mut Blob`，但 Blob 一旦进入 `SoulContent` dof 便没有任何可变借用或"取出-续期-放回"函数。SOUL_DOC（`op_mask = 0`，`append_initial_invariant_version` 又断言 `!items.contains`，content.move:572）连重传都不可能；其余 kind 只能 purge 旧版 + 追加新版（版本号变化、旧 Seal 文档 id 失效、付费/授权读者需重新定位）。`append_version_impl` 也不校验 `blob.certified_epoch()` / `end_epoch`。
- **缓解（链下）**：Walrus 可用性按 `blob_id` 计，任何人可用相同密文重新注册一个自己持有的新 Blob 来维持可用性，读者按 `blob_id` 解析即不受影响——这是评 Medium 而非 High 的原因；但这要求运维长期承担，且链上无信号（slot 不记录 `end_epoch`）。
- **建议**：(1) 增加 `extend_content_blob(content, state, kind, name, idx, system: &mut System, epochs, payment)`（owner 或任何人可付费），内部 `dof::borrow_mut` 后调用 `walrus::system::extend_blob`；(2) 或托管改用 `walrus::shared_blob::SharedBlob`（任何人可注资续期）；(3) 追加时断言 `certified_epoch().is_some()` 且 `end_epoch` 高于最小保留期，并把 `end_epoch` 写入 slot/事件供索引告警；(4) 为 SOUL_DOC 设计"同 `blob_id` 重传"而非完全禁止写入。
- **置信度**：High。

### F-3（Medium）MEMORY 时间线被单 dynamic-field 对象大小硬封顶（≈3,150 版），无轮换路径

- **位置**：`content.move:655`（`assert_canonical_name_for_kind` 强制 MEMORY 名为 `"default"`）、`:711-726`（`items: Table<ContentKey, vector<ContentSlot>>` 直接 `push_back`）、`:816-818`（软删不移除 slot）、`:852-860`（purge 不移除 slot）。
- **描述**：`Table` 的每个条目是独立 dynamic-field 对象，受 `max_move_object_size = 250 * 1024 = 256,000` 字节约束。`ContentSlot` BCS 为 81 字节（8+4+32+1+1+1+1+8+8+8+1+8），`(KIND_MEMORY, "default")` 的 vector 在约 3,150 个版本后再 `push_back` 即超限中止，且 vector 永不缩小。MEMORY 是唯一名称固定的 kind，无法换名续写。每次 append 还要整体重写接近 250 KiB 的 vector，gas 随历史线性增长。
- **路径**：(a) 自然耗尽——agent 每天写几条 memory，约 3 年触顶；(b) 恶意——持 `SCOPE_MEMORY` 的 grantee 连续 `append_version_as_granted_agent`（每次需一个 Walrus Blob + gas，约 3k 笔交易）即可永久封死该 Soul 的 memory，owner 只能撤销 grant，无法移除已写版本；买家会继承这一状态。
- **建议**：版本存储改为 `Table<ContentKey, Table<u64, ContentSlot>>`（或 `TableVec`，单对象大小恒定）+ 小型头结构保存 `version_count`；或允许 MEMORY 分段名（`default`, `default-2`…）的显式轮换操作；并为 grantee append 加每 grant 配额。
- **置信度**：High。

### F-4（Medium）软删除不可逆且可委托：被劫持的 agent 可永久剥夺 owner 对历史内容的解密能力

- **位置**：`content.move:780-802`（`delete_version_as_granted_agent`）→ `:804-828`（`mark_slot_deleted`）；Seal 路径 `:976-977`（owner）、`:996-997`（agent）、`:1017-1018`（public）、`:1074-1075`（paid）均断言 `!slot.deleted`；全文件无任何 `deleted = false` 路径。
- **描述**：持相应 scope 的 grantee 可软删除其 scope 内所有非 active 版本（MEMORY / SKILL 无 active 绑定 → 全部可删；SPRITE / AUDIO 非 active 可删）。软删后 Seal 对包括 owner 在内的所有人拒绝，Walrus blob 与 envelope 仍在但密钥永不可得；owner 没有 undelete。
- **路径**：owner 给 AI agent 发 `SCOPE_MEMORY|SCOPE_SKILLS` grant → agent 被 prompt injection / 密钥泄露 → 一笔 PTB 批量 `delete_version_as_granted_agent(…, i)` → owner 全部 memory / skill 历史永久不可读（除非包升级补 undelete）。
- **建议**：(1) owner-only `restore_deleted_version(kind, name, idx)`（仅 `deleted && !purged`）；(2) 把 agent 删除权从 scope 位拆出（新增 `OP_AGENT_DELETE` 或独立 scope bit，默认不授予），或仅允许 agent 删除其自己追加的版本（slot 记录 `appended_by`）；(3) UI 对 grant 的"可删除"语义显式告知。
- **置信度**：High。

### F-5（Medium）售前内容与 envelope 可被卖家静默破坏

- **位置**：`market.move:2585, 2593-2603`（仅 mint 期 `assert_initial_config_key_unreserved`）；`market.move:1515-1544 / 1574-1603`（`set_state_config(_v2)` / `delete_state_config(_v2)` 只查 owner + 非空 key）；`content.move:521-539`（envelope 以 `content_seal_envelope_v1:<sha256>` 写入 `SoulState.config_ext`，走同一 `soul::upsert_state_config`）；`soul.move:236-238`（`is_listed` 只被 `set_listed` / `collection::add_soul` 读取）。SDK 直接调用 `set_state_config_v2`（`packages/soulidity-sdk/src/tx/content.ts:419`）。
- **描述**：两件事叠加——(a) 保留前缀只在 mint 期校验，owner 可用 `set_state_config_v2` 覆盖、或 `delete_state_config_v2` 删除任意版本的 envelope；写入事件 `SoulStateConfigUpserted` 与 `persist_append_envelope` 的事件形态完全一致，`SoulContent` 的 `deleted/purged/version_count` 全部健康；(b) 上架期间 content / envelope / config 的所有 mutator 都不检查 `is_listed`，买家 PTB 只能用 `assert_mutation_scope`（仅 epoch）或 `assert_active_binding`（仅 active 指针），没有整体内容快照断言。
- **路径**：卖家对每个版本 key `K_k = envelope_config_key(content, kind, name, v)` 写入一个结构合法但 DEK 错误的 Seal envelope（或删除），再上架；买家链上尽调（slot 标志、版本数）全部正常，付款后任何版本都无法解密。相比 `delete_*`（发 `ContentVersionDeleted`、slot 标 deleted）此路径**不可事前发现**。同一手法在上架后、成交前亦可执行。
- **影响**：二级市场静默 rug；同时也破坏协议声明的"envelope 命名空间由协议拥有"的不变量（mint 路径与 SDK 都遵守，热钱包路径不遵守）。
- **缓解（codex 提出，核验成立）**：envelope 为确定性公开字节，继任 owner 可从归档节点取历史对象版本后重新 upsert 恢复；但被删除/purge 的版本不可恢复，且买家购买前无法察觉，故合并后维持 Medium。
- **建议**：(1) 四个 `set/delete_state_config*` 包装器复用 `assert_initial_config_key_unreserved`（或把检查下沉到 `soul::upsert/delete_state_config`，仅给 `content::persist_append_envelope` 留 package 级旁路）；(2) content / envelope / config mutator 在 `soul::is_listed(state)` 时中止（named_loadout 有意不加门，content 不应效仿）；(3) 可选：提供 `assert_content_snapshot(content, expected_bcs)` 供购买 PTB 原子校验。
- **置信度**：High（三路独立命中；market 子审计员评 Medium、其余两路评 Low，合并为 Medium 的依据是"不可事前发现 + 买家损失"）。

### F-6（Medium）`collection::add_soul` 接受 Animacraft 原生 Soul，绑定后永久不可上架

- **位置**：`collection.move:193-222`（无 provenance 检查；`soul::bind_collection` 一次性不可逆，soul.move:436-439）；`market.move:610`（原生路径 `assert_animacraft_native_v8_provenance` 要求 `collection_id.is_none()`）；`market.move:1617/1668/1723/1751/1821/1855/1892/1927`（普通 list/buy 拒绝 `has_animacraft_provenance`）。
- **描述**：原生 V8 Soul 的 creator == owner，可通过正常"加入我的 collection"流程成功 `add_soul`。之后普通路径因 provenance 拒绝、原生路径因 collection 拒绝，Soul 永久无法经唯一合法转移通道（`buy_*`）易手，还占用一个 supply 位；没有解绑函数。`native_cutover_policy_tests.move:12-13` 注释已把此项列为 OPEN。
- **建议**：`add_soul` 增加 `assert!(!soul::has_animacraft_provenance(state), E…)`；或为原生 Soul 设计带 collection 的 V8 路径。
- **置信度**：High。严重度 Medium：用户经正常功能触发、结果不可逆、团队已知但未关闭。

### F-7（Low）`add_soul` 不校验合并 bps 上限

- **位置**：`collection.move:193-222`；`market.move:1669-1676, 2790-2795`（with-collection 上架要求 `platform + creator + extra ≤ 10000`）；`market.move:2492-2495`（mint 只查 `platform + creator`）；`collection.move:150`（extra ≤ 10000）。
- **路径**：mint `creator_royalty_bps = 9750` → 建 `extra_royalty_bps = 500` 的 collection → `add_soul` 成功 → solo 路径被 collection 绑定拒绝、collection 路径 `ECombinedFeesTooHigh`；admin 把 platform fee 降到 0 也仍 9750 + 500 > 10000 → 永久不可上架。
- **建议**：`add_soul` 在绑定时校验 `creator + extra + 当前/最大 platform fee ≤ 10000`（可经 market 包装器注入 config），或在 mint 时为 creator royalty 预留余量。

### F-8（Low）V1 市场面为不可达死代码，而测试主要覆盖 V1

- **位置**：`market.move:403-405`（`init` → `init_fresh_impl` 只建 `MarketConfigV2`）；`MarketConfig` 唯一构造点 `#[test_only] init_impl`（`:3157`）；约 25 个 V1 包装器 + `MarketAdminCap` + V1 admin 函数；`buy_soul_impl` 不检查 `listing.version`（`:2908-2998`）。
- **描述**：生产环境任何需要 `&MarketConfig` 的函数都无法调用，但行为测试大量以 `init_for_testing`（V1）驱动（见 §1 表）。若未来误把此源码作为"持有未暂停 V1 config 的部署"的升级，V1 mint/list/buy 只受 V1 `paused` 约束、V1 `buy_soul_fixed_price` 可结算 V2 listing（反之亦然）。
- **建议**：发布前删除 V1 类型与包装器，测试迁到 `init_fresh_for_testing` + `_v2`；至少在 V2 buy 路径断言 `listing.version == MARKET_VERSION_V2`。

### F-9（Low）paid-access 配置的 primary gate 可被直接绕过

- **位置**：`paid_access.move:308 / 352 / 396`（`configure_paid_access_kind` / `update_paid_access_kind` / `delete_paid_access_kind` 为 `public fun`）vs `market.move:2317-2409`（`_v2` 包装器加 `primary_enabled` 断言）。对照 `content::set_active` / `soul::upsert_state_config` 为 `public(package)`，那些门控才真实有效。
- **影响**：暂停期间 owner 仍可改价/删配置；购买本身仍经 market 门控。
- **建议**：三者改为 `public(package)`，或删除包装器断言保持语义一致。

### F-10（Low）过期 grant 持续占用容量；对过期 grantee 调 `revoke` 会中止

- **位置**：`grant.move:197`（`issue` 只清理目标 grantee）、`:202`（容量检查）、`:268-270`（`revoke`：cleanup 移除过期行后断言存在 → 失败，整笔回滚）、`:347-358`（需显式 `cleanup_inactive_grants`）。
- **路径**：默认容量 1；给 A 的 grant 过期 → 给 B 发 grant → `EGrantCapacityExceeded`；owner 试 `revoke(A)` → `EGrantNotFound` → 必须知道并调用 `cleanup_inactive_grants([A])`。
- **建议**：`issue` 在容量满时惰性清扫过期行，或让 `revoke` 对过期/陈旧行成功（发 `SoulGrantExpired`）；SDK 在 issue 前自动带 cleanup。

### F-11（Low）过期 paid entry 永不清扫；`duration_ms` 无上界

- **位置**：`paid_access.move:597-629`（只清 epoch 陈旧项）、`:483-497`（`now + duration` 无 checked add）、`:308-346`（duration 无上界）。
- **影响**：一次性买家的过期行永久占存储；owner 配置超大 duration 后所有购买中止（自伤，支付在同笔回滚不丢钱）。
- **建议**：`cleanup_stale_entries` 接受 `Clock` 并清扫 `expires_at_ms <= now`；配置时限制 `duration_ms`（如 ≤ 100 年）。

### F-12（Low）注册不要求 kiosk 已共享：owned kiosk 产生幽灵 listing / 永久不可售

- **位置**：`market.move:924-948`（`ensure_personal_kiosk_registered*` 只凭 `PersonalKioskCap` 注册）、`:984-1016`（`rebind_*`）；对照 `init_personal_kiosk*`（`:889, :913`）总是 `public_share_object`。`Kiosk` 有 `store`，可被 `public_transfer` 给自己成为 owned；已存在的对象之后无法再 share（`ESharedNonNewObject`）。
- **路径**：(i) 卖家用 owned kiosk 注册并上架 → `SoulListing` 共享可见，但任何买家都无法把卖家 owned kiosk 作为 `seller_kiosk` 输入 → 永不可成交的幽灵 listing；(ii) 买家用 owned kiosk 注册并买入 → 该 Soul 以后任何买家都需要其 owned kiosk 作输入 → 永久不可再售，`rebind` 又要求旧 kiosk 为空。
- **影响**：主要为自致流动性丧失 + 市场噪音；需非标准工具构造。
- **建议**：注册只接受 `init_personal_kiosk*` 创建的 kiosk，或要求注册与 `kiosk::new` + `public_share_object` 同笔完成；索引器/SDK 过滤 owner 类型非 Shared 的 kiosk。

### F-13（Low）发布可复现性：`animacraft_v8_*` 依赖为单机绝对路径

- **位置**：`Move.toml:6-7`、`Move.lock:85-108`。
- **描述**：`local = "/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-v8-mainnet-release/..."`，仓库无法独立 `sui move build/test`，也无法做链上源码验证；本次审计因此无法编译验证。
- **建议**：改为 git `rev` 固定依赖或仓库内 vendoring；CI 从干净 checkout 构建（`2026-10-01-paired-move-ci.md` 方向需落到 `Move.toml`）。

### F-14（Low，待验证）原生装备绑定缺少恢复路径

- **位置**：`soul.move:264-272`（绑定/解绑）、`:444-449`（`set_listed` 拒绝）、`:589-594`（`rotate_owner` 拒绝）；`animacraft_equipment_adapter_v8.move:74-84`（唯一解绑入口 `close_empty_equipment_v8` 需 `MakerLoadoutV8` by value）。
- **描述**：装备与上架在两个方向互斥（`owner_witness` 要求 `!is_listed`，`set_listed(true)` 要求无 DF10）——这部分成立。残余风险在 owner 侧：若 `MakerLoadoutV8` 可被转移/包裹/销毁（取决于 `animacraft_v8_runtime`，本机无源码），DF10 永远无法移除，Soul 永久不可上架/轮转。
- **建议**：在 animacraft 侧确认该对象 key-only 不可转移；或提供 owner/admin 级"对象已不存在时强制解绑"。

### F-15（Low）Display 直接渲染未验证的 `origin_ref` 链接

- **位置**：`soul.move:625-626`（`link` / `project_url` → `{origin_ref}`）；`market.move:1168-1174`（注释声明 `origin_ref` 为未验证自由文本）。
- **描述**：imported / joined Soul 的 `origin_ref` 可为任意字符串，钱包与浏览器把 Display 的 `link` / `project_url` 渲染为可点击链接 → 钓鱼面。
- **建议**：Display 去掉 `link` / `project_url`，或改为协议自有域名 + Soul id 的固定模板。

---

## 5. Informational 与信任假设

- **F-16 门控不一致**：owner 自身内容操作（`set_active_content_v2` / `set_state_config_v2` / `configure_paid_access_kind_v2`）受 `primary_enabled` 约束，而 `content::append/delete/purge`、`grant::*`、`paid_access::add_access/revoke_access`、`collection::add_soul`、`named_loadout_v1::*` 完全无门控。运维文档需明确"pause 只覆盖市场与 mint"。
- **F-17 `rotate_owner` 配对脆弱**：`soul.move:589-608` 只递增 epoch，清零靠 `grant::invalidate_all_for_owner_rotation`（忽略两个参数的空壳）；两个生产调用点（`market.move:744-745, 2973-2974`）配对正确，`protocol_tests.move:4190` 有不配对用法。建议把清零移入 `rotate_owner`。
- **F-18 upload-recovery 永久解密能力**：`content.move:1026-1036` 只校验域/版本字节/长度 142/`id[30..62] == bcs(sender)`，后 96 字节任意；客户端恢复包含 DEK（`web/lib/soulidity/content-append-preparation.ts`）。grantee 对其上传过的版本在撤销/删除/转售后仍可取回 DEK。非新泄漏（上传者本就持有明文），但"撤销"语义不覆盖撤销对象自己写入的内容；可选在 id 中编码 TTL 并用 `Clock` 校验。
- **F-19 scope 位跨 kind 共享**：`kind_registry.move:457-475`；admin 新 kind 复用 `SCOPE_MEMORY` 即被既有 MEMORY grant 覆盖；owner 无法按 kind 限制 grant。
- **F-20 Blob 状态与 PUBLIC 发布**：append 不校验 `certified_epoch` / `end_epoch` / `is_deletable`（`content.move:694-695`）；ASSETS grantee 可为 SPRITE/AUDIO 选 `READ_PUBLIC`（`:679-688`），使该版本经 `seal_approve_content_public` 对全网可读。
- **F-21 TransferPolicy 可变 vs 硬编码 3 receipts**：`market.move:3130-3136` vs `2982-2985 / 753-756 / 2162-2165`。cap 持有者加第四条规则 → 全部 `buy_*` 中止；删 `witness_rule` → kiosk 内 `list`+`purchase`（价 0）可自行成交，`SoulState` 的 owner/kiosk/epoch 失同步。两个 policy cap 必须与 admin cap 同在多签。
- **F-22 热点与 spam**：每次 mint `&mut KioskRegistry`（`derived_object::claim` + `JoinedSourceKey`）→ 全局串行点与 df 无限增长；`delete_*_listing` 任何人可收 rebate（代码声明为设计）；`commit_mint_manifest` 任何人可发事件，索引器不得当作授权。
- **F-23 `mint_joined<T>`**：T 任意 key+store（含 `Soul` / `Coin`）；source id 不记录到 Soul/state/事件，仅自由文本 `origin_ref`；`JoinedSourceKey` 永久占用曾持有过的 id。若 provenance 需有意义，应把 source id 与类型名写入 `SoulMintedToKiosk`。
- **F-24 `buy_soul_impl` 防御纵深**：缺 `listing.seller == soul::current_owner(state)`、`listing.seller_kiosk_id == soul::current_kiosk_id(state)`（V8 路径 `:704-705` 有）；当前无可达分叉。
- **F-25 原生市场与费率耦合**：`market.move:629, 667` 要求 `platform_fee_bps == 250`，改普通费率即冻结原生 list/buy（cancel 仍可）。
- **F-26 杂项**：`market::SoulPaidAccessPurchased` 缺 `kind`（需联表 `paid_access::SoulPaidAccessGranted`）；`named_loadout_v1.move:87-90` / `profile.move:273-276` 的 `head.version == VERSION` 读断言在升级 bump 后会卡死所有既有 head，需迁移或软返回；`market.move:173-183` `#[test]` 断言 `@soulidity == @0x107`（需八包测试图，独立 `sui move test` 必失败）；`set_state_config` value 无大小上限（2026-05-04 加固建议未落地）；`grant::invalidate_all_for_owner_rotation` 参数未使用；`content.count_by_kind` 永不递减。

**信任假设（非发现）**
- `TransferPolicyCap<Soul>` / `<SoulCollectionRight>`、`KindAdminCap`（可 deprecate 全部 kind 阻断追加）、`UpgradeCap`、`MarketAdminCapV2`、`Display` 对象必须多签持有。
- USDC 为受监管币：Circle 全局暂停/拒绝名单会使市场结算失败。
- Seal key server 可用性与行为（已核实其不限定包版本 → 见 F-1）；Seal 以用户地址为模拟 sender，本包所有 `seal_approve_*` 均以 sender 比对而非依赖 owned-object 输入所有权。
- `animacraft_v8_core/output/runtime/seal` 外部包未审计：`assert_rights_snapshot_v8` 的 1000 bps 上限保证 `quote_animacraft_v8_soul_sale` 不下溢；`bind_native_soul_v8` 快照的 rights 与 `root_rights_v2` 一致（否则原生 Soul 会因 `EAnimacraftNativeCreatorRoyaltyMismatch` 永久不可上架）；`maker_creator` 非 `@0x0`；`MakerLoadoutV8` 能力。

---

## 6. 已验证成立的关键不变量（三路 Claude 审计逐行核对）

| 不变量 | 证据 |
|---|---|
| Kiosk 托管闭环：Soul / Right 只能经 `purchase_with_cap` 离开 kiosk；`TransferRequest` 需三条 receipt，`witness_rule<SoulMarketProof>` 的 proof 仅 market 模块构造 | `market.move:230, 755, 2984, 2164`；framework `kiosk.move` `take` 对 locked / exclusively-listed 拒绝；`transfer_policy.move` `confirm_request` 要求 receipts == rules |
| 无任何 public 函数返回 proof / cap / `TransferRequest` / `KioskOwnerCap`；`SoulListing` / `CollectionListing` key-only，内嵌 `PurchaseCap` 不可取出 | `market.move:189-214, 3000-3010` |
| 单活跃 listing：`list_with_purchase_cap` 断言 `!is_listed`；exclusive Listing 仅 cancel / buy 移除；`is_listed` 与 kiosk listing 同笔翻转 | framework `kiosk.move:216`；`market.move:640, 1644, 1700, 2818 / 1799, 2975, 746` |
| listing ↔ state ↔ kiosk 交叉校验；collection 双侧 id 匹配；V8 与普通 Soul 在 list/buy 两侧互斥 | `market.move:2926-2928, 2956, 1857-1858, 1929-1930, 697-706, 1617/1821` |
| `personal_kiosk::owner(kiosk)` 恒等于 `PersonalKioskCap` 持有者：`OwnerMarker` 由 `create` 一次写入 sender，cap key-only 仅 `transfer_to_sender` | apps `personal_kiosk.move` |
| 单 personal kiosk 注册；注册只经 `rebind` 变更且要求旧 kiosk `item_count == 0` → 无孤儿 Soul | `market.move:984-1016, 3049-3079` |
| 单一 `KindRegistry` / `KioskRegistry` / `MarketConfigV2` / `TransferPolicy<Soul>`：仅 init 构造；三个 OTW 的 `Publisher` 全部 burn，无法再造无规则 policy | `soul.move:140`, `collection.move:83`, `market.move:3145` |
| Witness 不可泄漏：`MintBindingWitnessV8` / `SoulOwnerWitnessV8` 构造均 `public(package)`；`probes/native_witness_private` 编译期证明 | `animacraft_v8_binding.move:33, 52, 61` |
| Seal id 命名空间互斥：content id 75..107 B 前缀 `soul-content:`；upload-recovery 142 B（第 12 字节即不同）；named_loadout / bookmarks 32 B sha256 且绑定 sender；7 个 `seal_approve*` 入口无交叉通过 | `content.move:962, 981, 1004, 1026`, `paid_access.move:656`, `named_loadout_v1.move:72`, `profile.move:263` |
| 文档 id 解析单射：长度 = 75 + name_len 由供给 name 决定；name 字符集排除 0x00；kind/version 大端逐字节比对；nonce 不参与授权 | `content.move:1152-1227` |
| Seal 拒绝正确对象：前 owner（epoch 轮转后）、被撤销/替代 grantee（`active_grant_ids` 移除）、过期/陈旧 epoch 买家、deleted/purged slot、read_mode 位不符 | `soul.move:409-411, 577-578`, `grant.move:451-471`, `paid_access.move:261-271`, `content.move:976-1020` |
| 所有权轮转：`rotate_owner` epoch++，两个调用点均先清零 count；grant 三段校验；paid config/entry 均 epoch-pinned；`EAlreadyHasAccess` 仅对同 epoch 永久 entry | `soul.move:585-608`, `market.move:744-745, 2973-2974`, `paid_access.move:324, 368, 430-433, 445-457` |
| grant 表一致性：push/remove 成对；count 仅对当前 epoch 行递减；`issue` 先清理/替代再 push 避免 `Table::add` 冲突；`revoke_scope` 不可清空 mask；`destroy_invalidated_grant` 条件 `(A && B) || expired` 在 `active_grant_ids` 一致性下正确 | `soul.move:499-517, 573-583`, `grant.move:197-226, 294, 401-412` |
| 支付：`payment.value() == total` 精确等值；bps 合计 ≤ 10000 在 list 与 buy 两处校验；u128 中间值 + 显式 u64 上界；`coin::zero<SUI>` 满足 `min_price = 0` | `market.move:2948, 2138, 2268, 671, 576, 765-797, 2941-2947` |
| mint 身份：`expected_content_id == derive_address(registry, {sender, nonce})`；`derived_object::claim` 单次；`SoulState` 仅经 `share_state`（要求 content 已绑定）共享；初始内容良构在消费任何 Blob 前校验并在结束后复核 | `market.move:2501, 2530-2547`, `soul.move:614-617`, framework `derived_object.move` |
| 内容 op/read 门控读取 slot 缓存，descriptor 仅 `deprecated` 可变；SOUL_DOC 恰一版且不可改；MEMORY 名在所有路径强制；版本 CAS；blob dof key 唯一、purge 恰一次 | `content.move:572, 655-663, 691, 712-732, 847-860, 1127-1136`, `kind_registry.move:358-391, 424-475` |
| 装备 ↔ 上架双向互斥；equipped Soul 不可售、listed Soul 不可装备 | `soul.move:447, 594`, `animacraft_v8_binding.move:52-56` |
| profile / social / community：一人一 profile、handle 唯一且换名干净、`is_registered_profile` 绑 owner↔id、CAS 与溢出守卫、评论冻结、`accept_answer` 作者/类型/父子校验 | `profile.move:176-227, 364-367`, `social.move:79-100`, `community_posts.move:114-175` |

---

## 7. 与 2026-05-04 报告对比

| 旧编号 | 状态 | 说明 |
|---|---|---|
| #2 paid access owner 可撤销 | 仍成立（已接受） | 代码注释（`market.move:2180-2196`）与 CLAUDE.md 已声明为产品边界；本轮不重复计分 |
| #3 paid_access 外层空表残留 | 已修复，确认有效 | `drop_empty_buyer_row`（`paid_access.move:635-642`）在 revoke / cleanup 两路调用 |
| #4 solo listing 后 add_soul 致不可购买 | 已修复，确认有效 | `is_listed` 双写 + `collection.move:207` 守卫 |
| #5 `origin_ref` 未验证 | 仍成立（设计） | 本轮新增 Display 直接渲染该字段的钓鱼面（F-15） |
| #6 personal-join 任意 NFT | 仍为接受设计 | 本轮补充：source id 不入事件（F-23） |
| 加固建议 `set_state_config` 大小上限 | 未落地 | 归入 F-26 |
| Cap 集中化 | 待多签接管 | fresh release 会产生一套新 cap，需按 runbook 移交 |

本轮全部 Medium（F-1 ~ F-6）均为**新增**，旧报告未覆盖：旧报告范围止于 typed-content 重构（2026-05-04），而 Walrus 续期、MEMORY 封顶、grantee 删除不可逆、售前 envelope 破坏、原生 Soul × collection、升级 kill-switch 均属跨模块生命周期与运维视角问题。

---

## 8. 交叉核验纪要

### 8.1 Claude 三路内部重合

| 发现 | 主审计 | market 子审计 | content 子审计 |
|---|---|---|---|
| F-1 kill-switch | ✓ | — | 部分（CT-10 version 断言） |
| F-2 Walrus 续期 | ✓ | — | ✓ |
| F-3 MEMORY 封顶 | ✓ | — | ✓ |
| F-4 软删不可逆 | ✓ | — | ✓ |
| F-5 envelope / 上架期可变 | ✓（Low） | ✓（Medium） | ✓（Low + CT-4） |
| F-6 原生 × collection | ✓（Medium） | ✓（Low） | — |
| F-8 V1 死代码 | ✓ | ✓ | — |
| F-14 装备恢复 | ✓ | ✓ | — |

三路各自独立产出且核心 Medium 项至少两路命中，未出现被驳回的发现；评级分歧（F-5、F-6）由主审计裁定并在详情中说明依据。

### 8.2 Codex（gpt-6.1-sol / ultra）独立审计交叉核验

**运行参数**：`/Applications/ChatGPT.app/.../codex exec`，model `gpt-6.1-sol`，reasoning `ultra`，sandbox read-only，approval never，禁止读取 `docs/audits/` 与代理配置目录；prompt 见 `2026-10-24-worknotes/codex-audit-prompt.md`，原始报告见 `2026-10-24-codex-independent-report.md`。消耗 137,267 tokens；codex 自述逐文件读完 14 个模块与 Move.toml / Move.lock / Published.toml，未读历史审计，未改文件，未运行构建（与 Claude 一致）。

**Codex 发现表（原文）**

| ID | 严重度 | 位置 | 标题 | 置信度 |
|---|---|---|---|---|
| CX-1 | Medium | `collection.move:193`、`collection.move:215` | 集合绑定未检查交易兼容性，可永久阻断 Soul 的现有出售路径 | 高，静态确认 |
| CX-2 | Medium | `content.move:140`、`content.move:715` | 无界版本向量可耗尽单对象容量，永久阻断 MEMORY 追加 | 高，静态确认 |
| CX-3 | Low | `market.move:1574`、`market.move:1590` | 通用配置入口可覆盖或删除内容 envelope 的保留键 | 高，静态确认 |

**逐条核验**

| Codex | 核验结论 | 对应本报告 | 说明 |
|---|---|---|---|
| CX-1 | **Confirmed** | F-6 + F-7 | codex 把"原生 V8 Soul 入 collection"与"版税合计超限入 collection"归并为同一根因（`add_soul` 不校验可交易性），评 Medium。两条路径的行号（`collection.move:193-215`、`soul.move:436-438`、`market.move:600-613 / 563-567 / 1723-1724 / 1751 / 2492-2495 / 1439-1442`）与数值示例（creator 6000 + extra 5000 = 11000 > 10000，admin 降费到 0 仍不可救）均逐行复核成立。本报告保留 F-6 Medium / F-7 Low 的拆分评级，但采纳其"在绑定时校验可交易性"的统一修复口径（§10 必须项 3） |
| CX-2 | **Confirmed** | F-3 | 与三路 Claude 结论一致；codex 额外给出执行层证据：`crates/sui-types/src/object.rs:240-259` 的 `MoveObjectTooBig` 拒绝路径，以及 `table.move:43-61` / `dynamic_field.move:26-33` 证明整个 vector 内联于单个 `Field` 对象。codex 未给出具体阈值（"约数千"），本报告的 ≈3,150 为 Claude 按 81 B/slot 与 256,000 B 上限的计算值 |
| CX-3 | **Confirmed（评级分歧）** | F-5（envelope 部分） | codex 评 Low，理由：需 owner 权限、不绕过 Seal 授权、原 envelope "可能从历史交易或外部副本恢复"。该恢复论点成立（envelope 为确定性公开字节，继任 owner 可从归档节点取历史对象版本后重新 upsert），本报告在 F-5 详情中采纳为缓解项；但 F-5 合并了"上架期间内容不冻结"（删除/purge 不可恢复且买家无原子断言），故整体维持 Medium |

**覆盖对比**

- Codex 3 条发现全部被 Claude 侧覆盖（重合率 3/3）；Codex 未报告 Claude 的 F-1（升级 kill-switch）、F-2（Walrus 续期）、F-4（软删不可逆）及全部 Low / Info 项。两路**无相互驳回**的发现。
- Codex 的"已验证不变量"（§4，17 条）与 Claude §6 一致，并额外独立确认：Blob 托管无公开提取路径、普通费用向上/原生费用向下取整的路由差额不可利用、`derived_object` 调用方使用真实 sender 作 author 并核对预期 id。
- Codex 在 §5 补充了两点 Claude 未单列的限制：(a) `Move.lock:43-47` 根包锁定的 Sui framework rev `2a0bec…` 本机无缓存，`derived_object::claim` 的语义是用其他 framework 版本源码核对的；(b) 其沙箱内 mainnet RPC 因 DNS 失败未能核实历史 V1 对象——该项已由 Claude 经 GraphQL 核实（见 §1：现网为旧一代包，源码为 fresh release）。

**结论**：双引擎交叉的价值体现在 CX-1 的根因归并与 CX-3 的可恢复性论证，但 codex 本轮召回率明显低于 Claude（3 vs 26），未能覆盖生命周期/运维类 Medium 项；建议后续以 Claude 发现清单作为修复基线，codex 用于修复后的 accept 复核。

---

## 9. 范围与限制

- 全程静态审计：未能 `sui move build/test`（F-13），阈值类结论（F-3 的 ≈3,150）为计算值未实测。
- `animacraft_v8_*` 四个外部包未审计，相关结论（F-14、`quote_animacraft_v8_soul_sale` 不下溢、rights 快照一致性）依赖其接口契约。
- Seal key server 行为取自官方源码阅读（`fetch_first_pkg_id` 命名空间、不限定包版本、`simulate_transaction` 以用户地址为 sender），未实测。
- Walrus 续期后的可用性语义与同 `blob_id` 重注册的缓解效果来自 Walrus 文档，未实测。
- `Move.lock` 根包锁定的 Sui framework rev `2a0bec…` 本机无缓存，`derived_object::claim` 单次声明语义以其他 framework 版本源码核对（codex 亦指出此点）。
- 本报告针对待发布新包源码；mainnet 现网 `0xa43c…` 旧包未重新审计。

---

## 10. 建议优先级

**必须项（发布前）**
1. F-1：加 `ProtocolGate`/版本门控覆盖 content / grant / paid_access / collection 全部入口与 `seal_approve_*`。
2. F-5：四个 `set/delete_state_config*` 复用保留前缀断言；content / envelope / config mutator 在 `is_listed` 时中止。
3. F-6 + F-7：`add_soul` 断言 `!has_animacraft_provenance` 与合并 bps 上限。
4. F-2：提供 `extend_content_blob`（或改 `SharedBlob` 托管）；append 断言 Blob 已认证并记录 `end_epoch`。
5. F-4：owner-only `restore_deleted_version`；agent 删除权独立 scope/op 位。
6. F-3：版本存储改为每版本独立对象（`Table<u64, ContentSlot>` / `TableVec`）。
7. F-8 + F-13：删除 V1 死代码并把测试迁到 V2；依赖改 git rev / vendoring 使 CI 可从干净 checkout 构建。

**可选项（可分批）**
- F-9 / F-10 / F-11 / F-12 / F-15 / F-17 / F-24 的小型加固；F-16 / F-19 / F-21 / F-25 文档化；F-18 / F-20 / F-22 / F-23 产品与索引层处理。

---

## 11. 修复纪要（2026-10-24 fix pass，claude-fixer）

**范围**：§10 必须项 1-3（F-1 / F-5 / F-6 / F-7），顺带收口 F-9。方法：TDD（每项先写失败测试、观察 RED、再最小实现）；在 scratch 八包测试图（animacraft 公开仓库 HEAD `5fb13fa`，地址 0x100..0x107，CI 同款）用 CI 钉死的 `sui 1.80.1-671ba71e69c7` + `--warnings-are-errors` 运行：基线 429/429 → 修复后 468/468（新增 17 + 15 + 7 条）→ codex 建议补强后 **522/522**（再增 54 条，见 §11.2）。sui 1.70.1 下 429 条全部失败，证实必须使用 CI 版本。

| 发现 | 状态 | 实现 | 测试 |
|---|---|---|---|
| F-1 | **Fixed** | 新模块 `protocol_gate.move`：共享单例 `ProtocolGate { version, paused }` + `ProtocolGateCap`（init 创建）；`assert_live` 先校验 version 再校验 paused；`set_paused` / `migrate`（仅新版本包可推进，旧 bytecode 无法重放）。content 9 个入口、grant 8 个、paid_access 4 个、named_loadout_v1 3 个全部新增 `gate: &ProtocolGate` 并首行 `assert_live`；`seal_approve_*` 的 gate 位于 `id` 之后（Seal 要求 id 为首参） | `protocol_gate_tests.move`（17）：gate 语义 8 条 + 每模块"paused/stale 先于其它校验中止"8 条 + 正向 1 条 |
| F-5 | **Fixed** | `market::set/delete_state_config(_v2)` 复用改名后的 `assert_state_config_key_unreserved`（码 82 不变，常量改名 `EStateConfigKeyReserved`）；content 5 个 mutator 与 market `set/delete_state_config(_v2)`、`set/clear_active_content(_v2)` 在 `is_listed` 时中止（`content::ESoulListed=37`、`market::ESoulListedForMutation=83`）；Seal 读取不冻结 | `listing_freeze_tests.move`（15）：owner/agent 五类 mutator 上架期中止、取消后恢复、上架期 seal 读仍通过、四个 market 包装器中止、保留键 set/delete/裸前缀/真实 envelope 四种拒绝、非保留键正常 |
| F-6 | **Fixed** | `collection::add_soul` 断言 `!has_animacraft_provenance`（`ENativeSoulNotCollectable=8`）并改为 `public(package)` | `collection_tradeability_tests.move`（7）：原生 Soul 经包装器与直接包内调用均拒绝 |
| F-7 | **Fixed** | 新 `market::add_soul_to_collection_v2(config, collection, state, ctx)`：`primary_enabled` + `platform + creator + extra ≤ 10000` 后委托 `collection::add_soul` | 同上：9750+500+250 拒绝、9250+500+250 边界通过、primary 关闭拒绝、listed 仍拒绝、普通 Soul 计 supply |
| F-9 | **Fixed（顺带）** | `paid_access::configure/update/delete_paid_access_kind` → `public(package)`，只能经 market `_v2` 包装器（primary gate）调用 | 既有 `protocol_tests` / `access_mutation_snapshot_tests` 的包内直接调用保持编译 |

**未在本轮处理**：F-2（Walrus 续期）、F-3（MEMORY 存储结构）、F-4（undelete）、F-8/F-13（删 V1、依赖 git rev）及全部 Low/Info。

### 11.1 ABI 变更清单（SDK / web 必须同步，否则新包发布后对应功能不可用）

1. **新共享对象** `soulidity::protocol_gate::ProtocolGate`（publish 时由 `init` 创建）与 `ProtocolGateCap`（落 deployer，需随其它 cap 移交多签）。deployment manifest 需新增 `protocolGateId`；运维需 `set_paused` / `migrate` 的调用脚本。
2. **签名新增 `gate: &ProtocolGate`**（非 seal 函数放首位；`seal_approve_*` 放 `id` 之后）：
   - `content::append_version_as_owner` / `append_version_as_granted_agent` / `delete_version_as_owner` / `delete_version_as_granted_agent` / `purge_deleted_version_as_owner` / `seal_approve_content_owner` / `seal_approve_content_granted_agent` / `seal_approve_content_public` / `seal_approve_upload_recovery`
   - `grant::issue` / `issue_to_grantee` / `revoke` / `revoke_scope` / `revoke_scope_to_grantee` / `cleanup_inactive_grants` / `set_grant_capacity` / `destroy_invalidated_grant`
   - `paid_access::add_access` / `revoke_access` / `cleanup_stale_entries` / `seal_approve_content_paid_access`
   - `named_loadout_v1::save` / `update` / `seal_approve`
3. **可见性收窄**：`paid_access::configure_paid_access_kind` / `update_paid_access_kind` / `delete_paid_access_kind` 与 `collection::add_soul` 改为 `public(package)`；钱包改用 `market::configure/update/delete_paid_access_kind_v2` 与新 `market::add_soul_to_collection_v2(config, collection, state)`。
4. **新错误码**：`protocol_gate` 0 版本不匹配 / 1 已暂停 / 2 cap 不匹配 / 3 无需迁移；`content::ESoulListed=37`；`market::ESoulListedForMutation=83`，`EStateConfigKeyReserved=82`（原 `EInitialEnvelopeConfigReserved` 改名，码不变）；`collection::ENativeSoulNotCollectable=8`。
5. **行为变化**：Soul 上架期间 content / envelope / config / active-binding 的一切写入中止，卖家须先取消 listing（UI 需提示）；Seal 审批 PTB 必须带 gate 共享对象输入；owner 不能再经通用 config 写入/删除 `content_seal_envelope_v1:*`。
6. **已识别的 TS 调用点**（需改）：`packages/soulidity-sdk/src/tx/*`（grant / content / paid access / kiosk 构建器）、`packages/soulidity-sdk/src/private-named-loadout.ts:204`（seal_approve）、`web/lib/soulidity/browser-content-access.ts` 与 `browser-content-open.ts`（四个 content seal 审批 PTB）、`web/lib/soulidity/soul-authoring-transaction.ts`（`collection::add_soul`）、`web/app/api/collections/[id]/add-soul/route.ts`、`packages/soulidity-sdk/src/deployment-manifest.json`（新增 gate id）。

### 11.2 Codex accept 复核

**运行参数**：`gpt-6.1-sol` / reasoning `xhigh`（review-fix 流程规定值）/ read-only / 135,037 tokens；prompt 与原始报告见 `2026-10-24-worknotes/codex-accept-{prompt,review}.md`。

**结论：PASS WITH NITS** — F-1 / F-5 / F-6+F-7 / F-9 全部 **ACCEPT**，无 Blocker / Major，未发现本轮 diff 削弱任何既有不变量。codex 独立逐行确认：24 个入口全部接入 gate 且 `assert_live` 为首条语句；保留前缀无可达旁路（含裸前缀）；上架冻结覆盖 content 5 个 mutator 与 market 8 个 V1/V2 包装器且均早于任何写入/事件；package-only 的 mint 路径不构成冻结绕过；mint / buy / cancel 未被误伤；`migrate` 推进后旧 bytecode 不可回退。

| codex 保留意见 | 严重度 | 处理 |
|---|---|---|
| gate 入口测试矩阵不完整（stale 仅 `grant::issue`，paused 仅 8 个入口） | Minor | **已补**：`protocol_gate_tests.move` 新增 18 个入口 × paused/stale 双模式共 36 条（含 `destroy_invalidated_grant`、`named_loadout_v1::save` 外部 fixture），以及 stale+paused 优先报版本错误、`migrate` 拒绝高于本包版本、迁移保持 paused 共 3 条 |
| `native_cutover_policy_tests.move:12` 仍称 collection 问题 OPEN | Nit | **已改**：指向 `collection_tradeability_tests.move` |
| `protocol_gate.move` 头注释 "every mutation" 过宽 | Nit | **已改**：明确 24 个直接公开入口 + Seal 审批，market 与 mint 路径由 `MarketConfigV2` 门控 |
| 建议补 F-5 V1 包装器、真实 list→cancel 生命周期、上架期间 public/granted/paid Seal 读取、F-9 包装器回归 | 建议 | **已补**：`listing_freeze_tests.move` +9（V1 包装器 6、三类 Seal 读取 3）；`protocol_tests.move` +2（真实 `list_soul_fixed_price` 后 memory 追加被拒 / `cancel_soul_listing` 后恢复）；新 `paid_access_config_gate_tests.move` +4 |

补强后全套 **522/522**（基线 429 + 新增 93）。补强仅涉及测试与注释，生产代码未变，故未再跑第二轮 codex accept。

**codex 的边界提醒（采纳）**：这些 public 签名与可见性变更不能作为现网包的兼容升级，新模块的 `init` 也不会在升级时执行——与本报告 §1 "fresh release" 定位一致；SDK/web 迁移与新包部署不在本次 ACCEPT 范围内（见 §11.1 清单）。

### 11.3 TypeScript ABI 同步（codex-fixer）与 Claude accept 复核

**角色**：codex（`gpt-6.1-sol` / reasoning `ultra`，workspace-write）按 §11.1 清单同步 `packages/soulidity-sdk` / `web` / `desktop`；Claude（Fable 5.1）accept 复核：只读审查全部生产 diff + 独立重跑验证。codex 的规格、TDD 证据与逐文件清单见 `2026-10-24-typescript-abi-sync.md`。

**结论：ACCEPT**（无 Blocker / Major；2 条部署约束 + 1 条跨仓库跟进，见文末）。

**逐项核验**（每个 TS 调用点对照 Move 源码签名比对参数位置与个数）：

| §11.1 条目 | 核验结果 |
|---|---|
| 1 新共享对象 / manifest | `deployment-manifest.json` 双网络 `protocolGateId: ""`（不虚构未部署 ID）；`SoulidityDeployment.protocolGateId`；新 env `NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID`（显式 env 优先于 manifest；浏览器侧用静态属性读取，有 esbuild 真实 bundle 测试）；客户端部署签名纳入 gate |
| 2 gate 参数（25 个签名） | SDK 22 个 gated 调用点 + web / desktop / `e2e-agent-decrypt.ts` 的 Seal PTB 全部 gate 位置正确（非 seal 首位；seal 在 `id` 之后），参数个数与 Move 一致：append 12/13、delete 7/9、purge 7、issue_to_grantee 6、set_grant_capacity 4、revoke 4、revoke_scope_to_grantee 5、destroy_invalidated_grant 4（gate, grant, state, clock）、cleanup_inactive_grants 4、add_access 9、revoke_access 5、cleanup_stale_entries 5、save 13、update 9、named seal_approve 4、seal_approve_content_* 7/9、seal_approve_upload_recovery 2。`grant::issue` / `revoke_scope` 无 TS 调用方（现有调用走 `*_to_grantee`），未新增无调用方 API |
| 3 可见性收窄 | `collection::add_soul` 的 TS 残留 0；SDK 单个 / 批量绑定、`tx/publish.ts`、web `soul-authoring-transaction.ts` 均改为 `market::add_soul_to_collection_v2(config_v2, collection, state)`；paid config 继续走 `*_v2` 包装器（测试钉住 ABI） |
| 4 新错误码 | `market` 82 / 83、`collection` 8、`content` 37、`protocol_gate` 0–3 全部进 catalog；四个解析器都按模块名限定（`Identifier("<module>")` 或 `::<module>::`），不同模块同码不会串台；`enhanceSoulidityError` 串联 market → collection → content → protocol_gate |
| 5 行为变化 | `resources/smart-contracts`、`resources/user-guide` 写明上架期间内容 / config / active-binding 写入冻结、须先取消 listing、Seal 读取不受影响；`collection-bind-preflight` 新增原生 provenance、合并费率 > 100%、primary 暂停、批量容量预检（并对 V2 config 做二次稳定读），`use-publish` 两处调用均传入候选 Soul（fresh mint 恒无原生 provenance，与 `soul.move` 仅在 Animacraft 绑定路径写入 provenance 一致） |
| 6 调用点清单 | 清单 6 处全部覆盖；额外覆盖 desktop `content-access.ts`、`walrus-batch-seal.ts`（upload recovery seal）、以及 append-preparation / content-mutation-plan / soul-access-plan / private-loadout 等严格运行上下文：gate 入 scope 与 `exact` 键集、历史重放把 gate 作只读共享输入校验（仅 gated 动作读取 gate，与 Move 门控面一致）、对象别名检查含 gate |

**测试强度**：测试 diff 删除 27 条 `expect` / 新增 71 条；删除项全部是参数位移重写（如 named loadout `save` 12 → 13 参数逐位断言整体 +1、`update` 8 → 9、approval 3 → 4、`add_soul` → `add_soul_to_collection_v2`），无 `.skip` / `.only` / `.todo`；新增 6 个测试文件（SDK gate 构建器 24 条、collection V2 ABI、严格运行上下文、desktop 与 e2e 脚本四类 Seal PTB、浏览器 bundle 静态 env）。

**独立重跑验证**（Claude，worktree 内）：

| 命令 | 结果 |
|---|---|
| `sui move test --warnings-are-errors`（sui 1.80.1） | 522/522；`git status -- move/` 与 fix pass 一致，codex 未触碰 Move |
| `npm test`（首轮，`_paired/animacraft` 已就位，desktop pnpm 工作区未安装） | 588/589 suites、12,447 tests 通过；唯一失败 `tests/desktop/read-file-xlsx.test.ts` 缺 `write-excel-file/node`（与 ABI diff 无关，该文件未改） |
| desktop 依赖按 CI 配方 `pnpm install --frozen-lockfile` 后重跑该 suite | 通过 |
| `npm test`（补齐全部依赖后的确认跑） | 589/589 suites、12,448/12,448 tests，exit 0（299 s） |
| `npm run typecheck`（root + web） | exit 0 |
| `tsc --noEmit -p packages/soulidity-sdk/tsconfig.json` | exit 0 |
| desktop renderer `tsc --noEmit -p tsconfig.web.json`（`build:shared` / `build:backend` 后） | 0 errors |
| `git diff --check` | 通过 |

codex 报告的 10 个浏览器 suite 失败（Chrome/CDP 启动 SIGABRT）与 1 个 desktop 依赖缺失均为 codex 沙箱环境问题：无沙箱重跑 Chrome 全部通过，305 条 "skipped" 实际全部执行并通过。

**部署约束 / 跟进**（不阻塞 accept）：
1. **部署顺序**：web / desktop 现在硬依赖 gate——服务端 `web/lib/soulidity/access.ts` 与所有浏览器 gated 流程在 gate env 为空时明确报错（fail-closed）。web 必须与 fresh publish 同批上线并填入 `NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID` / manifest `protocolGateId`；先于新包上线会令 sealed content API 与 grant / content / paid / loadout 写入全部失败。
2. **跨仓库**：`scripts/sync-vercel-production-env.ts` 的 `PRODUCTION_CHAIN_ENV_KEYS` / `REQUIRED_ID_KEYS` 现要求 Animacraft `export-config --format soulidity-env` 输出含 `NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID`；配对仓库 `animacraft/scripts/mainnet-v8-release.mjs`（HEAD `5fb13fa`）的导出键集尚无该键，`mergeProductionChainEnv` 会整体拒绝导出文件，直至 animacraft 侧补齐。
3. **未做链上 / 真实服务验收**：无链上执行、真实 Seal key server、真实钱包签名；新包发布后需跑 e2e（`web/scripts/e2e-agent-decrypt.ts` 签名已同步）。
4. 部署签名纳入 gate：部署后已有本地客户端会话失效需重建（预期）。

**本轮改动**：99 个 TS / 配置 / 文档 / 测试文件（清单见 codex 文档），Move 0 个；全部未 commit。
