# Meeting minutes: `audit_release_v7`

## 任务与范围

审计 Physical v7、Soulidity v7 与 Expansion Pack 的发布准备度，并在限定范围内修复精确父版本绑定和生产环境同步测试夹具。历史线程没有部署、提交或主网写入。

## 最终结论

- 审计快照中 Physical v7 合约能力已存在，但玩家交易、链上读回、恢复队列以及 Complete/Mint 接线尚未形成可开放闭环；Soulidity manifest 当时仍停在 v6。
- Expansion Pack 必须把本地母草稿和已发布母版本分开：本地只允许预览，只有精确绑定 Maker Root、Release、Version、Walrus Blob/Quilt 和 manifest SHA-256 后才可发布。
- `production-env-sync` 的 11 个失败来自默认 fixture 缺少 Physical v7 开关及五个身份 ID；修复后保持缺键和错误值测试 fail-closed。

## 关键决策

- Background 等 Part 默认 `FIXED`，只有创作者显式选择的 Part 才是 `SLOT`。
- 重绑定不得覆盖旧草稿、放宽兼容条件或把本地预览误报为可发布。
- 历史测试结果不能证明今天的部署或 gate 状态。

## 历史改动与验证

- 新增 fail-closed 的 `rebindExpansionPackProjectToPublishedRelease()` 语义及八项继承契约；Expansion Pack 聚焦测试 49/49。
- `tests/backend/production-env-sync.test.ts` 20/20；主网迁移与包路由 57/57；合计 77/77，`git diff --check` 通过。
- 当时全仓仍有 12 个并行区域的既有失败，未归因于本线程。

## 风险与恢复入口

- 不得从本纪要推断 Physical v7 已部署、玩家开关已开启或 Pack 已形成端到端生产闭环。
- 恢复时先核对当前源码、测试、部署记录和链上读回，再参考[脱敏恢复摘要](../recovered-subagent-summaries/audit_release_v7-019fe62f.md)。

## 来源追踪

- Thread：`019fe62f-deaa-7273-8779-95c588ce40a2`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,180,587,971 B；尾部检查 48.6 MiB；恢复消息 8；终态信号 `unknown`
- 代表消息 SHA-256：`d92df66e88f8d3a701735b7bb5c4f567d79aaa0db19a1387a5147d85919903ca`
