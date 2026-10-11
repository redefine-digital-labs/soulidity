# Soulidity Phase Handoff: Asset standard v0.1 design

## Snapshot

- Created: 2026-10-07T08:13:22+03:00
- Phase: Asset standard v0.1 design
- Status: complete
- Goal: 定义简洁的资产核心与发行、组合扩展，映射既有 Maker、Pack、Composable Items 和 Soul 的实际持有及转让权利。
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (49 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-asset-standard-plan.md`

## Outcome

初始产出为 docs/SOULIDITY_ASSET_STANDARD_CN.md。最新用户已允许全新重构／部署并提出视觉匹配／微调要求；当前目标改为 docs/SOUL_DOF_V1_REBUILD_CN.md，旧保留类型／ID／兼容条件仅为历史。本地独立 DOF 原型通过 10 项 Move 测试与构建；完整标准及新画布仍未实现或部署，不改变主交付状态。最新边界与下一步见 [Soul DOF v1 视觉方案交接](2026-10-07-soul-dof-v1-visual-plan.md)。

## Scope and non-goals

### In scope

- 本地研发标准草案、原卡槽方案入口、官方资料核对；最新增量含隔离的最小 Move 研究原型和视觉设计。

### Intentionally not done

- 无生产产品代码／合约、链上写入、权限、支付、提交、PR、部署、外部消息、任务板或活动 Owner 变更；包含公开 Mainnet 只读观察、本地研究 Move 源码／测试与证据。

## Durable decisions

- 最新目标与原型见 [Soul DOF v1 全新规范](../../SOUL_DOF_V1_REBUILD_CN.md)及[最新交接](2026-10-07-soul-dof-v1-visual-plan.md)。用户允许完整重构／新部署，不需要旧版 ABI／ID／Pass 兼容；Soul key＋store 根、Core／Composition DOF 模块和真实 Item 原生持有。withdraw 保持原 ID，买入整套后可取出；10／10 Move 测试和生产模式构建通过，无链上部署。

- 最新视觉推荐：自动准确适配＋受约束画布微调；坐标、锚点依赖、轨道／遮挡、替换／叠加、Empty 及准确 renderer 版本均纳入标准。参数保存 Composition，整套转让随行，取出／换件／跨 Maker 不套用旧坐标。不新增配置资产种类；真实二维素材与跨客户端验证前置，尚未实现新画布或完成视觉验收。

以下保留历次讨论；其中“保留旧类型／ID”“兼容承接”由上述最新用户决定取代，不再约束新规范。

- 最新整体出售澄清已补标准§1.7：同一Soul明确支持单独出售（卸装留卖家）和整套出售（根＋真实DOF成员＋组合状态）两种交易形态，不增包装NFT／身份。未激活库存也随父交接，排除资产须先合法取出；仅引用的Maker／Pack、卖家Pass／授权不自动交接，买家使用许可需验证。清单／revision固定、上架禁改、成交原子核验／结算；原卡槽方案已明确普通出售旧规则的范围。仅设计，生产整体出售未实现。

- 最新“现有Soulidity需要什么”已补标准§1.6：保留根、新增Core／Composition及受控DOF接口、内容准确引用、组件原生归属、唯一装备权威、托管／授权／市场、SDK／Web／SoulDesk九层改造。SO定向11文件与正式master0cfb字节一致；Mainnet只读9对象确认UpgradeCap policy0、地址持有，实际三项TransferPolicy规则及原Soul Kiosk Lock=true。证据output/asset-standard-2026-10-07/current-soulidity-baseline.json。Cap存在已核验，候选兼容性／旧入口权限／组件承接／第三方容器符合性未验证；无实施或链上写入。

- 最新用户澄清是“基于DOF构建Soul”的整体组织方式。新增§1.5：稳定Soul根＋Core／Composition标准DOF模块＋ItemKey下真实组件＋版本化第三方Extension模块。模块内部小值仍可用DF；UID不等于独立可售资产。Root持有事实、Composition激活及来源／资格引用分别权威；旧共享状态通过准确引用承接，禁止新旧独立激活权威。现有Soul类型／ID保持优先，具体UID入口／包升级权限仍待核验；仅设计文档。

- 用户纠正“为何重写而不直接DF／DOF扩展”：第一优先保留现有Soul类型、布局和ID。源码Soul已key＋store，UID上已有不可变State指针DF；六组标准字段改为逻辑视图，映射既有字段、内容／来源和版本化扩展。补§1.4说明受控UID入口：当前无公开可变UID，须由定义模块提供命名空间及所有权证明接口；可能需要允许的包升级，不等于改struct／重铸。旧key-only Item、共享状态、权限／转移问题分别验证。升级权能否支持新增接口尚未核验；本轮无代码、签名、部署或迁移。

- 用户收敛第一标准对象为Soul：上游Maker／Pack供应定义与发行，下游视觉／功能／游戏等按Soul接入。新增§1.1–1.3确定Soul Core候选六组字段及key＋store优先，区分DOF持有、槽位激活、内容／资格引用；Soul既可容纳Item也可被第三方容器容纳。公共所有权不以重复owner缓存授予权利；通用存储／展示／高级授权分层符合。自由public_transfer不会自动清槽或撤销私密授权；现有受保护资产不在本轮释放。下一研发出口先Soul＋第三方组件／容器／Display／Kiosk最小原型，上游完整资产重构后置。仅文档，无合约或链上变更。

- abilities 澄清：key-only 不是全部资产默认；它仅适用于确切要求所有移动经过定义模块的类型。Composable Item 优先验证 key＋store＋DOF；父对象可为 key-only，DOF不要求父类型store。子资产被父持有时不能作为独立钱包输入直接转移，取出由父UID权限控制。共同AssetCore允许外层类型分开abilities；Kiosk及公共流通需求与全局钩子约束分别评审。

- 用户明确现有底层可能重构；不得把复用当前 Root／Cap、key／store 或引用＋锁当成目标方案前提。资产标准第7节已增加重构候选：共同 Asset<Kind> 类型族，Definition／共享发行状态／AccessPass 分离；Maker 产品控制由唯一交易资产证明，不再额外发行可独立售卖的控制权。目标优先评估 Item 的原生父子归属，资格选用继续引用。严格受控移动候选为 key-only＋Transfer-to-Object／自定义 Receiving＋typed SlotBinding；允许外部移动的 key＋store profile 可使用 DOF。Kiosk通用接口需要key＋store，必须明确取舍并做Move原型，不宣称新ABI已冻结或迁移已完成。兼容的是已有内容、权益和业务语义，具体旧类型／ID承接待核验。本轮无实现或链上变更。

- 已补资产类别／组合形态／当前状态矩阵：四类产品不随 Slot／Pack 排列增加类别；Maker 六种使用形态、Pack 两种形态、Soul 四种能力／装备状态明确。Maker/Pack 的槽位是定义，Soul 使用实际装备关系。合法采用 Pack 不转移其控制权，组合也不自动成为打包交易或新铸资产。相关母定义上限与资格沿用原政策。

- 用户补充确认：Maker 同时可供他人使用生成归其接收人的 OC／Soul，也可交易本体。标准已增加 usePolicyRef／transferPolicyRef 与双路径验收；Maker 转售不转移用户 Soul，不因控制轮次变化撤销原内容绑定的 MakerAccessPass。定向源码依据为 treasury_v8.move 的 MakerAccessPassV8。仅更新设计。

- 标准统一持有与转让契约，不铸造第二份包装资产；PRODUCT_CONTROL 与 INSTANCE_OWNERSHIP 必须明确。
- Composable Item 产品与发行实例分开识别；访问凭证不是产品控制资产；免费和收费不是资产身份。
- 发行与组合采用能力扩展；固定同一实例唯一占用及既有收费、卖 Soul 卸装留卖家规则。
- 手册v1.0共同章节1-4/9/12及7/8.3/8.4适用性已写入设计附件，所有实现检查待核验。

## Changed paths and assets

### Changed paths

- docs/SOULIDITY_ASSET_STANDARD_CN.md
- docs/ANIMACRAFT_SLOT_SYSTEM_PLAN_CN.md
- output/asset-standard-2026-10-07/current-soulidity-baseline.json

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 本地链接：2026-10-07增量后标准8处、原卡槽方案12处均存在；对象结构覆盖检查及diff空白检查 — PASS。此检查仅覆盖文档，不是Move构造或实现符合性验收。
- Soul优先增量：三份文档本地链接／逐行空白及Soul Core／DOF／所有权保证范围覆盖检查 — PASS。未编译Move、接入第三方市场或执行链上验证。
- 定向核对当前Maker/Pack/External产品Cap、实例锁、SoulState/adapter源码及官方Sui/ERC资料 — PASS
- Soulidity改造增量：11个定向文件字节匹配正式master0cfb、9个公开对象只读观察 — PASS；不是同一checkpoint快照、完整部署源码等价证明或标准符合性验收。
- 最后增量检查：标准10处／卡槽方案12处本地链接存在，三份文档逐行空白通过；证据中的State指针、原Soul→Item字段→Kiosk归属、Lock及PolicyCap关联通过。仅文档和现状证据检查；未编译或测试新协议。

## Risks and recovery

### Risks or blockers

- 未完整核对Treasury/收入交接与所有有效转移、旧入口和升级路径；不能宣称资产标准已符合或已部署。
- 当前BUG006由原执行聊天推进；设计不得覆盖其Owner、WIP、既有合同、用户草稿和生产对象。

### Recovery or rollback points

- 本轮只写两份文档及本交接，不使用--update-current；无需产品或链上回滚。

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
 M agent-management/README.md
 M agent-management/foundation/README.md
 M agent-management/foundation/ai-roles/brand-growth.md
 M agent-management/foundation/ai-roles/community.md
 M agent-management/foundation/alex.md
 M agent-management/foundation/ann.md
 M agent-management/foundation/head.md
 M agent-management/foundation/trinity.md
 M agent-management/foundation/wayne.md
 M agent-management/image-prompts.md
 M agent-management/labs/README.md
 M agent-management/labs/ai-roles/backend.md
 M agent-management/labs/ai-roles/cto.md
 M agent-management/labs/ai-roles/frontend.md
 M agent-management/labs/ai-roles/fullstack.md
 M agent-management/labs/ai-roles/pm.md
 M agent-management/labs/hunter.md
 M agent-management/milestones.md
 M agent-management/shared/bd-priorities.md
 M agent-management/shared/context-sync.md
 M agent-management/shared/decision-log.md
 M agent-management/soul-team.html
?? .pnpm-store/
?? AGENTS.md
?? agent-management/BUG_REVIEW.md
?? agent-management/EXECUTION_POLICY.md
?? agent-management/LIVE_PRODUCT_STATE.md
?? agent-management/M0_BASELINE.md
?? agent-management/OPERATING_MODEL.md
?? agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md
?? agent-management/agent-registry.json
?? agent-management/creator-registry.json
?? agent-management/creators/
?? agent-management/evidence/
?? agent-management/history/
?? agent-management/roles/
?? agent-management/runs/
... 9 additional status entries omitted
```

## Exact next action

沿既有产品评审先核对交易权利和对象归属，再以最小Move原型验证Asset／Definition分离、原生存入／借用／取回、清槽转售、失败回滚与Kiosk边界。原型及全部控制路径、Treasury／收益和旧类型承接证据通过后，才固定Schema、BCS、类型入口及符合性用例；当前活动Bug优先级继续由最新CURRENT决定。本交接完成仅指本地设计产出，不代表实施或主目标完成。
