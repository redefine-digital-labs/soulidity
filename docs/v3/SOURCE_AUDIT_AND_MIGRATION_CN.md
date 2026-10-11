# Soulidity 资料审计与术语迁移

**版本：** 3.0  
**审计基线：** 2026-07-24  
**范围：** 项目根目录、`clawnews/`、`animacraft/` 中与 Soulidity 愿景、产品、协议、桌面端、Maker、经济和融资有关的资料  
**目的：** 记录事实优先级、历史设计冲突、v3 采用决策和后续维护规则  
**发布范围：** Internal；包含历史融资方案摘要，不应随公开白皮书直接发布

---

## 1. 审计结论

Soulidity 现有资料不是一套同时形成的单一规格，而是四个阶段叠加的结果：

1. **所有权与内容交付阶段**：SoulSeries、SoulRelease、SoulPass、Walrus、Seal、授权与购买；
2. **完整产品阶段**：Create / Import、市场、Collection、Wrap + Link、社区和 Karma；
3. **真实协议实现阶段**：Soul + SoulState + SoulContent + SoulGrant + PaidAccess + CollectionRight；
4. **持久数字实体网络阶段**：OCL、Character Maker、Scene Maker、游戏、社交活动和跨 Runtime 连续性。

旧白皮书的愿景仍有价值，但它的对象模型、订阅、跨链、内容语义和融资设计已经不能代表当前主网实现。新版文档采用以下统一定位：

> Soulidity 是面向持久数字实体的链上原生创作、身份、体验与经济网络。Maker 创建角色与场景，Soul 承载持久身份、内容和权利，Runtime 提供实际交互，Scene / Quest 产生可验证经历和价值流。

## 2. 新版文档体系

| 文档 | 角色 | 是否代表当前口径 |
| --- | --- | --- |
| `README.md` | 根入口与项目简述 | 是 |
| `docs/v3/README.md` | v3 文档地图、状态词典与维护规则 | 是 |
| `docs/v3/SOULIDITY_PROJECT_OVERVIEW_CN.md` | 对外项目总览 | 是 |
| `docs/v3/SOULIDITY_WHITEPAPER_V3_CN.md` | 愿景、协议、Maker、Scene、经济与路线图 | 是 |
| `docs/v3/SOULIDITY_PRODUCT_PROTOCOL_SPEC_CN.md` | 当前协议事实和下一阶段概念规格 | 是 |
| `docs/v3/SOURCE_AUDIT_AND_MIGRATION_CN.md` | 历史冲突、迁移和表述边界 | 是 |

新版文档不覆盖或删除历史文件，而是用状态和来源优先级消除冲突。

## 3. 资料清单与分类

### 3.1 根目录历史白皮书与产品资料

| 资料 | 内容 | 审计状态 |
| --- | --- | --- |
| `Soulidity Whitepaper.pdf` | 2026-03 的旧版白皮书，SoulSeries / SoulRelease / SoulPass、购买与授权 | `Legacy` |
| `soulidity-whitepaper.md` | 后续 Markdown 白皮书版本，扩展产品与路线 | `Legacy` |
| `SOULIDITY_PRD.md` | 完整交互原型 PRD，Create / Import / Market / Collection / Community | `Legacy design source` |
| `CONTEXT.md` | 注意力经济、Soul 内容与 Collection 的内部决策记录 | `Historical context` |
| `soul-classification-roadmap.md` | Soul 绑定、内容锁和分类研究 | `Research` |
| `docs/OC_MATURITY_TAXONOMY_CN.md` | OCL-0 至 OCL-5 分类学和六维能力模型 | `Current research source` |
| `prototype.html`、`logic-diagram.html`、`flow-map.html` | 早期产品原型与流程图 | `Legacy prototype` |
| `live-portrait.html` | 视觉/角色实验 | `Prototype` |
| `agent-management/` | 团队角色、里程碑和历史状态面板 | `Historical operations` |
| `AEGIS/`、`Unnamed/` | Soul 与 Memory 示例内容 | `Sample data` |

### 3.2 融资资料

| 资料 | 内容 | 审计状态 |
| --- | --- | --- |
| `SEGA-Soulidity-Fundraising-Deck.pptx` | 10 页历史融资 Deck，市场、团队、Tokenomics、融资轮次 | `Legacy / Confidential by default` |

