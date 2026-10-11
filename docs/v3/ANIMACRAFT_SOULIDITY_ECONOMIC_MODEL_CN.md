# Animacraft × Soulidity 分层资产与经济模型

**状态：** Research / Proposal  
**版本：** 0.1  
**日期：** 2026-07-28

## 0. 结论

Animacraft 与 Soulidity 不应共用一个模糊的“NFT 经济模型”，而应组成两层相互衔接的资产网络：

```text
Animacraft：Maker 母资产
  ├─ MakerVersion（版本）
  ├─ Part / Item / DLC（可许可组件）
  └─ Recipe / OC Draft（生成结果）
                    │
                    │ 唯一铸造 + 来源与许可结算
                    ▼
Soulidity：Soul 身份资产
  ├─ Content / Memory / Skill（持续内容）
  ├─ Grant / Paid Access（运行和访问权）
  └─ Anima Desktop / Game / Chat / Agent Projection（运行衍生物）
```

核心原则：

1. **Maker 是生产性母资产**：它不是一张头像，而是一套持续生产角色、许可和收入的创作系统。
2. **OC 是 Maker 的派生结果，Soul 是确立独立身份后的资产**：Soul 保留 Maker 来源与许可义务，但不归 Maker 持有人所有。
3. **Soul 是跨 Runtime 的身份母资产**：Anima 桌面形态只是 Soul 在特定 Runtime 中的投影，不应脱离 Soul 被独立倒卖。
4. **所有权、使用权、修改权、商业化权、转让权和收益权必须分开**；“上链”只证明链上承诺与状态，不自动解决现实版权。
5. **先用 USDC 建立真实收入，再讨论积分与 Token**。积分应先是不可转让的贡献记录，不承诺固定兑换 Token。
6. **平台应从真实增值服务和成交中抽费，不应在冷启动期拿走 Maker 初级收入的 50%。**

---

## 1. 两层资产视角

### 1.1 Animacraft：Maker 是底层资产

Maker 的价值来自四类能力：

- **生产能力**：按规则组合 Parts、Items、Layers、Colors 和内容文件；
- **许可能力**：决定用户可以个人使用、商业使用、修改、生成衍生作品或继续分发；
- **发行能力**：免费获客、收费解锁、DLC、限量授权和版本升级；
- **现金流能力**：Maker 使用费、DLC 收入、商业许可费和约定的后续版税。

因此，Maker 更接近“可版本化的创作引擎 + 素材库 + 许可工厂”，而不只是可交易收藏品。

### 1.2 OC / Recipe：产品意义上的派生资产

用户在 Maker 规则内组合产生：

- `Recipe`：选择项、颜色、版本、依赖和哈希；
- `OC Package`：渲染结果、角色描述、初始记忆、技能和许可证快照；
- `SoulMintAuthorization`：证明该 Maker 已授权一次合规的 Soul 铸造。

它们是 Maker 的**产品派生物**。除非另行设计金融合约，不应在公开材料中称为期权、期货等金融衍生品。

### 1.3 Soulidity：Soul 是独立身份资产

Soul 铸造完成后，应同时满足：

- 有唯一链上身份与持有人；
- 能独立转移、授权和接入 Runtime；
- 保留 Maker、素材、版本、Recipe 和许可来源；
- 后续收入只按明确许可触发上游分成；
- Maker 作者不能任意撤回已经合法取得的永久权利；
- Soul 持有人也不能超出原许可使用底层素材。

这形成“派生但独立”的关系：**来源不会消失，所有权不会倒流。**

### 1.4 Anima Desktop：Soul 的运行衍生物

Anima Desktop Instance 建议定义为：

> Soul 在指定设备、会话或 Runtime 中，由当前持有人或有效 Grant 激活的可执行投影。

它可以包含本地状态、表情、动画、工具连接、对话适配、Codex/Chat 连接和设备偏好，但默认：

