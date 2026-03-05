# Phase 1b: 养成方向检索（类 DeFiLlama）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a categorized directory of OpenClaw use-case "directions" (种番茄、养鱼、新闻媒体等) with DeFiLlama-style browsing, filtering, and ranking. Plus an admin backend for data entry.

**Architecture:** New `Category` and `Direction` Prisma models. Three public pages (overview, category list, direction detail) and one admin page for CRUD. API routes for data access.

**Tech Stack:** Prisma, Next.js 16 App Router, TailwindCSS (same as existing)

---

## Task 1: Add Category and Direction models to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/shared/types.ts`

**Step 1: Add models to schema**

Add after `InviteCode` model:

```prisma
model Category {
  id          String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String      @unique
  nameZh      String      @map("name_zh")
  icon        String      @default("📦")
  sortOrder   Int         @default(0) @map("sort_order")
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz
  directions  Direction[]

  @@map("categories")
}

model Direction {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  categoryId   String   @map("category_id") @db.Uuid
  category     Category @relation(fields: [categoryId], references: [id])
  name         String
  nameZh       String   @map("name_zh")
  slug         String   @unique
  description  String?
  descriptionZh String? @map("description_zh")
  icon         String   @default("🔧")
  userCount    Int      @default(0) @map("user_count")
  rating       Float    @default(0)
  featured     Boolean  @default(false)
  status       String   @default("active")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([categoryId])
  @@index([userCount(sort: Desc)])
  @@index([rating(sort: Desc)])
  @@index([featured])
  @@map("directions")
}
```

**Step 2: Add types to `src/shared/types.ts`**

```typescript
export interface Category {
  id: string
  name: string
  name_zh: string
  icon: string
  sort_order: number
  created_at: string
}

export interface Direction {
  id: string
  category_id: string
  name: string
  name_zh: string
  slug: string
  description: string | null
  description_zh: string | null
  icon: string
  user_count: number
  rating: number
  featured: boolean
  status: string
  created_at: string
  updated_at: string
}
```

**Step 3: Run Prisma generate**

```bash
npx prisma generate --schema=prisma/schema.prisma
```

**Step 4: Update mock-prisma**

Add `categories: any[]` and `directions: any[]` to MockStore, and `category: createModel(store.categories)` and `direction: createModel(store.directions, { status: 'active', userCount: 0, rating: 0, featured: false })` to prisma mock.

**Step 5: Commit**

```bash
git add prisma/schema.prisma src/shared/types.ts tests/helpers/mock-prisma.ts
git commit -m "feat: add Category and Direction models for direction catalog"
```

---

## Task 2: Create Direction API routes

**Files:**
- Create: `web/app/api/directions/route.ts`
- Create: `web/app/api/directions/[slug]/route.ts`
- Create: `web/app/api/categories/route.ts`

**Step 1: Categories API**

Create `web/app/api/categories/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: { select: { directions: true } },
    },
  })
  return NextResponse.json(categories)
}
```

**Step 2: Directions list API**

Create `web/app/api/directions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category')
  const sort = request.nextUrl.searchParams.get('sort') ?? 'userCount'
  const featured = request.nextUrl.searchParams.get('featured')

  const where: any = { status: 'active' }
  if (category) {
    where.category = { name: category }
  }
  if (featured === 'true') {
    where.featured = true
  }

  const orderBy: any = sort === 'rating' ? { rating: 'desc' } :
                        sort === 'newest' ? { createdAt: 'desc' } :
                        { userCount: 'desc' }

  const directions = await prisma.direction.findMany({
    where,
    orderBy,
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  return NextResponse.json(directions)
}
```

**Step 3: Direction detail API**

Create `web/app/api/directions/[slug]/route.ts`:

