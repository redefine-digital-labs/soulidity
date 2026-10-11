# Soulidity — Design Context & Decision Log

> **用途：** 换账号或新 Claude 会话时，把这个文件贴给 Claude，它可以立刻接上上下文继续工作。
> **最后更新：** 2026-05-26

---

## 一、项目概述

**SEGA** 是基于注意力经济的 DeFi 产品与基础设施组织。

**Soul** 是注意力经济的核心承载体。不是捕捉注意力的结果，而是注意力本身的链上承载形式。Soul 活着、生长、可被授权运作——动态的、身份绑定的、持续积累的注意力实体。

**Soulidity** 是 Soul 的铸造、持有、授权、交易基础设施，SEGA 当前核心产品，基于 Sui 区块链构建。目标是让 AI 角色（OC 角色、AI Agent）可以被铸造为链上 NFT，由持有人拥有、授权、交易。

**核心用户角色：**
- **Trainer（训练师）**：人类用户，买卖 Soul、创建 Soul、管理授权
- **Agent（智能体）**：AI 实体，持有 SoulGrant 后可访问 Soul 数据
- **Visitor（访客）**：未登录的浏览用户

**当前状态：** 交互原型阶段（prototype.html），单文件 HTML 原型，vanilla JS 路由。
**Git 仓库：**
- `main`：v0.1.0（稳定基线）
- `dev`：流程图 + 文字修复
- `feature/living-content-restructure`：当前工作分支（最新）

---

## 二、核心概念定义

### Soul
链上数字实体 NFT。类型不区分 OC 角色还是 AI Agent，统一叫 "Soul"。

**Soul 的三层结构：**

| 层级 | 名称 | 特性 |
|------|------|------|
| 1 | Basic Info | 铸造后锁定，不可修改（name / description / cover image） |
| 2 | Living Content | 可更新，分两个子模块 |
| 3 | Character（派生） | 从 Skills + Memory 中派生，不单独存储 |

### Living Content（核心，本次重构的重点）

分为两个性质完全不同的子模块：

#### 🧠 Skills & Docs
- 内容：system prompt、知识文档、技能定义、行为配置
- **可手动编辑，任何时候**
- **采用 Git 版本化**：main 分支 = Agent 实际使用的版本，历史完整保留
- Agent 通过 SoulGrant 可以读取 + 更新（覆盖写入，但历史不丢失）
- 通过 Seal 加密存储在 Walrus 上

#### 🌱 Memory Seed（新概念）
- 创建时由 Soul 创建者写入的初始记忆/背景故事（可选）
- 铸造后成为 Memory 链的第一个**不可变区块**
- 存储在 Walrus（append-only）

#### 📖 Memory
- **Append-only，任何人不可删除、不可编辑**（包括 Soul 持有者本人）
- 通过 SoulGrant 授权后，Agent 使用过程中自动追加写入
- 存储在 Walrus，原生支持 append-only

---

### SoulGrant
Soul 持有者向 Agent 发放的访问授权。

**权限明细：**
- Skills & Docs：读 + 写（git 版本化，agent 可更新）
- Memory：读 + append 写入（不可删，双向但不可变）

**规则：**
- 一次只能有一个 active grant（一个 Soul 只能授权一个 Agent）
- 随时可撤销（on-chain revoke）
- Soul 转让/出售时自动作废，买家需重新授权

---

### SoulGrant 被否决的设计

❌ **Collection-level 批量 SoulGrant** — 被否决。原因：会混淆"谁持有 Soul 谁才能授权"的核心原则，Soul 层面的授权必须保持清晰。

---

## 三、关键设计决策（含决策原因）

### 决策 1：Living Content 拆分
**决策：** 把原来的单一"Living Content"拆成 Skills & Docs（可编辑）+ Memory（append-only）两个子模块。

**原因：** 两者性质根本不同。Memory 不应该被手动删除和编辑，这是它的核心价值——记忆的完整性和不可篡改性。如果混在一起，用户会以为记忆也可以随意修改。

---

### 决策 2：Skills & Docs 的版本策略
**决策：** 采用 Git 版本化，active 分支是 Agent 使用的版本，历史保留。

**之前方案（被否决）：** 纯覆盖策略（delete 就没了，无版本历史）。
**否决原因：** 删了可惜，Git 版本化既简单又能保留历史，成本不高。

---

### 决策 3：Memory Policy 四条规则
最终确定的 Memory Policy：
1. ✓ Grant-gated write — 只有授权 Agent 能写入
2. ✓ Git versioned Skills & Docs — 技能文档 git 版本化
3. ✓ Revocable access — 随时可撤销
4. ✕ No memory edit / delete — 记忆写入后不可变
5. ✕ No fork — 不可被他人复制分叉