- 不代表新的角色版权；
- 不产生与 Soul 竞争的第二套身份；
- 不可在脱离 Soul 或 Grant 的情况下独立转售；
- Soul 转手或 Grant 失效时，旧实例失去受保护内容和运行权限；
- 本地产生的记忆先形成候选内容，按持有人规则写回 Soul。

---

## 2. 资产不等于一个 NFT：需要拆成权利束

每个对象至少声明以下权利：

| 权利 | 含义 |
| --- | --- |
| Title | 链上对象由谁持有 |
| Access | 谁可以查看或解密内容 |
| Runtime | 谁可以在桌面、Chat、游戏或 Agent 中运行 |
| Modify | 是否允许修改形象、设定、技能和内容 |
| Derive | 是否允许生成新的 OC、皮肤、剧情或其他派生物 |
| Commercialize | 是否允许直播、广告、游戏、周边或其他商业使用 |
| Transfer | 对象或许可证是否可以转让 |
| Sublicense | 是否允许继续授权第三方 |
| Revenue | 哪些可验证收入需要向哪些上游分成 |

链上对象只是这些权利的载体。版权归属和法律授权仍需有明确文本，并把文本哈希、版本、适用地区、签署地址和时间锚定到链上。

---

## 3. 建议的链上对象模型

### 3.1 Animacraft

#### `MakerRoot`

稳定的 Maker 身份和来源对象，记录：

- 创作者与管理 Cap；
- Maker 类型和品牌；
- 当前版本；
- 收款 Treasury；
- 默认许可模板；
- 总量和发行策略；
- Referral Policy；
- 状态与争议标记。

MakerRoot 可以转移管理权，但“转移链上管理权是否连同版权转让”必须由独立法律文件定义，不能由 NFT 转移默认推断。

#### `MakerVersion`

不可静默修改的版本快照：

- Manifest / Walrus Blob；
- 素材尺寸、锚点、层级和兼容性；
- LicenseTerms ID 和文本哈希；
- 价格、免费部件、付费部件；
- 可铸数量和每钱包限制；
- 依赖及其许可和费用。

旧版本保持可核验；新规则原则上只影响未来授权。

#### `PartLicense` / `DLCEntitlement`

用户购买的不是素材版权，而是把指定部件用于一个或多个 Recipe/Soul 的许可。许可应声明：

- 按账户、按 Soul、按次数还是永久；
- 是否可转让；
- 是否可商用；
- 是否允许修改；
- 是否允许继续衍生；
- 退款和下架处理。

#### `CanonicalSoulMintAuthorization`

一次性、不可丢弃、只能由 Soulidity 消费的授权，确保：

- Maker 版本有效；
- Recipe 合规；
- 免费/付费/DLC 权限齐全；
- 数量没有超过上限；
- 付款、分账和 Soul 铸造在同一 PTB 原子完成。

### 3.2 Soulidity

#### `Soul`

唯一身份、所有权周期、来源、许可快照和内容索引。

#### `RuntimeGrant`

允许特定地址、Agent 或设备以指定 Scope 使用 Soul。Grant 是协议权限，不等同于完整法律许可。

#### `RuntimeProjection`

建议默认做成不可转让、可撤销或随 ownership epoch 自动失效的对象/凭证。Anima Desktop、游戏 Avatar、Chat Persona 都是 Projection 类型，而不是新的 Soul。

#### `Outcome / ContentVersion`

Runtime 产生的经历、记忆、技能或成就。写回分为 Receipt、Claim 和 Accepted State，防止任何 Runtime 擅自污染 Soul。

---

## 4. Animacraft 收入模型

### 4.1 免费 Maker

目标是获客和建立供给：

- Maker 使用费：0；
- 可免费生成基础 OC；
- 创作者可展示署名、主页和其他付费 Maker；
- 平台可补贴有限 gas，但必须设置反女巫配额；
- 免费输出可限制为个人/非商业许可；
- 商业许可、高清导出、扩展部件和特定 Runtime 能力可以付费。

免费不等于无许可。用户仍需签署并链上记录许可版本。

