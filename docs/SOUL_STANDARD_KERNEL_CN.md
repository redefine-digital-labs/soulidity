# 独立 Soul 核心、OC 养成与嵌套组合

## 2026-10-10 施工方向校准：原子资产与外部能力

用户确认：标准层进一步标准化，Soul 尽量保持原子资产；新功能不必装进 Soul／卡槽，也可通过关联的独立资产、能力凭证或外部模块获得。以下是当前设计输入，不是已实现接口；后文历史候选的安装结构不能推导为所有功能必须安装。

- **最小核心**负责稳定资产身份、来源、所有权相关的受控入口，以及可选扩展的通用格式／发现／一致性；不写入 Maker、渠道、市场、游戏、收费或平台管理员的业务实现。各应用只消费其实际需要的最小契约。
- **三种组合按语义选择**：随 Soul 携带的状态使用内部 DOF；可独立转让／复用的资产使用外部关联；可撤销、有期限或受限的使用权由来源模块签发凭证并验证。DOF 是可选容纳或索引机制，不是功能存在的必要条件；不能为了“原子化”把全部凭证再强制塞进根。
- **持有主体必须明确**：钱包持有、Soul 内部持有、外部凭证绑定 Soul ID 是三种不同关系。钱包持有资产不会因同一地址拥有 Soul 就自动归属该 Soul；引用 ID 不证明拥有、许可或使用资格。规则必须说明依据当前持有人、稳定 Soul ID、授权代际还是实际托管关系生效。
- **生命周期由功能来源负责**：关联／解除、签发／接受、期限、撤销、所有权改变、出售／返回、暂停／退出分别定义。转移 Soul 不保证外部资产跟随；绑定 Soul ID 的资格也不必然赋予新持有人许可、解密或收益权。需要随售交付的资产与需要清理的授权由实际交易入口验证，不能以被动扩展的兼容承诺省略资金／许可／转移义务。
- **标准化格式，不统一业务权限**：命名空间、schema／版本、主体、来源、对象或凭证引用与可验证语义是接口设计候选；准确 ABI 在施工关口确认。来源真实性、资格和资金事实由实际来源入口证明。发现索引不是授权入口，不新增 Soulidity 中央注册批准或统一管理员；各模块保留自己的治理及升级责任。
- **兼容验收**：新增被动状态扩展或外部关联能力，旧市场的源码、依赖锁、配置和部署制品不变，原 Soul 可挂牌／取消／成交，强迫市场发布次数为0；另验凭证伪造、过期／撤销、换持有人、解除关联和替换应用。涉及结算或转移限制的扩展单独适配，不能归入被动兼容。

本次不删除原有 Ref／Bound／Free、部件、供给、付款、内容和退出职责，不把已确认随资产携带的权利改成钱包级资格。先沿原功能映射选择承载方式，再实现；尚无新的外部能力接口运行验收。Vault 是可选工具，按用户最新指示暂缓专项施工并保留待办与已有证据，不作为标准层解耦的前置项，也不宣称其完整交接已通过。


### 标准层细化确认：统一互操作契约（2026-10-10）

用户再次确认“标准层更好的标准化”。施工应先固定各模块共同消费的最小契约，让模块能够独立维护；不能把全部业务搬到标准仓。以下六项是标准职责划分，不是新增六个仓库，也不是六个已实现 ABI。

2026-10-11 再次确认沿用此方向。标准化以实际消费契约为单位：明确格式、证明入口、行为不变量和兼容范围；用来源仓的符合性测试与集成仓的跨模块验收证明。最小标准、可选标准和业务实现分别维护，各自的源码归属、发布版本与有效权限都要可核对。标准采用不产生平台管理权；标准升级也须按实际消费范围判定联动，不能默认要求生态全部仓同步发布。

| 标准职责 | 要统一的内容 | 留给来源或应用的责任 |
| --- | --- | --- |
| 资产身份与来源 | Soul／Maker 的独立身份、实际类型／来源证明和引用方式；分别定义两类资产的最小契约 | 制作、发行资格、供给、收费与版权；不强制 Maker 依赖 Soul |
| 关系表达 | 钱包持有、Soul 内含、外部关联、资格绑定分别表述；明确关系主体、对象与证明入口 | 每项关系是否赋予使用权、是否独占、是否随售；不把 ID 引用当授权 |
| 能力描述与发现 | 命名空间、能力标识、schema／版本与来源验证入口；允许没有某项能力 | 能力实现与有效性验证；发现到能力不等于可以使用 |
| 授权验证接口 | 明确谁针对哪个主体、对象、动作授权，如何验证范围、期限、撤销或代际 | 来源维护实际授权状态；调用入口必须验证，界面勾选不构成授权 |
| 生命周期声明与交接 | 明确转移、解绑、撤销、到期、暂停、退出及必要交接义务；区分随售、独立保留与失效 | 来源执行自身清理／结算，实际入口履行义务；不假设所有资产同步转移 |
| 版本与符合性 | 最小必需接口、可选能力、兼容范围、变更级别、证明样例与测试向量 | 各仓独立发布和治理；消费方只适配实际消费契约的变化 |

**划分原则**：身份和通用验证不变量属于最小内核；关系、能力和来源生命周期属于可选标准及来源适配；交易价格、渠道抽成、创作规则、推荐规则与游戏玩法属于业务模块。无需为所有 Soul 安装统一能力容器，亦不新增 Soulidity 统一管理权限、强制注册服务或平台批准入口。Soul 默认保持地址私有资产；可选容器的托管、锁定或共享状态必须单独说明，不成为普通 Soul 的前置条件。

新功能交付前逐项填写：主体与关系、证明来源、授权动作、生命周期、消费方、兼容影响、验收证据。每项职责有一个来源 Owner；业务模块可自行选择支持哪些可选标准，不得将不支持默认为有权限。来源声明还必须与实际行为核对，不能仅凭声明接受资产或资金义务。标准包的升级权单独记录，不能因采用标准就获得其他仓库业务权限。

**消费边界必须可核对**：每个消费仓列出实际调用的标准函数／类型／事件、接受的 schema／版本及行为不变量，分别标记必需与可选。新能力只影响实际消费它的模块；未消费该能力的旧模块不因其新增而被迫修改、升级或发布。最小市场仍须验证它实际承担的所有权、转移、授权及结算义务，不能只凭“符合 Soul 格式”接受任何资产。标准符合性测试按消费契约分组，各来源独立执行；跨仓集成验证组合结果，不代替来源自身验证。该记录沿现有职责／ABI映射补充，不另建任务板或强制通用能力系统。

施工验收至少覆盖下列六组情形；当前均为待运行要求，不引用上轮小包测试作为它们的完成证据：

1. 被动外观／经历扩展：旧市场源码、依赖锁、配置、制品变更数均为0，仍可挂牌／取消／成交。
2. 独立能力资产：同一钱包持有不自动绑定 Soul；换钱包或解绑后按来源规则重新核验，不误授予权限。
3. 临时资格：过期／撤销后拒绝使用；钱包转移和 Soul 转移分别测试，历史 ID 引用不复活授权。
4. 内含或随售权利：原 ID、余额、供给及有效权利保持；需要交接的实际入口完成交接，不将该类义务归入被动兼容。
5. 制作与应用替换：Maker 制作工具替换后，既有资产身份不变；第三方可按同一最小标准完成已支持操作，平台强制批准次数为0。
6. 不兼容或未知能力：消费方安全拒绝受影响操作并给出明确状态；仍兼容的基础操作按原权限继续，退出限制按原职责验证。

落地顺序沿原施工：闭合现有标准／Account 安全入口 → 建立可运行市场 B0 → 固定标准符合性向量并验证独立生产者／消费者 → 分别接入 Maker、渠道和原应用。先恢复原旅程的阻塞接口，再逐项交付可选标准；本次确认不要求先造完整通用能力系统。每仓用例属于各自维护单元，跨仓兼容验收复用原集成仓，避免重新集中业务实现。


2026-10-10 Native Birth/State源码增量：独立Native生产者＋Core sealed Account薄桥接，永久State下真实Library／Authorization／PaidAccess／Configuration DOF；线性Draft完整文档/记忆与实际Blob复核后锁入登记Kiosk，覆盖直接／导入／关联×有／无初始配置六变体。保留raw名称/描述/图片、配置首项覆盖与原普通OC版税，9750接受/9751拒绝；去掉Root人为非空128/32768限制，仍受Sui实际对象限额。66生产／62 Core及2 Standard测试冻结，1122 Core VM（含14创建）＋24 Standard VM、完整372外包93合法/279逐源预期拒绝；三包不同地址双构建Standard4756/Native9469/Core101771，Core余629。源码尚未部署，真实Publisher/TransferPolicy初始化未验，测试策略不能替代；首次发布前须加入Native当前发行版本守卫并拒绝升级旧准备/发行路径。Native更新/权限/付费访问、市场/退出/原版税、真实PTB/完整元数据域/组合树与独立Release仍待。正式69/1528、1459待/全30partial/全目标active。Slack8字段更新，其余468含22ID保持，Owner/状态/阶段/Schema不改；保留链/DB/keys/主CURRENT不改。证据 output/contract-rebuild/native-birth-state-2026-10-10/REVIEW_CN.md、verification-evidence.json及CURRENT。下方较早增量按其历史候选阅读。

