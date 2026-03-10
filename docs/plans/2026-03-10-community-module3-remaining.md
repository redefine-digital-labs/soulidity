# 模块三剩余功能：方向讨论组 + 排行榜 + 互助问答 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成养成社区（模块三）的三个剩余功能：方向讨论组、排行榜、互助问答。

**Architecture:** 复用现有 Post + Comment 模型，Post 新增 `type` 字段区分日志/问答，Comment 新增 `isAccepted` 字段支持采纳回答。方向详情页改为 Tab 结构嵌入讨论/问答。排行榜基于现有数据聚合查询，无需新模型。

**Tech Stack:** Next.js App Router, Prisma ORM, PostgreSQL, TailwindCSS + CSS Variables

---

## Task 1: Prisma Schema — Post 加 type, Comment 加 isAccepted

**Files:**
- Modify: `prisma/schema.prisma:197-230`

**Step 1: 修改 Post 模型，加 type 字段**

在 `prisma/schema.prisma` 的 Post 模型中，`status` 字段后面加：

```prisma
type         String     @default("log") // 'log' | 'question'
```

并新增索引：

```prisma
@@index([type])
```

**Step 2: 修改 Comment 模型，加 isAccepted 字段**

在 Comment 模型的 `content` 字段后面加：

```prisma
isAccepted Boolean  @default(false) @map("is_accepted")
```

**Step 3: 生成并应用 migration**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma migrate dev --name add-post-type-comment-accepted
```

Expected: Migration 成功，生成新的 migration 文件。

**Step 4: 重新生成 Prisma Client**

```bash
npx prisma generate
```

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: Post 新增 type 字段, Comment 新增 isAccepted 字段"
```

---

## Task 2: API — Posts 接口支持 type 筛选

**Files:**
- Modify: `web/app/api/community/posts/route.ts`

**Step 1: GET 增加 type 和 directionId 查询参数**

修改 `web/app/api/community/posts/route.ts` 的 GET handler：

```ts
export async function GET(request: NextRequest) {
  const direction = request.nextUrl.searchParams.get('direction')
  const sort = request.nextUrl.searchParams.get('sort') ?? 'latest'
  const type = request.nextUrl.searchParams.get('type') // 'log' | 'question' | null(全部)
  const directionId = request.nextUrl.searchParams.get('directionId')

  const where: any = { status: 'published' }
  if (direction) {
    where.direction = { slug: direction }
  }
  if (directionId) {
    where.directionId = directionId
  }
  if (type) {
    where.type = type
  }

  const orderBy: any = sort === 'popular' ? { likeCount: 'desc' } : { createdAt: 'desc' }

  const posts = await prisma.post.findMany({
    where,
    orderBy,
    take: 30,
    include: {
      member: { select: { id: true, tgName: true, avatar: true, level: true } },
      direction: { select: { nameZh: true, icon: true, slug: true } },
    },
  })

  return NextResponse.json(posts)
}
```

**Step 2: POST 支持 type 字段**

修改 POST handler，data 中新增：

```ts
type: body.type ?? 'log',
```

**Step 3: 验证**

```bash
curl 'http://localhost:3000/api/community/posts?type=log' | head -c 200
curl 'http://localhost:3000/api/community/posts?type=question' | head -c 200
```

**Step 4: Commit**

```bash
git add web/app/api/community/posts/route.ts
git commit -m "feat: Posts API 支持 type 和 directionId 筛选"
```

---

## Task 3: API — 采纳回答接口

**Files:**
- Create: `web/app/api/community/posts/[id]/comments/[commentId]/accept/route.ts`

