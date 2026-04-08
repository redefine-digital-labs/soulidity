# Agent API Migration to Soulidity Implementation Plan

> **STATUS: COMPLETED & SUPERSEDED** — This plan was executed and the migration is done. Some code examples below reference old route shapes (`[versionId]`) and old fields (`versionOnChainId`) that no longer exist. The current implementation uses `[skillName]/versions/[versionIndex]` routes and `(skillsOnChainId, skillName, versionIndex)` composite keys. See `new-web/app/api/agent/souls/` for the current implementation.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Agent API from legacy `web/` (allowlist) to `new-web/` (Soulidity Grant system), so all agent operations run on port 3100 via Grant-based access control.

**Architecture:** New `requireAgentWalletIdentity` middleware extracts `sk-*` API key, resolves agent identity + wallet addresses. Agent API routes under `new-web/app/api/agent/` reuse existing Soulidity SDK (`resolveSoulAccessPayload`, `buildBuySoulTx`, `quoteSoulPurchase`, `syncSoulProjectionFromChain`). Purchase uses two-step deferred signing (prepare → execute) via `SoulPreparedPurchase` model.

**Tech Stack:** Next.js 16 App Router, Prisma (shared schema), @mysten/sui, Soulidity Move contracts (grant.move, seal_policy.move, market.move)

---

## Task 1: Agent Auth Middleware

**Files:**
- Create: `new-web/lib/soulidity/agent-server.ts`
- Test: `tests/new-web/soulidity-agent-server.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/new-web/soulidity-agent-server.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/resolve-agent', () => ({ resolveAgentByApiKey: mockedResolveAgentByApiKey }))
vi.mock('@web/lib/auth/sui-wallet', () => ({ getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses }))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '127.0.0.1',
}))

import { requireAgentWalletIdentity } from '../../new-web/lib/soulidity/agent-server'

function makeRequest(authHeader?: string) {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new Request('http://localhost:3100/api/agent/test', { headers })
}

describe('requireAgentWalletIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false })
  })

  it('returns 401 when no Authorization header', async () => {
    const result = await requireAgentWalletIdentity(makeRequest())
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 401 when token is not sk- prefixed', async () => {
    const result = await requireAgentWalletIdentity(makeRequest('Bearer eyJ...'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 401 when API key is invalid', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue(null)
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-invalid'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 403 when agent has no wallet', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([])
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-valid'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(403)
    }
  })

  it('returns agent identity + wallet addresses on success', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue(['0xabc'])
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-valid'))
    expect('agent' in result).toBe(true)
    if ('agent' in result) {
      expect(result.agent.agentMemberId).toBe('agent-1')
      expect(result.walletAddresses).toEqual(['0xabc'])
    }
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/new-web/soulidity-agent-server.test.ts
```
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// new-web/lib/soulidity/agent-server.ts
import { NextResponse } from 'next/server'
import { resolveAgentByApiKey, type AgentIdentity } from '@web/lib/auth/resolve-agent'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'

const FAILED_AGENT_AUTH_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

function errorResponse(body: { error: string }, status: number) {
  return NextResponse.json(body, { status })
}

async function rateLimitFailedAuth(request: Request) {
  const ip = getRequestIp(new Headers(request.headers))
  if (ip) {
    const rl = await takeRateLimitToken(`agent-auth-failed:${ip}`, FAILED_AGENT_AUTH_LIMIT)
    if (rl.limited) {
      return errorResponse(
        { error: 'Too many invalid API key attempts' },
        429,
      )
    }
  }
  return errorResponse({ error: 'Unauthorized' }, 401)
}

export async function requireAgentWalletIdentity(
  request: Request,
): Promise<
  | { agent: AgentIdentity; walletAddresses: string[] }
  | { error: NextResponse }
> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return { error: errorResponse({ error: 'Unauthorized' }, 401) }
  }

  if (!authHeader.startsWith('Bearer sk-')) {
    return { error: await rateLimitFailedAuth(request) }
  }

  const apiKey = authHeader.slice(7) // "Bearer ".length
  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) {
    return { error: await rateLimitFailedAuth(request) }
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(agent.agentMemberId)
  } catch {
    return { error: errorResponse({ error: 'Failed to resolve agent wallet' }, 500) }
  }

  if (walletAddresses.length === 0) {
    return {
      error: errorResponse({ error: 'Agent has no bound Sui wallet' }, 403),
    }
  }

  return { agent, walletAddresses }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/new-web/soulidity-agent-server.test.ts
```
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add new-web/lib/soulidity/agent-server.ts tests/new-web/soulidity-agent-server.test.ts
git commit -m "feat(agent-api): add requireAgentWalletIdentity middleware for Soulidity Agent API"
```

---

## Task 2: Agent Soul Access Route

**Files:**
- Create: `new-web/app/api/agent/souls/[id]/access/route.ts`

**Depends on:** Task 1

**Step 1: Write the route**

```typescript
// new-web/app/api/agent/souls/[id]/access/route.ts
import { NextResponse } from 'next/server'
import { hasSealSessionConfig } from '@web/lib/services/seal'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { resolveSoulAccessPayload, SoulAccessDeniedError } from '@/lib/soulidity/access'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_ACCESS_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-access:${auth.agent.agentMemberId}`,
    AGENT_ACCESS_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent access requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  try {
    const payload = await resolveSoulAccessPayload({
      soul: toSoulAssetDetail(soul, {
        viewerMemberId: auth.agent.agentMemberId,
        viewerAddresses: auth.walletAddresses,
        quote: null,
      }),
      viewerAddresses: auth.walletAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })
    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof SoulAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[agent-soul-access] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      soulId: id,
      error,
    })
    return NextResponse.json({ error: 'Failed to resolve agent access' }, { status: 500 })
  }
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/\[id\]/access/route.ts
git commit -m "feat(agent-api): add agent Soul access route via SoulGrant"
```

---

## Task 3: Agent Soul Detail Route

**Files:**
- Create: `new-web/app/api/agent/souls/[id]/route.ts`

**Step 1: Write the route**

```typescript
// new-web/app/api/agent/souls/[id]/route.ts
import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { getMarketConfig, quoteSoulPurchase } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_DETAIL_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-detail:${auth.agent.agentMemberId}`,
    AGENT_DETAIL_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent detail requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  let quote = null
  if (soul.listingStatus === 'listed' && soul.listedPriceAtomic) {
    try {
      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const configId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
      const config = await getMarketConfig(configId, packageId)
      quote = quoteSoulPurchase(config, {
        priceAtomic: BigInt(soul.listedPriceAtomic.toString()),
        creatorRoyaltyBps: soul.creatorRoyaltyBps,
        collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
      })
    } catch {
      // quote is optional — continue without it
    }
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote,
  })

  return NextResponse.json(detail)
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/\[id\]/route.ts
git commit -m "feat(agent-api): add agent Soul detail route"
```

---

## Task 4: Agent Soul Search Route

**Files:**
- Create: `new-web/app/api/agent/souls/search/route.ts`

**Step 1: Write the route**