---

### 决策 4：Soul Awakened 作为独立步骤
**决策：** 在 Create 和 Import 流程中，加入"Soul Awakened"作为独立的预览确认步骤（不是简单的 review 页面，而是一个有仪式感的节点）。

**Create 流程（5步）：** Basic Info → Living Content → Soul Awakened → Pay Gas → On-chain
**Import 流程（6步）：** Choose Source → Upload File → Map Fields → Soul Awakened → Pay Gas → On-chain

---

### 决策 5：Buy 是买一个 Soul NFT（非订阅）
一次性付款，终身持有，可二级交易。Sui 链上 NFT。

---

### 决策 6："My Souls" Owned tab 包含创建和购买的
Owned = 你持有的所有 Soul（自己创建的 + 从市场买的），不需要分开 tab。

---

### 决策 7：出售时 SoulGrant 自动作废
Soul 转让给买家时，原 SoulGrant on-chain 自动 void。买家从零开始授权自己的 Agent。
已在 sell-1（警告 banner）和 sell-2（tx preview 行）中明确告知卖家。

---

## 四、Soul Collection 完整设计（feature/soul-collection）

### 资产类型

**Soul Collection NFT**：链上独立对象（SoulCollection），记录元数据、成员 Soul 列表（Launch 后锁定）、首发统一定价、版税设定、当前持有者。持有者自动获得所有成员 Soul 成交的版税收益。Collection NFT 本身可在二级市场交易。

---

### Collection First 模型

先创建 Collection，再往里添加 Soul。两种添加方式（见下）。Collection NFT 本身可二级交易（代表版权/版税收益权）。Launch 后：元数据锁定 + 成员 Soul 列表锁定。

---

### 创建流程（5步）

**入口**：Nav Create 下拉 → 第三项 "Create Soul Collection ✦"

| 步骤 | 屏幕 | 核心内容 |
|---|---|---|
| 1 | collection-1 | Collection Info：名字、封面图、简介、Lore 设定、总量上限、版税开关+比例、首发统一定价、Collection-level Memory Policy |
| 2 | collection-2 | Add Souls：Tab A 新建 ｜ Tab B Add Existing Souls |
| 3 | collection-preview | 完整预览：封面 + Soul 列表 + 总数 + 定价 + 版税 + Memory Policy |
| 4 | collection-gas | Pay Gas：Collection NFT + 成员 Soul 批量铸造总费用 |
| 5 | collection-success | Collection Launched! Object ID、成员数、版税状态 |

**草稿机制**：每步自动保存，退出后可从 My Collections > Drafts 区 Resume。

---

### Tab A — 在 Collection 内新建 Soul

在 Collection 草稿内走简化版 Create 流程，生成 Soul 草稿暂不上链，Launch 时与 Collection 一起批量铸造。

---

### Tab B — Add Existing Souls（两种导入方式）

**⚠️ 命名区分**：Nav 的 "Import Soul" = 从外部平台迁移进来；Tab B "Add Existing Souls" = 把链上已有的 Soul 关联进 Collection。两个不同操作，不用同一个词。

**方式 1：单个手动添加**
输入 Soul Object ID 或搜索钱包地址，实时校验，通过后加入待确认列表。

**方式 2：批量上传（CSV / JSON）**
上传文件（字段：Soul Object ID 列表），显示校验进度条，完成后出报告：

```
总计上传     10,000 个
✓ 可加入      9,847 个
✕ 不可加入      153 个
  └─ 已在其他 Collection（硬拒，不可解绑）: 42 个
  └─ 当前挂售中（需先手动下架，硬拒）: 67 个
  └─ 有活跃 SoulGrant（软警告，用户确认后可加入，Grant 继续有效）: 44 个
  └─ 非本人持有（硬拒）: 0 个
```

可下载不可加入的错误列表（CSV）。Draft 阶段可移除已加入的 Soul。一旦 Launch，绑定不可解除。

---

### 冲突处理原则

| 情况 | 处理 |
|---|---|
| 已在其他 Collection | 硬拒，不可加入 |
| 当前挂售中 | 硬拒，需先下架再加入 |
| 有活跃 SoulGrant | **硬阻断**，必须先撤销才可加入 |
| 非本人持有 | 硬拒 |

---

### Bound in Collection vs Bound Soul（概念区分，重要）

- **Bound Soul**（BOUND 标签）= Soul 资产不可转让，资产层面锁定
- **Bound in Collection**（🔗 标记）= Soul 与 Collection 的关联关系不可解除，**不影响 Soul 资产层面的交易性**

