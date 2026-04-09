# Privy Auth + Dual-Layer User Model Implementation Plan

> **Note (2026-03-22):** Auth 方案已实施且仍有效。文中的旧市场字段与 `/api/market/*` 等市场语义已过时（已替换为 Soul 模型 + `/api/souls/*`），仅保留 Auth 架构参考。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace self-built TG login with Privy SDK, restructure users into Account + Member dual-layer model with AI Agent support.

**Architecture:** Privy handles human authentication (TG login + embedded wallets). Backend verifies Privy access tokens or API keys via a unified `resolveIdentity()` middleware. Account table owns auth identity; Member table owns platform identity (both humans and AI agents).

**Tech Stack:** `@privy-io/react-auth` (frontend), `@privy-io/server-auth` (backend token verification), Prisma, Next.js App Router

**Design Doc:** `docs/plans/2026-03-13-privy-auth-redesign.md`

---

### Task 1: Create feature branch and install dependencies

**Files:**
- Modify: `web/package.json`

**Step 1: Create branch**

```bash
git checkout -b feat/privy-auth
```

**Step 2: Install Privy packages**

```bash
cd web && npm install @privy-io/react-auth @privy-io/server-auth
```

**Step 3: Add env vars to .env.example**

Add to `.env.example`:

```
# Privy
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

Also add the actual values to `.env`.

**Step 4: Commit**

```bash
git add web/package.json web/package-lock.json .env.example
git commit -m "feat(auth): add Privy SDK dependencies and env vars"
```

---

### Task 2: Schema migration — Add Account table, modify Member

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add Account model and modify Member**

In `prisma/schema.prisma`, add the `Account` model before `Member`:

```prisma
model Account {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  privyDid  String?  @unique @map("privy_did")
  tgId      String?  @unique @map("tg_id")
  tgName    String?  @map("tg_name")
  avatar    String?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  members Member[]

  @@map("accounts")
}
```

Modify `Member` model:
- Add `accountId`, `kind`, `apiKey`, `displayName` fields
- Make `tgId` nullable (keep for now, will be removed later)
- Remove `inviteCode` field
- Remove `loginChallenges` relation
> Note: This snippet is historical auth-planning context only. The live schema has since removed `PurchaseIntent`, `Order`, and `Entitlement`; use `prisma/schema.prisma` for the current model set.

```prisma
model Member {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId   String?  @map("account_id") @db.Uuid
  account     Account? @relation(fields: [accountId], references: [id], onDelete: Cascade)
  kind        String   @default("human")
  displayName String?  @map("display_name")
  apiKey      String?  @unique @map("api_key")
  tgId        String?  @unique @map("tg_id")
  tgName      String?  @map("tg_name")
  wallet      String?
  level       Int      @default(1)
  avatar      String?
  bio         String?
  exp         Int      @default(0)
  joinedAt    DateTime @default(now()) @map("joined_at") @db.Timestamptz

  posts           Post[]
  comments        Comment[]
  achievements    MemberAchievement[]
  walletBindings  WalletBinding[]
  soulAssets      SoulAsset[]
  purchaseIntents PurchaseIntent[]
  orders          Order[]       @relation("BuyerOrders")
  entitlements    Entitlement[]

  @@index([accountId, kind])
  @@index([tgId])
  @@map("members")
}
```

Note: `accountId` is nullable during migration. The `LoginChallenge` model's relation to Member should be kept for now (delete the whole model in Task 10 cleanup).

**Step 2: Generate migration and apply**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma migrate dev --name add-account-and-member-fields --schema=prisma/schema.prisma
```

**Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(auth): add Account model, extend Member with kind/apiKey/displayName"
```

---

### Task 3: Data backfill — Create Account records for existing Members

**Files:**
- Create: `prisma/backfill-accounts.ts`

**Step 1: Write backfill script**

Create `prisma/backfill-accounts.ts`:

```typescript
import { PrismaClient } from '../generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const members = await prisma.member.findMany({
    where: { accountId: null },
    select: { id: true, tgId: true, tgName: true, avatar: true },
  })

  console.log(`Found ${members.length} members without accounts`)

  for (const member of members) {
    const account = await prisma.account.create({
      data: {
        tgId: member.tgId,
        tgName: member.tgName,
        avatar: member.avatar,
      },
    })

    await prisma.member.update({
      where: { id: member.id },
      data: {
        accountId: account.id,
        kind: 'human',
        displayName: member.tgName,
      },
    })

    console.log(`Migrated member ${member.id} → account ${account.id}`)
  }

  console.log('Done')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