## 2026-10-09 最新：嵌套工具交接与真实默认发布通过

Vault现位于已有Application扩展层，仍为Soul下DOF资金/资产与私密工具；Core移除原vault模块，无兼容wrapper/新业务包。标准核心保持独立。prepare_handover轮换整个原生嵌套树中的每个已安装工具，即使中间Soul没有本应用；深度16/总节点256，过界原子拒绝，已接受原生容器组合仍可关闭/暂停退出。AgentPass后置。

真实无签名模拟复现原Core105302>102400，随后实际本地Appv6=99030、freshCore=97937发布通过；双构建、bytes/ABI/typeorigins/linkage/Cap与交易BCS读回一致。当前913VM保留原908并新增5嵌套测试、独立Vault17、全部321外包81合法240预期拒绝逐源/主诊断通过；11项探针仅将Vault目标改为Application namespace。第三方producer只依赖标准，实际两个Root/工具及77/73余额和9MIST原资产组合、CAS/永久request拒绝、转买家与unnest/退出3成功2拒绝，原ID保留、两钱包+gas守恒0。

**全goalACTIVE/30partial/Releasefalse。** 独立工具PTB不代替新Core真实Config→Maker/Pack→Player→Complete→native服务→市场；这些当前新候选实链门禁仍须执行，Seal KMS未通过。保留链Genesis/config/keys哈希不变，node已SIGINT0/19089无监听/DB保留。证据：`output/contract-rebuild/nested-vault-handover-2026-10-09/{verification-evidence.json,IMPLEMENTATION_CN.md,REVIEW_CN.md}`。现网站UI结构/路径保持，无生产/SDK前端/37实站/Git/代理/外审；以下按历史版本阅读。

## 2026-10-09 最新：Soul 下工具与可选原生访问扩展

Vault 仍为 `Soul → 标准 DOF → Vault`，资金资产和私密内容都保留，读权不授权支出。独立付费／委托入口已通过现有 Sui Kiosk 的可选 access extension 恢复：真实 native cap 封存在既有 Account；扩展内部真实 ObjectBag DOF 存 Soul，不发行新OwnerCap、不建立反向共享Vault，也不要求普通Soul经过该容器。关闭／协议暂停仍允许实际owner取回原Soul，工具／内部资产ID和余额保持；非空不能卸载。普通Kiosk进出同步轮换根Soul可选工具的私密域；AgentPass后置。

原paid21／delegate9职责全部保留，新增11安全测试；当前全默认908VM、独立Vault17VM、完整321外包81合法240预期拒绝按各自主诊断／SHA通过，原307正文不变。59生产文件／副本一致，两次生产bytecode一致；Core14下限96467B，不包含type origins/linkage，尚不证明exact发布。17项Vault独立测试manifest已修正为当前源码依赖，不再指向历史副本。

**全30仍partial、goalACTIVE、Release=false。** 新候选尚未链上发布／真实native PTB／KMS；普通自由转移无通用撤销hook，嵌套子Soul工具的严格私密交接仍须验收。现网站结构与操作路径保持，无SDK前端／37实站／生产／Git／agents／外审。原Slack9记录15格读回，其他567业务单元、30记录ID及Owner／状态／阶段保持。证据：`output/contract-rebuild/kiosk-access-extension-2026-10-09/{verification-evidence.json,IMPLEMENTATION_CN.md,REVIEW_CN.md,slack-sync-proof.json}`。以下为各自历史候选时点，不以旧“当前”段落覆盖本段。

## 2026-10-09 当前：Soul 下 Vault 工具已实现，完整验收未通过

当前后续迁移增量：生产58输入不变，authorization/loadout/output/vault_edit四文件原116项保留，116VM通过，逐项映射与原始源保留；完整307外包76合法231预期拒绝按正文/SHA/各自主诊断通过。默认完整VM仍FAIL：paid_access/vault两旧接口文件106诊断。supplied-root授权政策单元不证明独立代理输入或SealKMS权限；原独立paid/delegate产品入口仍须接回，AgentPass后置，不能用test-only托管或权限mock使门禁假绿。全30partial/goalACTIVE/Releasefalse，仍无正确工具新链上发布。证据：`output/contract-rebuild/vault-test-migration-2026-10-09/{IMPLEMENTATION_CN.md,REVIEW_CN.md,verification-evidence.json,test-duty-map.json}`。下面234诊断及11外包是上一增量时点记录。

用户确认资金／资产和私密文件／记忆两类都需要，AgentPass 后置。当前源码已替换为 `Soul → 标准 DOF → Vault 工具`，非泛型 Vault 持有真实 Balance 动态字段、原 ID 资产 DOF 和 certified 加密 Library DOF；旧 sharedVault→Soul、独立 OwnerCap、Soul 编辑借还及 runtime 反向入口已移除。Physical 直接使用实际 Soul；两条市场成交路径轮换可选工具私密域，完整清单公共可读，取消保持；读取授权不成为支出权。Native目录 schema2 创建／校验一致，修复扩大回归发现的 schema1 初始化错误。

当前限定验收：独立17 VM＋选取原业务206 VM全通过；11外包2合法9预期拒绝按主诊断通过。固定 Sui／Walrus 依赖，两次生产构建、108冻结输入和58生产文件＋7显式选取原测试／夹具副本逐字节校验。**默认完整VM仍编译失败（六旧接口测试文件234诊断），当前完整307外包尚未跑；全30仍partial／goal ACTIVE／Release=false。** Core13模块包下限90898B，仅下限，正确工具未新链上发布／真实PTB。布局/API不兼容旧Corev4，应新部署。旧895VM／304等和20反向托管交易仅各历史版本证据，不能当本候选验收。

私密库沿用 owner＋generation：自由转移没有通用hook，未显式轮换而转回可能恢复旧域；新持有人的私密head可为空，密文／收据仍随Soul。不能承诺自动跨人明文继承、AgentPass独立委托或复制Grant提款。公开借出 mutable Soul 的第三方容器仍需自行守权限。原本地链／Root／Free／Artifact保留，故障节点未重启，未签新交易。无SDK前端/37实站/生产/外审/Git/agents。

源码、决策、验证和剩余门禁：`output/contract-rebuild/soul-vault-tool-2026-10-09/{IMPLEMENTATION_CN.md,REVIEW_CN.md,verification-evidence.json,default-vm-failures.json}`。下面关于反向Vault和认证Vault包装的条目按原历史时点阅读，不构成当前产品或权限方案；其原授权／付费职责须逐项迁移而不能丢失。

## 2026-10-09 当前：跨场景整套交易与当前外包全量通过

103冻结输入未变；886默认VM保持，当前297外包74合法/223预期拒绝逐文件主诊断与hash全通过。本轮当前Appv5/Corev3、ae60751d/default137新增18真实原交易13成功5业务拒绝/41Public；现形态512×768及卸装Bound/Reference真实清单承诺解码核验，原Soul/Free/Artifact/Forms/Growth交接、买家恢复/取出/再装、取消和失败回滚通过。少付款拒绝不改变授权版本，成功出售清generation后转回不复活。实际1000=875seller+50OC+50Maker+25平台保留，角色重合归并后钱包扣Gas−25与Config+25守恒0。与scene/schema合71个原digest52成功19失败（17业务2历史夹具）/177Public。源码与包未改变，Core101188余1212；节点已SIGINT0，DB/keys保留。完整目标ACTIVE/all30partial/Physical34pending3partial/Releasefalse；独立scopedPack跨Scene、严格Vault形态、嵌套/全职责/升级旧入口/恢复争用安全仍必须。

证据：`output/contract-rebuild/cross-scene-market-2026-10-09/IMPLEMENTATION_CN.md`、`verification-evidence.json`、`REVIEW_CN.md`、`exact-settlement-proof.json`、`underpayment-authorization-rollback-proof.json`。无SDK前端/37实站/生产/Git/agents/外审，AgentPass后置。下方旧增量按各自历史时点阅读。

## 当前模块schema语义边界（2026-10-09）

核心Soul源码与自由转移能力不变。Character Application与Forms Journal的安装和提交schema提升为2，使用核心已有commit_update单调schema约束。真实旧v3/v4写入丢失跨Scene承诺已复现；五种旧写入口schema1提交被拒绝并回滚，当前既有形态恢复与Standard-only容器退出通过。Snapshot自己的schema1/2与永久模块schema2是不同字段。旧对象不会因包升级自动提升；需当前合法写入推进对应模块，Forms单独推进不等于Application推进。后续不兼容语义需新的schema边界与全部旧入口实测。当前103／886VM；Current全297外包待重跑，整体Releasefalse。详见output/contract-rebuild/module-schema-guard-2026-10-09/IMPLEMENTATION_CN.md。


