# Soul DOF v1｜现网站施工依据与准备评审

# Soul DOF v1｜现网站施工依据与准备评审

2026-10-07；阶段 Plan / R0；当前真实前端逐页映射、规格与流程，不代表生产实现、审计或部署。

用户最新指令：先准备文件与流程，交用户确认开始重构后才进入代码实施。此前部署意向不替代本次开工确认。新隔离 worktree 保持干净；不修改旧发布会话、CURRENT、钱包和资产。

施工依据：现网站真实前端，保留原页面、组件、弹层和操作路径。仅接新合约、三权利、装卸、微调与出售清单细节；历史HTML/Penpot增量及v1/v2 ZIP已失效为施工依据。

## 审阅入口

|文件|审阅目的|对应工作|
|  ---  |  ---  |  ---  |
|产品范围|固定资产、权利及兼容边界|DOF-001/004/005/006/008；R0/R1|
|UIUX与页面差异|保留十标签和原旅程，只增加必要状态|DOF-002/003/011；J01–J37|
|对象、接口与状态|Soul/真实组件/记录、原子操作和第三方接口|DOF-001/003/006/007/008|
|视觉契约|不同画布、固定Style、微调、可重复渲染|DOF-002；J07/21–26|
|威胁、权限与治理|资金/资产/授权/升级的真实控制路径|C01–C15；A01–A11|
|经济、费用与对账|支付资格和组件权利分离、整数分账与账本|E01–E11；J16–20/27–32|
|测试与素材|Creator→Player→Soul→市场顺序及失败分支|DOF-011；37旅程|
|敏捷、构建与发布|Ready/Done、准确组合候选、部署与读回|D01–D08；R0–R7|
|运行、监控与恢复|对账、告警、事故、内容期限与退出|DOF-014；D07/D08；J37|
|工程评审及待定项|区分准备完成和未来实现门禁|原研发卡/安全/决策表|
|历史工具与范围纠正|过去使用Penpot；新增交互草稿退出施工依据|历史记录|
|证据模板|发布、权限、旅程、账本、告警、素材、审查|对应原卡附件，不另建任务板|


## 开工与放行的区别

G0 开工：本包、九张关联表、用户审阅与明确“开始重构”确认。G1 最小组合：两种真实Maker画布、三权利、原ID装卸与渲染。G2 产品闭环：十标签、公开/付费Maker、Pack、Complete、钱包/容器及失败恢复。G3 市场与隐私：准确清单、冻结revision、原子清授权/支付/交接、买家再授权。G4 候选与生产审查：固定包/SDK/双站制品、适用安全审查/审计、权限/资金与测试证据。G5 发布运行：准确部署读回、37步上线部分、对账、告警和应急演练。

G0确认只打开重构实施阶段；上线签名、费用、治理设置和不可逆切换要根据届时准确候选和已有授权核查。不能把G0勾选作为所有未来签名的空白许可。

## 开工前需看清的设计边界

1. Soul采用key+store，受支持出售路径原子清旧委托。任意第三方public_transfer不能自动执行我们的清理钩子；若要求任何转移均永久失效，必须另选受控交接profile。这项决定阻止依赖它的私密委托上线，不阻止无私密委托的组合原型。
2. 视觉可行性要在R1用两种真实Maker验证。仅以现网站画布与准确素材验证；历史模拟图不作为施工或视觉验收依据。
3. 实际费率、币种、供给、Cap持有人、多签成员、升级策略与RPC/存储预算在相应门禁前确定；现在不虚构这些值。

未开始新生产合约/SDK/UI重构，未执行新版本真实用户旅程、支付、安全审计、部署或告警。

[交付文件与上线门禁30项](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6ZRFR6VD)；[敏捷研发14项](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JBQ5JF6)；[原用户旅程37步](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4)。

---

# 产品范围与需求基线

版本 prep-2026-10-07；Owner沿既有岗位。权威详细规则：Soul DOF v1重构规范。本文为开工评审摘要，用户最新三权利及单Part纠正优先于历史研究。

## 资产与形态

|概念|拥有/交易内容|不自动包含|
|  ---  |  ---  |  ---  |
|Maker|产品控制资产；发布内容及允许生成OC的许可|玩家Soul所有权、任意素材转售权|
|Expansion Pack|产品控制与扩展内容；FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER使用政策|因付费而自动独立交易所有组件|
|Soul|key+store根；必要模块、准确配方、永久绑定内容和已装真实组件|钱包内未装组件、卖家个人访问Pass|
|TRANSFERABLE Item|固定Style、唯一实例ID、准确来源/许可；装入Soul或钱包持有|整个Maker的控制或版权|
|REFERENCE / SOUL_BOUND|内容引用 / 永久归属一个Soul的记录；随相应规则使用|自由钱包组件或独售权|
|Configuration / Slot / Adapter|数据或模块；除非另有产品明确授权，不作为独立可售资产|因有UID而自动金融化|


Soul带Pack、带卡槽等是同一标准对象的组合状态，不为每种组合发行不同NFT类型。Maker/Pack控制、用户使用资格、组件权利及内容许可是四条独立轴。

## 必须保存的用户结果

每Part当前最多一件Item，Complete固定该Item的一个Style。多个Part、同一Item多个RenderPiece、多个Outputs均不等于一个Part多选。保存Part→固定Style、颜色、布局、来源版本、权利、Outputs及适配信息。Style可依供给政策产生多个实例，实例ID唯一。

引用：可清选择，无返钱包资产。绑定OC：可卸下/在原Soul恢复，记录不离开原Soul。可自由交易：仅这类发行真实Item对象，attach原子入Soul并占槽，detach原ID返钱包；不设置通用未激活自由组件库存。

整套出售包括全部Bound记录，即使卸下；仅当前已装的自由组件随售。想保留自由组件先取下。引用不转移来源产品或卖家个人许可；买家按发布许可获得相应使用能力。

## 保留与变更

**现网站真实前端是施工依据。逐页核对见02_UIUX_CN.md；保留页面结构、组件、工具弹层与操作路径。新合约接入和必要UI细节均在原入口完成，不另造导航、页面或交易向导。此前独立HTML/Penpot增量已退出施工依据。**

