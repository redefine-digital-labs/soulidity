# Plan: Soul 单对象 Kiosk 资产重写（删除 Series / Release / Subscription）

## 摘要

- 合约彻底重写为单对象模型：不再有 `Series`、`Release`、`PerpetualPass`、`SubscriptionPass`。
- 新协议里唯一可交易对象是 `Soul has key, store`。它本身就是被首发、持有、转售、下载授权的资产。
- `Soul` 直接持有 Walrus `Blob`，并支持 Sui `Display` 标准；Display 只挂在 `Soul` 上。
- 交易统一走 Kiosk。作者 mint 一个 `Soul` 做首发；首单后该对象继续在持有者之间二级转售。
- 全栈一起删掉 subscription：Move、Prisma、API、UI、tx builder、Seal policy、测试、文档都不再保留 subscription 分支。

## 核心约束

### 协议边界

- 协议层不再承担“同内容防重卖”的责任。
- 每个 `Soul` 都是独立资产。
- 作者未来重新 mint 一个新的 `Soul`，哪怕内容近似，协议不拦。
- 因此，本次重写不再保留任何 `Series` 根对象去约束“同一商品线只能卖一次”。

### 展示语义

- 只给 `Soul` 做 `Display`。
- `Display` 展示图、标题、描述在 `Soul` 铸造时固定。
- 已售资产的显示内容不跟随后续链下页面或作者资料变化。

### 元数据策略

- `Soul` 链上只放最小展示字段：
  - `name`
  - `description`
  - `image_url`
- 长文、附加属性、扩展资料走 Walrus metadata。

## 合约设计

### `Soul` 对象

新包中的核心资产对象定义为单一 `Soul`，至少包含：

- `creator`
- `owner`
- `name`
- `description`
- `image_url`
- `content_blob`，直接持有 Walrus `Blob`
- `metadata_ref`，可选的 Walrus 扩展元数据引用
- `agent_grant`

推荐形态：

```move
public struct Soul has key, store {
    id: UID,
    creator: address,
    owner: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    agent_grant: Option<address>,
}
```

说明：

- `Soul` 直接持有 `Blob`，不采用仅存 `blob id` 的弱引用模式。
- `Soul` 不再拆成“作品描述对象 + 内容版本对象 + 权益对象”三层。

### 模块边界

新包保留这些核心模块即可：

- `soul.move`
  - `Soul` 定义
  - `mint_soul`
  - 当前 owner / agent grant 的最小状态读写
- `market.move`
  - `TransferPolicy<Soul>` 初始化
  - Kiosk 首发上架
  - 二级转售辅助
  - 平台费 / 版税规则接入
- `grant.move`
  - owner 给 agent 设置 / 撤销 `agent_grant`
- `seal_policy.move`
  - 基于 `Soul` 的访问审批
- `platform_fee_rule.move`
  - 平台费规则
- `royalty_rule.move`
  - 作者版税规则
- `display.move` 或等价初始化逻辑
  - 发布 `Display<Soul>`
- `events.move` / `config.move`
  - 平台配置与事件

### 彻底删除的合约概念

以下对象、函数、常量、事件、测试全部删除，不保留兼容壳：

- `Series`
- `Release`
- `PerpetualPass`
- `SubscriptionPass`
- `buy_perpetual`
- `buy_subscription`
- `renew_subscription`
- `PLAN_ONETIME`
- `PLAN_SUBSCRIPTION`
- `PricingPlan`
- 所有 `period_ms` / `expires_at` / `plan_type` 逻辑
- `seal_approve_subscription`
- subscription grant / renew / event / test

## Kiosk 与 Display

### Kiosk 交易模型

- 作者 mint 一个 `Soul` 后，将该 `Soul` 直接上架到 Kiosk 做首发。
- 首单成交后，`Soul` 继续存在，由买家持有。
- 后续如需二级市场，继续转售的是同一个 `Soul` 对象，不再重新铸造任何新权益对象。
- `place_and_list` 必须拒绝 `price = 0` 的上架，避免把免费转移混进销售路径。
- `TransferPolicy<Soul>` 统一承载：
  - 平台费
  - 版税
  - 允许的交易路径

