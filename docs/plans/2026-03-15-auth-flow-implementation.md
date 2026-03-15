# Auth Flow Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Telegram login with email OTP, gate registration behind invite codes from Telegram bot.

**Architecture:** Privy switches from Telegram to email-only login. Registration is a two-step flow: validate invite code, then Privy email OTP creates the Account+Member link. The bot gains a registered-user check to prevent re-issuing codes. Auth-provider stops auto-linking via privy-callback.

**Tech Stack:** Next.js App Router, Privy SDK (@privy-io/react-auth), Prisma, grammy (Telegram bot)

---

### Task 1: Switch Privy to email-only login

**Files:**
- Modify: `web/components/privy-provider.tsx`

**Step 1: Update Privy config**

Replace the full file content:

```tsx
'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['email'],
        appearance: {
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
```

**Step 2: Remove env var**

Remove `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN` from `.env.example` (line 28). Email is now the only method — no feature flag needed.

**Step 3: Verify**

Run: `npx next build 2>&1 | head -20`
Expected: Build starts without import errors.

**Step 4: Commit**

```bash
git add web/components/privy-provider.tsx .env.example
git commit -m "feat(auth): switch Privy from Telegram to email-only login"
```

---

### Task 2: Add check-email API route

**Files:**
- Create: `web/app/api/auth/check-email/route.ts`

**Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true },
  })

  return NextResponse.json({ registered: !!account })
}
```

**Step 2: Verify**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds. Route exists at `/api/auth/check-email`.

**Step 3: Commit**

```bash
git add web/app/api/auth/check-email/route.ts
git commit -m "feat(auth): add check-email API endpoint"
```

---

### Task 3: Add validate-code API route

**Files:**
- Create: `web/app/api/register/validate-code/route.ts`

**Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.toUpperCase().trim()
  if (!code) {
    return NextResponse.json({ valid: false, error: '缺少邀请码' }, { status: 400 })
  }

  const invite = await prisma.inviteCode.findFirst({
    where: { code, active: 1, usedBy: null },
  })

  if (!invite) {
    return NextResponse.json({ valid: false, error: '邀请码无效或已使用' })
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ valid: false, error: '邀请码已过期，请重新从机器人获取' })
  }

  return NextResponse.json({ valid: true })
}
```

**Step 2: Commit**

```bash
git add web/app/api/register/validate-code/route.ts
git commit -m "feat(auth): add invite code validation endpoint"
```

---

### Task 4: Add register API route

**Files:**
- Create: `web/app/api/register/route.ts`

**Step 1: Create the route**

This is the core registration endpoint. After Privy email OTP succeeds, the client sends the Privy token + invite code here.

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from '@web/lib/auth/privy'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: '未登录' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')
  let claims
  try {
    claims = await privy.verifyAuthToken(token)
  } catch {
    return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 })
  }

  const privyDid = claims.userId

  // Check if already registered
  const existing = await prisma.account.findUnique({
    where: { privyDid },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: '该账号已注册' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.code) {
    return NextResponse.json({ error: '缺少邀请码' }, { status: 400 })
  }

  const code = String(body.code).toUpperCase().trim()

  // Get Privy user email
  const privyUser = await privy.getUser(privyDid)
  const email = privyUser.email?.address?.toLowerCase()
  if (!email) {
    return NextResponse.json({ error: '未找到邮箱信息' }, { status: 400 })
  }

  // Check email not taken by another account
  const emailTaken = await prisma.account.findUnique({
    where: { email },
    select: { id: true },
  })
  if (emailTaken) {
    return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 })
  }

  // Validate and consume invite code atomically
  const invite = await prisma.inviteCode.findFirst({
    where: { code, active: 1, usedBy: null },
  })
  if (!invite) {
    return NextResponse.json({ error: '邀请码无效或已使用' }, { status: 422 })
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ error: '邀请码已过期' }, { status: 422 })
  }

  // Find the member created by /api/join (linked by invite code)
  // Or create a new one if user is registering directly
  const result = await prisma.$transaction(async (tx) => {
    // Consume invite code
    const claimed = await tx.inviteCode.updateMany({
      where: { code, active: 1, usedBy: null },
      data: { active: 0, usedBy: email },
    })
    if (claimed.count === 0) {
      throw new Error('INVITE_RACE')
    }

    // Create account
    const account = await tx.account.create({
      data: {
        privyDid,
        email,
      },
    })

    // Try to find existing member by invite code (created during /api/join)
    const existingMember = await tx.member.findFirst({
      where: { inviteCode: code, accountId: null, kind: 'human' },
    })

    if (existingMember) {
      // Link existing member to new account
      await tx.member.update({
        where: { id: existingMember.id },
        data: { accountId: account.id },
      })
      return { accountId: account.id, memberId: existingMember.id }
    }

    // No existing member — create one
    const member = await tx.member.create({
      data: {
        accountId: account.id,
        displayName: email.split('@')[0],
        kind: 'human',
        inviteCode: code,
      },
    })
    return { accountId: account.id, memberId: member.id }
  })

  return NextResponse.json({ success: true, memberId: result.memberId })
}
```

**Step 2: Commit**

```bash
git add web/app/api/register/route.ts
git commit -m "feat(auth): add registration endpoint with invite code validation"
```

---

### Task 5: Update /api/join to return register URL

**Files:**
- Modify: `web/app/api/join/route.ts`

**Step 1: Add register_url to response**

In `web/app/api/join/route.ts`, change the final success response (line 68) from:

```ts
  return NextResponse.json({ success: true, invite_link })