保留Creator十标签、草稿/历史/ZIP/预览/多个Outputs、公开与付费Maker、Pack三使用政策、既有Complete政策、Physical分支、Loadouts、Showcase、账号/集合和主要市场旅程。新版本重新设计合约/SDK/格式和交易适配，不要求旧ABI；旧资产与历史会话留存，不强制迁移。

新增加的产品细节：逐Item/Style三权利配置与发布确认；Complete形成内容清单；Wardrobe权利与实际位置；受约束微调；准确整套出售清单；授权范围/期限/撤销。

当前不新增借贷、收益拆分、Oracle、清算、抵押、LP或token激励。以后引入时独立论证经济和风险参数。

## 变更控制

每项需求关联DOF/F/J/C/E/A记录；已发行权利不可静默改变。发布后修改通过新版本及明确适用范围。重大变更记录原因、受影响用户、版本和回归旅程；不靠覆盖旧文档消除差异。

---

# 现网站前端逐页核对与最小接入差异

2026-10-07，Plan / R0。**施工依据是现在的网站真实前端。保留页面结构、现有组件、工具弹层、操作路径和用户旅程；替换底层合约、对象读取、SDK与交易逻辑，只标注新合约接入、三类组件权利、装卸、微调和出售清单需要的细节调整。** 另做的HTML交互、Penpot增量及其截图已退出施工和验收依据，不要求导入或继续完善。重构未开始，等待用户明确开工。

## 基线与核对证据

* Animacraft正式站：https://animacraft.soulidity.ai/ 。当前行为源 `tmp/bug005-publication-recovery`，commit `65b4218012b54c37966a5ad88e803a9d66185ff4`，下文缩写 AC。
* Soulidity正式站：https://www.soulidity.ai/ 。源码基线 `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`，commit `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`，下文缩写 SO。该隔离目录只读核对，仍保持干净。
* 2026-10-07用独立IAB会话只读观察：AC广场、已发布Maker详情、Creator库、既有稿件Parts & Items和其余九工具、Player test；SO Market的Souls与Components。没有创建或修改Maker内容、购买、Complete、链上装卸、授权或签名；原生产Chrome/OKX会话未操作。
* Creator实际是Parts & Items主工作区加其余工具弹层；关闭返回原工作区。不得用新原型的页面切换替代此结构。
* 原站DOM记录和实站截图保存在 `output/soul-dof-v1-preparation/current-frontend/`。Creator观察对象为既有本地稿件S13-EXPORT-SIZE-PROBE，不代表新协议素材。Player test的Complete因未发布而禁用；公开Maker详情的Start making未在当次观察即时显示Player，随后用既有Creator的Player test核实原界面。SO市场当前读取完成后无可见Soul挂单；旧Soul详情在此独立会话未呈现工作区。**下表S=准确基线源码核对，L=本次实站观察；S不能写成持有人操作或交易已经线上验收。**

## 页面、原操作与新接口映射

每行保留原入口和返回路径；“底层接入”是设计目标，不是已冻结的生产ABI。出现未列出的新增路由、重排导航、换掉整个面板或另造交易向导，先判为范围偏离，不得自行实施。

