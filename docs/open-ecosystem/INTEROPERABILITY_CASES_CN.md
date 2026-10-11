# 全生态互操作与独立维护验收案例

日期：2026-10-10。版本：1.1。阶段：Plan。60 个设计案例均 Not run；57 必需、3 条件。原 T01–T10 与原卡继续，不新建任务库。

依据：[标准化输入](../SOULIDITY_ECOSYSTEM_MODULARIZATION_SPEC_CN.md)、[施工前边界决策](CONSTRUCTION_BOUNDARY_DECISIONS_CN.md)、[原157条追踪](ORIGINAL_SCOPE_TRACE.json)。机器源：[案例清单](INTEROPERABILITY_CASES.json)。

## 首要验收与覆盖范围

CASE-19 必须先完成 B0：准备一致新目标的可运行最小市场，再冻结源码、锁、配置、制品和准确包身份，随后发布独立被动扩展。原 Soul 指 frozen_target_acceptance fixture，不要求历史市场接受新类型。至少无扩展、已有扩展、新独立被动扩展三组，分别挂牌→取消、挂牌→成交，适用嵌套/持有路径重复核验；市场四类哈希不变且被迫发布 0。冻结后更改市场是失败，不能替换基线隐去；新一轮新 baseline ID 并保留失败。

被动性质须实际无新增必需义务。资金/授权/供给/转移/私密/退出效果由实际支持路径适配或拒绝，不承诺自由转移的通用钩子。同包 fixture 不能替代独立新扩展。完整策略见 D25–D32。

38 类语义动作、60 个案例和157原记录分别是分类、验收家族和设计追踪；均不能代替原30合约职责和全部生产声明逐函数审查。每案例按原真实功能/权限域/版本/容器/经济分支展开，不能跑一个样本就宣称全家族通过。

## 记录与结果

每次绑定源码/差异/锁/工具/制品/网络/类型/实例/policy/主体/Cap/输入/原对象/交易字节/digest/checkpoint、前后状态、逐币种对账与恢复证据。结果只用 PASS、FAIL、Not run、说明适用范围的 N/A；条件案例 N/A 不计通过。冻结消费者包括其源码、锁、配置和制品；正常业务执行状态另记。失败 gas 与重复业务付款分别统计。

## 六十个案例

### CASE-01 第三方编辑器往返

责任：AUTHORING／SDK；场景：T01；Required；Not run。

兼容制作格式、许可与确定性快照；替代编辑器继续编辑，不冒充 Maker 控制者

验收：固定同 revision 的语义摘要一致；未授权素材／权利改变 0；原工程丢失 0。
冻结消费者：按实际消费者契约判定。

### CASE-02 在途发布期间继续编辑

责任：AUTHORING／MAKER／SDK；场景：T01／T06；Required；Not run。

新编辑进入下一候选；已付在途意图保持原快照、版本、规则和随机密文

验收：在途输入改变 0；新 revision 不覆盖原 Draft；被迫重付 0。
冻结消费者：按实际消费者契约判定。

### CASE-03 无平台登记读取 Maker

责任：MAKER／SDK；场景：T02；Required；Not run。

独立创建和公开读取不需要社区／平台 Config／团队许可

验收：平台必经批准 0；真实 ID／版本／规则可取回。
冻结消费者：COMMUNITY／CHANNEL／MARKET。

### CASE-04 换发布客户端接续原 Maker

责任：MAKER／SDK／CONTENT；场景：T02／T06；Required；Not run。

接续原 Maker／Draft／意图与已认证资源；不能另建发行器掩盖恢复失败

验收：重复根创建 0；成功片段重放 0；重复业务付款 0。
冻结消费者：按实际消费者契约判定。

### CASE-05 Maker 新版本与旧 Pack

责任：MAKER；场景：T02；Required；Not run。

新 Maker 版本不静默改变旧 Pack 的精确源、许可、供给维度与履约条款

验收：旧 Pack 承诺改变 0；旧合法路径结果保持；未使用新版本的消费者被迫发布 0。
冻结消费者：MARKET／CHANNEL。

