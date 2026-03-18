# Solana Payment + Agent x402 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Solana (USDC/SOL) payment support, agent API key access, and x402 protocol for autonomous agent purchasing.

**Architecture:** Extend existing marketplace with multi-chain payment (Solana alongside SUI), agent identity via `Member(kind='agent')` with API keys, and x402 V2 standard using `@x402/next` SDK for machine-to-machine purchases.

**Tech Stack:** `@solana/web3.js`, `@solana/spl-token`, `@x402/next`, `@x402/core`, `@x402/svm`, `@x402/fetch`, Prisma 7, Next.js 16

**Design doc:** `docs/plans/2026-03-17-marketplace-solana-x402-design.md`

> **Reference note:** Code samples below are simplified implementation sketches. When they differ from the live branch, prefer the shipped `solana-x402` worktree code and the reviewed corrections recorded in `review/batch-0/fixed.md`.

---

## Task 1: Schema Migration — Multi-chain Payment Fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

**Step 1: Add new fields to Listing**

In `prisma/schema.prisma`, add `priceUsdCents` to the `Listing` model:

```prisma
model Listing {
  // after currency field:
  priceUsdCents       Int?      @map("price_usd_cents")
}
```

**Step 2: Add new fields to PurchaseIntent**

```prisma
model PurchaseIntent {
  // add after walletBindingId:
  agentMemberId         String?   @map("agent_member_id") @db.Uuid
  chain                 String    @default("sui")
  currency              String    @default("SUI")
  expectedAmount        BigInt?   @map("expected_amount") // kept nullable for migration compatibility; required for Solana intents at runtime
  recipientTokenAccount String?   @map("recipient_token_account")
  paymentRequestId      String?   @unique @map("payment_request_id")
}
```

**Step 3: Add new fields to Order**

```prisma
model Order {
  // add after walletBindingId:
  agentMemberId    String?  @map("agent_member_id") @db.Uuid
  chain            String   @default("sui")
  currency         String   @default("SUI")
  paymentRequestId String?  @unique @map("payment_request_id")
}
```

**Step 4: Add agent fields to Member**

Member already has `apiKey` (plain text) and `kind`. The migration backfills `apiKeyHash`, nulls legacy `apiKey`, and runtime auth resolves agents only by hash:

```prisma
model Member {
  // agent auth fields:
  apiKeyHash   String?  @unique @map("api_key_hash")   // SHA-256 hash of the raw key
  agentStatus  String?  @default("active") @map("agent_status")
}
```

**Step 5: Run migration**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma migrate dev --name add-solana-agent-fields
```

**Step 6: Verify migration**

```bash
npx prisma generate
```

**Step 7: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add multi-chain payment and agent fields"
```

---

## Task 2: Solana Client Setup + Config

**Files:**
- Create: `web/lib/solana.ts`
- Modify: `web/.env.example` (add Solana env vars)

**Step 1: Install Solana dependencies**

```bash
cd /Users/admin/Desktop/nao/clawnews
npm install @solana/web3.js@^1.98 @solana/spl-token@^0.4 bs58@^6.0
```

Note: `bs58` is already in web/package.json; check if it's accessible from root. If using workspace, may need to install at root too.

**Step 2: Create Solana client**

Create `web/lib/solana.ts`:

```typescript
import { Connection, clusterApiUrl } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'
const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl(network as any)

// Singleton connection
const globalForSolana = globalThis as unknown as { solanaConnection?: Connection }
export const solanaConnection = globalForSolana.solanaConnection ?? new Connection(rpcUrl, 'confirmed')
if (process.env.NODE_ENV !== 'production') globalForSolana.solanaConnection = solanaConnection

// USDC mint addresses
export const USDC_MINT: Record<string, string> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // devnet USDC
}

export const USDC_DECIMALS = 6
const MICROS_PER_USD = BigInt(1_000_000)
const LAMPORTS_PER_SOL = BigInt(1_000_000_000)

export function getUsdcMint(): PublicKey {
  const mint = USDC_MINT[network]
  if (!mint) throw new Error(`No USDC mint configured for network: ${network}`)
  return new PublicKey(mint)
}

export function usdCentsToUsdcAtomicUnits(cents: number): bigint {
  // 1 USD = 100 cents, USDC has 6 decimals
  // 1 cent = 10000 atomic units (1e6 / 100)
  return BigInt(cents) * BigInt(10000)
}

export function usdCentsToLamports(cents: number, solPriceUsd: number): bigint {
  const solPriceMicros = Math.round(solPriceUsd * Number(MICROS_PER_USD))
  const usdMicros = BigInt(cents) * (MICROS_PER_USD / BigInt(100))
  return ceilDiv(usdMicros * LAMPORTS_PER_SOL, BigInt(solPriceMicros))
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator
}
```