|ID／现有页面或区块|核对／现有源码|保留的操作与结构|底层接入差异|仅必要UI细节|原旅程|
|  ---  |  ---  |  ---  |  ---  |  ---  |  ---  |
|U01 广场 `#templates`|L/S；AC `original-product-app.js`|搜索、筛选、Maker卡、View Maker、Start making|新发布目录、生命周期、资格与manifest读取|权利/访问摘要；明确加载、空结果、不可用状态|J14–17|
|U02 Maker详情 `#template`|L/S；同上|封面、作者、许可、Parts统计、开始按钮、返回广场|准确Maker/Pack发布版本和使用资格|三权利摘要与付费获取范围说明|J14–17|
|U03 Creator库 `#creator`|L/S；同上、`maker-v8-workspace.js`|新建、Preview/Manage/Edit、Draft Recovery|新产品控制对象、生命周期与恢复记录|新版本状态/错误文案；不新建管理导航|J01/02/08/13|
|U04 Parts & Items主工作区|L/S；AC `maker-workspace-v8-view.js`、`maker-v8-creator-style.js`|左Part、中画布/Item/Style、右Inspector；坐标/锁/样式；原工具栏|固定Style内容、来源/权利/scene版本输出|在已有Item/Style设置处声明引用/绑定OC/可自由交易；发布后权利不可静默改|J03/07/12|
|U05 Maker Info工具弹层|L/S；AC `maker-workspace-v8-view.js`|名称、封面、介绍、许可、画布元信息；关闭返回|新Core genesis与发布manifest元信息|准确许可版本提示；不搬迁字段|J05/10|
|U06 Layer Tracks工具弹层|L/S；同上、`maker-v8-render-core.js`|back→front层序、多片渲染、选Style定位|确定Renderer/Representation/Track承诺|兼容校验错误就地显示；不把多片变多件|J04/07/23|
|U07 Smart Color工具弹层|L/S；同上、`maker-v8-player-colors.js`|颜色通道、Style关联、联动|已声明色域/通道及Composition颜色保存|越界限制和恢复默认说明|J04/07/23|
|U08 Rules工具弹层|L/S；同上、`maker-v8-player-recipe-constraints.js`|冲突/依赖、Random和Preflight共用约束|每Part最多一个固定Style单位、新槽位准入|指明冲突位置/解决方式；不新增Part多选|J04/07/18|
|U09 Expansion Packs工具弹层／子项目|L/S；AC view、`maker-v8-pack-controller.js`、`maker-v8-pack-authoring.js`|绑定父Maker的独立Pack项目、锁定父快照、发布/生命周期|新Pack控制、版本、资格、组件发行政策|保留FREE/PAID/INCLUDED；组件权利单列；付费不等于组件独售权|J11/13/17|
|U10 Composable Items工具弹层|L/S；AC view、`maker-v8-composable-controller.js`|当前卡槽设置、External产品、目标Maker、上传历史|SlotSchema/Adapter、发行来源证明、实际可交易Item|用逐内容三权利取代笼统资产化开关含义；已有列表增加准确兼容/去向信息|J12/18/25|
|U11 Commerce & Rights工具弹层|L/S；AC view、`maker-v8-market-controller.js`|Maker访问、Complete策略/cap、价格和分账区块|新quote/feeSnapshot、结算和许可版本|使用权、产品控制、组件权利分别说明；费用仍在原报价位置|J06/16/19/27|
|U12 Soul Configuration工具弹层|L/S；AC view|原人格/记忆/技能文档列表、编辑、验证、默认恢复|SoulCore及扩展内容manifest、Seal策略|根格式/内容版本校验；不把DOF术语放进玩家必经路径|J05/20/31|
|U13 Preflight／发布Review|L/S工具、S发布；AC view、`maker-v8-publication-controller.js`|现有检查、Review、发布步骤、Resume与读回|新发行/权利/适配清单、包/对象读回|校验失败跳回原字段；显示准确发行方式和预算|J09/10/12/35|
|U14 保存／历史／ZIP／Outputs|L工具栏/S执行；AC `maker-v8-project-zip.js`、`maker-v8-local-player-store.js`|原草稿、Undo/Redo、历史、导入导出、多Outputs|新schema序列化与准确来源/recipe|新版本标识、不可读schema提示；保留原恢复入口|J07/08/35|
|U15 Player `#make`|L/S；AC `maker-player-v8-view.js`、`maker-v8-player-controller.js`|原预览、Part/Item/Style单选、Palette、Random/Reset、Info、配置和导出|当前选择编译为固定Style配方；新资格与Adapter校验|选择旁权利徽标/不兼容原因；不改主选择模型|J15–18/23|
|U16 Player Pack／外部组件|S；AC `maker-v8-player-journey.js`、player view|原Pack启用/使用与组件选择区块|资格与资产所有权分开；原子占槽/替换|费用/权利及替换去向提示；不另造库存页|J17/18/25|
|U17 Complete／预览导出|L禁用入口/S有效流程；AC player view/controller、`maker-v8-player-protocol.js`|原Recipe JSON、Preview & export、Complete、报价/恢复|同attempt生成Soul+各Part准确选择；仅TRANSFERABLE发对象|原确认内增加生成清单/三权利结果/报价有效期；不新增Complete向导|J19–21/35|
|U18 Soul详情 `/souls/[id]`／Info|S；SO `web/app/souls/[id]/page.tsx`、`native-original-preview.tsx`|原封面、来源、Info、所有者、详情导航和出售入口|新Soul根/DOF Core/Composition/Display读取|准确来源/revision、原作与当前外观区分；旧资产不伪装新格式|J21/28/34|
|U19 Soul详情内Wardrobe|S；SO `web/components/souls/native-wardrobe.tsx`、`use-native-equipment-actions.ts`|原Wardrobe标签、槽位列表、选件、Equip/Replace/Remove、预览和恢复|REFERENCE清选择；SOUL_BOUND只卸显示；TRANSFERABLE attach/detach原ID|就地显示权利/占槽/去向；绑定OC可恢复原Soul、自由组件取下返钱包；不新增顶级Wardrobe页面|J22/24/25|
|U20 Wardrobe内微调／预览|S原预览；SO `native-equipment-preview.tsx`、`native-current-appearance.tsx`|保留当前预览与原操作位置|Adapter与Creator范围、layout/recipeHash/revision保存|在原选件/预览旁最小增加受约束调整与恢复默认；新增控件需实页标注，未声称已有完整Player微调|J23/25|
|U21 Wardrobe内Loadouts／Showcase|S；SO `native-loadouts.tsx`、`use-native-loadouts.ts`|保存/命名/查看/应用及原展示位置|准确配方/权利/内容版本；应用须重核对象与许可|缺件/过期/不兼容原位提示；Loadout记录不虚构资产所有权|J26|
|U22 Soul详情 Persona Sprite／Skills／Memory|S；SO detail page|原内容标签、追加版本、读取/授权入口|Core/扩展DOF、Walrus/Seal、当前持有与容器校验|内容版本/读取错误/能力限制说明|J31|
|U23 Soul详情 Grants|S；SO detail page、`web/lib/hooks/use-grant.ts`|原授权、scope、expiry、撤销区块|DOF授权模块、issuer、持有校验、支持成交清Grant|再授权提示与真实转移限制；不新建Permissions导航|J31|
|U24 Market `/market`|L/S；SO `web/app/market/page.tsx`、`equipment-market-browser.tsx`|原Souls/Collections/Components、筛选/分页/扫描/卡片|新列表发现、清单、准确owner/DOF读取|卡片显示组合范围摘要；Components只列可独售对象|J28–30/33|
|U25 Soul上架 `/souls/[id]/sell`|S；SO sell page、`use-native-market-list-actions.ts`|原价格页→授权确认→成功/恢复|替换旧强制卸装路径：整套清单冻结revision；保留自由组件时先detach再生成清单|在现有Selected sale scope增加准确随售范围；不得沿用“全部装备都留卖家”旧文案|J28/29/35|
|U26 上架确认／成功／取消／改价|S；SO sell/authorize及success page、`native-delist-modal.tsx`、`native-update-price-modal.tsx`|原报价确认、原弹层和失败恢复|manifestHash/quote锁定；取消/并发校验；supported成交原子清Grant|同清单核对：根/必要模块/全部Bound含卸下/已装自由组件；钱包未装不包含|J28/29/35|
|U27 买入 `/souls/[id]/buy`|S；SO buy page、`use-native-market-buy-actions.ts`|原详情→买入确认→持有详情|原子付款/清旧Grant/根及随附交接；买家DOF读回|买入确认内显示同一清单，接收后可取下自由组件；Bound仍归同Soul|J29/30/31|
|U28 组件独售／产品控制交易|L组件市场/S其余；SO `equipment-market-panel.tsx`；AC market controller|原组件交易面板与产品控制入口|仅自由Item独售；Maker/Pack控制不接管Soul/Pass|交易对象/控制权/使用权明确；引用和Bound不得出现独售按钮|J27/30|
|U29 My Souls／集合／账号／社区|S；SO `web/app/my-souls/page.tsx`、collections/profile/community|原列表、详情、收藏/集合/账号路径|新Soul发现/集合/Display读取，保留既有授权检查|必要类型/加载/版本状态；无重排社区及资产导航|J33/34|
|U30 Physical／跨设备／失败恢复|S；AC original app/controller；SO hooks/recovery组件|原Physical分支、桌面/移动入口、取消与恢复|新receipt/consume、交易effects、同attempt查询|未知先查链；原选择/草稿保留；不盲重扣；原适配断点回归|J32/34–37|


