# Phase 1a: 新闻媒体 + AI 多角色 Pipeline + 可视化工作台

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing single-LLM pipeline into a multi-agent role-based pipeline (Scout → Reporter → Analyst → Editor → Publisher), add pipeline status tracking to the database, build a news detail page, and build a real-time pipeline visualization page.

**Architecture:** The existing `produce.ts` single-step LLM call gets split into 4 sequential agent roles, each writing its output to a new `AgentProcessLog` table. The existing `RawItem → Article` flow remains but gains a `pipelineStatus` field on Article. The web frontend adds two new pages: `/news/[id]` (article detail with agent outputs) and `/pipeline` (real-time pipeline dashboard).

**Tech Stack:** TypeScript, Prisma ORM, Next.js 16 (App Router), TailwindCSS, existing LLM adapter (OpenAI-compatible API via `src/producer/llm.ts`)

**Reference PRD:** `docs/plans/2026-03-05-cryptoopenclaw-product-prd.md`

---

## Task 1: Add AgentRole and AgentProcessLog to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/shared/types.ts`

**Step 1: Add new models to schema**

Add to `prisma/schema.prisma` after the existing `Article` model:

```prisma
model AgentRole {
  id          String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String            @unique
  label       String
  description String?
  sortOrder   Int               @default(0) @map("sort_order")
  logs        AgentProcessLog[]

  @@map("agent_roles")
}

model AgentProcessLog {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  articleId   String    @map("article_id") @db.Uuid
  article     Article   @relation(fields: [articleId], references: [id], onDelete: Cascade)
  roleId      String    @map("role_id") @db.Uuid
  role        AgentRole @relation(fields: [roleId], references: [id])
  status      String    @default("pending")
  input       String?
  output      String?
  startedAt   DateTime? @map("started_at") @db.Timestamptz
  completedAt DateTime? @map("completed_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  @@index([articleId])
  @@index([status])
  @@map("agent_process_logs")
}
```

Also add `pipelineStatus` field to the existing `Article` model:

```prisma
  pipelineStatus String @default("pending") @map("pipeline_status")
```

And add the `AgentProcessLog` relation to `Article`:

```prisma
  processLogs  AgentProcessLog[]
```

**Step 2: Add types to `src/shared/types.ts`**

```typescript
export type AgentRoleName = 'scout' | 'reporter' | 'analyst' | 'editor' | 'publisher'
export type PipelineStatus = 'pending' | 'scouting' | 'reporting' | 'analyzing' | 'editing' | 'publishing' | 'completed' | 'failed'
export type ProcessLogStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AgentProcessLog {
  id: string
  article_id: string
  role_id: string
  role_name?: string
  status: ProcessLogStatus
  input: string | null
  output: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}
```

**Step 3: Run Prisma generate and push schema**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma db push --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

Expected: Schema synced, client generated without errors.

**Step 4: Commit**

```bash
git add prisma/schema.prisma src/shared/types.ts
git commit -m "feat: add AgentRole and AgentProcessLog models for multi-agent pipeline"
```

---

## Task 2: Seed agent roles and add database helpers

**Files:**
- Create: `src/db/agent-roles.ts`
- Modify: `src/db/database.ts`
- Create: `tests/db/agent-roles.test.ts`

**Step 1: Write the failing test**

Create `tests/db/agent-roles.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { seedAgentRoles, createProcessLog, updateProcessLog, getProcessLogsForArticle } from '../../src/db/agent-roles.js'

describe('agent-roles db', () => {
  it('seedAgentRoles creates 5 roles if none exist', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    expect(store.agentRoles.length).toBe(5)
    expect(store.agentRoles.map((r: any) => r.name)).toEqual([
      'scout', 'reporter', 'analyst', 'editor', 'publisher'
    ])
  })

  it('createProcessLog inserts a log entry', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    const roleId = store.agentRoles[0].id
    const logId = await createProcessLog(prisma, {
      articleId: 'article-1',
      roleId,
    })
    expect(logId).toBeTruthy()
    expect(store.agentProcessLogs.length).toBe(1)
    expect(store.agentProcessLogs[0].status).toBe('pending')
  })

  it('updateProcessLog updates status and output', async () => {
    const { prisma, store } = createMockPrisma()
    await seedAgentRoles(prisma)
    const roleId = store.agentRoles[0].id
    const logId = await createProcessLog(prisma, {
      articleId: 'article-1',
      roleId,
    })
    await updateProcessLog(prisma, logId, {
      status: 'completed',
      output: '{"result": "test"}',
    })
    expect(store.agentProcessLogs[0].status).toBe('completed')
    expect(store.agentProcessLogs[0].output).toBe('{"result": "test"}')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/db/agent-roles.test.ts
```

