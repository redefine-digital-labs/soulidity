# Soulidity 资产标准 v0.1

> 2026-10-10 当前阅读入口：[开放生态完整说明](SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md)与[对象权利](open-ecosystem/OBJECTS_AND_RIGHTS_CN.md)、[入口权限依赖](open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md)、[状态恢复](open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md)。本文保持历史稿，旧兼容优先、通用库存、全组件自由流通及等待开工等表述不覆盖后续决定；三类组件与整套交易按当前 [Soul DOF 规范](SOUL_DOF_V1_REBUILD_CN.md)执行。

2026-10-07 用户最新纠正：每Part一件固定Style；仅Creator声明可独立交易的组件发行真实对象，其余为REFERENCE或永久SOUL_BOUND记录；撤销旧Player多容量、通用未启用库存及默认全组件自由流通假设。目标和退出/整套/授权语义以 [Soul DOF v1 §2／4／5](SOUL_DOF_V1_REBUILD_CN.md)为准，本文仅保留研发历史。

2026-10-07 最新决定：用户已明确允许完整重构与新部署，不需要兼容不成熟旧版。当前目标以 [Soul DOF v1 全新底层规范](SOUL_DOF_V1_REBUILD_CN.md)为准。本文件保留为研发历史；下文“保留旧类型／ID”“兼容承接”“尚未批准实施”等旧阶段条件不再约束新构造。DOF、四类产品、资格与整体交易的业务讨论由新规范承接。

日期：2026-10-07，Europe/Moscow。状态：Plan／研发评审稿；统一标准未实现、未部署、未通过符合性验收。本文承接[完整卡槽方案](ANIMACRAFT_SLOT_SYSTEM_PLAN_CN.md)，先确定资产形成与交接，再组织发行、商业和组合能力。设计完成不改变现有 M1–M4、S0–S14、G1–G5、活动 Owner、Bug 优先级或 CURRENT。

用户已明确：现有底层可能需要重构，整体设计不能以复用当前对象布局为前提。当前源码映射是现状证据；必须保留的边界是已有产品内容、使用资格、资产和确认的业务语义，不是旧的 key／store、Root＋Cap 或引用＋锁实现。下述新构造是重构候选，尚未批准实施或冻结 ABI。

本轮进一步收敛：如果先标准化一个对象，先做 Soul。Maker／Pack 是上游定义与发行，Composable Items、技能、视觉、内容与游戏运行时是组合及下游应用。四类资产的完整映射保留作为整体规划，第一条可执行出口是 Soul Core＋组合／扩展接口，而不是同时重构四类资产。

用户最终澄清架构意图：以 DOF 构建 Soul，即稳定根对象＋有类型、可版本化的拥有型模块共同组成完整 Soul。下文第 1.5 节是目标组织方式；第 1.4 节是保留现有类型及权益的实施边界。DF 用于模块内部的小值、索引及必要旧关联，DOF 是标准模块与实际子资产的组织主干。

## 1 最小构造

**确定的内容版本＋协议可执行的可转移权利 → 一个可识别、可持有、可交易的资产。**

资产核心回答：它是谁，绑定什么，谁持有什么，转让后交接什么。Maker、Pack、Composable Items、Soul 是产品类别；Asset Core 是它们共同遵守的身份、权利与转让契约。

Sui 已有对象身份和所有权基础，本项目的增量是统一内容、有效控制权、交接结果和操作接口，不额外创建一枚仅代表原资产的包装币。核心简洁不等于各资产具有相同权利或相同转让副作用。

标准必须落到 Move 对象形态、abilities、原生归属、权限入口和原子状态约束。AssetRecord 只是统一读取结果，不足以单独构成协议；具体对象构造及卡槽原语选择见第 7.1–7.5 节。

第一版只允许两种明确的持有含义：

| 持有含义 | 用户得到什么 | 当前对应物 |
| --- | --- | --- |
| 产品控制权 PRODUCT_CONTROL | 在既有政策范围内管理指定产品；可转移的收益和其他权限逐项明示 | Maker Root、Pack Release、External Item Product 与各自当前 AdminCap |
| 实例所有权 INSTANCE_OWNERSHIP | 持有一个具体组件或角色，执行被允许的使用和转让 | OwnedBaseItem、OwnedExternalItem、Soul 及其权威状态 |

这两项是 Asset Core 的权利类别，不是新增两枚代币。访问资格继续独立表达，不能通过访问凭证控制或出售源产品。

Maker 同时具备两个明确的经济入口：符合使用政策的人可以基于它生成自己的 OC／Soul；产品持有人可以转让 Maker 本身。使用资格、生成实例和产品控制权分别核验，不要求玩家先买下 Maker，也不把使用资格等同产品控制权。标准必须同时描述使用与转让政策。

普通素材文件、Slot、CompatibilityBinding、Representation、配置模板、报价和搭配记录不自动成为独立资产；只有明确定义发行、持有及交接语义后才能进入资产目录。

### 1.1 第一标准对象：Soul Core v1 候选

**Soul 是有独立身份、可持有／交易、可扩展、可组合的角色资产。** Maker 是其一种上游发行器，不是 Soul 格式的强制前提；导入或其他合法发行器也能产生符合标准的 Soul。下游产品以 Soul ID、准确内容及扩展契约接入，不要求使用 Animacraft 专用页面。

以第三方容器及市场接入为首要目标，默认核心候选为 Soul has key, store。该类型具备作为其他容器 DOF 子资产、以及容纳 key＋store 组件的原语条件。现有生产 Soul 仍按 Kiosk 锁定和实际 TransferPolicy 流转，不能因此直接取出放入任意容器。key＋store 不证明当前市场已支持高级扩展、私密授权或全部转让政策；已核验边界见第 1.6 节。

当前 Soul 已具有 key＋store，不需要为了达到上述原语条件重写。第一优先是保持现有 Soul 类型、布局、ID、展示和来源字段，通过版本化 DF／DOF 及受控接口扩展。下表描述 Soul 标准的六组逻辑信息，不要求全部变成 Soul struct 的新增顶层字段；具体引用值结构及 BCS 尚未冻结：

| 字段组 | 候选字段 | 最小语义 |
| --- | --- | --- |
| 对象身份及版本 | id: UID；schema_version | 沿用 Soul.id／version；扩展标准版本存于版本化键／描述值，不能混成原对象布局版本 |
| 通用展示 | name；description；image_url | 钱包／市场的名称、简介、公开代表图；提供 Sui Object Display，展示结果不是权限证据 |
| 不变来源 | origin_ref | 沿用 creator／provenance_kind／origin_ref 与准确原生来源绑定；补充强类型证明可通过只读接口／版本化引用表达，不覆盖既有来源 |
| 本体内容 | genesis_content_ref | 读取现有 SoulState→SoulContent／准确来源记录，补齐不变初始内容承诺的标准读取；保护内容仍在 Walrus／Seal，不要求新增顶层指针或复制内容 |
| 组合定义 | composition_schema_ref | 位于 DOF 的 SoulComposition 模块，绑定准确 schema／版本；具体 Soul 可以没有开放槽位，不扩大原准入权限 |
| 当前配置版本 | revision | 位于 DOF 组合／扩展模块，随受控绑定变化递增，用于一致读取及报价；不是原生所有权轮次，不会因任意 public_transfer 自动递增 |

槽位实际内容与扩展值置于 Soul UID 下，避免把 hats、weapons、skills、memory、games 等不断加进核心 struct。市场的公开代表图可以是与当前 revision／组合承诺匹配的已验证渲染结果；只支持基础字段的客户端也能展示代表图。Object Display 不会自行运行视觉合成或技能代码。

不在核心新增第二个 owner 地址作为所有权权威。原生 owner 可能是钱包或容器；共享容器的业务控制者需由其真实权限证明。SoulState 或读取结果里的 owner 缓存不能在原生归属变化后继续授予旧持有人权限。

### 1.2 Soul 的槽位与扩展，区分三种关系

| 关系 | 所在状态及作用 | 举例 |
| --- | --- | --- |
| 持有关系 owns | DOF 存放实际 key＋store 子对象；允许泛型存储，不自动激活其能力 | Soul 的库存持有帽子、技能资产或游戏道具；Soul 本身也可被第三方容器持有 |
| 激活关系 equips／activates | SlotBinding 明确位置、实例／资格、表现、精确兼容及许可 | 帽子被激活到 head；某能力模块被激活到一个功能槽 |
| 内容／资格关系 references | 普通动态字段或准确内容引用；不虚构资产所有权 | Maker／Pack 使用资格、角色配置、加密记忆引用、模块运行时参数 |

基础定义统一有类型、带来源版本的 SlotKey／ExtensionKey。视觉槽、功能槽、游戏槽等是组合 schema 的扩展类别，不是新 Soul 资产类型。SoulConfiguration／Skill／Memory 可以作为版本内容或配置；只有存在真实独立可转移权利时才另行发行对应资产。

DOF 是 Dynamic Object Field，即动态对象字段。其存储原语类似 parent UID 下的有类型键值对：键是 SlotKey 或 InventoryKey，值是实际子对象；对象可以在部署后按合法接口增删，子对象仍按自身 ID 可查询。普通 dynamic_field 更适合配置、引用和 SlotBinding 值；dynamic_object_field 更适合实际子资产。SlotKey 可直接作为 DOF 名称，也可用 InventoryKey 存储成员、SlotBinding 另记录激活，两者不能同时保存同一个实例的两份所有权。