## 五类最小调整的验收边界

1. 新合约接入：同一候选包/类型来源/对象/manifest；不因ABI变化改用户主路径。读取与签名均重核当前owner、资格、revision和quote。
2. 三权利：Creator在现有编辑区域声明准确发布政策，Player在原选择与Complete确认看到真实结果。价格政策与组件交易权分开。
3. 装卸：原Wardrobe按钮按权利执行。引用没有返钱包资产；绑定OC卸下仍属于本Soul且能恢复；自由组件取下原ID返钱包。替换原子，失败不丢旧装配。
4. 微调：沿现有画布/预览和坐标语言，按Creator允许x/y、等比缩放、有限旋转与色域；不开放任意层序/遮罩/源图编辑。Creator原有完整创作Inspector不因玩家范围限制被删减。跨Maker必须先通过Adapter与许可校验；layout落到Composition，参考Renderer实际验证。
5. 出售清单：沿现有上架/确认/买入页。整套包含全部Bound（卸下也含）和已装自由组件；钱包未装不含。卖家需保留自由组件时先取下，再上架准确清单；成交时原子清旧委托，买家再授权。任意public_transfer的永久撤销限制继续如实记录。

## 开工后验收与当前未执行项

每项改动必须提供“原站页面/控件→源码→新读写接口→最小视觉差异→原J旅程”证据。先在现有组件上标注再实施；桌面/窄屏保留原导航、弹层关闭/返回、键盘和恢复路径，不把新模拟图当预期截图。两个真实Maker画布、精确素材/适配、有效Complete、持有人装卸、整套成交及私密授权均待新候选实际执行。37步继续Not run，生产代码与部署均未开始。

---

# 对象、接口与状态设计合同

阶段：设计评审；函数名为业务命令草案，不是已部署ABI。生产Move布局/BCS/typeTag/事件签名在R1源码与测试后固定，并进入发布manifest。

## 对象与存储

|形态|所有权/能力候选|内容与出口|
|  ---  |  ---  |  ---  |
|Soul|owning root，key+store|稳定身份/标准版本/必要模块；公共转移可用于钱包/容器；包内借UID操作组合|
|Core / Composition / BoundParts / Authorization|Soul下标准DOF模块；由根模块控制入口|UID不暴露给任意调用者；必要模块不能被用户任意删除；内部记录用DF/Table|
|Item|key+store，自由组件|来源版本、固定Style、权利证明、视觉表示；仅TRANSFERABLE；attach/detach原ID|
|BoundRecord|模块内部值/Table记录|永久所属Soul，清active binding不删除记录；无wallet-export入口|
|ReferenceSelection|Composition数据|内容hash/版本/许可/Style；不是持有源资产的证明|
|Maker/Pack及其控制|独立产品控制资产＋发布版本/权利策略|Owner转移不改玩家已发权利；使用资格单独记录|
|Grant|Authorization内数据|issuer、grantee、scope、expiry、revoke；不能只凭旧issuer读取新owner内容|


DOF=Dynamic Object Field（动态对象字段）：子对象仍可被索引看见；`add/remove`要求真实object满足key+store且拥有根UID访问。DF=Dynamic Field，适合内部值。接收转到对象地址的Receiving<T>是另一条资产接收路径，不等同已装槽；本版标准attach显式接收用户可支配Item并原子DOF插入+slot binding。若支持外部向Soul地址直接转入，必须单独设计receive/reject/recovery，不默认把任意入账认作装备，不创建本版通用闲置自由库存。

## 最小业务命令

|命令|必须输入/核验|原子结果|拒绝与读回|
|  ---  |  ---  |  ---  |  ---  |
|create_soul/Complete|准确Maker/Pack版本、固定Style选择、资格、发行授权、quote、attempt|Ref记录、Bound记录、可交易Item按政策发行并装配、准确root/recipe|不合法来源/供给/付费/重复attempt拒绝；按attempt读回Soul和支付|
|attach|当前Soul控制、真实原Item、目标Part、source licence、Adapter、expectedRevision|入DOF＋占槽＋revision/recipe更新|错Owner/非自由/不兼容/同槽占用/旧revision拒绝|
|replace|同上＋旧槽退出策略|原Free返钱包，Bound留记录，Ref清选择；新件装入|全部一笔或无变化，不能吞旧资产|
|detach|当前Owner、expectedRevision、已装Free ID|移除DOF/binding；原对象原ID返Owner；更新revision|非Free拒绝；不得跨Soul取他人资产|
|unmount/remount_bound|当前Owner、同Soul BoundRecord、目标Part、许可/适配|只更新显示绑定；记录仍留原Soul|钱包导出/跨Soul拒绝|
|clear_reference|当前Owner、对应Part/revision|清引用选择，保留必要来源与审计语义|无资产返回，不虚构组件出售|
|save_layout/loadout|同版本recipe、Creator允许范围|准确布局/revision/hash|越界、未获许可、缺Adapter拒绝或标不可用|
|list/cancel/buy_soul|root实际控制、全部Bound+已装Free清单、expectedRevision/hash、价格币种、quote期限|上架锁清单；成交清Grant＋付款＋root交接|清单变动/并发/旧报价失败；取消恢复可操作状态|
|buy_item|钱包持有或取出后可售Item、许可、quote|原ID交接＋整数分账|Bound/Reference独售拒绝|
|grant/revoke/read|当前真实Owner/认证容器、scope/expiry、issuer规则|写授权/撤销；读取按策略判断|过期/撤销/旧Owner/未经认证容器拒绝|


全部可能产生费用/发行的命令使用attempt与事实读回恢复。交易原子性不自动提供跨交易幂等性；必须用链上或可验证请求记录防止第二笔重复业务动作。

## 状态、事件与错误

组合revision单调递增；每Part 0或1件固定Style。Free位置钱包→已装Soul→钱包；Bound选中/未显示都在原Soul；Ref有选择/清除。上架准备→已上架→成交或取消；未知为客户端观测状态，不是允许再付款的业务状态。