**Step 2: Run backfill**

```bash
npx tsx prisma/backfill-accounts.ts
```

**Step 3: Commit**

```bash
git add prisma/backfill-accounts.ts
git commit -m "feat(auth): backfill Account records for existing members"
```

---

### Task 4: New auth library — Privy client + resolveIdentity middleware

**Files:**
- Create: `web/lib/auth/privy.ts`
- Create: `web/lib/auth/identity.ts`

**Step 1: Create Privy server client**

Create `web/lib/auth/privy.ts`:

```typescript
import { PrivyClient } from '@privy-io/server-auth'

export const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
)
```

**Step 2: Create resolveIdentity middleware**

Create `web/lib/auth/identity.ts`:

```typescript
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from './privy'

export interface Identity {
  accountId: string
  memberId: string
  kind: 'human' | 'agent'
}

export async function resolveIdentity(): Promise<Identity | null> {
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  if (!authHeader) return null

  const token = authHeader.replace('Bearer ', '')

  // API Key path
  if (token.startsWith('sk-')) {
    const member = await prisma.member.findUnique({
      where: { apiKey: token },
      select: { id: true, accountId: true, kind: true },
    })
    if (!member || !member.accountId) return null
    return {
      accountId: member.accountId,
      memberId: member.id,
      kind: member.kind as 'human' | 'agent',
    }
  }

  // Privy token path
  try {
    const claims = await privy.verifyAuthToken(token)
    const account = await prisma.account.findUnique({
      where: { privyDid: claims.userId },
      include: {
        members: {
          where: { kind: 'human' },
          select: { id: true, kind: true },
          take: 1,
        },
      },
    })
    if (!account || account.members.length === 0) return null
    return {
      accountId: account.id,
      memberId: account.members[0].id,
      kind: 'human',
    }
  } catch {
    return null
  }
}

export async function requireIdentity(): Promise<
  { error: NextResponse; identity: null } | { error: null; identity: Identity }
> {
  const identity = await resolveIdentity()
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      identity: null,
    }
  }
  return { error: null, identity }
}
```

**Step 3: Commit**

```bash
git add web/lib/auth/privy.ts web/lib/auth/identity.ts
git commit -m "feat(auth): add Privy client and resolveIdentity middleware"
```

---

### Task 5: Replace backend auth — All API routes

**Files:**
- Modify: `web/app/api/auth/me/route.ts`
- Modify: `web/app/api/auth/logout/route.ts`
- Modify: `web/app/api/community/posts/route.ts`
- Modify: `web/app/api/community/posts/[id]/comments/route.ts`
- Modify: `web/app/api/community/posts/[id]/comments/[commentId]/accept/route.ts`
- Modify: `web/app/api/market/publish/route.ts`
- Modify: `web/app/api/market/upload/route.ts`
- Modify: `web/app/api/market/download/route.ts`
- Modify: `web/app/api/market/purchase-intent/route.ts`
- Modify: `web/app/api/market/confirm-purchase/route.ts`
- Modify: `web/app/api/market/my/route.ts`
- Modify: `web/app/api/wallet/bind/challenge/route.ts`
- Modify: `web/app/api/wallet/bind/confirm/route.ts`

For every file, the change pattern is the same:

**Pattern A** — Files using `getSession()`:

Replace:
```typescript
import { getSession } from '@web/lib/auth/session'
// ...
const session = await getSession()
if (!session) {
  return NextResponse.json({ error: '请先登录' }, { status: 401 })
}
// uses session.memberId
```

With:
```typescript
import { resolveIdentity } from '@web/lib/auth/identity'
// ...
const identity = await resolveIdentity()
if (!identity) {
  return NextResponse.json({ error: '请先登录' }, { status: 401 })
}
// use identity.memberId instead of session.memberId
```

**Pattern B** — Files using `requireAuth()`:

Replace:
```typescript
import { requireAuth } from '@web/lib/auth/require-auth'
// ...
const { error, session } = await requireAuth()
if (error) return error
// uses session.memberId
```

