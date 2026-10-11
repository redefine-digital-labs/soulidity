# 完整生成流程 Bug 评审清单

更新：2026-10-06。用户已评审并明确“搞吧”，现恢复修复；既有候选与证据保留。原39项及新增BUG-040均已录入[Slack Bug表](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ)，16项开放问题已批准修复／复验，24项已关闭问题保留回归。

范围：本次统一发布以来S13与当前生成流程候选，交叉核对CURRENT、SPRINT_13、AC PR58–81、相关PR57测试修复、SO PR33、GitHub #67及独立审查。未对所有历史版本进行全库漏洞审计。GitHub #67仍开放；SO仓库此次查询没有Issue，不代表没有Bug。

共40项：24项有对应范围关闭证据；16项开放，其中7待线上复验、6待发布、2修复中、1待分诊。测试基础问题单独标注，不冒充线上事故。

最新沟通规则：只修改现有研发/Bug两张Slack表，不再向频道发送进度消息。

已证实的问题主要在前端编排、SDK/链读回映射、持久恢复及上传集成；现有ABI存在创建/激活阶段边界，但不能据此断言合约有Bug或承诺全部只签一次。Quilt已用官方SDK验证编码/读取，尚无真实上传服务端故障证据；当前缺口是我们的端到端接入。

## 当前执行（2026-10-06，以此段为准）

- **WIP=1：当前主线是 F02/BUG-006，BUG-040 仅作为发布依赖收口，不继续扩展。** 按用户要求，一个 Bug 修复、验证、更新原记录后，再推进下一项。完整 M1–M4 是待办范围，不代表并行施工。
- 当前阶段 Test／修复中：Chrome 启动就绪握手已补齐，196 项重点测试通过；全量9-worker运行暴露 Runtime.evaluate4s 超时（12332通过、16因初始化失败未执行），随后 maxWorkers2 完整583套／12348项全部通过、零跳过；未扩大业务超时或删减断言。
- BUG-040 为何先做：它阻塞现有上传修复候选的必需 CI，不能把偶尔绿灯当稳定门禁。退出条件是本地完整通过、原PR必需检查及准确候选Linux配对CI通过，再记录该测试基础问题的关闭证据；它不等于上传产品已验收。
- 之后按下方已批准顺序逐项验收 BUG-014 → BUG-013 → BUG-006 等。已有修复保留，正式部署与真实旅程证据未满足前不关闭这些产品 Bug。

## 已批准修复的当前问题与新候选问题

| ID | 问题 | 状态 | 建议优先级 |
| --- | --- | --- | --- |
| [BUG-003](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6SSGKYF8) | 后继创建成功后把旧Root和新Root混算 | 待线上复验 | P1 |
| [BUG-004](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6SSGT7PY) | 后继已经创建，下一步仍要求前身未被使用 | 待线上复验 | P1 |
| [BUG-005](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE3D15M) | 每次签完都停住，反复要求手动Continue | 待发布 | P1 |
| [BUG-006](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFYRPCL) | 多文件上传按PNG逐个登记与认证，体验阻塞 | 待发布 | P1 |
| [BUG-007](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE40N15) | Sui发布被前端拆成过多小交易 | 待发布 | P1 |
| [BUG-008](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C7P6RPA3A) | 引入批量激活会改变已持久化首笔交易 | 待发布 | P1 |
| [BUG-009](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C7P6RMAF2) | Player完成流程遇到持久存储许可拒绝 | 待分诊 | P1 |
| [BUG-013](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W27PZGA) | Quilt 加密素材在 Soulidity 读取校验与 Pack 授权构建中被拒绝 | 待发布 | P1 |
| [BUG-014](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U8178S2) | 旧标签页改变素材状态后重组批次，遗留已签 Quilt 并要求再次付款 | 待发布 | P1 |
| [BUG-018](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W21HRFC) | 新确认：gRPC错误拒绝系统包合法零依赖版本 | 修复中 | P1 |
| [BUG-040](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QRXT03D) | CI浏览器启动/清理超时及旧会话访问 | 修复中 | P2 |

## 历史已部署、专项复验证据尚缺

这些行不表示生产仍必然失败；历史修复已经合入，缺的是相应完整真实路径或并发/失败专项证据。

| ID | 问题 | 仍缺什么 |
| --- | --- | --- |
| [BUG-033](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q06LF35) | 全局未限定发布attempt可能混用稿件／当前编辑 | 跨稿/钱包/版本/编辑切换与冷恢复不混入；待纳入新整流程复验。 |
| [BUG-034](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q06NATD) | 旧接口一次动作可能连续触发多阶段签名，审核边界不清 | 拒签、重入、切页、旧review、跨钱包不会开启未审核新签名。 |
| [BUG-035](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U840CUW) | Walrus数据库版本升级被旧标签阻塞时缺少可操作诊断 | 真实多标签阻塞/解除后冷恢复原记录；不清库解决。 |
| [BUG-036](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QTBFE77) | 发布未完成时可能提前投射Root为可交付结果 | 中间Scaffold、未知、失败都不冒充发布；最终ACTIVE准确。 |
| [BUG-037](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ER4G27R) | 同钱包不同稿件共享上传时互斥范围不足 | 跨稿共享资源、并发签/恢复和CAS专项复验；同时保留014负例。 |

## 已关闭的历史问题（保留回归）