**Step 3: Add env vars**

Add to `.env.example`:

```
# Solana
NEXT_PUBLIC_SOLANA_NETWORK=devnet
SOLANA_RPC_URL=
```

**Step 4: Commit**

```bash
git add web/lib/solana.ts .env.example
git commit -m "feat(solana): add Solana client, USDC config, and conversion utils"
```

---

## Task 3: Solana Transaction Verification

**Files:**
- Create: `web/lib/solana-verify.ts`
- Create: `tests/solana-verify.test.ts`

**Step 1: Write the verification test**

Create `tests/solana-verify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseSolTransfer, parseSplTransfer } from '../web/lib/solana-verify'

describe('parseSolTransfer', () => {
  it('returns null for non-system-transfer tx', () => {
    // Mock a tx without system transfer
    const result = parseSolTransfer(mockNonTransferTx as any)
    expect(result).toBeNull()
  })
})

describe('parseSplTransfer', () => {
  it('returns null for non-SPL tx', () => {
    const result = parseSplTransfer(mockNonSplTx as any, 'fakeMint')
    expect(result).toBeNull()
  })
})

// Note: Full integration tests require Solana devnet; unit tests mock tx structure
const mockNonTransferTx = { transaction: { message: { instructions: [] } }, meta: null }
const mockNonSplTx = { transaction: { message: { instructions: [] } }, meta: null }
```

The real branch should also keep positive-path, amount-boundary, and multi-instruction test coverage aligned with the verifier fixes in `review/batch-0/fixed.md`; the empty-array examples here are only the minimal red-phase starting point.

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/solana-verify.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement Solana verification**

Create `web/lib/solana-verify.ts`:

```typescript
import { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'
import { solanaConnection, getUsdcMint } from './solana'

export interface SolanaPaymentVerification {
  success: boolean
  sender: string
  recipient: string
  amount: bigint
  mint?: string // undefined for SOL, mint address for SPL
}

export async function verifySolanaTransaction(
  txSignature: string,
  expectedSender: string,
  expectedRecipient: string,
  expectedAmount: bigint,
  currency: 'SOL' | 'USDC',
): Promise<{ ok: true; verification: SolanaPaymentVerification } | { ok: false; error: string }> {
  let tx: ParsedTransactionWithMeta | null
  try {
    tx = await solanaConnection.getParsedTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
  } catch {
    return { ok: false, error: 'Transaction not found on Solana' }
  }

  if (!tx) return { ok: false, error: 'Transaction not found' }
  if (tx.meta?.err) return { ok: false, error: `Transaction failed: ${JSON.stringify(tx.meta.err)}` }

  if (currency === 'SOL') {
    const parsed = parseSolTransfer(tx, expectedSender, expectedRecipient)
    if (!parsed) return { ok: false, error: 'No SOL transfer found in transaction' }
    if (parsed.amount < expectedAmount) return { ok: false, error: 'Amount insufficient' }
    return { ok: true, verification: parsed }
  }

  // USDC / SPL
  const usdcMint = getUsdcMint().toBase58()
  const parsed = parseSplTransfer(tx, usdcMint)
  if (!parsed) return { ok: false, error: 'No USDC transfer found in transaction' }
  if (parsed.sender !== expectedSender) return { ok: false, error: 'Sender mismatch' }
  if (parsed.recipient !== expectedRecipient) return { ok: false, error: 'Recipient mismatch' }
  if (parsed.amount < expectedAmount) return { ok: false, error: 'Amount insufficient' }
  return { ok: true, verification: parsed }
}

export function parseSolTransfer(
  tx: ParsedTransactionWithMeta,
  expectedSender: string,
  expectedRecipient: string,
): SolanaPaymentVerification | null {
  for (const ix of tx.transaction.message.instructions) {
    if ('parsed' in ix && ix.program === 'system' && ix.parsed?.type === 'transfer') {
      const info = ix.parsed.info
      if (info.source !== expectedSender || info.destination !== expectedRecipient) continue

      return {
        success: true,
        sender: info.source,
        recipient: info.destination,
        amount: BigInt(info.lamports),
      }
    }
  }
  return null
}

export function parseSplTransfer(tx: ParsedTransactionWithMeta, expectedMint: string): SolanaPaymentVerification | null {
  for (const ix of tx.transaction.message.instructions) {
    if ('parsed' in ix && ix.program === 'spl-token') {
      const type = ix.parsed?.type
      if (type !== 'transferChecked') continue

      const info = ix.parsed.info
      const mint = info.mint || ''
      if (mint !== expectedMint || !info.authority || !info.destination) continue

      return {
        success: true,
        sender: info.authority,
        recipient: info.destination,
        amount: BigInt(info.amount || info.tokenAmount?.amount || '0'),
        mint,
      }
    }
  }
  return null
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/solana-verify.test.ts
```