Expected: FAIL — module `../../src/db/agent-roles.js` not found.

**Step 3: Update mock-prisma to support new models**

In `tests/helpers/mock-prisma.ts`, add to `MockStore`:

```typescript
  agentRoles: any[]
  agentProcessLogs: any[]
```

And in `createMockPrisma()`, add:

```typescript
    agentRole: createModel(store.agentRoles),
    agentProcessLog: createModel(store.agentProcessLogs, { status: 'pending' }),
```

**Step 4: Create `src/db/agent-roles.ts`**

```typescript
import type { PrismaClient } from './database.js'

const ROLES = [
  { name: 'scout', label: '侦察员 Scout', description: '源头采集、去重、评分', sortOrder: 1 },
  { name: 'reporter', label: '记者 Reporter', description: '摘要撰写、翻译', sortOrder: 2 },
  { name: 'analyst', label: '分析师 Analyst', description: '深度解读、关联分析', sortOrder: 3 },
  { name: 'editor', label: '编辑 Editor', description: '质量审核、终稿把关', sortOrder: 4 },
  { name: 'publisher', label: '发行员 Publisher', description: '多渠道分发', sortOrder: 5 },
]

export async function seedAgentRoles(prisma: PrismaClient): Promise<void> {
  for (const role of ROLES) {
    await prisma.agentRole.upsert({
      where: { name: role.name },
      create: role,
      update: {},
    })
  }
}

export async function getRoleByName(prisma: PrismaClient, name: string) {
  return prisma.agentRole.findUnique({ where: { name } })
}

export async function createProcessLog(
  prisma: PrismaClient,
  data: { articleId: string; roleId: string }
): Promise<string> {
  const row = await prisma.agentProcessLog.create({
    data: {
      articleId: data.articleId,
      roleId: data.roleId,
      status: 'pending',
    },
  })
  return row.id
}

export async function updateProcessLog(
  prisma: PrismaClient,
  id: string,
  fields: { status?: string; input?: string; output?: string; startedAt?: Date; completedAt?: Date }
): Promise<void> {
  const data: Record<string, unknown> = {}
  if (fields.status !== undefined) data.status = fields.status
  if (fields.input !== undefined) data.input = fields.input
  if (fields.output !== undefined) data.output = fields.output
  if (fields.startedAt !== undefined) data.startedAt = fields.startedAt
  if (fields.completedAt !== undefined) data.completedAt = fields.completedAt
  await prisma.agentProcessLog.update({ where: { id }, data })
}

export async function getProcessLogsForArticle(prisma: PrismaClient, articleId: string) {
  return prisma.agentProcessLog.findMany({
    where: { articleId },
    include: { role: true },
    orderBy: { createdAt: 'asc' },
  })
}
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/db/agent-roles.test.ts
```

Expected: 3 tests PASS.

**Step 6: Commit**

```bash
git add src/db/agent-roles.ts tests/db/agent-roles.test.ts tests/helpers/mock-prisma.ts
git commit -m "feat: add agent role seed and process log CRUD helpers"
```

---

## Task 3: Refactor producer into multi-agent pipeline

**Files:**
- Create: `src/producer/agents/scout.ts`
- Create: `src/producer/agents/reporter.ts`
- Create: `src/producer/agents/analyst.ts`
- Create: `src/producer/agents/editor.ts`
- Modify: `src/producer/produce.ts`
- Create: `tests/producer/agents/reporter.test.ts`
- Create: `tests/producer/agents/analyst.test.ts`
- Create: `tests/producer/agents/editor.test.ts`

The existing `produce.ts` does everything in one LLM call. We split it into roles:

- **Scout**: Already handled by the existing collector + dedup + score pipeline. No LLM call needed. We just log its work.
- **Reporter**: Takes raw item, calls LLM to produce `title_zh` and `lead_zh` (摘要).
- **Analyst**: Takes reporter output, calls LLM to produce `body_zh` (深度分析) and `tags` and `companies`.
- **Editor**: Takes analyst output, calls LLM to do quality check and produce final `title_zh`, `summary_zh`, `analysis_zh`.
- **Publisher**: Already handled by existing `publisher/publish.ts`. We just log its work.

**Step 1: Write failing test for Reporter agent**