安装模块不等于授权它执行动作。功能扩展需要已声明的接口版本、输入／输出、运行时及权限范围；Move 能力通过实际模块操作，AI／视觉／客户端能力由相应运行时解释。读取元数据或 SKILL 文本不能自动获得签名、支付、对外消息或受保护内容读取权限。

### 1.3 第三方接入的最小契约及保证范围

标准候选至少定义下列公共读取／业务接口；名称是协议语义，真实 Move 类型与 ABI 待原型固定：

- read_soul：身份、来源、基础展示、内容引用、当前 revision、可选能力及政策；所有权同时读取原生归属／合法托管证明。
- read_composition：schema、被持有的子资产、激活槽位、表现及许可分别返回；仅保存的资产不自动成为当前装备。
- attach／detach：实际子资产存入／取出，维护类型、来源、数量／循环约束与 revision；支持符合准入的第三方类型，不要求伪装成平台发行 Item。
- equip／unequip／replace：在合法持有或资格基础上原子更改激活关系，失败回滚，不能重复占用。
- preview_transfer：返回准确包含清单、状态版本及要求；允许第三方市场复核报价，不能以快照替代实际原子交接。
- OwnerProof／CustodyProof 扩展：所有者或容器授权的变更／使用权限；未知共享容器不凭调用者地址、声明元数据或缓存 owner 获得写权。

接入分层验证：基础对象可存放／转移；Display 与只读 schema 可发现／展示；高级激活、私密读取、授权及特殊交易通过对应接口与符合性 profile 验证。key＋store 并不保证任意容器自动支持所有 Soul 功能；标准公开证明／适配契约，第三方可以实现，而非强制由平台专用市场执行全部操作。

转移一个持有子资产的父对象，子资产控制随父对象移动；核心不能把“免费通用转移”描述成“自动清槽、更新授权轮次”。当前 Animacraft 普通 Soul 出售仍按用户确认保留卖家组件，市场动作需原子卸装再交接；DOF 目标标准同时明确支持整套组合出售，包含范围及交易要求见第 1.7 节。第三方调用 public_transfer 时可以绕过该市场动作，因此市场流程规则与全局转移保证分别声明，绝不混同。

如果私密授权等扩展要求每一次所有权交接都撤销旧授权，必须用能够覆盖实际归属变化的证明及受控托管／转让 profile；普通 key＋store 核心加一个 owner_epoch 字段不会自动实现。现有受保护 Soul 在完成这项等价证明前，不得为了通用组合将其从现有受控路径直接释放。

第一项研发原型收敛为：独立生成一个不依赖 Maker 的标准 Soul，放入第三方形态的容器，装入／取出一个第三方组件，以基础 Display 展示并通过 Kiosk 支持的流程成交，再验证普通空 Soul 转售与明确组合转售清单。功能槽只验证一个接口明确的能力模块及显式授权；完整 Maker／Pack 资产重构在这条出口之后安排，不改现有交付排期。

### 1.4 实施优先级：保留 Soul，扩展 DF／DOF 和接口

Soul 标准化不等于重写 Soul struct。当前定向源码依据为 SO soul.move 第 43 行的 Soul has key, store，以及第 365 行 bind_state_pointer：现有 Soul UID 已用 dynamic_field 保存不可变 SoulState 指针。SoulState 是共享权威状态，不能为了“都用 DOF”直接移入 Soul；现有内容及装备关系继续按其真实类型读取和承接。

优先扩展构造为：

    原 Soul 类型／ID／既有字段不变
    ├─ 既有 DF：SoulState 指针（保留原不可变关联）
    ├─ 新 DF：带类型／版本的 schema、扩展描述、激活绑定或准确引用
    └─ 新 DOF：确实需要父持有的组件或组合扩展对象
                 └─ 扩展对象内部承接自己的 revision、schema 及必要子资产

这些不是必须全部创建的对象：简单配置／引用使用 DF 值即可；只有需独立对象身份或实际资产容纳时才使用 DOF。可以直接在 Soul UID 下按槽位保存组件，也可以引入一个由 Soul 持有的组合扩展对象，具体选择用最小原型确定。不得同时保留两份组件所有权或两份可分别授权的激活权威。

DOF::add／borrow_mut／remove 要求合法取得父对象 UID；它不是根据 Soul ID 就能任意写入的数据库。当前 soul 模块未公开可变 UID，外部模块不能直接访问私有 soul.id。需要由定义模块增加带所有权／托管证明、命名空间、保留键及退出规则的 attach／detach／replace 等入口；不为通用扩展暴露可任意修改全部动态字段的 &mut UID，避免删除／替换既有 State 指针。读取适配与 Display 可以先扩展，实际持有关系变化必须走真实入口。

接口增补需要由现有定义模块提供能力时，可以评估兼容包升级，不需要改变 Soul 布局。兼容升级可新增类型／函数，既有结构布局和 abilities 必须保持。2026-10-07 只读链上核验确认当前 Mainnet UpgradeCap 存在，绑定现用包且 policy=0（COMPATIBLE）；这解决了“是否还有升级能力”的事实问题，不表示任何候选代码已通过升级兼容检查或获得执行授权。具体证据及旧入口限制见第 1.6 节，不预先把所有现有 Soul 迁移或重铸。

只有证据表明 DF／DOF 及受控入口无法表达确切目标，才另行论证新的 Soul 类型或迁移。当前已知独立问题包括 key-only 的旧 Item 不能直接作为 DOF Value、共享装备状态不能直接改为拥有型子资产，以及通用转移不会自动执行授权交接。这些需要组件／关系／权限方案，不能以“重写 Soul 本体”替代验证。

### 1.5 目标构造：以 DOF 组织完整 Soul

**Soul = 稳定根对象＋标准 DOF 模块＋合法接入的 DOF 子资产。** 根对象承担唯一 Soul 身份及基础市场展示；角色内容、组合规则、当前表现及能力模块用独立的拥有型对象组织。现有根类型保持不变，不为了每项新能力增加一个顶层字段。

候选组织如下；名称与布局是研发规范候选，非已编译／部署 ABI：

    Soul（key＋store；稳定 UID、原有必要字段）
    ├─ CoreKeyV1           → SoulCoreV1
    ├─ CompositionKeyV1    → SoulCompositionV1
    ├─ ItemKeyV1(item_id)   → T：实际 key＋store 组件
    └─ ExtensionKeyV1      → E：符合接口的 key＋store 第三方模块

| DOF 模块／成员 | 职责及边界 |
| --- | --- |
| SoulCore | 标准内容 manifest、人设／Soul Configuration、确切来源及许可引用；与根中既有来源保持一致，不产生第二份来源或所有权权威 |
| SoulComposition | 准确 SlotSchema、激活 SlotBinding、表现选择、revision 及必要成员索引；只负责接受／激活关系，ItemKey 下的真实对象才是资产持有事实 |
| 实际组件 T | Soul 直接持有组件；组件自己的 ID 仍可查询。库存未激活和当前装备分开，不为每个槽位生成虚构装备资产 |
| 第三方模块 E | 可按公开接口提供视觉、技能、游戏状态、记忆／数据引用等扩展；模块内部可以使用普通字段、DF 或进一步 DOF，不要求每个参数都成为对象 |

Core 为标准内容读取提供确定入口；具体采用结构的实例首次启用时必须建立有效 Core。Composition 及其他模块可以在需要时合法创建，空槽和未安装模块不自动发行对象。实际组件放在根的 ItemKey 下，激活关系在 Composition 中引用其 ID；不能再把同一实例作为另一份 DOF 值存入模块，避免多份持有记录被当成真实归属。

模块拥有 UID 不表示它就是独立可出售的资产。基础内容、来源和组合管理模块按协议限制拆卸／替换；可交易 Item 按其许可及取出政策拆装。核心内容模块不能因通用 detach 接口而随意移除或替换来源。Maker／Pack 默认是上游来源及资格引用；只有明确交接其产品控制资产时，才作为实际资产放入容器。

ExtensionKey 至少区分可信类型命名空间、接口主版本及本地键；SlotKey 继续绑定准确来源定义与部位。通用接口负责存入、取出、查询及范围约束，各模块负责自身解释／操作；DOF 本身不执行插件代码。根模块不直接暴露任意可变 UID，第三方通过有范围和有效所有者／托管证明的接口接入，无需把所有第三方模块都定义进 Soul 原 struct。

对同一个版本化 DOF，可以经 borrow_mut 和模块接口修改内容；替换为新模块版本要显式核对旧／新类型、来源、数据承接与策略，在同一交易更新激活关系及 revision。完整读取由标准 reader 解析根及已声明模块，基本市场读取根 Display；不支持的可选模块仍能被列出，但不能被猜测为已激活功能。

旧 SoulState／SoulContent／持久装备仍按其真实共享或拥有型结构处理。Core／模块可先保存准确引用，并提供标准读取视图；只有单一权威承接验证完成后才切换行为，不能同时让旧 Loadout 与新 Composition 独立决定同一 Soul 的当前装备。此处的 DOF 目标构造不授权把共享对象改为子资产、覆盖旧权益或释放受保护资产。

### 1.6 现有 Soulidity 的具体改造清单

**改造主线是：保留 Soul 根；补标准模块和受控 DOF 接口；改造真实组件归属；补齐托管／权限／成交契约；由 SDK 统一读取与操作。** 内容存储、使用资格与产品商业政策继续按各自准确来源承接，不要求同时重构所有 Maker／Pack 产品。

