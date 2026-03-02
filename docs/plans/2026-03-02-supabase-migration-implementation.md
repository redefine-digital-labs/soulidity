# Supabase Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace SQLite with Supabase (Postgres + Auth + Real-time) across the entire ClawNews pipeline and web dashboard.

**Architecture:** Supabase cloud Postgres replaces local SQLite. Pipeline (collector/producer/publisher) runs locally with service_role key. Web dashboard deploys to Vercel with anon key + Supabase Auth. Real-time subscriptions push article changes to dashboard.

**Tech Stack:** `@supabase/supabase-js`, `@supabase/ssr`, Postgres, Supabase Auth, Supabase Real-time

**Design doc:** `docs/plans/2026-03-02-supabase-migration-design.md`

---

### Task 1: Create Postgres SQL migration

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/001_initial_schema.sql

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- raw_items: collected news items from RSS/GitHub
create table raw_items (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('rss', 'github')),
  source_name text not null,
  title       text not null,
  url         text not null unique,
  title_hash  text,
  content     text,
  language    text default 'en',
  score       real default 0,
  status      text default 'new' check (status in ('new', 'processing', 'produced', 'published', 'rejected')),
  raw_data    text,
  created_at  timestamptz default now()
);

create index idx_raw_items_status on raw_items(status);
create index idx_raw_items_score on raw_items(score desc);
create index idx_raw_items_created_at on raw_items(created_at);

-- articles: AI-produced bilingual content
create table articles (
  id          uuid primary key default gen_random_uuid(),
  raw_item_id uuid references raw_items(id) on delete cascade,
  title_zh    text not null,
  title_en    text not null,
  summary_zh  text not null,
  summary_en  text not null,
  analysis_zh text,
  analysis_en text,
  tags        text,
  status      text default 'draft' check (status in ('draft', 'reviewed', 'published')),
  created_at  timestamptz default now()
);

create index idx_articles_status on articles(status);

-- publications: TG channel publish records
create table publications (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid references articles(id) on delete cascade,
  channel      text not null,
  message_id   text,
  published_at timestamptz
);

-- members: TG community members
create table members (
  id          uuid primary key default gen_random_uuid(),
  tg_id       text not null unique,
  tg_name     text,
  wallet      text,
  level       integer default 1,
  invite_code text,
  joined_at   timestamptz default now()
);

create index idx_members_tg_id on members(tg_id);

-- invite_codes: community access codes
create table invite_codes (
  code       text primary key,
  created_at timestamptz default now(),
  used_by    text,
  active     integer default 1
);

-- RLS policies
alter table raw_items enable row level security;
alter table articles enable row level security;
alter table publications enable row level security;
alter table members enable row level security;
alter table invite_codes enable row level security;

-- Authenticated users can read all tables
create policy "auth_read_raw_items" on raw_items for select to authenticated using (true);
create policy "auth_read_articles" on articles for select to authenticated using (true);
create policy "auth_read_publications" on publications for select to authenticated using (true);
create policy "auth_read_members" on members for select to authenticated using (true);
create policy "auth_read_invite_codes" on invite_codes for select to authenticated using (true);

-- Authenticated users can update articles (review workflow)
create policy "auth_update_articles" on articles for update to authenticated using (true);

-- Authenticated users can insert/update invite_codes and members (admin actions)
create policy "auth_insert_invite_codes" on invite_codes for insert to authenticated with check (true);
create policy "auth_update_invite_codes" on invite_codes for update to authenticated using (true);
create policy "auth_insert_members" on members for insert to authenticated with check (true);

-- Authenticated users can insert publications (publish from dashboard)
create policy "auth_insert_publications" on publications for insert to authenticated with check (true);
create policy "auth_update_raw_items" on raw_items for update to authenticated using (true);

-- Enable real-time on articles table
alter publication supabase_realtime add table articles;
```

**Step 2: Verify the file exists**

Run: `cat supabase/migrations/001_initial_schema.sql | head -5`
Expected: Shows the first 5 lines of the migration

**Step 3: Commit**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "feat: add Postgres migration for Supabase"
```

---

### Task 2: Update dependencies and environment config

**Files:**
- Modify: `package.json`
- Modify: `web/package.json`
- Modify: `.env.example`
- Modify: `.gitignore`

**Step 1: Install Supabase SDK in root package (pipeline)**

Run: `npm install @supabase/supabase-js && npm uninstall better-sqlite3 uuid && npm uninstall -D @types/better-sqlite3 @types/uuid`

**Step 2: Install Supabase packages in web**

Run: `cd web && npm install @supabase/supabase-js @supabase/ssr && npm uninstall better-sqlite3 uuid && npm uninstall -D @types/better-sqlite3 @types/uuid && cd ..`