### CASE-06 Maker／Pack／Complete 政策与已购资格

责任：MAKER／POLICY；场景：T02／T09；Required；Not run。

分别核 Maker FREE/ONE_TIME_PAID、Pack FREE/ONE_TIME_PAID/INCLUDED_WITH_MAKER、四种 Complete 业务政策及 total cap；按准确版本核数字编码和独立 quote 向量，零值/边界/并发/过期/重复均验证；旧权益及计数不追溯改变。不同历史编码不混用

验收：四 Complete 政策语义与编码逐项一致；旧资格重复购买 0；历史计数重置 0；逐币种账差 0。
冻结消费者：按实际消费者契约判定。

### CASE-07 作者权益新版本与已发 Item

责任：MAKER／EXTENSIONS；场景：T02／T04；Required；Not run。

既发 Item 的真实来源／权利版本不被父版本更新替代；影响转售政策的新义务只在适用路径适配

验收：原 Item 来源／权利改变 0；遗漏有效费用义务 0。
冻结消费者：按实际消费者契约判定。

### CASE-08 Maker／Pack 控制、授权与收入交接

责任：MAKER／CHANNEL／POLICY；场景：T02／T07；Required；Not run。

控制交接停止旧代次新增代理行为，新控制者重新同意；受控路径实际轮换，自由转移路径不使用依赖自动失效的脱离根 grant。产品账本收入按绑定产品的当前实际有效 Control 领取，作者固定收益按原条款，服务收入按本实例。固定原已签意图，分别核发布/发行/存量权益

验收：旧失效权限敏感写入 0（支持路径）；缓存创建地址提款 0；原规则收入损失 0；计数重置 0。
冻结消费者：按实际消费者契约判定。

### CASE-09 实际 Pack 贡献与已有 Soul 增强

责任：MAKER／EXTENSIONS；场景：T02／T05；Required；Not run。

按实际贡献源增强同一 Soul；打开 Pack 或无实际贡献不收费；同一真实 Pack 多 Style 不重复算一次贡献/购买，资格费用与实际 Complete 费用分别对账。原出生、ID、已付意图保持

验收：新 Soul 根数 0；出生来源改变 0；无贡献 Pack 收费 0；同 Pack 重复计费 0。
冻结消费者：按实际消费者契约判定。

### CASE-10 未完整发布与中止

责任：MAKER／CONTENT；场景：T02／T10；Required；Not run。

缺本次必要材料、错误摘要或未认证时不能 READY；中止只返回确实可返还资源

验收：未完整激活 0；未 READY 正式发行 0；虚构存储退款 0。
冻结消费者：按实际消费者契约判定。

### CASE-11 替换节点或 relay

责任：CONTENT／SDK；场景：T06；Required；Not run。

可换访问设施，仍证明原 Blob／Maker／版本和原交易；不把新 URL 当新的资源或密钥

验收：重复成功资源购买 0；因可替换 URL 变化的业务消费者被迫发布 0。
冻结消费者：MAKER／MARKET。

### CASE-12 部分上传和认证恢复

责任：CONTENT／MAKER／SDK；场景：T06／T10；Required；Not run。

部分成功沿原意图恢复；上传、付款、认证和引用分别记账

验收：已成功片段重复购买 0；内容摘要改变 0；未认证片段误称 CERTIFIED 0。
冻结消费者：按实际消费者契约判定。

### CASE-13 签名后执行未知

责任：SDK；场景：T06／T10；Required；Not run。

先查询原 digest 和权威状态，未证实未执行之前不新付、不再铸造

验收：未知时新业务付款 0；同意图第二业务结果 0。
冻结消费者：按实际消费者契约判定。

### CASE-14 成功执行但读回失败

责任：SDK；场景：T06／T10；Required；Not run。

保留 EXECUTED_SUCCESS；用原 effects／历史对象证明，当前归属的后续改变另核验

验收：成功误降 UNKNOWN 0；重付／重发 0；历史凭证丢失 0。
冻结消费者：按实际消费者契约判定。

### CASE-15 过期或确定不可执行后的新尝试

责任：SDK；场景：T10；Required；Not run。

