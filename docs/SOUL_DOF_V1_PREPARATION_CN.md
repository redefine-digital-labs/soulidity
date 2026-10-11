# Soul DOF v1｜重构准备与施工总入口

# Soul DOF v1｜重构准备与施工总入口

# Soul DOF v1 重构准备与施工入口

2026-10-07 · Europe/Moscow。按用户最新纠正，施工依据为现在网站的真实前端；保留页面结构、组件、工具弹层和操作路径，仅标注新合约接入、三类组件权利、装卸、微调和出售清单细节。九张关联表157项、37步Not run及规格/流程保留；历史HTML/Penpot增量和含其内容的v1/v2 ZIP退出施工依据。仍Plan，未开始生产重构，等待用户明确开工；新生产验证/支付/审计/部署未执行。

## 九张表怎么配合

* [敏捷研发](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JBQ5JF6)：14项。
* [用户旅程](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4)：37步。
* [DevOps交付运行](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ79NS0)：8项。
* [合约生产与安全](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6ZG8FKC7)：15项。
* [重构里程碑](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA)：8项。
* [功能与接口覆盖](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C79JME6LD)：23项。
* [架构决策与风险](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C8991KJQ0)：11项。
* [经济规则与资金对账](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7GRQQFEV)：11项。
* [交付文件与上线门禁](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6ZRFR6VD)：30项文件/原型/证据。
* [原Bug表](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ)：继续用于真实缺陷/事故，不建立平行Bug板。

开发故事是工作状态权威；其余表是对应的流程、验收、接口、安全、决策和资金视图。依赖目前是人工维护，未配置自动排程或状态同步。用户旅程按“顺序”升序执行，Slack默认行排列不代表测试顺序。下方提供完整顺序入口。

## 核心对象与资产边界

Soul是key+store拥有型根对象。DOF保存Core/Composition/BoundParts/授权等标准模块和已装TRANSFERABLE Item；DF/Table表达内部参数与绑定记录。Free attach一笔完成来源/许可/适配/归属/绑定，detach返回原对象原ID到钱包，无通用未启用Free库存。Bound卸下只清显示绑定，记录永远留在所属Soul。引用不证明持有来源资产；整体交接不另发包装NFT。

Maker产品控制资产可以交易，但不接管玩家已生成的Soul；访问资格与产品所有权分开。Pack保留FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER，收费与组件独售权分开。只有Creator明确TRANSFERABLE的固定Style组件发行独立唯一Item；REFERENCE为许可内容引用，SOUL_BOUND为永久Soul绑定记录。Configuration、SlotBinding/Profile/Adapter/recipe默认数据或模块，不因UID自动可售。

### 用户最新纠正：每Part只能选一件

Player/Soul每Part最多一个Item；Complete时Style固定，该固定Style内容单位是最小装配单位一。Creator已发布的REFERENCE/SOUL_BOUND/TRANSFERABLE政策确定其发行和退出。保存全部Part/颜色/布局/Outputs；同一Style可依供给规则发行多个唯一实例，但每实例ID唯一。多RenderPiece不是多件装备；单Part多选/桥接要求已撤销。

本页Ref/Bound/Free分别简写REFERENCE/SOUL_BOUND/TRANSFERABLE；Free指自由交易组件，与价格政策FREE(免费)分开。产品UI使用“引用／绑定OC／可自由交易”说明。

### Creator三种发行方式

* REFERENCE：准确内容引用＋许可，没有独立钱包资产；清选择不返回对象。
* SOUL_BOUND：固定Style记录永久属于本Soul，可卸下/同Soul恢复；不返钱包、跨Soul或独售，随Soul整套交接。
* TRANSFERABLE：真实key+store唯一Item；attach即已装，detach原ID返钱包；可按许可独售/跨目标适配。