| ID | 问题 | 修复版本 |
| --- | --- | --- |
| [BUG-001](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFWJTFW) | 合法 gas payment=[] 导致发布审核被拒绝 | PR78／main67c5f382；已部署 |
| [BUG-002](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE31DC7) | 发布步骤高亮与资源上传状态互相矛盾 | PR79／main1c0bd125；已部署 |
| [BUG-010](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFYTYAY) | 原始PNG尺寸／中心定位和导出保真回归 | 历史AC#59／SO#32配对修复；已正式实测 |
| [BUG-011](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6WPEM5BK) | 公共目录把Manifest哈希当成内容承诺 | PR71／mainb0fa0206；已部署 |
| [BUG-012](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6PGBL5RT) | 完成预检失败后，即使登录修复也无法重试 | PR75／mainc38c857e；已部署 |
| [BUG-015](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ZSXDQJY) | Walrus relay 小费固定上限过低，发布准备失败 | AC PR61 / e52d419e；https://github.com/redefine-digital-labs/animacraft/pull/61 |
| [BUG-016](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q04P7EF) | SDK交易过期格式不匹配，上传／发布签名前被拒绝 | AC PR62 / d7a24996；https://github.com/redefine-digital-labs/animacraft/pull/62 |
| [BUG-017](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U81J5V4) | Walrus认证成功后因u256和Base64URL混比而读回失败 | AC PR63 / e94aa1ef；https://github.com/redefine-digital-labs/animacraft/pull/63 |
| [BUG-019](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U81TB0W) | 发布私有读回多出owner字段，严格compiler schema拒绝成功对象 | AC PR65 / e4d0076e；https://github.com/redefine-digital-labs/animacraft/pull/65 |
| [BUG-020](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y4Z2RS5) | 发布持久化ABI白名单错误拒绝合法Option／typed vector构造器 | AC PR66 / c18ad440；https://github.com/redefine-digital-labs/animacraft/pull/66 |
| [BUG-021](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y4Z9FUZ) | 后续交易复用创建时AdminCap版本，链上输入已过期 | AC PR68 / 5d4d5bae；https://github.com/redefine-digital-labs/animacraft/pull/68 |
| [BUG-022](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U825WT0) | MarketTreasury字段escrow被错误读取成balance_atomic | AC PR69 / 0b0d59ae；https://github.com/redefine-digital-labs/animacraft/pull/69 |
| [BUG-023](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ER2QNLF) | 最终激活读回仍要求过时的Root扁平commitment | AC PR70 / e050039c；https://github.com/redefine-digital-labs/animacraft/pull/70 |
| [BUG-024](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U8249HU) | 公开Player控制器schema落后于目录返回，Start making失败 | AC PR72 / 6bf60c3a；https://github.com/redefine-digital-labs/animacraft/pull/72 |
| [BUG-025](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W29BUSW) | Player读取从未发出的能力字段，Complete一直禁用 | AC PR74 / 07bf59cc；https://github.com/redefine-digital-labs/animacraft/pull/74 |
| [BUG-026](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q064VH9) | Soulidity未启用Slush网页钱包，接收方无法同钱包登录 | SO PR33 / 4a0c1b0e；https://github.com/redefine-digital-labs/soulidity/pull/33 |
| [BUG-027](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U82MBHC) | 编辑后的稿件再次发布错误复用旧COMPLETE记录 | AC PR73 / bd70440c；https://github.com/redefine-digital-labs/animacraft/pull/73 |
| [BUG-028](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q0629JP) | 后继审核显示前一版本的完成资源数和继续提示 | AC PR76 / 4621d3bd；https://github.com/redefine-digital-labs/animacraft/pull/76 |
| [BUG-029](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QTB145T) | 尚未询价的购买资格被显示成拒绝／不可用 | AC PR77 / e2b94428；https://github.com/redefine-digital-labs/animacraft/pull/77 |
| [BUG-030](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q0679GT) | ACTIVE公开Maker的Copy／Share入口不可用 | AC PR77 / e2b94428；https://github.com/redefine-digital-labs/animacraft/pull/77 |
| [BUG-031](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y50B5TK) | 导出Original／透明背景偏好在冷重开后丢失 | AC PR58 / 592699af；https://github.com/redefine-digital-labs/animacraft/pull/58 |
| [BUG-032](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y50P80H) | Creator显示Ready但Publish按钮无可执行入口 | AC PR60 / b827c3c6；https://github.com/redefine-digital-labs/animacraft/pull/60 |
| [BUG-038](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ZT018AG) | 异步哈希完成时机用事件循环次数猜测，验收测试偶发失败 | AC PR57 / ae2dc444；https://github.com/redefine-digital-labs/animacraft/pull/57 |
| [BUG-039](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y515QL9) | 新增文案未同步精确测试清单，导致候选CI误失败 | AC PR60/73/77 门禁修复已合入；https://github.com/redefine-digital-labs/animacraft/pull/60 |

当前已推送候选：AC [PR82](https://github.com/redefine-digital-labs/animacraft/pull/82) `a6ac9472`；SO [PR34](https://github.com/redefine-digital-labs/soulidity/pull/34) `d3e8ee2f`（新准确配对CI 37410729140 / 37410730737 运行中）。前一版 a6ac9472/d67cfea4 准确配对 CI `37374789340 / 37374793633` 通过，配对源码凭据与33项Move制品检查通过。SO R3预部署云输入和169项不可变读回通过；正式域名未推广。

后续BUG-040七文件修复已本地全量通过并推送，当前等待新源Linux CI；不能沿用上述旧源码CI。AC自动PR检查runner中止后，仅重跑失败任务；SO自动PR检查四套启动超时已有单独复现。此前版本和证据保留在后文历史记录。

## 已批准执行顺序

1. BUG-014：固定批次和已签操作身份，避免重新收费及遗留交易。
2. BUG-013：补齐加密素材从AC输出到SO读取/授权构建的全链校验。
3. BUG-006：整合批量上传、报价、进度和恢复，单个素材校验保持准确。
4. BUG-005/007/008：自动继续已签操作、进一步合并可组合交易、保持已有交易冷恢复。
5. BUG-003/004/018/033–037：用整合候选复验创建/后继/读回/多标签与异常边界。
6. BUG-009：在指定Chrome定位持久存储问题，不能拿IAB环境限制代替Chrome结论。
7. 统一验证后发布、干净初始化；从零上传→发布→Complete→SO同一Soul→刷新确认。仍不以其中一个PR或测试数关闭整条目标。

## 尚未验收，但不能直接称为已复现Bug

- 全新真实素材上传至ACTIVE，再Complete并接收同一新Soul：当前完整旅程尚未通过。
- Pack/Composable免费付费资格、四类完成政策、额度/费用、真实Seal解密与恢复。
- 同一Soul装备/替换/卸下、私密Loadouts、Showcase；Market选中资产交易、转手权限。
- 实体移动设备、原生OS分享、跨设备恢复、存储失败、网络中断和最终运维演练。
- SO SDK及web类型检查已通过；完整发布门禁仍以准确双候选CI结果为准。原desktop/Prisma本地准备问题已解决，不再列为当前阻塞。

## 逐项依据与建议修法

### BUG-001 合法 gas payment=[] 导致发布审核被拒绝

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：原作者Chrome／主网；PR78之前
- 现象：Review／归档审核在签名前报TransactionData envelope错误，实际SDK生成的同一交易模拟可通过。
- 预期：合法交易可审核；错误signer、gas owner、预算、expiry仍拒绝。
- 已知原因／建议修法：前端错误要求gas coin列表非空；支持address balance支付的合法空列表，保留其余校验。
- 版本：PR78／main67c5f382；已部署
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/78；原Chrome Review→取消实测通过；证据assets/address-gas-review-2026-10-04。
- 关闭条件：同一原作者Review可用，取消后稿件／Root未改变，零签名广播。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFWJTFW)