### 4.2 付费 Maker 解锁

建议分为三种，而不是一个含糊的“买 Maker”按钮：

1. **Single Soul License**：只允许创建并铸造一个 Soul；
2. **Creator License**：允许在额度内生成多个 Soul 或商业内容；
3. **Maker Management Transfer**：转移 Maker 管理权；极少发生，需单独合同。

初级成交建议参数：

| 收款方 | 建议比例 |
| --- | ---: |
| Maker 作者及素材依赖 | 85%–90% |
| Animacraft 协议/运营 | 7.5%–10% |
| 有效邀请人/策展人 | 0%–5% |

邀请奖励应从平台份额中支付，不能额外向 Maker 加税。无邀请人时，该部分可进入 Creator Growth Pool。

当前候选合约的“协议默认 50%”不适合创作者冷启动。建议升级为治理上限不高于 15%，首发默认 10%；如果短期不能升级，则付费路径不应公开激活。

### 4.3 DLC / Premium Parts

DLC 是最自然的重复收入，而不是强迫用户反复 Mint Soul：

- Maker 作者提供基础免费包；
- 付费包增加发型、服装、动作、表情、背景、技能和商业许可；
- DLC 可以按 Soul 绑定，避免把素材文件变成可无限转卖的商品；
- 多作者依赖按 Manifest 中的固定份额或权重分账；
- 每次购买都显示最终费用和许可范围。

建议：

```text
DLC Gross Revenue
  = Artist/Dependency Share 85%–90%
  + Protocol 7.5%–10%
  + Referral/Curator 0%–5%
```

### 4.4 限量 Mint

Maker 可以限定：

- 总 Soul 授权数；
- 某版本授权数；
- 某稀有 Part 的使用次数；
- 单钱包次数；
- 时间窗口；
- 商业许可席位。

但限量不应只是制造投机。限量理由应对应真实稀缺性，例如作者服务能力、商业授权席位、联名期限或游戏平衡。

---

## 5. Soulidity 收入模型

### 5.1 首次 Soul 铸造

Soulidity 不应对免费 Maker 强制收高额铸造费。建议：

- 基础 Soul 身份铸造：免费或仅 gas；
- Maker 使用费和 DLC：按 Animacraft 许可结算；
- 可选高级服务：长期存储、私密内容、定制 Agent 配置、认证和人工审核收费；
- 所有费用在一次报价中展开，不把费用藏在链上签名之后。

### 5.2 Soul 二级交易

当前 Soulidity 默认平台费 2.5% 可保留。建议设置总附加费硬上限：

```text
Buyer Total
  = Seller Listing Price
  + Platform Fee
  + Soul Creator Royalty
  + Maker Provenance Royalty
  + Collection Royalty

所有附加费合计建议 ≤ 10%，绝对上限 ≤ 12.5%
```

建议参数：

- 平台：2.5%；
- Maker 来源版税：0%–3%；
- Soul 原始创作者：0%–5%；
- Collection：0%–2.5%；
- 超过总上限时禁止挂牌，而不是按不透明顺序稀释。

不是每个 Maker 都应永久抽取所有 Soul 的所有收入。Maker 版税只适用于许可证明确列出的事件，例如 Soul 二级出售，不应默认覆盖桌宠使用、聊天或用户自己的委托创作。

### 5.3 Runtime 与 Anima Desktop

可收费的不是“再次购买 Soul”，而是运行服务：

- 高级 Desktop Runtime；
- 云同步与加密记忆；
- 模型调用、工具连接和 Agent 工作流；
- 动画包、语音包和互动 Scene；
- 多设备席位；
- 商业直播或品牌使用许可。

建议现金流：

| 收入事件 | 主要收款方 | 可选上游 |
| --- | --- | --- |
| Desktop Pro 订阅 | Runtime 运营方 | Soul/Maker 作者仅在有明确内容许可时参与 |
| 动画/语音 DLC | 内容作者 | Maker、平台 |
| Scene 门票 | Scene 作者 | 素材、Maker、验证者、平台 |
| Agent 调用 | 模型/工具/Runtime | Soul 作者通常不自动抽成 |
| 商业许可升级 | 权利人 | 平台、代理/邀请人 |