Bound不是向钱包交出一个写着bound_soul_id的自由对象；模块不提供此出口，保留键/记录准入及不可伪造发行证明需合约验证。Creator按准确发布版本选择，已发权利不得静默升降；付费访问不意味着源内容或组件出售权。

### 转让与私密授权

授权模块由Soul DOF持有，内部Grant用字段/Table。owner-only每次核真实持有及认证容器路径；scope/expiry/revoke明确。受支持出售合约强制原子清旧Grant＋支付＋交接，买家按自己权利再授权。key+store自由public_transfer不自动触发自定义清理；旧issuer不授权新owner，但转回原issuer可能使未清旧授权复活，若要求所有转移永久撤销须受控交接profile。已取得明文不能收回；生产路径待验证。

### 整套出售的准确范围

整套=根＋必要模块＋全部永久Soul绑定记录(即使已从画面卸下)＋当下已装Free Item＋准确配方/布局。钱包未装Free不随售，想保留已装Free先detach返钱包再上架。Ref不是源产品/卖家Pass；买家使用按准确许可核验。Bound不能通过卸下从出售范围排除。上架冻结revision/recipe/完整清单，付款/清旧委托/交接原子；取消不改变原权利。所谓单卖Soul本体只排除可取走的Free，必要模块/Bound不可分离，界面明确。

## 施工顺序与每轮验收

* [R0 重构前准备](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C8996SVUY)：九张表157项、文件/流程/现前端逐页映射可审阅；明确未验证项；等待用户开工确认。准备不等于生产通过
* [R1 标准Soul＋真实视觉最小闭环](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C6ZGE5D7Z)：两个不同画布Maker、Ref/Bound/Free混合最小Soul：准确初始外观→受约束微调→Free装卸原ID/跨Soul→Bound卸下重装仅原Soul→整体转移；边界/许可/容器/失败通过
* [R2 Creator Maker／Pack／Item可发布](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C79JSQWUD)：十标签/草稿/历史/ZIP/Outputs仍可用；Maker&Pack政策及逐Item/Style三权利发布读回；生命周期/控制交易/唯一Free发行/失败恢复通过
* [R3 Player Complete形成标准Soul](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C79JT130V)：Maker及三Pack政策/四Complete政策/cap/同attempt恢复；各Part固定Style，Ref/Bound/Free按许可生成；SO准确genesis读回；Physical原分支通过
* [R4 Wardrobe／私密／Loadout／第三方](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C7JJDCRQU)：三模式装卸边界：Ref清选择、Bound仅同Soul恢复、Free原ID钱包/跨Soul；Loadout/Showcase/微调；owner-only与成交清Grant/再授权；多端容器通过
* [R5 市场组合成交与拆分再流通](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C8997DPU0)：混合Soul整套含全部Bound记录和已装Free；Free单售/组件独售/批量/取消恢复；Bound不可取走独售；Ref许可清楚；原子清Grant+支付+交接
* [R6 完整候选新部署和原旅程验收](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C6ZGEPGGP)：同一候选mainnet包与初始化、SDK/双站配置/权限真实读回；完整37步中的上线部分及原操作验收；独立高风险审查有证据
* [R7 运行、监控与下一轮反馈](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JJ7BAMA?record_id=Rec0C7EP2DX0S)：真实对账/告警/故障演练/用户反馈返回原DEV/BUG；报告观测窗口/样本/费用；新自动化必须实际运行核验

R1优先做原生组合与真实视觉最小闭环，完整生产对象实现与两种Maker视觉验证相互迭代，避免合约全部写完才发现画布不能适配。后续依次验证Creator发布、Player Complete、Wardrobe和权限、市场，再发布准确组合候选。

## 敏捷与DevOps执行约定

沿既有每周迭代、两周组合评审；一个优先用户结果，限制同时开工，先完成验证再开新项。Ready要求：原操作、用户结果、接口输入输出、合法资格/收费、异常与恢复、依赖、Owner、验收和候选环境明确；关键设计歧义未解的故事继续Plan。