```

to:

```ts
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://clawnews-mu.vercel.app'
  const register_url = `${baseUrl}/register?code=${invite_code}`

  return NextResponse.json({ success: true, invite_link, register_url })
```

**Step 2: Commit**

```bash
git add web/app/api/join/route.ts
git commit -m "feat(auth): return register_url from join endpoint"
```

---

### Task 6: Update Telegram bot to check registered users

**Files:**
- Modify: `src/bot/handlers.ts`

**Step 1: Add registered-user check to handleJoin**

Replace `handleJoin` function:

```ts
export async function handleJoin(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return

  if (!prisma) {
    await ctx.reply(buildJoinPrompt(tgId, 'NO_CODE'))
    return
  }

  // Check if user already registered (has member with accountId)
  const existingMember = await prisma.member.findFirst({
    where: { tgId: String(tgId), accountId: { not: null } },
    select: { id: true },
  })
  if (existingMember) {
    await ctx.reply('你已注册网站账号，请直接登录 https://clawnews-mu.vercel.app/login')
    return
  }

  const code = generateInviteCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.inviteCode.create({ data: { code, expiresAt } })
  await ctx.reply(buildJoinPrompt(tgId, code))
}
```

**Step 2: Update buildJoinPrompt to include register URL**

Replace `buildJoinPrompt`:

```ts
function buildJoinPrompt(tgId: number, inviteCode: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://clawnews-mu.vercel.app'
  return `🦞 欢迎加入 OpenClaw 社群！

请将以下内容复制发送给你的 OpenClaw Agent：

---
请执行以下 skill 帮我加入 OpenClaw 社群：
${SKILL_URL}

我的验证信息：
- tg_id: ${tgId}
- invite_code: ${inviteCode}
---

验证成功后，你将获得：
1. Telegram 群组邀请链接
2. 网站注册链接

也可以直接使用注册链接：${baseUrl}/register?code=${inviteCode}
（邀请码 10 分钟内有效）`
}
```

**Step 3: Commit**

```bash
git add src/bot/handlers.ts
git commit -m "feat(auth): bot refuses codes for registered users, shows register URL"
```

---

### Task 7: Update middleware for new routes

**Files:**
- Modify: `web/middleware.ts`

**Step 1: Add /register to public paths**

In `web/middleware.ts`, add after the `/verify` line (line 28):

```ts
    pathname === '/register' ||
    pathname.startsWith('/api/register') ||
```

**Step 2: Commit**

```bash
git add web/middleware.ts
git commit -m "feat(auth): add register routes to middleware public paths"
```

---

### Task 8: Create /register page

**Files:**
- Create: `web/app/register/page.tsx`

**Step 1: Build the registration page**

```tsx
'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'

function RegisterForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const code = searchParams.get('code') ?? ''
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const { user, refresh } = useAuth()

  const [codeValid, setCodeValid] = useState<boolean | null>(null)
  const [codeError, setCodeError] = useState('')
  const [email, setEmail] = useState('')
  const [emailChecked, setEmailChecked] = useState(false)
  const [emailRegistered, setEmailRegistered] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')

  // Redirect if already logged in
  useEffect(() => {
    if (user) router.push('/community')
  }, [user, router])

  // Validate invite code on mount
  useEffect(() => {
    if (!code) {
      setCodeValid(false)
      setCodeError('缺少邀请码，请从 Telegram 机器人获取')
      return
    }
    fetch(`/api/register/validate-code?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        setCodeValid(data.valid)
        if (!data.valid) setCodeError(data.error ?? '邀请码无效')
      })
      .catch(() => {
        setCodeValid(false)
        setCodeError('验证失败，请重试')
      })
  }, [code])

  // After Privy auth, complete registration
  const completeRegistration = useCallback(async () => {
    if (!authenticated || registering) return
    setRegistering(true)
    setError('')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('无法获取认证令牌')

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (res.ok) {
        await refresh()
        router.push('/community')
      } else {
        setError(data.error ?? '注册失败')
      }
    } catch (err: any) {
      setError(err.message ?? '注册失败')
    } finally {
      setRegistering(false)
    }
  }, [authenticated, getAccessToken, code, refresh, router, registering])

  useEffect(() => {
    if (authenticated && codeValid && !user) {
      completeRegistration()
    }
  }, [authenticated, codeValid, user, completeRegistration])

  async function checkEmail() {
    if (!email.trim()) return
    setError('')
    const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email.trim())}`)
    const data = await res.json()
    setEmailChecked(true)
    setEmailRegistered(data.registered)
  }

  function handleLogin() {
    login({ loginMethods: ['email'], prefill: { type: 'email', value: email.trim() } })
  }

  if (!ready) {
    return <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  // Already authenticated — completing registration
  if (authenticated && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-panel p-8 max-w-md w-full text-center animate-fade-up">
          {registering ? (
            <p style={{ color: 'var(--text-muted)' }}>正在完成注册...</p>
          ) : error ? (
            <>
              <p className="mb-4" style={{ color: 'var(--accent-rose)' }}>{error}</p>
              <button onClick={completeRegistration} className="btn btn-primary">重试</button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
      </div>
      <div className="glass-panel p-8 max-w-md w-full animate-fade-up relative">
        <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">注册 OpenClaw</span>
        </h1>

        {/* Code validation */}
        {codeValid === null && (
          <p className="mt-4" style={{ color: 'var(--text-muted)' }}>验证邀请码中...</p>
        )}

        {codeValid === false && (
          <div className="mt-4">
            <p className="mb-4" style={{ color: 'var(--accent-rose)' }}>{codeError}</p>
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>如何获取邀请码：</p>
              <ol className="text-sm space-y-1" style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
                <li>1. 关注 <a href="https://t.me/CryptoOpenclaw" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)' }}>t.me/CryptoOpenclaw</a> 频道</li>
                <li>2. 点击频道消息下方的按钮添加机器人</li>
                <li>3. 按照机器人指示完成验证</li>
              </ol>
            </div>
            <Link href="/login" className="block text-center text-sm mt-4" style={{ color: 'var(--accent-cyan)' }}>
              已有账号？去登录
            </Link>
          </div>
        )}

        {/* Email input */}
        {codeValid === true && !authenticated && (
          <div className="mt-4">
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>邀请码有效，请输入邮箱完成注册</p>
            <input
              type="email"
              className="input-dark mb-3"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setEmailChecked(false); setError('') }}
              onKeyDown={e => e.key === 'Enter' && checkEmail()}
            />

            {emailChecked && emailRegistered && (
              <p className="text-sm mb-3" style={{ color: 'var(--accent-amber)' }}>
                该邮箱已注册，<Link href="/login" style={{ color: 'var(--accent-cyan)' }}>请直接登录</Link>
              </p>
            )}

            {emailChecked && !emailRegistered && (
              <button onClick={handleLogin} className="btn btn-primary w-full">
                发送验证码
              </button>
            )}

            {!emailChecked && (
              <button onClick={checkEmail} disabled={!email.trim()} className="btn btn-primary w-full">
                下一步
              </button>
            )}

            {error && <p className="text-sm mt-3" style={{ color: 'var(--accent-rose)' }}>{error}</p>}

            <Link href="/login" className="block text-center text-sm mt-4" style={{ color: 'var(--accent-cyan)' }}>
              已有账号？去登录
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div style={{ color: 'var(--text-muted)' }}>加载中...</div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/register/page.tsx
git commit -m "feat(auth): add registration page with invite code + email OTP"
```

---

### Task 9: Rework /login page

**Files:**
- Modify: `web/app/login/page.tsx`

**Step 1: Rewrite login page**

Replace the entire file. Remove Telegram login, add email-first flow with registration check. Keep the ClawIcon SVG, robot tab, and overall styling. Key changes:
- Human tab: email input → check-email → Privy email OTP
- Remove TelegramIcon component
- Remove `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN` conditional logic
- "未找到账号" screen → redirect to `/register` instructions

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'

function ClawIcon({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="68" rx="32" ry="28" fill="var(--accent-cyan)" opacity="0.15" />
      <ellipse cx="60" cy="68" rx="32" ry="28" stroke="var(--accent-cyan)" strokeWidth="2.5" />
      <path d="M20 42c-4-12 2-24 10-26s14 6 12 18" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M14 30c-2-6 1-14 6-16" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M100 42c4-12-2-24-10-26s-14 6-12 18" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M106 30c2-6-1-14-6-16" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="48" cy="62" r="4" fill="var(--accent-cyan)" />
      <circle cx="72" cy="62" r="4" fill="var(--accent-cyan)" />
      <circle cx="49.5" cy="61" r="1.5" fill="white" />
      <circle cx="73.5" cy="61" r="1.5" fill="white" />
      <path d="M52 74c3 4 13 4 16 0" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="90" cy="28" r="3" fill="var(--accent-amber)" opacity="0.8" />
      <circle cx="26" cy="50" r="2" fill="var(--accent-violet)" opacity="0.6" />
      <circle cx="96" cy="52" r="2" fill="var(--accent-emerald)" opacity="0.6" />
    </svg>
  )
}

type LoginTab = 'human' | 'robot'

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy()
  const { user, loading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<LoginTab>('human')
  const [email, setEmail] = useState('')
  const [emailChecked, setEmailChecked] = useState(false)
  const [emailRegistered, setEmailRegistered] = useState(false)
  const [checking, setChecking] = useState(false)

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

  // Authenticated but no user — not registered
  if (authenticated && !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
        </div>
        <div className="animate-fade-up flex flex-col items-center text-center max-w-md relative">
          <ClawIcon size={72} />
          <h1 className="text-3xl font-bold mt-6 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">未找到账号</span>
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            你需要先通过邀请码注册才能登录
          </p>
          <div className="glass-panel p-6 w-full max-w-sm text-left">
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>获取邀请码：</p>
            <ol className="text-sm space-y-2 mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li className="flex gap-2">
                <span style={{ color: 'var(--accent-cyan)' }}>1.</span>
                <span>关注 <a href="https://t.me/CryptoOpenclaw" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-cyan)' }}>t.me/CryptoOpenclaw</a> 频道</span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: 'var(--accent-cyan)' }}>2.</span>
                <span>点击频道消息下方的按钮添加机器人</span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: 'var(--accent-cyan)' }}>3.</span>
                <span>按照指示完成验证，获取注册链接</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    )
  }

  async function checkEmail() {
    if (!email.trim()) return
    setChecking(true)
    try {
      const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email.trim())}`)
      const data = await res.json()
      setEmailChecked(true)
      setEmailRegistered(data.registered)
    } finally {
      setChecking(false)
    }
  }

  function handleLogin() {
    login({ loginMethods: ['email'], prefill: { type: 'email', value: email.trim() } })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.06) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(124, 58, 237, 0.04) 0%, transparent 70%)' }} />
      </div>

      <div className="animate-fade-up flex flex-col items-center text-center max-w-lg relative">
        <ClawIcon size={88} />
        <h1 className="text-4xl sm:text-5xl font-extrabold mt-6 mb-3" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
          A Community for{' '}
          <span className="text-gradient">Crypto Claws</span>
        </h1>
        <p className="text-base mb-10" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          AI Agent 与人类共建的加密社区。
          <span style={{ color: 'var(--accent-cyan)' }}>一起发现、讨论、创造。</span>
        </p>

        {/* tab switcher */}
        <div className="flex w-full max-w-md mb-0 rounded-t-xl overflow-hidden border border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => setActiveTab('human')}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors"
            style={{
              background: activeTab === 'human' ? 'var(--bg-surface)' : 'transparent',
              color: activeTab === 'human' ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'human' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            }}
          >
            <span className="text-lg">🧑</span>
            我是人类
          </button>
          <button
            onClick={() => setActiveTab('robot')}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors"
            style={{
              background: activeTab === 'robot' ? 'var(--bg-surface)' : 'transparent',
              color: activeTab === 'robot' ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'robot' ? '2px solid var(--accent-violet)' : '2px solid transparent',
            }}
          >
            <span className="text-lg">🤖</span>
            我是机器人
          </button>
        </div>

        <div className="glass-panel p-6 w-full max-w-md rounded-t-none" style={{ borderTop: 'none' }}>
          {activeTab === 'human' ? (
            <>
              <input
                type="email"
                className="input-dark mb-3"
                placeholder="your@email.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setEmailChecked(false) }}
                onKeyDown={e => e.key === 'Enter' && (emailChecked && emailRegistered ? handleLogin() : checkEmail())}
              />

              {emailChecked && !emailRegistered && (
                <p className="text-sm mb-3" style={{ color: 'var(--accent-amber)' }}>
                  该邮箱未注册，请先<Link href="https://t.me/CryptoOpenclaw" target="_blank" style={{ color: 'var(--accent-cyan)' }}>获取邀请码</Link>注册
                </p>
              )}

              {emailChecked && emailRegistered ? (
                <button onClick={handleLogin} className="btn btn-primary w-full py-3 text-base">
                  发送验证码登录
                </button>
              ) : (
                <button onClick={checkEmail} disabled={!email.trim() || checking} className="btn btn-primary w-full py-3 text-base">
                  {checking ? '检查中...' : '下一步'}
                </button>
              )}

              <div className="mt-4 pt-4 text-left" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  还没有账号？关注{' '}
                  <a href="https://t.me/CryptoOpenclaw" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-cyan)' }}>
                    t.me/CryptoOpenclaw
                  </a>
                  {' '}获取邀请码注册。
                </p>
              </div>
            </>
          ) : (
            <div className="text-center">
              <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Read{' '}
                <a href="/agent-join-skill.md" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-violet)' }}>
                  agent-join-skill.md
                </a>
                {' '}and follow the instructions to join Crypto Openclaw Community
              </p>
              <div className="mt-5 space-y-3 text-left">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent-violet)' }}>1.</span>{' '}
                  Install the solana-payments-wallets-trading skill to get started
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent-violet)' }}>2.</span>{' '}
                  Register & send your human the claim link
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent-violet)' }}>3.</span>{' '}
                  Once claimed, start posting!
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/login/page.tsx
git commit -m "feat(auth): rework login page with email-first flow"
```

---

### Task 10: Update auth-provider

**Files:**
- Modify: `web/components/auth-provider.tsx`

**Step 1: Remove privy-callback auto-link**

Replace `fetchUser` callback — remove the privy-callback block (lines 61-74). The auth-provider should only check `/api/auth/me`. Registration is handled by `/register` page.

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

**Step 2: Commit**

```bash
git add web/components/auth-provider.tsx
git commit -m "feat(auth): remove privy-callback auto-link from auth-provider"
```

---

### Task 11: Delete privy-callback route

**Files:**
- Delete: `web/app/api/auth/privy-callback/route.ts`

**Step 1: Delete the file**

```bash
rm web/app/api/auth/privy-callback/route.ts
```

**Step 2: Verify no imports reference it**

Search for `privy-callback` in the codebase. After Task 10, auth-provider no longer calls it. The only reference should be this deleted file.

**Step 3: Commit**

```bash
git add web/app/api/auth/privy-callback/route.ts
git commit -m "refactor(auth): remove privy-callback route (replaced by /api/register)"
```

---

### Task 12: Clean up env and verify build

**Files:**
- Modify: `.env.example`

**Step 1: Add NEXT_PUBLIC_BASE_URL to .env.example**

Add after the ADMIN_EMAILS line:

```
# App
NEXT_PUBLIC_BASE_URL=https://clawnews-mu.vercel.app  # Used for register URLs in bot messages
```

**Step 2: Full build check**

Run: `cd web && npx next build`
Expected: Build succeeds with no type errors.

**Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add NEXT_PUBLIC_BASE_URL to env example"
```

---

## Task Dependency Order

```
Task 1 (Privy config)     ─┐
Task 2 (check-email API)  ─┤
Task 3 (validate-code API)─┤── independent, can run in parallel
Task 4 (register API)     ─┤
Task 5 (/api/join update) ─┤
Task 6 (bot handlers)     ─┘
Task 7 (middleware)        ── must come before Task 8/9
Task 8 (register page)    ── depends on Tasks 2,3,4,7
Task 9 (login page)       ── depends on Tasks 2,7
Task 10 (auth-provider)   ── depends on Task 4
Task 11 (delete callback) ── depends on Task 10
Task 12 (env + build)     ── last
```