平台要避免“版税套娃”：如果每次模型调用都给 Maker、Soul 作者、Collection 和平台抽费，Runtime 会失去可用性。

---

## 6. Maker 邀请与增长系统

### 6.1 邀请什么

邀请分为两种，不能混用：

- **Creator Referral**：邀请一位有权上传原创 Maker 的作者；
- **Buyer Referral**：为某个 Maker 带来真实付费用户。

Creator Referral 的奖励应由被邀请 Maker 未来产生的**平台净收入**触发，而不是上传即发可套现资产。

### 6.2 建议规则

- 邀请关系在作者首次验证或发布前确认；
- 单层邀请，不做无限代际；
- 有效期 180 天或前 100 笔合格成交；
- 奖励来自平台费的 20%–30%，折算后约为 Gross 的 2%–3%；
- 退款、盗版、对刷和关联账户交易不计入；
- 设 14–30 天成熟期；
- Maker 作者可以看见邀请带来的成交和分账；
- 平台保留争议冻结权，但规则和处置事件可核验。

禁止多层返佣和以“拉 Maker 数量”作为主要收益来源，否则经济会从内容市场退化为拉人头系统。

---

## 7. 积分、Token 与 TGE

### 7.1 积分的正确用途

第一阶段积分建议是不可转让的 `Contribution Points`：

- 发布并通过审核的 Maker；
- 真实付费使用和留存；
- 邀请有效 Maker；
- 修复素材、补充文档和审核；
- Scene 使用和跨 Runtime 兼容；
- 社区策展和争议处理。

积分规则、版本和每期结算根可以上链；明细可由索引器计算并允许挑战。不要把所有行为逐笔上链，成本和隐私都不合理。

### 7.2 不应提前承诺固定换 Token

“积分以后按固定比例兑换 Token”会立即让积分具有投机预期，并诱发刷量、女巫和潜在监管问题。建议表述为：

> 积分记录可验证贡献，不代表股权、债权、收益权或未来 Token 请求权。若未来治理决定发行 Token，可独立决定是否以及如何参考历史贡献快照。

### 7.3 只有满足以下条件才进入 TGE 研究

- Maker / DLC / Soul / Runtime 已有持续 USDC 收入；
- Token 有链上不可替代的必要用途；
- 治理权、费用权和收益权经过法律分类；
- 有反女巫、锁定、披露和安全方案；
- 不用 Token 补贴掩盖负单位经济；
- 社区和投资者清楚股权、Token、Maker 管理权和收入权是不同工具。

潜在用途优先级：

1. 协议治理和风险参数；
2. 策展/争议/验证质押与惩罚；
3. 社区预算和 Scene Reward Pool；
4. 手续费折扣。

不建议把“价格上涨”或平台利润分红作为最初核心卖点。

---

## 8. 做市商与流动性

“Maker 限定 Mint 数量，所以引入做市商”并不自然成立。

传统做市需要：

- 足够同质或可替代的标的；
- 连续报价和稳定成交；
- 可估值库存；
- 清晰的清算、托管和市场操纵规则。

Maker、独特 Soul 和单个 OC 通常高度异质、低频且主观定价，不适合常规 AMM 或专业做市。

建议顺序：

1. Maker/Soul 固定价与拍卖；
2. Offer、Bid、荷兰拍和限时发售；
3. 对同质的 `License Seat` 或 DLC Edition 建立订单簿；
4. 有真实收入后研究特定 Maker 的收入分成凭证；
5. 最后才考虑流动性池或专业做市。

严禁平台或合作做市商通过对敲制造虚假成交量；任何库存激励、返佣和关联方身份都应披露。

---

## 9. Maker 素材接入与尺寸协议

