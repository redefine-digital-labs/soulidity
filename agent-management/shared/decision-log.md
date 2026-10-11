# 跨团队决策记录

> 记录需要 Foundation 和 Labs 共同认可的重要决策，避免信息不对称。

---

## 决策模板

```
### 决策标题
- **日期：** YYYY-MM-DD
- **决策方：** Foundation / Labs / 双方
- **内容：** 决定了什么
- **原因：** 为什么这样决定
- **影响：** 对 Foundation 的影响 / 对 Labs 的影响
```

---

## 决策记录

### 2026-10-03：授权落地并按实际主线校准

- 用户确认“搞吧，都搞起来”，随后要求按实际状态更新。Slack Milestones、Delivery和Hub已创建；九岗位合同及三creator-alpha画像登记，IRIS/HARBOR/MIRA已有真实有界执行，SENTINEL final correction review PASS。
- 发现既有活跃AC/SO执行chat和原M1–M4、S0–S14。生态层改用ECO编号，保留原产品范围/节奏/授权，不重启旧v5工作。
- 继承chain + frontend无自有业务后端的产品约束；LUQI岗位随之校准。当前事实与实际执行根见LIVE_PRODUCT_STATE.md。
- 旧AI角色入口、Foundation/Labs入口、共享共识和BD指针已更新；原文保留为历史，不推断旧人类成员去留。
- 本轮没有公开消息、Git写入、部署、资金或链上操作；自动化、个人机器人账号及外部采用均未虚报。

### Historical earlier same-day proposal: 2026-10-03：工具方案收敛（Labs 提案）

- 用户询问 Slack 是否可以直接承担项目管理；未要求同时维护两个系统。
- Labs 核对官方 Lists 能力后，将建议改为 Slack Lists + GitHub，Linear 后续可选，不再作为 M0 依赖。
- Slack 频道读取已验证；Lists 套餐/开关/实际写入仍待核验，尚未创建或分享看板。

### Historical earlier same-day decision: 2026-10-03：领导分工与核心用户

- **决策方：** 用户明确确认。
- **内容：** Naoer 负责整个 Foundation；Codex 承担 Soulidity Labs CEO 的产品、研发与交付统筹工作；内部 Agent 定人定岗定责，外部 AI Agent 创作者是核心用户。
- **落地：** 当前入口为 `agent-management/README.md`。岗位细化、工具组合、指标和 M0–M6 时间安排为 Labs 提案，尚未开通远程看板、持续运行 Agent 或通信自动化。
- **继承：** 各产品未完成目标继续有效。旧人类成员后续分工待核实，不由本次工作角色调整推断人员去留；旧融资/TGE 日期不作当前承诺。

### 组织架构确立
- **日期：** 2026-04-13
- **决策方：** Foundation
- **内容：** 确立 Foundation（运营发行）+ Labs（研发产品）双轨组织结构，建立 agent-management 文件夹统一管理角色上下文
- **原因：** 项目进入融资冲刺阶段，需要明确分工，提高各角色协作效率
- **影响：** Foundation 聚焦 BD / 融资 / 发行；Labs 聚焦产品研发；共享优先级通过 shared/ 对齐

---

*Last updated: 2026-10-03*

## 2026-10-05：敏捷 + DevOps 八阶段贯穿项目

用户确认采用Plan/Code/Build/Test/Release/Deploy/Operate/Monitor作为唯一交付主循环，敏捷管理增量与反馈。决定将责任、退出条件、风险、设计、商业及Bug回流接入现有记录。权威规则：../OPERATING_MODEL.md 第8节。原先八类管理视图及R0–R3只是讨论建议，不作为必须新增的制度。

## 2026-10-05：Agile、DevOps与AI/Codex协作方法 v1

用户要求结合大规模AI使用推导Soulidity方法。第8节已确认主循环保持不变；第9节补充项目执行细则、依据、任务合同、并行/独占资源、验证及结果指标。新增细则为本轮推导的v1，效果待真实迭代检验，不把所有细节宣称为用户逐项确认。复用原任务、岗位与授权，不替换活跃实施Owner或CURRENT。
