# 现网站前端逐页核对与最小接入差异

2026-10-07，Plan / R0。**施工依据是现在的网站真实前端。保留页面结构、现有组件、工具弹层、操作路径和用户旅程；替换底层合约、对象读取、SDK与交易逻辑，只标注新合约接入、三类组件权利、装卸、微调和出售清单需要的细节调整。** 另做的HTML交互、Penpot增量及其截图已退出施工和验收依据，不要求导入或继续完善。重构未开始，等待用户明确开工。

## 基线与核对证据

- Animacraft正式站：https://animacraft.soulidity.ai/ 。当前行为源 `tmp/bug005-publication-recovery`，commit `65b4218012b54c37966a5ad88e803a9d66185ff4`，下文缩写 AC。
- Soulidity正式站：https://www.soulidity.ai/ 。源码基线 `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`，commit `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`，下文缩写 SO。该隔离目录只读核对，仍保持干净。
- 2026-10-07用独立IAB会话只读观察：AC广场、已发布Maker详情、Creator库、既有稿件Parts & Items和其余九工具、Player test；SO Market的Souls与Components。没有创建或修改Maker内容、购买、Complete、链上装卸、授权或签名；原生产Chrome/OKX会话未操作。
- Creator实际是Parts & Items主工作区加其余工具弹层；关闭返回原工作区。不得用新原型的页面切换替代此结构。
- 原站DOM记录和实站截图保存在 `output/soul-dof-v1-preparation/current-frontend/`。Creator观察对象为既有本地稿件S13-EXPORT-SIZE-PROBE，不代表新协议素材。Player test的Complete因未发布而禁用；公开Maker详情的Start making未在当次观察即时显示Player，随后用既有Creator的Player test核实原界面。SO市场当前读取完成后无可见Soul挂单；旧Soul详情在此独立会话未呈现工作区。**下表S=准确基线源码核对，L=本次实站观察；S不能写成持有人操作或交易已经线上验收。**

## 页面、原操作与新接口映射

每行保留原入口和返回路径；“底层接入”是设计目标，不是已冻结的生产ABI。出现未列出的新增路由、重排导航、换掉整个面板或另造交易向导，先判为范围偏离，不得自行实施。