2026-10-09 当前经历反馈增量（以下旧数字按历史时点阅读）：可选永久 growth DOF Journal 已实现实际私有来源出具、当前持有人逐条接收、精确 Source/规则集/版本/schema、Clock期限、撤销与 O(1) generation失效、永久事件防重放、严格运行序列及不可覆盖历史。Receipt是来源证明值，不自动产生XP/代币/组件，不是内容解密授权；来源声明真实性与升级权仍属于应用信任边界。普通自由转移保留设置，但没有委托自动写入，接收仍须实际可变Soul；新持有人可主动接受待处理证明或撤销来源。Standard/Core源码未改、无新增包层。

当前101顶层源码输入；默认854PASS保留原832，外包283PASS（71合法/212拒绝，失败批次与更正证据保留）。App实际Compatible v3/88393B、原类型来源/9模块字节/ABI/linkage/Cap读回与双构建通过。41唯一原交易29成功/11业务拒绝/1混用旧新App入口InvalidLinkage夹具失败（更正单版本调用后旧形态入口通过）；90Public命令、钱包扣gas−25/平台保留25/守恒0。实际独立应用Outbox、同Soul5条经历、整套出售和Standard-only容器接收/退出通过，原Free/Artifact/不可变Form快照保持。当前Root48bc…/growth revision10/gen1、form revision8、app14、grantgen2；Config资金108。完整所有合约目标仍ACTIVE/30职责partial/Physical34pending3partial/Releasefalse；跨Scene/嵌套应用/严格Vault接口/全职责/升级恢复争用安全仍需完成。证据：`output/contract-rebuild/oc-growth-2026-10-09/IMPLEMENTATION_CN.md`、`verification-evidence.json`、`REVIEW_CN.md`。


## 2026-10-09 当前同一OC形态与历史增量

当前标准核心不变；新增Application::forms永久DOF Journal/版本Snapshot及分页选择/来源，形态恢复原子核验实际资产/固定Style/颜色/布局/规则，不发行新根或第二份库存。原Native Soul及Standard-only容器、新holder分支、原ID退出和含历史整套出售已实际本地验证。App Compatible v2原类型保留/新forms origins、双编译/实际字节ABIlinkageCap82,231通过；832默认VM（保留819＋13）、272外包68正204负、26原PTB20success6业务拒绝/62Public、25保留资金差0。99真实顶层输入冻结，纠正旧217中120生成副本混入计数；旧证据不删除。

准确证据：[oc-forms/IMPLEMENTATION_CN.md](../output/contract-rebuild/oc-forms-2026-10-09/IMPLEMENTATION_CN.md)与verification-evidence.json/source-freeze.json。全目标ACTIVE/all30partial/Physical34pending3partial/Release=false。仅同Scene原生形态保存和恢复；跨Scene、真实成长回写、完整嵌套应用/升级旧入口/恢复争用/安全仍待。没有SDK前端/37实站/生产/外审，AgentPass后置。以下较早增量按历史候选阅读，不把旧App v1 Cap或旧819当当前全套状态。


2026-10-09当前PackPhysical增量：75真实PTB58success17businessAbort；旧410保留合485/402success83failure/7228Public。当前10包bytes/ABI与128source一致，生产源码未变。实际两Control注册、重复/过期CAS、三同名Part独立scope、PaidPack访问19与Physical37独立结算、actualSoul/Artifact proof、Receiving原ID二售101、归档取消/转让/消费通过；Player/Soul render BCS一致（非pixels）。钱包扣gas+income333守恒，Config10/funds99，新Pack57。Physical171新增50映射→43implemented80restructured3partial45pending；保护素材/注册controllerEpochCap/完整provenance/旧market角色仍缺口，all_functions_mapped/fullacceptance=false。完整goalACTIVE/Code/30partial/Releasefalse，Core122/原VM500TIMEOUT/current242/500Complete/养成嵌套及全职责待；无production/SDKfrontend/37live/KMSstoragepixels/agents/Git/外审。证据 output/contract-rebuild/paged-pack-physical-ptb-2026-10-09/{combined-evidence.json,physical-function-map.json,IMPLEMENTATION_CN.md}。下方按各阶段历史时点阅读。

2026-10-09增量：当前分页候选公开／Included scoped与Physical105真实PTB（83success／21business abort／1真实非公开调用夹具failure）完成适用验收；原305保留合计410（344success／66failure）、6242合法Public调用。actual10包bytes／ABI及128source一致。两个同名Pack Part scope隔离、独立颜色、Player/Soul render BCS一致；原ItemID装卸／微调与限制负例通过。Physical actual Registry／免费／付费／canonical proof／Receiving原ID出售／归档退出通过。完整钱包扣gas与income260守恒；当前Config10/funds83。夹具ObjectOwner误判与非公开归档原始失败均保留，未改生产源或重放旧mutation。30全部partial／完整goalACTIVE／Code／Releasefalse；Core余122、原累计500VM TIMEOUT、当前242全跑、500Complete／PackPhysical全职责／养成嵌套等待。无pixels／KMS／storage／SDKfrontend／production／37live／agents／Git／外审。证据 `output/contract-rebuild/paged-scoped-ptb-2026-10-09/{combined-evidence.json,IMPLEMENTATION_CN.md}`。以下阶段数字按历史时点阅读。

## 2026-10-09 当前分页候选付费与整套市场增量

生产源未改，128冻结输入及真实包字节/部署ABI一致。当前paged Core真实Maker→paidPlayer→Complete→Pack增强/初始Complete、三权利/原ID装卸/微调和整套市场通过83笔新本地PTB（62成功21业务拒绝）。累计305笔（261成功44失败，旧容量与夹具错误仍保留）、5078Public调用、原BCS/effects/失败历史回滚核验。初售171账本Maker86/Pack52/平台33；正常Admin将local native secondary500→250，Config9→10；gross1000=25+50+50+875，当前平台58/保留总收入196，钱包扣gas后-196相抵。

普通转移issuer委托inactive、转回可live；明确sale清理generation后转回不复活。卸装Bound/Reference、原Free/Artifact/内容随整套交接。Paid66边界Config9/funds33是历史；当前Config10/funds58/Soul app12/gen1。源码128未变、原777/776+1TIMEOUT及242全跑待状态保持；Core122余量。完整目标ACTIVE/Code/30partial/Releasefalse，后续全30/升级安全/500Complete/养成/第三方与scoped回归待；无生产/SDK前端/37实站/KMS像素/agents/Git/外审。证据 `output/contract-rebuild/paged-paid-ptb-2026-10-09/{combined-evidence.json,IMPLEMENTATION_CN.md}`。以下按历史时点阅读。

## 当前增量：真实500素材容量与发布页（2026-10-09）

原真实500扁平DOF发行在finish复现dynamic_field子对象运行时错误，完整托管回滚并取回原502个Blob。Release改用每页32个真实Blob的DOF BlobPage，保持原UID，finish／available／renew仍读取真实对象值，分页取消可完整返回。分页候选在隔离ae60751d/default137正式500素材发布、Player单一Style250片段选择、35Blob中途取消通过；并非500件Item或该Maker的Complete已通过。Standard Soul／组件权利／视觉核心不变。最新Core102278／102400余122；append／append_batch使用mutable TxContext，新对象布局不加旧fallback。原旧候选证据按历史阅读。

当前全默认VM777／776PASS／原累计500TIMEOUT1；776旧命名结果保持。新5外包2合法3拒绝；旧237不冒充更新后242全跑。当前222Ledger199成功23失败（含1生产容量复现和1测试引用返回错误），4679Public ABI，BCS／effects／钱包扣gas守恒；128当前输入冻结、Core13模块两次字节一致。真实500通过不抹去累计VM超时，也不代表全部30职责完成。完整目标ACTIVE／Code／Release=false。证据与工程评审：`output/contract-rebuild/certified-capacity-ptb-2026-10-09/{evidence.json,IMPLEMENTATION_CN.md}`；准确包／Config／Maker在该目录paged/evidence.json。下一步全30及更新后paid／Physical／社区／集合／Loadout与升级恢复、OC形态养成嵌套验收；AgentPass后置。


## 当前增量：视觉实例边界与真实默认发布容量（2026-10-08）

完整目标仍ACTIVE／Code／Release=false。Standard仍独立Sui-only；Application7无Core导入，Model4、Core13。VisualCapture schema2绑定专用私有CaptureProducer＋实际Registry实例，Native issue仍私有；独立捕获与复制画面没有原生发行权。MaterialPolicy在Model；复制型PublicationRules／PhysicalMetadata在Application，实际Control、来源、付款、供给、重放、资产与交接守卫继续由原生应用执行，无旧模块别名。

当前八包已在隔离本地链1544de63／协议137的默认预算真实发布并读回ABI，Core101765／102400字节（余635）。先前103447／102669的真实失败保留。旧Application候选为历史，新当前发行不能当作升级验收。最终776／775通过，原500累计VM超时保留；新增8权限例、独立3VM。外包与重复构建以最终evidence.json为准，不以数量代替旅程／安全证明。

