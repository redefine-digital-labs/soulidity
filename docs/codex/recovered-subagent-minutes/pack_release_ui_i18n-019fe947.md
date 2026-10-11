# Meeting minutes: `pack_release_ui_i18n`

## 任务与范围

围绕 Expansion Pack v8 发布面板的 UI、样式和多语言接线进行协调。恢复到的消息主要是父任务广播和施工计划，没有完整完成报告。

## 可保留结论

- 不能将独立 Pack 伪装成 Commerce v5 embedded Pack；发布流程应面向独立 v8 对象和可恢复状态机。
- 运行时必须同时配置 callable package 与稳定 TypeOrigin，且 Commerce v5 真正开启后才能开放 Pack 发布/购买。
- 发布快照开始后应锁定编辑区，成功提示必须等待 Release、AdminCap、Treasury、Style 表和 Active 状态全部读回。
- UI 应以实际 `.expansion-pack-release-panel` 结构补样式，并逐项核对 `maker-workspace.js` 使用的文案键。

## 未完成与风险

- 没有恢复到样式/i18n 实际改动、测试通过或提交结果；不得把计划当作完成。
- 线程终态信号为 `unknown`，其内容大量与其他发布线程重复。
- 恢复时以当前 UI、i18n 测试和链上读回门禁为准，并参考[脱敏恢复摘要](../recovered-subagent-summaries/pack_release_ui_i18n-019fe947.md)。

## 来源追踪

- Thread：`019fe947-1680-7c32-bd37-7b97129e56d0`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,312,649,470 B；尾部检查 47.5 MiB；恢复消息 6；终态信号 `unknown`
- 代表消息 SHA-256：`8a87e891afbff52e110b275a3b08c516a93ebf54332ce12f20ae7665bf72803e`