### BUG-002 发布步骤高亮与资源上传状态互相矛盾

- 状态：已关闭；线上实测；S3 体验问题；P2。评审决定：保留回归。
- 复现环境：原作者Chrome；旧四阶段界面
- 现象：显示step3/4，但第二步仍in progress，报价未出且0/11certified，用户无法判断当前步骤。
- 预期：主阶段、资源子状态、待签／恢复动作一致。
- 已知原因／建议修法：统一为准备／存储／发布三阶段；已签恢复不显示空报价，文案随真实检查点更新。
- 版本：PR79／main1c0bd125；已部署
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/79；原Chrome刷新→重开→同检查点继续，资源1/11→2/11时保持存储阶段。
- 关闭条件：原窗口刷新和恢复显示准确；不把此UI修复等同批量上传。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE31DC7)

### BUG-003 后继创建成功后把旧Root和新Root混算

- 状态：待线上复验；线上实测；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：原作者Chrome／主网后继发布
- 现象：scaffold链上SUCCESS后报OBJECT_CHANGE_INVALID，无法继续；effects同时含旧mutated和新created同类型对象。
- 预期：识别准确新Root／AdminCap，查询原交易恢复，不重新发行。
- 已知原因／建议修法：按created effects识别新对象，旧predecessor单独校验。
- 版本：PR80／mainfff376c8；已部署
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/80；本地旧mutated＋新created回归通过；线上继续暴露BUG-004。
- 关闭条件：重新初始化后的后继旅程创建→读回→下一步成功；未知状态不重复签名。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6SSGKYF8)

### BUG-004 后继已经创建，下一步仍要求前身未被使用

- 状态：待线上复验；线上实测；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR80原作者Chrome／同一后继检查点
- 现象：scaffold成功后Base准备报MAKER_V8_SUCCESSOR_PREDECESSOR_DRIFT。
- 预期：已认证的新Root沿同一发布继续，签名前仍拦截真实前身漂移。
- 已知原因／建议修法：前置校验没有区分scaffold前后；以已认证scaffold为阶段边界。
- 版本：PR81／main104f7124；当前生产
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/81；本地v1/v2创建后继续与冷恢复通过，原后继链路未完成线上复验。
- 关闭条件：同一后继创建→Base→冷恢复不误拒绝；未签前真实漂移仍拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6SSGT7PY)

### BUG-005 每次签完都停住，反复要求手动Continue

- 状态：待发布；线上实测；S2 功能异常；P1。评审决定：批准修复。
- 复现环境：当前生产Chrome；本地修复已验证
- 现象：钱包签名保存后仍停在Signed／Continue；用户需要重复点击推进上传和读回。
- 预期：已签交易自动继续至下一项需要用户签名的审核或明确异常。
- 已知原因／建议修法：app只执行一次动作；增加有界续行，绑定原交易、页面代次、钱包和稿件。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：publication-flow-integration-2026-10-05：完整4392／4392；切页面／钱包／稿件、稳定未知结果停止等回归通过。
- 关闭条件：部署后实测签名→自动上传／读回，下一新签名停在审核；刷新不重复付费。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE3D15M)

### BUG-006 多文件上传按PNG逐个登记与认证，体验阻塞

- 状态：待发布；线上实测；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：全新稿件7Parts／9PNG；当前生产
- 现象：从空白上传发布仍逐文件要求登记和认证；曾跳到10/11是旧PNG复用，不是批量签名。
- 预期：同一批素材一起上传；报价、进度、失败恢复都准确，AC/SO逐张读取不丢图。
- 已知原因／建议修法：前端逐资源注册/认证；改Quilt资产组，Living Content和Manifest保留独立真实Blob；须补齐013读取和014固定批次成员。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：批量上传/WAL 25项、界面/桥接156项通过；AC全量4404/4404、SO全量12339/12339本地通过，准确配对CI及线上整流程未通过验收。
- 关闭条件：全新素材批量登记→上传→认证→发布→AC/SO渲染；断网／刷新不重扣；不能靠旧缓存跳过。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFYRPCL)

### BUG-007 Sui发布被前端拆成过多小交易

- 状态：待发布；线上实测；S2 功能异常；P1。评审决定：批准修复。
- 复现环境：真实九PNG配置本地编译；合约源码核查
- 现象：既有41Base行及多lane追加／封存／激活逐段签名；该作品Sui发布13笔。
- 预期：容量允许的操作合成一笔，超限才分片，原子失败不显示虚假进度。
- 已知原因／建议修法：多数边界是前端固定checkpoint；ACTIVATION_COMPLETE将四lane及最终激活合并。创建Root与激活仍有真实ABI边界。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：完整4392、相关139通过；该作品Sui发布本地13→7笔，最后7→1；不含Walrus上传及Complete。
- 关闭条件：真实候选预检＋钱包＋链读回ACTIVE，失败／未知恢复；大作品分片正确。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6DE40N15)

