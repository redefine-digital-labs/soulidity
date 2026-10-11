# Soul DOF v1：全新底层规范与实施计划

> 2026-10-10 文档校准：底层完整重构与新部署已经获得后续授权并在隔离工作树推进。下述 2026-10-07 准备阶段的“等待确认／不开始生产重构”记录保留为历史，不再作为当前停工条件。实际 stage、收据、剩余职责和发布授权以 `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity/docs/codex/CURRENT.md`、其指定交接及现行合约规格为准；本次仅调整文档，不执行部署或权限变更。

> 保留的施工边界：真实网站前端为 UIUX 权威；保留页面结构和操作路径，在原组件表达新合约接入、三权利、装卸、微调与出售清单。另做 HTML／Penpot 草稿已退出施工依据，见[原 UIUX 核对](soul-dof-v1-preparation/02_UIUX_CN.md)。

业务规范日期：2026-10-07；开放生态边界更新：2026-10-10，Europe/Moscow。本文是目标与业务语义，动态实现状态继续在权威工作树维护，不能以本文件的原型段替代当前完整交付证据。

新增开放生态边界见[完整架构说明](SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md)、[对象与权利](open-ecosystem/OBJECTS_AND_RIGHTS_CN.md)、[入口权限与依赖](open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md)、[状态与恢复](open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md)。Maker 与 Soul 各自独立；制作、存储、发布、渠道与应用通过公开接口连接；平台服务管理权不成为资产总控制权。本文的三权利、视觉、整套交易和原业务范围继续保留。

用户最新确认：可以完整重构底层并重新部署，不需要为不成熟旧版设计兼容方案。本稿取代[资产标准 v0.1](SOULIDITY_ASSET_STANDARD_CN.md)中保持旧 Soul 类型／ID、原 SoulState／Loadout 关联和旧 Pass 承接的实施要求。新包、新对象、新 SDK 路由构成一套目标；旧版源码及只读证据仅供产品行为对照，不作为新 ABI 或升级限制。

第一目标是标准 Soul＋真实子资产组合。Maker、Pack、Composable Items 的上游发行和商业接口按这个出口重构；不先创建一个统一所有权包装层或把每种组合另铸成资产类型。**DOF 解决原生持有，视觉组合契约解决怎样显示；完整版本必须同时具备二者。** 用户最新提出的画布匹配、视觉一致性及微调取舍纳入第 3 节，作为本轮推荐方案，尚非已实现功能。

## 1 核心决定

**Soul 是 key＋store 的拥有型根对象；DOF 保存标准模块和已装自由组件；每 Part 最多一个固定 Style 的内容单位。Creator 决定其为引用、永久 Soul 绑定记录或自由交易资产。**

```text
Soul：唯一身份、协议主版本、基础 Display 字段、当前 revision
├─ CoreKeyV1             → SoulCoreV1
├─ CompositionKeyV1      → SoulCompositionV1
├─ BoundPartsKeyV1       → SoulBoundPartsV1：本 Soul 的绑定组件记录
├─ AuthorizationKeyV1    → SoulAuthorizationV1：读取与委托策略
├─ ItemKeyV1(item_id)     → T：key＋store 的已装自由组件
└─ ExtensionKeyV1(...)    → E：key＋store 的扩展模块
```

| 对象／数据 | 标准职责 | 能否单独交易 |
| --- | --- | --- |
| Soul | 根身份和原生归属；自由钱包／容器流转的基础类型 | 可以，包括其当时仍持有的子资产 |
| SoulCore | 准确 genesis／来源、内容 manifest、Soul Configuration／人格及许可引用 | 必要模块不提供普通取出／出售入口 |
| SoulComposition | 槽位 schema、当前激活绑定、成员索引和一致性状态 | 必要管理模块不独立售卖 |
| Item T | Creator 明确允许自由交易时发行的唯一实例；准确来源 Item、Style 和权利版本在发行时确定 | 可取下原 ID 后持有／转让；同一 Style 是否多份发行按供给规则 |
| SoulBoundParts | 固定 Style、永久属于当前 Soul 的组件记录；可从画面卸下再恢复 | 不返钱包、不跨 Soul、不独售；全部记录随根交接 |
| ContentRef | Creator 选择引用方式时的准确内容和许可引用 | 不发行独立对象，不等于持有来源资产或访问 Pass |
| Extension E | 视觉、技能、记忆、游戏状态等能力或内容模块 | 是否可拆卸／交易按模块的实际权利定义 |
| SlotKey／SlotBinding | 有类型、带命名空间和来源版本的值／索引 | 默认不是资产，不单独铸造 Slot NFT |