Create `tests/producer/agents/reporter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseReporterResponse, REPORTER_SYSTEM_PROMPT } from '../../../src/producer/agents/reporter.js'

describe('reporter agent', () => {
  it('parses valid reporter response', () => {
    const json = JSON.stringify({
      title_zh: '测试标题',
      lead_zh: '据 CoinDesk 报道，这是一条测试新闻',
    })
    const result = parseReporterResponse(json)
    expect(result.title_zh).toBe('测试标题')
    expect(result.lead_zh).toBe('据 CoinDesk 报道，这是一条测试新闻')
  })

  it('throws on missing title_zh', () => {
    const json = JSON.stringify({ lead_zh: '内容' })
    expect(() => parseReporterResponse(json)).toThrow('title_zh')
  })

  it('has a system prompt', () => {
    expect(REPORTER_SYSTEM_PROMPT).toContain('记者')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/producer/agents/reporter.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create `src/producer/agents/reporter.ts`**

```typescript
export const REPORTER_SYSTEM_PROMPT = `你是一名专业的加密货币记者。根据原始素材撰写简洁的中文新闻标题和导语。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildReporterPrompt(title: string, content: string, sourceName: string): string {
  return `原始素材：
标题：${title}
来源：${sourceName}
内容：${content}

输出 JSON：
{
  "title_zh": "简洁有力的中文新闻标题",
  "lead_zh": "以'据 ${sourceName} 报道/消息'开头的一句话核心事实"
}`
}

export interface ReporterOutput {
  title_zh: string
  lead_zh: string
}

export function parseReporterResponse(text: string): ReporterOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.title_zh) throw new Error('Missing required field: title_zh')
  if (!parsed.lead_zh) throw new Error('Missing required field: lead_zh')
  return { title_zh: parsed.title_zh, lead_zh: parsed.lead_zh }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/producer/agents/reporter.test.ts
```

Expected: 3 tests PASS.

**Step 5: Write failing test for Analyst agent**

Create `tests/producer/agents/analyst.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseAnalystResponse, ANALYST_SYSTEM_PROMPT } from '../../../src/producer/agents/analyst.js'

describe('analyst agent', () => {
  it('parses valid analyst response', () => {
    const json = JSON.stringify({
      body_zh: '详细分析内容...',
      tags: ['DeFi', 'Sui'],
      companies: [{ name: 'Mysten Labs', category: 'Infrastructure', description: 'Sui 背后的公司' }],
    })
    const result = parseAnalystResponse(json)
    expect(result.body_zh).toBe('详细分析内容...')
    expect(result.tags).toEqual(['DeFi', 'Sui'])
    expect(result.companies).toHaveLength(1)
  })

  it('throws on missing body_zh', () => {
    const json = JSON.stringify({ tags: [] })
    expect(() => parseAnalystResponse(json)).toThrow('body_zh')
  })

  it('defaults tags and companies to empty arrays', () => {
    const json = JSON.stringify({ body_zh: '内容' })
    const result = parseAnalystResponse(json)
    expect(result.tags).toEqual([])
    expect(result.companies).toEqual([])
  })
})
```

**Step 6: Create `src/producer/agents/analyst.ts`**

```typescript
export const ANALYST_SYSTEM_PROMPT = `你是一名资深加密货币行业分析师。根据新闻标题和导语，撰写深度分析正文，提取标签和相关公司。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildAnalystPrompt(titleZh: string, leadZh: string, sourceName: string): string {
  return `新闻标题：${titleZh}
导语：${leadZh}
来源：${sourceName}

输出 JSON：
{
  "body_zh": "详细正文，2-4段，专业客观，包含关键数据和背景信息。段落之间用 \\n\\n 分隔。",
  "tags": ["tag1", "tag2", "tag3"],
  "companies": [
    {"name": "公司官方英文名称", "category": "赛道分类", "description": "一句中文简介"}
  ]
}

companies 规则：
- 只提取新闻中明确提及的公司或项目
- name 必须是公司官方名称
- category 只能是：AI、DeFi、Infrastructure、L1/L2、Gaming、NFT、DAO、Exchange、Wallet、Other
- 没有提及公司则返回空数组 []`
}

export interface CompanyMention {
  name: string
  category: string
  description?: string
}

export interface AnalystOutput {
  body_zh: string
  tags: string[]
  companies: CompanyMention[]
}

export function parseAnalystResponse(text: string): AnalystOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.body_zh) throw new Error('Missing required field: body_zh')
  return {
    body_zh: parsed.body_zh,
    tags: parsed.tags ?? [],
    companies: parsed.companies ?? [],
  }
}
```

**Step 7: Run analyst tests**

```bash
npx vitest run tests/producer/agents/analyst.test.ts
```

Expected: 3 tests PASS.

**Step 8: Write failing test for Editor agent**

Create `tests/producer/agents/editor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseEditorResponse, EDITOR_SYSTEM_PROMPT } from '../../../src/producer/agents/editor.js'