该 Deck 不能作为当前公开白皮书的事实来源。市场规模、竞品规模、团队履历和合作描述如需复用，必须逐项重新取证。

历史资料还出现了 SEGA Foundation / Labs 双轨组织模型，以及多个用于执行的 AI Persona。它们属于内部组织叙事：在法律主体、职责和成员信息完成确认前，不能作为当前法人治理结构对外发布；AI Persona 也不能计入公开团队人数。

### 3.3 Soulidity 当前工程资料

| 路径 | 内容 | 审计状态 |
| --- | --- | --- |
| `clawnews/move/soulidity/sources/` | 当前 Move 协议真相源 | `Authoritative implementation` |
| `clawnews/packages/soulidity-sdk/src/deployment-manifest.json` | 测试网与主网 Package、对象、Cap 和支付资产 | `Authoritative deployment` |
| `clawnews/packages/soulidity-sdk/` | 当前 SDK 与对象/交易编排 | `Current implementation` |
| `clawnews/web/` | Web 产品、API、社区、市场和导入路径 | `Current implementation` |
| `clawnews/desktop/` | Desktop Runtime、CLI 桥、Wallet、Persona 与资源消费 | `Current implementation / Pilot` |
| `clawnews/docs/audits/` | 合约与生产审计记录 | `Supporting evidence` |
| `clawnews/docs/plans/` | 阶段实施计划和 runbook | `Implementation history` |
| `clawnews/docs/specs/` | Studio、内容格式和产品规格 | `Supporting spec` |
| `clawnews/docs/legacy/` | 已在工程仓库归档的旧计划 | `Legacy` |

### 3.4 Animacraft 资料

| 路径 | 内容 | 审计状态 |
| --- | --- | --- |
| `animacraft/deployments/mainnet.json` | v3 主网部署与源码验证记录 | `Authoritative deployment` |
| `animacraft/move/` | 当前与候选 Move 协议 | `Current / Candidate implementation` |
| `animacraft/PRODUCT.md`、`PRODUCTION_STATUS.md` | Character Maker 产品与状态 | `Current product source` |
| `animacraft/PRODUCTION_AUDIT.md`、`SECURITY.md` | 生产与安全边界 | `Supporting evidence` |
| `animacraft/SOULIDITY_ADAPTER_HANDOFF.md`、`ADAPTERS.md` | Soulidity 交接与适配器设计 | `Integration design` |
| `animacraft/PROTOCOL_ECONOMICS_V4_SPEC.md` | v4 候选分账与版税 | `Governance Pending` |
| `animacraft/CREATOR_*`、`NEKA_*`、研究稿 | 创作者资产和编辑器方向 | `Product / Research` |

Animacraft 是独立仓库、独立产品和独立 Sui Package。其“主网已部署”不能自动推导出“Soulidity Adapter 已生产激活”。

## 4. 事实来源优先级

遇到矛盾时按以下顺序：

1. 当前主网对象、交易和部署清单；
2. 当前 Move 源码与测试；
3. 当前 Web、Desktop、SDK 的实际代码路径；
4. 当前生产入口和可下载发行物；
5. v3 已确认产品规格；
6. 当前产品状态与审计文档；
7. 研究稿、PRD、原型和路线图；
8. 旧白皮书、旧融资 Deck 与聊天记录。

两个常见例子：

- 旧白皮书写“一次只能授权一个 Agent”；当前合约允许 Owner 调整 Grant 容量，因此以当前合约为准。
- 工作区代码包含 Animacraft free-Maker handoff，但生产 `/import` 未部署该入口，因此只能写“代码适配存在，生产未激活”。

## 5. 历史叙事迁移

### 5.1 从 OC 市场到持久数字实体网络

| 历史表述 | v3 采用表述 | 原因 |
| --- | --- | --- |
| OC / AI Agent 的 NFT 市场 | 持久数字实体的创作、身份、体验与经济网络 | 市场只是闭环的一部分 |
| 注意力的链上载体 | 身份、内容、权利、能力、经历和关系的可验证载体 | “注意力”无法覆盖当前产品对象 |
| 买卖 AI Agent | 持有 Soul、授权 Runtime、购买内容访问或服务 | 所有权、运行权和服务必须分离 |
| One Soul, Many Forms | Create Once. Live Across Worlds. | 保留跨形态连续性，并扩展到 Scene |
| 全链上 OC 平台 | 链上原生、端到端可验证 | Runtime 与大文件并不全部在链上 |
| Trainer | Creator；如作为社区称谓需单独说明 | 避免把训练者误作协议权利方 |
| SC Holder | CollectionRight Holder | 与 Collection 成员 Soul Holder 分开 |