当前证据：`output/contract-rebuild/visual-capture-boundary-2026-10-08/evidence.json`；决策／适用手册／审查：同目录`IMPLEMENTATION_CN.md`；当前源码图：`dependencies/source-dependencies.json`（文本引用，非运行调用图）；实际部署ABI：同目录`*-deployed-abi.json`。源声明清单含test-only，与真实ABI分开。

剩余：当前真实角色／Config／目录初始化、原生及第三方业务PTB、默认500分块预算、完整30职责／资金／私密／重放／争用／旧入口／升级／恢复／安全、同一OC形态／历史／养成与嵌套应用验收。无生产部署、SDK／前端实施、实站37步、外部审计、代理或Git提交；AgentPass后置。以下早期章节按其时点阅读，不能推翻当前源码与证据。

## 当前 Character 应用与发行边界（2026-10-08）

Character 已完整迁入 SoulidityApplication，Core旧模块删除、无alias；Application4模块仅向下依赖，无Core/Catalog/Player反向导入。Standard/Model/Content生产源码不变。原生发行由实际Creator角色、真实Product/root和完整出版元数据承诺生成无abilities Genesis；实际quota/attempt和Coin结算后才返回。Character消耗Genesis安装永久应用，返回绑定root/carrier/actor的无abilities Draft，原生Build私有保存并最终消耗。初始选择/颜色/内容/输出构造需该准确票据。

Pack与后续增强通过实际结算后的无abilities Contribution接入；Enhancement绑定根、具体产品/版本/actor及此前状态，替换另核对真实Component Permit的product/version，完成消耗。复制PrimaryReceipt只是数据。NativeBinding本来依赖Issuer/Product类型，第一轮编译发现反向获取凭证形成环；改由已核验入口传入Binding，并将私有ApplicationOperator放在Core叶模块，不新增全局角色。永久应用保存准确原始操作类型；容器仍需实际托管/OwnerCap/owner/ctx/generation/Seal范围，集合/Physical/市场原角色/许可/CAS/支付保持。**该操作类型证明lineage，不是最新版本、持有权、付款或通用转移hook。** 对实际可变根的显式清授权是持有人操作。

最终默认VM768/767PASS/原500素材累计TIMEOUT，原758场景名字与结果保持，新增10项实际边界通过；独立Output原型3/3VM且无Core依赖。最终全部231外包编译（53合法/178拒绝）逐文件当前正文/hash/主诊断通过，不是231独立部署包。首先五包两次构建，恢复Issuer欠款原code3后Core另构建两次；四个独立包生产输入不变，最终627模块文件副本含重复依赖、5实际解析锁一致。Core15大小下限104695>102400仍不可发布；Application4下限51926等仅是下限，不是发布验收。

保留真实失败日志：初始依赖环、测试夹具同事务重复取共享对象、raw Complete探针漏Binding变量、欠款错误位置回归；均修复并复验，没有降低旧测试期望或用结构错误代替权限证据。完整目标ACTIVE/Code、Release false，全部30旧职责仍partial；当前发布/真实PTB/部署ABI/500单PTB容量/全权限与资金/旧入口升级恢复/独立审查/完整形态历史与养成均待。证据与取舍：`output/contract-rebuild/character-boundary-2026-10-08/evidence.json`、同目录`IMPLEMENTATION_CN.md`。下方为各自阶段历史记录，不能当作当前全目标完成。

2026-10-08，沿用 DOF-001。完整目标 active，Release 未通过。本页为架构评审的可执行增量；不替代完整重构规格/旧职责清单。

## 当前输出与结算应用边界（2026-10-08）

核心仍为同一个独立 Standard Soul，Standard/Model/Content 的生产源码保持上轮版本。新增 SoulidityApplication 承接 output 与 resale，原 Core 两模块删除，无旧路径 alias；它只向下依赖 Standard/Model/Content/Foundation/Visual 与固定 Sui/Walrus，不导入 Core/Catalog/Character。这不是以包数衡量交付；目的是将最终 Character 应用依赖闭包建立在独立根之上，保留可发布预算和真实授权。当前 Character 仍在 Core，完整闭包尚未提取。

Output 使用无 abilities 的 `Creation`：私有 ContentOperator 与实际应用载体同 original package/module，由 Content authority 保存实际载体 ID 和实际 Soul ID；授权另核对标准根的真实 source ID/version/hash/minted_by 与 Intent，绑定确切 intent hash。构造 Artifact 必须消耗 Creation，核对 actor 与当前 ctx.sender、输出 policy hash、语义配方与 renderer、真实 Blob/certification/可用性、保护 envelope、原 Profiles。原始 recipe/receipt/blob/envelope 的真实对象关系继续保留。没有公开 Creation 构造/复制/保存/丢弃路径。

**Creation 证明该应用为真实根授权这个输出意图，不证明支付、当前持有权或已安装成员关系。** 独立应用可以为实际根制造自己的 detached 输出；公开的 Intent、PayLine、Receipt、Snapshot 是 caller-owned 可复制元数据。原生 Build 继续私有地核验 Maker/Pack 资格、支付、供给、attempt、完整内容、配方和贡献使用后，调用 Character 的 package-only create_output；只有 Character 构造私有 ContentOperator。原生 install_output 再核对确切操作凭证、实际 ApplicationState ID/root ID，外部 artifact 即使指向同一个 Soul，也不能取代原生输出。

Artifact 保存 Controller，materialization reserve / Blob extend / raw protected read 均要求精确原始操作类型；Artifact UID/Controller/Table/实际 Blob 无 mutable escape。原生持有人入口仍要求实际 mutable Soul，Vault 入口仍核验实际 owner/Grant/托管；只读原始输出或 seal namespace 不能取得私密读取批准。只读/模块权限与解密、当前 custody、自由转移撤销是不同保障，不声称新增通用 transfer hook。

Resale 的纯 Snapshot 构造公开，不认证已发行 OC；原生 factory 仍只接受已验证 Build 的真实来源。真实结算需要 Config 当前 pinned MarketAuthority/MarketRevision，先核验当前业务角色和 enabled，再按同一实际 Snapshot/Config 重算 basis、price、rates、各接收人/金额/collection，必须与 Receipt 完全相等才分割 Coin。原生 Listing 保留实际 Soul custody、manifest/rights/CAS/expiry/buyer/attempt 及交接前撤销，receipt 复制不能充当角色或绕过原生报价。原有 gross250bps、collection net ask、独立舍入、协议账本与原 creator 收款路径保持。

备选与取舍：全部改 public 会开放可复制数据驱动的发行/读取；保持反向 Core 导入无法建立独立应用；把付款或 Walrus 放进标准根违反内核独立。因此选择实际实例凭证与线性 Creation，加上配置中已有的真实市场角色，不给 Standard 增加平台业务。新增凭证是跨包权限替代，不能用它宣称 Character 的 Genesis/Draft、后续增强发行和各种容器角色已全部完成。

本轮原生 default VM **758/757 PASS/1 原500Blob累计 TIMEOUT**；上轮745项完整名字和结果全部保留，新增13项真实来源/意图替换/原生安装与读取隔离/角色/错配收据反例 PASS。独立 `standard_examples/output_extension` 只声明 Application+Standard，无 Core 依赖/导入，自己的源对象发行标准根、自己的 Extension DOF 持有真实 Artifact/Blob；3/3 default VM 验证 root/carrier/artifact 原 ID、CAS/清单变化和整体交接后新 holder 的实际 mutable 根读取。Blob certificate 夹具 test-only，不代表 Walrus 服务或本地 PTB验收；这是免费自有输出原型，不冒充原生付费 Complete。

当前重复生产构建 Core15 包下界 **138756>102400**，仍不可发布。五包两次生产构建623模块文件副本含重复依赖逐字节一致（Core160/Application141/Content135/Model97/Standard90），5个实际解析锁一致；独立原型生产构建通过。完整209编译用例（51合法/158拒绝）采用不同外包模块按诊断阶段分批，逐文件主诊断和当前源码hash核验全部通过，不声称209个分别发布的包或网络权限验证。初次批次发现metadata append漏分号、旧提现探针缺真实UID参数；修正并重跑16项合法组和1项UID隐私反例，保留失败日志。并行单包旧驱动在已完成53项后显式终止，仅终止自己的驱动/子进程；11项新边界先以分包与批次共同核验。复制解析锁实验仍耗91秒，未采用为绕过编译或验证的方案。最终结果见 `output/contract-rebuild/output-boundary-2026-10-08/evidence.json`，没有当前发布/部署ABI/全产品安全通过。原500容量、实际网络PTB、Character Genesis/Draft/增强跨包权限、全部30旧职责、资金/私密/旧入口/升级/恢复/形态历史仍待逐项验收。原Owner/Code/完整目标active保持。

## 上轮内容与授权的独立边界（2026-10-08）

Soul 身份根仍仅依赖 Sui/stdlib，源码未改；新增独立 **SoulidityContent**：permissions、paged_store、storage、kind_registry、document、authority、authorization、loadout、paid_access。它仅依赖 Standard、Foundation、固定 Sui/Walrus；不导入 Core、Model、Maker、组件或视觉。Core 中原八模块删除，所有生产调用方/测试/外包探针/旧职责 target 改用唯一新路径，不保留旧 alias。Character 的 Content 版本索引、实际 Blob 托管和原始输出仍由其私有 ApplicationState 承载；这一步并不意味着整个内容扩展或 Character 已脱离 Core。