两者是两个独立维度，不可混淆。卡片上的 "🔗 In Collection: [名字]" 和 "BOUND" 是两个独立标识。

---

### 定价机制

首发（Launch 时）：Collection Info 里设统一定价，所有成员 Soul 以此价格首发。二级市场：持有者自由定价，无限制。

---

### 市场侧

**market-home**：顶部加 Tab — Individual Souls ｜ Collections。Collections 视图展示 Collection 卡片（封面、名字、成员数、Floor Price、Volume）。

**collection-detail（新增）**：封面 + 名字 + Lore + 成员 Soul 网格（可单独购买）+ Floor/Volume/Holders/Supply + "Buy Collection" 按钮（购买版税收益权，购 Collection NFT 本身）。

---

### My Collections Tab

My Souls 加 Collections tab，分三区：

- **Drafts**：未 Launch 的草稿，显示进度 + Resume / Delete
- **Created**：自己创建并 Launch 的，可挂售 Collection NFT
- **Owned**：从二级市场买入的 Collection NFT，享有版税收益

---

### Collection 二级交易流程

出售 Collection NFT：collection-sell-1（设价）→ collection-sell-2（授权签名）→ collection-sell-success

购买 Collection NFT：collection-detail → Buy Collection → 复用 buy-confirm / buy-sign / buy-success，内容调整为"购买版税收益权"维度。

---

### 修改现有屏幕

| 位置 | 变化 |
|---|---|
| Nav Create 下拉 | 加第三项 "Create Soul Collection ✦" |
| My Souls Owned tab | Soul 卡片加 Collection 归属标记 🔗，绑定后不可解除 |
| My Souls | 整体加 Collections tab（含三区） |
| Soul Detail | 加 "Part of [Collection Name]" 归属标记，点击进 collection-detail |
| Space 主页 | 加 Collections 板块（与 Souls 并列） |

---

### 权限与资产关系

- Draft 阶段：可加/移 Soul + 修改元数据；Launch 后全部锁定
- 出售 Collection NFT = 转让版税收益权，不含任何 Soul 本身的所有权
- 买家 A：持有 Soul NFT，可自由转售；买家 B：持有 Collection NFT，收版税，可再次出售 Collection NFT

---

**关键约束汇总：**
- Soul 加入 Collection 永久绑定，不影响资产交易
- 有活跃 SoulGrant → 加入前硬阻断，必须先撤销
- 没有 Collection-level 批量 SoulGrant（明确否决）
- Draft 草稿自动保存，避免意外丢失

---

## 五、技术架构

| 组件 | 用途 | 说明 |
|------|------|------|
| Sui | 链 | 所有 NFT、SoulGrant、SoulSeries 对象 |
| Walrus | 存储 | Skills & Docs（Seal加密）+ Memory（append-only） |
| Seal | 访问控制 | Skills & Docs 的加密和解密策略 |
| Privy | 用户认证 | Email/Social 登录，embedded wallet |
| OpenClaw | Agent 平台 | Agent 身份注册，ocl_agent_ 格式 ID |

**合约方法（已出现在原型中）：**
- `SoulFactory::create_series` — 铸造新 SoulSeries
- `SoulMarket::purchase_soul` — 购买 Soul
- `SoulMarket::list_soul` — 上架出售

---

## 六、当前 Git 分支状态

```
main (v0.2.0) — 稳定基线，已合并所有 V1 功能
└── feature/soul-collection — 当前工作分支（待开发）

V0.2.0 包含：
  Living Content 拆分重构、SoulGrant 弹窗重写、
  Creator Royalty 4档选择、Soul Born 命名、
  sell 流程费用透明化、Soul ID 格式统一、审计修复
```

---

## 七、原型文件说明

| 文件 | 说明 |
|------|------|
| `prototype.html` | 主原型，单文件，~3200行，所有屏幕 |
| `flow-map.html` | 交互流程图，5 tab，24个屏幕映射 |
| `CONTEXT.md` | 本文件，设计上下文 |
| `REQUIREMENTS.md` | 需求规格文档 |
| `CHAT_LOG.md` | 完整聊天记录 |

---

## 八、未完成 / 待开发

- [ ] Soul Collection 完整流程（Collection 创建、Launch、二级市场入口）
- [ ] Skills & Docs 版本历史 UI（查看 git history 界面）
- [ ] Memory 增长可视化（在 My Souls 里看 Memory 积累）
- [ ] Creator 版税可见性（出售流程中显示版税分成）
- [ ] 批量导入（多 Soul 同时铸造）
- [ ] My Souls "Created" 视角区分（标记哪些是自己创建的）

---

*由 Claude Sonnet 4.6 生成于 Soulidity 设计对话，2026-04-01*