事件候选：SoulCreated、ItemIssued、CompositionChanged、ItemAttached/Detached、BoundMounted/Unmounted、GrantChanged/Revoked、ListingCreated/Cancelled、BundleSold、AccessPurchased。每个包含network/版本可关联的root或产品ID、source/version、attempt/quote与必要整数资金字段；不得放私密内容。

错误分类：Ownership、RightsMode、PartOccupied、StyleMismatch、UnsupportedAdapter、LicenceDenied、StaleRevision、StaleQuote、SupplyExceeded、AlreadyCompleted、PaymentMismatch、ContentUnavailable、UnsupportedContainer。SDK映射稳定错误码→用户可恢复操作，具体数值代码在实现后固定。

## 第三方标准

readSoul返回schemaVersion/identity/source、完整必要模块、recipe/revision/hash、所有Bound记录、当前Free对象ID/Type、权限能力摘要和缺失状态。readItem返回唯一ID、固定Style、来源/许可/表示及兼容目标。getSaleManifest提供准确范围和付款币种/整数金额；build交易返回对象版本依赖/范围预览；confirm读实际effects后展示成功。Indexer是检索，不替代Owner/许可/结算验证。

钱包、Kiosk、认证第三方容器分别验证owner路径和交易策略；key+store本身不证明所有市场规则可成交。跨容器转移和读取必须有专用验收样例。标准模块命名/版本、BCS编码、内容hash算法和AdapterID不能由前端各自发明。

依据：[Sui DOF](https://docs.sui.io/references/framework/sui_sui/dynamic_object_field)、[Sui transfer](https://docs.sui.io/references/framework/sui_sui/transfer)。具体framework版本在构建清单固定。

---

# 视觉、画布与适配契约

目标：Complete的作品在Soulidity、Loadout、Showcase、第三方容器一致；装配权利与视觉变换分开。

## 数据合同候选

Scene：source/version、canvasWidth/Height、原点/轴方向、单位、Renderer版本、颜色空间、背景、Outputs、hash。Part/Slot：稳定PartID、语义类别、容量1、坐标系/锚点、允许表示/权限、mask与层策略。Representation：固定Item/Style、RenderPiece列表、内容hash、尺寸/padding/锚点、layer refs、SmartColor声明。Adapter：准确源表示→目标Scene/Slot、转换矩阵与版本、范围/兼容规则、hash。Layout：选中单位的局部dx/dy、等比scale、允许rotation/color、recipeHash/revision。

这些是R1待实现的schema合同，不伪造已存在的标准类型。必须定义浮点到链上定点整数的转换、范围和舍入；禁止JS/UI与Move各自使用不一致量化。

## 渲染顺序

验证准确来源/许可/表示hash → 选目标Adapter → 从源画布坐标映射目标Slot → 应用Creator范围内局部微调 → 按固定层/遮罩/RenderPiece组合 → SmartColor允许色域 → 多Outputs输出及recipeHash。

局部微调不得修改源Style、遮罩或全局层序。以Anchor为变换中心，不让透明padding改变对齐。不同纵横比禁止直接stretch；unsupported没有“看起来差不多”的自动成功状态。

## R1真实验证集

A为现有1024方形多片机器人Maker；B必须是不同尺寸/纵横比/锚点的真实Maker。B未准备与发布，当前演示素材不算B。至少验证同源genesis像素、Free原ID拆下再装、跨Maker适配、Bound卸下重装、颜色联动、透明padding、多片前后遮挡、Empty、不同Outputs、窄屏/高DPI、缺素材/hash错误/旧Renderer。

UI范围、链上数值范围、layout保存读回必须相同。记录真实源/候选/环境/Renderer版本、golden图和观察图、差异区域/容许依据。仅检测文件存在或截图打开不证明视觉一致。

用户可“恢复默认”“预览”“保存微调”；失败保留最后成功recipe与待编辑值，禁止写入无法复现外观的组合。上架前固定准确layout和recipeHash。

---

# 威胁模型、权限及治理准备

设计状态，所有新生产检查Not run。沿原合约安全C01–C15与风险A01–A11，内部QA、独立复核、外部审计分别记录覆盖候选。

## 必须证明的不变量

I01 每Part至多一件固定Style；多片不增容量。I02 只有Creator声明TRANSFERABLE才生成自由Item。I03 Bound无钱包/跨Soul/独售出口，卸下不从整套范围移除。I04 Free attach custody与binding原子，detach原ID且无双重持有。I05 来源/发行授权/许可/Adapter不可伪造。I06 已发行权利不可被新产品Owner静默改写。I07 清单对应root/revision/hash及全部Bound/已装Free。I08 支付/分账/清Grant/交接全成或全无。I09 attempt防跨交易重复发行/扣费。I10 越权UID/Cap/模块删除/类型混淆不能破坏根。I11 内容hash/Seal策略与真实Owner/容器匹配。I12 重试、取消、超时和并发保持资产与资金守恒。

攻击面：伪造Maker/Pack发行证明、复制Style引用冒充资产、假Bound自由对象、slot/版本竞态、恶意Adapter/素材、旧报价/并发供给、支付CoinType/精度、未知交易重放、伪装容器Owner、委托过期/撤销、Cap漏转/升级绕过、供应链/域名/RPC/内容和索引故障。

## 私密授权的未决边界

owner-only每次核验当前真实持有和支持的容器路径。标准市场成交强制原子清全部旧Grant；买家重新授权。Grant至少scope、grantee、issuer、expiry、revoke状态，并拒绝当前Owner不等于issuer的旧委托。

key+store允许外部public_transfer，无法自动运行自定义清理。仅issuer校验可阻止新Owner期间使用旧委托，却不能保证转回旧Owner时永不复活。必须在A记录作产品决定：A) v1自由可转，额外委托限定受支持交接路径并明确其他路径限制；B) 私密委托能力采用所有交接可控制的profile并验证每个容器/市场路径。未决定及验证前，不上线宣称“任意转让必永久清委托”的能力。已经解密的明文不能远程收回。

## 权限登记与控制

设计登记模板列：网络/包/对象/Cap、入口、实际Owner、产品范围、最大影响、管理成员/门槛、升级约束、timelock、pause、资产锁、撤销/恢复/退出、读回与监控。实际Owner及ID留空且状态“待部署读回”；不能把角色岗位名当已创建多签。

