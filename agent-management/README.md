# Soulidity 组织与交付管理

更新：2026-10-03。当前入口；原始组织记录保存在 [4 月历史记录](history/2026-04-13/README.md)。

用户已确认：Naoer 负责整个 Foundation；Codex 承担 Soulidity Labs CEO 的工作统筹；内部 Agent 定人、定岗、定责，外部 AI Agent 创作者是核心用户。此处定义工作职责，不改变法律任职、账户或签名权限。用户已授权落地，Slack管理对象已创建，Agent按任务会话开始执行。

- [Slack Hub](https://sega-xya5661.slack.com/docs/T08LQTJFZRS/F0C6JN5BAC9) · [里程碑表](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6EQU2U5U) · [执行任务表](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6BEMB58V)
- [最新产品与执行事实](LIVE_PRODUCT_STATE.md)：原AC-SO-M1–M4和S13继续执行，生态层用ECO编号。
- [岗位注册](agent-registry.json) · [创作者注册](creator-registry.json) · [执行规则](EXECUTION_POLICY.md)
- [里程碑与首轮 backlog](milestones.md)
- [M0 仓库与工具核验](M0_BASELINE.md)：实时远程核验后的修正；旧 v5 工作区不代表最新生产。
- [组织、Agent 与工具运行规则](OPERATING_MODEL.md)
- [合约模块与权限边界汇总及量化建设计划](../docs/SOULIDITY_CONTRACT_MODULES_AND_PERMISSION_BOUNDARIES_CN.md)：渠道与市场分别管理；目标新增 10 仓、10 模块频道、3 表单入口、11 视图、10 模块合同及 20 逻辑流水线。尚未创建这些对象；原岗位、任务、Owner、CURRENT 和授权保留。
- [项目与产品工程管理手册 必读](PRODUCT_ENGINEERING_HANDBOOK_CN.md)：管理科学、产品与敏捷、DevOps、金融工程、Ethereum/Sui 安全及升级治理分层说明；[适用性与评审记录](templates/product-engineering-review.md)附在原任务中。
- [决策记录](shared/decision-log.md)
- [产品版图](../docs/SOULIDITY_ECOSYSTEM_CN.md)

foundation/、labs/、shared/context-sync.md及七个旧AI角色入口已更新到现行合同；旧版本保存在history。剩余历史人员档案有明确标注。原成员后续分工尚待核实，不推断任何人离职。岗位设定不代表 Agent 已实例化或持续运行。

## 产品研发与缺陷双表（2026-10-05）

- [功能开发与交付](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6DCP5VFH)：8项既有用户旅程；[研发进展频道](https://sega-xya5661.slack.com/archives/C0AJCKH65BQ)。
- [Bug追踪与修复](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ)：首批12项，5项关闭、7项开放；[Bug频道](https://sega-xya5661.slack.com/archives/C0C6YEB44G4)。

两表以DEV/BUG编号关联，保留原M1–M4/S0–S14。发布和本地通过不等于关闭：缺陷须原操作复验；开发项须用户结果验收。后续研发进展与Bug修复/复验分别同步上述频道，用户已明确授权。现状入口仍为实际AC CURRENT顶部；本段数量为初建快照，不代表未来实时状态。记录、证据和消息回执见 [初建快照](runs/2026-10-05-product-boards.json)。

- [2026-10-05完整Bug评审清单](BUG_REVIEW.md)：39项清单及后续评审决定；用户已批准修复／复验，实时进度以原记录与CURRENT为准。初建12项快照已被该清单取代。

## 敏捷 + DevOps 主流程（2026-10-05 已确认）

Plan → Code → Build → Test → Release → Deploy → Operate → Monitor → Plan。
[统一执行协议、八阶段责任与退出条件](OPERATING_MODEL.md#8-敏捷--devops-八阶段统一执行协议2026-10-05-用户确认)适用于全部岗位和产品环节；沿用现有研发、Bug和Delivery表，阶段与任务状态分开。
历史快照不作为当前执行状态；最新修复授权与进度查实际工作区CURRENT和原任务记录。

## AI/Codex协作方法 v1

[方法、推导依据、八阶段AI分工与结果指标](OPERATING_MODEL.md#9-soulidity-的-aicodex-协作方法-v12026-10-05) · [任务合同模板](templates/ai-work-item.json)。沿用已有任务和Owner，下一轮以真实旅程验证效果；文档完成不代表效率提升已经证明。