现成画师和其他捏人平台作者是最直接的供给来源，但必须让迁移接近“打包一次，多处销售”：

### 9.1 必备素材规范

- 画布尺寸、像素密度和安全区；
- 每个部位的 anchor、pivot、z-index 和 blend mode；
- 透明通道、色彩空间和文件格式；
- 表情、姿势和动画命名；
- 缩略图、封面和导出规范；
- Runtime compatibility profile；
- Manifest、校验哈希和版本；
- 手机、Web、Desktop 的裁切策略；
- 最大文件、Walrus 存储期限和更新规则。

### 9.2 必备权利声明

作者至少确认：

- 是原创或有权再次授权；
- 在原平台发布不构成独家授权冲突；
- 允许 Animacraft 展示、组合、渲染和分销；
- 用户输出的个人/商业/修改/再分发范围；
- 是否允许 AI 训练或生成式修改；
- 侵权投诉、下架和既有购买者处理。

以 Picrew 为例，其现行条款允许 Creator 选择个人、非商业、商业和修改范围，但也规定了平台优先使用范围以及用户生成图像的再分发限制。因此，“作者在别的平台已经发布”不能直接推导出“可以搬来链上收费分销”，必须取得作者对 Animacraft 的单独授权。

---

## 10. 单位经济模型

### 10.1 Maker 付费解锁

设：

- `P` = Maker 解锁价；
- `c` = 作者与依赖分成；
- `f` = 平台费；
- `r` = 邀请奖励；
- `p` = 支付、gas 补贴、存储和风控可变成本。

要求：

```text
c + f + r = 100%
Platform Contribution Margin = P × f - P × r - p
```

推荐冷启动参数：

```text
c = 90%
f = 10%
r = 2.5%（从 f 中支付）
平台实际保留 = 7.5% - p
```

如果毛利不足，应通过 Pro 工具、存储、认证、Runtime 和 B2B 服务提高收入，不应把作者分成压到 50%。

### 10.2 关键指标

供给：

- Activated Makers；
- 30/90 日仍有使用的 Maker；
- Maker 发布到首次生成/首次收入时间；
- 免费 Maker 到付费 DLC 转化率；
- 每个 Maker 的有效部件数与兼容 Runtime 数。

需求：

- Maker 试玩 → OC 完成率；
- OC 完成 → Soul 铸造率；
- 首次 Soul → Desktop 激活率；
- 30 日仍活跃的 Soul；
- 每个付费用户的 DLC / Scene / Runtime 收入。

创作者：

- Maker 月收入中位数，而不只看头部 GMV；
- 首次提现时间；
- 作者收入占 Gross 比例；
- 退款、争议和侵权率；
- Referral 带来的真实留存，而不是注册数。

网络：

- 每个 Soul 进入的 Runtime 数；
- 每个 Maker 产生的独立 Soul 数；
- 跨 Scene 的 Accepted Outcomes；
- USDC 收入中来自真实使用而非二级交易的比例。

---

## 11. 分阶段实施

### Phase A：供给与许可

- 完成素材尺寸与 Manifest 规范；
- 准备个人、商业、修改、AI 使用四类许可模板；
- 签约 10–30 位已有 Maker 作者；
- 免费 Maker + 付费 DLC；
- USDC 原子分账；
- 不发行 Token，不开放做市。

### Phase B：唯一 Soul 与 Runtime

- 激活 Animacraft → Soulidity 同 PTB 适配器；
- 确保一个完成 OC 只产生一个 Soul；
- 实现 Maker 来源、LicenseTerms 和 Recipe 链上证明；
- Anima Desktop 通过 Grant 激活 Projection；
- 验证桌面激活和 30 日留存。

### Phase C：市场与增长

- Soul 二级市场总费率上限；
- 单层 Creator Referral；
- DLC、Scene、商业许可升级；
- Contribution Points 和可挑战的周期结算；
- 作者收入和退款仪表盘。

### Phase D：开放生态