Core 的 genesis／来源固定；可变内容使用准确版本及 revision。大型人设、图片、声音、记忆等内容在 Walrus，Core／扩展保存引用与承诺；受保护内容由 Seal 的准确策略授权读取。模块拥有 UID 不代表它具有独立可售权利。

使用 DF／Table 表达模块内部的参数、成员索引和绑定；使用 DOF 表达拥有型模块与实际子资产。没有理由将每个参数都做成 Object。

## 2 Creator 权利模式、装入与取下

用户 2026-10-07 最新确认：Player 和 Soul 每 Part 最多一件 Item；Complete 时 Style 已确定，最小装配单位为一件固定 Style 的内容。此前单 Part 多选及多选桥接方案撤销。固定 Style 的内容身份不能靠后续修改实例字段变成另一种 Style；宿主允许的颜色／位置微调不改变实例来源身份。

| RightsMode | Complete 的结果 | 卸下／取出 | 随 Soul 交接 |
| --- | --- | --- | --- |
| REFERENCE | 保存准确 Item＋Style 的 ContentRef、内容承诺及许可 | 清除槽位选择，不返回钱包对象；再次选择仍核许可 | 保留引用和配方，买家使用范围按许可；不交接源 Maker／Pack 或卖家 Pass |
| SOUL_BOUND | 在 BoundParts 模块建立永久属于这个 Soul 的固定 Style 记录 | 可从画面卸下并恢复同一 Soul；记录仍留在本 Soul，不返钱包、跨 Soul或独售 | 全部记录随根，包括从画面卸下的记录 |
| TRANSFERABLE | 受认证发行器形成唯一真实 Item 对象，直接装入 Soul | 取下原对象原 ID 到钱包，按许可独售／跨目标适配 | 只有当前已装组件随根；钱包未装组件不随售 |

Creator 在准确发布的 Item／Style 权利策略中决定模式。Maker／Pack 默认与逐项声明的继承／覆盖必须可追溯；已发行实例或绑定记录不因后台新版本静默升降权。访问收费和组件权利分别定义：付费不自动赋予独售权，免费也不自动禁止组件发行。供给限制决定同一 Style 能发行多少唯一实例，实例唯一不等于 Style 全球唯一。

下文 Ref／Bound／Free 分别简写 REFERENCE／SOUL_BOUND／TRANSFERABLE；Free 仅指自由交易组件，与价格政策 FREE（免费）分开。产品UI使用“引用／绑定OC／可自由交易”说明，不把缩写当用户必须理解的术语。

**自由组件不设“已存入但未启用”的 Soul 库存。** `attach<T>` 同一交易核来源、许可、适配及槽位，完成 DOF 持有、成员索引和绑定；任何检查失败整笔回滚，组件仍在原持有人处。`detach<T>` 原子清绑定／微调／索引并 remove 原 T；默认交易构造器转回钱包，也可在同一合法交易中装入另一 Soul。`replace` 按旧／新权利模式处理：Free 旧件返回钱包、Bound 旧记录留本 Soul、Ref 清选择，绑定新项；只递增一次逻辑 revision。

Bound 卸下仍有记录，是永久 OC 绑定权利所必需的状态，不扩展为通用自由资产库存。其推荐实现是 Soul DOF 中必要 BoundParts 模块的内部字段／Table，记录准确来源、固定 Style、权利承诺和不可伪造的发行准入。只允许本 Soul 的挂载／卸下操作；不提供将该记录作为独立自由对象返回的接口。根不暴露可变 UID，保留键和模块不可被泛型删除；仅写 `bound_soul_id` 到一个已交给钱包的 key＋store 对象，不能阻止外部 public_transfer。

每个槽位统一绑定 Empty／ContentRef／BoundPartRef／ItemRef。普通 Free Item 的成员集合必须与已装绑定一一对应；Bound 记录单独管理，可未显示但仍永久属于同一根。Core／Composition／BoundParts／授权等必要模块不属于待激活 Item，也不独立售卖。来源失效或素材不能显示不改变持有权；Free 仍可安全取下，Bound 按本 Soul 权利恢复或保留准确不可显示状态。

## 3 视觉组合契约与微调画布

### 3.1 目标：默认正确适配，允许受约束微调