**Step 1: 创建采纳回答 API**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id, commentId } = await params
  const body = await request.json()

  if (!body.memberId) {
    return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  }

  // 验证是帖子作者
  const post = await prisma.post.findUnique({ where: { id }, select: { memberId: true, type: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.type !== 'question') return NextResponse.json({ error: 'Only questions can accept answers' }, { status: 400 })
  if (post.memberId !== body.memberId) return NextResponse.json({ error: 'Only author can accept' }, { status: 403 })

  // 取消该帖子下所有已采纳，再采纳指定的
  await prisma.comment.updateMany({ where: { postId: id, isAccepted: true }, data: { isAccepted: false } })
  await prisma.comment.update({ where: { id: commentId }, data: { isAccepted: true } })

  return NextResponse.json({ ok: true })
}
```

**Step 2: Commit**

```bash
git add web/app/api/community/posts/\[id\]/comments/\[commentId\]/
git commit -m "feat: 新增采纳回答 API"
```

---

## Task 4: API — 排行榜接口

**Files:**
- Create: `web/app/api/community/leaderboard/route.ts`

**Step 1: 创建排行榜 API**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const dimension = request.nextUrl.searchParams.get('dimension') ?? 'active'
  const directionId = request.nextUrl.searchParams.get('directionId')

  if (dimension === 'active') {
    // 活跃度：日志数 + 问答数 + 评论数
    const members = await prisma.member.findMany({
      select: {
        id: true,
        tgName: true,
        avatar: true,
        level: true,
        exp: true,
        _count: { select: { posts: true, comments: true } },
      },
      orderBy: { exp: 'desc' },
      take: 20,
    })

    const ranked = members.map((m, i) => ({
      rank: i + 1,
      id: m.id,
      tgName: m.tgName,
      avatar: m.avatar,
      level: m.level,
      score: m._count.posts * 10 + m._count.comments * 3,
      postCount: m._count.posts,
      commentCount: m._count.comments,
    }))
    ranked.sort((a, b) => b.score - a.score)
    ranked.forEach((r, i) => (r.rank = i + 1))

    return NextResponse.json(ranked)
  }

  if (dimension === 'helpful') {
    // 贡献度：被采纳回答数
    const comments = await prisma.comment.groupBy({
      by: ['memberId'],
      where: { isAccepted: true },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    })

    const memberIds = comments.map(c => c.memberId)
    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, tgName: true, avatar: true, level: true },
    })
    const memberMap = new Map(members.map(m => [m.id, m]))

    const ranked = comments.map((c, i) => ({
      rank: i + 1,
      ...memberMap.get(c.memberId),
      acceptedCount: c._count.id,
      score: c._count.id * 20,
    }))

    return NextResponse.json(ranked)
  }

  if (dimension === 'direction' && directionId) {
    // 方向达人：某方向下的 top 贡献者
    const posts = await prisma.post.groupBy({
      by: ['memberId'],
      where: { directionId, status: 'published' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    })

    const memberIds = posts.map(p => p.memberId)
    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, tgName: true, avatar: true, level: true },
    })
    const memberMap = new Map(members.map(m => [m.id, m]))

    const ranked = posts.map((p, i) => ({
      rank: i + 1,
      ...memberMap.get(p.memberId),
      postCount: p._count.id,
      score: p._count.id * 10,
    }))

    return NextResponse.json(ranked)
  }

  return NextResponse.json([])
}
```

**Step 2: Commit**

```bash
git add web/app/api/community/leaderboard/
git commit -m "feat: 新增排行榜 API（活跃度/贡献度/方向达人）"
```

---

## Task 5: 方向详情页改造 — Tab 结构（概览/讨论/问答）

**Files:**
- Modify: `web/app/directions/[category]/[slug]/page.tsx`

**重点：** 这个页面原本是 Server Component，改造后需要变为 Client Component（因为 Tab 切换和数据获取需要 useState/useEffect）。

**Step 1: 改写为 Client Component + Tab 结构**

完整替换 `web/app/directions/[category]/[slug]/page.tsx`：

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface DirectionDetail {
  id: string
  name: string
  nameZh: string
  slug: string
  icon: string
  description: string | null
  descriptionZh: string | null
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

interface PostItem {
  id: string
  title: string
  content: string
  type: string
  likeCount: number
  commentCount: number
  createdAt: string
  member: { id: string; tgName: string | null; avatar: string | null; level: number }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

function levelBadge(level: number): string {
  return ['🥚', '🦐', '🦞', '🦞🦞', '🦞🦞🦞'][level - 1] ?? '🥚'
}

type TabKey = 'overview' | 'discussion' | 'qa'

export default function DirectionDetailPage() {
  const { category, slug } = useParams<{ category: string; slug: string }>()
  const [direction, setDirection] = useState<DirectionDetail | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [posts, setPosts] = useState<PostItem[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  // 加载方向详情
  useEffect(() => {
    fetch(`/api/directions/${slug}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setDirection)
      .finally(() => setLoading(false))
  }, [slug])

  // Tab 切换时加载帖子
  useEffect(() => {
    if (tab === 'overview' || !direction) return
    setPostsLoading(true)
    const type = tab === 'discussion' ? 'log' : 'question'
    fetch(`/api/community/posts?directionId=${direction.id}&type=${type}&sort=latest`)
      .then(r => (r.ok ? r.json() : []))
      .then(setPosts)
      .finally(() => setPostsLoading(false))
  }, [tab, direction])

  if (loading) return <div className="min-h-screen"><PublicNav /><div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div></div>
  if (!direction) return <div className="min-h-screen"><PublicNav /><div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>方向不存在</div></div>

  const description = direction.descriptionZh || direction.description
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'discussion', label: '讨论' },
    { key: 'qa', label: '问答' },
  ]

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm mb-8 animate-fade-up" style={{ color: 'var(--text-muted)' }}>
          <Link href="/directions" className="transition-colors hover:text-[var(--accent-cyan)]">养成方向</Link>
          <span>/</span>
          <Link href={`/directions/${direction.category.name}`} className="transition-colors hover:text-[var(--accent-cyan)]">
            {direction.category.icon} {direction.category.nameZh}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--text-primary)' }}>{direction.nameZh}</span>
        </nav>

        {/* Header card */}
        <div className="glass-panel p-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-4">
            <span className="text-5xl">{direction.icon}</span>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="text-gradient">{direction.nameZh}</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{direction.name}</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>{direction.userCount}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>使用人数</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-amber)' }}>{direction.rating.toFixed(1)}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>评分</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold">{direction.category.icon}</div>
            <div className="text-xs mt-1"><span className="badge badge-cyan">{direction.category.nameZh}</span></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 animate-fade-up" style={{ animationDelay: '150ms', borderBottom: '1px solid var(--border-subtle)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: tab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: tab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && description && (
          <div className="glass-panel p-6 animate-fade-up">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>介绍</h2>
            <p className="whitespace-pre-line" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>{description}</p>
          </div>
        )}

        {(tab === 'discussion' || tab === 'qa') && (
          <div className="animate-fade-up">
            {/* Action bar */}
            <div className="flex justify-end mb-4">
              <Link
                href={`/community/new?direction=${slug}&type=${tab === 'discussion' ? 'log' : 'question'}`}
                className="btn btn-primary text-sm"
              >
                {tab === 'discussion' ? '发布日志' : '提问'}
              </Link>
            </div>

            {postsLoading ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>加载中...</div>
            ) : posts.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                {tab === 'discussion' ? '暂无讨论，来发布第一篇日志吧' : '暂无问题，来提出第一个问题吧'}
              </div>
            ) : (
              <div className="flex flex-col gap-3 stagger-children">
                {posts.map(post => {
                  const displayName = post.member.tgName ?? '匿名'
                  const avatarChar = displayName.charAt(0).toUpperCase()
                  const preview = post.content.length > 100 ? post.content.slice(0, 100) + '…' : post.content

                  return (
                    <div key={post.id} className="glass-card glow-cyan p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                          {avatarChar}
                        </div>
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{displayName}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{levelBadge(post.member.level)}</span>
                        {post.type === 'question' && <span className="ml-auto badge badge-cyan">问答</span>}
                      </div>
                      <Link href={`/community/${post.id}`} className="block font-semibold mb-1 transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {post.type === 'question' ? '❓ ' : ''}{post.title}
                      </Link>
                      {preview && <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>{preview}</p>}
                      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>👍 {post.likeCount}</span>
                        <span>💬 {post.commentCount}</span>
                        <span className="ml-auto data-value">{timeAgo(post.createdAt)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: 需要新增方向详情 API（页面从 Server → Client 需要数据接口）**

Create `web/app/api/directions/[slug]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const direction = await prisma.direction.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  if (!direction) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(direction)
}
```

**Step 3: Commit**

```bash
git add web/app/directions/\[category\]/\[slug\]/page.tsx web/app/api/directions/\[slug\]/
git commit -m "feat: 方向详情页改造为 Tab 结构（概览/讨论/问答）"
```

---

## Task 6: 发帖页支持 type + URL 预填

**Files:**
- Modify: `web/app/community/new/page.tsx`

**Step 1: 增加 type 选择 + URL 参数预填**

在 `NewCommunityPostPage` 中：

1. 从 `useSearchParams()` 读取 `direction` 和 `type` 参数
2. 新增 `postType` state，默认 `'log'`
3. form 中加入「类型」选择（日志 / 问答）
4. POST 请求 body 中加 `type: postType`
5. 根据 `direction` URL 参数预选方向

修改要点：

```tsx
import { useRouter, useSearchParams } from 'next/navigation'

// 在组件内：
const searchParams = useSearchParams()
const [postType, setPostType] = useState(searchParams.get('type') ?? 'log')

// useEffect 中根据 direction slug 预选：
useEffect(() => {
  fetch('/api/directions').then(r => (r.ok ? r.json() : [])).then((data: DirectionOption[]) => {
    setDirections(data)
    const dirSlug = searchParams.get('direction')
    if (dirSlug) {
      const match = data.find((d: any) => d.slug === dirSlug)
      if (match) setDirectionId(match.id)
    }
  })
}, [])

// form 中新增类型选择（在标题之前）：
<div>
  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>类型</label>
  <div className="flex gap-2">
    <button type="button" onClick={() => setPostType('log')}
      className={`filter-pill ${postType === 'log' ? 'filter-pill-active' : ''}`}>
      📝 养成日志
    </button>
    <button type="button" onClick={() => setPostType('question')}
      className={`filter-pill ${postType === 'question' ? 'filter-pill-active' : ''}`}>
      ❓ 互助问答
    </button>
  </div>
</div>

// POST body 中加 type:
const body: Record<string, string> = { memberId, title, content, type: postType }
```

另外：
- 页面标题根据 type 动态显示「发布日志」/「提出问题」
- content placeholder 根据 type 变化

**Step 2: Commit**

```bash
git add web/app/community/new/page.tsx
git commit -m "feat: 发帖页支持日志/问答类型切换 + URL 参数预填"
```

---

## Task 7: 社区首页支持 type 筛选

**Files:**
- Modify: `web/app/community/page.tsx`

**Step 1: 添加子导航栏（全部 / 日志 / 问答 / 排行榜）**

在标题行下方加入 type 筛选 + 排行榜链接：

```tsx
const [postType, setPostType] = useState<string>('') // '' = 全部

// fetch 时传 type
useEffect(() => {
  setLoading(true)
  const params = new URLSearchParams()
  if (activeDirection) params.set('direction', activeDirection)
  if (postType) params.set('type', postType)
  params.set('sort', sort)
  fetch(`/api/community/posts?${params.toString()}`)
    .then(r => (r.ok ? r.json() : []))
    .then(setPosts)
    .finally(() => setLoading(false))
}, [activeDirection, sort, postType])
```

在标题区域右侧，「发布日志」按钮旁边加排行榜链接：

```tsx
<div className="flex items-center gap-3">
  <Link href="/community/leaderboard" className="btn btn-surface text-sm">🏆 排行榜</Link>
  <Link href="/community/new" className="btn btn-primary">发布日志</Link>
</div>
```

在筛选栏中加 type 切换：

```tsx
<div className="flex gap-2">
  {[
    { value: '', label: '全部' },
    { value: 'log', label: '📝 日志' },
    { value: 'question', label: '❓ 问答' },
  ].map(t => (
    <button key={t.value} onClick={() => setPostType(t.value)}
      className={`filter-pill ${postType === t.value ? 'filter-pill-active' : ''}`}>
      {t.label}
    </button>
  ))}
</div>
```

帖子卡片中，对 type=question 的帖子显示问答标签。

**Step 2: Commit**

```bash
git add web/app/community/page.tsx
git commit -m "feat: 社区首页增加日志/问答类型筛选 + 排行榜入口"
```

---

## Task 8: 帖子详情页支持问答展示 + 采纳

**Files:**
- Modify: `web/app/community/[id]/page.tsx`
- Modify: `web/app/api/community/posts/[id]/route.ts`

**Step 1: API 返回 comment 的 isAccepted 字段**

修改 `web/app/api/community/posts/[id]/route.ts`，在 comments include 中加上 `isAccepted`:

```ts
comments: {
  orderBy: { createdAt: 'asc' },
  include: {
    member: { select: { id: true, tgName: true, avatar: true, level: true } },
  },
},
```

确保 select/include 中 isAccepted 被返回（Prisma 默认返回所有标量字段）。

同时返回 post 的 `type` 字段。

**Step 2: 详情页 UI 改造**

修改 `web/app/community/[id]/page.tsx`：

- 如果 `post.type === 'question'`，标题前显示「❓」
- 评论列表中，被采纳的回答（`comment.isAccepted === true`）显示绿色「✅ 已采纳」徽章，排在最前面
- 如果当前用户是帖子作者 且 type=question，每条评论旁显示「采纳」按钮
- 点击采纳按钮调用 `POST /api/community/posts/[id]/comments/[commentId]/accept`

关键 UI 片段：

```tsx
{post.type === 'question' && comment.isAccepted && (
  <span className="badge" style={{ background: 'var(--accent-emerald-dim)', color: 'var(--accent-emerald)' }}>
    ✅ 已采纳
  </span>
)}
```

**Step 3: Commit**

```bash
git add web/app/community/\[id\]/page.tsx web/app/api/community/posts/\[id\]/route.ts
git commit -m "feat: 帖子详情页支持问答类型展示和采纳回答"
```

---

## Task 9: 排行榜页面

**Files:**
- Create: `web/app/community/leaderboard/page.tsx`

**Step 1: 创建排行榜页面**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface RankedMember {
  rank: number
  id: string
  tgName: string | null
  avatar: string | null
  level: number
  score: number
  postCount?: number
  commentCount?: number
  acceptedCount?: number
}

function levelBadge(level: number): string {
  return ['🥚', '🦐', '🦞', '🦞🦞', '🦞🦞🦞'][level - 1] ?? '🥚'
}

type Dimension = 'active' | 'helpful'

export default function LeaderboardPage() {
  const [dimension, setDimension] = useState<Dimension>('active')
  const [members, setMembers] = useState<RankedMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/community/leaderboard?dimension=${dimension}`)
      .then(r => (r.ok ? r.json() : []))
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [dimension])

  const dims: { key: Dimension; label: string }[] = [
    { key: 'active', label: '🔥 活跃度' },
    { key: 'helpful', label: '🤝 贡献度' },
  ]

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 animate-fade-up">
          <div>
            <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="text-gradient">🏆 排行榜</span>
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>社区活跃成员排名</p>
          </div>
          <Link href="/community" className="text-sm transition-colors" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link>
        </div>

        {/* Dimension tabs */}
        <div className="flex gap-2 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          {dims.map(d => (
            <button key={d.key} onClick={() => setDimension(d.key)}
              className={`filter-pill ${dimension === d.key ? 'filter-pill-active' : ''}`}>
              {d.label}
            </button>
          ))}
        </div>

        {/* Rankings */}
        {loading ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>暂无数据</div>
        ) : (
          <div className="flex flex-col gap-2 stagger-children">
            {members.map(m => {
              const displayName = m.tgName ?? '匿名'
              const avatarChar = displayName.charAt(0).toUpperCase()
              const medal = m.rank <= 3 ? ['🥇', '🥈', '🥉'][m.rank - 1] : `#${m.rank}`

              return (
                <div key={m.id} className="glass-card p-4 flex items-center gap-4">
                  <span className="text-lg font-bold w-10 text-center" style={{ fontFamily: 'var(--font-mono)', color: m.rank <= 3 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                    {medal}
                  </span>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    {avatarChar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/u/${m.id}`} className="font-semibold text-sm transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)' }}>
                      {displayName}
                    </Link>
                    <span className="ml-2 text-xs">{levelBadge(m.level)}</span>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {dimension === 'active' && `${m.postCount ?? 0} 帖子 · ${m.commentCount ?? 0} 评论`}
                      {dimension === 'helpful' && `${m.acceptedCount ?? 0} 个回答被采纳`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>{m.score}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>积分</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/community/leaderboard/
git commit -m "feat: 新增排行榜页面（活跃度/贡献度维度）"
```

---

## Task 10: PRD 更新

**Files:**
- Modify: `docs/ai-web3-content-community-plan.md:113-129`

**Step 1: 更新模块三状态**

将模块三标题的 🚧 改为 ✅：

```markdown
## 四、模块三 — 养成社区 ✅
```

更新功能表格：

```markdown
| 功能 | 描述 | 状态 |
|------|------|------|
| 养成日志 | 用户发布自己的 OpenClaw 养成过程和心得，带方向标签 | ✅ 已实现 |
| 评论互动 | 用户可以评论他人的养成日志 | ✅ 已实现 |
| 个人主页 | 展示用户等级、成就、发布的日志 | ✅ 已实现 |
| 成就体系 | 养成里程碑徽章（首次养成、连续30天、达人认证等） | ✅ 模型已建立 |
| 互助问答 | 用户提问，同方向的养成者回答，支持采纳 | ✅ 已实现 |
| 方向讨论组 | 方向详情页内 Tab 形式聚合讨论区 | ✅ 已实现 |
| 排行榜 | 养成活跃度、贡献度排行 | ✅ 已实现 |
```

**Step 2: 更新后续排期，移除社区增强项**

**Step 3: Commit**

```bash
git add docs/ai-web3-content-community-plan.md
git commit -m "docs: 更新 PRD 模块三状态为全部完成"
```

---

## Verification

完成所有 Task 后，按以下步骤验证：

1. **Schema 验证**：`npx prisma validate` 通过
2. **Dev 启动**：`npm run dev` 无报错
3. **方向详情页**：访问 `/directions/[cat]/[slug]`，验证三个 Tab 切换正常
4. **发帖**：从方向讨论 Tab 点击「发布日志」，验证 URL 参数预填方向和类型
5. **问答**：发布一个 type=question 的帖子，在详情页验证评论可被采纳
6. **排行榜**：访问 `/community/leaderboard`，验证两个维度 Tab 可切换
7. **社区首页**：验证日志/问答类型筛选和排行榜入口