```typescript
// new-web/app/api/agent/souls/search/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_SEARCH_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

export async function GET(request: NextRequest) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-search:${auth.agent.agentMemberId}`,
    AGENT_SEARCH_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent search requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim().slice(0, 200) || ''
  const category = url.searchParams.get('category')?.trim().slice(0, 200) || ''
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const where: Record<string, unknown> = { listingStatus: 'listed' }
  if (category) where.category = { equals: category, mode: 'insensitive' }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { tags: { has: q } },
    ]
  }

  const items = await prisma.soulAsset.findMany({
    where,
    select: soulAssetSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })

  return NextResponse.json({
    items: toSoulAssetSummaryList(items),
    offset,
    limit,
  })
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/search/route.ts
git commit -m "feat(agent-api): add agent Soul search route"
```

---

## Task 5: Agent Purchase Prepare Route

**Files:**
- Create: `new-web/app/api/agent/souls/[id]/purchase/route.ts`

**Step 1: Write the route**

This is the most complex route. The agent can't sign in-browser — we build the TX server-side, return unsigned bytes, and agent signs locally.

```typescript
// new-web/app/api/agent/souls/[id]/purchase/route.ts
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getMarketConfig, quoteSoulPurchase } from '@/lib/soulidity/queries'
import { resolveOwnedPersonalKiosk } from '@/lib/soulidity/personal-kiosk'
import { buildBuySoulTx } from '@/lib/soulidity/tx/buy'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'
import { selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'

export const dynamic = 'force-dynamic'

const AGENT_PURCHASE_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const
const PREPARED_PURCHASE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const PAYMENT_COIN_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-purchase:${auth.agent.agentMemberId}`,
    AGENT_PURCHASE_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent purchase requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (soul.listingStatus !== 'listed' || !soul.listingObjectOnChainId || !soul.listedPriceAtomic) {
    return NextResponse.json({ error: 'Soul is not listed for sale' }, { status: 409 })
  }

  const agentAddress = auth.walletAddresses[0]!
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const configId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')

  try {
    const config = await getMarketConfig(configId, packageId)
    const quote = quoteSoulPurchase(config, {
      priceAtomic: BigInt(soul.listedPriceAtomic.toString()),
      creatorRoyaltyBps: soul.creatorRoyaltyBps,
      collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
    })

    const kioskResult = await resolveOwnedPersonalKiosk({ ownerAddresses: auth.walletAddresses })
    const buyerKioskId = kioskResult.status === 'ready' ? kioskResult.kiosk.currentKioskId : null
    const buyerKioskCapOnChainId = kioskResult.status === 'ready' ? kioskResult.kiosk.currentKioskCapOnChainId : null

    const coinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
      owner: agentAddress,
      coinType: PAYMENT_COIN_TYPE,
      requiredAmount: quote.totalAtomic,
    })
    if (!coinIds || coinIds.length === 0) {
      return NextResponse.json({ error: 'Insufficient USDC balance for purchase' }, { status: 402 })
    }

    const tx = buildBuySoulTx({
      sellerKioskId: soul.currentKioskId,
      stateObjectId: soul.stateOnChainId,
      listingObjectId: soul.listingObjectOnChainId,
      totalAtomic: quote.totalAtomic,
      paymentCoinObjectIds: coinIds,
      collectionObjectId: soul.collectionOnChainId ?? null,
      buyerKioskId,
      buyerKioskCapOnChainId,
    })
    tx.setSender(agentAddress)

    const txBytes = await tx.build({ client: suiClient })
    const txBytesBase64 = Buffer.from(txBytes).toString('base64')
    const txBytesHash = createHash('sha256').update(txBytes).digest('hex')

    const expiresAt = new Date(Date.now() + PREPARED_PURCHASE_TTL_MS)

    const prepared = await prisma.soulPreparedPurchase.create({
      data: {
        agentMemberId: auth.agent.agentMemberId,
        soulOnChainId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        sellerKioskId: soul.currentKioskId,
        agentAddress,
        priceAtomic: soul.listedPriceAtomic,
        platformFeeAtomic: quote.platformFeeAtomic,
        creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic,
        totalAtomic: quote.totalAtomic,
        txBytesBase64,
        txBytesHash,
        expiresAt,
      },
    })

    return NextResponse.json({
      preparedPurchaseId: prepared.id,
      txBytes: txBytesBase64,
      context: {
        soulOnChainId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        sellerKioskId: soul.currentKioskId,
        priceAtomic: soul.listedPriceAtomic.toString(),
        platformFeeAtomic: quote.platformFeeAtomic.toString(),
        creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic.toString(),
        totalAtomic: quote.totalAtomic.toString(),
        agentAddress,
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[agent-purchase-prepare] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to prepare purchase transaction' }, { status: 500 })
  }
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/\[id\]/purchase/route.ts
git commit -m "feat(agent-api): add agent purchase prepare route (deferred signing)"
```

---

## Task 6: Agent Purchase Execute Route

**Files:**
- Create: `new-web/app/api/agent/souls/[id]/purchase/execute/route.ts`

**Step 1: Write the route**

```typescript
// new-web/app/api/agent/souls/[id]/purchase/execute/route.ts
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { extractSoulPurchasedEvent } from '@/lib/soulidity/events'
import {
  endActiveSoulGrantProjectionsFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_EXECUTE_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-execute:${auth.agent.agentMemberId}`,
    AGENT_EXECUTE_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent execute requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const preparedPurchaseId = typeof body?.preparedPurchaseId === 'string' ? body.preparedPurchaseId.trim() : null
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : null

  if (!preparedPurchaseId || !signature) {
    return NextResponse.json({ error: 'preparedPurchaseId and signature are required' }, { status: 400 })
  }

  const prepared = await prisma.soulPreparedPurchase.findUnique({
    where: { id: preparedPurchaseId },
  })
  if (!prepared) {
    return NextResponse.json({ error: 'Prepared purchase not found' }, { status: 404 })
  }
  if (prepared.agentMemberId !== auth.agent.agentMemberId) {
    return NextResponse.json({ error: 'Prepared purchase belongs to a different agent' }, { status: 403 })
  }
  if (prepared.executedAt) {
    if (prepared.resultBody && prepared.resultStatusCode) {
      return NextResponse.json(prepared.resultBody, { status: prepared.resultStatusCode })
    }
    return NextResponse.json({ error: 'Purchase already executed' }, { status: 409 })
  }
  if (new Date() > prepared.expiresAt) {
    return NextResponse.json({ error: 'Prepared purchase has expired' }, { status: 410 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  // Verify signature matches stored TX bytes
  const txBytes = Buffer.from(prepared.txBytesBase64, 'base64')
  const storedHash = prepared.txBytesHash
  const computedHash = createHash('sha256').update(txBytes).digest('hex')
  if (storedHash !== computedHash) {
    return NextResponse.json({ error: 'TX bytes integrity check failed' }, { status: 422 })
  }

  // Check idempotency cache
  const stored = await getStoredSoulidityTxSync({
    routeKey: 'agent-buy',
    txDigest: preparedPurchaseId,
    actorKey: auth.agent.agentMemberId,
    resourceKey: soul.onChainId,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  try {
    // Mark as executing
    await prisma.soulPreparedPurchase.update({
      where: { id: preparedPurchaseId },
      data: { executedAt: new Date() },
    })

    // Execute transaction
    const executeResult = await suiClient.executeTransactionBlock({
      transactionBlock: prepared.txBytesBase64,
      signature,
      options: { showEffects: true, showEvents: true },
    })

    const txDigest = executeResult.digest
    await waitForTransactionBestEffort(txDigest)

    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderAddress = readTransactionSender(transaction)

    if (!senderAddress || !auth.walletAddresses.some(
      (addr) => addr.toLowerCase() === senderAddress.toLowerCase(),
    )) {
      return NextResponse.json({ error: 'Transaction sender does not match agent wallet' }, { status: 422 })
    }

    const purchased = extractSoulPurchasedEvent(transaction, packageId)
    if (purchased.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction purchased a different Soul' }, { status: 422 })
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      memoryObjectId: soul.memoryOnChainId,
      category: soul.category,
      tags: soul.tags,
      previewImages: soul.previewImages,
      readme: soul.readme,
      sealSidecar: soul.sealSidecar as never,
      creatorMemberId: soul.creatorMemberId,
      currentOwnerMemberId: auth.agent.agentMemberId,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
    })

    await endActiveSoulGrantProjectionsFromChain({
      soulOnChainId: mirrored.onChainId,
      status: 'invalidated',
    })

    const responseBody = {
      digest: txDigest,
      soulOnChainId: mirrored.onChainId,
      currentOwnerAddress: mirrored.currentOwnerAddress,
      currentKioskId: mirrored.currentKioskId,
      currentKioskCapOnChainId: mirrored.currentKioskCapOnChainId,
      listingStatus: mirrored.listingStatus,
    }

    await prisma.soulPreparedPurchase.update({
      where: { id: preparedPurchaseId },
      data: {
        executionTxDigest: txDigest,
        resultStatusCode: 200,
        resultBody: responseBody,
      },
    })

    await storeSoulidityTxSync({
      routeKey: 'agent-buy',
      txDigest: preparedPurchaseId,
      actorKey: auth.agent.agentMemberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[agent-purchase-execute] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      preparedPurchaseId,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to execute purchase transaction' }, { status: 500 })
  }
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/\[id\]/purchase/execute/route.ts
git commit -m "feat(agent-api): add agent purchase execute route with mirror sync"
```

---

## Task 7: Agent Skills Access Route

**Files:**
- Create: `new-web/app/api/agent/souls/[id]/skills/[versionId]/access/route.ts`

**Step 1: Write the route**

Mirror the human skills access route but with agent auth. Public visibility returns blob URL directly; private requires owner or grant with `skills` scope.

```typescript
// new-web/app/api/agent/souls/[id]/skills/[versionId]/access/route.ts
import { NextResponse } from 'next/server'
import { getBlobUrl } from '@web/lib/services/walrus'
import { getSealRuntimeConfig, getSealSessionTtlMinutes, hasSealSessionConfig } from '@web/lib/services/seal'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getSoulGrantObject, getSoulStateObject, normalizeSuiValue, sameSuiValue } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_SKILL_ACCESS_RATE_LIMIT = { max: 30, windowMs: 60 * 1000 } as const

function buildSkillDocumentId(versionId: string) {
  const normalized = normalizeSuiValue(versionId)
  if (!normalized) throw new Error('Skill version id is malformed')
  const hex = normalized.replace(/^0x/, '').padStart(64, '0')
  const versionBytes = Buffer.from(hex, 'hex')
  const domainBytes = Buffer.from('soul-skill:', 'utf8')
  const nonceBytes = Buffer.alloc(16, 0x5a)
  return Buffer.concat([domainBytes, Buffer.from([1]), versionBytes, nonceBytes]).toString('hex')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) return NextResponse.json({ error: 'Soul not found' }, { status: 404 })

  const version = await prisma.soulSkillVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      OR: [{ id: versionId }, { versionOnChainId: versionId.toLowerCase() }],
    },
  })
  if (!version) return NextResponse.json({ error: 'Skill version not found' }, { status: 404 })
  if (version.deletedAt) return NextResponse.json({ error: 'Skill version has been deleted' }, { status: 410 })

  if (version.visibility === 'public') {
    return NextResponse.json({
      visibility: 'public',
      artifact: {
        walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
        walrusBlobId: version.blobId,
        blobObjectId: version.blobObjectId,
      },
    })
  }

  // Private version — requires agent auth
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-skill-access:${auth.agent.agentMemberId}`,
    AGENT_SKILL_ACCESS_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent skill access requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) return NextResponse.json({ error: 'Seal session not configured' }, { status: 503 })
  if (!version.sealSidecar) return NextResponse.json({ error: 'Private skill Seal sidecar missing' }, { status: 409 })
  if (!soul.skillsOnChainId) return NextResponse.json({ error: 'Soul skills root missing' }, { status: 409 })

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const state = await getSoulStateObject(soul.stateOnChainId, packageId)
  const viewerAddresses = auth.walletAddresses
    .map((a) => normalizeSuiValue(a))
    .filter((v): v is string => v != null)

  const ownerMatch = viewerAddresses.find((a) => sameSuiValue(a, state.currentOwnerAddress))
  if (ownerMatch) {
    return NextResponse.json({
      visibility: 'private',
      artifact: { walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null, walrusBlobId: version.blobId, blobObjectId: version.blobObjectId },
      accessPolicy: {
        packageId, stateObjectId: soul.stateOnChainId, skillsObjectId: soul.skillsOnChainId,
        versionObjectId: version.versionOnChainId, moduleName: 'skills',
        functionName: 'approve_private_read_owner', soulGrantObjectId: null,
        documentIdHex: buildSkillDocumentId(version.versionOnChainId),
      },
      seal: getSealRuntimeConfig(), sealSidecar: version.sealSidecar,
      viewerAddress: ownerMatch, accessKind: 'owner', sessionTtlMin: getSealSessionTtlMinutes(),
    })
  }

  const activeSlot = state.activeGrants.find((slot) =>
    slot.scopes.includes('skills') && viewerAddresses.some((a) => sameSuiValue(a, slot.granteeAddress)),
  )
  if (!activeSlot) return NextResponse.json({ error: 'Only the owner or an active skills grant can access this version' }, { status: 403 })

  const grant = await getSoulGrantObject(activeSlot.grantId, packageId)
  const viewerMatch = viewerAddresses.find((a) => sameSuiValue(a, grant.granteeAddress))
  if (!viewerMatch) return NextResponse.json({ error: 'Grant does not belong to this wallet' }, { status: 403 })
  if (grant.expiresAtMs != null && grant.expiresAtMs < Date.now()) return NextResponse.json({ error: 'Grant has expired' }, { status: 403 })
  if (!grant.scopes.includes('skills')) return NextResponse.json({ error: 'Grant does not allow skills access' }, { status: 403 })

  return NextResponse.json({
    visibility: 'private',
    artifact: { walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null, walrusBlobId: version.blobId, blobObjectId: version.blobObjectId },
    accessPolicy: {
      packageId, stateObjectId: soul.stateOnChainId, skillsObjectId: soul.skillsOnChainId,
      versionObjectId: version.versionOnChainId, moduleName: 'skills',
      functionName: 'approve_private_read_granted_agent', soulGrantObjectId: grant.objectId,
      documentIdHex: buildSkillDocumentId(version.versionOnChainId),
    },
    seal: getSealRuntimeConfig(), sealSidecar: version.sealSidecar,
    viewerAddress: viewerMatch, accessKind: 'granted-agent', sessionTtlMin: getSealSessionTtlMinutes(),
  })
}
```

**Step 2: Commit**

```bash
git add new-web/app/api/agent/souls/\[id\]/skills/\[versionId\]/access/route.ts
git commit -m "feat(agent-api): add agent skills access route (owner + granted-agent)"
```

---

## Task 8: Integration Test for Agent Access

**Files:**
- Create: `tests/new-web/soulidity-agent-access-route.test.ts`

**Step 1: Write integration test**

Test the agent access route with mocked dependencies — verifying the Grant-based flow end to end.

```typescript
// tests/new-web/soulidity-agent-access-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SOUL_ID = '0x' + 'a1'.repeat(32)
const STATE_ID = '0x' + 'b2'.repeat(32)
const AGENT_ADDRESS = '0x' + 'c3'.repeat(32)
const GRANT_ID = '0x' + 'd4'.repeat(32)

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAsset = vi.hoisted(() => vi.fn())
const mockedResolveSoulAccessPayload = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedToSoulAssetDetail = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/resolve-agent', () => ({ resolveAgentByApiKey: mockedResolveAgentByApiKey }))
vi.mock('@web/lib/auth/sui-wallet', () => ({ getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses }))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '127.0.0.1',
}))
vi.mock('@web/lib/services/seal', () => ({
  hasSealSessionConfig: mockedHasSealSessionConfig,
  hasCredentialedSealServerConfigs: () => false,
  getSealRuntimeConfig: () => ({ serverConfigs: [] }),
  getSealSessionTtlMinutes: () => 5,
}))

vi.mock('../../new-web/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAsset,
  toSoulAssetDetail: mockedToSoulAssetDetail,
}))
vi.mock('../../new-web/lib/soulidity/access', () => ({
  resolveSoulAccessPayload: mockedResolveSoulAccessPayload,
  SoulAccessDeniedError: class extends Error {
    status: number
    constructor(message: string, status = 403) { super(message); this.status = status }
  },
}))
vi.mock('../../new-web/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: () => '0xpackage',
}))

// Dynamic import after mocks
const { GET } = await import('../../new-web/app/api/agent/souls/[id]/access/route')

function makeRequest(apiKey?: string) {
  const headers = new Headers()
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)
  return new Request('http://localhost:3100/api/agent/souls/test/access', { headers })
}

describe('GET /api/agent/souls/[id]/access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false })
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1', ownerMemberId: 'owner-1', accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([AGENT_ADDRESS])
  })

  it('returns 401 without API key', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: SOUL_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for missing soul', async () => {
    mockedFindSoulAsset.mockResolvedValue(null)
    const res = await GET(makeRequest('sk-valid'), { params: Promise.resolve({ id: SOUL_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 200 with access payload for granted agent', async () => {
    const soulRecord = { onChainId: SOUL_ID, stateOnChainId: STATE_ID }
    mockedFindSoulAsset.mockResolvedValue(soulRecord)
    mockedToSoulAssetDetail.mockReturnValue(soulRecord)
    mockedResolveSoulAccessPayload.mockResolvedValue({
      accessKind: 'granted-agent',
      accessPolicy: { functionName: 'seal_approve_granted_agent', soulGrantObjectId: GRANT_ID },
      viewerAddress: AGENT_ADDRESS,
    })
    const res = await GET(makeRequest('sk-valid'), { params: Promise.resolve({ id: SOUL_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessKind).toBe('granted-agent')
    expect(body.accessPolicy.functionName).toBe('seal_approve_granted_agent')
  })

  it('returns 403 when agent has no grant', async () => {
    const { SoulAccessDeniedError } = await import('../../new-web/lib/soulidity/access')
    mockedFindSoulAsset.mockResolvedValue({ onChainId: SOUL_ID, stateOnChainId: STATE_ID })
    mockedToSoulAssetDetail.mockReturnValue({})
    mockedResolveSoulAccessPayload.mockRejectedValue(
      new SoulAccessDeniedError('Only the owner or the active granted agent can access this Soul'),
    )
    const res = await GET(makeRequest('sk-valid'), { params: Promise.resolve({ id: SOUL_ID }) })
    expect(res.status).toBe(403)
  })
})
```

**Step 2: Run tests**

```bash
npm test -- tests/new-web/soulidity-agent-access-route.test.ts
```

**Step 3: Commit**

```bash
git add tests/new-web/soulidity-agent-access-route.test.ts
git commit -m "test(agent-api): add integration tests for agent Soul access route"
```

---

## Task 9: Run Full Test Suite + Verify

**Step 1: Run all tests**

```bash
npm test
```

Expected: All existing tests pass + new agent tests pass.

**Step 2: Type-check new-web**

```bash
cd new-web && npm run typecheck
```

Expected: No type errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(agent-api): complete Soulidity Agent API migration — access, detail, search, purchase, skills"
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `new-web/lib/soulidity/agent-server.ts` | Agent auth middleware |
| `new-web/app/api/agent/souls/[id]/access/route.ts` | Seal access (owner/granted-agent) |
| `new-web/app/api/agent/souls/[id]/route.ts` | Soul detail with quote |
| `new-web/app/api/agent/souls/search/route.ts` | Search listed souls |
| `new-web/app/api/agent/souls/[id]/purchase/route.ts` | Prepare purchase TX |
| `new-web/app/api/agent/souls/[id]/purchase/execute/route.ts` | Execute signed purchase |
| `new-web/app/api/agent/souls/[id]/skills/[versionId]/access/route.ts` | Skills Seal access |
| `tests/new-web/soulidity-agent-server.test.ts` | Auth middleware tests |
| `tests/new-web/soulidity-agent-access-route.test.ts` | Access route tests |
