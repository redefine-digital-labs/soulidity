# ClawNews MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local AI×Web3 content community MVP — auto-collect RSS + GitHub sources, produce bilingual content via Claude API, review in a web dashboard, publish to Telegram.

**Architecture:** Monorepo with `src/` for backend pipeline (collector → producer → publisher) and `web/` for Next.js admin dashboard. SQLite for storage, node-cron for scheduling, grammy for Telegram bot. LLM adapter layer for swappable AI providers.

**Tech Stack:** TypeScript, Node.js, SQLite (better-sqlite3), Anthropic SDK, Next.js 15, grammy, node-cron, rss-parser, vitest

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize git repo**

```bash
cd /Users/admin/Desktop/nao/clawnews
git init
```

**Step 2: Create package.json**

```json
{
  "name": "clawnews",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:init": "tsx src/db/init.ts",
    "collect": "tsx src/collector/run.ts",
    "produce": "tsx src/producer/run.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^11.0.0",
    "grammy": "^1.30.0",
    "node-cron": "^3.0.3",
    "rss-parser": "^3.13.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "web"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
data/*.db
.env
.DS_Store
web/.next/
web/node_modules/
```

**Step 5: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-xxx
TG_BOT_TOKEN=123456:ABC-DEF
TG_CHANNEL_ID=@clawnews_daily
TG_GROUP_ID=-1001234567890
```

**Step 6: Create directory structure**

```bash
mkdir -p src/{collector,producer,publisher,db,shared}
mkdir -p data
mkdir -p tests/{collector,producer,publisher,db}
```

**Step 7: Install dependencies**

```bash
npm install
```

**Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example
git commit -m "chore: initialize project with TypeScript + dependencies"
```

---

## Task 2: Database Schema + Query Layer

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/database.ts`
- Create: `src/db/init.ts`
- Create: `src/shared/types.ts`
- Test: `tests/db/database.test.ts`

**Step 1: Write shared types**

```typescript
// src/shared/types.ts
export type SourceType = 'rss' | 'github'

export type RawItemStatus = 'new' | 'processing' | 'produced' | 'published' | 'rejected'

export type ArticleStatus = 'draft' | 'reviewed' | 'published'

export interface RawItem {
  id: string
  source_type: SourceType
  source_name: string
  title: string
  url: string
  content: string | null
  language: string
  score: number
  status: RawItemStatus
  raw_data: string | null
  created_at: string
}

export interface Article {
  id: string
  raw_item_id: string
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string | null
  analysis_en: string | null
  tags: string | null
  status: ArticleStatus
  created_at: string
}

export interface Publication {
  id: string
  article_id: string
  channel: string
  message_id: string | null
  published_at: string | null
}

export interface Member {
  id: string
  tg_id: string
  tg_name: string | null
  wallet: string | null
  level: number
  invite_code: string | null
  joined_at: string
}
```

**Step 2: Write schema**

```typescript
// src/db/schema.ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw_items (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  content     TEXT,
  language    TEXT DEFAULT 'en',
  score       REAL DEFAULT 0,
  status      TEXT DEFAULT 'new',
  raw_data    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,
  raw_item_id TEXT REFERENCES raw_items(id),
  title_zh    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  summary_zh  TEXT NOT NULL,
  summary_en  TEXT NOT NULL,
  analysis_zh TEXT,
  analysis_en TEXT,
  tags        TEXT,
  status      TEXT DEFAULT 'draft',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id           TEXT PRIMARY KEY,
  article_id   TEXT REFERENCES articles(id),
  channel      TEXT NOT NULL,
  message_id   TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  tg_id       TEXT NOT NULL UNIQUE,
  tg_name     TEXT,
  wallet      TEXT,
  level       INTEGER DEFAULT 1,
  invite_code TEXT,
  joined_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_raw_items_status ON raw_items(status);
CREATE INDEX IF NOT EXISTS idx_raw_items_score ON raw_items(score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_members_tg_id ON members(tg_id);
`;
```

**Step 3: Write database module with query functions**

```typescript
// src/db/database.ts
import Database from 'better-sqlite3'
import { SCHEMA } from './schema.js'
import type { RawItem, Article, Publication, RawItemStatus, ArticleStatus } from '../shared/types.js'
import { v4 as uuid } from 'uuid'

export function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

// --- raw_items ---

export function insertRawItem(
  db: Database.Database,
  item: Omit<RawItem, 'id' | 'created_at' | 'status'>
): string | null {
  const id = uuid()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO raw_items (id, source_type, source_name, title, url, content, language, score, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(id, item.source_type, item.source_name, item.title, item.url, item.content, item.language, item.score, item.raw_data)
  return result.changes > 0 ? id : null
}

export function getRawItemsByStatus(db: Database.Database, status: RawItemStatus, limit = 10): RawItem[] {
  return db.prepare('SELECT * FROM raw_items WHERE status = ? ORDER BY score DESC LIMIT ?').all(status, limit) as RawItem[]
}

export function updateRawItemStatus(db: Database.Database, id: string, status: RawItemStatus): void {
  db.prepare('UPDATE raw_items SET status = ? WHERE id = ?').run(status, id)
}

// --- articles ---

export function insertArticle(
  db: Database.Database,
  article: Omit<Article, 'id' | 'created_at' | 'status'>
): string {
  const id = uuid()
  db.prepare(`
    INSERT INTO articles (id, raw_item_id, title_zh, title_en, summary_zh, summary_en, analysis_zh, analysis_en, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, article.raw_item_id, article.title_zh, article.title_en, article.summary_zh, article.summary_en, article.analysis_zh, article.analysis_en, article.tags)
  return id
}

export function getArticlesByStatus(db: Database.Database, status: ArticleStatus, limit = 20): Article[] {
  return db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit) as Article[]
}

export function getArticleById(db: Database.Database, id: string): Article | undefined {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined
}

