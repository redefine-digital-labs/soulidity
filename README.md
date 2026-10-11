# Soulidity

> 工程状态更新（2026-10-03）：[现行产品与交付事实](agent-management/LIVE_PRODUCT_STATE.md)和[管理入口](agent-management/README.md)。产品分类沿用下方总览；旧日期的发布状态不代表今天进度。

> 项目必读：[产品工程管理手册](agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md)。区分管理科学、敏捷、DevOps、金融工程与 Ethereum/Sui 合约安全；专业检查按任务适用，当前交付状态仍以权威工作区记录为准。

**面向设圈与原创角色的全链上创作与使用生态。**

Soulidity 让原创角色（OC）和 AI Agent 获得可验证的链上身份、内容、权限与经济关系，并能够以同一个 Soul 进入桌宠、游戏、社交空间、DApp 和链上活动。

核心业务状态与交易规则由链上协议承接，内容采用去中心化存储，编辑、渲染与 AI 推理由客户端和运行端完成。完整定位、架构范围及当前交付边界见[全链上 OC 生态与产品架构](./docs/SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md)。

2026-10-10 确认的目标是 **Maker 与 Soul 独立开放，业务按对象、动作与权限解耦**。Soulidity 提供发现、管理与交易工作台；Animacraft 提供制作、发布与可选分销工具。第三方可使用相同公开标准和基础设施；制作、存储、链上发布、渠道接入与最终发行分别实现。完整说明及研发附件见下方入口。

产品体系包括：

- **Animacraft**：角色创作平台与 Character Maker。
- **Soulidity Protocol & App**：持久身份、内容、权限、市场与社区。
- **SoulDesk**：桌面伙伴与角色运行端，原称 Soulidity Desktop / Anima Desktop；程序与安装包更名待执行。
- **Infinite Flow Engine**：面向 Sui 的可组合全链游戏引擎。
- **Soulidity Games**：Soul Expedition、Soul Paper Theater、Infinite Stellar、Soul Habitat，覆盖短局冒险、纸舞台策略、多人赛季世界和异步养成。

**完整介绍见 [生态与产品总览](./docs/SOULIDITY_ECOSYSTEM_CN.md)（产品架构更新于 2026-10-10；状态表保留 2026-09-06 历史快照）。** 产品类别与开发阶段分别描述：引擎和部分游戏已有实现，生产发布及跨产品集成仍需各自验证；Soul Habitat 和可视化 Scene Maker 仍属规划。

## 当前文档

- [合约模块与权限边界汇总说明](./docs/SOULIDITY_CONTRACT_MODULES_AND_PERMISSION_BOUNDARIES_CN.md)：开放生态审核与后续管理方案总入口；渠道／市场独立，量化十仓计划及迁移关口。
- [开放资产与独立用户旅程架构说明](./docs/SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md)：当前开放生态目标、默认策略、五个业务入口、权限治理与接替验收。
- [对象与权利关系](./docs/open-ecosystem/OBJECTS_AND_RIGHTS_CN.md)、[入口权限与依赖矩阵](./docs/open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md)、[状态与恢复](./docs/open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md)：研发映射实际类型、函数、守卫和中间状态的配套附件。
- [Soul DOF 底层与业务规范](./docs/SOUL_DOF_V1_REBUILD_CN.md)：三类组件权利、真实装卸、视觉组合、整套交易及原上游业务范围；当前施工进度在独立工作树维护。
- [全链上 OC 生态与产品架构](./docs/SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md)：从设圈与 OC 问题出发，解释全链上机制的价值，包含方案总图、产品关系图、用户流程图和技术架构图。
- [v3 历史基线文档入口](./docs/v3/README.md)
- [项目总览](./docs/v3/SOULIDITY_PROJECT_OVERVIEW_CN.md)
- [Soulidity 白皮书 v3.0](./docs/v3/SOULIDITY_WHITEPAPER_V3_CN.md)
- [产品与协议规格](./docs/v3/SOULIDITY_PRODUCT_PROTOCOL_SPEC_CN.md)
- [资料审计与术语迁移](./docs/v3/SOURCE_AUDIT_AND_MIGRATION_CN.md)

v3 资料以 2026-07-24 的代码、部署清单和产品状态为历史基线，并把每项能力明确区分为 `Mainnet`、`Implemented`、`Pilot`、`Planned`、`Research`、`Governance Pending`、`No current issuance` 或 `Legacy`；旧基线不覆盖上方 2026-10-10 目标架构。

## 旧版资料

根目录的旧白皮书、PRD、CONTEXT、原型以及历史融资材料仍作为设计演进记录保留。当前已实现或部署事实以权威工作区 CURRENT、实际源码、部署清单与收据为准；目标行为以已确认决策及上方开放生态说明和 Soul DOF 规范为准。两者存在差距时记录待实施项，不把新文档当作部署证明；[v3 资料审计](./docs/v3/SOURCE_AUDIT_AND_MIGRATION_CN.md)只解释其历史基线。