**Step 5: Commit**

```bash
git add web/lib/solana-verify.ts tests/solana-verify.test.ts
git commit -m "feat(solana): add transaction verification for SOL and USDC transfers"
```

---

## Task 4: Update purchase-intent API for Solana

**Files:**
- Modify: `web/app/api/market/purchase-intent/route.ts`

**Step 1: Add Solana support to purchase-intent**

The current API only supports SUI. Extend to accept `chain` and `currency` params, resolve seller's Solana wallet, and snapshot USDC amount or SOL lamports.

Key changes:
- Accept `{ listingId, chain?, currency? }` — defaults to `sui`/`SUI` for backward compat
- When `chain === 'solana'`:
  - Look up seller's primary Solana `WalletBinding`
  - For USDC: compute ATA from seller address + USDC mint, store as `recipientTokenAccount`
  - For SOL: use seller's Solana address as `recipientAddress`
  - Compute `expectedAmount` from `priceUsdCents` (or `priceMist` fallback)
- Store `chain`, `currency`, `expectedAmount`, `recipientTokenAccount` in PurchaseIntent

Add helper to resolve seller's Solana ATA:

```typescript
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { getUsdcMint, usdCentsToUsdcAtomicUnits } from '@web/lib/solana'
```

For the SOL price oracle, use CoinGecko (same pattern as existing `useSuiPrice` on frontend):

```typescript
async function getSolPriceUsd(): Promise<number> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
  const data = await res.json()
  return data.solana.usd
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/purchase-intent/route.ts
git commit -m "feat(market): support Solana USDC/SOL in purchase-intent API"
```

---

## Task 5: Update confirm-purchase API for Solana

**Files:**
- Modify: `web/app/api/market/confirm-purchase/route.ts`

**Step 1: Add Solana verification branch**

The current API only verifies SUI transactions. Add a branch for Solana:

- Read `intent.chain` to decide verification path
- When `chain === 'solana'`: use `verifySolanaTransaction()` from Task 3
- For USDC: verify against `intent.recipientTokenAccount`
- For SOL: verify against `intent.recipientAddress`
- Store `chain` and `currency` on the created `Order`

Key code change — after loading the intent, branch on chain:

```typescript
if (intent.chain === 'solana') {
  if (intent.expectedAmount === null) {
    return NextResponse.json({ error: 'Solana intent missing expected amount' }, { status: 400 })
  }
  const expectedRecipient = intent.currency === 'USDC'
    ? intent.recipientTokenAccount || intent.recipientAddress
    : intent.recipientAddress
  const result = await verifySolanaTransaction(
    txDigest, // txSignature for Solana
    intent.walletBinding.address,
    expectedRecipient,
    intent.expectedAmount,
    intent.currency as 'SOL' | 'USDC',
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
} else {
  // existing SUI verification (unchanged)
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/confirm-purchase/route.ts
git commit -m "feat(market): support Solana tx verification in confirm-purchase"
```

---

## Task 6: Frontend — Solana Wallet Adapter + Chain Selector

**Files:**
- Modify: `web/app/market/layout.tsx` — add Solana wallet provider
- Modify: `web/components/market/purchase-button.tsx` — add chain selection + Solana tx
- Modify: `web/components/market/wallet-connect.tsx` — support Solana binding
- Modify: `web/package.json` — add Solana wallet adapter deps