### 5.2 从静态资产到可游玩闭环

旧资料的核心循环是：

```text
Creator 发布 → 用户购买 → Agent 获得授权 → 市场交易
```

v3 循环扩展为：

```text
Maker 创建角色 / Scene
  → 用户持有或接入 Soul
  → Runtime 中游玩 / 互动 / 执行
  → Quest 产生可验证结果
  → 状态、关系与奖励延续
  → 社交分发、授权和交易
  → 收益回流 Creator
```

新增部分是规划，不应被回写成历史上已经上线。

## 6. 对象模型迁移

### 6.1 SoulSeries / SoulRelease / SoulPass

旧 PDF 白皮书使用：

- SoulSeries：Creator 的发行系列或身份；
- SoulRelease：版本内容；
- SoulPass / Soul Token：购买者的访问与持有凭证。

当前主网实际使用：

- `Soul`：Personal Kiosk 中可持有和交易的对象；
- `SoulState`：当前 Owner、Epoch、版税和关联状态；
- `SoulContent`：内容 Kind、Slot 和版本；
- `SoulGrant`：运行授权；
- `SoulPaidAccessList`：按 Kind 的付费访问；
- `SoulCollection` / `SoulCollectionRight`：集合与经济权利；是否可交易由 Collection 创建配置决定。

**采用决策：** v3 不再用 SoulSeries、SoulRelease 或 SoulPass 描述当前协议。若未来需要“系列”或“发行版本”，应作为新的 Creator / Collection / Manifest 概念设计，不能假设旧 ABI 存在。

### 6.2 Soul 与 Runtime

旧资料有时把 Soul、Agent 和运行实例混为一体。

**采用决策：**

- Soul 是持久身份与权利容器；
- Runtime 是一次或一个环境中的实际运行；
- Agent Instance 可以通过 SoulGrant 取得权限；
- Runtime 的模型、工具和本地状态不能未经声明自动成为 Soul 本体；
- 一个 Soul 可以有多个 Runtime，一个 Runtime 也可服务多个 Soul。

### 6.3 Soul 与协议代币

**采用决策：** 使用 “Soul Object” 指具体 Sui 对象，避免使用 “Soul token”。Soul 不是 Soulidity 协议的同质化代币。

### 6.4 Bound / Free Soul

分类研究提出 Bound / Free 与不同内容锁定组合，但当前主网 `Soul` 没有逐对象不可转让开关。Soul 被锁入 Personal Kiosk，并能通过满足 TransferPolicy 的 Soulidity 市场路径交易。

**采用决策：**

- 当前写“Soul 可在受支持市场路径中交易”；
- 不把 Bound Soul 写成当前协议能力；
- 未来如引入不可转让或条件转让 Soul，需要新的对象规则、创建时披露、升级兼容和退出方案。

## 7. 内容与版本迁移

### 7.1 Basic Info

旧 PRD 写 Basic Info 永久锁定，分类研究又提出多种 Bound / Free / Lock 组合。

**当前事实：** `Soul` 的名称、描述、图片和来源等基础字段没有通用编辑入口。

**采用决策：**

- 当前协议写“基础元数据铸造后不可直接编辑”；
- 可演进内容进入 SoulContent；
- 更灵活的锁定策略属于后续研究，不能写成当前功能。

### 7.2 Soul Character / SOUL_DOC

历史材料在“独立 soul.md”与“由 Skill + Memory 派生”之间冲突。

**当前事实：** 每次 mint 必须创建一个 `kind=soul_doc, name=soul` 的不可变内容槽。

**采用决策：** SOUL_DOC 是根角色说明或核心 Manifest；Runtime 可以根据 SOUL_DOC、Memory、Skill 和环境派生运行 Persona，但不能声称链上没有独立角色文档。

### 7.3 Memory

旧材料有“Memory 只追加、不可删除”的绝对表述。

**当前事实：** 每次 mint 在结构上必须至少包含一个 `kind=memory, name=default` 的内容槽；该槽支持 Append、Delete 和 Purge。

