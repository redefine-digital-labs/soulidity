# 技能目录页 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在导航栏新增技能页面，展示 openclaw/openclaw GitHub 仓库中的所有技能，每天零点定时扫描同步。

**Architecture:** 新增 Prisma Skill 模型存储技能数据。后端 scan-skills 脚本通过 GitHub API 拉取 skills 目录，解析 SKILL.md frontmatter，upsert 到数据库。前端 /skills 页面通过 API 读取并展示为可搜索的卡片网格，点击跳转 GitHub。

**Tech Stack:** Prisma ORM, Node.js fetch, Next.js App Router, TailwindCSS + CSS Variables

---

## Task 1: Prisma Schema — 新增 Skill 模型

**Files:**
- Modify: `prisma/schema.prisma:309` (文件末尾追加)

**Step 1: 添加 Skill 模型**

在 `prisma/schema.prisma` 文件末尾追加：

```prisma
model Skill {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @unique
  description String
  emoji       String   @default("🔧")
  githubUrl   String   @map("github_url")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("skills")
}
```

**Step 2: 生成并应用 migration**

Run: `cd /Users/admin/Desktop/nao/clawnews && npx prisma migrate dev --name add-skill-model`

Expected: Migration 成功，生成新的 migration 文件。

**Step 3: 重新生成 Prisma Client**

Run: `npx prisma generate`

Expected: Prisma Client 重新生成，包含 Skill 模型。

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: 新增 Skill 模型用于存储 GitHub 技能数据"
```

---

## Task 2: 技能扫描脚本

**Files:**
- Create: `src/collector/scan-skills.ts`

**Step 1: 创建扫描脚本**

创建 `src/collector/scan-skills.ts`：

```ts
import type { PrismaClient } from '../db/database.js'

const REPO_API = 'https://api.github.com/repos/openclaw/openclaw/contents/skills'
const GITHUB_BASE = 'https://github.com/openclaw/openclaw/tree/main/skills'

interface GitHubContent {
  name: string
  type: string
  url: string
}

interface GitHubFile {
  content: string
  encoding: string
}

function parseFrontmatter(raw: string): { name: string; description: string; emoji: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '', emoji: '🔧' }

  const fm = match[1]

  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*(.+)$/m)

  let emoji = '🔧'
  const metaMatch = fm.match(/^metadata:\s*(.+)$/m)
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1])
      if (meta?.openclaw?.emoji) emoji = meta.openclaw.emoji
    } catch {}
  }

  return {
    name: nameMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    emoji,
  }
}

export async function scanSkills(prisma: PrismaClient): Promise<{ synced: number; removed: number }> {
  console.log(`[${new Date().toISOString()}] Scanning GitHub skills...`)

  // Step 1: List all skill directories
  const res = await fetch(REPO_API, {
    headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CryptoOpenClaw' },
  })
  if (!res.ok) {
    console.error(`GitHub API error: ${res.status} ${res.statusText}`)
    return { synced: 0, removed: 0 }
  }

  const contents: GitHubContent[] = await res.json()
  const dirs = contents.filter(c => c.type === 'dir')

  // Step 2: Fetch each SKILL.md and parse frontmatter
  const skills: { name: string; description: string; emoji: string; githubUrl: string }[] = []

  for (const dir of dirs) {
    try {
      const fileRes = await fetch(`${REPO_API}/${dir.name}/SKILL.md`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CryptoOpenClaw' },
      })
      if (!fileRes.ok) continue

      const file: GitHubFile = await fileRes.json()
      const content = Buffer.from(file.content, 'base64').toString('utf-8')
      const parsed = parseFrontmatter(content)

      skills.push({
        name: parsed.name || dir.name,
        description: parsed.description || `${dir.name} skill`,
        emoji: parsed.emoji,
        githubUrl: `${GITHUB_BASE}/${dir.name}`,
      })
    } catch (err) {
      console.error(`Failed to fetch SKILL.md for ${dir.name}:`, err)
    }
  }

  // Step 3: Upsert all skills
  let synced = 0
  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { name: skill.name },
      create: skill,
      update: {
        description: skill.description,
        emoji: skill.emoji,
        githubUrl: skill.githubUrl,
      },
    })
    synced++
  }

  // Step 4: Remove skills no longer on GitHub
  const skillNames = skills.map(s => s.name)
  const removed = await prisma.skill.deleteMany({
    where: { name: { notIn: skillNames } },
  })

  console.log(`Skills sync done: synced ${synced}, removed ${removed.count}`)
  return { synced, removed: removed.count }
}