过期签名不是从未执行证明；证实原字节不可执行且无成功结果后，按原恢复规则构造明确新尝试

验收：未验证的新尝试 0；合法新尝试不重复已有结果。
冻结消费者：按实际消费者契约判定。

### CASE-16 内容续期与到期

责任：CONTENT；场景：T06；Required；Not run。

按真实 Blob 权限、存储期限和预算续期；到期／认证失效准确暴露，不改变原作品／权利

验收：越预算执行 0；未续期误报可用 0；原作品摘要改变 0。
冻结消费者：MARKET／COMMUNITY。

### CASE-17 私密内容政策与密钥恢复

责任：CONTENT；场景：T06／T07；Required；Not run。

固定实际密钥服务器／政策／版本和恢复条件；撤销不能收回已保存明文，换 URL 不保证旧密钥可恢复

验收：越权解密成功 0（实际撤销范围内）；伪称恢复完成 0；read 到 spend 升权 0。
冻结消费者：按实际消费者契约判定。

### CASE-18 公开内容不强制私密服务

责任：CONTENT／SDK；场景：T02／T06；Required；Not run。

公开资源路径不要求 Seal／KMS 账号或未选私密组件；必要存储证明仍成立

验收：未选 KMS 阻断 0；私密子包强制依赖 0。
冻结消费者：MARKET。

### CASE-19 首要验收 新被动扩展与固定旧市场

责任：EXTENSIONS／MARKET／INTEGRATION；场景：T04／T05；Required；Not run。

在已固定旧市场之后才发布独立的被动外观／经历扩展；没有新增资金、授权／私密交接、供给、转移／托管、必要内容或退出义务。对无扩展、已有支持扩展、新独立被动扩展三种原 Soul 分别测试挂牌／取消和挂牌／成交；在适用嵌套／持有路径重复验证。无需旧市场知道新 namespace；冻结配置参数／清单，不冻结正常变化的订单状态；原资产指该冻结新目标 fixture，不要求历史生产市场接受新类型。冻结后修改市场属于失败，保留失败并使用新 baseline ID 重新验收

验收：对照资产组合至少 3；市场源码哈希变化 0；市场依赖锁变化 0；市场配置哈希变化 0；市场部署制品变化 0；市场被迫发布次数 0；原根／子对象 ID 损失 0。
冻结消费者：MARKET。

### CASE-20 独立扩展自身 schema 升级

责任：EXTENSIONS；场景：T05；Required；Not run。

只影响使用该扩展读写契约的消费者；旧 schema 支持或明确迁移。被动字段不要求别的扩展一起升级

验收：未用该能力的消费者被迫发布 0；未声明旧 schema 支持 0。
冻结消费者：MARKET／COMMUNITY。

### CASE-21 应用共享 schema 使旧写者不兼容

责任：EXTENSIONS／MARKET；场景：T04／T07；Required；Not run。

同一必需状态域升级使旧市场 writer 被守卫拒绝时，应适配或拒绝；不能删除守卫来伪称兼容，也不能归入被动扩展

验收：错 schema 写入 0；旧写者不兼容误判为通过 0。
冻结消费者：按实际消费者契约判定。

### CASE-22 三权利装卸、替换、跨 Maker 与直接接收

责任：EXTENSIONS／MAKER；场景：T05；Required；Not run。

Reference 清引用，Bound 原 Soul 留记录可重装，Free detach 返回原 ID；replace 原子保留每 Part 一固定 Style。跨 Maker 校验许可/Adapter 交集，Receiving 若支持需真实父路径接收/拒绝/恢复，不当作已装库存

验收：复制 Item 0；Free 原 ID 改变 0；Bound 非法退出 0；非法接纳成功 0。
冻结消费者：按实际消费者契约判定。

### CASE-23 Bound 隐藏或卸载

责任：EXTENSIONS；场景：T05／T07；Required；Not run。

隐藏与显示配置不等于释放权利；Bound 留原 Soul，必要来源／绑定键不得删除

验收：Bound 外流 0；删除必要源／余额／绑定记录 0。
冻结消费者：按实际消费者契约判定。