建议给 Soul 持有人提供组件微调画布。装入时先使用准确适配版本的默认布局；需要时才打开微调。默认布局的质量由发布适配的作者／目标场景准入者验证，不能把没有适配的素材交给用户拖动就宣称兼容。

三类一致性分别处理：几何一致性由坐标／锚点／遮挡契约约束；表现一致性由共同解析器、准确版本和渲染验证保证；画风／比例／透视是否协调仍需适配发布时的视觉审阅。合约校验和拖动微调不能替代后者。

| 情形 | 默认行为 | 微调与适配边界 |
| --- | --- | --- |
| 同一准确 SceneProfile 的已适配组件 | 自动放置并显示整体预览 | 按发布的 EditPolicy 微调，也可一键复位 |
| 小幅位置、比例或角度差异 | 保留作者默认，提供受约束控件 | 位移、等比缩放、有限旋转；翻转／颜色仅在明确允许时开放 |
| 不同 Maker／体型／姿态／画布 | 选择该目标的准确 VisualAdapter | 不能直接沿用原坐标；没有有效适配时仍可持有，不能宣称可视觉激活 |
| 前后遮挡、衣服变形、透视或画风不匹配 | 由作者改适配／表现，必要时拒绝该目标 | 拖动不能可靠修正，用户不能任意改层顺序、蒙版或素材 |
| 固定部位或必须精确对齐的表现 | 使用固定布局 | EditPolicy 可禁止微调；本稿不把所有槽位锁死 |
| 动画／骨骼／3D 等客户端未支持的表现 | 明确返回不支持的表现状态 | 静态 2D 适配不证明逐帧／骨骼兼容，不用静态截图伪装支持 |

“可存入”“可合法激活”“可在当前客户端正确渲染”是分别核验的状态。来源读取、授权、版本或资源校验失败时，保留实际持有权及安全取出能力，准确提示当前不可显示，不能静默替换成 Original OC 或错误图片。

### 3.2 视觉标准数据不增加资产种类

保持 Soul／Core／Composition／Item 的对象模型。下列 profile、adapter 和参数是版本化定义或组合数据；除非另有明确交易权利，不铸造成新的 NFT。

| 标准数据 | 必须表达的内容 | 权威位置 |
| --- | --- | --- |
| SceneProfileRef | 逻辑画布宽高、原点及轴向、像素模式、裁切／视口规则、基础体型／姿态、固定层、准确版本与内容承诺 | Core 保留 genesis 场景；Composition 引用当前准确场景。大型定义为哈希绑定 manifest |
| VisualSlotSchema | 局部锚点、部位／替换组、允许渲染轨道、遮挡／蒙版端口、接受表现接口、调整权限及边界 | 准确场景／槽位定义；影响合约校验的策略字段或可信证明必须可在链上验证 |
| ItemRepresentationRef | 原素材身份／哈希、源画布／图像范围、局部锚点、透明边界、Style 与媒体类型、必要的多片表现、许可引用 | Item 的准确版本化表现定义，不能被后台 URI 静默替换 |
| VisualAdapterRef | 准确源表现→目标场景／槽位、默认变换、层／遮挡映射、必要资格、允许调整范围、准入依据 | 由目标声明的准入策略认可；不强制只有 Soulidity 中心能发布，声明者自报不构成准入 |
| SlotBinding | Empty／ContentRef／BoundPartRef／ItemRef 之一，加适配引用、固定 Style 身份、PlacementOverride 与允许的逐槽颜色 | SoulComposition 当前权威；每 Part 最多一件，不设第二套前端装备状态 |
| RenderRecipe | 当前 scene、固定层及非空绑定解析的渲染片段、内容哈希、适配／颜色／微调、Soul revision、渲染规范版本 | 同一 SDK 从准确链上快照＋绑定 manifest 解析；导出及市场预览记录该 recipe 的承诺 |

第一版先定义完整的静态二维 profile，不把所有 Maker 强行改成同一个像素尺寸。跨画布适配须把源逻辑空间明确映射到目标逻辑空间。锚点、透明边界和作者 padding 都参与计算；按图片尺寸居中或简单缩放到相同比例不能视为正确适配。

同一 Maker 中不同体型／头部 Style 也可能改变锚点，不能只绑定 Maker ID。Scene 必须声明锚点依赖的部位选择／体型变体／姿态，以及准确锚点值或受支持的确定性求值规则。改变这些依赖时，所有受影响绑定重新校验；预览后原子保存整体结果。不能继续适配的 Free 组件需取下回钱包或拒绝本次变化，Bound 可卸下而记录留本 Soul，Ref 可清选择；不能静默形成未启用 Free 库存或沿用错误坐标。第一版不靠任意第三方脚本求值锚点。

