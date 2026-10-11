# Meeting minutes: `audit_pack_publish`

## 任务与范围

审计独立 Expansion Pack 从编辑、继承和预览到 Walrus、链上发布、收费、Seal、玩家安装与生命周期的完整闭环，并实现精确父版本绑定和确定性发布候选的基础层。

## 最终结论

- 当时独立 Pack 只具备项目、草稿、只读继承和合成预览；Walrus、独立链上对象、购买、Seal、玩家安装及生命周期均未形成生产闭环。
- 两个 P0 是父版本绑定不充分，以及 Commerce v5 无法向已封存 Maker 追加真正独立 Pack。
- 独立 Pack 需要 companion 协议/注册表，不能把新 Maker 版本或旧 embedded Pack 伪装成独立 DLC。

## 关键决策

- 精确父身份必须覆盖 Maker Root、Release/Object、Version、Walrus Blob/Quilt 和 manifest SHA-256；本地父文档可制作但不可发布。
- 母 Maker 的运行规则只读继承；Pack 的增量素材、价格、版本、生命周期和收入独立。
- PackPass 应稳定绑定 PackRoot；暂停/归档默认停止新增销售而不撤销既有购买者的内容权利。
- Seal 必须绑定 Pack Release、Pack commitment 和 Base Release；历史 Recipe 必须固定 Base Release 与 Pack Release 列表。

## 历史实现与验证

- 父绑定升级为 v2，草稿键加入完整 Release Identity，旧歧义草稿不再读取。
- 增加 canonical manifest、素材/内容 commitments 和明确的“未上传/未注册”状态，避免伪装链上成功。
- 聚焦测试 28/28；Pack、Commerce 与发布状态机联合测试 80/80。

## 风险与恢复入口

- 本线程没有完成独立 Pack 的端到端生产闭环，也没有部署；后续 v8 实现可能已替代此设计快照。
- 恢复时先对照当前 companion protocol、Pack lifecycle、Seal 和玩家安装测试，再参考[脱敏恢复摘要](../recovered-subagent-summaries/audit_pack_publish-019fe636.md)。

## 来源追踪

- Thread：`019fe636-7279-7bf1-a901-cf25c8e70947`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：3,130,343,582 B；尾部检查 48.9 MiB；恢复消息 6；终态信号 `unknown`
- 代表消息 SHA-256：`07760e1710878d275b4bb1e3b850a161b5f7b749ade9415f2e4f010db3373896`