### CASE-24 Reference 读取不是资产占有

责任：EXTENSIONS／CLIENTS；场景：T05／T07；Required；Not run。

引用允许按许可读取；不能据此伪造 Item、库存、转售和提款能力

验收：Reference 返回可售 Item 0；读取变支出 0。
冻结消费者：按实际消费者契约判定。

### CASE-25 完整视觉、Loadout 与三客户端

责任：EXTENSIONS／CLIENTS；场景：T05；Required；Not run。

执行 F04 视觉子契约：Scene/Part/Representation/Adapter/Layout/Outputs/renderer/hash、定点数与舍入、许可交集和 CAS；2 个真实 Maker（1024 方形A及不同画布B）跨 Animacraft/Soulidity/参考客户端，给 golden/实际差异/容差依据；多片遮挡/padding/颜色/Empty/窄屏/HiDPI/缺失资源/旧 renderer。Loadout 冷恢复重验许可和原对象，读/显/写/交易/安全退出分别判断

验收：真实 Maker 至少 2；客户端类别至少 3；JS/Move 数值向量不一致 0；越许可编辑 0；原 genesis 改变 0；配方复制资产 0。
冻结消费者：MARKET／COMMUNITY。

### CASE-26 嵌套与容器持有路径

责任：STANDARD／EXTENSIONS；场景：T05／T07；Required；Not run。

真实路径校验、防循环及每层原权利／余额成立；地址 owner 不是完整持有证明

验收：嵌套循环 0；错误路径支出／转移 0；未知容器伪称支持 0。
冻结消费者：按实际消费者契约判定。

### CASE-27 Vault 币种与外部发行权限

责任：EXTENSIONS；场景：T05／T07；Required；Not run。

新增 CoinType 由实际 Vault/消费者适配；原余额/领取/交接保留。登记实际 TreasuryCap/Supply/DenyCapV2/全局暂停或证据N/A；币种冻结对付款/找零/退款/收入/余额/出口的限制实际验证

验收：原币种余额丢失 0；内容授权提款 0；漏记外部币种权力 0；未使用该能力的市场被迫发布 0。
冻结消费者：COMMUNITY。

### CASE-28 授权域生命周期、A→B→A 与自由转移

责任：STANDARD／EXTENSIONS／CONTENT；场景：T07；Required；Not run。

按 D27 域策略检验旧 grant、Control/渠道/私密/扩展及真实容器。受控交接验证轮换与新同意；自由 public_transfer 不发依赖全转移自动失效的脱离根可重用权限，需当前持有人参与或限定当次意图。原成交资格按原条款，不从地址回归推断永久撤销

验收：声明支持路径失效 grant 写入 0；未验证自动撤销承诺 0；已成交资格无依据删除 0。
冻结消费者：按实际消费者契约判定。

### CASE-29 不选渠道的独立市场

责任：MARKET；场景：T04／T08；Required；Not run。

合法卖方直接使用 Market，仍执行资产本身有效政策；无未选渠道义务

验收：未选渠道费用 0；必经渠道许可 0；资产政策遗漏 0。
冻结消费者：CHANNEL。

### CASE-30 不选市场的合法渠道分销

责任：CHANNEL／MAKER；场景：T04／T08；Required；Not run。

渠道可与真实生产者直接组合；没有 Market 时完成合法授权发行，唯一资格／供给照常验证

验收：必经 Market 次数 0；漏渠道义务 0；新建重复总计数 0。
冻结消费者：MARKET。

### CASE-31 渠道加市场的原子组合

责任：CHANNEL／MARKET／MAKER；场景：T04／T08；Required；Not run。

显式 PTB 组合所选模块；真实证明绑定本订单、资产／版本、主体、金额、受益人与时效；跳步和重放失败

验收：漏付／错误分配成功 0；跨订单重放成功 0；部分交付 0。
冻结消费者：按实际消费者契约判定。

### CASE-32 渠道撤销六类存量

责任：CHANNEL／MARKET／MAKER；场景：T04／T08；Required；Not run。

未接受、仅接受、报价挂牌、有效预留、已履约、执行未知分别处理；停新业务不抹已得权益；ENDED 不复活