// CLI entry point
if (process.argv[1]?.endsWith('scan-skills.ts') || process.argv[1]?.endsWith('scan-skills.js')) {
  await import('dotenv/config')
  const { createPrisma } = await import('../db/database.js')
  const prisma = createPrisma()
  await scanSkills(prisma)
  await prisma.$disconnect()
}
```

**Step 2: Commit**

```bash
git add src/collector/scan-skills.ts
git commit -m "feat: 新增 GitHub 技能扫描脚本"
```

---

## Task 3: 注册 Cron 任务 + package.json 脚本

**Files:**
- Modify: `src/scheduler.ts:1-10` (imports 区域)
- Modify: `src/scheduler.ts:87-95` (scheduler 末尾)
- Modify: `package.json:15` (scripts 末尾)

**Step 1: 在 scheduler.ts 添加 import**

在 `src/scheduler.ts` 顶部 imports 中，在 `import type { LLMAdapter } from './producer/llm.js'` 后面追加：

```ts
import { scanSkills } from './collector/scan-skills.js'
```

**Step 2: 在 startScheduler 函数中注册 cron 任务**

在 `src/scheduler.ts` 的 `startScheduler` 函数中，在最后一个 `cron.schedule('*/5 * * * *', ...)` 块之后，`console.log('Scheduler started...')` 之前，追加：

```ts
  cron.schedule('0 0 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running skills scan...`)
    try {
      await scanSkills(prisma)
    } catch (err) {
      console.error('Skills scan failed:', err)
    }
  })
```

**Step 3: 更新 scheduler 日志**

在 `console.log` 调度器日志区域末尾追加：

```ts
  console.log('  Skills scan:         daily at 00:00')
```

**Step 4: 在 package.json 添加脚本**

在 `package.json` 的 `scripts` 中，在 `"seed:achievements"` 后面追加：

```json
"scan:skills": "tsx src/collector/scan-skills.ts"
```

**Step 5: Commit**

```bash
git add src/scheduler.ts package.json
git commit -m "feat: 注册技能扫描每日零点定时任务"
```

---

## Task 4: API 路由

**Files:**
- Create: `web/app/api/skills/route.ts`

**Step 1: 创建技能列表 API**

创建 `web/app/api/skills/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const skills = await prisma.skill.findMany({
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(skills)
}
```

**Step 2: Commit**

```bash
git add web/app/api/skills/
git commit -m "feat: 新增技能列表 API"
```

---

## Task 5: 技能列表页面

**Files:**
- Create: `web/app/skills/page.tsx`

**Step 1: 创建技能列表页**

创建 `web/app/skills/page.tsx`：

```tsx
'use client'

import { useEffect, useState } from 'react'
import { PublicNav } from '@web/components/public-nav'

interface Skill {
  id: string
  name: string
  description: string
  emoji: string
  githubUrl: string
  updatedAt: string
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/skills')
      .then(r => (r.ok ? r.json() : []))
      .then(setSkills)
      .finally(() => setLoading(false))
  }, [])

  const filtered = search
    ? skills.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">OpenClaw 技能</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {loading ? '加载中...' : `共 ${filtered.length} 个技能，每日自动同步自 GitHub`}
          </p>
        </div>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索技能名称或描述..."
            className="input-dark"
            style={{ maxWidth: '20rem' }}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>暂无匹配技能</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {filtered.map(skill => (
              <a
                key={skill.id}
                href={skill.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card p-5 transition-all hover:scale-[1.02] hover:shadow-lg"
                style={{ textDecoration: 'none' }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{skill.emoji}</span>
                  <h2 className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {skill.name}
                  </h2>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {skill.description.length > 120 ? skill.description.slice(0, 120) + '...' : skill.description}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/skills/
git commit -m "feat: 新增技能列表页面"
```

---

## Task 6: 导航栏添加技能入口

**Files:**
- Modify: `web/components/public-nav.tsx:7-12`

**Step 1: 在 links 数组末尾追加技能链接**

修改 `web/components/public-nav.tsx`，在 links 数组中 `{ href: '/knowledge', label: '知识库' }` 后面追加：

```ts
  { href: '/skills', label: '技能' },
```

完整 links 数组应为：

```ts
const links = [
  { href: '/', label: '新闻' },
  { href: '/directions', label: '养成方向' },
  { href: '/community', label: '社区' },
  { href: '/knowledge', label: '知识库' },
  { href: '/skills', label: '技能' },
]
```

**Step 2: Commit**

```bash
git add web/components/public-nav.tsx
git commit -m "feat: 导航栏添加技能入口"
```

---

## Task 7: 手动执行首次同步 + 验证

**Step 1: 执行首次技能扫描**

Run: `cd /Users/admin/Desktop/nao/clawnews && npm run scan:skills`

Expected: 输出 `Skills sync done: synced 52, removed 0`（约 52 个技能）

**Step 2: 启动 dev 服务验证页面**

Run: `cd /Users/admin/Desktop/nao/clawnews/web && npx next dev`

验证：
- 导航栏显示「技能」链接
- 访问 `/skills` 显示技能卡片网格
- 搜索框能过滤技能
- 点击卡片跳转到 GitHub 对应目录

**Step 3: 更新 PRD**

在 `docs/ai-web3-content-community-plan.md` 的页面清单中追加技能页面记录。

**Step 4: Final Commit**

```bash
git add docs/
git commit -m "docs: 更新 PRD 添加技能目录页"
```