### BUG-008 引入批量激活会改变已持久化首笔交易

- 状态：待发布；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：独立代码审查发现的候选回归；未上线
- 现象：新builder默认合并，使已有首笔SEAL checkpoint重建为COMPLETE，字节不符而无法恢复。
- 预期：已有READY／SIGNED／未知交易保持原拓扑与字节；新准备才选择合并。
- 已知原因／建议修法：从durable current读取阶段重建，仍精确比较完整descriptor和TransactionKind。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：独立review发现；新增durable first serial activation完整冷恢复通过；伪造checkpoint／省略lane写入被拒绝。
- 关闭条件：原串行首笔的冷恢复、链成功但未认证恢复及新合并路径都通过；不放宽校验。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C7P6RPA3A)

### BUG-009 Player完成流程遇到持久存储许可拒绝

- 状态：待分诊；线上实测；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：历史IAB／OC2；正确Chrome完整新流程尚未复验
- 现象：接收方登录后可重试，但持久浏览器存储许可拒绝仍阻断正式Complete。
- 预期：指定Chrome可安全保存待签与恢复记录，然后完成并接收同一Soul。
- 已知原因／建议修法：历史环境限制已观察；尚不能推断Chrome相同。先在新完整旅程复现，保留durable恢复要求。
- 版本：未确认当前Chrome修复版本
- 证据：S13-F02-Q记录：Ready to receive后存储许可拒绝；不能以IAB结果代替Chrome。
- 关闭条件：正确Chrome新作品Complete→SO同SoulID→刷新，不重复铸造或扣额。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C7P6RMAF2)

### BUG-010 原始PNG尺寸／中心定位和导出保真回归

- 状态：已关闭；线上实测；S2 功能异常；P1。评审决定：保留回归。
- 复现环境：2026-10-03正式配对部署；2026-10-05新稿上传
- 现象：原尺寸与定位处理回归，需验证保存重开和导出像素不漂移。
- 预期：保留素材字节、确认坐标、原始尺寸和导出偏好。
- 已知原因／建议修法：原生PNG几何与定位链路修复；复用原编辑和渲染。
- 版本：历史AC#59／SO#32配对修复；已正式实测
- 证据：SPRINT_13 S13-F01-B：完整RGBA独立比对、冷重开和ZIP相同；新7Parts/9PNG哈希、(112,112)坐标、Player通过。
- 关闭条件：该桌面几何缺陷原操作已验；完整移动／全部Creator矩阵仍由DEV-001追踪。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6YFYTYAY)

### BUG-011 公共目录把Manifest哈希当成内容承诺

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：已发布ACTIVE Maker；PR71之前
- 现象：链上发布成功，Plaza／Player／lineage仍报SHA/content mismatch。
- 预期：正确验证不同域的manifest hash与semantic content，已发布作品可发现和打开。
- 已知原因／建议修法：前端错误比较两种不同承诺；按各自来源独立推导与验证。
- 版本：PR71／mainb0fa0206；已部署
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/71；原Plaza/search/detail正式实测通过；Player后续独立问题单独修复。
- 关闭条件：同一已发布Root目录发现和详情正确；不代表Complete已验收。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6WPEM5BK)

### BUG-012 完成预检失败后，即使登录修复也无法重试

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：原OC2；接收方SO登录已成功
- 现象：旧失败被投射成永久completionIssue，关闭重开后Complete仍disabled。
- 预期：同一OC可重试预检，保留原尝试和所有签名／权限门禁。
- 已知原因／建议修法：app错误把操作错误当硬门禁；恢复同输入重试，不startNew。
- 版本：PR75／mainc38c857e；已部署
- 证据：https://github.com/redefine-digital-labs/animacraft/pull/75；实际第二次Continue无锁死，Ready to receive；随后独立BUG-009仍开放。
- 关闭条件：原失败预检可再次执行且不新增Soul／费用；后续存储问题单列。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6PGBL5RT)

### BUG-013 Quilt 加密素材在 Soulidity 读取校验与 Pack 授权构建中被拒绝

- 状态：待发布；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：批量上传候选；尚未上线
- 现象：50字符Quilt patch通过下载入口，但共享Seal元数据校验仍要求43字符；修该处后Pack授权builder仍拒绝。
- 预期：Base／Owned Base／Pack加密素材均能校验和解密；Soul完成凭证仍只接受原始Blob。
- 已知原因／建议修法：新地址类型未贯穿shared validator及SDK Pack builder。建议资产地址单独解析，严格保留原始Soul Blob门禁。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：SDK规范ID解析、Pack构建及公共/加密读取已修；SO重点96项及关联164项通过，错误patch/完整性反例保留，完整12339项本地通过。真实Seal和线上读取仍待验。
- 关闭条件：三个装备来源patch读取/实际Seal解密、错误patch与内容拒绝；Complete不得误接受patch。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W27PZGA)

### BUG-014 旧标签页改变素材状态后重组批次，遗留已签 Quilt 并要求再次付款

- 状态：待发布；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：独立复现的未上线候选回归
- 现象：先有一份未签单文件记录→签三素材Quilt→旧标签完成该单文件→重新准备变成两素材新Quilt，原三素材批次仍RECOVERY_REQUIRED。
- 预期：继续同一已签批次，先查询结果；成员变化不得触发替代付费批次。
- 已知原因／建议修法：每次inspect依据可变单文件状态重算成员。建议先持久固定本次发布的分组成员与上传身份，再审核/签名。
- 版本：AC PR82 `c11be34b` / SO PR34 `468acb91` 配套候选已提交推送；尚未合并／部署。
- 证据：持久固定批次与同事务WAL revision更新已实现；旧审核拒绝、先签单文件保留、冷恢复幂等及写失败原子回滚25项通过；独立复核未见P1/P2。原复现作为负例保留。
- 关闭条件：跨标签旧审核、未知交易、冷恢复及成员漂移回归，原group始终可恢复且不产生替代支付。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U8178S2)