跨包权限采用实例保存的 **Controller**：实际 `&Soul` 获取 root ID、实际 `&P:key` 获取 carrier ID；专用 `ContentOperator` 必须与 P 同 original package/module，并且 datatype 精确匹配。原生 Character 只在自己的模块构造私有 ContentOperator。Authorization / Library / Ledger 创建时保存 Controller；原 package-only 的授权变更、Loadout 写入/读取批准、付费写入/读取核验均要求同一 original TypeName 的凭证，旧内部实现仍私有。公开 Grant、公开 Catalog Version、第三方同名 ContentOperator 都不是原生调用凭证。

**Controller 证明应用模块的调用权，不证明当前持有权或 DOF 成员关系。** 原生读取仍从实际 Soul 的私有 ApplicationState 取出实际子模块，或从认证 Vault 取出 Soul，并核验 owner/caller/generation/scope/Clock/准确 namespace/实际 Blob。它不接受外部传入 Authorization / Ledger / Record 来批准原生私密内容；公开 getter 只返回不可变引用。Vault 的三项授权查询通过 Character 的 package-only 容器适配方法调用，未把私有凭证交给 Vault 或外部用户。扩展应用须自行维持安装/归属/持有人入口，不能把 detached Controller 或 root ID 当作持有证明；生产者升级也仍是其代码与升级权限的安全责任。

纯 Record 和 Store 的构建/变更可以公开：操作 caller-owned 元数据，不获得原生已安装数据的 mutable borrow。Store 元素要求 copy+drop+store，因此不能收纳真实自由 Item/UID 来绕过资产发行；复制 Record 后删改其 flags/初始 namespace 不能覆盖原生历史版本或触发读取批准。KindRegistry 保留真实 shared key 对象、实际 KindAdminCap 的 registry 绑定与 mutable 管理入口。

Walrus 的 `assert_custodied_until(reference,claimed_end)` 删除。Release 完成与每次可用性检查改为从实际 Draft/Certificate 私有 custody UID 读取 living、manifest 与逐项 asset 的真实 Blob，调用 `storage::assert_current` 核验原 ID/blob ID/size/certified epoch、nondeletable 和当前实际 end epoch。续期写实际 Blob，并移除冗余 renewals 表及声称到期时间路径。SHA-256 仍是发布者内容承诺，Walrus certification 不自动证明该 SHA 与字节相等。500 素材累计 VM 超时仍存在，不将这次核验当成容量或真实网络 gas 通过。

付费访问的 PaidAuthority1/PaidRevision1/Publisher 路径迁到 Content；生产仍由实际 Publisher + UpgradeCap + Config Admin/CAS 注册 role 5，不能用 Core 的 Publisher 或 Cap 代替。原有 VM 夹具将各业务角色统一指向 Core，拆包后真实角色检查拒绝了付费购买；仅 test-only 夹具按实际 Content 类型修正 role 5 初始身份，保留原 revision=0 和既有场景。另有独立测试调用生产 register 路径：正确 Content Publisher/Cap 接受、错误 Core Publisher/Cap 拒绝；测试用 test_claim/test_publish 构造对象，并非已部署角色证明。生产没有 bootstrap shortcut。

备选与取舍：把全部 package-only 直接改 public 会开放 owner/generation/读批准参数；反向引用 Core 会保留同一依赖环；将所有权利塞回 Standard 会破坏无业务内核。因此选 caller-owned 元数据公开、实际应用实例绑定的私有操作凭证、用户入口继续核验实际 custody。增加一次类型检查与紧凑 Controller 字段，换取独立职责和明确权限边界，不另建原生角色白名单进入标准。

独立 `standard_examples/content_controller` 仅声明 Content + Standard 依赖，生产源码无 Core/Model/Visual。它把自己 Extension 作为标准 DOF、真实 Authorization/Library 作为 Extension DOF；安装、grant、clear 走准确 root CAS 与线性 Edit 后恢复同一对象。3 项 VM 测试验证原 root/library ID 保持、修订/清单变化、旧 CAS 拒绝，并显式验证自由转移到新 holder 不能使用旧 issuer 身份、转回旧 holder 可能复活旧委托、clear 后失效。它是自有命名空间的原型，无原生内容 Seal 入口，也不声称提供任意容器的严格撤销服务。

当前原生 **745/744 PASS/1 原500素材累计 TIMEOUT**，上轮 734 个完整测试名字/结果全部保留，新增 11 项操作凭证、原生读取隔离、真实角色注册/错误 Publisher/Cap 测试通过。当前 Core 17 模块生产包下限 **149067 > 102400**，Content 9 模块下限 24783；仍未满足完整默认发布/当前业务 PTB/部署 ABI/安全验收。编译/可复现构建的最终证据以 `output/contract-rebuild/content-boundary-2026-10-08/evidence.json` 为准，完整目标 ACTIVE、Release false。

最终本轮证据：112 输入冻结；四包两次生产构建 **482 模块文件副本含依赖** 逐字节一致（Core160/Content135/Model97/Standard90，并非482独立模块），4 个 CLI 生成的解析后依赖锁一致。实际外包编译 **15 项：2 合法／13 预期拒绝全部通过**；整个矩阵197项未全跑。只读引用无法提升为 mutable 的正确诊断是 EC04006；首轮误期望 EC04007，修正后全15重跑，旧日志保留。无 EC01–03 结构错误替代权限拒绝。首轮重构脚本误改测试模块地址和遗漏 Vault 适配、付费夹具旧包地址，均已修复；不把编译失败或夹具错误当成安全证明。最终源依赖图38模块/163文本引用包含生产文件中的test-only helpers，非调用图或部署 ABI。Slack 原14记录只改4证据格，其他304格/Owner/status/stage保持；完整目标仍ACTIVE。

## 当前一次性组件发行边界（2026-10-08）

唯一资产根仍为独立 Standard Soul；Model 新增 `components`，不依赖 Core/Walrus，依赖 Standard 以核验实际目标 Soul。原 `soulidity_v1::item` 已删除，不保留 alias。真实自由组件格式为 `soulidity_model::components::Item has key,store`，私有 UID/Source，原 ID 装卸/市场/集合/Loadout/NativeBinding 调用方全部改用此唯一类型。原网站操作路径保持；ABI/type/event 路径改变需要后续新部署与 SDK 接入，本轮不做前端。

公开可复制 Source 是预览，不是发行权。新增 **Permit 无任何 abilities**：私有 Source/target 字段。`authorize<ComponentProducer,P>` 要求专用私有构造标记与实际 `&P` 同 original package/module、Source 的实际 product ID/type 与 P 完全一致、实际 `&Soul` 输入取得 target ID。第三方标记不能借一个复制的原生 Source 发行原生组件；同模块公开 Version 也不是 ComponentProducer。模块证明对应生产者的签发，不自动审计其供给/支付/版权；独立生产者验证自己的规则，不能因为标记同名获得原生 Catalog 权限。

Native Catalog 的 `issue` 仍 package-only：原供给计数校验/预留后由该模块私有 ComponentProducer 返回 Permit，传入实际目标 Soul。Issuer 保留原实际产品/访问/Complete资格/供给/次数/attempt/Coin原子结算、expiry、CAS和原配方守卫；初次 Complete 与已有 Soul 增强均改走 Permit。Character 的 add_issued/replace_issued 仍 package-only，入参从 Source 改为 Permit，不能复制预览再装入。它核验准确 Part/布局/许可/永久已持有记录，再以内部真实根 ID 消费凭证。

materialize 只允许准确 target，消费一次，Free 才调用私有 Item 构造；Reference/Bound 返回元数据和 None，随后原 Character 永久记录/装备逻辑承载归属。通用 materialize 本身不替代应用的永久绑定逻辑；它也不会把一个可复制 Source 变成可再次安装的权利。凭证不能复制、丢弃、保存或 public_transfer，不能跨交易留待升级/暂停之后使用。已经形成的 Free Item 继续自由交易和原 ID 退出，目标限制只约束本次发行。

备选：公开 Item::issue(Source) 会允许预览任意重发；把专用标记直接带到下游要求发行者代码与安装模块共同构造标记；保留 Item 于 Core 又无法真正抽离应用。选用独立 Item + 真实生产者/目标的一次性 Permit，应用只消费权利，不获得发行标记；代价是一个临时凭证与类型/ABI路径变化。没有全平台白名单进入 Standard 核，也没有开放原生私有发行/付费/Root初始化入口。应用根创建、原始输出和跨包 Seal/付款权限仍须继续验证。

8 新 Move VM 场景通过：真实已预留 Free 一次物化与原 ID；Ref/Bound 不产生自由对象；两颗实际 Soul 的错目标拒绝；公开 Version/外来同名标记/自有生产者复制原生 Source 拒绝；真正独立类型可发行自己的 Free。**734/733 PASS/1 原500素材累计TIMEOUT**，726 个上版场景名字/结果全部保留。最初新测试未切换交易，取不到新铸造 Soul；修正夹具后验证，不把此场景错误当成权限证明。

