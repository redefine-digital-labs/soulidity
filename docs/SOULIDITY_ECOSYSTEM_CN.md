# Soulidity 生态与产品总览

从用户问题理解全链上机制与产品分工，见 [全链上 OC 生态与产品架构](SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md)（产品架构更新于 2026-10-10；历史图像与状态保留原日期）。开放资产实施边界见[新版完整说明](SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md)。

合约职责、权限与内部生态化计划统一见[模块与权限边界汇总](SOULIDITY_CONTRACT_MODULES_AND_PERMISSION_BOUNDARIES_CN.md)：渠道与交易市场独立仓库，规划新增十个责任单元；计划数量不表示已部署或已创建远端管理对象。

> 2026-10-03 工程状态已校准：[现行产品与交付事实](../agent-management/LIVE_PRODUCT_STATE.md)。本文的产品分类仍有效；下方2026-09-06状态表为历史快照。Animacraft/Soulidity当前按原M1–M4与S13推进，不能用旧v5配置判断现行生产。

产品架构更新日期：2026-10-10；交付状态表基线：2026-09-06。  
用途：统一项目介绍、产品分类与品牌名称。产品分类和 SoulDesk 名称已由项目负责人确认；实现与发布状态按各仓库记录分别描述。

## 整体定位

**Soulidity 是面向设圈与原创角色的全链上创作与使用生态。** 它围绕持久数字角色组织创作、应用与游戏；核心业务状态与交易规则在链上，内容使用去中心化存储，编辑、渲染与推理由客户端和运行端承担。这里的架构定位不代表所有产品已完成生产验收。

Animacraft 让创作者和用户创造角色，Soulidity 协议与应用承载角色的身份、内容与权限，SoulDesk 将角色带入日常桌面生活，Infinite Flow Engine 为全链游戏开发提供基础设施。Soul Expedition、Soul Paper Theater、Infinite Stellar 和 Soul Habitat 通过冒险、策略、赛季竞争与养成模拟，让角色进入不同世界，持续积累经历与关系。

目标架构中，Maker 和 Soul 是独立开放资产。Soulidity 是发现、管理与交易工作台，Animacraft 是制作、发布与可选分销工具；其他客户端和生产者可以按公开标准操作原资产。五个产品入口为社区与发现、交易市场、创作与发行、Soul 工作台、应用与体验，各实例仅管理自己的规则与权限。平台退出后的原旅程接替仍需逐条验证。

**Create Once. Live Across Worlds. — 创造一次，在不同世界中持续生活。**

世界可以改变或重置，Soul 的身份与可验证历史可以延续。每款游戏仍拥有自己的规则、状态与公平性边界；持续身份不意味着永久战力或所有资产自动跨游戏通用。

## 网络方向

当前以 Sui 为核心建设，未来计划扩展到 Solana 和 Sonic SVM。这是后续方向，不代表已支持跨网络部署或自动互操作。