验收：撤销后新代理消耗 0；改写有效存量条款 0；ENDED 原 ID 复活 0。
冻结消费者：按实际消费者契约判定。

### CASE-33 真实预留到期和取消

责任：CHANNEL／MAKER／MARKET；场景：T08／T09；Conditional: only if actual reservation exists；Not run。

若现有实现支持预留，原权威范围与到期／取消规则唯一；仅报价不凭空占总供给。最终发行仍原子

验收：重复释放额度 0；预留与已发行双计数 0；未来义务漏验 0。
冻结消费者：按实际消费者契约判定。

### CASE-34 未知结果与额度释放

责任：CHANNEL／MAKER／SDK；场景：T09／T10；Required；Not run。

原 digest 未确定时不擅自释放已消耗额度或重建订单；以原执行及权威状态决定合法恢复

验收：未知时双释放／再占额度 0；同意图第二发行 0。
冻结消费者：按实际消费者契约判定。

### CASE-35 更换市场或渠道服务实例

责任：CHANNEL／MARKET；场景：T04／T07；Required；Not run。

客户端可继续操作原实例；新实例不继承旧订单、grant、余额、quota、Cap，迁移要显式证明及用户有效选择

验收：跨实例重放 0；隐式余额／权限继承 0；原实例合法出口丢失 0。
冻结消费者：按实际消费者契约判定。

### CASE-36 ABI 未变但费率或舍入改变

责任：POLICY／MAKER／MARKET；场景：T04／T07；Required；Not run。

识别行为与钱的依赖，验证真实受影响消费者；签名一样不等于兼容。不需要变化的消费者保持固定制品

验收：漏判经济行为变化 0；逐币种对账差 0；无关消费者被迫发布 0。
冻结消费者：按实际消费者契约判定。

### CASE-37 Collection 与 Right 关系

责任：MAKER／POLICY；场景：T02／T04；Required；Not run。

成员／原资格／Right 与当前控制者的权益分开核验；展示 floor 元数据不是可执行最低价或费用政策

验收：旧成员权利改写 0；元数据伪造强制价格成功 0；错误收入权利人提款 0。
冻结消费者：按实际消费者契约判定。

### CASE-38 Physical 数字发行、凭证与消费

责任：MAKER／CLIENTS；场景：T02／T10；Required；Not run。

按 J32 配置发布→FREE/PAID/PROOF(voucher)发行→供给→交易→consume/终态清理；错主体/凭证/重放/少付/超供给/已消费与清理分别验证。真实实物履约只在实际存在该义务时附证据，不用名称推断

验收：错凭证发行 0；超供给 0；同 voucher 重放成功 0；consume 重复成功 0；无依据删除用户资产 0。
冻结消费者：按实际消费者契约判定。

### CASE-39 应用只选最小能力

责任：CLIENTS／SDK；场景：T05；Required；Not run。

新游戏只声明所需身份／视觉等能力，不拉入全部社区、市场、其他游戏或控制权

验收：未选业务必需依赖 0；应用默认根控制 0；其他应用被迫发布 0。
冻结消费者：COMMUNITY／MARKET。

### CASE-40 应用写技能记忆或经历

责任：CLIENTS／EXTENSIONS；场景：T05／T07；Required；Not run。

只有选用扩展认可的真实结果来源和范围写权可更新；任意客户端提交／签名不自证经历有效

验收：伪造结果写入 0；跨扩展／资金升权 0；结果重放成功 0。
冻结消费者：按实际消费者契约判定。

### CASE-41 引擎和一个游戏升级

责任：CLIENTS；场景：T05；Required；Not run。

旧存档／应用状态明确兼容或迁移；未用该契约的游戏及资产不跟随升级，Soul 不重铸

验收：原 Soul 重铸 0；无关游戏被迫发布 0；旧状态静默损失 0。
冻结消费者：按实际消费者契约判定。

### CASE-42 本地模拟与链上有效结果

责任：CLIENTS／EXTENSIONS；场景：T05／T07；Required；Not run。