export function updateArticle(db: Database.Database, id: string, fields: Partial<Pick<Article, 'title_zh' | 'title_en' | 'summary_zh' | 'summary_en' | 'analysis_zh' | 'analysis_en' | 'tags' | 'status'>>): void {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`)
    values.push(value)
  }
  if (sets.length === 0) return
  values.push(id)
  db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

// --- publications ---

export function insertPublication(db: Database.Database, articleId: string, channel: string, messageId: string): string {
  const id = uuid()
  db.prepare(`
    INSERT INTO publications (id, article_id, channel, message_id, published_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(id, articleId, channel, messageId)
  return id
}

// --- stats ---

export function getStats(db: Database.Database): { raw_new: number; articles_draft: number; articles_reviewed: number; published_today: number } {
  const raw_new = (db.prepare('SELECT COUNT(*) as c FROM raw_items WHERE status = ?').get('new') as { c: number }).c
  const articles_draft = (db.prepare('SELECT COUNT(*) as c FROM articles WHERE status = ?').get('draft') as { c: number }).c
  const articles_reviewed = (db.prepare('SELECT COUNT(*) as c FROM articles WHERE status = ?').get('reviewed') as { c: number }).c
  const published_today = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE published_at >= date('now')").get() as { c: number }).c
  return { raw_new, articles_draft, articles_reviewed, published_today }
}
```

**Step 4: Write init script**

```typescript
// src/db/init.ts
import { createDb } from './database.js'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'clawnews.db')
const db = createDb(dbPath)
console.log(`Database initialized at ${dbPath}`)
db.close()
```

**Step 5: Write the failing tests**

```typescript
// tests/db/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, insertRawItem, getRawItemsByStatus, updateRawItemStatus, insertArticle, getArticlesByStatus, getArticleById, updateArticle, getStats } from '../../src/db/database.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('raw_items', () => {
  it('inserts and retrieves raw items', () => {
    const id = insertRawItem(db, {
      source_type: 'rss',
      source_name: 'coindesk',
      title: 'Test Article',
      url: 'https://example.com/1',
      content: 'Some content',
      language: 'en',
      score: 5.0,
      raw_data: null,
    })
    expect(id).toBeTruthy()

    const items = getRawItemsByStatus(db, 'new')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Test Article')
    expect(items[0].score).toBe(5.0)
  })

  it('deduplicates by URL', () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'First',
      url: 'https://example.com/dup', content: null, language: 'en', score: 1, raw_data: null,
    })
    const id2 = insertRawItem(db, {
      source_type: 'rss', source_name: 'theblock', title: 'Second',
      url: 'https://example.com/dup', content: null, language: 'en', score: 2, raw_data: null,
    })
    expect(id2).toBeNull()
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(1)
  })

  it('updates status', () => {
    const id = insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://example.com/2', content: null, language: 'en', score: 1, raw_data: null,
    })
    updateRawItemStatus(db, id!, 'produced')
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(0)
    expect(getRawItemsByStatus(db, 'produced')).toHaveLength(1)
  })

  it('returns items ordered by score DESC', () => {
    insertRawItem(db, { source_type: 'rss', source_name: 'a', title: 'Low', url: 'https://a.com/1', content: null, language: 'en', score: 1, raw_data: null })
    insertRawItem(db, { source_type: 'rss', source_name: 'b', title: 'High', url: 'https://a.com/2', content: null, language: 'en', score: 10, raw_data: null })
    const items = getRawItemsByStatus(db, 'new')
    expect(items[0].title).toBe('High')
    expect(items[1].title).toBe('Low')
  })
})