**Step 3: Update `.env.example`**

Replace contents with:

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Telegram
TG_BOT_TOKEN=123456:ABC...
TG_CHANNEL_ID=-100...
```

**Step 4: Update `.gitignore`**

Remove the `data/*.db*` lines (no more local SQLite). Keep existing entries.

Replace:
```
data/*.db
data/*.db-shm
data/*.db-wal
```
With nothing (remove those 3 lines).

**Step 5: Commit**

```bash
git add package.json package-lock.json web/package.json web/package-lock.json .env.example .gitignore
git commit -m "feat: swap better-sqlite3 for @supabase/supabase-js"
```

---

### Task 3: Rewrite core database layer

**Files:**
- Rewrite: `src/db/database.ts` — new Supabase async implementation
- Delete: `src/db/schema.ts`
- Delete: `src/db/init.ts`
- Modify: `src/shared/types.ts` — keep types, minor updates

**Step 1: Rewrite `src/shared/types.ts`**

Keep existing types but add Supabase table type alias. Replace full file:

```ts
export type SourceType = 'rss' | 'github'
export type RawItemStatus = 'new' | 'processing' | 'produced' | 'published' | 'rejected'
export type ArticleStatus = 'draft' | 'reviewed' | 'published'

export interface RawItem {
  id: string
  source_type: SourceType
  source_name: string
  title: string
  url: string
  title_hash: string | null
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

(This is unchanged — types already match Postgres columns. `id` stays `string` since Postgres uuid serializes as string via Supabase.)

**Step 2: Rewrite `src/db/database.ts`**

Replace full file:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { RawItem, Article, RawItemStatus, ArticleStatus } from '../shared/types.js'

// --- Client setup ---

export function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  return createClient(url, key)
}

// --- raw_items ---

export async function insertRawItem(
  sb: SupabaseClient,
  item: Omit<RawItem, 'id' | 'created_at' | 'status'>
): Promise<string | null> {
  const { data, error } = await sb
    .from('raw_items')
    .upsert({
      source_type: item.source_type,
      source_name: item.source_name,
      title: item.title,
      url: item.url,
      title_hash: item.title_hash ?? null,
      content: item.content,
      language: item.language,
      score: item.score,
      raw_data: item.raw_data,
    }, { onConflict: 'url', ignoreDuplicates: true })
    .select('id')
    .single()

  if (error) {
    // Duplicate URL — upsert with ignoreDuplicates returns no rows
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data?.id ?? null
}

export async function getRawItemsByStatus(sb: SupabaseClient, status: RawItemStatus, limit = 10): Promise<RawItem[]> {
  const { data, error } = await sb
    .from('raw_items')
    .select('*')
    .eq('status', status)
    .order('score', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as RawItem[]
}

export async function updateRawItemStatus(sb: SupabaseClient, id: string, status: RawItemStatus): Promise<void> {
  const { error } = await sb.from('raw_items').update({ status }).eq('id', id)
  if (error) throw error
}

// --- articles ---

export async function insertArticle(
  sb: SupabaseClient,
  article: Omit<Article, 'id' | 'created_at' | 'status'>
): Promise<string> {
  const { data, error } = await sb
    .from('articles')
    .insert({
      raw_item_id: article.raw_item_id,
      title_zh: article.title_zh,
      title_en: article.title_en,
      summary_zh: article.summary_zh,
      summary_en: article.summary_en,
      analysis_zh: article.analysis_zh,
      analysis_en: article.analysis_en,
      tags: article.tags,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

export async function getArticlesByStatus(sb: SupabaseClient, status: ArticleStatus, limit = 20): Promise<Article[]> {
  const { data, error } = await sb
    .from('articles')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as Article[]
}

export async function getArticleById(sb: SupabaseClient, id: string): Promise<Article | undefined> {
  const { data, error } = await sb.from('articles').select('*').eq('id', id).single()
  if (error) {
    if (error.code === 'PGRST116') return undefined
    throw error
  }
  return data as Article
}

export async function updateArticle(
  sb: SupabaseClient,
  id: string,
  fields: Partial<Pick<Article, 'title_zh' | 'title_en' | 'summary_zh' | 'summary_en' | 'analysis_zh' | 'analysis_en' | 'tags' | 'status'>>
): Promise<void> {
  if (Object.keys(fields).length === 0) return
  const { error } = await sb.from('articles').update(fields).eq('id', id)
  if (error) throw error
}

// --- publications ---

export async function insertPublication(sb: SupabaseClient, articleId: string, channel: string, messageId: string): Promise<string> {
  const { data, error } = await sb
    .from('publications')
    .insert({ article_id: articleId, channel, message_id: messageId, published_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

// --- stats ---

export async function getStats(sb: SupabaseClient): Promise<{ raw_new: number; articles_draft: number; articles_reviewed: number; published_today: number }> {
  const [rawNew, artDraft, artReviewed, pubToday] = await Promise.all([
    sb.from('raw_items').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    sb.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'reviewed'),
    sb.from('publications').select('*', { count: 'exact', head: true }).gte('published_at', new Date().toISOString().slice(0, 10)),
  ])
  return {
    raw_new: rawNew.count ?? 0,
    articles_draft: artDraft.count ?? 0,
    articles_reviewed: artReviewed.count ?? 0,
    published_today: pubToday.count ?? 0,
  }
}
```

**Step 3: Delete `src/db/schema.ts` and `src/db/init.ts`**

Run: `rm src/db/schema.ts src/db/init.ts`

**Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors from callers that still use old API (expected — we'll fix in Task 4)

**Step 5: Commit**

```bash
git add src/db/database.ts src/shared/types.ts
git rm src/db/schema.ts src/db/init.ts
git commit -m "feat: rewrite database layer for Supabase"
```

---

### Task 4: Update pipeline callers (sync → async)

**Files:**
- Modify: `src/collector/run.ts`
- Modify: `src/collector/dedup.ts`
- Modify: `src/producer/produce.ts`
- Modify: `src/producer/run.ts`
- Modify: `src/publisher/bot.ts`
- Modify: `src/db/members.ts`
- Modify: `src/scheduler.ts`
- Modify: `src/main.ts`

**Step 1: Rewrite `src/collector/dedup.ts`**

Replace full file — change `Database.Database` → `SupabaseClient`, sync → async:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { titleHash, jaccardSimilarity, SIMILARITY_THRESHOLD } from './simhash.js'

const WINDOW_HOURS = 72

export async function isDuplicate(
  sb: SupabaseClient,
  title: string,
  windowHours = WINDOW_HOURS,
): Promise<{ duplicate: true; hash: string; matchedId: string } | { duplicate: false; hash: string }> {
  const hash = titleHash(title)
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

  // Fast path: exact hash match
  const { data: exactMatch } = await sb
    .from('raw_items')
    .select('id')
    .eq('title_hash', hash)
    .gte('created_at', since)
    .limit(1)
    .single()

  if (exactMatch) {
    return { duplicate: true, hash, matchedId: exactMatch.id }
  }

  // Slow path: Jaccard similarity on recent titles
  const { data: rows } = await sb
    .from('raw_items')
    .select('id, title')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  for (const row of rows ?? []) {
    if (jaccardSimilarity(title, row.title) >= SIMILARITY_THRESHOLD) {
      return { duplicate: true, hash, matchedId: row.id }
    }
  }

  return { duplicate: false, hash }
}
```

**Step 2: Rewrite `src/collector/run.ts`**

Replace full file:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectRss } from './rss.js'
import { collectGithub } from './github.js'
import { scoreItem } from './score.js'
import { isDuplicate } from './dedup.js'
import { insertRawItem } from '../db/database.js'
import type { CollectedItem } from './types.js'

export async function runCollectors(sb: SupabaseClient, collectors: Array<() => Promise<CollectedItem[]>>): Promise<{ total: number; inserted: number; skipped: number }> {
  let total = 0
  let inserted = 0
  let skipped = 0

  for (const collector of collectors) {
    const items = await collector()
    total += items.length

    for (const item of items) {
      const dedup = await isDuplicate(sb, item.title)
      if (dedup.duplicate) {
        console.log(`  skipped (similar to ${dedup.matchedId}): ${item.title}`)
        skipped++
        continue
      }

      const score = scoreItem(item.title, item.content)
      const id = await insertRawItem(sb, {
        source_type: item.source_type,
        source_name: item.source_name,
        title: item.title,
        url: item.url,
        title_hash: dedup.hash,
        content: item.content,
        language: item.language,
        score,
        raw_data: JSON.stringify(item.raw_data),
      })
      if (id) inserted++
    }
  }

  return { total, inserted, skipped }
}

// CLI entry point
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const { createSupabaseAdmin } = await import('../db/database.js')
  const sb = createSupabaseAdmin()

  console.log('Running collectors...')
  const result = await runCollectors(sb, [collectRss, collectGithub])
  console.log(`Done. Fetched ${result.total} items, inserted ${result.inserted} new, skipped ${result.skipped} duplicates.`)
}
```

**Step 3: Rewrite `src/producer/produce.ts`**

Replace full file:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
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
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  const required = ['title_zh', 'title_en', 'summary_zh', 'summary_en']
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`)
  }
  return parsed as ProducedArticle
}

export async function produceArticles(sb: SupabaseClient, llm: LLMAdapter, limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
  const items = await getRawItemsByStatus(sb, 'new', limit)
  let succeeded = 0
  let failed = 0

  for (const item of items) {
    await updateRawItemStatus(sb, item.id, 'processing')
    try {
      const prompt = buildUserPrompt(item.title, item.content ?? '', item.url, item.source_name)
      const response = await llm.generate(SYSTEM_PROMPT, prompt)
      const article = parseResponse(response)

      await insertArticle(sb, {
        raw_item_id: item.id,
        title_zh: article.title_zh,
        title_en: article.title_en,
        summary_zh: article.summary_zh,
        summary_en: article.summary_en,
        analysis_zh: article.analysis_zh,
        analysis_en: article.analysis_en,
        tags: JSON.stringify(article.tags),
      })

      await updateRawItemStatus(sb, item.id, 'produced')
      succeeded++
    } catch (err) {
      console.error(`Failed to produce article for ${item.id}:`, err)
      await updateRawItemStatus(sb, item.id, 'rejected')
      failed++
    }
  }

  return { processed: items.length, succeeded, failed }
}

export { parseResponse, buildUserPrompt }
```

**Step 4: Rewrite `src/producer/run.ts`**

Replace full file:

```ts
import 'dotenv/config'
import { createSupabaseAdmin } from '../db/database.js'
import { createAnthropicAdapter } from './llm.js'
import { produceArticles } from './produce.js'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

const sb = createSupabaseAdmin()
const llm = createAnthropicAdapter(apiKey)

console.log('Producing articles...')
const result = await produceArticles(sb, llm)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)
```

**Step 5: Rewrite `src/publisher/bot.ts`**

Replace full file:

```ts
import { Bot } from 'grammy'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatArticle } from './formatter.js'
import type { Article } from '../shared/types.js'

export function createBot(token: string) {
  return new Bot(token)
}

export async function publishToChannel(
  bot: Bot,
  channelId: string,
  sb: SupabaseClient,
  articleId: string,
): Promise<string> {
  const { data: article, error: artErr } = await sb
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single()
  if (artErr || !article) throw new Error(`Article not found: ${articleId}`)

  const { data: raw } = await sb
    .from('raw_items')
    .select('url')
    .eq('id', (article as Article).raw_item_id)
    .single()

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

  // Update article status
  await sb.from('articles').update({ status: 'published' }).eq('id', articleId)

  // Record publication
  await sb.from('publications').insert({
    article_id: articleId,
    channel: channelId,
    message_id: messageId,
    published_at: new Date().toISOString(),
  })

  return messageId
}
```

**Step 6: Rewrite `src/db/members.ts`**

Replace full file:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export async function createInviteCode(sb: SupabaseClient): Promise<string> {
  const code = crypto.randomUUID().slice(0, 8).toUpperCase()
  const { error } = await sb.from('invite_codes').insert({ code })
  if (error) throw error
  return code
}

export async function validateInviteCode(sb: SupabaseClient, code: string): Promise<boolean> {
  const { data } = await sb
    .from('invite_codes')
    .select('code')
    .eq('code', code)
    .eq('active', 1)
    .is('used_by', null)
    .single()
  return !!data
}

export async function useInviteCode(sb: SupabaseClient, code: string, tgId: string): Promise<boolean> {
  const { data } = await sb
    .from('invite_codes')
    .update({ used_by: tgId, active: 0 })
    .eq('code', code)
    .eq('active', 1)
    .is('used_by', null)
    .select('code')
  return (data?.length ?? 0) > 0
}

export async function insertMember(sb: SupabaseClient, tgId: string, tgName: string | null, inviteCode: string): Promise<string> {
  const { data, error } = await sb
    .from('members')
    .upsert({ tg_id: tgId, tg_name: tgName, invite_code: inviteCode }, { onConflict: 'tg_id', ignoreDuplicates: true })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

export async function getMembers(sb: SupabaseClient): Promise<Array<{ id: string; tg_id: string; tg_name: string | null; level: number; joined_at: string }>> {
  const { data, error } = await sb
    .from('members')
    .select('id, tg_id, tg_name, level, joined_at')
    .order('joined_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
```

**Step 7: Rewrite `src/scheduler.ts`**

Replace full file:

```ts
import cron from 'node-cron'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { produceArticles } from './producer/produce.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(sb: SupabaseClient, llm: LLMAdapter) {
  // RSS collection — every hour
  cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running RSS collection...`)
    const result = await runCollectors(sb, [collectRss])
    console.log(`RSS: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // GitHub collection — daily at 6:00
  cron.schedule('0 6 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running GitHub collection...`)
    const result = await runCollectors(sb, [collectGithub])
    console.log(`GitHub: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // Content production — every hour at :30 (after collection)
  cron.schedule('30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running content production...`)
    const result = await produceArticles(sb, llm)
    console.log(`Producer: processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}`)
  })

  console.log('Scheduler started. Cron jobs:')
  console.log('  RSS collection:      every hour at :00')
  console.log('  GitHub collection:   daily at 06:00')
  console.log('  Content production:  every hour at :30')
}
```

**Step 8: Rewrite `src/main.ts`**

Replace full file:

```ts
import 'dotenv/config'
import { createSupabaseAdmin } from './db/database.js'
import { createAnthropicAdapter } from './producer/llm.js'
import { startScheduler } from './scheduler.js'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Set it in .env')
  process.exit(1)
}

const sb = createSupabaseAdmin()
const llm = createAnthropicAdapter(apiKey)

console.log('ClawNews engine starting...')
console.log(`Supabase: ${process.env.SUPABASE_URL}`)

startScheduler(sb, llm)

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  process.exit(0)
})
```

**Step 9: Remove `db:init` script from `package.json`**

In `package.json`, remove the `"db:init": "tsx src/db/init.ts",` line from scripts.

**Step 10: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Only errors from test files (we'll fix in Task 7) and web files (Task 5)

**Step 11: Commit**

```bash
git add src/collector/run.ts src/collector/dedup.ts src/producer/produce.ts src/producer/run.ts src/publisher/bot.ts src/db/members.ts src/scheduler.ts src/main.ts package.json
git commit -m "feat: migrate pipeline callers to async Supabase"
```

---

### Task 5: Rewrite web layer (DB + Auth + API routes)

**Files:**
- Rewrite: `web/lib/db.ts` → Supabase client helpers
- Delete: `web/lib/auth.ts`
- Create: `web/lib/supabase/server.ts` — server-side Supabase client
- Create: `web/lib/supabase/client.ts` — browser-side Supabase client
- Rewrite: `web/middleware.ts` — Supabase Auth session refresh
- Rewrite: `web/app/login/page.tsx` — Supabase Auth login
- Delete: `web/app/api/auth/login/route.ts`
- Delete: `web/app/api/auth/logout/route.ts`
- Rewrite: `web/app/api/articles/route.ts`
- Rewrite: `web/app/api/articles/[id]/route.ts`
- Rewrite: `web/app/api/articles/[id]/publish/route.ts`
- Rewrite: `web/app/api/stats/route.ts`
- Rewrite: `web/app/api/invites/route.ts`
- Rewrite: `web/app/api/members/route.ts`
- Rewrite: `web/app/api/verify/route.ts`
- Modify: `web/components/nav.tsx` — Supabase logout

**Step 1: Create `web/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServer() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        },
      },
    }
  )
}
```

**Step 2: Create `web/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

**Step 3: Delete old files**

Run:
```bash
rm web/lib/auth.ts web/lib/db.ts
rm -rf web/app/api/auth/
```

**Step 4: Rewrite `web/middleware.ts`**

Replace full file:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths
  if (
    pathname === '/login' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**Step 5: Rewrite `web/app/login/page.tsx`**

Replace full file:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-sm border w-full max-w-sm">
        <h1 className="text-xl font-bold mb-6 text-center">ClawNews</h1>

        <input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2 focus:ring-gray-900"
          autoFocus
        />

        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-md mb-4 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
```

**Step 6: Rewrite `web/components/nav.tsx`**

Replace full file:

```tsx
'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/members', label: 'Members' },
]

export function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createSupabaseBrowser()

  if (pathname === '/login') return null

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="border-b bg-white">
      <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-6">
        <Link href="/dashboard" className="font-bold text-lg">ClawNews</Link>
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
        <button
          onClick={handleLogout}
          className="ml-auto text-sm text-gray-500 hover:text-gray-700"
        >
          退出
        </button>
      </div>
    </nav>
  )
}
```

**Step 7: Rewrite all API routes to use Supabase**

`web/app/api/articles/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const status = request.nextUrl.searchParams.get('status')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50')

  let query = supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(limit)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

`web/app/api/articles/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServer()

  const { data: article, error } = await supabase.from('articles').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: raw } = await supabase
    .from('raw_items')
    .select('url, source_name')
    .eq('id', article.raw_item_id)
    .single()

  return NextResponse.json({ ...article, source_url: raw?.url, source_name: raw?.source_name })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServer()
  const body = await request.json()

  const allowed = ['title_zh', 'title_en', 'summary_zh', 'summary_en', 'analysis_zh', 'analysis_en', 'tags', 'status']
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) updates[key] = value
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const { data, error } = await supabase.from('articles').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

`web/app/api/articles/[id]/publish/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'
import { Bot } from 'grammy'
import { formatArticle } from '@web/lib/formatter'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServer()

  const { data: article, error: artErr } = await supabase.from('articles').select('*').eq('id', id).single()
  if (artErr || !article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: raw } = await supabase.from('raw_items').select('url').eq('id', article.raw_item_id).single()

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!token || !channelId) {
    return NextResponse.json({ error: 'TG_BOT_TOKEN or TG_CHANNEL_ID not configured' }, { status: 500 })
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

  let messageId: string
  try {
    const bot = new Bot(token)
    const sent = await bot.api.sendMessage(channelId, text)
    messageId = String(sent.message_id)
  } catch (err) {
    return NextResponse.json({ error: `TG send failed: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }

  await supabase.from('articles').update({ status: 'published' }).eq('id', id)
  const { data: pub } = await supabase
    .from('publications')
    .insert({ article_id: id, channel: 'tg_daily', message_id: messageId, published_at: new Date().toISOString() })
    .select('id')
    .single()

  return NextResponse.json({ success: true, publication_id: pub?.id, message_id: messageId })
}
```

`web/app/api/stats/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServer()

  const [rawNew, artDraft, artReviewed, pubToday] = await Promise.all([
    supabase.from('raw_items').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('status', 'reviewed'),
    supabase.from('publications').select('*', { count: 'exact', head: true }).gte('published_at', new Date().toISOString().slice(0, 10)),
  ])

  return NextResponse.json({
    raw_new: rawNew.count ?? 0,
    articles_draft: artDraft.count ?? 0,
    articles_reviewed: artReviewed.count ?? 0,
    published_today: pubToday.count ?? 0,
  })
}
```

`web/app/api/invites/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.from('invite_codes').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST() {
  const supabase = await createSupabaseServer()
  const code = crypto.randomUUID().slice(0, 8).toUpperCase()
  const { error } = await supabase.from('invite_codes').insert({ code })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ code })
}
```

`web/app/api/members/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.from('members').select('*').order('joined_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

`web/app/api/verify/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { code, tg_id, tg_name } = await request.json()

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
  }

  const { data: invite } = await supabase
    .from('invite_codes')
    .select('code')
    .eq('code', code)
    .eq('active', 1)
    .is('used_by', null)
    .single()

  if (!invite) {
    return NextResponse.json({ verified: false, error: 'Invalid or used invite code' })
  }

  await supabase.from('invite_codes').update({ used_by: tg_id, active: 0 }).eq('code', code)
  await supabase.from('members').upsert(
    { tg_id, tg_name: tg_name ?? null, invite_code: code },
    { onConflict: 'tg_id', ignoreDuplicates: true }
  )

  return NextResponse.json({ verified: true })
}
```

**Step 8: Add NEXT_PUBLIC env vars to `web/next.config.ts` (or `.env.local`)**

The browser Supabase client needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. These can be set via Next.js env or loaded from the root `.env`. Check if there's a `next.config.ts` that already loads root env:

If using Next.js env loading from root `.env`, add these to `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

**Step 9: Verify web compiles**

Run: `cd web && npx next build 2>&1 | tail -20 && cd ..`
Expected: Build succeeds (or only env-related warnings, which is expected without real Supabase keys)

**Step 10: Commit**

```bash
git add web/
git rm web/lib/auth.ts web/lib/db.ts
git rm -rf web/app/api/auth/
git commit -m "feat: migrate web dashboard to Supabase Auth + DB"
```

---

### Task 6: Add real-time subscriptions to dashboard

**Files:**
- Modify: `web/components/article-list.tsx` — add Supabase real-time subscription

**Step 1: Read the current article-list component**

Read `web/components/article-list.tsx` to understand current implementation.

**Step 2: Add real-time subscription**

Add a `useEffect` that subscribes to `postgres_changes` on the `articles` table. On any INSERT/UPDATE/DELETE event, re-fetch the article list. Use `createSupabaseBrowser()` for the subscription client.

Pattern:
```tsx
import { createSupabaseBrowser } from '@web/lib/supabase/client'

// Inside the component:
useEffect(() => {
  const supabase = createSupabaseBrowser()
  const channel = supabase
    .channel('articles-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'articles' },
      () => { fetchArticles() }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [])
```

**Step 3: Commit**

```bash
git add web/components/article-list.tsx
git commit -m "feat: add real-time article list updates via Supabase"
```

---

### Task 7: Update tests

**Files:**
- Rewrite: `tests/db/database.test.ts`
- Rewrite: `tests/db/members.test.ts`
- Rewrite: `tests/collector/run.test.ts`
- Rewrite: `tests/e2e/pipeline.test.ts`
- Modify: `tests/producer/produce.test.ts`

All tests that used `better-sqlite3` in-memory DB need to be rewritten. There are two approaches:

**Approach: Mock Supabase client in tests**

Create a test helper that mocks the Supabase client with in-memory storage. This avoids needing a real Supabase instance for unit tests.

**Step 1: Create `tests/helpers/mock-supabase.ts`**

```ts
import { vi } from 'vitest'

// In-memory storage for test data
interface MockStore {
  [table: string]: Record<string, unknown>[]
}

export function createMockSupabase() {
  const store: MockStore = {}

  function getTable(name: string) {
    if (!store[name]) store[name] = []
    return store[name]
  }

  const mockClient = {
    from: (table: string) => createQueryBuilder(getTable(table), table),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  }

  return { client: mockClient as any, store }
}

function createQueryBuilder(table: Record<string, unknown>[], tableName: string) {
  let _filters: Array<{ field: string; op: string; value: unknown }> = []
  let _order: { field: string; ascending: boolean } | null = null
  let _limit: number | null = null
  let _single = false
  let _head = false
  let _countMode = false
  let _selectFields = '*'
  let _insertData: Record<string, unknown> | Record<string, unknown>[] | null = null
  let _updateData: Record<string, unknown> | null = null
  let _upsertData: Record<string, unknown> | null = null
  let _upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  let _mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'

  const builder = {
    select(fields = '*', opts?: { count?: string; head?: boolean }) {
      _selectFields = fields
      if (opts?.count) _countMode = true
      if (opts?.head) _head = true
      _mode = 'select'
      return builder
    },
    insert(data: Record<string, unknown> | Record<string, unknown>[]) {
      _insertData = data
      _mode = 'insert'
      return builder
    },
    update(data: Record<string, unknown>) {
      _updateData = data
      _mode = 'update'
      return builder
    },
    upsert(data: Record<string, unknown>, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      _upsertData = data
      _upsertOptions = opts ?? {}
      _mode = 'upsert'
      return builder
    },
    delete() {
      _mode = 'delete'
      return builder
    },
    eq(field: string, value: unknown) { _filters.push({ field, op: 'eq', value }); return builder },
    gte(field: string, value: unknown) { _filters.push({ field, op: 'gte', value }); return builder },
    is(field: string, value: unknown) { _filters.push({ field, op: 'is', value }); return builder },
    order(field: string, opts?: { ascending?: boolean }) { _order = { field, ascending: opts?.ascending ?? true }; return builder },
    limit(n: number) { _limit = n; return builder },
    single() {
      _single = true
      return execute()
    },
  }

  function applyFilters(rows: Record<string, unknown>[]) {
    return rows.filter(row => {
      return _filters.every(f => {
        if (f.op === 'eq') return row[f.field] === f.value
        if (f.op === 'gte') return (row[f.field] as string) >= (f.value as string)
        if (f.op === 'is') return row[f.field] === f.value
        return true
      })
    })
  }

  function execute(): { data: unknown; error: unknown; count?: number } {
    if (_mode === 'insert') {
      const rows = Array.isArray(_insertData) ? _insertData : [_insertData!]
      for (const row of rows) {
        const newRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }
        table.push(newRow)
      }
      if (_single) return { data: table[table.length - 1], error: null }
      return { data: rows.map((_, i) => table[table.length - rows.length + i]), error: null }
    }

    if (_mode === 'upsert') {
      const conflictField = _upsertOptions.onConflict ?? 'id'
      const existing = table.find(r => r[conflictField] === (_upsertData as Record<string, unknown>)[conflictField])
      if (existing && _upsertOptions.ignoreDuplicates) {
        if (_single) return { data: null, error: { code: 'PGRST116' } }
        return { data: [], error: null }
      }
      if (existing) {
        Object.assign(existing, _upsertData)
        if (_single) return { data: existing, error: null }
        return { data: [existing], error: null }
      }
      const newRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ..._upsertData }
      table.push(newRow)
      if (_single) return { data: newRow, error: null }
      return { data: [newRow], error: null }
    }

    if (_mode === 'update') {
      let rows = applyFilters(table)
      for (const row of rows) {
        Object.assign(row, _updateData)
      }
      // If chained with .select(), return updated rows
      if (_selectFields) {
        if (_single) return { data: rows[0] ?? null, error: rows.length ? null : { code: 'PGRST116' } }
        return { data: rows, error: null }
      }
      return { data: null, error: null }
    }

    // select
    let rows = applyFilters(table)
    if (_order) {
      rows.sort((a, b) => {
        const av = a[_order!.field] as string
        const bv = b[_order!.field] as string
        return _order!.ascending ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
      })
    }
    if (_limit) rows = rows.slice(0, _limit)
    if (_head) return { data: null, error: null, count: rows.length }
    if (_single) {
      if (rows.length === 0) return { data: null, error: { code: 'PGRST116' } }
      return { data: rows[0], error: null }
    }
    return { data: rows, error: null, count: rows.length }
  }

  // Make builder thenable so `await sb.from(...).select(...)` works without explicit .single()
  Object.defineProperty(builder, 'then', {
    get() {
      const result = execute()
      return (resolve: (v: unknown) => void) => resolve(result)
    }
  })

  return builder
}
```

**Step 2: Rewrite `tests/db/database.test.ts`**

Use the mock Supabase client. Test the same operations (insert, retrieve, update, stats) but through async Supabase API.

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockSupabase } from '../helpers/mock-supabase.js'
import { insertRawItem, getRawItemsByStatus, updateRawItemStatus, insertArticle, getArticlesByStatus, getArticleById, updateArticle, getStats } from '../../src/db/database.js'

let sb: ReturnType<typeof createMockSupabase>['client']

beforeEach(() => {
  const mock = createMockSupabase()
  sb = mock.client
})

describe('raw_items', () => {
  it('inserts and retrieves raw items', async () => {
    const id = await insertRawItem(sb, {
      source_type: 'rss',
      source_name: 'coindesk',
      title: 'Test Article',
      url: 'https://example.com/1',
      title_hash: null,
      content: 'Some content',
      language: 'en',
      score: 5.0,
      raw_data: null,
    })
    expect(id).toBeTruthy()
    const items = await getRawItemsByStatus(sb, 'new')
    expect(items.length).toBeGreaterThanOrEqual(1)
  })

  it('updates status', async () => {
    const id = await insertRawItem(sb, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://example.com/2', title_hash: null, content: null, language: 'en', score: 1, raw_data: null,
    })
    await updateRawItemStatus(sb, id!, 'produced')
    const newItems = await getRawItemsByStatus(sb, 'new')
    const produced = await getRawItemsByStatus(sb, 'produced')
    expect(newItems).toHaveLength(0)
    expect(produced).toHaveLength(1)
  })
})

describe('articles', () => {
  it('inserts and retrieves articles', async () => {
    const rawId = await insertRawItem(sb, {
      source_type: 'rss', source_name: 'coindesk', title: 'Raw',
      url: 'https://example.com/raw-1', title_hash: null, content: null, language: 'en', score: 5, raw_data: null,
    })
    const id = await insertArticle(sb, {
      raw_item_id: rawId!,
      title_zh: '测试标题', title_en: 'Test Title',
      summary_zh: '中文摘要', summary_en: 'English summary',
      analysis_zh: '中文解读', analysis_en: 'English analysis',
      tags: '["ai","web3"]',
    })
    const article = await getArticleById(sb, id)
    expect(article).toBeDefined()
    expect(article!.title_zh).toBe('测试标题')
  })
})
```

**Step 3: Update remaining test files similarly**

Apply the same pattern: replace `Database.Database` with mock Supabase client, add `async/await` to all DB calls.

For `tests/collector/run.test.ts` and `tests/e2e/pipeline.test.ts`, use `createMockSupabase()` instead of `createDb(':memory:')`.

For `tests/producer/produce.test.ts`, update `produceArticles(db, mockLLM)` to `produceArticles(sb, mockLLM)`.

`tests/collector/simhash.test.ts` does not touch the DB — no changes needed.

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/
git commit -m "test: migrate tests to mock Supabase client"
```

---

### Task 8: Cleanup and final verification

**Files:**
- Delete: `data/` directory (if it exists and is tracked)
- Verify: all compilation, tests, and build

**Step 1: Remove data directory from tracking**

Run: `rm -rf data/`

The directory was already in `.gitignore` so no git changes needed unless files were tracked.

**Step 2: Verify root project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Verify web builds**

Run: `cd web && npx next build 2>&1 | tail -10 && cd ..`
Expected: Build succeeds (env warnings are OK)

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup SQLite artifacts after Supabase migration"
```

**Step 6: Verify commit log**

Run: `git log --oneline -8`
Expected: 7-8 clean commits showing the migration progression