公开英文版本位于独立的 [Soulidity Docs](https://github.com/redefine-digital-labs/soulidity-docs) 仓库。

## 产品版图

| 类别 | 产品 | 职责 |
| --- | --- | --- |
| 角色创作 | Animacraft | Character Maker 创作、角色组合、来源与许可、扩展内容 |
| 身份与应用 | Soulidity Protocol & App | Soul 身份、内容、记忆、授权、交易与社区 |
| 桌面产品 | SoulDesk | 桌面伙伴、角色呈现与 Agent 工作流运行端 |
| 开发基础设施 | Infinite Flow Engine | 面向 Sui 的可组合全链游戏引擎 |
| 游戏 | Soul Expedition: The Mist Court | 短局 Roguelike 探索、行动选择与风险决策 |
| 游戏 | Soul Paper Theater | 纸舞台风格的短局策略与探索 |
| 游戏 | Infinite Stellar | 具有独立规则的多人赛季策略世界 |
| 游戏 | Soul Habitat | 异步养成、经济生存与有限自主生活模拟 |

**Soulidity Games** 可用作四款游戏的介绍分组，不代表新增独立仓库或统一游戏运行架构。开发阶段与产品类别分开：处于规划阶段的 Soul Habitat 仍归为游戏。

## Animacraft：创造角色

创作者通过分层图片、颜色与组合规则制作可重复使用的 Maker。用户在规则范围内生成 OC，每次正式完成获得一个具有唯一身份的最终 Soul；第三方可通过有效生产者独立创建标准 Soul。Maker 是产品对象，Creator 是创作者本人，标准不以平台许可作为创建门槛。

当前编辑模型为 Maker → Part → Item → Style。Maker 可以携带角色设定、初始记忆及技能文档，并通过版本与扩展包持续增加内容。已发布版本保留素材、规则和来源关系。

Animacraft 与 Soulidity 是独立产品、仓库和合约包。新版商业能力涉及基础访问、扩展包、完成角色授权、管理权转让与分账；生产开启状态需以对应版本的部署证据为准。

Maker 制作、固定快照、内容存储、链上版本发布、渠道接入与实际发行分别记录。接入 Animacraft 分销时另行同意限定范围的费用与授权；未接入该渠道的合法路径仍遵守资产自身许可、供给和发行规则。对象、入口和恢复细节分别见[对象与权利](open-ecosystem/OBJECTS_AND_RIGHTS_CN.md)、[权限与依赖矩阵](open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md)、[状态与恢复](open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md)。

## Soulidity Protocol & App：持续身份与内容中心

Soul 是持久身份与协议权限的核心对象。协议和应用组织原生创建、导入、内容版本、SoulGrant、Paid Access、市场、Collection 与社区；公开合约接口和 SDK 支持客户端直接通过钱包接入 Sui。可选查询与接入工具不成为平台业务 API 的强制依赖，工作台也不默认持有用户资产总控制权。

OC 描述创作身份，Soul 承载持久身份与权限，Runtime 负责实际运行，Scene 提供活动环境。所有权、内容访问权和素材版权许可分别表达。历史经验可以在明确规则下被读取，不保证所有运行端共享全部记忆或能力。

## SoulDesk：角色在桌面的家

**SoulDesk** 是桌面产品的统一名称，替代产品介绍中的 Soulidity Desktop / Anima Desktop。建议文案：**Your Soul, at home on your desktop. — 让你的 Soul 在桌面安家。**

产品覆盖桌宠与动画、人格与资源管理，以及与 Agent 工作流相关的桌面交互。现有基础包含 CLI 状态感知、本地钱包与设备绑定、部分 Soul 内容读取和解密。具体功能开放程度以桌面端实现及发行说明为准。

现有实现目录为 `clawnews/desktop/`。本次确认的是品牌名称和介绍；安装包名称、应用标识、更新通道及程序界面的完整更名尚未执行。Desktop-Claw 作为上游来源名称保留，不改写其归属。名称可用性尚未核验。

## Infinite Flow Engine：全链游戏开发基础设施

**Infinite Flow Engine 是面向 Sui 的可组合全链游戏引擎，通过链上合约框架与配套 SDK，为游戏提供场景版本、运行状态、规则权限、随机事件、资产结算和结果凭证等基础能力，让开发者集中构建玩法。**

可以用“类似 MUD 的全链游戏引擎”解释产品类别：引擎组合链上框架与链下开发、查询和接入工具，帮助组织复杂状态与规则。该类比不表示采用相同架构，也不表示当前已具备 MUD 同等广度的工具链。

当前 P0 已实现 SceneRegistry、不可变 SceneVersion、SoulPlayProfile、有界单人 Run、Sui 原生随机数、奖励预留与结算、超时和所有权变化退出、RunReceipt 与 AcceptedOutcome，以及源码分发的 TypeScript SDK。多人组队、通用可变背包和自动多方分账不在当前 P0 范围。

它适合降低规则多、状态复杂且需要持续扩展的全链游戏的工程成本。是否将核心玩法放到链上，仍由游戏独立判断；引擎不自动保证更低成本、更快交易或合约安全。可视化 Scene Maker 是另一个仍待建设的创作工具方向。

## Soulidity Games：四种游戏体验

### Soul Expedition: The Mist Court

围绕七节点地图展开的短局 Roguelike。玩家选择路线和侦察、突袭、交涉、休息、撤退等行动，权衡战利品与风险。已有客户端、Move 游戏规则和不产生链上记录的本地 Rehearsal 教学模式。

### Soul Paper Theater

纸舞台风格的单人游戏。玩家在有限回合内移动、点亮月灯、折叠护符并应对阴影。已有客户端、Move 规则与本地教学模式。与 Expedition 一样，其文档仍使用旧名 Soulidity Scene Engine；接入新版 Infinite Flow Engine 的具体版本须单独核对。

### Infinite Stellar

以 Soul 为持续主角的零知识、全链上多人赛季策略游戏。探索星球、发展资源、派遣舰队、攻防和赛季目标构成核心体验。文明与军事状态属于赛季，Soul 保留规则允许的历史、关系与表达。

它拥有独立多人状态与规则，不应描述成必须依赖 Infinite Flow Engine 的游戏。后者可以承担可选序章或 PvE 体验。仓库记录已有测试网 canary 和可玩本地规则沙盒，尚未主网部署；本地模拟不产生真实 Soul 历史。

### Soul Habitat

异步养成与经济生存游戏。玩家作为导师设定目标、预算、权限和风险边界，让 Soul 的独立游戏化身学习、工作、合作、休眠与复苏。

第一阶段计划使用不可提现的 Life Credits 进行可回放模拟。游戏化身的休眠或死亡不会销毁源 Soul。当前属于产品与协议规划，不能描述成已上线游戏或真实自主收入系统。

## 技术与产品关系

- Sui / Move 承载权威身份、权限与适用的游戏规则和结算。
- Walrus 保存角色图片、内容包等数据；保存期限与续期需要管理。
- Seal 根据权限条件控制加密内容访问。
- Web、SDK、查询服务和运行端承担开发接入、展示与交互。
- 各游戏可以共享 Soul 身份，并按需复用引擎，保留独立状态和规则。

## 状态快照与证据边界

| 产品 | 仓库记录中的阶段 | 关键边界 |
| --- | --- | --- |
| Soulidity Protocol & App | 主网部署记录与应用实现 | 不等同于规模化采用或所有新集成已激活 |
| Animacraft | pre-v1 编辑器与商业协议实现 | 本地清单 canonicalSoulMintEnabled 为 false |
| SoulDesk | 试点运行端 | 本次是品牌与介绍统一，尚未完成程序更名 |
| Infinite Flow Engine | 实验性 P0 | 生产发布门槛仍被阻塞，未完成独立审计 |
| Soul Expedition / Soul Paper Theater | 客户端、合约与本地教学实现 | 链上模式需已验证部署配置；教学不生成链上凭证 |
| Infinite Stellar | 测试网 canary 与本地沙盒 | 未主网部署；生产证明、服务和其他发布门槛仍待完成 |
| Soul Habitat | 规划 | 首个模拟切片尚不能当成已交付能力 |

上述状态依据 2026-09-06 查阅的本地 README、配置与公开仓库列表，不是重新运行测试或实时核验链上部署的结果。

## 资料与仓库

- [GitHub 组织仓库](https://github.com/orgs/redefine-digital-labs/repositories)
- [Soulidity](https://github.com/redefine-digital-labs/soulidity)
- [Animacraft](https://github.com/redefine-digital-labs/animacraft)
- [Infinite Flow Engine](https://github.com/redefine-digital-labs/infinite-flow-engine)
- [Soul Expedition](https://github.com/redefine-digital-labs/soul-expedition)
- [Soul Paper Theater](https://github.com/redefine-digital-labs/soul-paper-theater)
- [Infinite Stellar](https://github.com/redefine-digital-labs/infinite-stellar)
- [Soul Habitat](https://github.com/redefine-digital-labs/soul-habitat)
- [Onchain Experience Network](https://github.com/redefine-digital-labs/onchain-experience-network)：生态愿景资料，不是游戏或运行产品。
- [MUD](https://mud.dev/)：用于解释引擎品类的外部参考。

Maker Launch Playbook 与 OC Autonomous Worlds Roadmap 属于运营和路线图资料。可游玩社交世界仍是探索方向，不应计作已经发布的独立产品。