| ID／现有页面或区块 | 核对／现有源码 | 保留的操作与结构 | 底层接入差异 | 仅必要UI细节 | 原旅程 |
| --- | --- | --- | --- | --- | --- |
| U01 广场 `#templates` | L/S；AC `original-product-app.js` | 搜索、筛选、Maker卡、View Maker、Start making | 新发布目录、生命周期、资格与manifest读取 | 权利/访问摘要；明确加载、空结果、不可用状态 | J14–17 |
| U02 Maker详情 `#template` | L/S；同上 | 封面、作者、许可、Parts统计、开始按钮、返回广场 | 准确Maker/Pack发布版本和使用资格 | 三权利摘要与付费获取范围说明 | J14–17 |
| U03 Creator库 `#creator` | L/S；同上、`maker-v8-workspace.js` | 新建、Preview/Manage/Edit、Draft Recovery | 新产品控制对象、生命周期与恢复记录 | 新版本状态/错误文案；不新建管理导航 | J01/02/08/13 |
| U04 Parts & Items主工作区 | L/S；AC `maker-workspace-v8-view.js`、`maker-v8-creator-style.js` | 左Part、中画布/Item/Style、右Inspector；坐标/锁/样式；原工具栏 | 固定Style内容、来源/权利/scene版本输出 | 在已有Item/Style设置处声明引用/绑定OC/可自由交易；发布后权利不可静默改 | J03/07/12 |
| U05 Maker Info工具弹层 | L/S；AC `maker-workspace-v8-view.js` | 名称、封面、介绍、许可、画布元信息；关闭返回 | 新Core genesis与发布manifest元信息 | 准确许可版本提示；不搬迁字段 | J05/10 |
| U06 Layer Tracks工具弹层 | L/S；同上、`maker-v8-render-core.js` | back→front层序、多片渲染、选Style定位 | 确定Renderer/Representation/Track承诺 | 兼容校验错误就地显示；不把多片变多件 | J04/07/23 |
| U07 Smart Color工具弹层 | L/S；同上、`maker-v8-player-colors.js` | 颜色通道、Style关联、联动 | 已声明色域/通道及Composition颜色保存 | 越界限制和恢复默认说明 | J04/07/23 |
| U08 Rules工具弹层 | L/S；同上、`maker-v8-player-recipe-constraints.js` | 冲突/依赖、Random和Preflight共用约束 | 每Part最多一个固定Style单位、新槽位准入 | 指明冲突位置/解决方式；不新增Part多选 | J04/07/18 |
| U09 Expansion Packs工具弹层／子项目 | L/S；AC view、`maker-v8-pack-controller.js`、`maker-v8-pack-authoring.js` | 绑定父Maker的独立Pack项目、锁定父快照、发布/生命周期 | 新Pack控制、版本、资格、组件发行政策 | 保留FREE/PAID/INCLUDED；组件权利单列；付费不等于组件独售权 | J11/13/17 |
| U10 Composable Items工具弹层 | L/S；AC view、`maker-v8-composable-controller.js` | 当前卡槽设置、External产品、目标Maker、上传历史 | SlotSchema/Adapter、发行来源证明、实际可交易Item | 用逐内容三权利取代笼统资产化开关含义；已有列表增加准确兼容/去向信息 | J12/18/25 |
| U11 Commerce & Rights工具弹层 | L/S；AC view、`maker-v8-market-controller.js` | Maker访问、Complete策略/cap、价格和分账区块 | 新quote/feeSnapshot、结算和许可版本 | 使用权、产品控制、组件权利分别说明；费用仍在原报价位置 | J06/16/19/27 |
| U12 Soul Configuration工具弹层 | L/S；AC view | 原人格/记忆/技能文档列表、编辑、验证、默认恢复 | SoulCore及扩展内容manifest、Seal策略 | 根格式/内容版本校验；不把DOF术语放进玩家必经路径 | J05/20/31 |
| U13 Preflight／发布Review | L/S工具、S发布；AC view、`maker-v8-publication-controller.js` | 现有检查、Review、发布步骤、Resume与读回 | 新发行/权利/适配清单、包/对象读回 | 校验失败跳回原字段；显示准确发行方式和预算 | J09/10/12/35 |
| U14 保存／历史／ZIP／Outputs | L工具栏/S执行；AC `maker-v8-project-zip.js`、`maker-v8-local-player-store.js` | 原草稿、Undo/Redo、历史、导入导出、多Outputs | 新schema序列化与准确来源/recipe | 新版本标识、不可读schema提示；保留原恢复入口 | J07/08/35 |
| U15 Player `#make` | L/S；AC `maker-player-v8-view.js`、`maker-v8-player-controller.js` | 原预览、Part/Item/Style单选、Palette、Random/Reset、Info、配置和导出 | 当前选择编译为固定Style配方；新资格与Adapter校验 | 选择旁权利徽标/不兼容原因；不改主选择模型 | J15–18/23 |
| U16 Player Pack／外部组件 | S；AC `maker-v8-player-journey.js`、player view | 原Pack启用/使用与组件选择区块 | 资格与资产所有权分开；原子占槽/替换 | 费用/权利及替换去向提示；不另造库存页 | J17/18/25 |
| U17 Complete／预览导出 | L禁用入口/S有效流程；AC player view/controller、`maker-v8-player-protocol.js` | 原Recipe JSON、Preview & export、Complete、报价/恢复 | 同attempt生成Soul+各Part准确选择；仅TRANSFERABLE发对象 | 原确认内增加生成清单/三权利结果/报价有效期；不新增Complete向导 | J19–21/35 |
| U18 Soul详情 `/souls/[id]`／Info | S；SO `web/app/souls/[id]/page.tsx`、`native-original-preview.tsx` | 原封面、来源、Info、所有者、详情导航和出售入口 | 新Soul根/DOF Core/Composition/Display读取 | 准确来源/revision、原作与当前外观区分；旧资产不伪装新格式 | J21/28/34 |
| U19 Soul详情内Wardrobe | S；SO `web/components/souls/native-wardrobe.tsx`、`use-native-equipment-actions.ts` | 原Wardrobe标签、槽位列表、选件、Equip/Replace/Remove、预览和恢复 | REFERENCE清选择；SOUL_BOUND只卸显示；TRANSFERABLE attach/detach原ID | 就地显示权利/占槽/去向；绑定OC可恢复原Soul、自由组件取下返钱包；不新增顶级Wardrobe页面 | J22/24/25 |
| U20 Wardrobe内微调／预览 | S原预览；SO `native-equipment-preview.tsx`、`native-current-appearance.tsx` | 保留当前预览与原操作位置 | Adapter与Creator范围、layout/recipeHash/revision保存 | 在原选件/预览旁最小增加受约束调整与恢复默认；新增控件需实页标注，未声称已有完整Player微调 | J23/25 |
| U21 Wardrobe内Loadouts／Showcase | S；SO `native-loadouts.tsx`、`use-native-loadouts.ts` | 保存/命名/查看/应用及原展示位置 | 准确配方/权利/内容版本；应用须重核对象与许可 | 缺件/过期/不兼容原位提示；Loadout记录不虚构资产所有权 | J26 |
| U22 Soul详情 Persona Sprite／Skills／Memory | S；SO detail page | 原内容标签、追加版本、读取/授权入口 | Core/扩展DOF、Walrus/Seal、当前持有与容器校验 | 内容版本/读取错误/能力限制说明 | J31 |
| U23 Soul详情 Grants | S；SO detail page、`web/lib/hooks/use-grant.ts` | 原授权、scope、expiry、撤销区块 | DOF授权模块、issuer、持有校验、支持成交清Grant | 再授权提示与真实转移限制；不新建Permissions导航 | J31 |
| U24 Market `/market` | L/S；SO `web/app/market/page.tsx`、`equipment-market-browser.tsx` | 原Souls/Collections/Components、筛选/分页/扫描/卡片 | 新列表发现、清单、准确owner/DOF读取 | 卡片显示组合范围摘要；Components只列可独售对象 | J28–30/33 |
| U25 Soul上架 `/souls/[id]/sell` | S；SO sell page、`use-native-market-list-actions.ts` | 原价格页→授权确认→成功/恢复 | 替换旧强制卸装路径：整套清单冻结revision；保留自由组件时先detach再生成清单 | 在现有Selected sale scope增加准确随售范围；不得沿用“全部装备都留卖家”旧文案 | J28/29/35 |
| U26 上架确认／成功／取消／改价 | S；SO sell/authorize及success page、`native-delist-modal.tsx`、`native-update-price-modal.tsx` | 原报价确认、原弹层和失败恢复 | manifestHash/quote锁定；取消/并发校验；supported成交原子清Grant | 同清单核对：根/必要模块/全部Bound含卸下/已装自由组件；钱包未装不包含 | J28/29/35 |
| U27 买入 `/souls/[id]/buy` | S；SO buy page、`use-native-market-buy-actions.ts` | 原详情→买入确认→持有详情 | 原子付款/清旧Grant/根及随附交接；买家DOF读回 | 买入确认内显示同一清单，接收后可取下自由组件；Bound仍归同Soul | J29/30/31 |
| U28 组件独售／产品控制交易 | L组件市场/S其余；SO `equipment-market-panel.tsx`；AC market controller | 原组件交易面板与产品控制入口 | 仅自由Item独售；Maker/Pack控制不接管Soul/Pass | 交易对象/控制权/使用权明确；引用和Bound不得出现独售按钮 | J27/30 |
| U29 My Souls／集合／账号／社区 | S；SO `web/app/my-souls/page.tsx`、collections/profile/community | 原列表、详情、收藏/集合/账号路径 | 新Soul发现/集合/Display读取，保留既有授权检查 | 必要类型/加载/版本状态；无重排社区及资产导航 | J33/34 |
| U30 Physical／跨设备／失败恢复 | S；AC original app/controller；SO hooks/recovery组件 | 原Physical分支、桌面/移动入口、取消与恢复 | 新receipt/consume、交易effects、同attempt查询 | 未知先查链；原选择/草稿保留；不盲重扣；原适配断点回归 | J32/34–37 |