Done必须说明范围：实现、验证、上线、实际采用分别有证据。源码实现≠线上通过；本地研究原型≠新版本用户旅程通过。阶段与状态独立，每轮按适用Plan→Code→Build→Test→Release→Deploy→Operate→Monitor留下候选、环境、结果、剩余退出条件。

日常更新在原研发项/关联表，缺陷回原Bug。Sprint Review演示实际用户结果；回顾选少量可验证改进。未估算的日期标待估，不虚构上线日。CI/CD/告警/自动同步目前是待实施，不写已启用。

## 责任与资源

本重构任务Codex负责当前准备及后续授权范围内集成。沿既有领域岗位：IRIS产品与验收；CIPHER协议/架构；SABLE Creator/交互；LUQI内容与数据；FLUX SDK/集成；SENTINEL测试/发布审查；HARBOR构建/部署/运维；ECHO支持。角色记录不代表本次已经启动独立执行会话或创建账号。

高风险权限/资金/合约改动由具备能力的非实现者复核；内部QA不替代外部安全审计。尚未执行新生产审查/外部审计。实际多签成员、门槛、管理权限、升级限制、timelock、资产锁、pause和永久不可变必须逐包决策及链上读回；不由文档自动启用。

隔离SO worktree：/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity；准确基线0cfb60a29b2b378dd9fbf31970b324b2ef2e301e。AC行为来源65b4218012b54c37966a5ad88e803a9d66185ff4。当前准备不改旧BUG006 CURRENT/Owner，不操作其Chrome/OKX签名会话。

## DeFi生产管理的实际适用范围

经济规则表登记Maker/Pack资格、Complete政策/cap、交易费用和分账、Treasury有效权限、Gas/存储/赞助成本、异常账和指标口径。真实资金记录按network/CoinType/整数金额/精度、订单attempt、quote/feeSnapshot、收款/支出、digest/checkpoint、Soul/ItemID核对；期初＋收入－支出＝期末按币种与对象范围计算。

合约安全表兼作生产包/对象/Cap权限登记；DevOps表管理发布清单、依赖基础设施、故障恢复和观测；风险表记录架构/商业/权限边界。事故继续原Bug，关联影响金额/资产/环境/发现时间、隔离/恢复证据和责任，不将页面回退当链上撤销。

当前没有新增借贷/抵押/Oracle/清算/收益拆分/token激励承诺。只有真实引入这些产品时，再增加抵押参数、利率/清算、预言机、流动性、收益及激励分配等专用登记；不把通用DeFi模板当当前已实现路线图。