可本地体验但区分本地计算与链上被接受状态；定量验证证明来源与实际授权

验收：本地模拟误称链上确认 0；无证明敏感更新 0。
冻结消费者：按实际消费者契约判定。

### CASE-43 原基础社区行为与分页独立演进

责任：COMMUNITY／SDK；场景：T05；Required；Not run。

承接简介/帖评/关注/投票/采纳答案/私密书签/作者关系/分页，原钱包账号书签不是 Soul Vault；各入口映射原函数与恢复，变更仅影响真实社区消费者

验收：原已有行为漏映射 0；原作者关系丢失 0；分页重复或遗漏按原契约验证；无关市场/渠道强制发布 0。
冻结消费者：MARKET／CHANNEL／MAKER。

### CASE-44 社区及 Collection 管理与资产权利

责任：COMMUNITY／MAKER／MARKET／POLICY；场景：T05／T07；Required；Not run。

社区管理不改资产；Collection 创建/成员准入/supply/tradeable/Right/当前收入及逐组件原费用舍入逐项承接，floor 不强制最低价；空市场终态清理保留原开放权限，不删除资产或历史事件

验收：社区管理员资产敏感写入 0；跨实例越权 0；Collection 供给/账差 0；清理误删资产 0。
冻结消费者：按实际消费者契约判定。

### CASE-45 包升级与旧入口

责任：POLICY／LEGACY／INTEGRATION；场景：T07／T10；Required；Not run。

验证基线／当前、候选／当前、候选／候选三组合；旧包仍存在，版本守卫与迁移真实有效。错误制品与不兼容组合拒绝

验收：最低兼容组合 3；错误哈希被认可 0；旧入口绕过敏感守卫 0。
冻结消费者：按实际消费者契约判定。

### CASE-46 SDK 单子包发布

责任：SDK；场景：T05；Required；Not run。

消费者锁定所用子包；一个扩展适配发布不触发所有 SDK 消费者安装／锁／部署变化

验收：未选子包强制导入 0；无关消费者被迫发布 0。
冻结消费者：MARKET／COMMUNITY。

### CASE-47 共用工作流发布新版本

责任：DEVOPS；场景：T06；Required；Not run。

固定版本工作流由仓库显式采用；工具发布不隐式改所有仓库制品，密钥与执行授权不集中

验收：隐式依赖漂移 0；共用工具取得生产总权限 0；未采用消费者被迫发布 0。
冻结消费者：按实际消费者契约判定。

### CASE-48 各仓 CI 通过但组合失败

责任：INTEGRATION；场景：T04／T07；Required；Not run。

组合验证使用精确候选与实际跨模块证明；失败阻断受影响组合，不能用各仓测试数认定组合通过

验收：组合失败误报 PASS 0；未声明依赖 0；无关组合强制发布 0。
冻结消费者：按实际消费者契约判定。

### CASE-49 源码拆仓与旧对象迁移

责任：STANDARD／MAKER／LEGACY；场景：T06／T07；Required；Not run。

仓库移动不意味着类型来源改变；确需不兼容迁移时保留真实身份／权益／历史与半完成恢复，禁止重铸掩盖

验收：无授权原类型／ID 替换 0；双发行权威 0；半完成资产出口丢失 0。
冻结消费者：按实际消费者契约判定。

### CASE-50 实例暂停恢复与 Maker／Pack 生命周期

责任：MARKET／CHANNEL／COMMUNITY／MAKER／POLICY；场景：T04／T07；Required；Not run。

逐域验证暂停原因集合/暂停者/恢复者/CAS，未消除原因不能恢复，ENDED 不复活；Maker/Pack ACTIVE/暂停新发行/恢复/归档/新版本由产品 Control 判断，服务开关不能代替。旧权益/Bound/合法Free取出/撤单/收入出口按原条件验证

验收：跨实例暂停影响 0；错误权限恢复 0；ENDED 原ID复活 0；无依据封死原合法出口 0。
冻结消费者：按实际消费者契约判定。

### CASE-51 Agent 并行写与独占资源

责任：DEVOPS／INTEGRATION；场景：T06；Required；Not run。