12 当前真实外包编译（2 合法/10 拒绝）通过，含消费/预览、伪造标记/凭证/Item、copy/drop/store/transfer、改target、绕过预览及私有安装，无EC01/02/03结构失败替代。全187矩阵未跑。独立 ModelProducer 更新为自己的 Free 供给计数→目标绑定 Permit，生产构建通过，当前 PTB 未跑；根数量与组件数量在此原型分别计数，不冒充原生付费 Complete。

106 当前源码/测试/manifest/lock/验证脚本输入冻结。Core/Model/Standard 两次生产构建逐字节一致：159/97/90 模块文件拷贝含各自重复依赖，共346份。Core25模块下限 **170558>102400**，仍不可发布；Model3模块15127、Standard1模块4390仅为预算下限，非实际发布验收。当前 Std 源未改；上版24核/6独立互操作/标准10编译为相同核的独立历史测试证据，不新增当前业务 PTB/部署ABI。

证据 `output/contract-rebuild/component-issuance-2026-10-08/evidence.json`。原DOF-001/005/008/009、手册v1.0 §§1–4/6/7/8.3–8.4/9/12、OperatingModel8及原评审附件沿用；Owner/status/Code不变。完整目标 ACTIVE、Release false。继续抽离应用/内容职责时还须核验 Root 初始化、输出、付款、Seal、管理/升级/恢复权限；默认实际发布/角色/PTB/ABI/容量和完整旧职责/资金/私密/形态历史/安全仍未完成。

## 来源证明与视觉值边界快照（组件发行重构前，2026-10-08）

沿用 DOF-001/005/008/009，完整目标 ACTIVE、Code 进行中、Release false。唯一资产根仍为非泛型 `soulidity_standard::soul::Soul has key,store`；核心只依赖固定 Sui/stdlib。Maker、经济政策和视觉值都不进入核心。

**复现并修复来源校验缺口。** 仅要求 W/P 同 original package/module 不足以证明发行：公开 `catalog::Version` 有 drop，可以作为 W 搭配实际 Product，旧标准核会创建并转移一个带实际 Maker 来源的裸 Soul。隔离复制包只替换为冻结旧核，Move VM 反例确实未 abort；当前同一场景按 EAuthority=3 拒绝。它证明裸根来源/发行标记缺口，不证明完整付费 Complete、原生 ApplicationState 或资金被绕过。`new` 现在还要求 W 的 datatype 为 **SoulProducer**；生产者必须保持其构造私有且不导出标记。核验证类型与实际对象，不自动审计第三方生产者代码的供给、版权或支付逻辑。

`policy` 和 `assembly` 从 Core 移入独立 `soulidity_model`，没有旧模块 alias。该包只依赖 Foundation/Visual/Sui，承载应用视觉/许可/经济元数据，不是第二个 Soul 标准。公开 Source/Scope/Profile 构造均消耗定义模块的 **PolicyProducer** 标记，W 与实际 `&P` 同 original package/module；product ID 和 defining type 从实际对象取得。Source 检查正版本、版税≤10000、非零收款人，以及 Market/Primary 快照属于声明的协议。Maker 关系/发布真实性由对应生产者验证；这些值可复制、可预览，**绝不是供给、支付、访问或 Item 发行凭证**。

Core 创建 Pack 时从实际不可变 Maker 发布保存准确父 Scope；Scope 含实际对象类型/ID/协议/版本/policy hash。Profile 构造绑定实际源对象，父子要求同源类型/协议，Parts 属于真实 Scene 且不重复。Character 不再导入 Catalog/Product：`admit_pack(&mut Soul, Profile, expected_app_revision)` 接收生产者快照；assembly 仍检查准确父 Scope、源类型、增量 Scene 和容量。增加空槽不发行组件、不授权 Complete。旧 UI 操作路径保持；后续调用先 `catalog::assembly_profile(pack,version)` 再接入。仅 Free 的真实对象/本 Soul 永久 Bound/Reference 和原许可可装入。

State 的 new/admit/colors/destroy 现在操作调用方拥有的纯元数据值。Character/Player/Capture 的生产字段、UID 和内部 State 可变引用仍私有；这些函数不能取得已有资产中的 State。Definition 扩展返回一个新值，不修改原发布/Source/Item/Soul。没有把原供给/支付/发行/资产退出的 package-private 入口开放。

选择：保留 Product 反向依赖会妨碍应用独立分包；公开任意 ID/裸 Scope 构造会丢来源边界；采用真实对象＋专用私有标记＋冻结父快照。代价是值格式/源码类型路径和 `admit_pack` 入参改变，需新部署与后续 SDK 接入；用户已允许重建底层，不保留不成熟旧版本的兼容发行。Source 类型校验把外来生产者与原生来源分开，跨来源装配仍必须经过创作者发布的适配规则。

当前默认 **726/725 PASS/1 原500素材累计TIMEOUT**；712 个上一版测试名字/结果逐项保留，14 个新场景通过。Kernel24、既有独立互操作6通过；当前标准10外包编译通过且读回无 EC01/02/03 结构错误；视觉边界11外包编译4合法/7拒绝通过。新独立 `standard_examples/model_producer` 只依赖 Model/Standard（及其 Foundation/Visual/Sui），生产构建通过；它是自己的免费限量发行原型，安装真实 VisualProfile DOF，不获得原生 Maker、Item 或 Complete 权限，当前未做此原型真实 PTB。

三包分别两次生产构建逐字节一致：Core159、Model95、Standard90 个模块文件拷贝（含各自依赖，共344份，并非344个唯一模块）。Core26模块下限 **170734>102400**，仍不可发布；Model2模块下限13780、Standard1模块4390仅低于下限，不等于实际 publish 验收。旧本地发布/升级/嵌套交易是改来源标记前的历史证据，不能证明当前核的网络接入。当前源码接口/对象 abilities 索引也不是部署 normalized ABI。

证据 `output/contract-rebuild/model-source-2026-10-08/evidence.json` 与当前冻结清单。手册v1.0 §§1–4/6/7/8.3–8.4/9/12、OperatingModel8、原 product-engineering-review 附件沿用；支付、发行、模块权限、永久绑定/正常退出适用，EVM/借贷不适用。执行者源码检查不代替独立安全审查。下一步拆真实应用/资产职责时保留不可复制的发行/付款证明，随后默认协议发布、角色绑定、当前核与业务 PTB、容量、旧职责/权限/资金/升级旧入口/恢复/养成形态历史验收。AgentPass 后置。

## 容量优化历史快照（来源与Model重构前，2026-10-08）

沿用 DOF-001/008/009。用户操作、标准 Soul、三权利、付款/供给和 UID 权限边界不变。本轮只优化视觉键查重与 Release 素材目录的排序，完整合约目标仍 active。

原默认 500 素材单测的函数跟踪显示：在第 329 个素材 Blob 注册途中耗尽累计 VM 表，已追加 320 个素材，还没有执行 finish。`large_begin` 消耗 1,639,469,455 VM 内部计量，视觉 representation 查重使用逐项 contains；锁定 stdlib 的 merge_sort_by 用移动元素合并，也会产生二次方交换量。故不能将失败归因于 finish 或链上某笔交易。默认 CLI statistics 报告上限为 50 万亿 unit-gas；此前显式 100 亿只是更低的诊断参数，并非提高预算后的失败证据。单测内部计量、CLI statistics 和实际网络 gas 不混用。

选用私有堆排序：视觉只排序 exact key 投影，再查相邻重复；原片段次序、display_order、mask 索引和完整视觉值不变。扩展同时验证旧/新键集合。Release 按 exact 32-byte digest 排序，保留二分查询及同 digest 不同 byte_length 拒绝；不引入新的对象、Witness、权限或公开写入口。备选的哈希集合会引入碰撞语义，链上 Table 会增加创建/销毁和恢复职责；两者均未采用。

7 项新场景覆盖最大 500 片段及末项重复、前缀/二进制键、扩展旧新重复、500 digest 全量查询/顺序/取消、重复 digest 字节冲突。默认完整回归 **712/711 PASS/1 TIMEOUT**，705 个原场景的名称及结果逐项保留。相同 `large_begin` 路径下降 46.36%，两次 representation 合计下降 57.71%，expected 下降 51.32%；这是函数内部 VM 计量，互相包含的数值不相加，也不宣称真实费用或完整容量通过。

当前 10 个外包案例 3 合法/7 拒绝通过；全部 172 探针未全跑。89 个输入冻结；两次生产构建的 159 个模块文件（包含依赖）逐字节相同。Core 28 个生产模块下限 **182,746 > 102,400 bytes**，发布仍失败；完整 500 Blob 累计单测仍失败，业务发布/PTB/部署 ABI 未验。证据：`output/contract-rebuild/standard-business-2026-10-08/heap-evidence.json`。手册 v1.0 §§7/8.3/8.4/9、OperatingModel8 与原卡附件适用；源码优化和执行者检查不代替独立审查。下一步仍是保留原权限的实际包边界与默认协议真实容量验证，之后全职责/养成/升级旧入口/恢复验收。

