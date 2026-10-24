# Codex Accept 复核 — 2026-10-24 fix pass

## 1. 结论：PASS WITH NITS

| 项目 | 裁定 | 结论 |
|---|---|---|
| F-1 | **ACCEPT** | 24 个对外 mutator/Seal 入口全部接入 gate，检查顺序正确；迁移与 cap 绑定成立。 |
| F-5 | **ACCEPT** | envelope 保留前缀及上市期间的 content/config/active-binding 写入口均已封堵。 |
| F-6+F-7 | **ACCEPT** | native Soul 在底层拒绝；唯一生产绑定入口提前检查 primary 与合并费用上限。 |
| F-9 | **ACCEPT** | 可见性收窄有效，未发现 package 外 Move 调用方被遗漏。 |

未发现 Blocker/Major，也未发现本轮 diff 削弱既有权限或状态不变量。保留意见集中在测试覆盖和过时注释。

本轮为静态复核，未运行 Move 测试。`429/429 → 468/468` 是 fixer 提供的运行结果；本轮独立确认新增测试为 **17+15+7=39**，tracked diff 的 `git diff --check` 通过。

验收沿用原 F-1“发布前落地”的边界。这些 public 签名和可见性变更不能作为现有包的兼容升级；新增模块的 `init` 也不会在升级时执行。SDK/web 迁移和新包部署不在本次 ACCEPT 内。[Sui 官方升级规则](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)

## 2. 发现

以下路径均相对于 `move/soulidity/sources/`。

| 严重度 | 位置 | 问题 | 修复建议 |
|---|---|---|---|
| **Minor** | `protocol_gate_tests.move:129` | gate 调用测试只覆盖 8 个不同入口，stale gate 仅覆盖 `grant::issue`。删掉 `revoke`、`destroy_invalidated_grant`、public/granted Seal 等入口的 gate 检查，现有新增测试仍可能通过。源码当前正确，但测试未锁住完整覆盖面。 | 补齐高风险遗漏入口的 paused/stale 用例，并加入“stale 且 paused 时优先返回版本错误”及高版本 gate 不可降级的用例。 |
| **Nit** | `native_cutover_policy_tests.move:12` | 仍称 collection 问题为 OPEN，并声称 `add_soul` 成功后 native listing 才拒绝；已与本轮修复冲突。 | 更新该注释，指向新的 wrapper/direct-package 拒绝测试。 |
| **Nit** | `protocol_gate.move:1` | “every … mutation”表述过宽。mint-time append、active-binding、paid-access config/购买记录等 package-only 路径仍由 market 门控管理。 | 明确写成“24 个直接公开入口与 Seal 审批”；列出 market 路径采用独立门控，避免把 `set_paused` 理解为停止全部 package 写入。 |

## 3. 已验证成立的点

**F-1：入口清单完整。** 下列每个函数都接受 `&ProtocolGate`，且首个执行语句均为 `protocol_gate::assert_live(gate)`；普通函数 gate 为首参，Seal 函数保持 `id` 为首参、gate 紧随其后。

| 文件 | 已核对的全部入口，括号为声明行号 |
|---|---|
| [content.move](move/soulidity/sources/content.move) | `append_version_as_owner`（449）、`append_version_as_granted_agent`（486）、`delete_version_as_owner`（765）、`delete_version_as_granted_agent`（791）、`purge_deleted_version_as_owner`（846）、`seal_approve_content_owner`（982）、`seal_approve_content_granted_agent`（1003）、`seal_approve_content_public`（1028）、`seal_approve_upload_recovery`（1052） |
| [grant.move](move/soulidity/sources/grant.move) | `issue`（184）、`issue_to_grantee`（252）、`revoke`（266）、`revoke_scope`（286）、`revoke_scope_to_grantee`（345）、`cleanup_inactive_grants`（358）、`set_grant_capacity`（375）、`destroy_invalidated_grant`（402） |
| [paid_access.move](move/soulidity/sources/paid_access.move) | `add_access`（504）、`revoke_access`（571）、`cleanup_stale_entries`（602）、`seal_approve_content_paid_access`（663） |
| [named_loadout_v1.move](move/soulidity/sources/named_loadout_v1.move) | `save`（169）、`update`（190）、`seal_approve`（73） |

- **单例与迁移成立。** `protocol_gate.move:48` 是唯一生产构造入口；额外构造和版本修改函数均为 `#[test_only]`。`assert_live` 在 67 行先查版本、68 行再查 paused。`set_paused` 和 `migrate` 分别在 72、81 行先校验 `cap.gate_id`，再修改状态或发事件。迁移要求 `self.version < VERSION`：推进后，旧字节码无法回退 gate；旧 `set_paused` 即使由合法 cap 调用，也不能恢复旧版本的 `assert_live`。

