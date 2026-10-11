# 产品范围与需求基线

版本 prep-2026-10-07；Owner沿既有岗位。权威详细规则：[Soul DOF v1重构规范](../SOUL_DOF_V1_REBUILD_CN.md)。本文为开工评审摘要，用户最新三权利及单Part纠正优先于历史研究。

## 资产与形态

| 概念 | 拥有/交易内容 | 不自动包含 |
| --- | --- | --- |
| Maker | 产品控制资产；发布内容及允许生成OC的许可 | 玩家Soul所有权、任意素材转售权 |
| Expansion Pack | 产品控制与扩展内容；FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER使用政策 | 因付费而自动独立交易所有组件 |
| Soul | key+store根；必要模块、准确配方、永久绑定内容和已装真实组件 | 钱包内未装组件、卖家个人访问Pass |
| TRANSFERABLE Item | 固定Style、唯一实例ID、准确来源/许可；装入Soul或钱包持有 | 整个Maker的控制或版权 |
| REFERENCE / SOUL_BOUND | 内容引用 / 永久归属一个Soul的记录；随相应规则使用 | 自由钱包组件或独售权 |
| Configuration / Slot / Adapter | 数据或模块；除非另有产品明确授权，不作为独立可售资产 | 因有UID而自动金融化 |

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
