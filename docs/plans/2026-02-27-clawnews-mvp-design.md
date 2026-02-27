# ClawNews MVP 设计文档

## 概述

AI×Web3 内容社区的完整 MVP。自动采集 RSS + GitHub Trending 素材，通过 Claude API 生成中英双语内容，经 Web 后台审核后发布到 Telegram 频道，配合 Mock 版验证入群的 TG 社群。

## 架构

```
clawnews/
├── src/
│   ├── collector/       ← RSS + GitHub 采集
│   ├── producer/        ← Claude API 制作内容
│   ├── publisher/       ← TG Bot + 定时发布
│   ├── db/              ← SQLite + schema + 查询
│   └── shared/          ← 类型定义、工具函数
├── web/                 ← Next.js 审核后台
│   ├── app/
│   │   ├── dashboard/
│   │   ├── articles/[id]/
│   │   ├── verify/
│   │   ├── admin/members/
│   │   ├── admin/invites/
│   │   └── api/
│   └── package.json
├── data/                ← SQLite 文件
└── package.json         ← monorepo root
```

## 技术栈

- TypeScript + Node.js
- SQLite (better-sqlite3)
- Anthropic SDK (Claude Sonnet)
- Next.js (审核后台)
- grammy (TG Bot)
- node-cron (调度)
- rss-parser + GitHub API (采集)

## 数据模型

```sql
CREATE TABLE raw_items (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- 'rss' | 'github'
  source_name TEXT NOT NULL,        -- 'coindesk' | 'github-trending'
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  content     TEXT,
  language    TEXT DEFAULT 'en',
  score       REAL DEFAULT 0,
  status      TEXT DEFAULT 'new',   -- 'new' | 'processing' | 'produced' | 'published' | 'rejected'
  raw_data    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id          TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  title_zh    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  summary_zh  TEXT NOT NULL,
  summary_en  TEXT NOT NULL,
  analysis_zh TEXT,
  analysis_en TEXT,
  tags        TEXT,                  -- JSON array
  status      TEXT DEFAULT 'draft',  -- 'draft' | 'reviewed' | 'published'
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE publications (
  id           TEXT PRIMARY KEY,
  article_id   TEXT REFERENCES articles(id),
  channel      TEXT NOT NULL,        -- 'tg_daily' | 'tg_flash'
  message_id   TEXT,
  published_at TEXT
);

CREATE TABLE members (
  id          TEXT PRIMARY KEY,
  tg_id       TEXT NOT NULL UNIQUE,
  tg_name     TEXT,
  wallet      TEXT,                  -- 预留 OpenClaw
  level       INTEGER DEFAULT 1,    -- 1-3
  invite_code TEXT,
  joined_at   TEXT DEFAULT (datetime('now'))
);
```

## 管线流转

```
采集 (new) → AI 制作 (draft) → Web 审核 (reviewed) → TG 发布 (published)
```

status 字段驱动每个阶段，各模块只处理自己关心的状态。

## 采集引擎

### RSS 采集器
- 数据源：CoinDesk, TheBlock, Decrypt
- 库：rss-parser
- 频率：每小时

### GitHub Trending 采集器
- 方式：GitHub Search API (q=ai+agent, sort=stars, 近期创建)
- 频率：每天一次

### 评分机制
- 关键词匹配 title + content
- high: ai agent, web3 ai, defi ai (+3)
- medium: artificial intelligence, smart contract (+1)
- low: crypto, blockchain (+0.5)

## 内容制作

- 从 raw_items 取 status='new' 且 score 最高的素材
- 调用 Anthropic API (Claude Sonnet) 生成中英双语 JSON
- 输出字段：title_zh/en, summary_zh/en, analysis_zh/en, tags
- 每次最多处理 10 条，控制成本
- LLM adapter 层：默认 Anthropic，可切换其他模型 (如 minimax 2.5)

## Web 审核后台

### 页面
- /dashboard — 文章列表，按 status 筛选，显示标题/来源/评分/时间
- /articles/[id] — 文章详情，中英双语左右对照，可编辑，可发布/打回
- /verify?tg_id=xxx — 入群验证页面
- /admin/members — 成员管理
- /admin/invites — 邀请码管理

### API Routes
- GET/PATCH /api/articles — 列表、编辑、状态更新
- POST /api/articles/[id]/publish — 发布到 TG
- GET /api/stats — 统计数据

## Telegram

### 频道发布
- grammy Bot
- 定时发布：早 9:00 晨报、午 12:00 深度、晚 20:00 日报
- Web 后台手动发布
- 发布记录写入 publications 表

### 社群验证 (Mock)
- 邀请码验证替代 OpenClaw 链上验证
- members.wallet 预留，后续切换到链上查询
- Bot 命令：/join, /verify, /mystatus

## 消息格式

```
📰 中文标题
English Title

🔗 source_url
🏷️ #tag1 #tag2

📝 摘要
中文摘要内容

📝 Summary
English summary

🔍 解读
中文深度解读

---
by ClawNews 🦞
```

## 实施顺序

### Phase 1：基础设施
1. 项目初始化（monorepo、TypeScript、SQLite）
2. 数据库 schema + 基础查询层

### Phase 2：内容管线
3. RSS 采集器
4. GitHub Trending 采集器
5. 评分机制
6. AI 内容制作（Anthropic API + adapter）

### Phase 3：Web 审核后台
7. Next.js 项目搭建 + API Routes
8. Dashboard 文章列表页
9. 文章详情 + 编辑页

### Phase 4：Telegram 发布
10. TG Bot 搭建（grammy）
11. 频道定时发布 + 手动发布
12. Web 后台「发布」按钮对接 TG

### Phase 5：社群验证（Mock）
13. 邀请码验证流程
14. 成员管理页
15. Bot 入群管理命令

### Phase 6：串联 + 调度
16. node-cron 定时任务编排
17. 主入口：一键启动所有服务

## 设计决策

- **本地优先**：先本地跑通，部署后续再决定
- **SQLite**：零配置，单文件，够用
- **LLM adapter**：Anthropic 默认，可切换
- **Mock 验证**：OpenClaw 不存在，邀请码替代，预留 wallet 字段
- **TG Bot 审核 → Web 审核**：Web 后台做审核，Bot 只负责发消息
- **中英双语**：采集英文源，AI 产出双语内容