管理项参考[Sui生产准备](https://docs.sui.io/develop/production-readiness)及[Sui升级规范](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)，具体配置仍按Soulidity准确候选实施与核验。

## 测试素材、身份与异常分支

准备两个不同画布/锚点Maker，公开/付费Maker，FREE/PAID/INCLUDED Pack；每类包括Ref/Bound/Free固定Style单位。发行者、玩家A、买家B和未授权C登记真实环境/资格/预算；公开/保护素材、padding/颜色/遮挡/Empty/Bound卸下恢复/Free跨Soul。身份与原生产发布会话隔离。

开发中执行相关Move/SDK/内容许可/视觉/支付/权限验证；最终按下列既有旅程顺序贯穿。所有新版本旅程Not run，不继承旧测试通过。每步必须记录真实候选、身份/资格、预期/实际结果、签名/费用、对象/tx和失败恢复；发现阻断回原Bug，不跳步结案。

市场覆盖单售/批量/整套混合三种权利、Bound卸下仍随root、Free取下后可排除、钱包未装不随、取消/未知结果和买家Free拆分独售再装。所有权/许可/支付/清旧Grant原子核验。异常包括切钱包/跨标签/旧revision/内容和RPC故障/过期quote/并发cap/取消签名/已成功却前端未知/重试/冷恢复。

## 按顺序进入37步用户旅程

1. [J01 身份与Creator入口](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7GNZ0R7T)
2. [J02 新建Maker与导入](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CRVQAJJ)
3. [J03 Parts & Items与Style编辑](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL5GY3U)
4. [J04 Layer Tracks、Smart Color、Rules](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C896AL4GY)
5. [J05 Maker Info与Soul Configuration](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C6ZDHUYTH)
6. [J06 Commerce & Rights](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C896AH0GG)
7. [J07 Player Test与多个Outputs](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL5TF2N)
8. [J08 保存、历史、ZIP与冷恢复](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C79FX5GVB)
9. [J09 Preflight与发布Review](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C896B5ZBJ)
10. [J10 发布Maker并读回ACTIVE](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CRWG354)
11. [J11 Expansion Pack配置与发布](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7JFHLPHA)
12. [J12 Composable Items配置与发行](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL6J66N)
13. [J13 Maker／Pack生命周期与新版本](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7JFHSCCU)
14. [J14 Plaza发现与Maker详情](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL69WPL)
15. [J15 公开Maker游玩](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C896BR2BA)
16. [J16 付费Maker获取与重复进入](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C78J3QYHZ)
17. [J17 Pack获取、开关与实际使用](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL71KQS)
18. [J18 Player使用Composable Item](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7JFJDFNG)
19. [J19 Complete报价、政策与限额](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7EL7322W)
20. [J20 Complete创建与同尝试恢复](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CSJUX7G)
21. [J21 Soulidity接收与原作品展示](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7ELV9H50)
22. [J22 Wardrobe与三类组件装入](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C6ZE7DQ5D)
23. [J23 视觉适配与受约束微调](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CSKFS9L)
24. [J24 替换、卸下与三类权利退出](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CSKJU06)
25. [J25 跨Maker／跨Soul再装入](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7JG6NNN8)
26. [J26 Loadouts保存、查看、应用与Showcase](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C89709ZGQ)
27. [J27 Maker／Pack产品控制权交易](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C79GLN30D)
28. [J28 单独出售Soul本体](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C6ZE7FU4X)
29. [J29 整套出售Soul与买家接收](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7JG7131A)
30. [J30 买入整套后拆分、组件独售与再组合](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7GPPE3PB)
31. [J31 内容权限、委托与交接](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CSLG45U)
32. [J32 Physical发行、凭证、供给与consume](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7GPGP6LR)
33. [J33 账号、集合与最低社区功能](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7CSLN90W)
34. [J34 桌面、移动、跨设备与第三方容器](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C8971KAQY)
35. [J35 贯穿式异常与恢复复验](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7ELW3Y2E)
36. [J36 正式新部署与原旅程冒烟](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C6ZE8PD7H)
37. [J37 运行观察、对账与反馈](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C7JCB5AQ4?record_id=Rec0C7GPQJSN5)

## 已有证据与剩余工作

已有研究原型10/10 Move及生产模式构建，只证明当时部分持有/取出/整体转移/嵌套与无规则Kiosk路径。该原型包含旧deposit/activate分步模型，不能证明最新三权利、固定Style、原子attach/detach、Bound记录和出售清Grant已实现。新视觉/source-auth发行/USDC/许可/市场/治理/审计及mainnet旅程待实际验证。

本轮纠正为现网站逐页核对、原控件到新合约/SDK映射及必要细节标注。详见[现前端施工与文件评审](https://sega-xya5661.slack.com/docs/T08LQTJFZRS/F0C89LN2YAU)。AC十个Creator工具及Player、SO市场已只读观察；未呈现的Soul持有人/交易页面按准确源码标注，不能宣称实站验收。历史HTML/Penpot及ZIP退出依据；不再要求云原型验证。两真实Maker视觉、私密profile与准确费用/权限仍待实施门禁。用户未确认开工，R1–R7未开始。