## 业务接回快照（容量优化前，2026-10-08）

当前唯一资产类型为 `soulidity_standard::soul::Soul`。业务包不再定义第二个 Soul；旧应用 facade 已改为 `soulidity_v1::character`，源码 `move/soulidity_v1/sources/character.move`。这也消除了真正外包合并未发布依赖时两个 `0x0::soul` 的模块冲突。所有现有业务调用方、测试和编译探针已换成实际标准类型，不保留旧类型 alias 或兼容发行。

原 Composition、固定 Style 的 Reference/Bound/Free、视觉/颜色/Profile、内容/授权/付费访问/Output/Loadout 等状态先由永久 `ApplicationState` 承载，安装在标准根 `animacraft` 命名空间下。它是应用模块而非资产根，私有 UID 与 private-constructor ApplicationWitness；内部嵌套 DOF 保持资产与记录。修改通过取出同 ID 状态 + 无 abilities Edit + 放回；156 个既有 public/package API 的业务校验继续执行。所有事件、Output、授权和付款 subject 引用真正 Soul ID，不引用 ApplicationState ID。Bound 所在模块不能卸下或改成 removable，Free 仍只能经合法装卸返回原对象。该聚合应用模块是业务接回增量，仍须完成合适的职责/包边界与预算验证。

根 revision 表示所有标准模块变化；应用 revision 表示 Animacraft 业务变化；Composition revision 继续表征外观变化。三者用途不同。现有 expected 参数检查应用 revision，标准 Edit 使用交易中实际根 revision/CAS。仅查询且需要持有权的接口保留外部 `&mut Soul`，内部只读，不开启 Edit 或改变根。业务 manifest 补标准 revision/hash，市场新增 `bundle_standard`：第三方扩展、原生嵌套 Soul 的变化会使整套清单摘要改变，即使原外观/应用 revision 未变。

真实 Product 的 `catalog::SoulProducer` 仅由 Catalog 构造。`mint_soul` 读取实际 Product 与不可变发布版本，检查原访问资格/配置/政策/费用、预留 cap/attempt，并完成精确 Coin 原子结算后返回标准根；Issuer 初始化永久模块并完成原内容/图片/recipe 校验。没有公开返回 Witness 或绕过付款的新发行路径。

整套市场与显式 handover 还会沿原生嵌套目录递归清理本协议的旧委托，即使中间 Soul 来自其他生产者且没有本协议应用模块。子 Soul 原身份、Bound、内容和资产保持，父目录通过标准嵌套票据刷新承诺；限制深度≤16、节点≤256，超限原子拒绝，标准 unnest/自由转移仍独立可用。它不解释未知第三方模块的授权，也不把任意 public_transfer 说成必经清理 hook。新增正例核验经过 foreign Soul 的旧委托清理与整套成交后子授权归零，反例核验超深交接拒绝。

选择依据：暴露根 UID 会绕过目录/权利；保留双 Soul 类型会形成两套权威；采用标准根 + 私有永久应用模块可以先保留原商业职责，同时让根保持只依赖 Sui、允许第三方独立接入。代价是应用 facade 的内部实现与包装函数增加字节码，目前不能据此称工程收口。

证据 `output/contract-rebuild/standard-business-2026-10-08/evidence.json`：当前默认全量 VM **705 项，704 通过，1 失败**。8 个新增业务测试通过，含真实 Product 来源、永久 Bound 边界、独立命名空间测试模块与应用相互更新、只读不改变根、嵌套 OC 编辑/退出、真正市场结算后买家取出测试扩展模块/原子 Soul。10 个真正外包编译案例通过，另以无虚构参数的 factory 探针重新核验。编译探针拒绝把模块重名/缺失/语法等结构错误冒充权限成功。

未过项：500 素材累计单测耗尽默认预算，单独 100 亿 unit-gas 诊断仍耗尽；这不是实际网络 gas 验收，也没有放宽协议。当前生产构建通过，但 **Core 包体积下限 182,779 bytes > 默认 102,400 bytes**（未计 type origins/linkage），已经证明不可发布；本业务候选未本地发布，ABI/重复发布制品/实际 PTB 仍待。88 个 source/test/manifest/script 输入已冻结；source-interface 只是源码声明，不是部署 ABI。当前 semantic 是应用维护的正文/组合承诺，不宣称递归证明每个 Table/DOF 记录。

下一步是沿当前无循环依赖图确定 value/object/application 的真实包边界，并为跨包的 private/package 入口建立不可伪造的原生证明，保持供给、付款、Bound 与私密容器边界；不能为减包体把 package-private 方法直接改成不受限 public。随后以默认协议真实发布/PTB 与大素材交易预算核验，再收齐全职责/权限/升级旧入口/恢复/形态历史证据。AgentPass 后置，SDK/前端/实站/生产均未执行。

原卡 DOF-001/005/008 的附件评审：手册 v1.0 §§1–4、6、7、8.3–8.4、9、12 与 OperatingModel8。支付与资金、持有权/模块 proof、permanent lock/正常退出、原 UI/三权利是适用项；EVM/借贷机制不适用。执行者检查不代替独立安全审查；全目标 active、Release false。重构前源码及 manifest 在本增量 `before/`，新源码/测试已有冻结；无生产或 Git 写入，回退源码不宣称回退链上状态。

## 实现与权限边界

`move/soulidity_standard` 一个生产模块，只依赖固定 Sui/MoveStdlib。`Soul has key, store` 非泛型：私有 UID、schema、名称、全根 revision、Origin、目录及交易内 editing 状态。核心不导入 Maker/Product、平台收费、Walrus、市场或全局管理员配置。

Origin 保存生产 Witness 的实际 defining type、真实源对象 ID/type、声明的版本/摘要和初始签发交易发送者。`new<W: drop, P: key>` 输入真正的 `&P`，W/P 必须在同 original package/module，且 W 为专用 SoulProducer。不能传任意 Maker ID 当证明。W 的构造由定义模块控制，版本/hash/供给/支付/版权语义仍由生产者验证；`minted_by` 是发送者，不自动等于 OC 创作者或产品原创者。

Descriptor：Witness 类型命名空间、名称、实际子 type/ID、schema、固定 removable、自动 BCS SHA3、应用 semantic hash。typed ModuleKey 构造私有。上限 64 模块/32 KiB 根/240 KiB 子 BCS，尚非全部产品容量压力验收。

| 接口 | 不变量 |
|---|---|
| new | 同定义模块 SoulProducer + 实际源对象，生产业务负责发行资格/费用/权利 |
| install | 实际可变根、准确 revision、同模块 W/T；真实 DOF 与目录同步 |
| borrow_module | 只读，核对真实类型；不返回根 UID/可变子 UID |
| uninstall | 实际可变根、准确 revision、removable=true，返回原 ID |
| begin_update / commit_update | 无 abilities Edit 绑定根/原子对象/修订；同事务归还同 ID，schema 不下降、removable 不改变 |
| descriptor / module_page | 类型隔离、上限分页；编辑期间拒绝完整清单 |
| manifest_hash / assert_manifest | domain、实际根 ID/schema/name/revision/Origin/目录，准确 revision+hash |
| nest / unnest | 真正的 Soul DOF 子对象；两颗独立身份，嵌套槽始终可取出、原 ID 退出 |
| begin_nested_update / commit_nested_update | 暂取子 Soul，在一次 PTB 更新能力后归还同一父根；同步子 BCS/manifest 承诺 |

永久应用模块可以更新，不能卸下。编辑不能替换/丢弃/转移原对象后不归还。实际可变根或实际受控容器输入才有修改权，调用方传入 owner 地址不成为授权。
`body_hash` 只覆盖对象自身 BCS，不递归证明 Table/DOF；`semantic_hash` 由应用验证自己的嵌套库存、业务和权利。NestedSoul 专用路径自动以子 manifest 为 semantic，仍继承子应用正确维护语义承诺的边界。

## OC 的持续身份：本次用户新确认

一个 OC 的童年/成年、服装、身体、人格、剧情/世界观形态和养成阶段，属于同一颗 Soul 的长期状态，不为每次变化 mint 新根。根 ID 与初始来源保持；全根修订和应用承诺随状态改变。当前核心已验证“同 ID 更新和嵌套内成长”，不宣称完整养成游戏/视觉方案已实现。

未来 Composition/Life 模块须承接：