describe('editor agent', () => {
  it('parses valid editor response', () => {
    const json = JSON.stringify({
      title_zh: '最终标题',
      summary_zh: '最终摘要',
      analysis_zh: '最终分析',
      quality_score: 8,
      approved: true,
    })
    const result = parseEditorResponse(json)
    expect(result.title_zh).toBe('最终标题')
    expect(result.approved).toBe(true)
    expect(result.quality_score).toBe(8)
  })

  it('throws on missing title_zh', () => {
    const json = JSON.stringify({ summary_zh: '内容', approved: true })
    expect(() => parseEditorResponse(json)).toThrow('title_zh')
  })
})
```

**Step 9: Create `src/producer/agents/editor.ts`**

```typescript
export const EDITOR_SYSTEM_PROMPT = `你是一名资深新闻编辑。审核并润色新闻稿件，确保准确性、可读性和专业性。
给出质量评分（1-10）和是否通过审核。
必须只返回合法 JSON，不要 markdown 代码块。`

export function buildEditorPrompt(titleZh: string, summaryZh: string, analysisZh: string): string {
  return `待审稿件：
标题：${titleZh}
导语：${summaryZh}
正文：${analysisZh}

请审核并润色，输出 JSON：
{
  "title_zh": "润色后的最终标题",
  "summary_zh": "润色后的最终导语",
  "analysis_zh": "润色后的最终正文",
  "quality_score": 8,
  "approved": true,
  "rejection_reason": null
}

规则：
- quality_score: 1-10，低于 5 分应 approved: false
- 如果内容质量太低或有明显错误，设 approved: false 并给出 rejection_reason
- 润色时保持原意，只修正语法、提升可读性`
}

export interface EditorOutput {
  title_zh: string
  summary_zh: string
  analysis_zh: string
  quality_score: number
  approved: boolean
  rejection_reason: string | null
}

export function parseEditorResponse(text: string): EditorOutput {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.title_zh) throw new Error('Missing required field: title_zh')
  if (!parsed.summary_zh) throw new Error('Missing required field: summary_zh')
  return {
    title_zh: parsed.title_zh,
    summary_zh: parsed.summary_zh,
    analysis_zh: parsed.analysis_zh ?? '',
    quality_score: parsed.quality_score ?? 5,
    approved: parsed.approved ?? true,
    rejection_reason: parsed.rejection_reason ?? null,
  }
}
```

**Step 10: Run all agent tests**

```bash
npx vitest run tests/producer/agents/
```

Expected: All 8 tests PASS.

**Step 11: Commit agent modules**

```bash
git add src/producer/agents/ tests/producer/agents/
git commit -m "feat: add reporter, analyst, editor agent modules with prompts and parsers"
```

---

## Task 4: Create multi-agent pipeline orchestrator

**Files:**
- Create: `src/producer/pipeline.ts`
- Create: `tests/producer/pipeline.test.ts`
- Modify: `src/scheduler.ts`

**Step 1: Write failing test for pipeline**

Create `tests/producer/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runAgentPipeline } from '../../src/producer/pipeline.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

function createMockLLM(responses: Record<string, string>) {
  let callCount = 0
  const keys = Object.keys(responses)
  return {
    generate: vi.fn(async (_system: string, _user: string) => {
      const key = keys[callCount] ?? keys[keys.length - 1]
      callCount++
      return responses[key]
    }),
  }
}