变换约定使用列向量，定义：`p_scene = M_anchor × M_adapter × M_override × M_item × p_source`，矩阵从右向左作用。微调位移在 adapter 输入的局部坐标中表达，旋转／缩放以声明锚点为中心；界面拖动的屏幕位移须转换到这个局部空间。所有客户端必须采用相同约定。链上参数使用有单位的量化整数／定点数，坐标、角度、缩放的精度和舍入纳入 ABI，不存浮点数。

布局安全预算至少包含图片尺寸／解码像素、渲染片段数、manifest 大小、遮罩依赖及嵌套深度。资源合法性与视觉质量分开验证，不能因 PNG 能解码就判定兼容。

### 3.3 替换、叠加和空槽必须明确

**当前外观不能简单理解为“genesis 合成 PNG＋所有 Item PNG”。** 若原 OC 是一张平面图片，只能可靠地加明确允许的覆盖层，无法完整移除已烘焙的头发、服装或遮挡。可换装的 Soul 必须保留可重建的分层 recipe 及合法内容引用；genesis 输出图片仅作为原作品记录／预览。

场景将固定层与可替换部位分开。Complete 按 Creator 准确声明，形成各槽位的 ContentRef／BoundPartRef／ItemRef／Empty；仅 TRANSFERABLE 发行独立可交易实例。适配声明替换该部位／已批准替换组的原片段；叠加饰品仅作用于明确的 overlay 槽位。禁止靠是否存在 PNG 猜替换关系，避免双头发、双衣服或错误遮挡。

一件组件可以有前后两片等多片表现，但它仍是一件实际资产和一次槽位激活。RenderPiece 不是额外实例。第一版只支持显式声明、已验收的多片接口；普通 Style 仍是一张 PNG，不把现有每 Part 一件的容量改成任意多装备。

清除 Ref、卸下 Bound 或取下 Free 后，清绑定及宿主微调，槽位明确为 Empty；固定层照定义保留。Bound 记录留本 Soul，Free 原对象退出到钱包；恢复 genesis 仍为明确选择并验证当前许可／本 Soul Bound 记录／真实 Free 对象，不能凭快照再铸已售组件。空槽或解密失败不触发自动恢复；必需视觉部位变空可提示组合不完整，不扣住可退出 Free 组件。

### 3.4 微调权限、保存和交接

有效微调范围是 **Slot EditPolicy ∩ Item 许可 ∩ Adapter 已验证范围**。第一版推荐只开放局部 x／y、等比 scale、有限 rotation 和作者声明的逐槽色板；翻转为可选声明。任意绘画、源图修改、非等比拉伸、任意 z 排序、遮罩改写及骨骼重绑不作为持有人微调功能。

作者需要声明默认值、可编辑字段及数值边界；不设置一套适用于所有体型的通用像素阈值。对外观有影响的权限／边界必须由合约读取可信定义或校验准确证明，不能只靠前端按钮限制。链上不执行像素级“审美判断”，复杂遮挡与整体质量仍由参考渲染及发布验收确认。

持有人流程：`自动适配 → 可选微调 → 整体预览／边界检查 → 保存 → 读回同一 revision 和 recipe`。拖动、撤销、复位先保留本地草稿，不每拖一次就签交易；最终保存一次提交，并核对预期 revision、真实持有／访问权限、资格与策略。期间链上组合发生变化时，要求重新读入和确认差异，不覆盖他人的最新状态。

画布同时提供选中组件控件和完整角色预览；锚点／边界辅助线、撤销与复位辅助操作，不成为导出画面。异步加载与缓存按 recipe／revision 区分，旧请求不能覆盖新组合。缺素材或授权时不把未完成预览标成最终画面；取出等资产退出操作不依赖成功生成预览。

| 生命周期 | PlacementOverride 的处理 |
| --- | --- |
| 保存／重新打开 | 参数进入 Composition 的准确 SlotBinding；冷启动及第三方客户端都可读回 |
| Soul 整套转让 | 随组合状态交接；买家看到同一已保存布局，可按同一策略修改 |
| Free 取下／Bound 卸下 | 清宿主 binding 和微调；Free 原 ID 回钱包，Bound 固定 Style 记录留本 Soul |
| Item 装到另一个 Soul／Maker | 使用新目标的准确 adapter，默认重新适配，不携带旧宿主坐标冒充兼容 |
| 替换为另一组件 | 使用新组件的默认适配，不暗中继承原组件的微调 |
| 选择新的适配／表现版本 | 明确预览后确认；旧 recipe 不因后台更新静默改变 |
| 上架有效交易中的 Soul | 所售组合和 recipe 冻结；变更须取消／撤出后重新报价 |