本轮核对 SO 工作区 `/Users/naoer/.codex/worktrees/f722/soulidity`，11 个定向源码／清单文件的实际字节均与 CURRENT 所列正式 master `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e` 一致。工作区本身有大量其他未提交变更，不把其 HEAD 或整棵工作树当成冻结候选。本轮只读对象及源码哈希保存在[现状证据](../output/asset-standard-2026-10-07/current-soulidity-baseline.json)；各链上对象分别读取，未固定为共同 checkpoint，也未验证完整包字节与源码等价。

| 层／现状源码 | 当前已有 | 本方案需要的变化 |
| --- | --- | --- |
| 根：`soul.move:43,365` | Soul 已 key＋store；稳定身份、展示、来源；DF 保存不可变 SoulState 指针 | 保持 struct、abilities、ID；由 soul 定义模块新增标准初始化、受限模块读取／修改、attach／detach 入口，维护保留键和成员索引，不暴露任意可变 UID |
| 标准模块：拟新增 `soul_core`／`soul_composition` | 没有根下的 Core／Composition 标准 DOF | 新增拥有型 SoulCoreV1 与可选 SoulCompositionV1，均 key＋store；Core 是准确内容与来源入口，Composition 保存 schema、激活绑定及 revision；标准键与主版本固定，基础模块不得作为普通 Item 取出出售 |
| 内容：`content.move:136,728,962` | 共享 SoulContent 管理版本、活跃绑定和许可；其 UID 下已有 DOF 托管实际 Walrus Blob；Seal 保护读取 | Core 先引用准确 Content／kind／name／version、内容承诺和政策；复用已有 Walrus／Seal 及版本语义。共享 SoulContent 不能直接搬进根 DOF；未来新增拥有型内容模块须另有权限和数据承接证明 |
| 装备：`animacraft_equipment_adapter_v8.move:21,55,86`，AC `runtime_v8.move:788,3350` | 持久装备是共享 MakerLoadout；原子更新 guard、引用选择及实例锁已经存在 | 对原生组件建立 DOF 持有＋Composition 激活；对 Maker／Pack 资格仍保留引用选择。沿用原子替换、准确兼容、稀疏空位和来源许可性质；同一 Soul 只能有一个有效装备权威，不能新旧同时写 |
| 实例：AC `runtime_v8.move:660,675` | OwnedExternalItem／OwnedBaseItem 为 key-only，holder／epoch／equip_lock 由原协议维护 | 泛型 DOF 组件优先采用新 key＋store 类型及原生归属；旧类型不能直接加 store 做兼容升级。旧实例先按真实类型读取；若需转换，必须先退出旧占用并交接唯一实例权利，旧对象／权益如何承接待原型验证，不能仅套壳后保留旧资产可独立出售 |
| 权限：`soul.move:409,589`、`grant.move:444`、`animacraft_v8_binding.move:61` | State owner／Kiosk／epoch、Grant 与原生来源 witness 支撑现有受控路径 | 将新模块变更权限与当前原生归属／真实容器权限绑定；现有 State 缓存继续只在其已验证托管 profile 内授权。第三方容器接入要有公开的证明和适配契约；未知共享容器不凭自报 owner 获得写权或私密读取 |
| 发行：`market.move:2480–2575` 及 Native Complete 入口 | 内容及 State 指针在 mint 内绑定，再把 Soul 锁入 Kiosk；初始 SOUL_DOC／MEMORY 完整性检查已存在 | 新的标准发行入口在同一交易建立有效 Core／必要模块与来源；现有 Soul 可通过合法 Kiosk 借用根后启用模块，不默认重铸。升级不会重跑 init；旧 mint 仍可调用，旧入口产物不自动宣称已安装 Core |
| 交易：`market.move:624,675,3101` | Personal Kiosk＋锁定＋SoulMarketProof；原生 Soul 普通出售要求先清装备；成交更新 State／Grant 轮次 | 把展示、交接预览、精确包含清单和结算接口公开给市场；分别提供单独出售卸装留卖家、整套出售交接 DOF 成员的能力。通用容器流转与组合成交需实现验证，不能通过删除 TransferPolicy 规则来假装兼容 |
| SDK／客户端：`soul-public-read.ts:118`、`tx/animacraft-equipment-v8.ts:121`、`browser-soul-custody.ts`、`soul-downloader.ts` | 准确 BCS、State 指针、Kiosk 托管验证，AC 专用装备交易／读取；SoulDesk 按内容 metadata 下载 | 增加模块发现、类型／版本解析、完整 Soul／组合视图、模块及组件操作构造器，校验对象引用／revision。组件归 Soul 后，资产列表也要读取 Soul 的子资产，不能因钱包 owned-object 查询中消失而显示为丢失。现有严格托管验证保留为 Legacy profile，扩展新的受证据约束的容器 profile；Web／SoulDesk／游戏复用标准读取，分别处理未安装、空装备、保护失败与未知可选模块 |

建议新增源文件是职责划分，尚未冻结模块数量、Move 签名或 BCS：`soul_core.move` 定义 Core 与准确内容引用；`soul_composition.move` 定义组合 schema、绑定和更新约束；根 UID 的受控操作仍由 `soul.move` 提供。若使用跨模块访问凭证，只给确切范围，不创建可独立交易的第二份 Soul 控制权。第三方模块通过泛型入口、准确类型与公开证明契约接入，Move 没有凭字符串接口自动动态调用任意模块的机制。

**已核实的升级与托管条件。** 当前 Mainnet 包为 `0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9`。UpgradeCap `0x57bee7ad5422e4aee8c4bfa7ab8fc95d55d67cfc2d551751a79280526483ab25` 为 AddressOwner，持有人 `0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f`，包版本 1、policy=0。实际 Soul TransferPolicy 也读出 kiosk_lock_rule、personal_kiosk_rule 和 witness_rule<SoulMarketProof> 三项，PolicyCap 当前由同一地址持有；本轮没有发现这些 Cap 被托管于链上多签／时间锁对象，不对钱包的链下签名控制作推定。

原验收 Soul `0x79ad675023398861f6986859c95bb28a03e07168b4175590c1c2cb43d9182f0f` 的原生 owner 为 Kiosk Item DOF 中间字段，该字段归属其 State 所指 Kiosk；`kiosk::Lock` 动态字段值为 true。它可以在合规、未上架时通过 Kiosk 的可变借用操作根下模块，但现状不能使用 `take` 将锁定 Soul 直接放进另一个通用容器。向第三方开放实际流转还需要精确解决托管和现有授权交接，不能由 Core 的描述字段宣布实现。

