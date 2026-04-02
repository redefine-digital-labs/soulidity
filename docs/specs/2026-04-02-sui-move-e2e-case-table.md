# Soulidity Sui Move 合约端到端测试用例表

## 目标

把 [SOULIDITY_PRD.md](/Users/admin/Desktop/nao/clawnews/docs/specs/SOULIDITY_PRD.md) 与 [logic-diagram.html](/Users/admin/Desktop/nao/clawnews/docs/specs/logic-diagram.html) 核对后，收敛成一份可直接指导 `move/soulidity` 包编写端到端测试的用例表。

本文只覆盖当前 Move 合约可验证的链上行为，不覆盖前端导航、登录、回跳、筛选、社区 UI 等纯前端流程。

## 核对结论

已观察事实：
- 两份文档对以下主链路基本一致：`Soul` 铸造、`SoulCollection`/`SC`、`SoulGrant` 单活授权、Soul 转移后 grant 自动失效、Import、Personal Join、Walrus Memory 追加写。
- 当前合约包已落地的核心模块为 `soul`、`collection`、`grant`、`memory`、`market`、`seal_policy`，并已有 3 条协议级测试：过期 grant 不可在售后继续使用、SC 持有人拿到额外版税、import/personal join 溯源。

基于证据的推断：
- 这轮 Move E2E 应以“对象状态变更 + 资金分配 + 事件/权限断言”为主，不应直接照搬 UI step 数。
- `logic-diagram.html` 比 PRD 多补了若干合约级约束，尤其是 `listing` 期间 grant 仍有效、memory append-only、原 NFT 不变更、SC 持有人只拿版税不拿 Soul 数据权限。

已定口径差异：
- `creator_royalty_bps` 计入所有 Soul 购买总价，包括创作者首售；首售时 surcharge 不单独拆出 royalty coin，而是随卖家收款一起流向 creator。

待确认差异：
- `logic-diagram.html` 写了平台费 `2.5%` 且提到 `Solana USDC relayer`，当前 Move 包只有 Sui 上的 `Coin<USDC>`，平台费也是可配置且默认 `0`。
- 文档里有 `Collection Expand` 概念，但当前合约只实现了 `Personal Join`，没有整集合扩展能力。

## Move E2E 范围外

以下内容不应进入当前 Move 端到端测试主表：
- Privy / 外部钱包登录、断连回跳、`pending buy`
- 市场搜索、筛选、社区 feed、Space 页面
- `Collection Expand` 整集合扩展 UI
- Solana USDC 中继/跨链支付
- 页面 breadcrumb、步骤数、按钮文案

## 测试用例表

