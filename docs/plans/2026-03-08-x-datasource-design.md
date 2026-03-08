# X 数据源接入设计

日期：2026-03-08

## 概述

从外部 Supabase 数据库接入 X（Twitter）推文数据，经关键词过滤后进入 ClawNews pipeline。

- LONG 推文：通过过滤后直接写入 `RawItem`，`status='new'`
- SHORT 推文：通过过滤后进入人工审核，`status='pending_review'`
- 审核通过：保留原始推文正文，只把审核阶段生成的标题/摘要写入 `rawData.review`

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 过滤策略 | 关键词匹配 | 零 LLM 成本，便于日志和快速迭代 |
| 新推文同步 | CollectorState 游标 | 避免每 30 分钟全表扫描 |
| 幂等策略 | `raw_items.url` 唯一约束兜底 | 游标回退或任务重跑时不重复入库 |
| 短推审核 | 人工审核 + LLM 扩写 | 保证短文本成稿质量 |
| 审核写回策略 | 仅写 `rawData.review` | 不覆盖原始信源内容，保证可追溯 |
| Pipeline 使用审核结果 | 作为 reporter 提示词 | 提高成稿质量，但不污染原始素材 |

## 架构

```text
外部 Supabase (tweets + authors)
       ↓
  [X Collector] — */30 * * * *
       ↓
  1. 从 collector_states 读取 source='x' 的游标
  2. 按 (posted_at, tweet_id) 增量拉取
  3. 关键词过滤
  4. LONG  → RawItem(status=new)
     SHORT → RawItem(status=pending_review)
  5. 无论通过过滤与否，只要已扫描到就推进游标
       ↓
  LONG  → 去重 → 生产 → 发布
  SHORT → Admin 审核 → rawData.review → status=new → 去重 → 生产 → 发布
```

## 关键词过滤

```ts
const CORE_KEYWORDS = ['openclaw', 'openaiclaw']
const EDGE_KEYWORDS = [
  'openai', 'ai agent', 'claude', 'mcp', 'cursor',
  'windsurf', 'copilot', 'devin', 'anthropic', 'ai编程', 'ai coding',
]

function filterTweet(content: string, type: 'SHORT' | 'LONG') {
  const lower = content.toLowerCase()

  if (type === 'LONG') {
    return [...CORE_KEYWORDS, ...EDGE_KEYWORDS].some(kw => lower.includes(kw))
  }

  const coreHit = CORE_KEYWORDS.some(kw => lower.includes(kw))
  if (coreHit) return true

  const edgeHits = EDGE_KEYWORDS.filter(kw => lower.includes(kw))
  return edgeHits.length >= 2
}
```

## 增量同步策略

ClawNews 侧新增 `collector_states` 表，记录 X collector 的扫描进度：

```text
source='x'
last_posted_at
last_tweet_id
updated_at
```

查询策略：

```sql
WHERE posted_at > :last_posted_at
   OR (posted_at = :last_posted_at AND tweet_id > :last_tweet_id)
ORDER BY posted_at ASC, tweet_id ASC
LIMIT :batch_size
```

关键约束：

- 游标表示“已扫描到哪里”，不是“已成功插入到哪里”
- 即使某条推文被过滤掉，也要推进游标
- 如果任务在一批处理中途失败，最多重复处理本批已扫过的数据；由 `url` 唯一约束保证幂等

## RawItem 字段映射

| RawItem 字段 | SHORT 推文 | LONG 推文 |
|-------------|-----------|----------|
| `sourceType` | `'x'` | `'x'` |
| `sourceName` | `x:${username}` | `x:${username}` |
| `title` | 原始推文前 100 字 | 原始推文前 60 字 |
| `content` | 原始完整推文正文 | 原始完整推文正文 |
| `url` | `tweet_url` | `tweet_url` |
| `status` | `pending_review` | `new` |
| `score` | 基于互动数据计算 | 基于互动数据计算 |
| `rawData` | 推文元信息 JSON | 推文元信息 JSON |

`rawData` 结构示例：

```json
{
  "tweet_id": "1891234567890",
  "tweet_url": "https://x.com/...",
  "author": "openclaw",
  "display_name": "OpenClaw",
  "like_count": 120,
  "retweet_count": 24,
  "reply_count": 8,
  "view_count": 5600,
  "tweet_type": "SHORT",
  "posted_at": "2026-03-08T08:00:00.000Z"
}
```

## 评分策略

```ts
function scoreTweet(tweet: { like_count, retweet_count, reply_count, view_count }): number {
  const engagement = tweet.like_count + tweet.retweet_count * 2 + tweet.reply_count
  const viewRatio = tweet.view_count > 0 ? engagement / tweet.view_count : 0
  return Math.min(100, Math.round(viewRatio * 1000 + Math.log10(engagement + 1) * 15))
}
```

## 短推审核流程

```text
SHORT 推文通过过滤
       ↓
  写入 RawItem(status=pending_review)
       ↓
  Admin /admin/tweets 审核
       ↓ (通过)
  调 LLM 生成审核建议标题 + 摘要
       ↓
  写入 rawData.review:
    - title
    - summary
    - reviewedAt
  status → new
       ↓
  进入正常 pipeline
```

审核通过时不做的事：

- 不覆盖 `RawItem.content`
- 不覆盖 `RawItem.title`
- 不把 LLM 摘要当成原始素材

## Pipeline 行为

`producer` 阶段仍以 `RawItem.title` 和 `RawItem.content` 作为原始素材。

如果 `rawData.review` 存在，则 reporter prompt 会附带：

- 建议标题
- 建议摘要

但这些内容只作为写作提示，不能新增原始推文里不存在的事实。

## Admin 后台

新增页面：`/admin/tweets`

- `GET /api/admin/tweets`：获取 `sourceType='x' AND status='pending_review'` 的 RawItem
- `POST /api/admin/tweets/[id]/approve`：生成审核建议并写入 `rawData.review`，然后 `status='new'`
- `POST /api/admin/tweets/[id]/reject`：`status='rejected'`

## 数据库改动

### Prisma schema

新增 `CollectorState` 模型：

```prisma
model CollectorState {
  source       String    @id
  lastPostedAt DateTime? @map("last_posted_at")
  lastTweetId  String?   @map("last_tweet_id")
  updatedAt    DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("collector_states")
}
```

说明：

- `RawItem.status` 仍然是字符串字段，不需要 status enum migration
- `tweet_id` 不新增独立列，放入 `rawData`

## 新增或修改的关键文件

- `src/collector/x.ts`：游标增量拉取 + 入库
- `src/db/database.ts`：CollectorState 读写 helper
- `prisma/schema.prisma`：新增 `CollectorState`
- `prisma/migrations/20260308115500_add_collector_state/migration.sql`
- `web/app/api/admin/tweets/[id]/approve/route.ts`：审核通过时只写 `rawData.review`
- `web/lib/admin-tweet-review.ts`：审核元数据 helper
- `src/producer/agents/reporter.ts`：支持审核提示词
- `src/producer/pipeline.ts`：读取 `rawData.review`

## 兼容性

- 现有去重/生产流程无需改状态机，只要继续处理 `status='new'`
- 老的 X RawItem 没有 `rawData.review` 时，pipeline 会按原有逻辑工作
- 游标是新增能力，不影响已有 RSS / GitHub collector