受保护素材仍沿准确的 Seal／来源许可取得授权后参与预览，保存的是组合参数，不因开放画布就新增源素材转售／导出权。客户端的读取和导出控制不能保证阻止截图或收回用户已取得的明文；该现实不以“禁止微调”解决。

### 3.5 跨应用一致性与验收

当前定向源码已经有可复用基础：[AC render core](../tmp/animacraft-v8-mainnet-release/maker-v8-render-core.js)保留准确画布、稳定图层排序、作者 x／y／scale／rotation、逐槽颜色、混合及受保护读取；SO 的 native scene 解析核对链上选择和 manifest 哈希。它们不等于新标准已经实现跨 Maker VisualAdapter、锚点／遮罩契约或持有人微调。定向文件身份见[本轮原型与视觉核对证据](../output/asset-standard-2026-10-07/dof-prototype-evidence.json)。

AC、SO、SoulDesk 及第三方参考客户端共用 scene／binding→RenderRecipe 解析器和受支持渲染规范。规范绑定排序、变换、颜色空间、透明处理、混合／采样、裁切及 renderer 版本；第三方不支持必需 profile 时明确告知，不猜层级或忽略遮罩。基础市场／钱包可显示标准预览图和模块清单，不要求它们运行完整画布。

相同 recipe 承诺证明输入与指令相同，**不能单独证明所有浏览器渲染的像素完全相同**。交互预览按明确容差做跨客户端验证；市场／最终导出使用固定版本参考渲染流程，记录实际输出图哈希和 recipe／revision 关联，直到该流程实际验收前不宣称像素级确定性。公开预览还需满足内容展示许可；买家可使用范围与预览可见范围不能混同。

视觉退出条件至少覆盖：两种不同画布／锚点的 Maker；公开与付费 Maker＋Pack 的真实资格；透明 padding 和不同源尺寸；替换／叠加、前后片及遮挡；颜色／像素采样与多种导出尺寸；微调边界、复位、冷恢复；买入整套后布局保留，取出后不残影，装入另一 Soul 后重新适配；空槽、缺权限、缺素材、未知版本；AC／SO／参考客户端的配方一致及画面验证。所有性能预算也必须用实际素材验证。