**Step 1: Install Solana wallet adapter**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm install @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @solana/web3.js @solana/spl-token
```

**Step 2: Update market layout with dual providers**

Add `ConnectionProvider` and `WalletProvider` from Solana wallet adapter alongside existing Sui provider in `web/app/market/layout.tsx`.

**Step 3: Update PurchaseButton for Solana**

In `web/components/market/purchase-button.tsx`:
- Add chain selector (SUI / Solana toggle)
- When Solana selected + USDC:
  - Create `TransferChecked` instruction to seller's ATA
  - Use `@solana/wallet-adapter-react` `useWallet().sendTransaction()`
- When Solana selected + SOL:
  - Create system transfer instruction
- Pass `chain` and `currency` to purchase-intent API

**Step 4: Update WalletConnect for Solana binding**

In `web/components/market/wallet-connect.tsx`:
- Detect which wallet is connected (Sui vs Solana)
- Send appropriate chain param to bind challenge/confirm

**Step 5: Commit**

```bash
git add web/app/market/layout.tsx web/components/market/ web/package.json
git commit -m "feat(market): add Solana wallet adapter and chain selector to purchase flow"
```

---

## Task 7: Wallet Bind API — Solana Support

**Files:**
- Modify: `web/app/api/wallet/bind/challenge/route.ts`
- Modify: `web/app/api/wallet/bind/confirm/route.ts`

**Step 1: Update challenge to accept chain**

Accept `{ chain?: 'sui' | 'solana' }` in the challenge body. For Solana, generate the same nonce-based message but don't require Sui-specific formatting.

**Step 2: Update confirm for Solana signature verification**

For Solana wallets, verify Ed25519 signature using `tweetnacl` (already in deps) with the Solana public key:

```typescript
import nacl from 'tweetnacl'
import bs58 from 'bs58'

// For Solana:
const pubkeyBytes = bs58.decode(address)
const messageBytes = new TextEncoder().encode(message)
const signatureBytes = bs58.decode(signature)
const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes)
```

Store binding as `WalletBinding(chain: 'solana')`.

**Step 3: Commit**

```bash
git add web/app/api/wallet/bind/
git commit -m "feat(wallet): support Solana wallet binding with Ed25519 verification"
```

---

## Task 8: Agent API Key Management

**Files:**
- Create: `web/app/api/agent/api-key/route.ts`
- Create: `web/lib/auth/resolve-agent.ts`
- Modify: `web/lib/auth/identity.ts` — update API key resolution to use hash

**Step 1: Create API key generation endpoint**

`POST /api/agent/api-key` — owner generates key for their agent:

```typescript
// web/app/api/agent/api-key/route.ts
import { randomBytes, createHash } from 'crypto'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity || identity.kind !== 'human') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agentMemberId } = await request.json()

  // Verify agent belongs to same account as owner
  const agent = await prisma.member.findFirst({
    where: { id: agentMemberId, kind: 'agent', accountId: identity.accountId },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Generate key
  const rawKey = `sk-${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')

  await prisma.member.update({
    where: { id: agentMemberId },
    data: { apiKeyHash: keyHash, agentStatus: 'active' },
  })

  // Return raw key ONCE
  return NextResponse.json({ apiKey: rawKey })
}
```

**Step 2: Create agent resolution helper**

`web/lib/auth/resolve-agent.ts`:

```typescript
import { createHash } from 'crypto'
import { prisma } from '@web/lib/prisma'

export interface AgentIdentity {
  agentMemberId: string
  ownerMemberId: string
  accountId: string
}

export async function resolveAgentByApiKey(apiKey: string): Promise<AgentIdentity | null> {
  const agent = await prisma.member.findFirst({
    where: {
      apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
      kind: 'agent',
      agentStatus: 'active',
    },
    select: {
      id: true,
      accountId: true,
      account: {
        select: {
          members: {
            where: { kind: 'human' },
            select: { id: true },
            orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            take: 1,
          },
        },
      },
    },
  })
  if (!agent?.accountId) return null

  const owner = agent.account?.members[0]
  if (!owner) return null

  return {
    agentMemberId: agent.id,
    ownerMemberId: owner.id,
    accountId: agent.accountId,
  }
}
```

**Step 3: Update resolveIdentity**

In `web/lib/auth/identity.ts`, update the API key branch to use `resolveAgentByApiKey` and return agent identity with owner memberId.

When wiring `/api/agent/*` routes, use a shared API-key guard that rate-limits failed Bearer auth attempts per IP before returning 401 (for example, 60 failed attempts/minute across download and marketplace endpoints).

**Step 4: Commit**

```bash
git add web/app/api/agent/api-key/route.ts web/lib/auth/resolve-agent.ts web/lib/auth/identity.ts
git commit -m "feat(agent): API key generation, hashed storage, and agent identity resolution"
```

---

## Task 9: Agent Download Endpoint (Phase 1)

**Files:**
- Create: `web/app/api/agent/bundles/[bundleId]/download/route.ts`

**Step 1: Implement agent download endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { resolveAgentByApiKey } from '@web/lib/auth/resolve-agent'
import { prisma } from '@web/lib/prisma'
import { createSupabaseAdmin } from '@web/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  const { bundleId } = await params

  // Resolve agent from API key
  const authHeader = request.headers.get('authorization')
  const apiKey = authHeader?.startsWith('Bearer sk-') ? authHeader.slice(7) : null
  if (!apiKey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  // Check owner's entitlement
  const entitlement = await prisma.entitlement.findFirst({
    where: { memberId: agent.ownerMemberId, bundleId, status: 'active' },
    include: { bundle: { select: { storageBucket: true, storagePath: true, name: true } } },
  })

  if (!entitlement) {
    return NextResponse.json({ error: 'No entitlement for this bundle' }, { status: 403 })
  }

  // Generate signed download URL
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.storage
    .from(entitlement.bundle.storageBucket)
    .createSignedUrl(entitlement.bundle.storagePath, 300)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    fileName: buildDownloadFileName(entitlement.bundle.name),
    expiresIn: 300,
  })
}
```

**Step 2: Commit**

```bash
git add web/app/api/agent/bundles/
git commit -m "feat(agent): add agent bundle download endpoint with API key auth"
```

---

## Task 10: x402 Integration (Phase 2)

**Files:**
- Install: `@x402/next`, `@x402/core`, `@x402/svm`
- Create: `web/lib/x402-server.ts`
- Modify: `web/app/api/agent/bundles/[bundleId]/download/route.ts` — add x402

**Step 1: Install x402 SDK**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm install @x402/next @x402/core @x402/svm
```