| ID | 场景 | 来源核对 | 前置条件 | 链上操作 | 核心断言 | 建议模块/入口 | 优先级 | 现状 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 原生 Soul 铸造到个人 kiosk | PRD + Logic 一致 | 已初始化协议；创作者已注册 personal kiosk；准备 `protected_blob`，可选 `founding_memory_blob` | 调 `market::mint_native_in_personal_kiosk` | 生成 `Soul`、`SoulState`、`SoulMemory`；`current_owner == creator`；`current_kiosk_id == creator_kiosk`；`provenance_kind == native`；若传 founding memory，则 `entry_count == 1` | `market.move` + `soul.move` + `memory.move` | P0 | 待补 |
| TC-02 | Import Soul 保留 imported provenance | PRD + Logic 一致 | 创作者有 personal kiosk 与 Walrus blob | 调 `market::mint_imported_in_personal_kiosk` | `provenance_kind == imported`；`origin_ref` 写入；导入后对象可按普通 Soul 继续 listing/grant | `market.move` + `soul.move` | P0 | 已有部分覆盖：`import_and_personal_join_set_expected_provenance` |
| TC-03 | Personal Join 生成独立 Soul layer 且不改原 NFT | PRD + Logic 一致 | 创作者 kiosk 中已放入第三方 NFT；已准备 blob | 调 `market::mint_joined_in_personal_kiosk<T>` | `provenance_kind == personal_join`；`origin_ref` 写入；原 NFT 仍留在 kiosk；新 Soul 可独立存在 | `market.move` + `soul.move` | P0 | 已有部分覆盖：`import_and_personal_join_set_expected_provenance`，但尚未显式断言原 NFT 仍在 |
| TC-04 | 创建可交易 SC 并绑定创作者自己的 Soul | PRD + Logic 一致 | 创作者已有 Soul 与 personal kiosk | 调 `market::create_collection_in_personal_kiosk` 后再调 `collection::add_soul` | `SoulCollection.current_holder == creator`；`tradeable == true`；Soul `collection_id` 被绑定；触发 `SoulAddedToCollection` | `market.move` + `collection.move` + `soul.move` | P0 | 待补 |
| TC-05 | 非可交易 SC 永久不可上架 | PRD + Logic 一致 | 已创建 `tradeable = false` 的 collection | 调 `market::list_collection_right_fixed_price` | 失败并报 `collection::ECollectionLocked`；`current_holder` 不变 | `collection.move` + `market.move` | P0 | 待补 |
| TC-06 | SC 购买只转移版税权，不转移 Soul 所有权或数据权限 | PRD 明确，Logic 补强 | 已有 collection、已绑定 soul、SC 已售给 holder | holder 购买 `SoulCollectionRight` 后尝试以 holder 身份访问 Soul owner/grant 能力 | `collection.current_holder == holder`；Soul `current_owner` 不变；holder 不能 `append_as_owner`，也不能走 `seal_approve_owner`；未获 grant 时也不能走 granted-agent 路径 | `market.move` + `collection.move` + `memory.move` + `seal_policy.move` | P0 | 待补 |
| TC-07 | SoulGrant 首次签发成功 | PRD + Logic 一致 | Soul 已存在，当前 owner 为创作者/买家 | 调 `grant::issue` | `active_grant_id` / `active_grantee` 写入；grant 绑定正确 `soul_id`、`issued_by`、`grantee` | `grant.move` + `soul.move` | P0 | 待补 |
| TC-08 | SoulGrant 重签发时自动顶掉旧 grant | PRD + Logic 一致 | 已有 grant A | owner 再签发 grant B | state 中 `active_grantee == B`；旧 grant 在 `grant::assert_active` 或 `memory::append_as_granted_agent` 路径失败，报 nonce/epoch 不匹配 | `grant.move` + `memory.move` | P0 | 待补 |
| TC-09 | SoulGrant 主动 revoke 后失效 | PRD + Logic 一致 | 已有 active grant | owner 调 `grant::revoke`，随后旧 grantee 再尝试访问 | `active_grant_id/active_grantee` 清空；旧 grant 无法继续 `append_as_granted_agent` 或 `seal_approve_granted_agent` | `grant.move` + `memory.move` + `seal_policy.move` | P0 | 待补 |
| TC-10 | SoulGrant 到期后失效 | PRD 明确 | grant 设置 `expires_at_ms`；有可控制的 `Clock` | 在到期前后分别走 `append_as_granted_agent` 或 `seal_approve_granted_agent` | 到期前成功，到期后报 `grant::EGrantExpired` | `grant.move` + `memory.move` + `seal_policy.move` | P1 | 待补 |
| TC-11 | Soul 上架期间 owner 不变且 active grant 不被清空 | Logic 明确 | Soul 已有 active grant；owner 已注册 kiosk | 调 `market::list_soul_fixed_price`，未成交前检查 state | `current_owner` 仍为 seller；`ownership_epoch` 不变；原 `active_grant_id` 仍有效；cancel 后仍可继续使用该 grant | `market.move` + `grant.move` + `soul.move` | P0 | 待补 |
| TC-12 | Soul 成交后所有权轮转并自动清 grant，新 owner 从无 grant 开始 | PRD + Logic 一致 | Soul 已上架且带 active grant；buyer 已注册 kiosk 并持有足额 USDC | 调 `market::buy_soul_fixed_price` | `current_owner == buyer`；`current_kiosk_id == buyer_kiosk`；`ownership_epoch + 1`；`active_grant_id/active_grantee` 清空；旧 grant 在后续 Seal/Memory 路径失败 | `market.move` + `soul.move` + `grant.move` | P0 | 已有部分覆盖：`stale_grant_cannot_be_used_after_soul_sale` |
| TC-13 | 二级转售时创作者拿到 creator royalty | PRD + Logic 一致 | Soul 创作者与当前 seller 不同；Soul 未绑定 collection；buyer 持有足额 USDC | seller 调 `list_soul_fixed_price`，buyer 调 `buy_soul_fixed_price` | 创作者收到单独 royalty coin；seller 收到剩余款；`SoulPurchased.creator_royalty > 0` | `market.move` | P0 | 待补 |
| TC-14 | 绑定 collection 的 Soul 转售时，SC holder 收到 extra royalty | PRD + Logic 一致 | collection 已售给 holder；Soul 已绑定该 collection；seller 为 Soul 当前 owner；buyer 持有足额 USDC | 调 `market::buy_soul_fixed_price_with_collection` | holder 收到 `collection_royalty`；创作者仍保留 creator royalty；Soul ownership 正常轮转 | `market.move` + `collection.move` | P0 | 已有覆盖：`collection_holder_receives_extra_royalty_on_soul_resale` |
| TC-15 | Memory 仅允许 owner 或 active granted agent 追加，且 entry_count 单调递增 | PRD + Logic 一致 | 已有 SoulMemory；owner 与 active agent 各有 blob | 分别调 `memory::append_as_owner`、`memory::append_as_granted_agent` | 两条追加都成功；`entry_count` 连续递增；未授权第三方追加失败；不存在删除/覆盖路径 | `memory.move` + `grant.move` | P1 | 待补 |
| TC-16 | Seal owner / granted-agent 审批都必须绑定正确 document id | Logic 明确 | 已构造正确与错误 `document_id`；可选 active grant | 分别调 `seal_approve_owner` / `seal_approve_granted_agent` | 错误前缀、版本、soul_id 或长度时报错；正确 id + 正确身份才通过 | `seal_policy.move` | P1 | 待补 |
| TC-17 | 只有 collection creator 能加 Soul，且 Soul creator 必须一致 | PRD + Logic 一致 | 已有 collection；准备同创作者 Soul 与异创作者 Soul | 非 creator 调 `add_soul`；creator 对异 owner/异 creator Soul 调 `add_soul`；creator 对已绑定 Soul 再次绑定 | 非 creator 失败；异 creator 失败；重复绑定失败；只有“collection creator + soul creator 一致 + 尚未绑定”成功 | `collection.move` + `soul.move` | P1 | 待补 |
| TC-18 | 创作者首售总价包含 creator royalty surcharge | 口径已定，以实现为准 | Soul 由 creator 首次上架；buyer 持足额 USDC | 执行 `quote_soul_purchase` 与 `buy_soul_fixed_price` | `total == price + platform_fee + creator_royalty`；首售买家需支付全额；creator 最终收到包含 surcharge 的全部卖家收款 | `market.move` | P1 | 待补 |

## 建议落测顺序

1. 先补 P0 主链路：`TC-01`、`TC-04`、`TC-05`、`TC-06`、`TC-07`、`TC-08`、`TC-11`、`TC-12`、`TC-13`。
2. 复用现有 3 条协议测试，扩成更细断言，而不是重写整套场景。
3. `TC-18` 已定为“creator royalty surcharge 计入首售总价”，应通过协议测试固化，避免未来按文档旧口径回退。

## 与当前 `protocol_tests.move` 的映射

| 现有测试 | 已覆盖内容 | 仍缺的断言 |
| --- | --- | --- |
| `stale_grant_cannot_be_used_after_soul_sale` | Soul 成交后旧 grant 失效 | 新 owner 初始 grant 为空；listing 期间 grant 仍有效；revoke/reissue/expiry 分支 |
| `collection_holder_receives_extra_royalty_on_soul_resale` | collection 额外版税分发 | SC 持有人无 Soul 数据权限；non-tradeable SC 不可上架；creator-only add_soul 约束 |
| `import_and_personal_join_set_expected_provenance` | import / personal join 溯源标记 | 原 NFT 仍留在 kiosk；joined Soul 后续可独立 listing / transfer |