### BUG-015 Walrus relay 小费固定上限过低，发布准备失败

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR61之前真实Chrome
- 现象：relay要求2579480 MIST，硬编码上限1000000导致准备失败。
- 预期：准确动态报价在合理有界上限内可审核，超限拒绝。
- 已知原因／建议修法：前端固定上限过低；已改有界0.01 SUI每Blob ceiling，不代表总价。
- 版本：AC PR61 / e52d419e；https://github.com/redefine-digital-labs/animacraft/pull/61
- 证据：SPRINT_13 F02-B/C；后续同站准确报价和实际登记通过。
- 关闭条件：原准备错误消失；保留动态报价、边界/超限拒绝；批量总价另验。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ZSXDQJY)

### BUG-016 SDK交易过期格式不匹配，上传／发布签名前被拒绝

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR62之前真实Chrome
- 现象：Publish预检后出现Invalid transaction expiration。
- 预期：合法ValidDuring可审核，过期/错误链/随机数异常仍拒绝。
- 已知原因／建议修法：接入有界ValidDuring、完整主网genesis和CSPRNG nonce，保存原签名字节。
- 版本：AC PR62 / d7a24996；https://github.com/redefine-digital-labs/animacraft/pull/62
- 证据：SPRINT_13 F02-C/E；后续实际register/certify成功。
- 关闭条件：真实审核/登记/认证通过；恢复不重建已签交易。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q04P7EF)

### BUG-017 Walrus认证成功后因u256和Base64URL混比而读回失败

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR63之前真实已付款交易
- 现象：登记/认证链上均成功，前端MAKER_V8_WALRUS_CERTIFICATION_INVALID。
- 预期：认证原交易后继续，不重新上传/收费。
- 已知原因／建议修法：SDK返回十进制u256，持久ID为Base64URL；使用官方转换再精确验证。
- 版本：AC PR63 / e94aa1ef；https://github.com/redefine-digital-labs/animacraft/pull/63
- 证据：SPRINT_13 F02-E/F；原检查点恢复到1/3，随后2/3，未重复登记。
- 关闭条件：同一已成功交易恢复；错误/溢出ID、尺寸/内容差异仍拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U81J5V4)

### BUG-018 gRPC package与Balance／TypeName等真实返回结构和前端假设不一致

- 状态：修复中；线上实测；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR64前Core证据错误；相关Native分支只读核验
- 现象：缺可选originalId导致package证据被拒；Native Balance/TypeName/新对象零引用投射也不一致。
- 预期：从实际字节证据证明类型来源，字段投射与BCS一致。
- 已知原因／建议修法：错误依赖可选protobuf originalId；改Move self-handle来源证明及精确声明字段投射。
- 版本：AC PR64 / 1bf24f05；已部署；https://github.com/redefine-digital-labs/animacraft/pull/64
- 证据：原Chrome Core阻塞已消失；Mainnet只读activation/native/恢复通过，完整Native生成仍未实际验收。
- 关闭条件：原Core路径保留通过；从零Complete和SO同Soul流程证明所有关联Native投射。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W21HRFC)

- 2026-10-05新增复现：真实0x2系统包的linkage依赖版本为显式0，前端错误要求正数；官方MovePackage::new_system确认零值语义。两文件最小修复27gRPC＋223原生权限测试通过；主网身份/协议137/系统包读取已单独通过，零写入。现有10个应用包无零依赖版本，正版本及精确身份约束保留。
- 新修复已提交2ffb167并包含于PR82/a6ac9472，尚未正式上线；固定历史交易smoke因节点裁剪返回PINNED_TRANSACTION_PRUNED，不冒充整项通过。

### BUG-019 发布私有读回多出owner字段，严格compiler schema拒绝成功对象

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR65前Scaffold成功后
- 现象：MAKER_V8_FIELDS_INVALID；通用读回的owner进入只允许type/reference/fields的compiler DTO。
- 预期：历史证据先完整验证，再按发布私有schema投射；Native custody仍保留owner。
- 已知原因／建议修法：发布适配边界精确投射三字段。
- 版本：AC PR65 / e4d0076e；https://github.com/redefine-digital-labs/animacraft/pull/65
- 证据：CURRENT F02-G/H：同Chrome原Fields错误消失，随后暴露独立ABI构造器错误。
- 关闭条件：Scaffold/Base/Companion/Activation投射正确；owner/version/digest负例拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U81TB0W)

### BUG-020 发布持久化ABI白名单错误拒绝合法Option／typed vector构造器

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR66前原发布恢复
- 现象：MAKER_V8_PUBLICATION_TARGET_INVALID，资源已认证、Scaffold已成功却无法推进Base。
- 预期：合法准确compiler构造器可持久恢复，未知target仍拒绝。
- 已知原因／建议修法：仅绑定精确Option/typed vector构造流程，并校验末尾Walrus epoch证据。
- 版本：AC PR66 / c18ad440；https://github.com/redefine-digital-labs/animacraft/pull/66
- 证据：CURRENT F02-H/I：部署后原WAL恢复并实际Base append成功。
- 关闭条件：真实compiler→store→冷恢复及负例；合法构造器不误拒。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y4Z2RS5)