## 五类最小调整的验收边界

1. 新合约接入：同一候选包/类型来源/对象/manifest；不因ABI变化改用户主路径。读取与签名均重核当前owner、资格、revision和quote。
2. 三权利：Creator在现有编辑区域声明准确发布政策，Player在原选择与Complete确认看到真实结果。价格政策与组件交易权分开。
3. 装卸：原Wardrobe按钮按权利执行。引用没有返钱包资产；绑定OC卸下仍属于本Soul且能恢复；自由组件取下原ID返钱包。替换原子，失败不丢旧装配。
4. 微调：沿现有画布/预览和坐标语言，按Creator允许x/y、等比缩放、有限旋转与色域；不开放任意层序/遮罩/源图编辑。Creator原有完整创作Inspector不因玩家范围限制被删减。跨Maker必须先通过Adapter与许可校验；layout落到Composition，参考Renderer实际验证。
5. 出售清单：沿现有上架/确认/买入页。整套包含全部Bound（卸下也含）和已装自由组件；钱包未装不含。卖家需保留自由组件时先取下，再上架准确清单；成交时原子清旧委托，买家再授权。任意public_transfer的永久撤销限制继续如实记录。

## 开工后验收与当前未执行项

每项改动必须提供“原站页面/控件→源码→新读写接口→最小视觉差异→原J旅程”证据。先在现有组件上标注再实施；桌面/窄屏保留原导航、弹层关闭/返回、键盘和恢复路径，不把新模拟图当预期截图。两个真实Maker画布、精确素材/适配、有效Complete、持有人装卸、整套成交及私密授权均待新候选实际执行。37步继续Not run，生产代码与部署均未开始。
