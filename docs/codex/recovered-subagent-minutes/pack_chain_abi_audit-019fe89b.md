# Meeting minutes: `pack_chain_abi_audit`

## 任务与范围

只读确认 Commerce v5 是否可承载独立 Pack，随后在历史工作树中实现最小 Expansion Pack v8 Move companion；保持主网开关关闭，不部署。

## 最终结论

- Commerce v5 只支持母 Maker 封存前登记的 embedded Pack，不能向已封存 Maker 追加独立 Pack，也缺少独立作者、Manifest、Treasury、生命周期及 Complete/Physical 验证 ABI。
- companion 协议采用独立 `PackRelease`、`AdminCap`、`Treasury<USDC>` 和 wallet-bound Pass，并以母 Maker 精确身份和当前控制权准入。
- 生命周期为 Draft → Sealed → Admitted → Active → Paused → Archived；新购买受状态、协议开关和 ownership epoch 限制，但暂停、停售或 Maker 转让不得撤销既有购买者的素材权利。
- Complete 与 Physical bridge 在该版本保持关闭并 fail-closed。

## 关键实现与验证

- 登记 Style Blob、SHA-256 和确定性 Seal ID；免费领取、付费购买、10% 协议费、90% Pack 金库、创作者提款、事件/getter/readback 和 Seal approval 接口均被报告实现。
- 仅向旧模块增加父 manifest getter 和复用 v5 协议费/安全检查的最小桥。
- `sui move test` 114/114，Move build 和 `git diff --check` 通过；历史生产字节码 85,000 B，其中 v8 模块 10,745 B。

## 风险与恢复入口

- 主网升级前仍要求真实 dry-run 和 upgrade compatibility；本线程没有部署或打开 gate。
- 当前 ABI 可能已被后续版本替代，恢复时以当前 Move 源码和测试为准，并参考[脱敏恢复摘要](../recovered-subagent-summaries/pack_chain_abi_audit-019fe89b.md)。

## 来源追踪

- Thread：`019fe89b-a197-7b61-b047-7a58fdafe4c1`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,257,573,227 B；尾部检查 49.4 MiB；恢复消息 8；终态信号 `unknown`
- 代表消息 SHA-256：`3ee7926e751a1b6c31162ed357eb550b10b1c59eff8636d1666b474adc3ab0f8`