With:
```typescript
import { requireIdentity } from '@web/lib/auth/identity'
// ...
const { error, identity } = await requireIdentity()
if (error) return error
// use identity.memberId instead of session.memberId
```

**Step 1: Update `/api/auth/me`**

Rewrite `web/app/api/auth/me/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ user: null })
  }

  const member = await prisma.member.findUnique({
    where: { id: identity.memberId },
    select: { id: true, displayName: true, avatar: true, level: true, bio: true, kind: true },
  })

  if (!member) {
    return NextResponse.json({ user: null })
  }

  // Fetch avatar from account if member doesn't have one
  let avatar = member.avatar
  if (!avatar) {
    const account = await prisma.account.findUnique({
      where: { id: identity.accountId },
      select: { avatar: true },
    })
    avatar = account?.avatar ?? null
  }

  return NextResponse.json({
    user: {
      id: member.id,
      tgName: member.displayName,  // keep tgName key for frontend compat
      avatar,
      level: member.level,
      bio: member.bio,
      kind: member.kind,
    },
  })
}
```

Note: The `member.avatar` field is on Account now for humans. For agents it may be on Member directly. We check both. Return `tgName` key for frontend backward compat — will rename in frontend task.

**Step 2: Update `/api/auth/logout`**

Rewrite `web/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from 'next/server'

export async function POST() {
  // Privy handles logout client-side; backend is a no-op
  return NextResponse.json({ ok: true })
}
```

**Step 3: Apply Pattern A to all market routes**

For each of these files, replace the import and session check:

- `web/app/api/market/publish/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/market/upload/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/market/download/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/market/purchase-intent/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/market/confirm-purchase/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/market/my/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/wallet/bind/challenge/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/wallet/bind/confirm/route.ts` — `session.memberId` → `identity.memberId`

**Step 4: Apply Pattern B to community routes**

- `web/app/api/community/posts/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/community/posts/[id]/comments/route.ts` — `session.memberId` → `identity.memberId`
- `web/app/api/community/posts/[id]/comments/[commentId]/accept/route.ts` — `session.memberId` → `identity.memberId`

**Step 5: Verify build**

```bash
cd web && npx next build
```

Expected: Build succeeds with no errors related to auth imports.

**Step 6: Commit**

```bash
git add web/app/api/
git commit -m "feat(auth): replace getSession/requireAuth with resolveIdentity across all API routes"
```

---

### Task 6: Frontend — PrivyProvider setup

**Files:**
- Create: `web/components/privy-provider.tsx`
- Modify: `web/app/layout.tsx`

**Step 1: Create Privy provider wrapper**

Create `web/components/privy-provider.tsx`:

```tsx
'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['telegram'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
```

**Step 2: Wrap layout with PrivyProvider**

Modify `web/app/layout.tsx` — add PrivyProvider around AuthProvider:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { PrivyProvider } from "@web/components/privy-provider";
import { AuthProvider } from "@web/components/auth-provider";

export const metadata: Metadata = {
  title: "CryptoOpenClaw",
  description: "AI 驱动的加密货币新闻与 OpenClaw 生态",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <PrivyProvider>
          <AuthProvider>{children}</AuthProvider>
        </PrivyProvider>
      </body>
    </html>
  );
}
```

**Step 3: Commit**

```bash
git add web/components/privy-provider.tsx web/app/layout.tsx
git commit -m "feat(auth): add PrivyProvider wrapper to root layout"
```

---

### Task 7: Frontend — Rewrite AuthProvider to use Privy

**Files:**
- Modify: `web/components/auth-provider.tsx`

**Step 1: Rewrite auth-provider**

Replace the entire content of `web/components/auth-provider.tsx`:

```tsx
'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { usePrivy } from '@privy-io/react-auth'