**采用决策：**

- “Memory Seed 可选”只表示 UI 可以允许用户不填写实际记忆正文；
- 交易构造器仍要生成满足协议要求的 default Memory 槽，空白 Seed 与缺少槽不是同一件事；
- 新版写成“可积累、可追溯且受治理的记忆”，并明确链上事件或第三方副本不一定能被全网擦除。

### 7.4 Release 与版本权益

旧白皮书同时存在“购买某一 Release 的永久访问”和“没有版本锁定”的表述。

**采用决策：**

- 当前所有权对象、内容访问和版本权益分开描述；
- Content Slot 的具体版本由链上索引确定；
- Creator 是否向旧 Holder 提供未来更新，需要由 Rights Manifest 或产品规则明示；
- 不再默认“买一次自动得到所有未来版本”。

### 7.5 Public 内容

**当前事实：** 当前 Slot 保持 Seal 加密；Public 表示公共审批路径，不等于 Move 中存储明文。

**采用决策：** 对外使用“公开可解密/下载策略”，不使用“所有公共内容链上明文”。

## 8. 授权与访问迁移

### 8.1 SoulGrant 数量

旧白皮书：“一个 Soul 同时只能授权一个 Agent。”

当前协议：

- 默认容量 1；
- Owner 可调整容量；
- 协议上限 10,000；
- 同一 grantee 新 Grant 替代旧 Grant；
- 支持 Scope、到期、撤销和所有权失效。

**采用决策：** 新版写“默认一个、可按需扩容”，不把上限当作现网活跃规模。

### 8.2 Subscription

旧资料中既有订阅型 SoulPass，也有“一次购买、非订阅”的后续决策。

**采用决策：**

- Soul 所有权交易不是订阅；
- Paid Access 是独立的按 Kind 访问产品；
- Runtime 服务、持续运营或新内容可以未来使用订阅，但必须作为独立合同与支付关系；
- 不再用“订阅”解释 Soul 持有。

### 8.3 Lifetime / Permanent Access

**当前事实：** Paid Access 可以没有时间到期，但 Owner 可撤销，Soul 转移后会失效，协议不自动退款。

**采用决策：** 统一写“无时间到期的访问条目”，不写“永久、不可撤销访问”。

### 8.4 转让影响

旧材料没有始终区分资产转让和授权生命周期。

**采用决策：** 所有界面和文档必须明确 Soul 所有权 Epoch 轮换会使旧 Grant 和 Paid Access 失效。

## 9. Collection 与外部资产迁移

### 9.1 CollectionRight

历史文案曾把 Collection 权利描述得接近成员全部收入或一篮子资产。

**采用决策：**

- SoulCollection 是共享集合关系；
- CollectionRight 是额外经济权利对象，仅在 `tradeable=true` 时可挂单和购买；
- 它不等于持有成员 Soul；
- 它不等于股份、基金或 Creator 的全部收入；
- 收入只来自协议定义的交易与费率。

### 9.2 Wrap + Link

旧 PRD 把既有 NFT 与 Soul Layer 的连接作为重要入口，但没有解决底层资产出售后的同步和解绑。

**采用决策：**

- 保留“给外部 OC / NFT 增加 Soul 能力而不改原合约”的产品价值；
- 当前只把 Imported / Personal Join 当作已实现来源；
- 完整 Wrap + Link 需要单独定义 Authority、双重转移、解绑、来源证明和争议规则；
- 在这些规则完成前不得声称外部 NFT 与 Soul 永久一体。

## 10. Sui、Walrus、Seal 与跨链迁移

### 10.1 链上边界

**采用决策：**

- Sui：身份、持有、权限、关键状态和结算；
- Walrus：大体积内容与 Manifest；
- Seal：基于链上策略的条件解密；
- Runtime：渲染、推理、高频交互和游戏过程；
- Indexer / DB：检索、社区、缓存和运营。

统一使用“链上原生、端到端可验证”，不使用无法证明的“所有内容、计算和社交都完全上链”。

### 10.2 Walrus 永久性

旧资料常用“永久保存”。

**当前事实：** Blob 注册有保存期限，当前默认流程没有完成无条件自动续期。

**采用决策：** 公开说明期限、续期、备份和导出；不得把 Walrus 描述成默认永久可用。

### 10.3 Seal 与密钥依赖