```typescript
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

**Step 4: Commit**

```bash
git add web/app/api/categories/ web/app/api/directions/
git commit -m "feat: add category and direction API routes"
```

---

## Task 3: Build directions overview page `/directions`

**Files:**
- Create: `web/app/directions/page.tsx`
- Modify: `web/components/public-nav.tsx`

**Step 1: Create overview page**

Create `web/app/directions/page.tsx`:

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { PublicNav } from '@web/components/public-nav'
import Link from 'next/link'

interface Category {
  id: string
  name: string
  nameZh: string
  icon: string
  _count: { directions: number }
}

interface Direction {
  id: string
  name: string
  nameZh: string
  slug: string
  icon: string
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

export default function DirectionsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [featured, setFeatured] = useState<Direction[]>([])
  const [topDirections, setTopDirections] = useState<Direction[]>([])

  const fetchData = useCallback(async () => {
    const [cats, feat, top] = await Promise.all([
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/directions?featured=true').then(r => r.json()),
      fetch('/api/directions?sort=userCount').then(r => r.json()),
    ])
    setCategories(cats)
    setFeatured(feat)
    setTopDirections(top)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">OpenClaw 养成方向</h1>
        <p className="text-sm text-gray-500 mb-8">探索 OpenClaw 的各种应用场景</p>

        {/* Category cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
          {categories.map(cat => (
            <Link
              key={cat.id}
              href={`/directions/${cat.name}`}
              className="bg-white rounded-lg p-4 shadow-sm border hover:border-blue-300 transition text-center"
            >
              <div className="text-2xl mb-1">{cat.icon}</div>
              <div className="font-medium text-sm">{cat.nameZh}</div>
              <div className="text-xs text-gray-400 mt-1">{cat._count.directions} 个方向</div>
            </Link>
          ))}
        </div>

        {/* Featured directions */}
        {featured.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-bold mb-4">精选方向</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {featured.map(dir => (
                <Link
                  key={dir.id}
                  href={`/directions/${dir.category.name}/${dir.slug}`}
                  className="bg-white rounded-lg p-4 shadow-sm border hover:border-blue-300 transition"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{dir.icon}</span>
                    <span className="font-medium">{dir.nameZh}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{dir.category.icon} {dir.category.nameZh}</span>
                    <span>{dir.userCount} 人使用</span>
                    <span>⭐ {dir.rating.toFixed(1)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Top directions ranking */}
        <div>
          <h2 className="text-lg font-bold mb-4">热门排行</h2>
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="p-3 w-12">#</th>
                  <th className="p-3">方向</th>
                  <th className="p-3">分类</th>
                  <th className="p-3 text-right">使用人数</th>
                  <th className="p-3 text-right">评分</th>
                </tr>
              </thead>
              <tbody>
                {topDirections.slice(0, 20).map((dir, i) => (
                  <tr key={dir.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-3 text-gray-400 font-medium">{i + 1}</td>
                    <td className="p-3">
                      <Link href={`/directions/${dir.category.name}/${dir.slug}`} className="flex items-center gap-2 hover:text-blue-600">
                        <span>{dir.icon}</span>
                        <span className="font-medium">{dir.nameZh}</span>
                      </Link>
                    </td>
                    <td className="p-3 text-sm text-gray-500">{dir.category.icon} {dir.category.nameZh}</td>
                    <td className="p-3 text-right font-medium">{dir.userCount.toLocaleString()}</td>
                    <td className="p-3 text-right">⭐ {dir.rating.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {topDirections.length === 0 && (
              <div className="p-8 text-center text-gray-400">暂无数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Add nav link**

In `web/components/public-nav.tsx`, add after Pipeline link:

```tsx
<Link href="/directions" className="text-sm text-gray-500 hover:text-gray-700">Directions</Link>
```

**Step 3: Commit**

```bash
git add web/app/directions/ web/components/public-nav.tsx
git commit -m "feat: add directions overview page with category cards and ranking table"
```

---

## Task 4: Build category list page `/directions/[category]`

**Files:**
- Create: `web/app/directions/[category]/page.tsx`

**Step 1: Create category page**

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import Link from 'next/link'

interface Direction {
  id: string
  name: string
  nameZh: string
  slug: string
  descriptionZh: string | null
  icon: string
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

export default function CategoryPage() {
  const params = useParams<{ category: string }>()
  const [directions, setDirections] = useState<Direction[]>([])
  const [sort, setSort] = useState('userCount')

  const fetchData = useCallback(() => {
    fetch(`/api/directions?category=${params.category}&sort=${sort}`)
      .then(r => r.ok ? r.json() : [])
      .then(setDirections)
  }, [params.category, sort])

  useEffect(() => { fetchData() }, [fetchData])

  const categoryInfo = directions[0]?.category

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Breadcrumb */}
        <div className="text-sm text-gray-500 mb-4">
          <Link href="/directions" className="hover:text-blue-600">养成方向</Link>
          <span className="mx-2">/</span>
          <span>{categoryInfo ? `${categoryInfo.icon} ${categoryInfo.nameZh}` : params.category}</span>
        </div>

        <h1 className="text-2xl font-bold mb-6">
          {categoryInfo ? `${categoryInfo.icon} ${categoryInfo.nameZh}` : params.category}
        </h1>

        {/* Sort controls */}
        <div className="flex gap-2 mb-4">
          {[
            { key: 'userCount', label: '最多使用' },
            { key: 'rating', label: '最高评分' },
            { key: 'newest', label: '最新' },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`px-3 py-1 rounded text-sm ${sort === s.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Direction list */}
        <div className="space-y-3">
          {directions.map(dir => (
            <Link
              key={dir.id}
              href={`/directions/${params.category}/${dir.slug}`}
              className="block bg-white rounded-lg p-4 shadow-sm border hover:border-blue-300 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{dir.icon}</span>
                  <div>
                    <div className="font-medium">{dir.nameZh}</div>
                    {dir.descriptionZh && (
                      <div className="text-sm text-gray-500 mt-0.5 line-clamp-1">{dir.descriptionZh}</div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="font-bold">{dir.userCount.toLocaleString()}</div>
                  <div className="text-xs text-gray-400">⭐ {dir.rating.toFixed(1)}</div>
                </div>
              </div>
            </Link>
          ))}
          {directions.length === 0 && (
            <div className="text-center text-gray-400 py-12">该分类暂无方向</div>
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/directions/
git commit -m "feat: add category list page with sort controls"
```

---

## Task 5: Build direction detail page `/directions/[category]/[slug]`

**Files:**
- Create: `web/app/directions/[category]/[slug]/page.tsx`

**Step 1: Create detail page**

```tsx
import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DirectionDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params

  const direction = await prisma.direction.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  if (!direction || direction.category.name !== category) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Breadcrumb */}
        <div className="text-sm text-gray-500 mb-4">
          <Link href="/directions" className="hover:text-blue-600">养成方向</Link>
          <span className="mx-2">/</span>
          <Link href={`/directions/${category}`} className="hover:text-blue-600">
            {direction.category.icon} {direction.category.nameZh}
          </Link>
          <span className="mx-2">/</span>
          <span>{direction.nameZh}</span>
        </div>

        {/* Header */}
        <div className="bg-white rounded-lg p-6 shadow-sm border mb-6">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-4xl">{direction.icon}</span>
            <div>
              <h1 className="text-2xl font-bold">{direction.nameZh}</h1>
              <div className="text-sm text-gray-500">{direction.name}</div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-6 mt-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{direction.userCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500">使用人数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">⭐ {direction.rating.toFixed(1)}</div>
              <div className="text-xs text-gray-500">评分</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{direction.category.icon}</div>
              <div className="text-xs text-gray-500">{direction.category.nameZh}</div>
            </div>
          </div>
        </div>

        {/* Description */}
        {(direction.descriptionZh || direction.description) && (
          <div className="bg-white rounded-lg p-6 shadow-sm border">
            <h2 className="text-lg font-bold mb-3">介绍</h2>
            <div className="text-gray-700 leading-relaxed whitespace-pre-line">
              {direction.descriptionZh || direction.description}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/directions/
git commit -m "feat: add direction detail page with stats and description"
```

---

## Task 6: Build admin CRUD for directions

**Files:**
- Create: `web/app/admin/directions/page.tsx`
- Create: `web/app/api/admin/directions/route.ts`
- Create: `web/app/api/admin/categories/route.ts`

**Step 1: Admin categories API**

Create `web/app/api/admin/categories/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json(categories)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const category = await prisma.category.create({
    data: {
      name: body.name,
      nameZh: body.nameZh,
      icon: body.icon ?? '📦',
      sortOrder: body.sortOrder ?? 0,
    },
  })
  return NextResponse.json(category, { status: 201 })
}
```

**Step 2: Admin directions API**

Create `web/app/api/admin/directions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export async function GET() {
  const directions = await prisma.direction.findMany({
    orderBy: { createdAt: 'desc' },
    include: { category: { select: { name: true, nameZh: true } } },
  })
  return NextResponse.json(directions)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const direction = await prisma.direction.create({
    data: {
      categoryId: body.categoryId,
      name: body.name,
      nameZh: body.nameZh,
      slug: body.slug ?? toSlug(body.name),
      description: body.description ?? null,
      descriptionZh: body.descriptionZh ?? null,
      icon: body.icon ?? '🔧',
      userCount: body.userCount ?? 0,
      rating: body.rating ?? 0,
      featured: body.featured ?? false,
    },
  })
  return NextResponse.json(direction, { status: 201 })
}
```

**Step 3: Admin directions page**

Create `web/app/admin/directions/page.tsx` — a simple form-based admin page that:
- Lists all directions in a table
- Has a form to add a new category (name, nameZh, icon)
- Has a form to add a new direction (select category, name, nameZh, slug, description, icon, userCount, rating, featured)
- Both forms POST to their respective API endpoints

Use `'use client'` with `fetch` calls. Keep it functional — admin UI doesn't need to be pretty.

**Step 4: Commit**

```bash
git add web/app/api/admin/ web/app/admin/directions/
git commit -m "feat: add admin CRUD pages for categories and directions"
```

---

## Task 7: Seed initial direction data

**Files:**
- Create: `src/db/seed-directions.ts`

**Step 1: Create seed script**

```typescript
import 'dotenv/config'
import { createPrisma } from './database.js'

const CATEGORIES = [
  { name: 'agriculture', nameZh: '农业养殖', icon: '🌱', sortOrder: 1 },
  { name: 'media', nameZh: '内容媒体', icon: '📰', sortOrder: 2 },
  { name: 'finance', nameZh: '交易金融', icon: '💹', sortOrder: 3 },
  { name: 'gaming', nameZh: '游戏娱乐', icon: '🎮', sortOrder: 4 },
  { name: 'devtools', nameZh: '开发工具', icon: '🔧', sortOrder: 5 },
  { name: 'education', nameZh: '教育学习', icon: '📚', sortOrder: 6 },
]

const DIRECTIONS = [
  { category: 'agriculture', name: 'tomato-growing', nameZh: '种番茄', icon: '🍅', descriptionZh: '使用 OpenClaw 规划番茄种植周期、病虫害防治、浇灌提醒', userCount: 342, rating: 4.5, featured: true },
  { category: 'agriculture', name: 'fish-farming', nameZh: '养鱼', icon: '🐟', descriptionZh: '水质监测、喂食提醒、鱼类健康管理', userCount: 218, rating: 4.2, featured: true },
  { category: 'agriculture', name: 'herb-garden', nameZh: '香草种植', icon: '🌿', descriptionZh: '室内香草园规划与养护指导', userCount: 156, rating: 4.0 },
  { category: 'media', name: 'crypto-news', nameZh: '加密新闻', icon: '📰', descriptionZh: '自动化加密货币新闻采集、分析与发布', userCount: 891, rating: 4.7, featured: true },
  { category: 'media', name: 'content-translation', nameZh: '内容翻译', icon: '🌐', descriptionZh: '多语言内容自动翻译与本地化', userCount: 467, rating: 4.3 },
  { category: 'media', name: 'social-media', nameZh: '自媒体运营', icon: '📱', descriptionZh: '社交媒体内容规划、生成与发布管理', userCount: 623, rating: 4.4, featured: true },
  { category: 'finance', name: 'market-analysis', nameZh: '行情分析', icon: '📊', descriptionZh: '加密货币市场趋势分析与信号监测', userCount: 1205, rating: 4.6, featured: true },
  { category: 'finance', name: 'portfolio-tracking', nameZh: '投资组合追踪', icon: '💰', descriptionZh: '多链资产组合监控与收益计算', userCount: 534, rating: 4.1 },
  { category: 'finance', name: 'risk-management', nameZh: '风控管理', icon: '🛡️', descriptionZh: '交易风险评估与止损策略', userCount: 312, rating: 4.0 },
  { category: 'gaming', name: 'npc-dialogue', nameZh: 'NPC 对话', icon: '💬', descriptionZh: '游戏 NPC 智能对话生成', userCount: 445, rating: 4.3 },
  { category: 'gaming', name: 'quest-design', nameZh: '任务设计', icon: '⚔️', descriptionZh: '游戏任务和剧情自动生成', userCount: 287, rating: 4.1 },
  { category: 'devtools', name: 'code-review', nameZh: '代码审查', icon: '🔍', descriptionZh: '自动化代码审查与质量检测', userCount: 756, rating: 4.5, featured: true },
  { category: 'devtools', name: 'doc-generation', nameZh: '文档生成', icon: '📄', descriptionZh: '从代码自动生成 API 文档与使用指南', userCount: 534, rating: 4.2 },
  { category: 'devtools', name: 'debug-assistant', nameZh: '调试助手', icon: '🐛', descriptionZh: '智能错误分析与修复建议', userCount: 423, rating: 4.3 },
  { category: 'education', name: 'language-learning', nameZh: '语言学习', icon: '🗣️', descriptionZh: '个性化语言学习计划与练习', userCount: 678, rating: 4.4, featured: true },
  { category: 'education', name: 'knowledge-qa', nameZh: '知识问答', icon: '❓', descriptionZh: '领域知识问答与学习辅导', userCount: 512, rating: 4.2 },
]

async function main() {
  const prisma = createPrisma()

  // Seed categories
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { name: cat.name },
      create: cat,
      update: {},
    })
  }
  console.log(`Seeded ${CATEGORIES.length} categories`)

  // Get category ID map
  const cats = await prisma.category.findMany()
  const catMap = new Map(cats.map(c => [c.name, c.id]))

  // Seed directions
  for (const dir of DIRECTIONS) {
    const categoryId = catMap.get(dir.category)!
    const slug = dir.name
    await prisma.direction.upsert({
      where: { slug },
      create: {
        categoryId,
        name: dir.name,
        nameZh: dir.nameZh,
        slug,
        descriptionZh: dir.descriptionZh,
        icon: dir.icon,
        userCount: dir.userCount,
        rating: dir.rating,
        featured: dir.featured ?? false,
      },
      update: {},
    })
  }
  console.log(`Seeded ${DIRECTIONS.length} directions`)

  await prisma.$disconnect()
}

main().catch(console.error)
```

**Step 2: Add script to package.json**

Add to scripts: `"seed:directions": "tsx src/db/seed-directions.ts"`

**Step 3: Commit**

```bash
git add src/db/seed-directions.ts package.json
git commit -m "feat: add direction seed script with 6 categories and 16 directions"
```

---

## Task 8: Build and verify

**Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

**Step 2: Build frontend**

```bash
cd web && npm run build
```

Expected: Build succeeds with new routes.

**Step 3: Commit and tag**

```bash
git tag v0.2.0-phase1b
```
