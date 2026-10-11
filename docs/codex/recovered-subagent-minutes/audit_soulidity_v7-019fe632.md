# Meeting minutes: `audit_soulidity_v7`

## 任务与范围

审计 Soulidity v7 主网升级记录、生产环境同步和 Physical v7 swap 读回，修复会阻塞发布的历史 P0；不修改 Move、不执行主网升级。

## 最终结论

- 历史升级记录曾可能把既有 v6 配置对象的 TypeOrigin 错写成 v7 callable package；TypeOrigin 不随升级变化，必须保留旧值。
- 生产环境和 E2E 必须完整验证六项 Physical v7 配置，并默认关闭。
- Swap 成功读回必须同时证明新部件已装备、旧部件已卸下且仍留在衣柜。

## 实施与验证

- 三项 P0 修复在当时已落到代码和测试。
- Vitest 70/70、Root/Web 类型检查、ESLint、生产构建和主网升级 dry-run 均报告通过。
- 没有主网写入，也没有 Move 改动。

## 风险与恢复入口

- 本纪要只证明历史线程报告的源码验证结果，不证明当前环境值、部署 revision 或链上对象仍一致。
- 恢复时以当前 TypeOrigin、环境同步测试、swap readback 和链上记录为准，并参考[脱敏恢复摘要](../recovered-subagent-summaries/audit_soulidity_v7-019fe632.md)。

## 来源追踪

- Thread：`019fe632-9ec1-7512-bf87-8979b0f050f0`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,155,218,436 B；尾部检查 48.5 MiB；恢复消息 5；终态信号 `unknown`
- 代表消息 SHA-256：`8cb87230036505f4dc64744cb7de26369a8f248b9f3b88f1b0ab5a3f229b3f3b`