旧资料使用“没有 Grant 就绝对无法访问”等绝对表述。

**当前事实：** 协议路径依赖 Seal Key Server、链上策略和应用 sidecar；任何已经合法解密并复制的内容无法被协议远程收回。

**采用决策：** 写“协议访问路径内的条件解密”，并披露密钥服务、备份、客户端和已复制内容的边界。

### 10.4 Solana 与跨链

旧白皮书规划 Solana USDC 可信中继。

**当前事实：** 当前主网市场使用 Circle Sui USDC，没有生产 Solana 结算轨道。

**采用决策：** Solana Relay 标记为 `Legacy`。未来跨链优先做身份解析和活动适配；任何支付桥或远端 Soul 表示需要独立安全设计。

## 11. Animacraft 与 Maker 迁移

### 11.1 当前 Character Maker

保留事实：

- Animacraft v3 有独立主网 Package 和源码验证记录；
- Creator Studio / Player Editor、部件、图层、颜色和规则模型存在；
- 内容包与 Maker 资产使用 Walrus 和 Sui；
- 最终角色应在 Soulidity 中形成唯一 Soul。

不得扩大：

- 工作区 handoff 代码不等于生产适配器已经上线；
- `origin_ref` 不等于来源已验证；
- Animacraft v3 / v4 不等于 Soulidity 已支持对应 Schema；
- 候选分账参数不等于当前收费。

### 11.2 当前 Adapter 状态

**采用决策：**

> 已完成 `animacraft.oc-package.v1` 免费 Maker handoff 的工作区代码适配；UI 入口禁用，生产 `/import` 尚未激活。v3/v4、付费 Maker、来源证明和同一 PTB 授权消费属于后续集成。

### 11.3 Scene Maker

Scene Maker、RPG、小游戏、Quest、Run Receipt、Reward Pool 和 Activity Adapter 是本轮新增方向。

**采用决策：**

- 这些对象进入 v3 白皮书和概念规格；
- 状态统一为 `Planned` 或 `Research`；
- 首版从少量模板和一个端到端副本开始；
- 未部署前不提供 ABI 承诺，也不将其计入当前主网能力。

## 12. 社交与社区迁移

旧 PRD 的 Soul Feed、Soul Space、Karma 和排行大多源于交互原型；当前 Web 已有数据库驱动的社区实现。

**采用决策：**

- 当前写“Web 社区已实现”；
- 不写“可游玩的链上社交世界已上线”；
- 下一阶段把社交入口连接组队、活动、Scene 和共同经历；
- Karma 不再作为单一链上信用；
- 声誉拆成创作、任务、验证、治理和交易等证据；
- 补齐 Sybil、防刷、申诉、Moderation 和隐私。

原型中展示的 Soul 数、成交量、用户数和 USDC 数据属于 Demo Values，不得用于公开增长或采用陈述。

## 13. OCL 迁移

OCL 分类学是当前最适合连接 OC、Soul、Runtime 与 Agent 的研究框架。

**采用决策：**

- 保留 OCL-0 Concept、OCL-1 Defined、OCL-2 Persistent、OCL-3 Interactive、OCL-4 Operational、OCL-5 Autonomous；
- 保留 `I-M-X-A-U-R` 六维能力指纹；
- 等级只描述能力，不评价艺术价值、稀有度或价格；
- 区分 Claimed 与 Verified；
- 绑定实体、版本和 Runtime 环境；
- 能力越高，权限、预算、审计、停止和接管要求越高；
- 当前状态为 `Research / Planned`，尚无生产认证 Registry。

## 14. 经济、DeFi 与融资迁移

### 14.1 当前经济事实

- 当前市场使用 Circle Sui Mainnet USDC；
- MarketConfig 基线平台费为 250 bps；
- Soul 交易可拆分 Seller、平台、Creator 和可选 Collection 费用；
- Paid Access 和 CollectionRight 已有当前协议路径；
- 项目当前没有已发行的 Soulidity 协议代币。

当前 Soul 固定价交易以 Listing Price 为 Seller 价格基数，Buyer 另外支付平台费、Creator 版税与可选 Collection 版税的精确总报价。旧 PRD 中“所有费用从 Seller proceeds 扣除”的口径不再代表当前合约。