interface AuthUser {
  id: string
  tgName: string | null
  avatar: string | null
  level: number
  kind: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
  getAuthHeaders: () => Promise<Record<string, string>>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  getAuthHeaders: async () => ({}),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout: privyLogout, getAccessToken } = usePrivy()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!authenticated) return {}
    const token = await getAccessToken()
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [authenticated, getAccessToken])

  const fetchUser = useCallback(async () => {
    if (!ready) return
    if (!authenticated) {
      setUser(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/auth/me', { cache: 'no-store', headers })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user ?? null)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [ready, authenticated, getAuthHeaders])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const logout = useCallback(async () => {
    await privyLogout()
    setUser(null)
  }, [privyLogout])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: fetchUser, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
```

Key changes:
- Auth state driven by `usePrivy()` `ready` + `authenticated` instead of cookie-based `/api/auth/me`
- `getAuthHeaders()` exposed — all authenticated fetches must include these headers
- Logout calls `privyLogout()` instead of hitting backend endpoint

**Step 2: Commit**

```bash
git add web/components/auth-provider.tsx
git commit -m "feat(auth): rewrite AuthProvider to use Privy SDK"
```

---

### Task 8: Frontend — Update all authenticated fetch calls

**Files:**
- Modify: `web/components/public-nav.tsx` (minor — avatar from account)
- Modify: `web/app/market/my/page.tsx`
- Modify: `web/app/market/publish/page.tsx`
- Modify: `web/app/community/new/page.tsx`
- Modify: `web/app/community/[id]/page.tsx`
- Modify: `web/components/market/wallet-connect.tsx`
- Modify: `web/components/market/purchase-button.tsx`

All authenticated `fetch()` calls currently rely on the session cookie. Since we're now using Privy access tokens via `Authorization` header, every component that calls a protected API must include auth headers.

**Pattern:** In each component that uses `useAuth()` and calls a protected API:

```tsx
// Before
const { user } = useAuth()
// ...
fetch('/api/market/my')

// After
const { user, getAuthHeaders } = useAuth()
// ...
const headers = await getAuthHeaders()
fetch('/api/market/my', { headers })
```

Apply this pattern to all authenticated fetch calls in the files listed above. For POST requests, merge headers:

```tsx
const authHeaders = await getAuthHeaders()
fetch('/api/community/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authHeaders },
  body: JSON.stringify(payload),
})
```

For FormData uploads (market/upload), only add auth headers (no Content-Type):

```tsx
const authHeaders = await getAuthHeaders()
fetch('/api/market/upload', { method: 'POST', body: fd, headers: authHeaders })
```

**Step 1: Update each file** following the pattern above.

**Step 2: Verify build**

```bash
cd web && npx next build
```

**Step 3: Commit**

```bash
git add web/components/ web/app/
git commit -m "feat(auth): add Privy auth headers to all authenticated fetch calls"
```

---

### Task 9: Frontend — Rewrite login page

**Files:**
- Modify: `web/app/login/page.tsx`

**Step 1: Rewrite login page**

Replace the entire content of `web/app/login/page.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@web/components/auth-provider'

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy()
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (ready && authenticated && user) {
      router.push('/community')
    }
  }, [ready, authenticated, user, router])

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
      </div>
    )
  }

  if (authenticated && !user) {
    // Privy auth succeeded but no Account/Member found
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
        </div>
        <div className="glass-panel p-8 w-full max-w-sm animate-fade-up relative text-center">
          <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">未找到账号</span>
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            请先通过 OpenClaw skill 的邀请流程加入社区
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            完成邀请流程后，再次点击下方按钮登录
          </p>
          <button
            onClick={() => login()}
            className="mt-4 glass-card px-6 py-2.5 text-sm font-medium transition-all"
            style={{ color: 'var(--accent-cyan)' }}
          >
            重新登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
      </div>
      <div className="glass-panel p-8 w-full max-w-sm animate-fade-up relative">
        <h1 className="text-2xl font-bold mb-1 text-center" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">CryptoOpenClaw</span>
        </h1>
        <p className="text-center text-sm mb-8" style={{ color: 'var(--text-muted)' }}>社区登录</p>
        <button
          onClick={() => login()}
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
          通过 Telegram 登录
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/login/page.tsx
git commit -m "feat(auth): rewrite login page with Privy TG login"
```

---

### Task 10: AI Agent CRUD API

**Files:**
- Create: `web/app/api/agents/route.ts`

**Step 1: Create agent management API**

Create `web/app/api/agents/route.ts`:

```typescript
import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'

function generateApiKey(): string {
  return `sk-${randomBytes(24).toString('hex')}`
}

// GET /api/agents — list my agents
export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能管理其他 Agent' }, { status: 403 })
  }

  const agents = await prisma.member.findMany({
    where: { accountId: identity.accountId, kind: 'agent' },
    select: {
      id: true,
      displayName: true,
      bio: true,
      level: true,
      joinedAt: true,
      walletBindings: { where: { isPrimary: true }, select: { address: true, chain: true }, take: 1 },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return NextResponse.json({ agents })
}

// POST /api/agents — create agent
export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能创建其他 Agent' }, { status: 403 })
  }

  const { displayName, bio } = await request.json()
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return NextResponse.json({ error: 'displayName 必填' }, { status: 400 })
  }

  const apiKey = generateApiKey()

  const agent = await prisma.member.create({
    data: {
      accountId: identity.accountId,
      kind: 'agent',
      displayName: displayName.trim(),
      bio: bio?.trim() || null,
      apiKey,
    },
    select: { id: true, displayName: true, apiKey: true },
  })

  return NextResponse.json({ agent }, { status: 201 })
}