### BUG-021 后续交易复用创建时AdminCap版本，链上输入已过期

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR68前Base append成功后
- 现象：下一步CHAIN_ACTION_FAILED；提供1033952570而链已推进到1033952571。
- 预期：使用上一已认证交易的准确输出引用，已签历史字节不变。
- 已知原因／建议修法：传播finalized owned refs；仅精确证据允许修复未签旧cursor。
- 版本：AC PR68 / 5d4d5bae；https://github.com/redefine-digital-labs/animacraft/pull/68
- 证据：CURRENT F02-I/J；部署后同WAL BaseSeal及Companion实际SUCCESS；GitHub #67总体验收仍开放。
- 关闭条件：原下一步成功；伪造owner/control/ref、旧签名字节和CAS漂移仍拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y4Z9FUZ)

### BUG-022 MarketTreasury字段escrow被错误读取成balance_atomic

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR69前Companion已成功
- 现象：MAKER_V8_COMPILER_FIELD_MISSING；实际Move字段escrow:Balance。
- 预期：准确投射余额，恢复原成功交易。
- 已知原因／建议修法：限定Treasury准确类型，将规范u64 escrow映射到balanceAtomic，拒绝影子字段。
- 版本：AC PR69 / 0b0d59ae；https://github.com/redefine-digital-labs/animacraft/pull/69
- 证据：CURRENT F02-J后同Chrome已通过Seal/Runtime/Output并最终Activation；实际九对象只读读回通过。
- 关闭条件：同成功Companion恢复；非零/坏值/旧影子字段拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U825WT0)

### BUG-023 最终激活读回仍要求过时的Root扁平commitment

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR70前最终激活
- 现象：嵌套Root commitment被按旧扁平字段读取，最终步骤失败。
- 预期：准确验证嵌套四类commitment，显示真实ACTIVE。
- 已知原因／建议修法：复用现有精确Root投射。
- 版本：AC PR70 / e050039c；https://github.com/redefine-digital-labs/animacraft/pull/70
- 证据：CURRENT F02-L：原FINALIZE Ei1i链上成功，Chrome Published/4/4 Complete，Root ACTIVE；后续目录bug另列011。
- 关闭条件：同Root最终读回一致，错误commitment仍拒绝。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ER2QNLF)

### BUG-024 公开Player控制器schema落后于目录返回，Start making失败

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR72之前；目录可用但Player不可用
- 现象：Start making报严格shape错误，且仍有Manifest/content错误等同。
- 预期：准确目录视图可进入Player，所有证据仍各自核验。
- 已知原因／建议修法：同步已认证字段集，独立验证两类承诺、metadata和registry ID。
- 版本：AC PR72 / 6bf60c3a；https://github.com/redefine-digital-labs/animacraft/pull/72
- 证据：SPRINT_13 F02-M：正式Start making/Preview ready、helmet可见、重开通过。
- 关闭条件：真实公开Player载入/渲染/重开；直接路由冷恢复未据此宣称通过。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U8249HU)

### BUG-025 Player读取从未发出的能力字段，Complete一直禁用

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR74前公开Player
- 现象：Certified living-content binding unavailable；实际配置存在，bridge没发旧字段。
- 预期：真实Native依赖配置可用才开放预检；缺失/关闭/销毁继续拒绝。
- 已知原因／建议修法：通过生产factory/bridge投射实际Native provider，删除过时能力判断。
- 版本：AC PR74 / 07bf59cc；https://github.com/redefine-digital-labs/animacraft/pull/74
- 证据：CURRENT F02-N：正式Preview/export通过、旧报错消失，Continue可用并进入接收方预检。
- 关闭条件：预检恢复可进入；错误依赖仍拒绝；完整生成不因此关闭。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6W29BUSW)

### BUG-026 Soulidity未启用Slush网页钱包，接收方无法同钱包登录

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：SO PR33前接收方登录
- 现象：Sign in只提示安装扩展，无法使用已选网页钱包。
- 预期：同钱包登录SO进入接收准备。
- 已知原因／建议修法：现有SDK注册缺web-wallet opt-in；补准确provider配置。
- 版本：SO PR33 / 4a0c1b0e；https://github.com/redefine-digital-labs/soulidity/pull/33
- 证据：SPRINT_13 F02-P：实际同cf86 Slush连接成功，SO显示Account；后续AC重试bug另列012。
- 关闭条件：同钱包连接/账号正确；不等于已接收Soul。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q064VH9)

### BUG-027 编辑后的稿件再次发布错误复用旧COMPLETE记录

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：PR73之前原r41与已发布r6
- 现象：当前7Parts9Items却返回旧1Part1Item的COMPLETE，无法识别新内容未发布。
- 预期：按实际内容识别当前未发布修改，走明确版本历史/后继流程。
- 已知原因／建议修法：比较publication内容，保持旧完成记录不可变；后继复制准确素材且幂等。
- 版本：AC PR73 / bd70440c；https://github.com/redefine-digital-labs/animacraft/pull/73
- 证据：F02-O/R及之后真实归档/后继：显示r6/r41差异，新后继保留7Parts9Items；后继读回问题另列003/004。
- 关闭条件：旧版本与新修改分明；不误覆盖新编辑，已签旧尝试可恢复。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U82MBHC)

### BUG-028 后继审核显示前一版本的完成资源数和继续提示

- 状态：已关闭；线上实测；S3 体验问题；P2。评审决定：保留回归。
- 复现环境：PR76前NEW_VERSION_REQUIRED
- 现象：新稿审核仍显示旧3/3资源完成与frozen-resume提示，误导已发布。
- 预期：新稿未发布状态与旧版本进度分开。
- 已知原因／建议修法：NEW_VERSION_REQUIRED隐藏前身进度/恢复提示，正常完成/已签恢复不变。
- 版本：AC PR76 / 4621d3bd；https://github.com/redefine-digital-labs/animacraft/pull/76
- 证据：SPRINT_13 F02-R：原Chrome冷重开r41、Publish/Refresh实际核对通过。
- 关闭条件：r6/r41展示正确；后继发布真实进度由002保护。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q0629JP)

### BUG-029 尚未询价的购买资格被显示成拒绝／不可用