2 个实现槽各自隔离工作树／范围，1 只读验证槽与协调槽；共享 schema／Config／root 写及钱包／浏览器／部署资源明确排他

验收：同语义单元并发写者 >1 的次数 0；未声明排他资源冲突 0；原全局 WIP 擅增 0。
冻结消费者：按实际消费者契约判定。

### CASE-52 全部治理路径、Cap 交接、遗失失陷

责任：POLICY／CHANNEL／MARKET／CONTENT／EXTENSIONS；场景：T07；Required；Not run。

配置/资金/暂停/恢复/升级及间接路径分别登记；Cap真实绑定/旧主体失权/新主体/包装/多签/延迟核实。遗失仅用已部署恢复或钱包恢复，无恢复就据实不可用；失陷核暂停轮换和出口，无平台后门

验收：漏记有效控制路径 0；错 Cap 成功 0；绕过治理恢复 0；虚构恢复机制 0。
冻结消费者：按实际消费者契约判定。

### CASE-53 带存量义务的租赁功能

责任：EXTENSIONS／MARKET；场景：T04／T07；Conditional: no new rental roadmap commitment；Not run。

仅在实际实施租赁时适用；租约使用权、期限、收益及转移条件必须适配；存量按原条款履约或合法退出

验收：存量义务遗漏 0；未用租赁的消费者被迫发布 0。
冻结消费者：按实际消费者契约判定。

### CASE-54 抵押或锁定的真实转移条件

责任：EXTENSIONS／MARKET；场景：T04／T07；Conditional: no new collateral roadmap commitment；Not run。

仅在实际实施时适用；必须证明受约束资产和实际转移路径。自由转移 Soul 挂个字段不能声称全路径被锁

验收：无真实锁定误报 0；已承诺限制被绕过 0。
冻结消费者：按实际消费者契约判定。

### CASE-55 市场支付币种与外部暂停

责任：MARKET／CHANNEL／MAKER；场景：T04；Required；Not run。

精确 CoinType/编码/精度/舍入/quote/分配及 TreasuryCap/Supply/如适用DenyCapV2与全局暂停；原订单条款、冻结付款/找零/退款/收入与出口实际核验，外部发行者控制不归本项目

验收：逐币种账差 0；假 ticker 身份通过 0；外部币种控制漏记 0；Standard 被迫发布 0。
冻结消费者：STANDARD。

### CASE-56 相似 namespace 或伪造来源

责任：STANDARD／EXTENSIONS／MAKER；场景：T07；Required；Not run。

验证真实类型来源／证据与对象绑定；同名 schema、namespace、元数据或标准外观不意味着等价生产者和权限

验收：伪造来源／能力被认可 0；错误生产者越权发行 0。
冻结消费者：按实际消费者契约判定。

### CASE-57 平台关闭后的干净环境接替

责任：SDK／INTEGRATION／CLIENTS；场景：T01／T02／T03／T04／T05／T06；Required；Not run。

阻断平台专属 API／账号／签名和缓存，用公开清单、备份、原实例／资产／意图接替；真实 Sui/Walrus/必要密钥设施继续提供或可验证替代

验收：核心合法路径平台专属必经点 0；原资产重铸 0；成功资源重付 0；不可接替条件隐瞒 0。
冻结消费者：按实际消费者契约判定。

### CASE-58 未知 schema 与未知必需效果

责任：STANDARD／SDK／MARKET；场景：T05／T07；Required；Not run。

展示未知字段可降级；已证明被动能力不阻断基础操作。仅对已绑定真实类型／对象／效果契约、具有不可跳过完成条件的声明支持受控路径，验证未知资金／授权／转移效果被拒绝或适配；不能推导任意旧市场、自由 public_transfer 或未声明第三方会自动拦截，目录不是保证

验收：声明支持受控路径内未知必需效果被跳过 0；已证明无义务的未知显示字段阻断 0；未验证全路径拦截承诺 0。
冻结消费者：按实际消费者契约判定。

### CASE-59 共享计数与 Config 的竞争

责任：MAKER／POLICY／CHANNEL；场景：T09；Required；Not run。