**采用决策：** 所有 UI、白皮书和报价示例均使用“Buyer 支付 Listing Price + 适用费用”；不得混用旧 Seller 扣费模型。若未来调整计费基数，必须作为合约和经济模型变更披露。

### 14.2 旧融资 Deck

旧 Deck 记录了以下历史方案：

- 目标 FDV：30M 美元；
- 私募融资：1.5M 美元；
- 私募分配：5%；
- 历史 Token Allocation：
  - Angel 2%；
  - Seed 2%；
  - Private 5%；
  - Team 18%；
  - Ecosystem 30%；
  - Treasury 23%；
  - Liquidity 20%。

这些数字全部标记为 `Legacy`，不进入 v3 公开白皮书，不构成当前融资、估值、代币发行、收益或治理承诺。

如需制作新融资材料，必须重新建立：

- 当前法律主体和融资工具；
- 已完成产品与真实用户/收入证据；
- 募资用途和里程碑；
- 股权、Token、收入权或其他工具的清晰区分；
- 风险、锁定、治理和信息披露；
- 所有市场和竞品数据的可追溯来源。

历史里程碑中的 Walrus Grant、Eve Collection、Sui 官方认可、三个月融资完成等项目，在现有追踪资料中没有可公开验证的完成证据，且原时间窗已经过去。它们只能作为过往目标，不能表述为已获 Grant、合作、官方背书或融资完成。

### 14.3 Animacraft 候选经济参数

Animacraft v4 资料中的候选参数包括：

- 初级分账中协议份额默认 50%，上限 50%，其余归 Maker；
- Soulidity 二级平台费候选为 2.5%；
- Maker 二级版税候选范围 0—5%。

这些是候选或门控参数，不是当前全局事实。正式启用前需要 Adapter、总费率上限、费用叠加、法律和用户披露审阅。

### 14.4 DeFi 顺序

**采用决策：**

1. 真实 Maker / Scene 使用收入；
2. Reward Pool、赏金和里程碑托管；
3. 特定收入流的分账凭证；
4. 依据历史现金流的 Creator Financing；
5. 最后才研究抵押、借贷和流动性。

禁止在没有真实现金流、价格发现和清算模型时，把 Soul 稀有度直接当作抵押价值。

## 15. 被废弃、保留与待决事项

### 15.1 明确废弃

| 项目 | 结论 |
| --- | --- |
| SoulSeries / SoulRelease / SoulPass 作为当前主网模型 | 废弃 |
| Solana USDC 可信中继作为当前能力 | 废弃 |
| 一个 Soul 永远只能一个 Grant | 废弃 |
| Memory 永远只能追加 | 废弃 |
| Paid Access 永久不可撤销 | 废弃 |
| Walrus 默认永久存储 | 废弃 |
| 持有 Soul 自动获得全部 IP | 废弃 |
| 旧 Deck Tokenomics 与融资条款 | 废弃为当前方案，保留历史记录 |
| 原型 Demo 数据作为运营数据 | 废弃 |

### 15.2 保留并重述

| 历史概念 | v3 表达 |
| --- | --- |
| One Soul, Many Forms | Create Once. Live Across Worlds. |
| Create / Import / Own / Authorize / Trade | 继续作为当前基础闭环 |
| Sui + Walrus + Seal | 继续作为身份、内容与访问技术基础 |
| SoulGrant | 改为可扩容、Scope、到期和 Epoch 失效的当前模型 |
| Soul Collection | 与 CollectionRight 和成员所有权严格分离 |
| Wrap + Link | 保留为外部资产接入方向，状态降为待完整设计 |
| Community / Soul Space | 保留为发现和关系层，扩展到共同活动 |
| Agent API | 保留为 Runtime 接入基础 |
| OC / Agent 连续谱 | 由 OCL 统一表达 |

### 15.3 尚待产品或治理决策

- Rights Manifest 的法律模板、字段和发布责任；
- UpgradeCap / AdminCap 的多签和时间锁；
- Walrus 自动续期、费用承担和内容导出；
- Seal sidecar 的备份、恢复和运营责任；
- Animacraft Adapter 的版本、原子结算和收费；
- Scene 首版执行模式和结果验证者；
- Outcome 写回的 Holder 接受与预授权规则；
- Reward Pool 的反作弊、退款和资产白名单；
- Creator、Maker、Scene、素材和 Collection 费用叠加上限；
- OCL Verifier 准入、复验、降级和争议；
- 社交关系、成就和 Memory 的隐私策略；
- Wrap + Link 的转移、解绑和来源证明；
- 公共 SDK 的包名、版本与兼容范围；
- 是否以及何时需要协议代币。

