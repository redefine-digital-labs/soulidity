# Meeting minutes: `v6_chain_plan`

## 任务与范围

只读核对 Soulidity v6 源码、部署清单和主网对象，确定升级、初始化、旧市场退役的精确顺序及必须保持关闭的 gate。本任务不改文件、不提交交易。

## 最终结论

- 当时计划只需两笔签名交易：Soulidity v6 升级和 Legacy Market 原子退役。
- v6 无全局 initializer；Appearance 状态在具体 Soul 首次绑定时创建。
- 执行前必须把 PR #20 重构到最新 v5 基线，并完成持久化交易/digest 的恢复机制；超时后只按 digest 对账，禁止重签重试。
- 市场、Animacraft、proof binding 与 Seal gate 必须保持关闭，v6 Soul owner proof 暂缓绑定。

## 关键决策

- 当时顺序：升级并读回 UpgradeCap/ABI/TypeOrigin → 退役旧市场 → 更新部署记录和生产路由。
- 本子任务只做审计，没有链上写入。
- 后续安全审计发现旧 v5 永久 ABI 可绕过 v6 外观同步，方案扩展为新的 `MarketConfigV6`、v6 专用 listing 与嵌套 V2 管理权；所以“只创建 MarketConfigV2”是已被补充的早期计划。

## 历史改动与证据路径

本子任务无改动。后续实现/记录路径：

- `move/soulidity/sources/market.move`
- `scripts/upgrade-soulidity-mainnet.ts`
- `scripts/retire-soulidity-legacy-market.ts`
- `scripts/lib/soulidity-mainnet-migration.ts`
- `packages/soulidity-sdk/src/deployment-manifest.json`
- `move/soulidity/Published.toml`
- `tests/scripts/soulidity-mainnet-migration.test.ts`

Git 证据：v6 加固 `bee4a94` / merge `29c2de5`；主网记录 `e18a942` / merge `1ae48c3`。

## 验证结果

- 两次主网只读回查均显示状态未变化。
- Legacy Market 保持暂停，Animacraft Composition/Commerce 禁用，管理 Cap 归属一致。
- 审计确认新 v6 模块无独立 initializer；proof TypeOrigin 必须等待升级后 callable package 确定。

## 风险、未完成项与后续变化

- 当时 PR #20 可能绑定部署前旧 v6 源码；journal/digest 恢复机制尚未完成；runtime 错误共用 v5/v6 proof TypeOrigin 字段。
- 恢复时应以已合并 v5 基线为起点，重跑兼容检查，先完成 fail-closed journal，再 dry-run、升级、读回、退役、再读回。
- 写入 `Published.toml` 与 deployment manifest 时所有 gate 仍应关闭；proof 字段拆分后再安排独立绑定。

## 来源追踪

- Thread ID：`019fc0a6-0e10-7f50-89ef-9e84106c9202`
- 原始 source：2,410,895,669 B；SHA-256 `71ee1ed0501554cc14d52cda1e5b79ce8e754752cc56f66cefdc76bd9af35bf9`
- 压缩正文：1,614,375,949 B；SHA-256 `50407ad979dc1438be6bc2c2a02140afd7db2ec3954f442c7efa4d3d86233fd5`
- 脱敏导出：1,146 条消息；SHA-256 `4699ab572e714a01c18cd94f83346ff4cae809896e8d2c789265dde1b8879e8e`
- 代表性消息：
  - `2388332451bc5e99bfee17a9bd81eda206fc5ddb0a88b8b521cee8020dd5f790` — `2026-08-02T04:07:42.212Z`
  - `bebf0ee6ae7506d8b51f0d0be109f1cd9789faf74e22760283704453473b7d3f` — `2026-08-02T04:10:21.427Z`
  - `4abc6c5ef2f7ff86255f62c6620f968c8995bc0cd71d4dc60227e19c58a15b99` — `2026-08-02T04:27:47.478Z`
  - `8ca1208b6e65e63a41ede6fb516350c3db7ae4d69b09e1929a0a629205a0cfa0` — `2026-08-02T04:36:47.304Z`