- 状态：已关闭；线上实测；S2 功能异常；P1。评审决定：保留回归。
- 复现环境：PR77前公开Player/OC2
- 现象：unknown eligibility被当denied，误导无法购买。
- 预期：显示尚未报价，实际资格/费用需真实询价。
- 已知原因／建议修法：区分unknown和denial，保留付款与资格门禁。
- 版本：AC PR77 / e2b94428；https://github.com/redefine-digital-labs/animacraft/pull/77
- 证据：SPRINT_13 F02-S：原OC2 restore/export真实显示not-yet-quoted；真实购买仍未验收。
- 关闭条件：未知不冒充拒绝或零价；实际购买旅程保留DEV-003验收。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QTB145T)

### BUG-030 ACTIVE公开Maker的Copy／Share入口不可用

- 状态：已关闭；线上实测；S2 功能异常；P2。评审决定：保留回归。
- 复现环境：PR77前公开Player
- 现象：已认证ACTIVE作品无法通过原控件取得公开链接。
- 预期：复制正确公开深链，分享不可用时有复制后备路径。
- 已知原因／建议修法：绑定已认证ACTIVE身份，保持本地预览/旧会话隔离。
- 版本：AC PR77 / e2b94428；https://github.com/redefine-digital-labs/animacraft/pull/77
- 证据：SPRINT_13 F02-S：原Chrome剪贴板准确深链，Share fallback复制通过；原生OS分享未测。
- 关闭条件：准确深链和后备复制已验；原生分享作为剩余设备验收。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q0679GT)

### BUG-031 导出Original／透明背景偏好在冷重开后丢失

- 状态：已关闭；线上实测；S2 功能异常；P1。评审决定：保留回归。
- 复现环境：S13-F01-A / PR58前
- 现象：选Original后保存重开变回Standard；不是等尺寸归一化。
- 预期：导出尺寸/背景意图随本地checkpoint持久恢复。
- 已知原因／建议修法：原本只存闭包；加入准确checkpoint/CAS与source绑定。
- 版本：AC PR58 / 592699af；https://github.com/redefine-digital-labs/animacraft/pull/58
- 证据：CURRENT F01-A正式复验：Original+Transparent关闭重开及刷新Library再进Player均保留。
- 关闭条件：偏好冷恢复、无效值/CAS拒绝；图片像素保真另列010。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y50B5TK)

### BUG-032 Creator显示Ready但Publish按钮无可执行入口

- 状态：已关闭；线上实测；S1 阻断主流程；P1。评审决定：保留回归。
- 复现环境：S13-F02-A / PR60前
- 现象：Preflight Ready，Publish仍disabled；bootstrap有controller，app无capability/handler。
- 预期：原Creator入口可审核当前稿件准确发布。
- 已知原因／建议修法：将已有bridge/controller接入原按钮及冻结步骤审核/继续。
- 版本：AC PR60 / b827c3c6；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT F02-A/B及后续Chrome真实可进入发布、看到准确报价并登记。
- 关闭条件：原入口可用；完整发布所有后继缺陷分别追踪。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y50P80H)

### BUG-033 全局未限定发布attempt可能混用稿件／当前编辑

- 状态：待线上复验；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR60整合前依赖审查
- 现象：旧API按全局attempt复用，prepare混入当前draft，跨稿/版本边界不明确。
- 预期：发布固定draft/revision/wallet/release，保留已开始快照和后续编辑。
- 已知原因／建议修法：PR60移除未限定API、引入准确作用域绑定与内容校验。
- 版本：AC PR60 已合入／部署；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：PR60 body + CURRENT F02-A；定点158/298等覆盖；跨稿旧审核真实设备专项未记录。
- 关闭条件：跨稿/钱包/版本/编辑切换与冷恢复不混入；待纳入新整流程复验。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q06LF35)

### BUG-034 旧接口一次动作可能连续触发多阶段签名，审核边界不清

- 状态：待线上复验；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR60整合前依赖审查
- 现象：旧requestSignature路径允许多阶段推进；恢复动作可能包含广播/上传却未在入口明确区分。
- 预期：每次新交易先准确审核；已签交易可自动继续，下一新签名停止。
- 已知原因／建议修法：PR60冻结一次review只签一笔，显式继续已签字节；当前005只自动推进已签动作。
- 版本：AC PR60 已合入；新增005未上线；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT F02-A/PR60；scoped review隔离回归通过；完整新批量组合待复验。
- 关闭条件：拒签、重入、切页、旧review、跨钱包不会开启未审核新签名。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Q06NATD)

### BUG-035 Walrus数据库版本升级被旧标签阻塞时缺少可操作诊断

- 状态：待线上复验；候选审查；S2 功能异常；P2。评审决定：批准修复。
- 复现环境：PR60独立审查P2
- 现象：旧连接阻塞binding-store升级，用户无法明确知道该如何恢复。
- 预期：保留已签WAL，显示准确阻塞和恢复方式。
- 已知原因／建议修法：PR60增加blocked-upgrade诊断和既有记录保留。
- 版本：AC PR60 已合入／部署；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT Oct03 14:03：三个P2审查修复之一；本地独立审查通过。
- 关闭条件：真实多标签阻塞/解除后冷恢复原记录；不清库解决。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6U840CUW)

### BUG-036 发布未完成时可能提前投射Root为可交付结果

- 状态：待线上复验；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR60独立审查
- 现象：premature Root投射会让创建对象被误认为正式发布成功。
- 预期：仅完成准确Activation/读回后暴露正式发布Root。
- 已知原因／建议修法：PR60把Root交付绑定到完整证据，不能以创建或Signed当ACTIVE。
- 版本：AC PR60 已合入／部署；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT Oct03 14:03独立审查整改；后续PR70实际ACTIVE存在，提前状态负例只本地。
- 关闭条件：中间Scaffold、未知、失败都不冒充发布；最终ACTIVE准确。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QTBFE77)

### BUG-037 同钱包不同稿件共享上传时互斥范围不足