- 第三方 Chat、Codex 类工具、Agent 与游戏 Runtime Adapter；
- Scene / Quest / Outcome；
- Reward Pool、赏金和里程碑托管；
- 多作者依赖自动分账。

### Phase E：融资与金融化研究

- 只对已发生、可核验的特定收入流研究融资；
- 区分股权、Token、Maker 管理权、许可和收入权；
- 评估 Token 必要性与 TGE；
- 对同质许可证或收入凭证研究流动性，不拿独特 Soul 强行做 AMM。

---

## 12. 需要修改或新增的协议决策

1. 把 Animacraft 初级协议费默认值从 50% 重设为 10% 左右，并把治理上限降至 15%。
2. Referral 从平台份额支付，禁止多层邀请。
3. 建立全局费用叠加上限，覆盖 Maker、Soul Creator、Collection 和平台。
4. 明确 `MakerRoot → MakerVersion → Recipe → Soul → RuntimeProjection` 来源图。
5. `RuntimeProjection` 默认不可转让，并绑定 Soul ownership epoch / Grant。
6. 许可文本和链上参数同时版本化；链上勾选记录同意，但不能替代合法有效的基础合同。
7. 积分默认不可转让、无固定 Token 兑换承诺。
8. 限量 Mint 与做市分开决策；先有成交和价格发现，再谈流动性。

---

## 13. 对 Maker 的市场话术

> 你不需要为 Animacraft 重新画一套作品。把已经完成、并且你有权再次授权的 Maker 按我们的素材规范打包，就能增加一个使用 USDC 结算的新分销渠道。版权和 Maker 来源仍属于你；每次使用、DLC 和约定的二级交易都按链上规则分账。用户获得的是明确许可下创建和持有自己 Soul 的权利，而不是拿走或倒卖你的底层素材。

平台定位：

> Animacraft 把 Maker 变成可持续发行的创作资产；Soulidity 把生成结果变成可持有、可授权、可跨 Runtime 运行的 Soul；Anima Desktop 让 Soul 真正进入用户每天使用的工作与聊天环境。

---

## 14. 外部研究依据

- [Story Protocol Licensing Module](https://docs.story.foundation/concepts/licensing-module/overview)：把 IP Asset、License Terms、License Token 与 derivative registration 分开，并通过父子关系路由版税。
- [Story Programmable IP License](https://docs.story.foundation/concepts/programmable-ip-license/overview)：说明链上参数需要对应现实法律文本；商业使用、派生、署名和许可费是不同条款。
- [Story Royalty Module](https://docs.story.foundation/concepts/royalty-module)：展示多级派生收入的累计 Royalty Stack；也反向说明 Animacraft 必须设置总费率上限。
- [Picrew Terms of Use](https://support.picrew.me/en/terms)：区分 Material、生成 Image、商业/非商业/个人使用和修改，并限制未经允许的再分发。
- [Picrew Scope of Image Use](https://support.picrew.me/en/create_imagemaker/scope_of_use)：证明捏人 Maker 需要让作者明确选择生成图的使用范围。
- [Roblox Creator Store](https://create.roblox.com/docs/production/creator-store)：创作者素材可免费或付费分发，权限在加载和插入时检查；其接近 100% net proceeds 的作者政策说明冷启动阶段不宜对生产工具抽取 50%。
- [Roblox Marketplace Fees](https://create.roblox.com/docs/marketplace/marketplace-fees-and-commissions)：展示 Creator、Seller/Affiliate 与 Platform 在二级交易中的分账，但其高平台费不宜直接照搬到早期 Animacraft。
- [Sui Documentation](https://docs.sui.io/)：Sui 的对象模型、Kiosk、支付和可组合资产能力适合分别承载 Maker、Soul、许可和运行权限。

## 15. 风险提示

本文是产品与协议经济研究，不构成法律、证券、税务或投资意见。特别是版权转让、商业许可、收入权、可交易积分、Token、做市和面向不同司法辖区的发行，需要在上线前由相应专业人员审阅。