Sui 的[兼容升级约束](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)允许新增类型／函数，但不能改旧 struct 的布局及 abilities；旧包仍可被调用。policy=0 的含义见[框架 package 模块](https://docs.sui.io/references/framework/sui_sui/package)。因此“新入口会检查”不足以证明旧权限已失效，尤其现有 Content／Grant／Loadout 入口只接收共享 State 时，必须给出旧入口不能继续授予错误权限的实际证据。新增类型的定义包 ID 也不能一律假定等于 Soul 的 originalPackageId；SDK 应按真实 type origin 和 callable package 分别路由。

**第一个研发出口。** 先冻结最小 Soul Core／Composition 键和字段语义，再做独立 Move 原型：同一 Soul 身份下建立 Core；装入、激活、更换、取出一件第三方 key＋store Item；验证失败回滚、唯一占用和准确读取。分别验证新生成的普通公开 Soul 的第三方容器／Kiosk 流转，以及已有锁定 Soul 在其当前托管内增加模块。两条旅程的保证范围分别报告，不以新对象成功证明旧 Soul 已迁移。

随后把读接口与操作构造器做进 SDK，接入 Web 与 SoulDesk；再验证现有 Maker 免费／付费、Pack 免费／付费／包含资格、Complete 政策、私密读取及普通 Soul 转售。涉及现有实例改型、装备权威切换或受保护 Soul 跨容器的实施增量，只有唯一权威、旧入口和退出性质获得证据后才进入原交付记录。本次仅完成改造设计和现状核验，没有改变排期、候选源码、链上资产或授权。

### 1.7 整套组合出售：标准明确支持的交易形态

用户进一步确认 DOF 构造应能承接整体出售。目标标准明确提供两种交易形态，不为此新增一种 Soul 类型、Soul ID 或包装 NFT：

| 交易形态 | 实际交接 | 装备处理 |
| --- | --- | --- |
| Soul 单独出售 | Soul 根及其必要 Core／状态；可分离组件退出后留卖家 | 保留现有普通出售的原子卸装规则 |
| Soul 整套出售 | 同一 Soul 根，连同其 DOF 持有的、符合许可的组件／扩展及准确组合状态 | 保持所售激活布局，资产控制随根交接；不是把组件逐件复制或重铸给买家 |

整套出售利用真实父子归属：子对象继续保有自身 ID 和父持有关系，接收方取得根及其下属资产的控制。库存中未激活的真实子资产同样会随根交接，因此清单必须覆盖所有仍由根持有的资产，不能只列屏幕上可见的装备。要排除某件资产，应在有效上架／成交前通过合法操作取出，并更新清单；报价清单不能将仍在父对象内的资产虚构为“留卖家”。

Maker／Pack 来源引用、仅属于卖家的访问 Pass、授权和私密搭配不因 DOF 或整体出售自动转移。随 Soul／组件有效的许可按其条款承接；买家能继续显示、解密或使用哪些能力必须验证。若某个激活项依赖卖家的不可转移资格，交易必须明确接收方资格要求或处理为未激活，不能宣称售出一套买家无法合法使用的完整能力。

市场接口至少固定 Soul ID、组合 revision、所售成员清单／承诺、许可范围、价格和结算政策。有效上架后禁止卖家改动所售组合；成交原子核对清单、组件及许可状态、处理付款和授权交接，失败全部回滚。含多个来源的费用／版税按准确已声明的交易政策结算，不因有多个子对象而自动重复收费。普通卸装出售和整套出售的退出性质分别验证，不能把清槽写成所有 Soul 转移都必须执行的全局规则。

这是本轮明确的标准能力，当前引用＋锁装备和生产市场尚未实现它。第一版验收应同时覆盖：空 Soul／单独出售与明确整套出售；两种形态沿用同一资产身份，现有对象及资格如何承接仍按第 1.6 节验证。

## 2 四类产品如何形成资产

| 产品类别 | 发布或发行的结果 | 购买或接收时的具体交付 | 不随该交易自动取得 |
| --- | --- | --- | --- |
| Maker | 有确切版本和内容承诺的产品，以及唯一有效的产品控制权 | 产品出售交接其控制权；玩家获取操作另交付访问资格；合法 Complete 可形成 Soul | 源作者身份、所有版权、所有玩家资格与历史收入的任意处置权 |
| Expansion Pack | 有确切母定义、内容和商业政策的扩展产品及控制权 | 产品出售交接控制权；免费／付费／包含式获取交付对应范围的资格 | 母 Maker 控制权、未来版本资格或独立 Item 实例 |
| Composable Items | 可发行组件的产品与控制权；按规则发行独立实例 | 产品交易与实例交易分别标明；实例购买交付准确的一件 Owned Item | 整个产品的管理权、增发权或另一件副本 |
| Soul | 经合法完成或既有发行器创建的具体角色及关联状态 | 按现有政策交接 Soul、关联内容和所有权轮次 | 卖家的组件、Maker／Pack Pass、旧私密搭配和旧轮次授权 |

Composable Items 中的产品和实例具有不同身份。ExternalItemProduct 可以是产品控制资产，OwnedExternalItem 才是可装备实例；产品购买界面不能预览一顶帽子后实际卖掉整条组件产品线。

同一组件拥有多个适配仍只有一个实例。新增适配不会重复发行、改变供应或使它同时被两处占用。

### 2.1 Maker 的使用与交易

| 操作 | 主体与条件 | 交付与资产归属 |
| --- | --- | --- |
| 使用 Maker 创建 OC | 使用者满足 Maker／实际使用 Pack 的访问、许可和 Complete 政策；可以采用免费或付费资格 | 新的 OC／Soul 实例归规定的创建接收人，保存准确来源与适用权利；Maker 控制权不变化 |
| 交易 Maker 本身 | 当前产品持有人满足受控交易、托管及交接条件 | Maker 的产品控制权交接给买家，具体管理及收益权限按交接清单核实；不转移已由用户生成的 Soul |

Maker 可在允许的次数和供给政策内被多个使用者重复使用；正常生成不会消耗或转移 Maker 本身。进入费、Complete 费和 Maker 成交价是三个不同的报价项目。

Maker 转售不自动撤销已取得的使用资格，也不接管既有用户 OC／Soul。当前 MakerAccessPassV8 绑定不可变 Root／版本／内容，而非控制轮次；对暂停、归档、新版本和源素材读取仍按原政策核验，不扩大许可范围。

### 2.2 资产类别、组合形态与当前状态

按照“资产本体＋可选能力＋组合状态”分类。Maker 加入槽位、采用 Pack 或引用 Pack 槽位，可以形成不同的产品／使用形态，但不为每个排列另建一种资产类别。资产类别保持 Maker、Pack、Composable Items、Soul；同类产品或实例可以拥有不同 ID、版本和价值。

先区分三个“卡槽”的语义：

| 所在位置 | 卡槽表示什么 |
| --- | --- |
| Maker | 基础部位／卡槽定义，用于创作以及定义生成角色可采用的组合规则 |
| Pack | 补充到兼容目标中的部位／卡槽定义，保持自己的来源、资格与权限 |
| Soul | 已按权威定义实例化或可依法实例化的装备位置，由当前持有人通过受控操作使用 |

Maker 定义槽位、Pack 补充槽位、Soul 实际装备 Item 不是三个独立“槽位资产”。槽位定义和实际装备关系分别读取，不能因为配置里存在 Slot 就宣称某个 Soul 已创建装备或已获得使用资格。

下面列出 Maker 使用组合的六种结构形态。槽位指持久可装备的 Slot，不是 Creator 中所有图层或 Player 的所有选项。有关 Pack 的行均以正确版本、母定义上限、准入和使用许可成立为前提；它们是分类模型，不是六类已经上线的新资产。

| Maker 自身有槽位 | 合法采用 Pack | 采用的 Pack 新增槽位 | 组合形态与有效槽位来源 |
| --- | --- | --- | --- |
| 否 | 否 | 不适用 | 基础 Maker；无持久装备槽位 |
| 是 | 否 | 不适用 | 带槽 Maker；槽位来自 Maker |
| 否 | 是 | 否 | Maker＋内容 Pack；无新增持久装备槽位 |
| 是 | 是 | 否 | 带槽 Maker＋内容 Pack；槽位来自 Maker，Pack 可补充兼容内容 |
| 否 | 是 | 是 | Maker＋槽位 Pack；合法组合中的槽位来自 Pack |
| 是 | 是 | 是 | 带槽 Maker＋槽位 Pack；槽位分别来自 Maker 与 Pack |

第五行不允许 Pack 绕过母 Maker 的能力／准入上限；若原策略不允许扩展槽位，该组合拒绝，不把原固定 Maker 静默改成可组合产品。多个 Pack 按各自来源重复应用上述分类，不产生指数增长的资产类型。

Pack 本体可分“内容扩展 Pack”和“含槽位定义的 Pack”两种形态。后者可以同时有内容。它仍是 Pack；引用或采用它不转移其产品控制权。

“Maker 带 Pack”必须说明关系，标准读取至少能区分：

- 可兼容／可发现的 Pack：候选目录，不证明某用户有资格或本次实际使用。
- 随 Maker 包含的 Pack：明确商业许可关系，不意味着赠送 Pack 产品控制权。
- 当前选择的 Pack：Player／完成配方中真实采用的来源，收费按原实际贡献规则核验。
- 已挂接的 Pack 定义：Soul 装备布局采用的准确部位定义，不等于持有 Pack 产品。
- 交易包含的 Pack：明确另行出售的资产 ID 与控制权；不会由前述关系自动推导。

Soul 归入一个资产类别，但必须区分能力和装配状态：

| Soul 形态／状态 | 含义 |
| --- | --- |
| 固定 Soul | 权威定义与政策明确不支持持久装备，不能只由缺少 equipment 指针推断 |
| 可装备 Soul，尚未初始化 | 定义允许相应组合，但还未建立持久装备；执行仍需当前资格 |
| 可装备 Soul，装备为空 | 已创建装备关系且没有当前装备；空位保持空位 |
| 可装备 Soul，已有装备 | 当前槽位指向实际组件或有资格的选择，保存精确来源与 revision |

同一个 Soul 可在允许的装配状态之间变化，不因此生成新的 Soul ID。来自 Maker 与 Pack 的槽位可以并存；其来源和资格分别核验。上架卸装和转手后，买家能否重新创建／使用装备仍按其自身资格判断。

客户端形态标签由准确的定义、来源和快照推导，标签本身不授予能力。Maker 的参考字段是 baseSlotRefs、采用的 packRefs 和 packSlotRefs；Soul 的参考字段是可用定义、equipmentStatus 和当前选择。它们归入已有能力与状态读取，不创造另一份所有权。

组合关系不自动构成打包交易。出售 Maker 不自动出售关联 Pack；Soul 单独出售沿已确认规则卸装留卖家，整套出售按第 1.7 节交接准确 DOF 成员及组合状态。只有明确新发布产品或发行新实例时才产生相应新身份；合法选用 Pack、初始化、装备、卸装或整体出售不自动铸造一个复合资产。

## 3 Asset Core 的最小数据与身份

下列是规范化读取结果，不是额外铸造的新对象或当前已存在的 ABI。

| 核心信息 | 标准要求 |
| --- | --- |
| identity | 链标识、权威主体对象 ID、权利类别；附精确 Move 类型来源和读取方案版本 |
| content | 内容来源、发布版本、原始内容／清单承诺；可变角色状态另有 revision，初始来源快照不改写 |
| holding | 权利持有人、权威对象集合、当前 Cap 或所有权证明、轮次，以及托管位置和可操作状态 |
| terms | 当前适用许可、使用政策与转让政策的精确引用／承诺；分别说明其他人怎样使用和持有人怎样转让 |
| snapshot | 核验所使用的 checkpoint／对象引用、控制或所有权轮次、状态 revision；不将分散缓存拼成新权威 |
| extensions | 经过实际模块和对象关系证明的发行、组合等能力；不是元数据中任意填入的权限 |

逻辑 AssetRef 使用链、主体 ID、权利类别。例如 Maker 的 PRODUCT_CONTROL 以 Root ID 为稳定主体，AdminCap 是当前控制证明；控制转移后 Cap 可以换 ID，不能将新 Cap 误显示成新发行一份 Maker。Pack 使用 Release ID，组件产品使用 Product ID，实例使用其自身 ID，Soul 使用 Soul ID。

版本升级产生新 Root／Release 时，它仍是明确的新发布身份；语义名称、上一版链接或同名 Maker 不自动证明权益互通。版本是否承接资格由真实授权记录决定。

holding 中的持有人与 Sui 原生 owner 不可混用：Root／Release 可以是共享对象，其控制权由对象字段、有效 Cap 和模块入口共同决定。上架期间 Cap／实例可以进入托管；描述同时说明持有人和托管状态，不能让两个地址都获得可执行控制权。

来源标签、作者签名或内容哈希能证明特定绑定，不能单独证明版权范围、现行控制权或有权独立发行。

### 3.1 可冻结的编码边界

标准实现需同时发布字段 Schema、BCS／哈希编码、模块入口映射、SDK 和符合性用例；一份字段说明不足以构成标准完成。下面固定最小形状，具体快照证据与每个类型的政策映射在实施规格中补齐：

    AssetRef {
      chainId,
      subjectId,
      rightKind: PRODUCT_CONTROL | INSTANCE_OWNERSHIP
    }
    AssetRecord {
      standardVersion: "0.1",
      assetRef,
      category: MAKER | PACK | COMPOSABLE_ITEM | SOUL,
      contentRef,
      holding,
      termsRef,
      usePolicyRef,
      transferPolicyRef,
      snapshot,
      extensions
    }

对象 ID 与内容哈希按确定长度字节规范化；类型身份使用准确的类型来源，不根据“最新 callable 包 ID”猜测。链 ID 使用可验证的链标识，不只写 mainnet／testnet 名称。u64／金额在 JSON 中使用十进制字符串，交易编码按实际链上整数类型，禁止经浮点数中转。

对承诺和签名固定域、标准版本、字段顺序及规范编码；转让和发行绑定资产、来源版本、当前轮次／revision、动作、接收方、币种、分项价格、政策版本、操作 ID 及适用时效。未知关键字段或重大版本拒绝；可忽略的展示扩展不能影响权利或结算。当前签名／支付恢复记录仍使用原已固定的编码和身份，不追溯重新编码。

usePolicyRef 和 transferPolicyRef 从相同的已核验 terms 解析，不能维护冲突的两份权限状态。不对其他人开放使用的资产明确标记相应政策不可用。使用策略允许第三方触发生成，不代表授予管理 Cap；具体使用执行进入发行或组合扩展。

## 4 标准化四项操作

| 操作 | 必须满足的语义 |
| --- | --- |
| read_asset | 返回上述核心信息、能力及权威证据；未知类型、未知版本和读取失败有明确结果 |
| preview_transfer | 返回准确资产、当前快照、接收方和交接清单，解释锁／托管／生命周期条件及费用 |
| transfer | 通过该类型的受控入口再次验证全部条件，原子完成控制／所有权和相关状态更新 |
| verify_transfer | 按交易 digest 和最终权威读回核实交接；网络超时先查原交易，不生成第二次付费或转移 |

统一接口首先是 SDK、状态语义和符合性契约。Move 执行仍使用精确类型的模块函数、Cap 和现有受控市场路径，不从一份 JSON 动态执行任意函数。

符合标准不能仅靠返回相同字段：实际转让必须满足清单，并且所有可达旁路都不能绕过声明的强制条件。不支持交易的状态应在预检说明，直接链上调用也必须拒绝。

### 4.1 转让交接清单

每笔转让固定五项：

| 项目 | 要说明的内容 |
| --- | --- |
| moves | 控制权／实例、关联对象、允许的内容访问、明确承接的管理或收益权 |
| stays | 作者身份、卖家保留资产、历史资格和其他不随本次交易转移的关系 |
| revokes | 旧 Cap、旧所有权轮次下的权限、不能延续的授权 |
| conditions | 精确资产类型、控制轮次、锁、托管、生命周期、接收方和适用版本 |
| settlement | 币种、整数金额、适用分账与取整，费用包含关系和报价有效条件 |

产品控制权转让必须逐项核实收益接收方、Treasury 提取权限、已累积余额、原创者和来源版税的实际归属；不能推定全部收入随控制权移动，也不能推定全部留给旧持有人。当前源码完整入口与市场证据核对前，对相应项标记待核验。

Soul 交接沿用已确认规则：上架／托管原子卸装，组件留卖家；转手轮次更新，旧轮次授权不延续，买家不自动取得卖家的 Pass 或私密资料。关联内容的公开、保护和可读取范围依原政策分别核实。

组件实例已被占用时不允许独立转移。需要出售时先通过受控原子操作解除占用再进入相应交易；不能让 UI 隐藏锁代替链上限制。设备读取和 Asset Core 识别不自动授予运行技能、签名或支出权限。

## 5 两项扩展：发行与组合

### 5.1 Issuance：把内容产品变成确定交付物

产品发布固定确切内容、权利、依赖与发行规则，并建立当前控制证明。发行时核对发行主体、用户资格、供应／次数、许可、报价与真实贡献，然后交付一个精确实例或规定的资格。

产品持有人配置发行政策，符合政策的使用者可以触发实例生成。Maker 的正常 Player／Complete 不因标准化而要求玩家持有 MakerAdminCap；其权限来自有效使用资格和受控发行流程。每次生成保留 Maker 本体，产生属于明确接收人的新 Soul。

访问资格取得与实例发行是不同操作；即使同一用户旅程组合执行，也必须分别解释交付物。

发行记录至少绑定链、产品版本、内容承诺、领取人、实例 ID 或资格 ID、业务操作 ID、供给／次数变化及交易结果。已完成输出的来源和权利快照保持不变，后续 Soul 配置及装备变化使用自己的 revision。

供给不变量包括：每个产品只存在一个有效当前控制状态；一个实例只由一次成功发行产生；实例发行不可通过添加适配或恢复未知交易重复发生；收费、次数消耗与最终发行按真实合约保持原子业务边界。

操作骨架是：

    发布产品 → 获取必要资格 → 校验发行条件 → 发行具体实例 → 使用／组合／转让

其中上传和先前已买资格可以属于先前交易，后续失败不承诺撤销已完成的上传或购买。恢复必须先查原操作和 digest。

### 5.2 Composition：现有装备的合法使用关系

最小关系是：

    Soul + SlotPartRef + ItemInstance + RepresentationRef → Equipment

Catalog／Definition 定义 Fixed 和 Slot，Maker 提供基础定义，合法采用的 Pack 提供扩展。SlotPartRef 使用来源定义 ID、承诺和 partKey；显示名称及数组位置不构成身份。

兼容必须同时证明来源使用／发行权限与目标准入，精确绑定产品、目标定义／版本、部位和表现。语义标签只供检索；OPEN 不解除当前准入、资格或技术检查。跨 Maker 的兼容声明作为组合扩展，不复制实例、不另建可交易资产。

装备前验证 Soul 当前持有人、Item 所有权、Maker／Pack 资格、精确兼容、生命周期和状态 revision。保持 Soul 每 Part 一件、Player 作者容量独立、替换原子完成、卸下留空及实例唯一占用；现有实现使用锁，目标原生归属方案按第 7 节验证同一性质。

当前运行版的 Equipment 是使用关系，装备不改写组件持有人的所有权。这是现状，不是禁止重构的约束。目标原语允许真实 Item 转为父对象持有，资格选用则继续明确引用。原配方不证明所有选项都已资产化；购买 Pack 也不自动发行其中每个 Item。

这是当前 Wardrobe 的 Equipment 语义，不把全部组合都定义成无托管引用。真正让父对象持有子资产的 Containment 是另一项明确能力，按第 7.4 节设计；不能把两种关系混在一个含糊的“接收／装备”入口里。

## 6 商业规则作为政策，不创造新的资产类别

公开发现、免费／付费进入、完成政策、独立实例发行和受保护读取分别表达。免费产品仍可有产品控制权和可转移实例；费用为零不改变其身份。具有访问价格也不自动使访问资格可转售。

保留免费、付费、INCLUDED_WITH_MAKER 三类 Pack 资格及 Maker／Pack 四种完成政策。已有有效资格不重复购买；包含资格不意味着无限免费完成；错 Maker／错版本的包含关系拒绝。

将结构资格和计费贡献分别核对。仅启用 Pack 列表不产生资格或完成费用，按既有真实使用规则去重结算。同一适配不得移除真实付费来源，明确独立授权的组件也不自动要求购买整套来源 Pack。

持久换装默认不重复收取 Complete 或扣完成次数，仍校验使用资格。装备独售保留现有市场路径 2.5% 平台费；Maker、Pack、Soul 及其他交易沿用各自适用政策，不统一增加一笔资产税。

资产标准不默认产生利息、收益份额或收入分拆代币。产品控制权、访问许可、现金余额、收入接收关系与资产实例分别核实；可交易性不证明存在流动性或市场需求。

## 7 Sui 落地：现状对照与对象重构候选

| 现有基础 | 标准映射 | 需要补齐的部分 |
| --- | --- | --- |
| MakerRootV8 + MakerAdminCapV8 | Maker 的产品控制资产 | 标准读取、控制权交接清单与符合性证据 |
| PackReleaseV8 + PackAdminCapV8 | Pack 的产品控制资产 | 同上；资格、Treasury 与控制权分别核验 |
| ExternalItemProductV8 + ExternalItemAdminCapV8 | 组件产品控制资产 | 发布／发行规范化，产品交易与实例交易明确分开 |
| OwnedBaseItemV8／OwnedExternalItemV8 | 组件实例资产 | 统一所有权、来源、占用与转让预检 |
| Soul + SoulState + Content／绑定证明 | 角色实例资产 | 统一读取及转让结果，保留所有权轮次与原作品／当前装备区分 |
| MakerAccessPass／PackPass | 访问资格 | 沿用原范围和转让限制；不改成产品控制或可售装备 |
| Definition／Loadout／Representation | 内容与使用关系 | 实现组合扩展，不增加第二份资产所有权 |

Asset Descriptor 是权威状态的投影。不得铸造一枚可独立转移的包装 NFT，却把原 AdminCap 或实例留在另一个地址，从而产生两个控制者。实际资产 ID、持有证明和托管交接仍只有一套权威。

新发行版本可以采用共同的核心字段／库与专用能力模块。现有对象以精确类型读取器和交易构造器接入；是否必须改对象布局或协议入口由符合性差距决定。读取适配不等于执行已符合标准，不能用 SDK 外观统一掩盖合约差异。

能力声明由真实模块、类型及绑定关系验证。新类型接入需通过参考接口与符合性验证；不把 Maker 作者自行发布改成平台审批，也不从远程元数据加载任意执行逻辑。

Object Display 支持通用展示，不能作为所有权／许可证明。当前官方文档提供 Display V2；实际采用以项目锁定框架及部署兼容性为准，本稿不要求自动迁移展示系统。

Kiosk／TransferPolicy 可以承接支持它的交易流程，其规则不能被推定为约束一切任意 public_transfer。强制装备锁、控制轮次或同步更新需要核实每个类型的 abilities、受控转移、托管／解托管、接收和旧入口路径。PAS 可作为受限移动的备选参考，当前未核对其与项目版本和对象布局的接入成本，因此不纳入 v0.1 必选依赖。

链上更新优先写入本资产及相关状态，避免每次转让／装备都写一个新增全局注册表。缓存和索引仅用于发现，不授予权限；业务执行必须核对实时对象。链与前端、Walrus 内容和 Seal 保护读取的现有架构不变。

### 7.1 重构候选：统一可交易 Asset，分离 Definition 与资格

产品分类说明它做什么；对象形态说明它如何持有、执行、组合和转移。重构候选采用共同 Asset<Kind> 类型族：Maker、Pack、Item、Soul 的类别由明确的 Kind 与合法定义固定，不因 Slot／Pack 排列生成新的资产类别。ProductControl 与 InstanceOwnership 仍是不同权利，不能因为共用结构而授予相同权限。

可交易 Maker／Pack 本体是持有型 Asset，公开或受保护的内容定义另存于确切 Definition。产品控制能力直接由该资产证明，不再额外发行另一个独立可售的 ControlCap；如果实现仍需要内部 Cap，它只能是受同一资产控制的技术凭证。正常用户生成 OC 读取 Definition、资格及共享发行状态，不需要把 Maker 持有人拥有的 Asset 作为交易输入。

| 标准形态／辅助类型 | 候选构造与归属 | 权威与职责 |
| --- | --- | --- |
| Asset<Kind> | UID＋确切 DefinitionRef／ContentRef、PolicyRef、状态关联及 revision；持有型对象 | 唯一可交易身份。Maker／Pack／组件产品携带相应产品控制权；Item／Soul 携带实例所有权；受控转让更新相关权威状态 |
| Definition<Kind> | 确切内容版本、来源、许可、发行说明及可选 SlotSchema；读取不依赖拥有产品资产 | 内容承诺及槽位定义固定；受保护素材仍经 Walrus／Seal，定义可发现不等于源码公开或可自由使用 |
| ProductRuntime | 按产品共享的发行次数、生命周期、计费／Treasury 关联及当前控制资产绑定 | 玩家按资格执行发行；管理与控制权变动必须验证唯一 Asset 的当前控制证明，不另设可独立交易的权威 |
| AccessPass | 独立的资格型 key 对象，绑定持有人及内容版本 | 使用资格；不是产品控制资产或组件实例，Maker 转售不因此撤销既有资格 |
| SlotKey／SlotBinding | 父资产 UID 下的有类型值／动态字段，不默认具有独立 UID | 表达槽位身份及接受的成员。容器型的实际资产归父对象；共享索引或缓存不成为第二份托管权威 |

公共 AssetCore 是内部无 UID 的可存储值，具体内容及合法能力使用准确类型与政策模块表达。共同类型族不允许客户端只改 kind 字段就把 Pack 变成 Soul。最终采用泛型 Asset<Kind> 或共享值结构的几个具体外层类型，必须通过 Move 可实现性和实际入口验证；本稿不把示意结构冒充可编译合约。

共同核心不要求所有外层类型具有相同 abilities。key-only 不是资产标准的默认：通用可流通、可组合的资产优先评估 key＋store；只有确切规则要求每次移动都经过定义模块，且不能由受控托管达成时，才采用 key-only。AccessPass／管理能力的受限转移要求不能自动扩展到全部 Item、Maker、Pack 和 Soul。

旧 Root＋AdminCap 可以在研发对照中映射为“定义／运行状态＋当前控制证明”，但新 Asset 不能先自由发行、旧 Cap 又继续独立控制同一产品。过渡必须有唯一权威交接及现有对象／权益承接的可验证方案；尚未查清旧包升级和接收限制，不声称原 ID／类型可以无条件直接改成新形态。

能力边界至少分开 slot_definition、equip_reference 和 containment。定义槽位不表示能托管资产，能收到资产也不表示已通过槽位兼容。Maker＋带卡槽 Pack 是产品定义合法扩展；Soul＋卡槽是实例拥有有效装备能力及状态。仅挂接 Pack 定义不把 Pack 产品控制资产放进 Soul。

### 7.2 Slot 是值／键，通常不是独立 key 对象

槽位本身先标准化为 SlotSchema／SlotKey，而非默认发行有 UID 的 Slot NFT。只有槽位本身具备独立可转移的权利，才另行定义可交易对象；当前产品没有该要求。

逻辑身份为：

    DefinitionRef = 确切来源定义对象 ID＋内容版本／承诺
    SlotKey       = DefinitionRef＋part_key＋ordinal
    SlotBinding   = SlotKey＋instance_id 或 entitlement_ref＋representation_ref

实现时固定具体类型、编码及 profile commitment；这些公式不是已经冻结的 BCS。Source 定义是 Maker Root 或确切 Pack Release；组件产品来源另存于组件实例／绑定中，不能混作目标槽位身份。Player ordinal 范围按作者容量，Soul 每 Part 只有一个位置。相同名称来自不同 Maker／Pack 时必须隔离。

定义、占用和表现分别保存。空槽无需单独对象；合法挂接定义也不发行组件。实际使用可以来自拥有的实例，也可以来自 Maker／Pack 资格，二者使用不同 Binding 变体，不能把每项素材选用都强行伪装成独立 Item NFT。

### 7.3 三种原语解决不同问题

| 机制 | 原生组件归属 | 能解决什么 | 不能自行保证什么 |
| --- | --- | --- | --- |
| 引用＋独占锁 | 组件仍归玩家地址，状态记录实例 ID | 无托管装备：槽位指向实例，实例反向锁定 host／slot | 仅存 ID 不保证独占；必须两端原子校验、受控转移和实时所有者证明 |
| dynamic_object_field | 子资产成为父对象的动态对象字段 | 以有类型的 SlotKey 存放实际子对象，支持移除取回及保留子对象 ID 可查询 | 权限、资格、兼容、收费及卖出包含范围仍由业务模块执行 |
| Transfer-to-Object＋Receiving<T> | 先将组件转至父对象 ID 的地址，再由合法接收入口取得值 | 托管／收件入口；可在同一交易接收后登记槽位 | 被转入不等于被装备，也不产生 SlotKey、容量或兼容证明 |

dynamic_field 适合普通可存储值；把资产对象放进去会形成 wrapping。要让被容纳资产继续按原 ID 被外部工具识别，容器优先评估 dynamic_object_field。其值类型必须具有 key＋store；已有 OwnedBaseItemV8／OwnedExternalItemV8 只有 key，因此不能直接作为该函数的 Value。

Receiving<T> 是一次交易中的接收参数，具有 drop，不是永久卡槽对象，也不是要求交易一定完成装备的不可丢弃凭证。泛型 public_receive 要求子对象 key＋store；key-only 子对象需要其定义模块的自定义 receive，并同时经过父模块的 UID 接收权限。当前不可丢弃的更新约束来自 SoulEquipmentUpdateV8，而不是 Receiving<T>。

若调用者已在交易中拥有组件值，可直接通过受控入口调用 dynamic_object_field::add；不必先转给父 ID 再接收。若资产此前已转入父 ID，可用合法 receive 后再 add。两者是不同入口，最终槽位、资格及归属约束应相同。

### 7.4 现状与重构选择：优先评估原生父子归属

**现状是 Equipment：引用＋锁。它不是因已存在而成为目标标准。** 定向源码证据如下：

- runtime_v8.move：OwnedExternalItemV8／OwnedBaseItemV8 是 key-only（当前 660／675 行）；equip_owned_base_style_v8／equip_external_style_v8 通过 &mut 借用实例（3536／3833 行），安装 selection 并写 equip_lock，不消费实例值、不转给 Soul。
- MakerLoadoutV8 保存定义与选择（788 行）；create_soul_equipment_v8 将其共享并添加 Soul／State／所有者轮次绑定（3350 行）。共享对象访问必须经过 native owner witness 与原子更新 guard。
- 同一文件市场 custody 路径将实例转到 listing ID 地址（2956／2991 行），receive_market_base_item／receive_market_external_item 通过 transfer::receive 取回（3212／3227 行）。这是真实托管原语，不是当前 equip 的实现。
- SO adapter 的 close_empty_equipment_v8 先要求装备已空，再解除 SoulState 装备绑定；不转移卖家的钱包组件。Soul 为 key＋store，SoulState 为 key；其具体 Kiosk／转让权限不能从实例类型统一推断。

参考型装备的协议入口至少是 equip、unequip、replace、attach_definitions、prepare_transfer；输入使用准确实例、定义、资格与当前 revision。成功状态必须同时满足 SlotBinding 指向实例及实例 EquipLock 指向该 host／slot；失败交易两端都回滚。它适用于有意保持组件归钱包的使用关系；暂时读取旧对象也不能宣称新容器方案已完成。

**重构主候选：真正的 Item 装备采用原生父子归属；资格选用保留明确引用。** 原生归属使一个实例在任一时刻只有一个直接持有方，不再仅靠钱包实例上的 EquipLock 模拟资产被装入角色。SlotBinding 仍负责接受状态、位置、表现和精确兼容，原生归属本身不证明完整槽位正确性。

同一父对象内部仍需 SlotKey→成员与 ChildID→SlotKey 的一致唯一索引，防止把一个子资产登记到两个槽。子资产的有效使用者通过父对象控制链证明，不把先前钱包 holder 字段作为独立永久权威；父控制权交接不能让旧钱包继续使用其下属资产。链上证明及 Seal 读取需要验证实际路径／轮次，不能只凭客户端递归计算。

受控转让是某一类型的全局要求时，该外层类型可使用 key-only：通过类型定义模块 transfer 将 Item 转到 Soul 的 UID 地址，以普通动态字段保存 SlotKey→ChildID／Representation；取出和借用通过自定义 Receiving 入口，业务更新产生不可丢弃的完成／归还约束。这能使用原生归属，又保留受控转让。它是有具体强制规则时的候选，不是对全部资产的统一默认。实际类型／泛型入口、同交易原子存入／取出及当前类型接入仍须做 Move 原型验证。

Composable Item 的主验证候选为 key＋store＋dynamic_object_field<SlotKey, Child>，直接存放资产并借用。DOF 要求 Child 具有 store，不要求父对象本身具有 store：例如受控 key-only 的 Soul 可以容纳 key＋store 的 Item。Item 在父对象内部时，不能作为独立钱包输入直接 public_transfer；取出仍须获得父 UID 的合法访问权限。因此，防止被装入组件绕过槽位取出，不构成所有 Item 都必须 key-only 的理由。

必须区分父内的存入／取出约束与子资产离开容器后的流通约束。key＋store 会允许拥有可用资产值的人使用 public_transfer；自定义转让函数不是全局钩子。若所有外部移动也必须收费、清槽或更新某个钱包 holder／epoch，该类型就需要 key-only 或始终受控托管，不能只写一项布尔政策宣称已保证。各 profile 的符合性范围明确，不靠临时切换 ownershipMode 混合不同保证。

这些候选统一 deposit／accept_received／withdraw／replace／prepare_transfer 的语义，并满足以下设计要求；均不是本版已经实现的功能：

1. deposit 校验合法所有者、目标槽位、来源及容量后存入子资产；accept_received 先依法接收再做相同校验。随意转入的对象必须区别于已接受的槽位成员，不能凭“父 ID 收到了”自动计入装备或报价。
2. withdraw 在同一交易移除绑定并取回资产；普通字段／原生归属／逻辑 holder 只能有一套一致权威。父对象权限不可由公开的任意 UID 借用入口绕过。
3. 对可转移的持有型父对象，子资产控制随父对象转移；共享 EquipmentState 不会因此变成可转移的容器。整体转售包含哪些资产须由交接清单和真实入口兑现；禁止循环容纳及超过明确深度／容量上限的嵌套。
4. 父对象持有资产可支持单独出售与整套出售。单独出售的 prepare_transfer 原子取回组件、清空对应槽位并交接 Soul／所有者轮次，该交易形态的所有有效入口必须兑现同一规则。整套出售保留所售 DOF 成员及组合状态，以明确包含清单、价格和授权交接；不从“装在里面”推定玩家已授权出售，也不把清槽规则扩展为所有父对象转移的强制行为。具体要求见第 1.7 节。
5. 子资产类型增加 store 后，脱离容器时可被 public_transfer 移动；仅依赖其自定义 transfer 函数或 transferable 字段的旧约束可能失效。不能为使用 DOF 直接给现有类型补 store。新类型须明确原生所有权、受控父对象、退出后转移与市场限制，不宣称旧 key-only 布局自动兼容。

采用 key-only 原生归属，不会自动适配 Kiosk 的通用 place／list／purchase，它们要求 key＋store。若原生 Kiosk 接口是必要目标，需评估始终处于受控托管的 profile，或者选择 key＋store 并诚实限定转让约束的范围；不能一边允许任意 public_transfer，一边声称每条移动都强制清槽、轮次更新和收费。受控市场／Kiosk 扩展是否能承接 key-only 资产是研发验证项，不冒充已有通用兼容。

重构允许改变 Root／Cap、装备锁、状态对象、abilities、接收和交易实现。兼容目标是已有公开／付费 Maker、Pack 的准确内容、控制权、资格、次数、收入政策与已有 Soul／Item 权益。是否能保持旧对象 ID／类型、是否需有约束的显式迁移，须由实际升级能力及全部权威路径证明；本稿不执行迁移，也不以兼容为名永久保留第二套独立控制权。

### 7.5 对象构造的符合性补充

本轮只核对结构与定向源码，不证明所有有效转移／升级路径已通过审计。实施阶段至少补充下列实际性质验证：

- equipment 型：占用时无法通过直接转移、上架／解托管、旧入口或销毁绕过；并发装备／替换最多成功一次；暂停／源失效时仍能安全卸装；所有者轮次变化不留下旧调用者写权。
- containment 型：仅接受符合槽位的真实资产；未接受的转入不污染槽位；提取与失败交易不遗失资产；父转移与包含清单一致；非空容器不可被销毁而遗留不可访问的子资产。
- 版本与适配：固定目标框架版本、类型 abilities、原生归属、公开入口和 BCS；AssetRecord／Display 的自报能力不能代替这些证据。既有 Maker／Pack 资格和政策不因对象类型族标准化而失效。

## 8 版本、安全与兼容

标准版本、Move 包版本、产品内容版本和角色状态 revision 分别表达。新增可选字段以明确版本协商；未知重大版本不得静默降级或猜测权限。产品新内容与新适配保持精确版本，持有人接受后才改变当前表现。

实现前清查已有 Root、Release、Product、Cap、Pass、实例、Soul、装备、托管与待确认操作。已有控制权、资格、供给、内容哈希和恢复记录必须可验证；不能依据历史“可全新初始化”直接清空本次要求保留的内容和权益。

任何改变布局、权限、转让或发行入口的方案必须说明目标包／类型、真实 UpgradeCap 路径、旧入口能否继续操作、状态承接、退出与恢复限制。内容不可变、资产占用锁、管理 Cap、多签、时间锁、暂停和包升级限制分别验证。本稿不证明这些治理控制已经部署。

公开元数据不能含受保护源素材或私密记忆。转移 Soul 不自动转移卖家私密 Loadouts；Soul Configuration 当前作为 Maker 默认及具体 Soul 内容处理，不为统一标准而单独发行。引用 SKILL.md 不表示允许自动执行代码或钱包动作。

## 9 构建顺序与符合性出口

本标准是 Plan 增量，当前活动修复仍以 CURRENT 和原卡为准。新增资产统一不能挤占当前 BUG006 或扩大原 F02 的完成条件。

| 顺序 | 具体产物 | 原规划及出口 |
| --- | --- | --- |
| 1 先固定 Soul Core 及交接定义 | 保留现有 key＋store Soul；六组逻辑信息映射既有字段与 DF／DOF，固定持有／激活／引用、权限 profile、接口及转让清单 | 先统一 Soul 标准接口，不以改本体布局或同时重构上游为前提；实际升级权限待核验 |
| 2 先验证最小 Move 构造 | 先证明原 Soul 类型上的受控 DF／DOF 扩展；第三方容器存入／取回、第三方组件组合与替换、基础 Display／Kiosk 接入、准确成交及失败回滚 | 可执行原型决定是否需要进一步改造；旧 key-only 组件、共享状态与私密授权分别验证，不默认迁移／重铸 |
| 3 统一读取与第三方参考客户端 | Asset Descriptor、精确类型读取器、快照和标准化原因码 | 参考客户端与 AC／SO 对同一资产读出相同内容、权利与状态 |
| 4 验证转让与兼容承接 | 标准预检及真实受控执行，市场输出准确交接结果；旧 Maker／Pack／Pass／Soul／Item 单一权威承接 | 对应 M3／既有交易功能；新合约、旧入口、迁移／退出分别取得证据 |
| 5 验证发行与组合扩展 | 从 Maker／Pack／组件产品到实例的准确交付及装备 | 对应 M2、M3、F03/F04；跨 Maker 新绑定单独记录新增范围 |
| 6 正式接入 | 准确版本的 SDK、资产视图、市场与参考读取文档 | 原 M4 与适用 G1–G5；标准文档、测试、部署、产品验收分别记录 |

第一条参考旅程采用已核实或经用户正常发布的 Maker、一项付费 Pack、一件独立组件和一个 Soul，证明已有资格不重买、实例发行不重复、装备唯一占用、转让准确交接。正常操作和签名／付费授权沿用原任务边界，本稿不自行创建链上资产。

符合标准至少要求：

1. Maker／Pack／组件产品的有效控制者与 Cap 一致；伪 Cap、错产品及旧轮次拒绝。
2. 相同内容的两个合法实例具有不同 ID；多适配不重复发行。
3. 产品控制权与玩家访问资格、组件实例可准确区分。
4. 参考客户端无需 Maker 专用页面即可读出权利、状态及转让包含范围。
5. 所有受控转移路径兑现交接清单，旧控制者不能继续执行失效权利。
6. 产品转移不因控制轮次变化抹除已合法取得的 PackPass；收益与 Treasury 按已验证政策交接。
7. Soul 单独出售原子卸装留卖家；整套出售按清单交接真实 DOF 成员和组合状态，清单变化拒绝成交；两种形态都正确交接授权轮次，不自动转移卖家 Pass／旧私密搭配，买家合法使用范围可验证。
8. 装备实例不可并行占用或在占用时独售；失败替换保持原状态。
9. 免费／付费／包含 Pack、四种 Complete 政策与准确结算不漂移。
10. 完成、发行、转移及未知结果恢复不重复业务扣费、扣次数或增发。
11. Metadata／Display／SDK 自报能力不能绕过权威权限；受保护读取严格核对来源和持有人。
12. 旧入口、直接转移、托管、接收、销毁与升级权限覆盖有实际证据，未知版本拒绝猜测。

Maker 专项符合性：非产品持有人以有效资格生成归自己的 Soul；免费与付费路径的进入及 Complete 费用准确；Maker 转售不迁移这些 Soul、不因控制轮次变化撤销原 MakerAccessPass；旧持有人不能以旧 Cap 管理 Maker。

组合分类专项符合性：上述六种 Maker 使用形态按真实策略覆盖允许／拒绝结果；Maker／多个 Pack 同名槽位按来源隔离；NOT_CREATED 不误判不支持装备；EMPTY 不回退原装备；关联／包含／选用／挂接／出售的 Pack 不混淆。

测试通过不证明任意类型都符合标准。符合性清单需要固定链、包／类型、对象状态及能力范围；第一版不宣称自动支持所有 Sui NFT、ERC-721 或其他链。

## 10 设计评审记录

按[产品工程评审模板](../agent-management/templates/product-engineering-review.md)记录本次设计适用性，作为既有卡槽方案的附件，不创建新看板、不修改活动交付合同和 Owner。

- 原上下文：既有 M2/M3 的 Maker、Pack、组件、Soul 与市场功能；资产标准属于新增 Plan 设计，尚未分配实施增量或改变原卡状态。
- 用户结果：用户和第三方客户端能明确识别持有对象、发行交付物与转让结果。
- 手册：v1.0，2026-10-06；共同章节 1–4、9、12 已读，相关章节 7、8.3、8.4 适用；八阶段使用 OPERATING_MODEL 第 8 节。
- Owner／验收与授权：沿用原产品和协议 Owner，具体实现增量开始时在原卡确认；本轮授权为研发设计与本地文档，不含部署、签名、支付、迁移、提交、外部消息或权限变更。
- 来源：当前 AC Root／AdminCap、Pack／产品／实例结构及 SO SoulState／equipment adapter 的定向源码核对；§1.6 另核对 SO 正式 master 的 11 个文件哈希及 Mainnet 的 9 个公开对象观察，包括 UpgradeCap、实际 TransferPolicy／PolicyCap 和原 Soul 的托管链与 Lock。它们证明现状及设计映射基础，不证明统一标准已部署。

| 检查域 | 适用性与本轮结论 | 后续出口 |
| --- | --- | --- |
| 产品／敏捷 | 适用：已定义资产、交付与 12 项符合性；设计稿通过文档完整性检查 | 产品权利和实施范围仍需对应 Owner 评审 |
| 支付与资金 | 适用：原费用语义被保留，产品余额／收益交接未做完整入口核验，待核验 | 对照准确链上政策和所有权限路径 |
| 金融／DeFi | 本版不适用借贷、PT/YT、收入证券化；内容资产不承诺收益 | 新金融能力须另有实际产品目标及机制评审 |
| 合约／Sui | 适用：类型、Cap、轮次、锁、PTB 与旧入口要求已定义，实现符合性待核验 | 精确候选、性质和真实操作验证 |
| EVM | 执行不适用；ERC 仅作为语义参考 | 本版不承诺 ERC 接口或跨链兼容 |
| 治理／升级 | 适用：当前包的 UpgradeCap、policy=0 与地址归属已读回；Soul 三项交易规则、PolicyCap 和原 Soul 的 Kiosk Lock 已读回。当前没有实施变更；候选兼容性、全部有效权限及退出等价性待核验 | 实施前验证准确包、Cap、旧入口、状态方案与第三方托管保证；不得把 Cap 存在当成候选通过 |
| DevOps／运行 | 文档检查适用；产品构建、部署和运行验收未执行 | 沿原任务和 G1–G5 取得准确证据 |

## 11 依据

项目来源：

- [完整卡槽方案及资格／费用矩阵](ANIMACRAFT_SLOT_SYSTEM_PLAN_CN.md)。
- [Maker Root 与受控管理能力](../tmp/animacraft-v8-mainnet-release/move/animacraft_v8_core/sources/maker_v8.move)。
- [Maker 使用资格及内容绑定](../tmp/animacraft-v8-mainnet-release/move/animacraft_v8_core/sources/treasury_v8.move)。
- [Pack、组件产品、实例与装备锁](../tmp/animacraft-v8-mainnet-release/move/animacraft_v8_runtime/sources/runtime_v8.move)。
- [Maker／Pack 商业政策](../tmp/animacraft-v8-mainnet-release/maker-commerce-v8.js)。
- [Pack 显示开关与使用资格的边界](../tmp/animacraft-v8-mainnet-release/maker-v8-player-pack-preferences.js)。
- SO 定向源码：/Users/naoer/.codex/worktrees/f722/soulidity/move/soulidity/sources/soul.move 及 animacraft_equipment_adapter_v8.move；该工作树位置不是部署证明。
- [当前 Soulidity 源码与公开链上只读现状](../output/asset-standard-2026-10-07/current-soulidity-baseline.json)：11 个文件与正式 master 的字节比较、9 个对象的时间／版本／digest／owner；无构建、模拟、签名或写入。

官方资料于 2026-10-07 核对：

- [ERC-721](https://eips.ethereum.org/EIPS/eip-721)：资产身份、所有权、授权与转让接口；本稿借鉴其最小公共契约。
- [ERC-6220](https://eips.ethereum.org/EIPS/eip-6220)：Catalog 的固定／槽位部分及装备关系；本稿将组合放在资产核心之外。
- [Sui 对象模型](https://docs.sui.io/develop/sui-architecture/object-model)：原生对象身份、归属、引用与类型来源；共享访问不等于业务控制权。
- [Dynamic fields](https://docs.sui.io/develop/objects/dynamic-fields) 与 [dynamic_object_field](https://docs.sui.io/references/framework/sui_sui/dynamic_object_field)：值存储／子资产存储、可查询身份及 key＋store 要求。
- [Transfer to Object](https://docs.sui.io/develop/objects/transfers/transfer-to-object)：父对象归属、接收入口、Receiving 参数及 key-only 子对象的自定义接收限制。
- [Kiosk](https://docs.sui.io/references/framework/sui_sui/kiosk)：通用存放／上架／购买的 key＋store 边界；受控资产不自动具有该接口兼容。
- [Sui transfer](https://docs.sui.io/references/framework/sui_sui/transfer) 与 [TransferPolicy](https://docs.sui.io/references/framework/sui_sui/transfer_policy)：转移规则及其实际集成范围，不作为任意转移都执行收费的证明。
- [Object Display](https://docs.sui.io/develop/objects/display/display-overview)：通用展示机制，不作为权限证明；文档当前标准为 V2，项目采用另行核验。
- [PAS](https://docs.sui.io/onchain-finance/pas/)：受限移动的备选参考，不是本版已采用依赖。
- [Sui 安全实践](https://docs.sui.io/develop/security/best-practices)：核实 Cap／对象关系和有效入口；本稿检查要求不等于审计结论。
- [包升级](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)：新增接口与改变对象布局分开；兼容升级保留既有结构及 abilities，实际升级权限需核验。

本设计的核心结论：统一资产交付与转让契约，保留清楚的控制权／实例差异，以发行和组合扩展表达用途；真实商业价值仍来自内容、使用需求和交易，不能由统一结构本身产生。