ERC-6220 的 Catalog 用固定部位、槽位、准入来源和 z 顺序组织组合，其设计理由本就要求部件预先验证能正确组合；它的接口没有替我们定义完整坐标、锚点和持有人微调契约。本方案沿用“先明确准入与表现”的思想，再补齐本项目所需二维契约。[ERC-6220 Catalog 与 Rationale](https://eips.ethereum.org/EIPS/eip-6220#catalog)

## 4 权限与扩展接口

普通拥有型 Soul 的变更使用 &mut Soul，权限从 Sui 的合法对象访问和实际容器借用路径取得。根不再配一个可独立继续授权旧钱包的共享 SoulState owner 缓存。根模块保留 UID 写权，只提供有范围的 DOF 操作，不暴露任意 &mut UID；Core／Composition 和保留键不得被通用组件接口删除。

标准发行入口将新 Soul 直接发送给合法接收人，不返回可被任意分享的 fresh Soul 值；避免把普通根创建成任何人可变访问的共享对象。该不变量必须覆盖全部发行／导入入口。共享容器仍由其自身接口校验权限，容器公开状态不表示任意人可以取得内部 Soul 的可变引用。

这是目标发行约束，并非当前开放标准已经提供的保证：现行 `soulidity_standard::soul::new` 仍返回 fresh Soul。若要在标准层覆盖所有生产者，推荐评审线性构建凭证与最终转送接口，使初始化与合法交付在同一 PTB 完成，而非只限制原生 `finish`。实际 ABI、可组合性、认证容器、第三方生产者与分享根的反例必须核验；未完成前按具体已验证路径限定保证范围。

第三方自由组件 T 需 key＋store，并在 attach 时提供准确来源／发行准入、适配及许可证明，持有与绑定原子形成；类型符合不足以装入。不适配的组件留钱包，不进入通用 Soul 库存。SlotSchema 绑定准确来源／版本、部位身份、策略和技术接口；Bound／Ref 不通过自由组件退出接口。开放准入不代表无许可使用。

第三方扩展的命名空间由实际 Move 类型来源固定，接口主版本明确。只读或受限可变模块访问允许调用模块自身函数，修改须更新 Soul 快照并维护索引；需要跨多个操作才能恢复不变量时，用不可丢弃的完成凭证。Move 不通过 JSON／字符串接口动态执行任意插件。

授权模块由 Soul DOF 持有，Grant 在模块内部字段／Table 记录 issuer、scope、期限和撤销状态。Seal owner-only 每次核真实拥有对象及已认证容器路径。支持的出售合约用 Move 强制原子清旧 Grant＋付款＋根交接，买家重新授权；这不是前端清表。其他自由 public_transfer 不调用自定义交接函数，读取仍需当前持有权和 issuer 有效性，旧持有人不能继续给新持有人授权。如果要求任何转移都永久撤销旧 Grant（包括转回原 issuer 后不复活），须覆盖该私密能力的受控交接 profile；不能用旁置 epoch 缓存假装具备全局钩子。已取得明文无法收回；实际容器与读取路径待验证。

## 5 整体出售、拆分与再次组合

**完整 Soul 交接为根、必要模块、全部 Bound 记录及已装 Free 组件随行。** 只排除可取出的 Free 时，先 detach 留钱包再上架。Bound 即使从画面卸下仍随 Soul，不能宣称出售“裸 Soul”会排除绑定权利。

| 行为 | 交易结果 |
| --- | --- |
| 整体出售 | 根＋必要模块＋全部 Bound（含卸下记录）＋已装 Free＋准确配方；无需包装 NFT |
| 排除 Free 组件 | 上架前 detach 到钱包，更新组合／报价；钱包未装组件不随售 |
| 买入后取下 | Free 返回原 ID 可独售；Bound 只卸下或恢复原 Soul；Ref 清选择不产生对象 |
| 换装／再组合 | 新持有人合法装入新组件，保持原 Soul ID；不重复发行旧组件 |
| 使用 Maker／Pack 内容选择 | 准确引用及资格使用；来源产品控制资产和卖家的访问 Pass 不自动随 Soul 出售 |

不设未启用 Free 库存。清单逐项区分 Ref、全部永久 Bound 记录（含不显示记录）、已装 Free 和必要／嵌套模块，显示买家可用范围。Ref 不证明源资产或卖家不可转移资格随售；成交前明确处理或要求买家满足资格。创作者声明是否随 Soul 可继续使用必须在发布许可中可追溯。

市场负责报价完整性；有效托管不借卖家可变组合引用。成交核 revision、三种权利的完整清单及许可，原子清旧委托、付款、交接；失败回滚，取消恢复原对象。跨来源费用／版税按准确政策处理，不因子对象多重复收取。

Soul 和 Item 的 key＋store 支持 Kiosk 泛型原语及其他容器。市场规则只约束其实际支持的交易／托管路径，不能声称任意 public_transfer 都强制收费。新部署不必继承旧 Personal Kiosk、kiosk_lock 和 SoulMarketProof 的全部限制；是否安装规则由新目标及真实接入验证决定。标准同时提供基础 Display、模块发现和准确状态读取；基础展示不自动运行角色渲染或能力代码。

## 6 Maker、Pack 与 Composable Items 的上游重构

Soul 是实例，Maker／Pack 是产品定义、发行与商业能力。它们不因加入槽位或引用 Pack 增加一个新资产类别。

| 上游对象／职责 | 新模型要求 |
| --- | --- |
| Maker 产品控制资产 | 可以交易；持有证明允许管理该产品，不能接管别人已生成的 Soul |
| Maker／Pack Definition | 准确发布版本、内容承诺、许可、槽位定义；玩家读取不依赖产品控制资产持有人参与每笔交易 |
| ProductRuntime | 按产品共享的次数、发行上限、生命周期和 Treasury 状态；管理必须证明实际产品控制资产，不另发行一个可独立出售的重复控制权 |
| Maker／Pack 使用资格（旧文称 AccessPass） | 与产品所有权分开；现行 Access 是用户与版本绑定记录，不默认发行可转让 Pass；免费／收费只是政策 |
| Item／Style 发行权利 | Creator 在版本化策略选择 REFERENCE／SOUL_BOUND／TRANSFERABLE；只有第三种发行唯一 key＋store 实例，准确 Style／来源／权利固定 |
| Complete | 验证 Maker／实际贡献 Pack 的资格与政策，各 Part 固定 Style 按三权利生成引用／绑定记录／已装真实 Item，形成完整标准 Soul |

产品政策保留：Maker FREE／ONE_TIME_PAID；Pack FREE／ONE_TIME_PAID／INCLUDED_WITH_MAKER；四 Complete 政策及 total cap；Player／Soul 每 Part 最多一固定 Style 单位、稀疏 Empty；来源停用仍可安全取下 Free，Bound 不丢记录；原组件独售费用语义。新包整体接新标准，不读取旧 Pass／Loadout／ID 作为兼容主线。

Original OC／genesis 与当前组合分别展示；未建立装备、空装备和保护读取失败不是同一状态。安装新能力或换装不自动重复收取 Complete、不自动改写角色最初来源。

Maker 工程、固定发布版本与实际控制权分别表达。各渠道共同读取同一资产的权威供给与资格，不复制总额度；Animacraft 分销按用户另行接受的协议执行，合法直接路径无需渠道服务费，但仍执行原许可与发行费用。Player／Complete 的最终线性 Build 保持单 PTB 原子边界；多交易检查点属于内容存储与版本发布，不扩展成已扣款未交付的最终发行半成品。对应状态及接替条件以配套附件为研发映射依据。

## 7 实施顺序与退出条件

| 步骤 | 交付物 | 退出条件 |
| --- | --- | --- |
| 1 确定最小 ABI 与原型 | Soul／Core／Composition／BoundParts／授权、四类绑定、固定 Style 三权利、原子 attach／detach／replace | 三模式装卸／发行／反绕过、Free 原 ID、Bound 仅本 Soul、整体转移、容器／Kiosk；旧研究原型只作基础证据 |
| 2 先验证视觉标准与微调 | 两种 Maker 的 Scene／Slot／Representation／Adapter、分层 recipe、参考解析／渲染、受约束微调及冷恢复；同时固定保存参数的最小 ABI | 默认适配、替换／遮挡、空槽、参数边界和跨客户端画面通过；明确无法适配的表现，不能留到市场完成后才验收 |
| 3 完整模块与统一 SDK | 准入／三权利／策略证明、Core manifest、Walrus／Seal；readSoul／readComposition／readBoundParts／readInstalledItems、准确 BCS／type origin、操作构造器和 Display | 许可／部位／类型／版本／边界错误拒绝；索引／revision 一致；钱包／父持有及读取；原子清委托成交和微调读回 |
| 4 重构上游发行与商业 | Maker／Pack 产品控制、Definition／Runtime／Pass、Complete→Soul | 公开／付费／包含资格、次数／上限、准确结算和唯一发行端到端通过 |
| 5 新市场及应用接入 | 整体出售、单独出售、组件独售、取消、角色详情；Animacraft／SoulDesk／游戏接入 | 买入整套后取出／单独出售／再装入的完整用户旅程；配置防变、失败／未知结果恢复 |
| 6 新发布与运行 | 准确构建制品、依赖及新部署清单；SDK／客户端统一切新包 | 适用 G1–G5、独立验收、真实部署读回及原操作验收；Monitor 追踪失败、资金／实例对账和授权异常 |

2026-10-07 研究阶段的第 1 步原型通过 10 项 Move 测试和生产模式构建，仅证明当时的基础持有／取出／转移路径；上述顺序保留为整体验收框架，当前下一步以权威工作树 CURRENT 为准。发布采用新部署，不为不成熟旧 ABI 建立兼容主线；后续已成交资产及恢复意图按各自有效规则保留。用户已允许重构与重新部署，实际发布仍须以具体可验证制品、网络和部署清单执行，原钱包／签名工具边界照常适用。本次文档调整不执行生产发布、不提交或推送代码，不把原产品交付状态标成完成。

## 8 2026-10-07 原型及评审证据

原型位于 [work/soul-dof-v1](../work/soul-dof-v1/README.md)。它只实现当时的原生归属、类型级槽位、成员索引和原子替换，包含先 deposit 后 activate 的研究模型；**不能证明最新固定 Style、Creator 三权利、原子 attach／detach、Bound 记录或出售清 Grant 已实现**。基础 Kiosk 为无规则测试 TransferPolicy＋测试 SUI，不是产品 USDC 结算。10／10 和生产模式构建仅为该原型证据，准确身份见[日志](../output/asset-standard-2026-10-07/dof-prototype-evidence.json)。本轮没有新视觉／完整生产协议或部署。

手册 v1.0（2026-10-06），共同章节 1–4／9／12及合约／Sui 专项 7／8.3／8.4 适用。按[产品工程评审模板](../agent-management/templates/product-engineering-review.md)内联记录本设计与原型，不新建任务板；既有 DEV／Delivery 记录可引用此附件，原 CURRENT／活动 Owner 不因设计稿变更。

该历史阶段的证据：Plan 为全新目标与视觉方案；研究范围 Code／Build／Test 为最小 Move 原型及日志，Release／Deploy／Operate／Monitor 当时未执行。[原型与视觉历史交接](codex/handoffs/2026-10-07-soul-dof-v1-visual-plan.md)保存当时范围；当前完整重构进度以隔离工作树 CURRENT、现行合约规格与实际证据为准。本次文档调整不改变原 DEV-002／BUG006 或 M1–M4 状态，主 CURRENT 仍保留原发布续接指针。

## 9 2026-10-07 重构准备记录与关联入口

历史准备阶段，用户要求先充分规划再施工，并授权建立专项表。[原 Slack 总入口](https://sega-xya5661.slack.com/docs/T08LQTJFZRS/F0C7GSJ47BK)曾整理八表导航、责任／Ready／Done、R0–R7 顺序、测试素材与 37 步原旅程；本次未重新读取远端内容，不能作为最新表数量或进度证明。后续已授权实施，当前仍复用原专项职责与 Bug／Delivery，不建立新任务板或自动同步，原 CURRENT 和活动 Owner 保留。

前端十标签 Parts & Items／Maker Info／Layer Tracks／Smart Color／Rules／Expansion Packs／Composable Items／Commerce & Rights／Soul Configuration／Preflight 全覆盖；保留主要UIUX，必要细节为组件三权利、真实装卸、受约束微调、许可与交接范围。UI复用不能免除新BCS／读取／交易／renderer适配。

本次准备不实施生产代码、不签名或支出、不提交推送。R0准备完成与R1–R7产品实施／安全审查／部署／运行分开；准确新候选、包／对象／Cap有效权限、资金结算、真实视觉及完整旅程必须之后逐轮核验。额外金融产品只在明确引入借贷／抵押／Oracle／清算／收益／激励时再建立专用风险参数记录，不凭管理模板扩大路线图。

| 检查域 | 本轮结论 | 完整实施仍需 |
| --- | --- | --- |
| 产品与授权 | 全新重构／新部署已由用户明确允许；不再要求旧版兼容 | 新目标制品和应用行为验收 |
| Sui 对象与组合 | 本地原型验证结果见 README／测试日志，不能推定全链符合性 | 共享容器权限、全部发行入口、销毁／退出、嵌套深度、容量与 Gas 边界 |
| 视觉与交互 | 已核对现有渲染基础；第 3 节提出受约束画布及完整组合契约 | 第 7 节步骤 2 的实际素材、适配、遮挡、微调与跨客户端验收；未知表现明确返回不支持 |
| 内容与私密授权 | 模块职责和证明范围已定义，尚未实现 | 原生 owner-only／认证容器读取，Grant 撤销／交接及真实 Seal 验证 |
| 支付与经济 | 不执行真实付款，完整费用／资金路径尚未实现 | USDC 金额／精度／分账、许可与版税政策、取消及未知结果对账 |
| 治理与部署 | 本轮无部署；旧包 Cap 不再限制新类型设计 | 新 UpgradeCap／Admin 权限清单、规则可变性、依赖和部署读回；不凭文档宣称多签／时间锁已生效 |
| DevOps 与运行 | 源码／测试／制品身份分别记录 | 独立复核、适用发布检查及真实旅程；运行与监控证据 |

技术依据于 2026-10-07 核对：[DOF add／remove](https://docs.sui.io/references/framework/sui_sui/dynamic_object_field)、[DOF 子对象访问与存储](https://docs.sui.io/develop/objects/dynamic-fields)、[Kiosk 泛型及借用接口](https://docs.sui.io/references/framework/sui_sui/kiosk)、[Seal owner-only／allowlist 模式](https://docs.sui.io/sui-stack/seal/example-patterns)、[Seal 读取执行限制](https://docs.sui.io/sui-stack/seal/using-seal)。旧版现状仅供历史对照：[2026-10-07 只读核验](../output/asset-standard-2026-10-07/current-soulidity-baseline.json)。