## 16. 公开写作规则

### 16.1 必须带状态

任何以下内容必须带 `Mainnet / Implemented / Pilot / Planned / Research / Governance Pending / Legacy`：

- 合约、对象或市场；
- Maker 与 Adapter；
- Desktop 功能；
- Scene、游戏与社交世界；
- OCL 与验证；
- DeFi、融资与代币；
- 治理与去中心化。

### 16.2 禁止绝对化

| 避免 | 使用 |
| --- | --- |
| 完全去中心化 | 说明具体 Cap、服务和治理状态 |
| 所有东西全链上 | 关键路径上链、运行模式可验证 |
| 永久存储 | 有期限存储与续期 |
| 无法绕过 | 协议路径内受策略控制 |
| 永久访问 | 无时间到期，但说明撤销和转移 |
| 真正拥有全部角色 IP | 持有链上对象，法律权利见许可证 |
| Maker 已接入 | 说明代码、生产、主网和端到端各自状态 |
| 用户数 / TVL / 成交量 | 给出时间、数据源、口径和排除项 |

### 16.3 数据引用

- 主网对象和费率：引用 deployment manifest 与链上对象；
- 产品发行：引用当前生产入口和版本；
- 代码能力：引用具体实现路径，但标注是否部署；
- 市场规模和竞品：使用可访问的外部一手来源并标日期；
- 团队和合作：由本人或组织确认；
- 用户与收入：区分链上事件、数据库用户、测试账号和 smoke test；
- 不复用原型 Demo Values。

## 17. 建议的物理归档

本轮为保护用户现有文件，没有移动或删除历史资料。后续可以在单独变更中采用：

```text
docs/
  v3/
    README.md
    SOULIDITY_PROJECT_OVERVIEW_CN.md
    SOULIDITY_WHITEPAPER_V3_CN.md
    SOULIDITY_PRODUCT_PROTOCOL_SPEC_CN.md
    SOURCE_AUDIT_AND_MIGRATION_CN.md
  research/
    OC_MATURITY_TAXONOMY_CN.md
    soul-classification-roadmap.md
  legacy/
    2026-03-whitepaper/
    product-prototype/
    fundraising/
```

迁移时建议：

- 保留原始文件名和 Git 历史；
- 在 Markdown 顶部加入 Legacy Banner 和新版链接；
- PDF、PPTX 不修改原件，只在同目录增加 `README.md`；
- 不把含潜在敏感融资信息的 Deck 放入公开发布包；
- 更新所有根目录链接后再移动；
- 不删除聊天记录，只降低其事实优先级。

## 18. 维护检查表

每次公开发布前检查：

- [ ] 当前 Package ID 与对象 ID 是否匹配部署清单；
- [ ] 当前 MarketConfig 费率、暂停状态和支付资产是否核验；
- [ ] Mainnet、Implemented、Pilot、Planned 是否分开；
- [ ] 代码存在与生产部署是否分开；
- [ ] Walrus 保存期限和 Seal 依赖是否披露；
- [ ] Grant、Paid Access 和所有权 Epoch 是否表述正确；
- [ ] CollectionRight 是否与成员所有权、股份分开；
- [ ] 导入来源是否区分声明与验证；
- [ ] Maker Adapter 是否真的生产激活；
- [ ] Desktop 平台、签名和版本是否核验；
- [ ] Scene / Quest / OCL 是否仍属于规划；
- [ ] 所有 IP、许可和人格权表述是否有边界；
- [ ] 用户、收入、市场和竞品数字是否有来源；
- [ ] 是否误用了旧 Tokenomics、估值或融资条款；
- [ ] 关键 Cap 与治理状态是否更新；
- [ ] v3 四份主文档的基线日期是否一致。

---

本审计与 [白皮书 v3.0](./SOULIDITY_WHITEPAPER_V3_CN.md)、[项目总览](./SOULIDITY_PROJECT_OVERVIEW_CN.md) 和 [产品与协议规格](./SOULIDITY_PRODUCT_PROTOCOL_SPEC_CN.md) 共同构成当前资料基线。