- 状态：待线上复验；候选审查；S1 阻断主流程；P1。评审决定：批准修复。
- 复现环境：PR60独立审查
- 现象：仅按稿件锁定，跨稿件可能同时操作同一复用的上传WAL。
- 预期：同钱包共享上传在跨稿/标签时仍串行，原交易只签/恢复一次。
- 已知原因／建议修法：PR60改钱包作用域跨标签锁；新Quilt成员漂移是独立014，不以旧锁已修认定其安全。
- 版本：AC PR60 已合入／部署；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT Oct03 14:03 + PR60；旧锁修复本地通过，新增014已明确证明锁本身不足。
- 关闭条件：跨稿共享资源、并发签/恢复和CAS专项复验；同时保留014负例。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ER4G27R)

### BUG-038 异步哈希完成时机用事件循环次数猜测，验收测试偶发失败

- 状态：已关闭；测试／验证；S2 功能异常；P2。评审决定：保留回归。
- 复现环境：AC PR57之前主分支测试
- 现象：实际SHA尚未完成便断言bridge调用，出现expected1/actual0。
- 预期：等待真实事件和bridge进入，不降低会话隔离断言。
- 已知原因／建议修法：改测试同步条件，保留late-A/new-B与single-flight。
- 版本：AC PR57 / ae2dc444；https://github.com/redefine-digital-labs/animacraft/pull/57
- 证据：PR57受控哈希延迟复现；重点6/6、完整app260/260及独立审查通过。
- 关闭条件：受控延迟仍稳定并校验真实异步边界；仅测试问题，不宣称线上故障。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6ZT018AG)

### BUG-039 新增文案未同步精确测试清单，导致候选CI误失败

- 状态：已关闭；测试／验证；S2 功能异常；P2。评审决定：保留回归。
- 复现环境：PR60、PR73、PR77候选门禁
- 现象：历史locale/字段清单漏新key，行为测试通过但全量CI单项失败。
- 预期：新文案纳入准确显式清单，保留旧断言和范围校验。
- 已知原因／建议修法：各候选仅修清单漏项后完整重跑；不放宽测试或复用错误SHA绿色。
- 版本：AC PR60/73/77 门禁修复已合入；https://github.com/redefine-digital-labs/animacraft/pull/60
- 证据：CURRENT PR60 20keys、SPRINT_13 PR73 18keys、PR77 inventory修复；对应最终精确CI通过。
- 关闭条件：新候选全量门禁绑定准确版本；测试清单变更需审查。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6Y515QL9)


### BUG-040 SO CI 浏览器初始化／清理超时和购买测试旧会话访问

- 状态：修复中；测试／验证；S2；P2。已进入当前修复范围。
- 证据：原run37369112027 attempt1和准确配对run37370802211均出现三套恢复测试beforeAll30s；后者afterAll10s也超时，collection-buy另有5s超时/Session not found。
- 已确认harness缺陷：stderr管道未消费；CDP无期限；清理先无限等待Browser.close；关闭旧target后仍保留其session；Vitest超时后启动任务可能继续创建资源。最初Linux卡点仍需新诊断验证，不能据此认定线上产品故障。
- 本地六文件修复：共享有界CDP命令、stderr尾部、退出/断管/分块解码、关闭超时kill，启动取消及次标签生命周期。原外层期限和产品断言保持。
- 验证：首次四真实浏览器套件188项＋故障注入5项通过；独立复核发现两处取消边界，已补齐。最终重点测试曾在AC/SO全量并发负载下触发Runtime.evaluate4s超时；保留日志，停止已过期SO全量运行，顺序复验，不标已修复完成。
- 下一步：最终重点/全量顺序验证→更新原PR34→准确Linux配对CI；不盲重跑、不跳过断言或扩大外层超时。
- 关闭条件：准确完整CI通过，启动失败清理/冷恢复断言仍有效；产品线上验收单独保留。
- [Slack记录](https://sega-xya5661.slack.com/lists/T08LQTJFZRS/F0C6UK635UJ?record_id=Rec0C6QRXT03D)

2026-10-06：用户批准防重犯方案落实。当前候选 AC a6ac9472 / SO d67cfea4；精确CI37374789340/37374793633。已加入配对凭据、翻译单一清单、批量冷恢复预算与可执行交付门禁。14门禁/202 AC关联/6 SO工作流通过，两端构建与上传源码核对通过；线上原操作未验，Bug状态不因这些检查自动关闭。BUG040新增AC启动超时证据；Runner未分配单独记录。


## 2026-10-06 BUG-040 启动就绪边界补测

- Full M1–M4 goal is active after accidental deletion; current fresh journey remains DEV-002.
- Exact pair AC a6ac9472/SO d67cfea4 passed manual CI 37374789340/37374793633; source run/attempt receipts and 33 Move artifact checks passed.
- SO R3 stage dpl_83braMvwRSrQU5iGpRDF4kAxHLZn completed. Cloud input parity and immutable 169 checks PASS. Public aliases unchanged. Never rerun its stage intent. AC R3 has not staged.
- Automatic AC PR run37374751528 failed because runner shutdown/cancel; one failed-job-only retry requested after inspecting logs and same head.
- Automatic SO PR run37374760447 failed four initial Target.createTarget calls at 4s. These failures still block BUG-040, even though the same source's manual CI passed.
- Controlled isolated Chrome delay5s reproduces old helper failing at4002ms; new Browser.getVersion startup handshake passes at5429ms. Dedicated startup budget20s; ordinary command budget4s and outer startup30s unchanged. No retries or skipped business assertions.
- Six existing BUG-040 files updated in candidate source; five suites196 tests PASS (188 real browser +8 lifecycle). Python delivery gates14 PASS. Full SO test session36349 running, log in temp base so-startup-full.log. New head not committed at this checkpoint.
- New test source invalidates old exact-pair identity: rerun paired CI after commit; don't promote R3 as new source.
- Evidence: startup-followup-2026-10-06/chrome-startup-repro.json and so-startup-targeted.log.