### Display 标准

`Display<Soul>` 至少暴露：

- `name`
- `description`
- `image_url`
- `creator`

字段来源：

- `name` <- `Soul.name`
- `description` <- `Soul.description`
- `image_url` <- `Soul.image_url`
- `creator` <- `Soul.creator`

默认展示图使用铸造时选定的固定封面，不跟随链下页面更新。

### Seal 文档 ID

- `seal_approve` 使用强格式文档 ID，不再只校验 `soul_id` 前缀。
- 固定格式为：`domain + version + soul_id + nonce`
- 当前约定：
  - `domain = "soul-seal:"`
  - `version = 0x01`
  - `nonce >= 16 bytes`
- 校验顺序：
  - caller 必须是 owner 或已授权 agent
  - 长度满足最小格式要求
  - `domain` 精确匹配
  - `version` 精确匹配
  - `soul_id` 精确匹配

## 全栈改造

### 数据模型

运行时数据库从当前三层镜像收敛为单一 `Soul` 镜像模型，不再保留：

- `SoulSeries`
- `SoulRelease`
- `SoulPassSnapshot`

新的运行时镜像最少需要：

- `soulOnChainId`
- `creatorAddress`
- `ownerAddress`
- `ownerMemberId`
- `name`
- `description`
- `imageUrl`
- `walrusBlobObjectId`
- `walrusBlobId`
- `metadataRef`
- `agentGrant`

是否需要单独的 ownership history 表，不影响运行时闭环；默认不作为本期必须项。

### API 与前端

应用层语义统一切成 `Soul`：

- purchase / execute 返回 `soulOnChainId`
- 下载接口按 `soulId`
- agent access 基于 `Soul` 与 `agent_grant`
- 发布页直接创建单个 `Soul`
- 详情页、列表页、我的资产页都直接展示 `Soul`

必须删除的运行时接口与 UI：

- renew route
- subscription purchase route
- subscription pricing UI
- `PlanSelector`
- subscription access 分支
- subscription seal runtime descriptor

## 测试与验收

### Move 测试

- 作者可以 mint `Soul`
- 作者可以把 `Soul` 上架到 Kiosk
- 首单购买成功
- 持有者二级转售成功
- `Blob` 随 `Soul` 原子转移
- `agent_grant` 对当前 owner 生效
- `Display<Soul>` 正常返回 `name/description/image_url/creator`
- 零价上架被拒绝
- `seal` 文档 ID 的错误 domain / version / soul_id / 长度都被拒绝

### 应用层测试

- purchase 返回 `soulOnChainId`
- 下载按 `soulId` 成功
- agent access 基于 `Soul` 正常工作
- 发布页不再出现 subscription / release / version
- 列表 / 详情 / 我的资产只展示 `Soul`

### 清理验收

在 `move/soul_object`、`web`、`prisma` 的新运行时代码中，以下搜索结果必须为 0：

- `Series`
- `Release`
- `SubscriptionPass`
- `buy_subscription`
- `renew_subscription`
- `PLAN_SUBSCRIPTION`
- `PricingPlan`

说明：

- `move/soul_market` 视为 legacy 包；迁移完成前不再承接任何新模型实现，本期保留、不删除。
- 历史文档如需保留，必须放到明确的 legacy 文档目录；运行时代码与当前主计划中不再出现这些概念。

## 假设

- 当前是开发环境，允许直接切全新包，不做旧 subscription 兼容。
- 协议层接受“每个 `Soul` 都是独立资产”，不做跨 `Soul` 的内容唯一性保证。
- `Soul` 直接持有 Walrus `Blob`。
- 保留 agent grant / Seal 访问能力，但授权对象从旧的 pass 改为 `Soul`。