The x402 imports and symbols in this task were verified against the installed `@x402/*` packages at version `2.7.0` on 2026-03-18. Re-check the package exports if these dependencies are upgraded.

**Step 2: Create x402 server config**

Create `web/lib/x402-server.ts`:

```typescript
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { extractPaymentIdentifier } from '@x402/extensions/payment-identifier'
import { registerExactSvmScheme } from '@x402/svm/exact/server'

const facilitatorUrl = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org'

const globalForX402 = globalThis as typeof globalThis & {
  x402Server?: x402ResourceServer
  x402HookRegistered?: boolean
}

function createServer(): x402ResourceServer {
  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl })
  const server = new x402ResourceServer(facilitatorClient)
  registerExactSvmScheme(server)
  return server
}

export const x402Server = globalForX402.x402Server ?? createServer()

if (process.env.NODE_ENV !== 'production') {
  globalForX402.x402Server = x402Server
}

if (!globalForX402.x402HookRegistered) {
  x402Server.onAfterSettle(async (context) => {
    const paymentRequestId = extractPaymentIdentifier(context.paymentPayload)
    if (!paymentRequestId) return

    // Look up PurchaseIntent by paymentRequestId and create
    // Order + Entitlement idempotently.
  })

  globalForX402.x402HookRegistered = true
}
```

**Step 3: Update agent download endpoint with x402**

The endpoint now has two paths:
1. If agent's owner has entitlement → 200 (existing)
2. If `PAYMENT-SIGNATURE` header present → verify + settle + create entitlement → 200
3. Otherwise → 402 with `PAYMENT-REQUIRED`

Match the shipped route shape: pre-create/reuse the `PurchaseIntent` from the incoming `payment-identifier`, then hand the request to `withX402(...)` with the per-request `accepts` config.

