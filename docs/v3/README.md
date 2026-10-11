# Soulidity v3 文档集

> 当前产品版图与开放生态目标见[生态总览](../SOULIDITY_ECOSYSTEM_CN.md)及[2026-10-10 开放资产架构说明](../SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md)。研发配套为[对象与权利](../open-ecosystem/OBJECTS_AND_RIGHTS_CN.md)、[入口权限依赖](../open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md)、[状态恢复](../open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md)。本页及下列 v3 资料保留 2026-07-24 历史基线，未整体重新验证；其平台绑定、权限或部署描述不覆盖新目标与当前工作树事实。

**版本：** 3.0 Draft  
**基线日期：** 2026-07-24  
**语言：** 简体中文  
**用途：** 团队共识、合作沟通、产品规划与白皮书发布的统一内容源

## 文档地图

| 文档 | 主要读者 | 用途 |
| --- | --- | --- |
| [项目总览](./SOULIDITY_PROJECT_OVERVIEW_CN.md) | 合作方、创作者、投资人、新成员 | 用较短篇幅理解 Soulidity 是什么、已经有什么、下一步做什么 |
| [白皮书 v3.0](./SOULIDITY_WHITEPAPER_V3_CN.md) | 生态伙伴、开发者、社区、研究者 | 完整阐述愿景、协议、Maker/Scene、社交、经济、技术边界与路线图 |
| [产品与协议规格](./SOULIDITY_PRODUCT_PROTOCOL_SPEC_CN.md) | 产品、设计、工程、集成方 | 统一术语、对象模型、权限、内容类型、核心流程、Scene 扩展和验收边界 |
| [全链上游戏引擎方案 v0.1](./SOULIDITY_GAME_ENGINE_V0_1_CN.md) | 产品、游戏策划、设计、Move 与 Runtime 工程 | 定义 Scene Engine、Soul Expedition、可信记忆、2D 视觉降级、全链上验收与 MVP 交付 |
| [Soulidity × Animacraft 增长战略](./SOULIDITY_ANIMACRAFT_GROWTH_STRATEGY_CN.md) | 创始团队、产品、增长、创作者运营、生态合作 | 梳理外部商业模型、Part 资产化边界、增长飞轮、商业化、指标、实验和 90/180/365 天执行路线 |
| [资料审计与术语迁移](./SOURCE_AUDIT_AND_MIGRATION_CN.md) | 内部团队、文档维护者 | 记录旧资料冲突、采用/废弃决策、事实来源与公开表述边界 |

## 一句话定义

> Soulidity 是面向持久数字实体的链上原生创作、身份、体验与经济网络：现有 Character Maker 用于创造角色，计划中的 Scene Maker 将用于创造场景；Soul 跨场景承载身份、权利、内容、记忆和能力，Sui、Walrus 与 Seal 让关键状态、授权和结算可验证。

## 核心闭环

```text
Creator 发布 Maker / Scene
  → 用户创建或持有 OC / Soul
  → OC / Soul 进入桌宠、RPG、小游戏、社交空间或 DApp
  → 完成 Quest / Activity
  → 产生可验证结果、奖励、关系与成长
  → 在社区展示、组合、授权或交易
  → 收益自动回流创作者与生态参与者
  → 新内容持续出现
```

## 状态标签

所有新版资料使用同一组状态标签：

| 标签 | 含义 |
| --- | --- |
| `Mainnet` | 对应 Move 包或关键对象已记录在 Sui 主网部署清单，并可通过链上状态核验 |
| `Implemented` | 代码和测试已经存在；具体生产开关、外部服务或产品入口仍可能有限制 |
| `Pilot` | 可用于受控试验或有限用户，但尚未达到开放规模 |
| `Planned` | 产品方向已经进入路线图，尚未形成可依赖的生产能力 |
| `Research` | 仍需验证需求、经济、安全或监管假设 |
| `Governance Pending` | 技术能力存在，但参数、Cap 托管、升级或公开承诺尚待治理决策 |
| `No current issuance` | 当前不存在已发行的对应协议资产，不代表未来发行承诺 |
| `Legacy` | 历史设计或融资材料，不再代表当前实现 |

`Mainnet` 不等于已经获得大规模采用；`Implemented` 也不等于已对所有用户开放。

## 事实来源优先级

当资料冲突时，按以下顺序判断：

1. 当前 Sui 主网对象、部署清单和发布记录；
2. 当前 Move 源码、测试与前端实际调用路径；
3. 当前 SDK、生产配置和产品状态文档；
4. 已确认的产品决策与新版规格；
5. 研究稿、PRD、原型和路线图；
6. 旧白皮书、旧融资 Deck 和历史聊天记录。

主要事实入口：

- Soulidity 主网清单：`clawnews/packages/soulidity-sdk/src/deployment-manifest.json`
- Soulidity Move：`clawnews/move/soulidity/sources/`
- Soulidity Web / Desktop：`clawnews/web/`、`clawnews/desktop/`
- Animacraft 主网清单：`animacraft/deployments/mainnet.json`
- Animacraft 产品与协议：`animacraft/`

## 产品边界

### 当前基础

- Soulidity 已有 Sui 主网协议包、固定价 USDC 市场、Personal Kiosk、CollectionRight、统一内容系统、SoulGrant 与付费访问。
- Web 产品已有创建、导入、市场、授权、Collection、社区、资源文档和 Agent API 等界面与服务。
- SoulDesk（原 Soulidity Desktop）已提供桌宠、CLI 状态桥、本地 Agent 钱包、Persona/资源管理和部分 Soul 内容消费能力。
- Animacraft 已具备 Character Maker 创作器、Maker 发布、Walrus 内容包和 Sui 主网协议基础。

### 当前集成缺口

- Animacraft 到 Soulidity 的“同一 PTB、可验证 Maker 来源、付费授权与版税”适配器尚未完成生产激活。
- Infinite Flow Engine 已有 Scene / Run / Receipt 的 P0 实现；Soul Expedition、Soul Paper Theater 和 Infinite Stellar 已有不同程度的游戏实现。各自生产发布仍有门槛，可视化 Scene Maker 与通用跨产品集成仍待建设。
- 社区当前主要是 Web 社交产品，并非多人可游玩的链上社交世界。
- DeFi、创作者融资和协议代币仍属于规划或研究，不是现有产品能力。

## 维护原则

- 不用模拟统计、未核验市场规模或融资 Deck 数字充当公开事实。
- 不把链上持有自动等同于著作权、商业使用权或人格权。
- 不把 Walrus 描述成默认永久存储；记录存储期限、续期机制和密钥依赖。
- 不把可撤销 Paid Access 描述成不可撤销永久许可。
- 不把“链上原生、端到端可验证”简化成“所有计算都在链上”。
- 每次合约升级、主网迁移、Maker 适配器激活或经济参数决策后，同步更新状态矩阵和资料审计。