- **保留前缀没有可达旁路。** `market.move:1552、1569、1617、1634` 覆盖 V1/V2 的 set/delete；`market.move:2622` 保留 mint-time 校验。前缀比较包含裸 `content_seal_envelope_v1:`，也拒绝其任意后缀。生产 `soul::upsert_state_config` 调用仅来自这些受保护路径、私有 mint 初始化，以及 `content.move:542` 的 append envelope 持久化。

- **上市冻结覆盖完整。** content 五个 mutator 在 `content.move:467、504、778、805、859` 检查 listed，均早于 slot、Blob、envelope 或事件操作。market 八个 V1/V2 config/active-binding 包装器均在委托或写入前检查 listed（`market.move:1524、1538、1553、1570、1589、1603、1618、1635`）。

- **package-only 路径未形成冻结绕过。** `content::set_active/clear_active` 的生产调用方仅为上述包装器及 mint 初始化；`append_initial_*` 仅用于新建 state。新 state 在 `soul.move:359` 初始化为未上市，mint 仍可写 envelope 和设置 active binding。未发现把现有上市 state 传入初始化逻辑的公开路径。

- **有意保留的写入不属于 F-5 的出售内容面。** `named_loadout_v1::update` 写入 owner/epoch 私有 head（`named_loadout_v1.move:161`），不改 content/envelope/config/active binding。paid-access config 写入独立价格配置及授权表，也不能修改上述内容；它们上市期间仍可调用，与当前修复范围一致。

- **F-6/F-7 检查先于绑定。** `market.move:1494` 检查 primary，1495 行起将三项费用分别提升为 `u64` 后求和，使用 `<=10000`。`collection.move:215` 在 supply 增加和绑定前拒绝真实 native provenance；原有 creator、owner、listed、supply 检查仍在。

- **F-9 与调用方完整。** `paid_access.move:309、353、397` 均为 `public(package)`。仓库内生产 Move 调用方只有 market 的六个 V1/V2 包装器；V2 在 `market.move:2365、2413、2444` 先检查 primary。V1 仍受自身 paused 控制，未发现新鲜发布路径构造生产 V1 config。

- **mint/buy/cancel 未被误伤。** mint 初始化未新增 gate 参数；`grant::invalidate_all_for_owner_rotation`（`grant.move:451`）保持 package-only，成交清理不依赖 gate。cancel 在 `market.move:1836` 清除 listed；两条成交路径在 `market.move:745` 和 3014 行清理 grant、轮转 owner，再清除 listed。

- **改动最小性基本成立。** 未删除既有授权、CAS、scope、epoch 或内容身份检查；错误码 82 保留，新常量没有模块内数值碰撞。六个既有测试文件主要是 live gate 参数接线，未发现放宽原断言；正常返回路径均处理了新增 gate。

## 4. 测试覆盖评估（缺失用例列表）

**核心行为覆盖有效，但尚不是完整回归矩阵。**

- **17 个 gate 测试**覆盖初始化、pause/unpause、版本拒绝、cap 不匹配、迁移成功及重复迁移拒绝。入口负向测试指定了 abort module/code，并以 `abort 99` 防止意外成功，能够检测被覆盖入口的 gate 检查缺失。
- **15 个 freeze 测试**覆盖五类 owner/agent content 写入、V2 四个包装器、保留键 set/delete、裸前缀、非保留键和上市期间 owner Seal 读取。尤其 `delete_state_config_v2` 已覆盖，不能列为缺失。
- **7 个 collection 测试**覆盖普通成功、native wrapper/direct-package 拒绝、费用超限、**恰好 10000**、primary 关闭及 listed 拒绝。这两个重点边界已实际存在。

建议补充的缺失用例：

1. **F-1 入口矩阵**：paused/stale 下的 `revoke`、`destroy_invalidated_grant`、其余 grant 清理/容量入口、content public/granted Seal、paid revoke/cleanup、named save/Seal。
2. **版本顺序与迁移**：stale+paused 同时存在；`gate.version > VERSION` 时 `migrate` 拒绝；paused 状态迁移后仍保持 paused。
3. **F-5 V1 包装器**：reserved prefix 的 set/delete，以及四类 listed 拒绝。当前只能由静态检查确认。
4. **F-5 实际生命周期**：真实 list → 写入拒绝 → `cancel_soul_listing` → 写入恢复。现有“取消后恢复”测试在 `listing_freeze_tests.move:119` 直接翻转标志，仅验证标志语义。
5. **上市期间其他 Seal 读取**：public、granted-agent、paid-access；目前新增用例只验证 owner。
6. **F-9 回归锁定**：三个 `_v2` config 包装器在 primary=false 时拒绝、true 时正常；另加外部 package 的编译负向 probe，锁定四个收窄函数不能被外部 Move 模块调用。

未发现新增测试编码错误行为。named-loadout 上市期间仍可更新的既有测试符合其私有 owner/epoch 设计。当前证据足以接受源码修复，尚不足以声称“所有入口及升级生命周期均已由运行测试覆盖”。