多个渠道及直接入口竞争最后 N 份总额度；根据原维度做唯一计数和 CAS；拆仓不复制 Config／counter

验收：N+1 个有效竞争尝试成功数 ≤N；历史计数重置 0；无关字段编辑覆盖 0。
冻结消费者：按实际消费者契约判定。

### CASE-60 非 Maker 生产者、owned-only 构造及容器

责任：NATIVE／STANDARD／MARKET；场景：T03／T04；Required；Not run。

第三方公开合法创建，无平台签名；所有目标构造/解包/返回/交付路径证明 owned-only fresh Root，无 rawfreshSoul 或可变 UID 泄漏，实际 share/public_share/party 及间接绕过反例。分别验证 Native 来源/初始权利/实际policy实例/Kiosk与第三方支持矩阵

验收：共享/party根创建成功 0（目标公开构造）；伪装 Maker 0；错policy/容器认可 0；原出生改变 0。
冻结消费者：按实际消费者契约判定。

## 全局不变量

| ID | 不变量 | 约束 |
| --- | --- | --- |
| K01 | 身份与来源 | 在绑定基线的同一目标内原ID、来源和权利不被替换；历史资产留存不强制新目标旧ABI兼容；明确授权迁移另证 |
| K02 | 固定快照与版本 | 同一在途意图的快照、真实源版本、材料、规则、随机密文及摘要改变次数 0；新编辑进入下一候选 |
| K03 | 恢复不重复业务 | 沿用原意图／digest／成功资源；非用户明确新业务尝试的重复付款、存储购买、铸造和收入记账 0；gas 单独记账 |
| K04 | 钱与交付守恒 | 逐币种输入=分配+账本增加+退还／找零；业务付款、权益、供给与交付在同一成功 PTB 一致，部分成功 0 |
| K05 | 唯一供给与资格 | 每个原维度仅 1 份权威计数；只按真实成功消耗增加，总量／用户次数不超原上限；版本／渠道／控制切换不重置 |
| K06 | 三类权利 | Reference 不产可返 Item；Bound 不离原 Soul；Free 返回并转移原 ID；隐藏、配置或元数据不改变权利 |
| K07 | 装配与来源 | 每 Part 的固定 Style 唯一，真实 Free 对象与已装关系一一对应；无凭空库存／未激活 Free；原 genesis 不被外观替换 |
| K08 | 最小权限 | 错误主体／根路径／实例／类型／namespace／动作／代次、过期及撤销的未授权敏感写入 0；内容读取不能提款 |
| K09 | 无无关强制发布 | 不改变消费者所用类型／接口／行为／义务的变化，消费者源码、依赖锁、配置、制品不变；被迫发布 0 |
| K10 | 并发与重复 | 冲突 CAS 不得同时成功；旧状态覆盖 0、同意图第二份业务结果 0；并发实际计数不得超限 |
| K11 | 实际内容条件 | 只要求本操作必要内容，认证／期限／访问按真实设施核验；未选资源阻断 0；已有历史不可由读回故障抹去 |
| K12 | 合法退出 | 不能删除原来源、余额、Bound、已得权益与履约义务；暂停／撤销／迁移保留适用出口或明确原限制 |
| K13 | 唯一维护与权威 | 每个目标语义单元维护入口 1；未声明依赖、双边可写目标源码、第二发行权威 0 |
| K14 | 兼容真相 | 源码版本、ABI、schema、行为、类型来源、对象 revision、policy 实例／代次分开；未知必需效果及错哈希组合不能被认可 |
| K15 | 不可跳过的联动 | 声明支持的实际受控入口内，已选且实际消耗的授权／费用／额度／交付义务不能跳过、伪造、复制或跨订单重放；目录和普通持久收据不是完成证明，不推导任意自由转移自动拦截 |
| K16 | 证据与作用域 | 方案、源码、已验证、已部署分别记录；每条结果绑定准确候选／环境／证据，不运行的案例通过数 0 |

数量、引用与设计映射校验只证明文档结构一致；准确 ABI、生产权限及运行案例仍由施工在原任务记录上完成。