产品控制资产、发行Cap、Fee/Treasury、UpgradeCap、紧急Pause、内容续期/Seal策略、前端发布权分开梳理。审核所有直接/间接路径，包括UpgradeCap重新扩权、Cap转移/共享、调用其他包的wrapper、旧包版本继续可调用。

多签≠时间锁≠升级policy≠永久immutable≠资产锁≠pause。候选逐包选择compatibility/additive/dependency-only等具体政策并核对应framework；永久撤销升级能力是不可逆动作，不能在准备阶段执行。Pause应精确列受影响操作与用户取出/取消/退出能否继续。

## 审查及审计包

提供准确commit、包/依赖lock与bytecode摘要、布局/入口/Cap/状态、资金流、invariants、测试/负例、异常与退出、已知风险和变更范围。独立审查记录实际人/范围/候选/结论；高风险发现需修复或正式记录允许的有限范围，不用“接受风险”冒充修复。审计后每个diff重新判断影响；任何“审计通过”须可读报告和准确覆盖版本。

依据：[Sui生产准备](https://docs.sui.io/develop/production-readiness)、[Sui升级](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)。

---

# 经济规则、资金流与对账

当前金融适用范围是数字资产发行、付费资格、组件/组合成交、费用与Treasury。无借贷/Oracle/清算/YBT等新承诺。所有费率/币种/限额/供给/赞助预算未决，执行前填准确值。

## 业务资金与权利

Maker/Pack付费购买的是明确使用资格；产品控制权交易、Complete发行费用、可交易组件购买、Soul整套购买分别报价，不能重复收取或混淆对应权利。Pack三政策FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER对应不同资格核验，与三组件权利独立。

quote固定network、CoinType、price整数、decimals来源、收费项/收款人、feeSnapshot/version、供给/cap、attempt、expiry、对应Maker/Pack/Soul/Item/revision/hash。前端显示金额=整数÷10^decimals，仅展示用小数；资金计算不采用JS浮点。

## 分账与守恒

以某笔实际gross整数G、已定费率分母D/费率r为例，平台费F=floor(G*r/D)，剩余N=G−F；若多接收者，逐项按已固定舍入规则计算并将余数明确分配给指定接收者。F≤G，所有收入之和=G；0、最小单位、上限/溢出、不同CoinType与无效decimals需测试。此为候选规则，不是已决定费率或已部署结算。

交易支付收入与用户网络gas分开，不把用户gas当平台收入。资金明细登记所有成功/失败/取消/未知attempt，成功effects之后计已结算；退款/补偿必须独立授权与可验证digest，不能把链上不可逆成交称可回滚。

## 对账粒度

按network+CoinType+Treasury/收款对象范围计算：期末=期初+收入−支出。Object拆分/合并Coin要读balance与effects，不仅看单Coin ID；按digest/checkpoint去重。账本每行关联order/attempt/quote、收费项、root/Item/Maker/Pack、状态、expected/actual金额、收款/支出、差异原因和负责人。

链上账与业务账核对；索引落后/未知交易标临时差异，先查原digest/effects再补录，不重收费。Bound与Reference不作为可独售库存计价；已装Free是否随售按准确清单核对。

## 预算及持续管理

部署/初始化/测试Gas、Walrus保存/续期、Seal/RPC、索引、赞助交易分别预算，记录CoinType、额度、审批依据与实际支出。赞助方设置实际速率/额度/允许动作，防重放和刷费用；预算未定不启用。

经济指标：Complete成功/收费准确率、重复扣款、quote失效率、成交与拆装成功率、对账差异、内容到期与成本。真实窗口/数据源/分母在运行门禁前填，不编造GMV/APY。

---

# 用户旅程、测试素材与验收方案

新版本37条旅程全部Not run；执行顺序以Slack“顺序”和总入口序号为准。已有研究10/10只证明当时研究候选，不覆盖最新三权利与生产支付/视觉/安全。

## 逐步执行顺序

J01–13 Creator：身份→新建/导入→Parts/Style→Layer/Color/Rules→Info/Configuration→Commerce→Player Test/Outputs→草稿/历史/ZIP/冷恢复→Preflight→发布读回→Pack→Composable Items→生命周期/版本。

J14–20 Player：Plaza/详情→公开Maker→付费Maker与再次进入→三类Pack获取/切换→Composable→Complete报价/资格/cap→发行和同attempt恢复。

J21–26 Soul：同作品接收→三权利装配→视觉/微调→替换/卸下→跨Maker/Soul→Loadouts/Showcase。

J27–31 市场与隐私：Maker/Pack控制权→Soul本体→整套混合出售→买家拆分/组件独售/再组合→读取/委托/交接。J32–37：Physical→账号/集合/社区→桌面移动第三方→贯穿失败恢复→准确正式部署冒烟→运行对账反馈。

完整步骤保持原Slack37条，不复制并创建第二套执行记录。

## 素材与身份

设计矩阵：Maker A1024方形+B不同画布真实Maker；公开/付费；Pack FREE/PAID/INCLUDED；各含引用/Bound/Free固定Style；真实独立Creator、玩家A、买家B、无资格C；钱包/Kiosk/认证容器。真实B/新版本部署/身份资格/预算待准备，当前不会用旧生产签名会话跑测试。

已复制F02素材到原型assets并按hash登记，标demo_only。这只是UI评审素材，不是新三权利Maker已发布或跨Maker视觉通过。新增fixture发布必须带准确sourceHash/version/license与预期渲染。

## 各层验收

Move：不变量、异常/越权、资产/资金守恒、供给并发、旧revision/quote、attempt重复、Bound非法退出、Free原ID、整套范围/清委托。SDK：schema/BCS版本、错误映射、对象依赖/manifest、effects读回与冷恢复。Renderer：两真实Maker黄金图、多片/透明padding/color/anchor/微调/Outputs。端到端：按原用户操作、真实钱包与费用、准确候选执行37步。

失败分支附原步骤：用户取消；RPC超时/未知；实际已成功而UI未知；跨设备/重开；钱包切换；过期资格/quote；断网/缺内容/hash错误；不兼容Adapter；同槽替换/并发修改；cap争抢；授权撤销/过期；买家后续拆装；旧Owner试读。

每次记录candidate/network/Renderer/身份、前置对象与资格、预期/实际、attempt/tx/checkpoint/费用、图片或effects、结果、Bug及剩余项。准备模板≠测试通过。失败回原Bug；复验同原操作，不删除边界来迁就实现。

---

# 敏捷、DevOps与发布流程

沿OPERATING_MODEL §8及手册v1.0 §§1–4/5/7/8.3/8.4/9/10/11/12；状态与阶段分开。既有负责人、产品里程碑和原Bug记录不变。

## Sprint合同

一轮优先一个用户结果。Ready：准确需求/权利/收费、输入输出/失败恢复、Owner/依赖、候选环境和验收明确。故事关联F/C/E/A/J及R/D，不建第二开发看板。每日更新当前阶段、实际证据、阻碍和下一步；Review演示可操作用户结果；回顾形成少量可验证改进。未估算前不承诺日期。

Done范围必须明确：源码实现、已测试、已发布、已部署、已采用分别证据。准备文档与现前端映射仅Done文档范围。R1–R7未开始；用户开工确认前不写生产代码。

## 八阶段及证据

|阶段|必要输入/产物|退出条件|
|  ---  |  ---  |  ---  |
|Plan|当前规则、UX、接口、威胁/资金/视觉、fixture、验收|G0确认；相应故事Ready|
|Code|隔离worktree、准确源码/依赖锁、方案映射|peer review及接口/不变量实现证据|
|Build|固定工具链、Move/framework/SDK/render依赖、双站制品hash|可重复构建及完整candidate manifest|
|Test|相关Move/SDK/视觉/资金/权限/原旅程、Bug|对应门禁实测通过；差异已处理|
|Release|准确commit/包bytecode/SDK/AC/SO组合、审查报告、权限和预算|审计覆盖/候选差异/回滚退出明确|
|Deploy|目标网络、付费/签名授权、发布与初始化顺序|digest+package/object/Cap/配置读回|
|Operate|原旅程冒烟、support/对账/依赖续期、事故手册|实际Owner接管和资金/内容检查|
|Monitor|数据源/窗口/阈值/响应者、告警演练|真告警/恢复及运行报告，不是“配置存在”|


## 候选与CI/CD设计

以SO隔离基线0cfb60a29b2b378dd9fbf31970b324b2ef2e301e和AC行为来源65b4218012b54c37966a5ad88e803a9d66185ff4为输入；未来源commit与dirty范围要重新记。Move test/build、各包实际package scripts、frontend build、schema/BCS集成和需要的视觉测试按准确仓结构执行，记录完整命令/exitcode/制品hash。现在不伪造CI已连接、testnet部署或监控自动化。

testnet验证使用隔离身份与预算，mainnet候选固定同一组合配置。选框架/RPC/Walrus/Seal/SDK版本、保存期限和网络对象ID，不能用latest作为发布身份。SBOM从实际lock/制品产生，安全依赖检查与构建供应链审查附release。

## 发布与切换步骤

1. 固定源码/依赖/制品并审查版本；确认所有所需门禁与资金/签名授权。
2. 准备network/package/module/ABI配置与新发布路径，不覆盖旧资产/旧Owner的CURRENT。
3. 发布新包；按实际依赖初始化对象、Cap/产品/收费配置；逐项读回真实Owner和数值。
4. SDK＋AC＋SO引用同候选配置；校验域名/制品hash和交易payload，避免一站新一站旧。
5. 隔离身份跑适用37步/上线冒烟，核付款收款/发行/装卸/权限/市场；失败不宣称上线成功。
6. 在明确切换授权下正式入口启用；保留旧访问/说明及故障路径；运行监控和对账。

前端回退不撤销已部署包或已成交资产；链上失败必须按具体修复/新部署/授权退出方案处理。新包init与升级行为不可混淆；升级旧包是否满足policy另行验证。

2026-10-07范围复核：UI权威是现网站；禁止以另做HTML/Penpot交互改变页面结构或操作路径。按02_UIUX_CN.md逐页映射并回归原旅程；当前仍Plan，等待用户明确开工。

---

# 上线运行、监控与故障恢复

状态：准备设计；没有新告警/自动对账/轮值部署。责任沿HARBOR、SENTINEL、ECHO和原产品Owner；具体人、联系方式/时区/备份与预算在上线前确认，不写虚构oncall。

## 最低生产承接

真实package/object/Cap Owner、域名/双站制品/SDK配置、RPC/indexer、Walrus期限/完整性/续期余额、Seal策略/服务器、资金账/费率、依赖版本、恢复手册、支持入口、服务Owner与告警接收者。管理脚本、CI、RPC、索引和Seal不等于新增自有业务后端承诺。

监控登记每项：用户结果、数据源、查询/规则版本、网络/候选、观察窗口、阈值依据、等级、负责人/备份、通知渠道授权、对应runbook、演练时间/结果。阈值先用测试/基线标定，不随意填“99.9%上线SLO”。

最低项：Complete失败/延迟/重复发行扣费；装卸/绑定异常；视觉内容缺失/hash不符；成交清单/支付/Grant不一致；Treasury对账差异/异常管理操作；quote/cap失效；RPC/indexer落后；Walrus到期/续期；Seal拒绝/过期委托；构建/域名配置偏离；赞助Gas成本超预算。当前贷款/Oracle告警不适用。

## 事故动作

识别实际影响→原Bug登记SEV/环境/候选/资产资金/发现时间→指定Owner→在既有授权内隔离受影响动作→保存digest/effects/清单/配置与必要日志→修复或退出→对账/权限及原用户操作复验→经授权告知受影响用户→复盘回原研发项。私钥/token/私密用户素材不进入Slack证据。

未知交易：保存attempt/digest；查询effects与目标对象；已成功读回成功，不再付款；确定失败才按同业务attempt恢复；暂不可判定保持待查询。钱包取消不算已上链，不创建虚假成功对象。

内容不可用：保留准确引用与hash，验证保存期限/RPC/Seal；区分不存在、过期、无权、完整性错；不把未验证替代图当原作品。授权失陷：先明确影响Cap/Grant/用户范围和能撤销路径，再在已授权范围内执行；没有pause就不宣称能全局冻结。

前端事故：核域名/CDN/制品/transaction payload与收款，停止分发损坏候选，恢复可验证制品；链上完成的交易不能由前端回退撤销。市场事故：区分新上架、成交、取消、取出能力，最小范围限制与用户退出按真实合约支持验证。

## 演练与交接

上线前演练RPC未知、重复attempt、内容到期/缺失、Seal授权撤销、错误配置、单站候选不匹配、Treasury差异和Cap异常。记录发现→响应→恢复耗时及真实结果；不通过则对应门禁未完成。

运行报告写真实观测窗口/样本/成交及失败/费用/对账/内容续期/告警与剩余风险；用户反馈回原DEV/BUG。退出方案包括取消Listing、取出可交易组件、读取/导出允许内容、继续旧访问的适用范围；Bound仍随Soul，已解密内容无法收回。

---

# 开工前工程评审记录

附DOF-001～014及R0，不建并行任务板。手册v1.0（2026-10-06），适用§§1–4/5/6当前支付部分/7/8.3/8.4/9/10/11/12。

工作结果：准备需求、UIUX、对象/视觉接口、安全/资金模型、测试、发布运维文件及关联Slack。当前Plan；生产实现/审计/部署未开始。Owner沿既有领域职责，独立审查者尚未实际指派/执行。

|检查域|适用性|当前证据|剩余检查|
|  ---  |  ---  |  ---  |  ---  |
|产品/敏捷|适用|需求基线、十标签、37旅程、DoR/DoD与门禁|用户审阅/开工确认、真实迭代与演示|
|DevOps|适用|流程、release模板、隔离worktree|构建/CI/候选/部署/恢复真实运行|
|支付/经济|适用|三轴权利与quote/整数分账/对账合同|真实费率/CoinType/预算/供给及压力测试|
|共用安全|适用|威胁/不变量/权限矩阵/审查模板|生产候选独立复核/适用审计与整改|
|Sui|适用|key+store/DOF/Bound记录/Free退出设计|Move布局、容器、Kiosk、module/UID/Cap验证|
|EVM|当前实现不适用|RMRK/EIP作为研究参考，不引入EVM路线|无当前EVM部署验收|
|治理/锁|适用|区分升级、多签、timelock、pause、资产锁|实际Owner/策略/路径/恢复链上读回|
|运行/退出|适用|告警、事故、内容与预算计划|真实数据源/窗口/阈值/Owner和演练|


## 明确待定，不冒充工程论证已通过

A-private：任意自由转移与永不复活的第三方私密委托撤销无法仅用无钩子的key+store保证。先做owner读取/支持成交清Grant；完整委托能力按用户确认的profile落地。A-visual：第二真实Maker、定点精度、Adapter与Renderer一致性需R1验证。A-authority：实际Cap持有人/多签成员/升级policy/暂停与退出须生产候选决定。A-economics：报价币种/费率/供给/预算未填，不做有费用实测。

这些待定项附已有A/C/E记录，阻止相应功能/生产放行；不会把准备文档写成已通过审计或已部署控制。开工确认后优先实现无资金外发的最小组合/真实视觉验证，再逐门禁完成，发生重大选择回产品Owner评审。

## 当前授权与下一步

用户要求“先搞定前期文件流程，然后确认开始重构”。当前只写准备文档/现前端逐页核对/Slack记录，未签名/花费/提交/push。完成准备包后请求用户确认；未收到明确同意前不修改生产源码。

2026-10-07范围复核：UI权威是现网站；禁止以另做HTML/Penpot交互改变页面结构或操作路径。按02_UIUX_CN.md逐页映射并回归原旅程；当前仍Plan，等待用户明确开工。

---

# 既有原型工具与本轮设计交接

原型主要工具是Penpot；早期Figma作过视觉比较，后续因当时工具额度限制迁到Penpot。此结论来自实际本地收据与交接，不是推测当前套餐限制。

## 已有资料

* 项目交接：`docs/codex/handoffs/20261005-penpot-design-migration.md`。
* 本地设计目录：`/Users/naoer/Documents/Codex/2026-10-05/soulidity-prototype-assessment/`。
* 可编辑基线：`outputs/animacraft-soulidity-design.penpot`。
* 导入/工具收据：`outputs/prototype/penpot-receipt.json`和`figma-receipt.json`。
* 原生构造流程：`work/penpot/build-native.py`；原型HTML、优化稿及基线对照亦保留。
* [已有Penpot云文件](https://design.penpot.app/#/workspace?team-id=7eed092c-bad6-802e-8008-be6332a485e5&file-id=7eed092c-bad6-802e-8008-be663a5caa00&page-id=59a27626-3e2c-4f71-86d5-6f492f96b105)。

既有收据记36屏+封面、3343文本/9089矩形、部分编辑/导航已验证。团队协作迁移、命名基线与最终导出未完成；旧迁移因并发Chrome使用暂停/阻断。本轮不操作该Chrome/钱包，也不把旧工作改成完成。

## 当前施工依据与历史文件处置

用户2026-10-07明确纠正：施工依据只取现在的网站真实前端，保留页面结构和操作路径，替换底层合约并理顺必要UIUX细节。逐页记录见现前端核对。Penpot仅解释过去使用过哪个工具；历史37画板不能凌驾现网站。

本轮另做的 `output/soul-dof-v1-preparation/uiux/index.html`、六视图截图和 `soul-dof-v1-review-candidate.penpot`（44画板）均标记为 **Superseded / 不作为施工或验收依据**。原37画板和新文件保留作为历史记录，不删除、不继续云导入/编辑，不将云原型验证设成当前开工门禁。

此前上传的v1/v2 ZIP含这些偏离范围的交互草稿，属于历史包，不能作为最新施工材料。最新依据是当前Slack Canvas及本地准备文件。既有Penpot迁移状态不变，原生产会话不操作。

## 下一步

继续审阅现前端逐页接口与最小差异，明确未实站执行的权限/交易场景。只有用户明确确认开工后，才在现有页面/组件内接入新合约与SDK；不得恢复独立新交互原型作为主线。

## 历史附件与当前入口

此前上传ZIP v1/v2、Creator/Wardrobe/Market模拟截图及44画板Penpot是历史文件，已退出施工和验收依据；不能沿其新交互开工。当前依据为本Canvas及02_UIUX_CN.md，实站记录在output/soul-dof-v1-preparation/current-frontend/。不继续新原型云导入。

模板仍用于发布、旅程、权限、对账、安全、监控、素材和迭代证据；Not run不代表通过。所有开发等待明确开工。