// DELETE /api/agents?id=xxx — delete agent
export async function DELETE(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const agentId = request.nextUrl.searchParams.get('id')
  if (!agentId) {
    return NextResponse.json({ error: 'id 参数必填' }, { status: 400 })
  }

  const agent = await prisma.member.findUnique({
    where: { id: agentId },
    select: { accountId: true, kind: true },
  })

  if (!agent || agent.kind !== 'agent' || agent.accountId !== identity.accountId) {
    return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
  }

  await prisma.member.delete({ where: { id: agentId } })
  return NextResponse.json({ ok: true })
}

// PATCH /api/agents — regenerate API key
export async function PATCH(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const { id } = await request.json()
  if (!id) {
    return NextResponse.json({ error: 'id 必填' }, { status: 400 })
  }

  const agent = await prisma.member.findUnique({
    where: { id },
    select: { accountId: true, kind: true },
  })

  if (!agent || agent.kind !== 'agent' || agent.accountId !== identity.accountId) {
    return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
  }

  const newApiKey = generateApiKey()
  await prisma.member.update({
    where: { id },
    data: { apiKey: newApiKey },
  })

  return NextResponse.json({ apiKey: newApiKey })
}
```

**Step 2: Add `/api/agents` to public paths in middleware**

In `web/middleware.ts`, add to the public paths list:

```typescript
pathname.startsWith('/api/agents') ||
```

Wait — this route is NOT public. It requires auth. But the middleware currently uses Supabase auth which is for admin only. The user auth routes are already in the public path list (they handle their own auth via `resolveIdentity`). So `/api/agents` needs to be in the public list too, same as `/api/market/` and `/api/community/`.

Add to the public paths in `web/middleware.ts`:

```typescript
pathname.startsWith('/api/agents') ||
```

**Step 3: Commit**

```bash
git add web/app/api/agents/ web/middleware.ts
git commit -m "feat(auth): add AI Agent CRUD API with API key management"
```

---

### Task 11: Handle first-time Privy login — Account linking

**Files:**
- Create: `web/app/api/auth/privy-callback/route.ts`
- Modify: `web/components/auth-provider.tsx`

When a user logs in with Privy for the first time, their Account exists (from backfill) with `tgId` but no `privyDid`. We need to link them.

**Step 1: Create privy-callback API**

Create `web/app/api/auth/privy-callback/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from '@web/lib/auth/privy'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST() {
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')

  let claims
  try {
    claims = await privy.verifyAuthToken(token)
  } catch {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const privyDid = claims.userId

  // Already linked?
  const existing = await prisma.account.findUnique({
    where: { privyDid },
    include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
  })
  if (existing && existing.members.length > 0) {
    return NextResponse.json({ linked: true, memberId: existing.members[0].id })
  }

  // Get TG info from Privy user
  const privyUser = await privy.getUser(privyDid)
  const tgAccount = privyUser.telegram
  if (!tgAccount) {
    return NextResponse.json(
      { error: 'account_not_found', message: '请先通过 OpenClaw skill 的邀请流程加入社区' },
      { status: 403 }
    )
  }

  const tgId = String(tgAccount.telegramUserId)

  // Find account by tgId (from backfill) and link privyDid
  const account = await prisma.account.findUnique({
    where: { tgId },
    include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
  })

  if (!account || account.members.length === 0) {
    return NextResponse.json(
      { error: 'account_not_found', message: '请先通过 OpenClaw skill 的邀请流程加入社区' },
      { status: 403 }
    )
  }

  // Link privyDid
  await prisma.account.update({
    where: { id: account.id },
    data: {
      privyDid,
      tgName: tgAccount.username ?? account.tgName,
    },
  })

  return NextResponse.json({ linked: true, memberId: account.members[0].id })
}
```

**Step 2: Update AuthProvider to call privy-callback on first login**

In `web/components/auth-provider.tsx`, modify the `fetchUser` function:

After getting a `null` user from `/api/auth/me`, try the privy-callback to link the account, then retry:

```tsx
const fetchUser = useCallback(async () => {
  if (!ready) return
  if (!authenticated) {
    setUser(null)
    setLoading(false)
    return
  }

  setLoading(true)
  try {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/auth/me', { cache: 'no-store', headers })
    if (res.ok) {
      const data = await res.json()
      if (data.user) {
        setUser(data.user)
        return
      }

      // user is null — try linking via privy-callback
      const linkRes = await fetch('/api/auth/privy-callback', {
        method: 'POST',
        headers,
      })
      if (linkRes.ok) {
        // Retry /api/auth/me after linking
        const retryRes = await fetch('/api/auth/me', { cache: 'no-store', headers })
        if (retryRes.ok) {
          const retryData = await retryRes.json()
          setUser(retryData.user ?? null)
          return
        }
      }

      setUser(null)
    } else {
      setUser(null)
    }
  } catch {
    setUser(null)
  } finally {
    setLoading(false)
  }
}, [ready, authenticated, getAuthHeaders])
```

**Step 3: Commit**

```bash
git add web/app/api/auth/privy-callback/ web/components/auth-provider.tsx
git commit -m "feat(auth): add privy-callback for first-time account linking"
```

---

### Task 12: Cleanup — Remove old auth code

**Files:**
- Delete: `web/lib/auth/session.ts`
- Delete: `web/lib/auth/verify-telegram.ts`
- Delete: `web/lib/auth/require-auth.ts`
- Delete: `web/app/api/auth/telegram/route.ts`
- Delete: `web/app/api/auth/telegram/challenge/route.ts`
- Delete: `web/app/api/auth/telegram/challenge/complete/route.ts`
- Modify: `prisma/schema.prisma` (remove LoginChallenge model)

**Step 1: Delete old auth files**

```bash
rm web/lib/auth/session.ts
rm web/lib/auth/verify-telegram.ts
rm web/lib/auth/require-auth.ts
rm -rf web/app/api/auth/telegram
```

**Step 2: Remove LoginChallenge from schema**

In `prisma/schema.prisma`, delete the entire `LoginChallenge` model and remove `loginChallenges LoginChallenge[]` from Member if it's still there.

**Step 3: Generate migration**

```bash
npx prisma migrate dev --name remove-login-challenge --schema=prisma/schema.prisma
```

**Step 4: Remove old env vars from .env.example**

Remove or mark as optional:
```
# SESSION_SECRET — no longer used (was: JWT signing for self-built sessions)
# NEXT_PUBLIC_TG_BOT_USERNAME — no longer used for login widget (keep if bot still needed for other features)
```

**Step 5: Verify build**

```bash
cd web && npx next build
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore(auth): remove old TG login, session, LoginChallenge"
```

---

### Task 13: Final verification

**Step 1: Full build check**

```bash
cd web && npx next build
```

Expected: Clean build with no auth-related errors.

**Step 2: Manual test checklist**

- [ ] Visit `/login` — see Privy TG login button
- [ ] Click login — Privy modal opens with TG option
- [ ] After TG auth — redirected to `/community` with user info in nav
- [ ] Visit `/market/publish` — authenticated, can upload
- [ ] Visit `/market/my` — shows purchases
- [ ] Post in community — works with auth headers
- [ ] Logout — Privy clears state, nav shows "登录"
- [ ] Visit `/admin` — still uses Supabase auth (unchanged)
- [ ] API call with `Authorization: Bearer sk-xxx` — Agent auth works
- [ ] API call with invalid key — returns 401 with helpful message

**Step 3: Merge to master (if all tests pass)**

```bash
git checkout master
git merge feat/privy-auth
```