- 稳定的 root Soul ID；form_id 是 Soul 内部的形态标识，form_revision 是形态版本。active_form 只选择当前展示形态。成长阶段、形态、衣装 Loadout、引用/库存和视觉渲染是不同状态，不互相当 NFT。
- 已保存形态不能覆盖掉历史版本。记录 parent_form/version、来源 Maker/Pack 版本、配方/视觉承诺、形成者与证据；同一 OC 的变化保持原根。游戏/AI 的外部回执必须验证签发者/目标 Soul/规则/时间/重放，持有人输入不自动成为可信经验值。
- 历史轨迹采用版本化记录/分页及确定性承诺；媒体使用内容引用。不能把完整历史堆在根或把可改 hash 宣称不可篡改历史。
- 每个 Part 当前仍一件固定 Style。不同形态可保存同一组件的选择引用，不复制同一 Free ID 发行额外资产；切换形态必须处理唯一装备与实际库存。不装备的 Free 不凭保存的形态被算进出售清单；Bound 永久属于该 Soul，卸装和历史形态切换不改变归属。
- 创作者允许的变形、色彩、布局/微调、Source/Style 许可和视觉兼容规则继续约束形态；不靠变化“长大”绕过版权/供给或生成不存在的 Style。沿用既有网页操作路径，后续页面细节按真实页面核对。
- 继承已有 Profile/Loadout/Content 的有效职责，接到单一 Composition/Life 权威；不额外搭一个与它们冲突的第二库存或第二 Soul 身份系统。

“嵌套另一颗 Soul”与“同 OC 多形态”分别处理。前者是两颗 OC/身份的持有图：父 Soul → 子 Soul → 子自己的能力/Bound/Free，可进一步嵌套。子拥有独立来源和历史；交接父根可交接真实子对象，取出子根保留其全部身份/状态。不得把子根 ID 抹掉、合并为父 OC 或复制其资产。组合清单/市场/私密实际持有核验须覆盖这种父链，不能只查一个缓存 owner。

本次保留原生 nest/unnest 和受票据约束的 nested update；已测三层组合和同 ID 退出。最大实际深度/大组合费用、准确跨层商品清单与授权路径仍待完整验收。分叉、繁殖、经验经济系统不是本次自动新增上线承诺；若产生新 OC，需要新根和可验证衍生关系，而非混称同一身份。

## 生态养成的写回边界

产品核心是持续 OC 身份与可积累经历。应用的日常互动决定养成体验；资产根提供跨应用延续、许可和交接基础。角色档案/关系/故事、陪伴记忆、剧情结果和自主生活各有不同事实来源，不能将它们都简化成一个无权限经验值。

已核对 Soul Habitat README：只读导入 source Soul 为默认；incarnation 有独立规则/余额/技能/关系/生命阶段，多次 incarnation 可有不同历史；Game Dead 不销毁源 Soul。阶段一 non-withdrawable Life Credits 是规划，不当作 Soul 上自由交易的 Coin，也不把未来实币实验并入当前发行/费用。

各应用的回写按稳定 soul_id + app/ruleset + incarnation/run_id + event_id/sequence + schema + evidence/content commitment + issuer + acceptance policy 分层。真实签发者、重复导入、目标身份、授权/用户接受、对原记录的引用都需应用验证。可查询/可信回执不自动等于跨应用通用战力；叙事文本和 AI 自述不自动成为权威状态。
“角色创建→互动/事件→形成经历→按规则确认保存→后续读取体现变化”是后续养成体验验收；本次基础接口不冒充闭环已交付。Source Soul 持有、应用 incarnation、私密读取许可和可交易组件分别管理。游戏结局不消耗源身份，成长不同形态不改发行总量，嵌套其他 OC 不抹去其身份。

## 决策与反例

1. 来源的任意 ID 方案不可验证；全平台白名单会排除独立生产者。采用私有模块 Witness+真实源对象，业务规则在生产者边界。
2. 可变 UID 会绕过清单；永久对象无票据返回会破坏绑定。采用不可复制/丢弃/保存的 Edit，绑定确切根和原 ID。
3. Move 内部 `&mut Soul` 可组合，但 PTB 返回引用实际失败 `InvalidPublicFunctionReturnType`。容器使用同事务 `withdraw → update → manifest → deposit`；同类型 Soul 嵌套使用 `begin_nested_update → 应用更新 → commit_nested_update`。不向核心反向导入下游应用。
4. key+store 支持自由转移，DOF 没有通用转移 hook。严格私密转移撤销/AgentPass 仍须授权适配层独立验证。

技术依据：[Sui DOF](https://docs.sui.io/develop/objects/dynamic-fields)、[Mysten 无 abilities 临时凭证说明](https://github.com/MystenLabs/sui-move-bootcamp/blob/main/C1/README.md)。实现按锁定 framework commit `2a0becb2fcc6989e492981104af67f62f2c9511a` 验证，文档不是验收证明。

## 当前证据与剩余项

首版证据 `output/contract-rebuild/standard-kernel-2026-10-08/`：19/19 核心、6/6 组合测试；10 个真实外包编译正反例；4 包真实本地发布；17 笔验收交易（13 成功/4 预期失败）及 1 笔引用返回实验失败。准确 type/source、DOF、原 ID、child BCS SHA3/目录和钱包读回通过；4 包重复模块及依赖一致。引用失败没有前快照，单独保留失败后状态，不能混称所有失败都有前后快照。

历史含嵌套版本证据（来源标记加强前） `output/contract-rebuild/standard-identity-2026-10-08/`：24/24 核心；实际本地 Compatible 升级增加接口、新 NestedSoulWitness 在升级包定义、旧类型 origins 与既有对象内容/持有保持。旧生产者仍可发行同一个原标准类型、旧能力应用可更新嵌套子 Soul；子 manifest/BCS 独立重算，与父目录一致。10 笔交易（7 成功/3 预期失败），含嵌套成长、错误新根替换原根拒绝、整套交接、取出原子 Soul/原组件；Maker 计数在失败新发行后回滚；客户端 Pure BCS 伪造生产者 Witness 被实际拒绝。

以上网络为隔离 chain1544de63 / protocol137，未调整协议大小限制。原 Standard 包 4411 字节，当前升级包实测见 evidence.json。不是 mainnet 放行、全产品验收或外部审计。最新测试/反例/制品的确切候选见当前证据，不将旧 688 等全量数字算作当前通过。

仍缺：全部业务 Composition/形态/历史/视觉、Ref/Bound/Free、Maker/Pack/Complete/资金/内容/市场/私密/配套接回；完整当前 Core 回归与发布；不兼容格式迁移、旧入口阻断、共享争用、恢复、独立安全审查/外审。新独立核心不自动使原 Catalog 已完成迁移。旧 Soul 工作稿未部署，目标完成前必须消除重复资产 authority，不加 legacy issuer/fallback。

手册 v1.0 §§1–4/6/7/8.3–8.4/9/12；Operating Model §8；原产品工程评审模板。增量为 Code/Build/Test，Release 未通过；Owner/验收责任沿用 DOF-001。Sui 权限/abilities/PTB/退出适用且有上述局部证据；全目标资金/治理/升级仍待核验，不能借原型不收钱将其全局写不适用。EVM/借贷机制本增量不适用；当前为执行者自检，独立/外部审查未执行。

下一步：将现有 Composition/Bound/Reference/Free/视觉/形态状态变为标准 Soul 的永久应用扩展，实际 Catalog 内部签发生产者 Witness 并核验资格/支付/发行票据；所有用户操作和测试使用唯一标准 Soul 类型。完整搬回其余职责后，按原规格逐项放行。未知交易结果只查询原 digest，不重放；局部源码 before 保留、生产未变更，无 commit/push/PR。

## 本轮核心判断：同一OC的连续性

产品核心是同一个OC的持续身份及可携带状态与权利。Soul为资产载体；Maker生产、组件扩展、应用使用并按持有人或限定授权反馈。DOF是扩展托管机制，本身不定义身份、语义、版权或写入权限。标准核心限制为身份／来源／模块发现／安全更新／组合清单；视觉、人格记忆、经历、关系、能力分别属于应用模块，不要求所有Soul携带全部玩法。统一身份下的不同形态应表达为该Soul的状态／形态；另一个Soul嵌入仍是独立资产身份，不能按包含关系自动合并。评判新增方案时检查身份连续、授权明确、变化可追溯、独立第三方只依赖标准集成，而非用包数量衡量解耦。本说明不声称完整养成体验已完成，也未变更现有ABI。


### Native current issuer and Standard Publisher source increment (2026-10-10)

Config keeps source revisions in a private typed DF: actual canonical Registry, private producer/revision values, real Admin while disabled, CAS, module Publisher and latest UpgradeCap. Native prepare/root/consume/begin/finish enforce the selected revision; Claim/State/Origin preserve issuer snapshots. Old entry rejection follows explicit revision registration, not an automatic raw UpgradeCap hook. Standard adds its own SOUL OTP Publisher init without market rules or reverse application dependencies. Existing Standard v1 has no Publisher; upgrade init does not rerun, so the next local target must have one coherent fresh Standard lineage. Empty TransferPolicy construction proves type ownership only; actual canonical business rules, locked Kiosk TransferRequest, original royalty and exits remain pending. Evidence: output/contract-rebuild/native-revision-guard-2026-10-10/REVIEW_CN.md and verification-evidence.json. 1135 Core/26 Standard VM and384 foreign per-source cases, four two-build default budgets4882/23117/10430/101771 (Core margin629); no node/sign/publish. Unit revision models are not actual upgrades. 69/1528 duties reviewed,1459 pending,all30partial,Release/fullgoal false.