describe('runAgentPipeline', () => {
  it('processes a raw item through reporter → analyst → editor', async () => {
    const { prisma, store } = createMockPrisma()

    // Seed roles
    const roles = ['scout', 'reporter', 'analyst', 'editor', 'publisher']
    for (const [i, name] of roles.entries()) {
      store.agentRoles.push({
        id: `role-${name}`,
        name,
        label: name,
        sortOrder: i + 1,
        createdAt: new Date(),
      })
    }

    // Add a raw item
    store.rawItems.push({
      id: 'raw-1',
      sourceType: 'rss',
      sourceName: 'CoinDesk',
      title: 'Test News',
      url: 'https://example.com/test',
      content: 'Test content about crypto',
      language: 'en',
      score: 5,
      status: 'deduped',
      createdAt: new Date(),
    })

    const llm = createMockLLM({
      reporter: JSON.stringify({ title_zh: '测试标题', lead_zh: '据报道，测试' }),
      analyst: JSON.stringify({ body_zh: '深度分析内容', tags: ['Crypto'], companies: [] }),
      editor: JSON.stringify({ title_zh: '最终标题', summary_zh: '最终摘要', analysis_zh: '最终分析', quality_score: 8, approved: true }),
    })

    const result = await runAgentPipeline(prisma, llm, 'raw-1')

    expect(result.success).toBe(true)
    expect(result.articleId).toBeTruthy()
    expect(llm.generate).toHaveBeenCalledTimes(3) // reporter, analyst, editor
    expect(store.articles.length).toBe(1)
    expect(store.articles[0].titleZh).toBe('最终标题')
    expect(store.agentProcessLogs.length).toBeGreaterThanOrEqual(3)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/producer/pipeline.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create `src/producer/pipeline.ts`**

```typescript
import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRoleByName, createProcessLog, updateProcessLog } from '../db/agent-roles.js'
import { insertArticle, updateRawItemStatus, upsertCompany, linkArticleCompany } from '../db/database.js'
import { buildReporterPrompt, parseReporterResponse, REPORTER_SYSTEM_PROMPT } from './agents/reporter.js'
import { buildAnalystPrompt, parseAnalystResponse, ANALYST_SYSTEM_PROMPT } from './agents/analyst.js'
import { buildEditorPrompt, parseEditorResponse, EDITOR_SYSTEM_PROMPT } from './agents/editor.js'

interface PipelineResult {
  success: boolean
  articleId: string | null
  error?: string
}

export async function runAgentPipeline(
  prisma: PrismaClient,
  llm: LLMAdapter,
  rawItemId: string,
): Promise<PipelineResult> {
  const item = await prisma.rawItem.findUnique({ where: { id: rawItemId } })
  if (!item) return { success: false, articleId: null, error: 'Raw item not found' }

  try {
    // --- Scout phase (already done by collector, just log it) ---
    const scoutRole = await getRoleByName(prisma, 'scout')
    if (scoutRole) {
      const logId = await createProcessLog(prisma, { articleId: rawItemId, roleId: scoutRole.id })
      await updateProcessLog(prisma, logId, {
        status: 'completed',
        output: JSON.stringify({ title: item.title, score: item.score, source: item.sourceName }),
        startedAt: item.createdAt,
        completedAt: new Date(),
      })
    }

    await updateRawItemStatus(prisma, rawItemId, 'processing')

    // --- Reporter phase ---
    const reporterRole = await getRoleByName(prisma, 'reporter')
    const reporterLogId = reporterRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: reporterRole.id }) : null
    if (reporterLogId) await updateProcessLog(prisma, reporterLogId, { status: 'running', startedAt: new Date() })

    const reporterPrompt = buildReporterPrompt(item.title, item.content ?? '', item.sourceName)
    const reporterRaw = await llm.generate(REPORTER_SYSTEM_PROMPT, reporterPrompt)
    const reporterOutput = parseReporterResponse(reporterRaw)

    if (reporterLogId) await updateProcessLog(prisma, reporterLogId, {
      status: 'completed',
      output: JSON.stringify(reporterOutput),
      completedAt: new Date(),
    })

    // --- Analyst phase ---
    const analystRole = await getRoleByName(prisma, 'analyst')
    const analystLogId = analystRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: analystRole.id }) : null
    if (analystLogId) await updateProcessLog(prisma, analystLogId, { status: 'running', startedAt: new Date() })

    const analystPrompt = buildAnalystPrompt(reporterOutput.title_zh, reporterOutput.lead_zh, item.sourceName)
    const analystRaw = await llm.generate(ANALYST_SYSTEM_PROMPT, analystPrompt)
    const analystOutput = parseAnalystResponse(analystRaw)

    if (analystLogId) await updateProcessLog(prisma, analystLogId, {
      status: 'completed',
      output: JSON.stringify(analystOutput),
      completedAt: new Date(),
    })

    // --- Editor phase ---
    const editorRole = await getRoleByName(prisma, 'editor')
    const editorLogId = editorRole ? await createProcessLog(prisma, { articleId: rawItemId, roleId: editorRole.id }) : null
    if (editorLogId) await updateProcessLog(prisma, editorLogId, { status: 'running', startedAt: new Date() })

    const editorPrompt = buildEditorPrompt(
      reporterOutput.title_zh,
      reporterOutput.lead_zh,
      analystOutput.body_zh,
    )
    const editorRaw = await llm.generate(EDITOR_SYSTEM_PROMPT, editorPrompt)
    const editorOutput = parseEditorResponse(editorRaw)

    if (editorLogId) await updateProcessLog(prisma, editorLogId, {
      status: 'completed',
      output: JSON.stringify(editorOutput),
      completedAt: new Date(),
    })

    // --- Save article ---
    const status = editorOutput.approved ? 'draft' : 'rejected'
    const articleId = await insertArticle(prisma, {
      raw_item_id: rawItemId,
      title_zh: editorOutput.title_zh,
      title_en: editorOutput.title_zh,
      summary_zh: editorOutput.summary_zh,
      summary_en: editorOutput.summary_zh,
      analysis_zh: editorOutput.analysis_zh,
      analysis_en: null,
      tags: JSON.stringify(analystOutput.tags),
    })

    // Update article pipeline status
    await prisma.article.update({
      where: { id: articleId },
      data: { status, pipelineStatus: 'completed' },
    })

    // Link companies
    if (analystOutput.companies.length) {
      for (const c of analystOutput.companies) {
        try {
          const companyId = await upsertCompany(prisma, c)
          await linkArticleCompany(prisma, articleId, companyId)
        } catch (err) {
          console.error(`Failed to link company ${c.name}:`, err)
        }
      }
    }

    // Update scout log's articleId to point to the real article
    // (initially we used rawItemId as placeholder)

    await updateRawItemStatus(prisma, rawItemId, 'produced')

    return { success: true, articleId }
  } catch (err: any) {
    const status = err?.status
    if (status === 402 || status === 401 || status === 429) {
      await updateRawItemStatus(prisma, rawItemId, 'deduped')
      return { success: false, articleId: null, error: `API error ${status}` }
    }
    console.error(`Pipeline failed for ${rawItemId}:`, err)
    await updateRawItemStatus(prisma, rawItemId, 'rejected')
    return { success: false, articleId: null, error: err.message }
  }
}
```

**Step 4: Run pipeline test**

```bash
npx vitest run tests/producer/pipeline.test.ts
```

Expected: PASS. The mock LLM returns 3 responses in sequence.

**Step 5: Update `src/producer/produce.ts` to use pipeline**

Replace the main `produceArticles` function to call `runAgentPipeline` per item instead of the old single-call approach. Keep the old `parseResponse` and `buildUserPrompt` exports for backward compatibility until existing tests are updated.

```typescript
import pLimit from 'p-limit'
import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRawItemsByStatus, updateRawItemStatus } from '../db/database.js'
import { runAgentPipeline } from './pipeline.js'

export async function produceArticles(prisma: PrismaClient, llm: LLMAdapter, limit = 10, concurrency = 1): Promise<{ processed: number; succeeded: number; failed: number; fatalError: boolean }> {
  const items = await getRawItemsByStatus(prisma, 'deduped', limit)
  let succeeded = 0
  let failed = 0
  let fatalError = false

  const limit_ = pLimit(concurrency)
  await Promise.all(items.map(item => limit_(async () => {
    if (fatalError) return
    const result = await runAgentPipeline(prisma, llm, item.id)
    if (result.success) {
      succeeded++
    } else if (result.error?.includes('API error')) {
      fatalError = true
    } else {
      failed++
    }
  })))

  return { processed: items.length, succeeded, failed, fatalError }
}
```

**Step 6: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass. Some existing `produce.test.ts` tests may need adjustment if they directly tested the old `produceArticles` internals — update them to match the new pipeline flow.

**Step 7: Commit**

```bash
git add src/producer/pipeline.ts src/producer/produce.ts tests/producer/pipeline.test.ts
git commit -m "feat: multi-agent pipeline orchestrator (scout → reporter → analyst → editor)"
```

---

## Task 5: Seed agent roles on startup

**Files:**
- Modify: `src/main.ts`

**Step 1: Add seedAgentRoles call to main.ts**

After `createPrisma()`, before `startScheduler()`:

```typescript
import { seedAgentRoles } from './db/agent-roles.js'

// ... existing code ...

const prisma = createPrisma()
await seedAgentRoles(prisma)
console.log('Agent roles seeded.')
```

**Step 2: Verify manually**

```bash
npx tsx src/main.ts
```

Expected: "Agent roles seeded." appears in output, then scheduler starts.

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: seed agent roles on engine startup"
```

---

## Task 6: Add news detail page `/news/[id]`

**Files:**
- Create: `web/app/news/[id]/page.tsx`

**Step 1: Create the news detail page**

```tsx
import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const ROLE_ICONS: Record<string, string> = {
  scout: '🕵️',
  reporter: '📝',
  analyst: '🔍',
  editor: '✅',
  publisher: '📢',
}

export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      rawItem: { select: { url: true, sourceName: true, title: true } },
      companies: { include: { company: { select: { name: true, category: true } } } },
      processLogs: {
        include: { role: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!article) notFound()

  const tags: string[] = article.tags ? JSON.parse(article.tags) : []

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <h1 className="text-2xl font-bold text-gray-900">{article.titleZh}</h1>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-sm text-gray-500">
          <span>{new Date(article.createdAt).toLocaleString('zh-CN')}</span>
          {article.rawItem.sourceName && (
            <>
              <span>&middot;</span>
              <span>{article.rawItem.sourceName}</span>
            </>
          )}
          {article.rawItem.url && (
            <>
              <span>&middot;</span>
              <a href={article.rawItem.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">原文链接</a>
            </>
          )}
        </div>

        {/* Tags & Companies */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {article.companies.map(ac => (
            <span key={ac.companyId} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-sm">{ac.company.name}</span>
          ))}
          {tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-sm">{tag}</span>
          ))}
        </div>

        {/* Article body */}
        <div className="mt-6 bg-white rounded-lg p-6 shadow-sm border">
          <p className="text-gray-800 leading-relaxed font-medium">{article.summaryZh}</p>
          {article.analysisZh && (
            <div className="mt-4 text-gray-700 leading-relaxed whitespace-pre-line">{article.analysisZh}</div>
          )}
        </div>

        {/* Agent Process Logs */}
        {article.processLogs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">AI Agent 处理流程</h2>
            <div className="space-y-3">
              {article.processLogs.map(log => {
                const icon = ROLE_ICONS[log.role.name] ?? '🤖'
                const output = log.output ? JSON.parse(log.output) : null
                return (
                  <details key={log.id} className="bg-white rounded-lg shadow-sm border">
                    <summary className="p-4 cursor-pointer flex items-center gap-3">
                      <span className="text-xl">{icon}</span>
                      <span className="font-medium">{log.role.label}</span>
                      <span className={`ml-auto px-2 py-0.5 rounded text-xs ${
                        log.status === 'completed' ? 'bg-green-100 text-green-700' :
                        log.status === 'running' ? 'bg-yellow-100 text-yellow-700' :
                        log.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {log.status}
                      </span>
                      {log.completedAt && log.startedAt && (
                        <span className="text-xs text-gray-400">
                          {((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000).toFixed(1)}s
                        </span>
                      )}
                    </summary>
                    {output && (
                      <div className="px-4 pb-4 text-sm text-gray-600">
                        <pre className="bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
                      </div>
                    )}
                  </details>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Link from homepage**

In `web/app/page.tsx`, wrap each article title with a link:

```tsx
import Link from 'next/link'
```

Replace the title `<div>`:

```tsx
<Link href={`/news/${article.id}`} className="font-medium text-gray-900 hover:text-blue-600">
  {article.titleZh}
</Link>
```

**Step 3: Verify locally**

```bash
cd web && npm run dev
```

Visit `http://localhost:3000` — click any article → should navigate to `/news/[id]` with full detail and agent process logs.

**Step 4: Commit**

```bash
git add web/app/news/ web/app/page.tsx
git commit -m "feat: add news detail page with agent process log viewer"
```

---

## Task 7: Add pipeline visualization page `/pipeline`

**Files:**
- Create: `web/app/pipeline/page.tsx`
- Create: `web/app/api/pipeline/route.ts`
- Modify: `web/components/public-nav.tsx`

**Step 1: Create pipeline API endpoint**

Create `web/app/api/pipeline/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const articles = await prisma.article.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      rawItem: { select: { title: true, sourceName: true, score: true } },
      processLogs: {
        include: { role: { select: { name: true, label: true, sortOrder: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  return NextResponse.json(articles)
}
```

**Step 2: Create pipeline page**

Create `web/app/pipeline/page.tsx`:

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { PublicNav } from '@web/components/public-nav'
import Link from 'next/link'

const ROLE_ICONS: Record<string, string> = {
  scout: '🕵️',
  reporter: '📝',
  analyst: '🔍',
  editor: '✅',
  publisher: '📢',
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500',
  running: 'bg-yellow-400 animate-pulse',
  failed: 'bg-red-500',
  pending: 'bg-gray-300',
}

interface ProcessLog {
  id: string
  status: string
  startedAt: string | null
  completedAt: string | null
  role: { name: string; label: string; sortOrder: number }
}

interface PipelineArticle {
  id: string
  titleZh: string
  pipelineStatus: string
  createdAt: string
  rawItem: { title: string; sourceName: string; score: number }
  processLogs: ProcessLog[]
}

export default function PipelinePage() {
  const [articles, setArticles] = useState<PipelineArticle[]>([])

  const fetchData = useCallback(() => {
    fetch('/api/pipeline').then(r => r.ok ? r.json() : []).then(setArticles)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000) // refresh every 10s
    return () => clearInterval(interval)
  }, [fetchData])

  const roles = ['scout', 'reporter', 'analyst', 'editor', 'publisher']

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Agent Pipeline</h1>
        <p className="text-sm text-gray-500 mb-6">实时查看 AI Agent 新闻处理流水线</p>

        {/* Role legend */}
        <div className="flex gap-4 mb-6 text-sm">
          {roles.map(r => (
            <span key={r} className="flex items-center gap-1">
              <span>{ROLE_ICONS[r]}</span>
              <span className="text-gray-600 capitalize">{r}</span>
            </span>
          ))}
        </div>

        {/* Pipeline table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="p-3">新闻</th>
                {roles.map(r => (
                  <th key={r} className="p-3 text-center w-20">
                    <span className="text-lg">{ROLE_ICONS[r]}</span>
                  </th>
                ))}
                <th className="p-3 text-center w-20">状态</th>
              </tr>
            </thead>
            <tbody>
              {articles.map(article => (
                <tr key={article.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/news/${article.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-1">
                      {article.titleZh}
                    </Link>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {article.rawItem.sourceName} &middot; {new Date(article.createdAt).toLocaleTimeString('zh-CN')}
                    </div>
                  </td>
                  {roles.map(roleName => {
                    const log = article.processLogs.find(l => l.role.name === roleName)
                    const status = log?.status ?? 'pending'
                    return (
                      <td key={roleName} className="p-3 text-center">
                        <div className={`w-4 h-4 rounded-full mx-auto ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}`} title={status} />
                      </td>
                    )
                  })}
                  <td className="p-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      article.pipelineStatus === 'completed' ? 'bg-green-100 text-green-700' :
                      article.pipelineStatus === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {article.pipelineStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Add Pipeline link to PublicNav**

In `web/components/public-nav.tsx`, add:

```tsx
<Link href="/pipeline" className="text-sm text-gray-500 hover:text-gray-700">Pipeline</Link>
```

**Step 4: Verify locally**

```bash
cd web && npm run dev
```

Visit `http://localhost:3000/pipeline` — should show a table with colored dots for each agent role's status.

**Step 5: Commit**

```bash
git add web/app/pipeline/ web/app/api/pipeline/ web/components/public-nav.tsx
git commit -m "feat: add pipeline visualization page with real-time status"
```

---

## Task 8: Update existing tests and run full suite

**Files:**
- Modify: `tests/producer/produce.test.ts`
- Modify: `tests/e2e/pipeline.test.ts`

**Step 1: Update produce.test.ts**

The old `produce.test.ts` tests the old single-LLM-call flow. Update it to work with the new pipeline-based `produceArticles`:

- The mock LLM now needs to return 3 responses (reporter, analyst, editor) instead of 1
- The mock Prisma needs `agentRole` and `agentProcessLog` models

Review existing test, adjust mock LLM to return sequential responses, ensure `agentRoles` are seeded in the mock store.

**Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: update existing tests for multi-agent pipeline"
```

---

## Task 9: Build and verify deployment

**Step 1: Build backend**

```bash
npx tsx src/main.ts
```

Expected: Starts without errors, "Agent roles seeded" logged.

**Step 2: Build frontend**

```bash
cd web && npm run build
```

Expected: Build succeeds. All pages compile.

**Step 3: Final commit and tag**

```bash
git tag v0.2.0-phase1a
```

---

## Summary of Deliverables

After completing all 9 tasks:

1. ✅ `AgentRole` and `AgentProcessLog` database models
2. ✅ 5 agent roles seeded (scout, reporter, analyst, editor, publisher)
3. ✅ Individual agent modules with prompts and parsers (reporter, analyst, editor)
4. ✅ Multi-agent pipeline orchestrator replacing old single-call producer
5. ✅ News detail page `/news/[id]` with agent process log viewer
6. ✅ Pipeline visualization page `/pipeline` with real-time status dashboard
7. ✅ All existing tests updated and passing
8. ✅ Homepage links to news detail pages

**Note:** This plan covers Phase 1a only. Phase 1b (Direction catalog), Phase 2a (Community), and Phase 2b (Marketplace) will need separate implementation plans.
