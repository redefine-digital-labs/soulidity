# Meeting minutes: `wardrobe_slot_policy`

## 任务与范围

定义并实现 Maker 衣柜总开关和逐 Part 的显式卡槽政策，防止 Background、边框等内容被默认资产化；不触碰 Expansion Pack 协议或主网配置。

## 最终结论

- 每个 Part 持久化 `FIXED` 或 `SLOT`；旧 Part、新 Part 和 Background 默认均为 `FIXED`。
- 关闭 Maker 总开关时所有 Part 的有效状态为 `FIXED`，重新开启后恢复创作者的显式选择。
- 只有 `SLOT` Part 才生成 v6/v7 Slot、Official Product 和物理 `HYBRID` policy；必选 Slot 必须有兜底 Style，可选 Slot 可以为空。
- 删除 Part 清理对应政策；复制或新建 Part 不继承 `SLOT`，保持 fail-closed 默认。

## 验证结果

- 聚焦验证 136/136，最终相关测试 165/165，生产构建通过。
- 全量测试报告 909 通过、1 失败、1 跳过；唯一失败是历史 VM fixture 缺少 `normalizedSha256Hex`，未归因于本线程。
- 未提交、未部署。

## 风险与恢复入口

- 不能从历史结果推断当前所有 v6/v7 投影仍满足该政策；应重跑当前 wardrobe、Official Product 和 Physical 测试。
- 详细边界和消息哈希见[脱敏恢复摘要](../recovered-subagent-summaries/wardrobe_slot_policy-019fe724.md)。

## 来源追踪

- Thread：`019fe724-92db-7c00-ab47-9bf7606e4b6a`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,154,474,408 B；尾部检查 48.3 MiB；恢复消息 8；终态信号 `unknown`
- 代表消息 SHA-256：`66f6125ef5d3ee5f96dad71ea4437c1b892e343320e1f463e3168d10617ec1c4`