describe('articles', () => {
  it('inserts and retrieves articles', () => {
    const id = insertArticle(db, {
      raw_item_id: 'raw-1',
      title_zh: '测试标题',
      title_en: 'Test Title',
      summary_zh: '中文摘要',
      summary_en: 'English summary',
      analysis_zh: '中文解读',
      analysis_en: 'English analysis',
      tags: '["ai","web3"]',
    })
    const article = getArticleById(db, id)
    expect(article).toBeDefined()
    expect(article!.title_zh).toBe('测试标题')
    expect(article!.status).toBe('draft')
  })

  it('updates article fields', () => {
    const id = insertArticle(db, {
      raw_item_id: 'raw-1', title_zh: '旧标题', title_en: 'Old',
      summary_zh: '摘要', summary_en: 'Summary',
      analysis_zh: null, analysis_en: null, tags: null,
    })
    updateArticle(db, id, { title_zh: '新标题', status: 'reviewed' })
    const article = getArticleById(db, id)
    expect(article!.title_zh).toBe('新标题')
    expect(article!.status).toBe('reviewed')
  })

  it('lists articles by status', () => {
    insertArticle(db, { raw_item_id: 'r1', title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    insertArticle(db, { raw_item_id: 'r2', title_zh: 'B', title_en: 'B', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    expect(getArticlesByStatus(db, 'draft')).toHaveLength(2)
    expect(getArticlesByStatus(db, 'reviewed')).toHaveLength(0)
  })
})

describe('stats', () => {
  it('returns correct counts', () => {
    insertRawItem(db, { source_type: 'rss', source_name: 'a', title: 'T', url: 'https://x.com/1', content: null, language: 'en', score: 1, raw_data: null })
    insertArticle(db, { raw_item_id: 'r1', title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    const stats = getStats(db)
    expect(stats.raw_new).toBe(1)
    expect(stats.articles_draft).toBe(1)
    expect(stats.articles_reviewed).toBe(0)
  })
})
```

**Step 6: Run tests to verify they fail**

```bash
npx vitest run tests/db/database.test.ts
```

Expected: FAIL (files don't exist yet until implementation)

**Step 7: Implement the code (Steps 1-4 above)**

Create all the files listed in steps 1-4.

**Step 8: Run tests to verify they pass**

```bash
npx vitest run tests/db/database.test.ts
```

Expected: ALL PASS

**Step 9: Run db:init to verify**

```bash
npm run db:init
```

Expected: `Database initialized at .../data/clawnews.db`

**Step 10: Commit**

```bash
git add src/shared/types.ts src/db/ tests/db/
git commit -m "feat: database schema and query layer with tests"
```

---

## Task 3: RSS Collector

**Files:**
- Create: `src/collector/rss.ts`
- Create: `src/collector/score.ts`
- Create: `src/collector/types.ts`
- Test: `tests/collector/rss.test.ts`
- Test: `tests/collector/score.test.ts`

**Step 1: Write collector types**

```typescript
// src/collector/types.ts
export interface CollectedItem {
  source_type: 'rss' | 'github'
  source_name: string
  title: string
  url: string
  content: string
  language: string
  raw_data: object
}

export type Collector = () => Promise<CollectedItem[]>
```

**Step 2: Write scoring tests**

```typescript
// tests/collector/score.test.ts
import { describe, it, expect } from 'vitest'
import { scoreItem } from '../../src/collector/score.js'

describe('scoreItem', () => {
  it('scores high for AI agent + web3 keywords', () => {
    const score = scoreItem('AI Agent for DeFi trading', 'An AI agent that trades on-chain')
    expect(score).toBeGreaterThanOrEqual(3)
  })

  it('scores medium for single-domain keywords', () => {
    const score = scoreItem('New Smart Contract Framework', 'A framework for smart contracts')
    expect(score).toBeGreaterThanOrEqual(1)
    expect(score).toBeLessThan(3)
  })

  it('scores low for generic crypto', () => {
    const score = scoreItem('Bitcoin Hits New High', 'Bitcoin price surges')
    expect(score).toBeLessThanOrEqual(1)
  })

  it('is case insensitive', () => {
    const score = scoreItem('AI AGENT Web3', '')
    expect(score).toBeGreaterThanOrEqual(3)
  })
})
```

**Step 3: Implement scoring**

```typescript
// src/collector/score.ts
const KEYWORDS: { pattern: RegExp; weight: number }[] = [
  { pattern: /ai\s*agent/i, weight: 3 },
  { pattern: /web3\s*ai|ai\s*web3/i, weight: 3 },
  { pattern: /defi\s*ai|ai\s*defi/i, weight: 3 },
  { pattern: /on-?chain\s*ai/i, weight: 3 },
  { pattern: /llm\s*blockchain/i, weight: 3 },
  { pattern: /artificial\s*intelligence/i, weight: 1 },
  { pattern: /smart\s*contract/i, weight: 1 },
  { pattern: /defi/i, weight: 1 },
  { pattern: /machine\s*learning/i, weight: 1 },
  { pattern: /crypto/i, weight: 0.5 },
  { pattern: /blockchain/i, weight: 0.5 },
  { pattern: /nft/i, weight: 0.5 },
]

export function scoreItem(title: string, content: string): number {
  const text = `${title} ${content}`.toLowerCase()
  let score = 0
  for (const { pattern, weight } of KEYWORDS) {
    if (pattern.test(text)) {
      score += weight
    }
  }
  return score
}
```

**Step 4: Run score tests**

```bash
npx vitest run tests/collector/score.test.ts
```

Expected: ALL PASS

**Step 5: Write RSS collector**

```typescript
// src/collector/rss.ts
import Parser from 'rss-parser'
import type { CollectedItem } from './types.js'

export const RSS_FEEDS = [
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'theblock', url: 'https://www.theblock.co/rss.xml' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
]

const parser = new Parser({ timeout: 10000 })

export async function collectRss(): Promise<CollectedItem[]> {
  const items: CollectedItem[] = []

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url)
      for (const entry of result.items ?? []) {
        if (!entry.title || !entry.link) continue
        items.push({
          source_type: 'rss',
          source_name: feed.name,
          title: entry.title,
          url: entry.link,
          content: entry.contentSnippet ?? entry.content ?? '',
          language: 'en',
          raw_data: entry,
        })
      }
    } catch (err) {
      console.error(`Failed to fetch RSS from ${feed.name}:`, err)
    }
  }

  return items
}
```

**Step 6: Write RSS integration test (manual verification)**

```typescript
// tests/collector/rss.test.ts
import { describe, it, expect } from 'vitest'
import { RSS_FEEDS } from '../../src/collector/rss.js'

describe('RSS config', () => {
  it('has at least 3 feeds configured', () => {
    expect(RSS_FEEDS.length).toBeGreaterThanOrEqual(3)
  })

  it('each feed has name and url', () => {
    for (const feed of RSS_FEEDS) {
      expect(feed.name).toBeTruthy()
      expect(feed.url).toMatch(/^https?:\/\//)
    }
  })
})

// Integration test — only run manually: npx vitest run tests/collector/rss.test.ts -- --integration
// Uncomment to test real RSS fetching:
// import { collectRss } from '../../src/collector/rss.js'
// describe('collectRss integration', () => {
//   it('fetches real RSS data', async () => {
//     const items = await collectRss()
//     expect(items.length).toBeGreaterThan(0)
//     console.log(`Fetched ${items.length} RSS items`)
//   }, 30000)
// })
```

**Step 7: Run tests**

```bash
npx vitest run tests/collector/
```

Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/collector/types.ts src/collector/score.ts src/collector/rss.ts tests/collector/
git commit -m "feat: RSS collector with keyword scoring"
```

---

## Task 4: GitHub Trending Collector

**Files:**
- Create: `src/collector/github.ts`
- Test: `tests/collector/github.test.ts`

**Step 1: Write GitHub collector**

```typescript
// src/collector/github.ts
import type { CollectedItem } from './types.js'

const SEARCH_QUERIES = [
  'ai agent',
  'llm blockchain',
  'web3 ai',
]

interface GitHubSearchResult {
  items: Array<{
    full_name: string
    html_url: string
    description: string | null
    stargazers_count: number
    language: string | null
    created_at: string
    topics: string[]
  }>
}

export async function collectGithub(): Promise<CollectedItem[]> {
  const items: CollectedItem[] = []
  const seenUrls = new Set<string>()

  // Search repos created in the last 7 days
  const since = new Date()
  since.setDate(since.getDate() - 7)
  const sinceStr = since.toISOString().split('T')[0]

  for (const query of SEARCH_QUERIES) {
    try {
      const q = encodeURIComponent(`${query} created:>${sinceStr}`)
      const resp = await fetch(
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'ClawNews/0.1',
          },
        }
      )

      if (!resp.ok) {
        console.error(`GitHub API error for "${query}": ${resp.status}`)
        continue
      }

      const data = await resp.json() as GitHubSearchResult

      for (const repo of data.items) {
        if (seenUrls.has(repo.html_url)) continue
        seenUrls.add(repo.html_url)

        items.push({
          source_type: 'github',
          source_name: 'github-trending',
          title: `${repo.full_name} ⭐${repo.stargazers_count}`,
          url: repo.html_url,
          content: repo.description ?? '',
          language: 'en',
          raw_data: repo,
        })
      }
    } catch (err) {
      console.error(`Failed to search GitHub for "${query}":`, err)
    }
  }

  return items
}
```

**Step 2: Write tests**

```typescript
// tests/collector/github.test.ts
import { describe, it, expect } from 'vitest'
import { collectGithub } from '../../src/collector/github.js'

describe('GitHub collector config', () => {
  it('module exports collectGithub function', () => {
    expect(typeof collectGithub).toBe('function')
  })
})
```

**Step 3: Run tests**

```bash
npx vitest run tests/collector/github.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/collector/github.ts tests/collector/github.test.ts
git commit -m "feat: GitHub trending collector via search API"
```

---

## Task 5: Collector Runner (Wire Collection to DB)

**Files:**
- Create: `src/collector/run.ts`
- Test: `tests/collector/run.test.ts`

**Step 1: Write collector runner**

```typescript
// src/collector/run.ts
import type Database from 'better-sqlite3'
import { collectRss } from './rss.js'
import { collectGithub } from './github.js'
import { scoreItem } from './score.js'
import { insertRawItem } from '../db/database.js'
import type { CollectedItem } from './types.js'

export async function runCollectors(db: Database.Database, collectors: Array<() => Promise<CollectedItem[]>>): Promise<{ total: number; inserted: number }> {
  let total = 0
  let inserted = 0

  for (const collector of collectors) {
    const items = await collector()
    total += items.length

    for (const item of items) {
      const score = scoreItem(item.title, item.content)
      const id = insertRawItem(db, {
        source_type: item.source_type,
        source_name: item.source_name,
        title: item.title,
        url: item.url,
        content: item.content,
        language: item.language,
        score,
        raw_data: JSON.stringify(item.raw_data),
      })
      if (id) inserted++
    }
  }

  return { total, inserted }
}

// CLI entry point
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const { createDb } = await import('../db/database.js')
  const path = await import('path')
  const db = createDb(path.join(process.cwd(), 'data', 'clawnews.db'))

  console.log('Running collectors...')
  const result = await runCollectors(db, [collectRss, collectGithub])
  console.log(`Done. Fetched ${result.total} items, inserted ${result.inserted} new items.`)
  db.close()
}
```

**Step 2: Write test**

```typescript
// tests/collector/run.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, getRawItemsByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import type { CollectedItem } from '../../src/collector/types.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

const mockCollector = (): Promise<CollectedItem[]> => Promise.resolve([
  { source_type: 'rss', source_name: 'test', title: 'AI Agent for DeFi', url: 'https://test.com/1', content: 'AI agent content', language: 'en', raw_data: {} },
  { source_type: 'rss', source_name: 'test', title: 'Bitcoin Price', url: 'https://test.com/2', content: 'crypto news', language: 'en', raw_data: {} },
])

describe('runCollectors', () => {
  it('collects, scores, and inserts items', async () => {
    const result = await runCollectors(db, [mockCollector])
    expect(result.total).toBe(2)
    expect(result.inserted).toBe(2)

    const items = getRawItemsByStatus(db, 'new')
    expect(items).toHaveLength(2)
    // AI Agent item should have higher score and come first
    expect(items[0].title).toBe('AI Agent for DeFi')
    expect(items[0].score).toBeGreaterThan(items[1].score)
  })

  it('deduplicates on second run', async () => {
    await runCollectors(db, [mockCollector])
    const result2 = await runCollectors(db, [mockCollector])
    expect(result2.inserted).toBe(0)
  })
})
```

**Step 3: Run tests**

```bash
npx vitest run tests/collector/run.test.ts
```

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/collector/run.ts tests/collector/run.test.ts
git commit -m "feat: collector runner wiring collection to database"
```

---

## Task 6: AI Content Producer

**Files:**
- Create: `src/producer/llm.ts`
- Create: `src/producer/produce.ts`
- Create: `src/producer/run.ts`
- Test: `tests/producer/llm.test.ts`
- Test: `tests/producer/produce.test.ts`

**Step 1: Write LLM adapter interface + Anthropic implementation**

```typescript
// src/producer/llm.ts
import Anthropic from '@anthropic-ai/sdk'

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export function createAnthropicAdapter(apiKey: string, model = 'claude-sonnet-4-6'): LLMAdapter {
  const client = new Anthropic({ apiKey })
  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
      const block = response.content[0]
      if (block.type !== 'text') throw new Error('Unexpected response type')
      return block.text
    },
  }
}
```

**Step 2: Write LLM adapter test**

```typescript
// tests/producer/llm.test.ts
import { describe, it, expect } from 'vitest'
import type { LLMAdapter } from '../../src/producer/llm.js'

export function createMockLLM(response: object): LLMAdapter {
  return {
    async generate(): Promise<string> {
      return JSON.stringify(response)
    },
  }
}

describe('LLMAdapter interface', () => {
  it('mock adapter returns JSON string', async () => {
    const mock = createMockLLM({ title_zh: '测试' })
    const result = await mock.generate('system', 'user')
    expect(JSON.parse(result).title_zh).toBe('测试')
  })
})
```

**Step 3: Write producer logic**

```typescript
// src/producer/produce.ts
import type Database from 'better-sqlite3'
import type { LLMAdapter } from './llm.js'
import { getRawItemsByStatus, updateRawItemStatus, insertArticle } from '../db/database.js'

const SYSTEM_PROMPT = `You are a professional AI×Web3 content editor.
Given raw source material, produce structured bilingual (Chinese + English) content.
Always respond with valid JSON only, no markdown fences.`

function buildUserPrompt(title: string, content: string, url: string, sourceName: string): string {
  return `Raw material:
Title: ${title}
Source: ${sourceName}
Content: ${content}
URL: ${url}

Output JSON with these exact fields:
{
  "title_zh": "Chinese title (one sentence summary)",
  "title_en": "English title",
  "summary_zh": "3-5 sentence Chinese summary, professional and accurate",
  "summary_en": "3-5 sentence English summary",
  "analysis_zh": "Deep analysis: what this means for AI×Web3",
  "analysis_en": "Deep analysis in English",
  "tags": ["tag1", "tag2", "tag3"]
}`
}

interface ProducedArticle {
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string
  analysis_en: string
  tags: string[]
}

function parseResponse(text: string): ProducedArticle {
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  const required = ['title_zh', 'title_en', 'summary_zh', 'summary_en']
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`)
  }
  return parsed as ProducedArticle
}

export async function produceArticles(db: Database.Database, llm: LLMAdapter, limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
  const items = getRawItemsByStatus(db, 'new', limit)
  let succeeded = 0
  let failed = 0

  for (const item of items) {
    updateRawItemStatus(db, item.id, 'processing')
    try {
      const prompt = buildUserPrompt(item.title, item.content ?? '', item.url, item.source_name)
      const response = await llm.generate(SYSTEM_PROMPT, prompt)
      const article = parseResponse(response)

      insertArticle(db, {
        raw_item_id: item.id,
        title_zh: article.title_zh,
        title_en: article.title_en,
        summary_zh: article.summary_zh,
        summary_en: article.summary_en,
        analysis_zh: article.analysis_zh,
        analysis_en: article.analysis_en,
        tags: JSON.stringify(article.tags),
      })

      updateRawItemStatus(db, item.id, 'produced')
      succeeded++
    } catch (err) {
      console.error(`Failed to produce article for ${item.id}:`, err)
      updateRawItemStatus(db, item.id, 'rejected')
      failed++
    }
  }

  return { processed: items.length, succeeded, failed }
}

// Export for testing
export { parseResponse, buildUserPrompt }
```

**Step 4: Write producer tests**

```typescript
// tests/producer/produce.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, insertRawItem, getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { produceArticles, parseResponse } from '../../src/producer/produce.js'
import { createMockLLM } from './llm.test.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('parseResponse', () => {
  it('parses valid JSON', () => {
    const result = parseResponse(JSON.stringify({
      title_zh: '标题', title_en: 'Title',
      summary_zh: '摘要', summary_en: 'Summary',
      analysis_zh: '解读', analysis_en: 'Analysis',
      tags: ['ai'],
    }))
    expect(result.title_zh).toBe('标题')
  })

  it('strips markdown fences', () => {
    const result = parseResponse('```json\n{"title_zh":"标题","title_en":"T","summary_zh":"s","summary_en":"s","analysis_zh":"a","analysis_en":"a","tags":[]}\n```')
    expect(result.title_zh).toBe('标题')
  })

  it('throws on missing required fields', () => {
    expect(() => parseResponse('{"title_zh":"only one field"}')).toThrow('Missing required field')
  })
})

describe('produceArticles', () => {
  it('produces articles from raw items', async () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://test.com/1', content: 'AI agent news', language: 'en', score: 5, raw_data: null,
    })

    const mockLLM = createMockLLM({
      title_zh: '测试标题', title_en: 'Test Title',
      summary_zh: '中文摘要', summary_en: 'English summary',
      analysis_zh: '中文解读', analysis_en: 'English analysis',
      tags: ['ai', 'web3'],
    })

    const result = await produceArticles(db, mockLLM)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    // raw item should be marked as produced
    expect(getRawItemsByStatus(db, 'produced')).toHaveLength(1)
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(0)

    // article should be created as draft
    const articles = getArticlesByStatus(db, 'draft')
    expect(articles).toHaveLength(1)
    expect(articles[0].title_zh).toBe('测试标题')
  })

  it('marks item as rejected on LLM failure', async () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'test', title: 'Bad',
      url: 'https://test.com/bad', content: '', language: 'en', score: 1, raw_data: null,
    })

    const failingLLM = {
      async generate(): Promise<string> { throw new Error('API error') },
    }

    const result = await produceArticles(db, failingLLM)
    expect(result.failed).toBe(1)
    expect(getRawItemsByStatus(db, 'rejected')).toHaveLength(1)
  })
})
```

**Step 5: Write producer CLI runner**

```typescript
// src/producer/run.ts
import { createDb } from '../db/database.js'
import { createAnthropicAdapter } from './llm.js'
import { produceArticles } from './produce.js'
import path from 'path'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

const db = createDb(path.join(process.cwd(), 'data', 'clawnews.db'))
const llm = createAnthropicAdapter(apiKey)

console.log('Producing articles...')
const result = await produceArticles(db, llm)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)
db.close()
```

**Step 6: Run all tests**

```bash
npx vitest run tests/producer/
```

Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/producer/ tests/producer/
git commit -m "feat: AI content producer with LLM adapter and tests"
```

---

## Task 7: Next.js Web Dashboard Setup + API Routes

**Files:**
- Create: `web/` (Next.js project)
- Create: `web/app/api/articles/route.ts`
- Create: `web/app/api/articles/[id]/route.ts`
- Create: `web/app/api/articles/[id]/publish/route.ts`
- Create: `web/app/api/stats/route.ts`
- Create: `web/lib/db.ts`

**Step 1: Create Next.js project**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@web/*" --no-turbopack
```

When prompted, accept defaults.

**Step 2: Install better-sqlite3 in web/**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm install better-sqlite3 uuid
npm install -D @types/better-sqlite3 @types/uuid
```

**Step 3: Create shared DB accessor for Next.js**

```typescript
// web/lib/db.ts
import Database from 'better-sqlite3'
import path from 'path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), '..', 'data', 'clawnews.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}
```

**Step 4: Create articles list API**

```typescript
// web/app/api/articles/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET(request: NextRequest) {
  const db = getDb()
  const status = request.nextUrl.searchParams.get('status')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50')

  let articles
  if (status) {
    articles = db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
  } else {
    articles = db.prepare('SELECT * FROM articles ORDER BY created_at DESC LIMIT ?').all(limit)
  }

  return NextResponse.json(articles)
}
```

**Step 5: Create article detail + update API**

```typescript
// web/app/api/articles/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Also fetch the raw_item for source info
  const raw = db.prepare('SELECT url, source_name FROM raw_items WHERE id = ?').get((article as { raw_item_id: string }).raw_item_id)
  return NextResponse.json({ ...article, source_url: (raw as { url: string })?.url, source_name: (raw as { source_name: string })?.source_name })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const body = await request.json()

  const allowed = ['title_zh', 'title_en', 'summary_zh', 'summary_en', 'analysis_zh', 'analysis_en', 'tags', 'status']
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  values.push(id)
  db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  return NextResponse.json(updated)
}
```

**Step 6: Create stats API**

```typescript
// web/app/api/stats/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET() {
  const db = getDb()
  const raw_new = (db.prepare("SELECT COUNT(*) as c FROM raw_items WHERE status = 'new'").get() as { c: number }).c
  const articles_draft = (db.prepare("SELECT COUNT(*) as c FROM articles WHERE status = 'draft'").get() as { c: number }).c
  const articles_reviewed = (db.prepare("SELECT COUNT(*) as c FROM articles WHERE status = 'reviewed'").get() as { c: number }).c
  const published_today = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE published_at >= date('now')").get() as { c: number }).c

  return NextResponse.json({ raw_new, articles_draft, articles_reviewed, published_today })
}
```

**Step 7: Create publish API (placeholder — TG integration in Task 10)**

```typescript
// web/app/api/articles/[id]/publish/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { v4 as uuid } from 'uuid'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Update article status
  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id)

  // Create publication record (message_id will be set when TG bot is wired)
  const pubId = uuid()
  db.prepare(`
    INSERT INTO publications (id, article_id, channel, message_id, published_at)
    VALUES (?, ?, 'tg_daily', NULL, datetime('now'))
  `).run(pubId, id)

  return NextResponse.json({ success: true, publication_id: pubId })
}
```

**Step 8: Verify Next.js runs**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm run dev
```

Test: `curl http://localhost:3000/api/stats` should return JSON.

**Step 9: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: Next.js web dashboard with API routes"
```

---

## Task 8: Dashboard Page

**Files:**
- Create: `web/app/dashboard/page.tsx`
- Modify: `web/app/page.tsx` (redirect to dashboard)
- Create: `web/components/article-list.tsx`
- Create: `web/components/stats-bar.tsx`

**Step 1: Create stats bar component**

```tsx
// web/components/stats-bar.tsx
'use client'
import { useEffect, useState } from 'react'

interface Stats {
  raw_new: number
  articles_draft: number
  articles_reviewed: number
  published_today: number
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats)
  }, [])

  if (!stats) return <div className="animate-pulse h-16 bg-gray-100 rounded" />

  const items = [
    { label: 'Pending', value: stats.raw_new, color: 'text-yellow-600' },
    { label: 'Draft', value: stats.articles_draft, color: 'text-blue-600' },
    { label: 'Reviewed', value: stats.articles_reviewed, color: 'text-green-600' },
    { label: 'Published Today', value: stats.published_today, color: 'text-purple-600' },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {items.map(item => (
        <div key={item.label} className="bg-white rounded-lg p-4 shadow-sm border">
          <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
          <div className="text-sm text-gray-500">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Create article list component**

```tsx
// web/components/article-list.tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Article {
  id: string
  title_zh: string
  title_en: string
  status: string
  tags: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-green-100 text-green-700',
  published: 'bg-purple-100 text-purple-700',
}

export function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([])
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    const url = filter ? `/api/articles?status=${filter}` : '/api/articles'
    fetch(url).then(r => r.json()).then(setArticles)
  }, [filter])

  const filters = ['', 'draft', 'reviewed', 'published']

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {articles.map(article => (
          <Link
            key={article.id}
            href={`/articles/${article.id}`}
            className="block bg-white rounded-lg p-4 shadow-sm border hover:border-gray-300 transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{article.title_zh}</div>
                <div className="text-sm text-gray-500 truncate">{article.title_en}</div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${STATUS_COLORS[article.status] ?? 'bg-gray-100'}`}>
                {article.status}
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-400">
              {new Date(article.created_at).toLocaleString()}
              {article.tags && ` · ${JSON.parse(article.tags).join(', ')}`}
            </div>
          </Link>
        ))}
        {articles.length === 0 && (
          <div className="text-center text-gray-400 py-8">No articles</div>
        )}
      </div>
    </div>
  )
}
```

**Step 3: Create dashboard page**

```tsx
// web/app/dashboard/page.tsx
import { StatsBar } from '@web/components/stats-bar'
import { ArticleList } from '@web/components/article-list'

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">ClawNews Dashboard</h1>
      <StatsBar />
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Articles</h2>
        <ArticleList />
      </div>
    </div>
  )
}
```

**Step 4: Update root page to redirect**

```tsx
// web/app/page.tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/dashboard')
}
```

**Step 5: Verify in browser**

```bash
cd /Users/admin/Desktop/nao/clawnews/web && npm run dev
```

Open `http://localhost:3000` — should redirect to dashboard, show stats and empty article list.

**Step 6: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: dashboard page with stats bar and article list"
```

---

## Task 9: Article Detail + Edit Page

**Files:**
- Create: `web/app/articles/[id]/page.tsx`
- Create: `web/components/article-editor.tsx`

**Step 1: Create article editor component**

```tsx
// web/components/article-editor.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Article {
  id: string
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string | null
  analysis_en: string | null
  tags: string | null
  status: string
  source_url?: string
  source_name?: string
  created_at: string
}

export function ArticleEditor({ article }: { article: Article }) {
  const router = useRouter()
  const [form, setForm] = useState(article)
  const [saving, setSaving] = useState(false)

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  async function save() {
    setSaving(true)
    await fetch(`/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    router.refresh()
  }

  async function setStatus(status: string) {
    await fetch(`/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    router.refresh()
    router.push('/dashboard')
  }

  async function publish() {
    await fetch(`/api/articles/${article.id}/publish`, { method: 'POST' })
    router.refresh()
    router.push('/dashboard')
  }

  return (
    <div className="space-y-6">
      {/* Meta info */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="px-2 py-0.5 bg-gray-100 rounded">{form.status}</span>
        {article.source_name && <span>Source: {article.source_name}</span>}
        {article.source_url && <a href={article.source_url} target="_blank" className="text-blue-500 hover:underline">Original</a>}
        <span>{new Date(article.created_at).toLocaleString()}</span>
      </div>

      {/* Bilingual editor — side by side */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium mb-1">Title (ZH)</label>
          <input className="w-full border rounded px-3 py-2" value={form.title_zh} onChange={e => update('title_zh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Title (EN)</label>
          <input className="w-full border rounded px-3 py-2" value={form.title_en} onChange={e => update('title_en', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Summary (ZH)</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.summary_zh} onChange={e => update('summary_zh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Summary (EN)</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.summary_en} onChange={e => update('summary_en', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Analysis (ZH)</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.analysis_zh ?? ''} onChange={e => update('analysis_zh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Analysis (EN)</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.analysis_en ?? ''} onChange={e => update('analysis_en', e.target.value)} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
        <input
          className="w-full border rounded px-3 py-2"
          value={form.tags ? JSON.parse(form.tags).join(', ') : ''}
          onChange={e => update('tags', JSON.stringify(e.target.value.split(',').map(t => t.trim()).filter(Boolean)))}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
        {form.status === 'draft' && (
          <button onClick={() => setStatus('reviewed')} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500">
            Approve
          </button>
        )}
        {(form.status === 'draft' || form.status === 'reviewed') && (
          <button onClick={publish} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500">
            Publish to TG
          </button>
        )}
        {form.status === 'draft' && (
          <button onClick={() => setStatus('rejected')} className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200">
            Reject
          </button>
        )}
        <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
          Back
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Create article detail page**

```tsx
// web/app/articles/[id]/page.tsx
import { ArticleEditor } from '@web/components/article-editor'

async function getArticle(id: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'}/api/articles/${id}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await getArticle(id)

  if (!article) {
    return <div className="max-w-4xl mx-auto p-6 text-red-500">Article not found</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Edit Article</h1>
      <ArticleEditor article={article} />
    </div>
  )
}
```

**Step 3: Verify in browser**

Run `npm run dev` in `web/`, navigate to dashboard, click an article (need data first — can run `npm run collect && npm run produce` to seed data).

**Step 4: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: article detail page with bilingual editor"
```

---

## Task 10: Telegram Bot Setup

**Files:**
- Create: `src/publisher/bot.ts`
- Create: `src/publisher/formatter.ts`
- Test: `tests/publisher/formatter.test.ts`

**Step 1: Write message formatter tests**

```typescript
// tests/publisher/formatter.test.ts
import { describe, it, expect } from 'vitest'
import { formatArticle } from '../../src/publisher/formatter.js'

describe('formatArticle', () => {
  it('formats article for Telegram', () => {
    const msg = formatArticle({
      title_zh: '测试标题',
      title_en: 'Test Title',
      summary_zh: '中文摘要内容',
      summary_en: 'English summary content',
      analysis_zh: '中文深度解读',
      tags: '["ai","web3"]',
      source_url: 'https://example.com/article',
    })

    expect(msg).toContain('测试标题')
    expect(msg).toContain('Test Title')
    expect(msg).toContain('中文摘要内容')
    expect(msg).toContain('English summary content')
    expect(msg).toContain('https://example.com/article')
    expect(msg).toContain('#ai')
    expect(msg).toContain('ClawNews')
  })

  it('handles missing optional fields', () => {
    const msg = formatArticle({
      title_zh: '标题',
      title_en: 'Title',
      summary_zh: '摘要',
      summary_en: 'Summary',
      analysis_zh: null,
      tags: null,
      source_url: 'https://example.com',
    })

    expect(msg).toContain('标题')
    expect(msg).not.toContain('null')
  })
})
```

**Step 2: Implement formatter**

```typescript
// src/publisher/formatter.ts
interface FormatInput {
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string | null
  tags: string | null
  source_url: string
}

export function formatArticle(input: FormatInput): string {
  const tags = input.tags ? JSON.parse(input.tags).map((t: string) => `#${t}`).join(' ') : ''

  let msg = `📰 ${input.title_zh}\n${input.title_en}\n\n🔗 ${input.source_url}`

  if (tags) msg += `\n🏷️ ${tags}`

  msg += `\n\n📝 摘要\n${input.summary_zh}\n\n📝 Summary\n${input.summary_en}`

  if (input.analysis_zh) {
    msg += `\n\n🔍 解读\n${input.analysis_zh}`
  }

  msg += `\n\n---\nby ClawNews 🦞`

  return msg
}
```

**Step 3: Run formatter tests**

```bash
npx vitest run tests/publisher/formatter.test.ts
```

Expected: ALL PASS

**Step 4: Write bot module**

```typescript
// src/publisher/bot.ts
import { Bot } from 'grammy'
import type Database from 'better-sqlite3'
import { formatArticle } from './formatter.js'
import type { Article } from '../shared/types.js'

export function createBot(token: string) {
  return new Bot(token)
}

export async function publishToChannel(
  bot: Bot,
  channelId: string,
  db: Database.Database,
  articleId: string,
): Promise<string> {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as Article | undefined
  if (!article) throw new Error(`Article not found: ${articleId}`)

  const raw = db.prepare('SELECT url FROM raw_items WHERE id = ?').get(article.raw_item_id) as { url: string } | undefined

  const text = formatArticle({
    title_zh: article.title_zh,
    title_en: article.title_en,
    summary_zh: article.summary_zh,
    summary_en: article.summary_en,
    analysis_zh: article.analysis_zh,
    tags: article.tags,
    source_url: raw?.url ?? '',
  })

  const sent = await bot.api.sendMessage(channelId, text)
  const messageId = String(sent.message_id)

  // Update article status and record publication
  const { v4: uuid } = await import('uuid')
  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(articleId)
  db.prepare(`
    INSERT INTO publications (id, article_id, channel, message_id, published_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(uuid(), articleId, channelId, messageId)

  return messageId
}
```

**Step 5: Commit**

```bash
git add src/publisher/ tests/publisher/
git commit -m "feat: Telegram bot with message formatter"
```

---

## Task 11: Wire TG Publish to Web Dashboard

**Files:**
- Modify: `web/app/api/articles/[id]/publish/route.ts`

**Step 1: Update publish API to actually send to TG**

```typescript
// web/app/api/articles/[id]/publish/route.ts
// Replace the placeholder with real TG publishing.
// Since we can't import grammy in Next.js API routes easily with the bot state,
// we call the publisher via a local HTTP endpoint or directly.

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { Bot } from 'grammy'
import { formatArticle } from '../../../../lib/formatter.js'
import { v4 as uuid } from 'uuid'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Record<string, string> | undefined
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = db.prepare('SELECT url FROM raw_items WHERE id = ?').get(article.raw_item_id) as { url: string } | undefined

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!token || !channelId) {
    // No TG config — just update status without sending
    db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id)
    const pubId = uuid()
    db.prepare("INSERT INTO publications (id, article_id, channel, published_at) VALUES (?, ?, 'tg_daily', datetime('now'))").run(pubId, id)
    return NextResponse.json({ success: true, publication_id: pubId, tg: false })
  }

  const text = formatArticle({
    title_zh: article.title_zh,
    title_en: article.title_en,
    summary_zh: article.summary_zh,
    summary_en: article.summary_en,
    analysis_zh: article.analysis_zh ?? null,
    tags: article.tags ?? null,
    source_url: raw?.url ?? '',
  })

  const bot = new Bot(token)
  const sent = await bot.api.sendMessage(channelId, text)

  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id)
  const pubId = uuid()
  db.prepare("INSERT INTO publications (id, article_id, channel, message_id, published_at) VALUES (?, ?, 'tg_daily', ?, datetime('now'))").run(pubId, id, String(sent.message_id))

  return NextResponse.json({ success: true, publication_id: pubId, message_id: sent.message_id })
}
```

**Step 2: Copy formatter to web/lib/**

```typescript
// web/lib/formatter.ts
// Same as src/publisher/formatter.ts — copy the formatArticle function
```

**Step 3: Add TG env vars to web/.env.local**

```
TG_BOT_TOKEN=your-bot-token
TG_CHANNEL_ID=@your_channel
```

**Step 4: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: wire TG publishing to web dashboard publish button"
```

---

## Task 12: Scheduled Publishing (Cron)

**Files:**
- Create: `src/scheduler.ts`
- Create: `src/main.ts`

**Step 1: Write scheduler**

```typescript
// src/scheduler.ts
import cron from 'node-cron'
import type Database from 'better-sqlite3'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { produceArticles } from './producer/produce.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(db: Database.Database, llm: LLMAdapter) {
  // RSS collection — every hour
  cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running RSS collection...`)
    const result = await runCollectors(db, [collectRss])
    console.log(`RSS: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // GitHub collection — daily at 6:00
  cron.schedule('0 6 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running GitHub collection...`)
    const result = await runCollectors(db, [collectGithub])
    console.log(`GitHub: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // Content production — every hour at :30 (after collection)
  cron.schedule('30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running content production...`)
    const result = await produceArticles(db, llm)
    console.log(`Producer: processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}`)
  })

  console.log('Scheduler started. Cron jobs:')
  console.log('  RSS collection:      every hour at :00')
  console.log('  GitHub collection:   daily at 06:00')
  console.log('  Content production:  every hour at :30')
}
```

**Step 2: Write main entry point**

```typescript
// src/main.ts
import path from 'path'
import { createDb } from './db/database.js'
import { createAnthropicAdapter } from './producer/llm.js'
import { startScheduler } from './scheduler.js'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Set it in .env')
  process.exit(1)
}

const dbPath = path.join(process.cwd(), 'data', 'clawnews.db')
const db = createDb(dbPath)
const llm = createAnthropicAdapter(apiKey)

console.log('ClawNews engine starting...')
console.log(`Database: ${dbPath}`)

startScheduler(db, llm)

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  db.close()
  process.exit(0)
})
```

**Step 3: Verify**

```bash
ANTHROPIC_API_KEY=test npm run dev
```

Expected: prints scheduler info and stays running.

**Step 4: Commit**

```bash
git add src/scheduler.ts src/main.ts
git commit -m "feat: cron scheduler and main entry point"
```

---

## Task 13: Member Verification (Mock)

**Files:**
- Create: `src/db/members.ts`
- Create: `web/app/verify/page.tsx`
- Create: `web/app/api/verify/route.ts`
- Create: `web/app/api/invites/route.ts`
- Test: `tests/db/members.test.ts`

**Step 1: Write member DB functions**

```typescript
// src/db/members.ts
import type Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'

export interface InviteCode {
  code: string
  created_at: string
  used_by: string | null
  active: boolean
}

// Add invite_codes table — run this in schema or as migration
export const MEMBERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  used_by    TEXT,
  active     INTEGER DEFAULT 1
);
`

export function createInviteCode(db: Database.Database): string {
  const code = uuid().slice(0, 8).toUpperCase()
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code)
  return code
}

export function validateInviteCode(db: Database.Database, code: string): boolean {
  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1 AND used_by IS NULL').get(code)
  return !!row
}

export function useInviteCode(db: Database.Database, code: string, tgId: string): boolean {
  const result = db.prepare('UPDATE invite_codes SET used_by = ?, active = 0 WHERE code = ? AND active = 1 AND used_by IS NULL').run(tgId, code)
  return result.changes > 0
}

export function insertMember(db: Database.Database, tgId: string, tgName: string | null, inviteCode: string): string {
  const id = uuid()
  db.prepare('INSERT OR IGNORE INTO members (id, tg_id, tg_name, invite_code) VALUES (?, ?, ?, ?)').run(id, tgId, tgName, inviteCode)
  return id
}

export function getMembers(db: Database.Database): Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }> {
  return db.prepare('SELECT id, tg_id, tg_name, level, joined_at FROM members ORDER BY joined_at DESC').all() as Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }>
}
```

**Step 2: Write tests**

```typescript
// tests/db/members.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb } from '../../src/db/database.js'
import { MEMBERS_SCHEMA, createInviteCode, validateInviteCode, useInviteCode, insertMember, getMembers } from '../../src/db/members.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
  db.exec(MEMBERS_SCHEMA)
})

afterEach(() => {
  db.close()
})

describe('invite codes', () => {
  it('creates and validates invite code', () => {
    const code = createInviteCode(db)
    expect(code).toHaveLength(8)
    expect(validateInviteCode(db, code)).toBe(true)
  })

  it('invalidates after use', () => {
    const code = createInviteCode(db)
    expect(useInviteCode(db, code, 'user123')).toBe(true)
    expect(validateInviteCode(db, code)).toBe(false)
    // Can't use again
    expect(useInviteCode(db, code, 'user456')).toBe(false)
  })

  it('rejects invalid code', () => {
    expect(validateInviteCode(db, 'BADCODE')).toBe(false)
  })
})

describe('members', () => {
  it('inserts and retrieves members', () => {
    insertMember(db, 'tg_123', 'TestUser', 'CODE1')
    const members = getMembers(db)
    expect(members).toHaveLength(1)
    expect(members[0].tg_id).toBe('tg_123')
  })
})
```

**Step 3: Run tests**

```bash
npx vitest run tests/db/members.test.ts
```

Expected: ALL PASS

**Step 4: Update schema.ts to include invite_codes table**

Add `MEMBERS_SCHEMA` import and exec in `createDb`, or append to the main SCHEMA string.

**Step 5: Create verify API route**

```typescript
// web/app/api/verify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function POST(request: NextRequest) {
  const db = getDb()
  const { code, tg_id, tg_name } = await request.json()

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
  }

  // Validate code
  const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1 AND used_by IS NULL').get(code)
  if (!invite) {
    return NextResponse.json({ verified: false, error: 'Invalid or used invite code' })
  }

  // Use code and create member
  db.prepare('UPDATE invite_codes SET used_by = ?, active = 0 WHERE code = ?').run(tg_id, code)
  const { v4: uuid } = await import('uuid')
  db.prepare('INSERT OR IGNORE INTO members (id, tg_id, tg_name, invite_code) VALUES (?, ?, ?, ?)').run(uuid(), tg_id, tg_name ?? null, code)

  return NextResponse.json({ verified: true })
}
```

**Step 6: Create verify page and invites API**

```tsx
// web/app/verify/page.tsx
'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function VerifyPage() {
  const searchParams = useSearchParams()
  const tgId = searchParams.get('tg_id') ?? ''
  const [code, setCode] = useState('')
  const [result, setResult] = useState<{ verified: boolean; error?: string } | null>(null)

  async function verify() {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, tg_id: tgId }),
    })
    setResult(await res.json())
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-20">
      <h1 className="text-2xl font-bold mb-4">ClawNews Verification</h1>
      <p className="text-gray-500 mb-6">Enter your invite code to join the community.</p>
      <input
        className="w-full border rounded px-3 py-2 mb-4"
        placeholder="Invite code"
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
      />
      <button onClick={verify} className="w-full bg-gray-900 text-white rounded py-2 hover:bg-gray-700">
        Verify
      </button>
      {result && (
        <div className={`mt-4 p-3 rounded ${result.verified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {result.verified ? 'Verified! You will receive a group invite shortly.' : result.error}
        </div>
      )}
    </div>
  )
}
```

```typescript
// web/app/api/invites/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { v4 as uuid } from 'uuid'

export async function GET() {
  const db = getDb()
  const invites = db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all()
  return NextResponse.json(invites)
}

export async function POST() {
  const db = getDb()
  const code = uuid().slice(0, 8).toUpperCase()
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code)
  return NextResponse.json({ code })
}
```

**Step 7: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add src/db/members.ts tests/db/members.test.ts web/
git commit -m "feat: mock verification flow with invite codes"
```

---

## Task 14: Admin Pages (Members + Invites)

**Files:**
- Create: `web/app/admin/members/page.tsx`
- Create: `web/app/admin/invites/page.tsx`
- Create: `web/app/api/members/route.ts`

**Step 1: Create members API**

```typescript
// web/app/api/members/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET() {
  const db = getDb()
  const members = db.prepare('SELECT * FROM members ORDER BY joined_at DESC').all()
  return NextResponse.json(members)
}
```

**Step 2: Create members admin page**

```tsx
// web/app/admin/members/page.tsx
'use client'
import { useEffect, useState } from 'react'

interface Member {
  id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string
}

const LEVELS = ['', '🦞 New', '🦞🦞 Growing', '🦞🦞🦞 Veteran']

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    fetch('/api/members').then(r => r.json()).then(setMembers)
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Members ({members.length})</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-sm text-gray-500">
            <th className="p-2">TG ID</th>
            <th className="p-2">Name</th>
            <th className="p-2">Level</th>
            <th className="p-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id} className="border-b hover:bg-gray-50">
              <td className="p-2 font-mono text-sm">{m.tg_id}</td>
              <td className="p-2">{m.tg_name ?? '-'}</td>
              <td className="p-2">{LEVELS[m.level] ?? m.level}</td>
              <td className="p-2 text-sm text-gray-500">{new Date(m.joined_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <div className="text-center text-gray-400 py-8">No members yet</div>}
    </div>
  )
}
```

**Step 3: Create invites admin page**

```tsx
// web/app/admin/invites/page.tsx
'use client'
import { useEffect, useState } from 'react'

interface Invite {
  code: string; created_at: string; used_by: string | null; active: number
}

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([])

  useEffect(() => { loadInvites() }, [])

  function loadInvites() {
    fetch('/api/invites').then(r => r.json()).then(setInvites)
  }

  async function createCode() {
    await fetch('/api/invites', { method: 'POST' })
    loadInvites()
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Invite Codes</h1>
        <button onClick={createCode} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700">
          Generate Code
        </button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-sm text-gray-500">
            <th className="p-2">Code</th>
            <th className="p-2">Status</th>
            <th className="p-2">Used By</th>
            <th className="p-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {invites.map(inv => (
            <tr key={inv.code} className="border-b hover:bg-gray-50">
              <td className="p-2 font-mono font-bold">{inv.code}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${inv.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {inv.active ? 'Active' : 'Used'}
                </span>
              </td>
              <td className="p-2 text-sm text-gray-500">{inv.used_by ?? '-'}</td>
              <td className="p-2 text-sm text-gray-500">{new Date(inv.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 4: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: admin pages for members and invite codes"
```

---

## Task 15: Navigation Layout

**Files:**
- Modify: `web/app/layout.tsx`
- Create: `web/components/nav.tsx`

**Step 1: Create nav component**

```tsx
// web/components/nav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/members', label: 'Members' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="border-b bg-white">
      <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-6">
        <Link href="/dashboard" className="font-bold text-lg">🦞 ClawNews</Link>
        <div className="flex gap-4">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm ${pathname === link.href ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
```

**Step 2: Add Nav to layout**

Modify `web/app/layout.tsx` to include `<Nav />` inside the body, above `{children}`.

**Step 3: Commit**

```bash
cd /Users/admin/Desktop/nao/clawnews
git add web/
git commit -m "feat: navigation layout with sidebar links"
```

---

## Task 16: End-to-End Smoke Test

**Files:**
- Create: `tests/e2e/pipeline.test.ts`

**Step 1: Write pipeline integration test**

```typescript
// tests/e2e/pipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import { produceArticles } from '../../src/producer/produce.js'
import type { CollectedItem } from '../../src/collector/types.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('full pipeline', () => {
  it('collect → produce → ready for review', async () => {
    // 1. Collect
    const mockCollector = (): Promise<CollectedItem[]> => Promise.resolve([
      { source_type: 'rss', source_name: 'coindesk', title: 'AI Agent Launches on Sui', url: 'https://example.com/ai-agent', content: 'A new AI agent framework for DeFi on Sui blockchain', language: 'en', raw_data: { test: true } },
    ])

    const collectResult = await runCollectors(db, [mockCollector])
    expect(collectResult.inserted).toBe(1)

    // 2. Produce
    const mockLLM = {
      async generate(): Promise<string> {
        return JSON.stringify({
          title_zh: 'AI Agent 在 Sui 链上启动',
          title_en: 'AI Agent Launches on Sui',
          summary_zh: '一个新的 AI Agent 框架在 Sui 区块链上推出，专注于 DeFi 交易。',
          summary_en: 'A new AI agent framework launches on Sui blockchain, focused on DeFi trading.',
          analysis_zh: '这表明 AI 与区块链的结合正在加速。',
          analysis_en: 'This signals accelerating convergence of AI and blockchain.',
          tags: ['ai-agent', 'sui', 'defi'],
        })
      },
    }

    const produceResult = await produceArticles(db, mockLLM)
    expect(produceResult.succeeded).toBe(1)

    // 3. Verify state
    expect(getRawItemsByStatus(db, 'produced')).toHaveLength(1)
    const drafts = getArticlesByStatus(db, 'draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].title_zh).toBe('AI Agent 在 Sui 链上启动')
    expect(JSON.parse(drafts[0].tags!)).toContain('ai-agent')
  })
})
```

**Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/e2e/
git commit -m "test: end-to-end pipeline smoke test"
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Project init | package.json, tsconfig.json |
| 2 | Database layer | src/db/, tests/db/ |
| 3 | RSS collector | src/collector/rss.ts, score.ts |
| 4 | GitHub collector | src/collector/github.ts |
| 5 | Collector runner | src/collector/run.ts |
| 6 | AI producer | src/producer/ |
| 7 | Next.js + API routes | web/app/api/ |
| 8 | Dashboard page | web/app/dashboard/ |
| 9 | Article editor | web/app/articles/ |
| 10 | TG Bot + formatter | src/publisher/ |
| 11 | Wire TG to web | web/app/api/.../publish/ |
| 12 | Cron scheduler | src/scheduler.ts, main.ts |
| 13 | Mock verification | src/db/members.ts, web/verify/ |
| 14 | Admin pages | web/app/admin/ |
| 15 | Nav layout | web/components/nav.tsx |
| 16 | E2E smoke test | tests/e2e/ |