```typescript
import { randomBytes } from 'node:crypto'
import {
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  PAYMENT_IDENTIFIER,
} from '@x402/extensions/payment-identifier'
import { withX402 } from '@web/lib/x402-next'
import { getX402SolanaNetwork, usdCentsToUsdcAtomicUnits } from '@web/lib/solana'
import { x402Server } from '@web/lib/x402-server'

const paymentPayloadHeader = request.headers.get('PAYMENT-SIGNATURE')
if (paymentPayloadHeader) {
  const paymentPayload = decodePaymentPayload(paymentPayloadHeader)
  const paymentRequestId = paymentPayload ? extractPaymentIdentifier(paymentPayload) : null

  if (paymentRequestId) {
    const existingIntent = await prisma.purchaseIntent.findUnique({
      where: { paymentRequestId },
      select: { id: true },
    })

    if (!existingIntent) {
      try {
        await prisma.purchaseIntent.create({
          data: {
            listingId: listing.id,
            memberId: agent.ownerMemberId,
            agentMemberId: agent.agentMemberId,
            walletBindingId: agentWalletBinding.id,
            chain: 'solana',
            currency: 'USDC',
            expectedPriceMist: listing.priceMist,
            expectedAmount: usdCentsToUsdcAtomicUnits(priceUsdCents),
            recipientAddress: sellerWallet.address,
            paymentRequestId,
            nonce: randomBytes(16).toString('hex'),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            status: 'settling',
          },
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error
        }
      }
    }

    await prisma.purchaseIntent.updateMany({
      where: { paymentRequestId, status: 'pending' },
      data: { status: 'settling' },
    })
  }
}

const routeHandler = withX402<Record<string, unknown>>(
  async () => createDownloadResponse(listing.bundle),
  {
    accepts: {
      scheme: 'exact',
      price: `$${(priceUsdCents / 100).toFixed(2)}`,
      network: getX402SolanaNetwork(),
      payTo: sellerWallet.address,
    },
    description: `Download ${listing.bundle.name}`,
    mimeType: 'application/json',
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
    },
  },
  x402Server,
)

return routeHandler(request)
```

This is the concrete pattern already used in the `solana-x402` worktree. The important detail is that the `accepts` payload is built after loading the listing and seller wallet, then passed into `withX402(...)` for that request; there is no separate unresolved manual `verify()` / `settle()` path to invent here.

**Step 4: Commit**

```bash
git add web/lib/x402-server.ts web/app/api/agent/bundles/
git commit -m "feat(x402): integrate x402 V2 protocol for agent bundle purchases"
```

---

## Task 11: Agent Marketplace API (Phase 3)

**Files:**
- Create: `web/app/api/agent/marketplace/search/route.ts`
- Create: `web/app/api/agent/marketplace/[listingId]/route.ts`

**Step 1: Implement search endpoint**

`GET /api/agent/marketplace/search?q=...&category=...&limit=10`

Reuse the same Prisma query as `/api/market/listings` but:
- Auth via API key (Bearer sk-...)
- Return `priceUsdCents` instead of / in addition to `priceMist`
- Machine-friendly response (no HTML rendering concerns)

**Step 2: Implement detail endpoint**

`GET /api/agent/marketplace/{listingId}`

Same as `/api/market/listings/[id]` but with API key auth and machine-optimized response.

**Step 3: Commit**

```bash
git add web/app/api/agent/marketplace/
git commit -m "feat(agent): add marketplace search and detail API for autonomous agents"
```

---

## Task 12: Integration Testing

**Files:**
- Create: `tests/market-solana.test.ts`

**Step 1: Test full Solana purchase flow (mocked)**

- Mock Solana RPC responses
- Test: purchase-intent with chain=solana returns correct USDC amount + ATA
- Test: confirm-purchase validates mocked Solana tx
- Test: entitlement is created after confirmation

**Step 2: Test agent API key flow**

- Test: generate API key → resolve agent → check owner entitlements
- Test: agent download with valid key + owner entitlement → 200
- Test: agent download with no entitlement → 403

**Step 3: Test x402 flow (mocked)**

- Test: agent download without entitlement or payment → 402 + PAYMENT-REQUIRED header
- Test: agent download with PAYMENT-SIGNATURE → 200 + PAYMENT-RESPONSE

**Step 4: Commit**

```bash
git add tests/market-solana.test.ts
git commit -m "test: add integration tests for Solana payment and agent x402 flows"
```

---

## Implementation Order Summary

| Task | Phase | Effort | Depends On |
|------|-------|--------|------------|
| 1. Schema migration | P1 | Small | — |
| 2. Solana client setup | P1 | Small | — |
| 3. Solana tx verification | P1 | Medium | 2 |
| 4. Update purchase-intent | P1 | Medium | 1, 2, 3 |
| 5. Update confirm-purchase | P1 | Medium | 1, 3 |
| 6. Frontend Solana wallet | P1 | Large | 4, 5 |
| 7. Wallet bind Solana | P1 | Medium | — |
| 8. Agent API key | P1 | Medium | 1 |
| 9. Agent download endpoint | P1 | Small | 8 |
| 10. x402 integration | P2 | Large | 9 |
| 11. Agent marketplace API | P3 | Small | 8 |
| 12. Integration testing | All | Medium | All above |

**Parallelizable:** Tasks 1+2, Tasks 7+8, Tasks 10+11
