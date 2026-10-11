# Soulidity — Agent Management

> 本文件夹管理 Soulidity 的组织结构、角色分工和 AI Agent 配置。
> 每个角色文件可直接粘贴给 Claude，让 AI 以对应角色视角协作工作。

---

## 战略定位

**SEGA** — 基于注意力经济的 DeFi 产品与基础设施组织。

**Soul** — 注意力经济的核心承载体。不是捕捉注意力的结果，而是注意力本身的链上承载形式。Soul 活着、生长、可被授权运作——动态的、身份绑定的、持续积累的注意力实体。

**Soulidity** — Soul 的铸造、持有、授权、交易基础设施。SEGA 当前核心产品，基于 Sui 区块链构建。

---

## 组织架构总览

```
Soulidity
│
├── Soulidity Foundation（运营 · 发行 · 生态）
│   │
│   ├── Co-Chair，整体方向
│   │   └── Naoer Maksim（Co-Founder）
│   │
│   ├── Co-Chair，Listing + 投资人
│   │   ├── Trinity（美国，商务融资，主导 Eve 合作）
│   │   ├── Ann
│   │   ├── Wayne
│   │   └── Alex（香港，主导 Sui 对接）
│   │
│   └── AI 执行角色
│       ├── 品牌运营与增长
│       └── 社区管理
│
└── Soulidity Labs（研发 · 产品 · 技术）
    │
    ├── Labs CEO → Hunter（Co-Founder）
    │
    └── AI 执行角色
        ├── 产品经理（PM）
        ├── CTO（合约与技术架构）
        ├── 前端工程师
        ├── 后端工程师
        └── 全栈工程师
```

---

## 人类团队一览

| 姓名 | 对外 Title | 职能 | 所在地 |
|------|-----------|------|--------|
| Naoer Maksim | Co-Founder | Foundation 整体方向 | — | Slack |
| Hunter | Co-Founder, Labs | Labs CEO，技术研发 | — | Slack |
| Trinity | Partner, Foundation | Listing + 投资人，主导 Eve 合作 | 美国 | Slack |
| Alex | Partner, Foundation | Listing + 投资人，主导 Sui 对接 | 香港 | Slack |
| Ann | Foundation（外部） | Listing + 投资人执行 | — | Naoer 单独对接 |
| Wayne | Foundation（外部） | Listing + 投资人执行 | — | Alex 单独对接 |

---

## BD 分工

| 合作线 | 第一负责人 |
|--------|-----------|
| Walrus Grant | Naoer |
| Eve Collection 合作 | Trinity |
| Sui 官方认可 | Alex |

---

## 当前阶段目标

| 时间线 | 目标 |
|--------|------|
| **即时** | Walrus Grant ｜ Eve Collection ｜ Sui 认可 |
| **2 个月** | 关键合作签约，原型可演示 |
| **3 个月** | 完成本轮融资 |
| **6 个月** | TGE |

---

## 文件夹结构

```
agent-management/
├── README.md
├── milestones.md
│
├── foundation/
│   ├── README.md
│   ├── head.md          ← Naoer
│   ├── trinity.md
│   ├── alex.md
│   ├── ann.md
│   ├── wayne.md
│   └── ai-roles/
│       ├── brand-growth.md
│       └── community.md
│
├── labs/
│   ├── README.md
│   ├── hunter.md
│   └── ai-roles/
│       ├── pm.md
│       ├── cto.md
│       ├── frontend.md
│       ├── backend.md
│       └── fullstack.md
│
└── shared/
    ├── bd-priorities.md
    ├── decision-log.md
    └── context-sync.md
```

---

*最后更新：2026-04-13*
