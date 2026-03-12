# AgentBundle 模板市场 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a marketplace module within the existing clawnews web app where sellers upload template bundles, buyers pay SUI via wallet transfer, and the backend verifies payment to grant download access.

**Architecture:** Centralized marketplace with Sui as payment receipt. No custom Move contracts. Sellers upload bundles to Supabase Storage and create listings in Postgres. Buyers connect Sui wallets via `@mysten/dapp-kit`, pay via PTB `transferObjects`, backend verifies the on-chain transaction and grants entitlements. DB is the single source of truth for business state.

**Tech Stack:** Next.js 16, React 19, Prisma 7 (PrismaPg adapter), Supabase Storage, `@mysten/dapp-kit`, `@mysten/sui`, `@tanstack/react-query`, Vitest

**Design doc:** `docs/plans/2026-03-12-marketplace-mvp-design.md`

---

## Task 1: Prisma Schema — Add Marketplace Models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add new models to Prisma schema**

Append the following models after the existing `Skill` model in `prisma/schema.prisma`. Also add new relation fields to the `Member` model.

Add to `Member` model (after existing `loginChallenges` relation):

```prisma
  walletBindings  WalletBinding[]
  soldBundles     AgentBundle[]
  purchaseIntents PurchaseIntent[]
  orders          Order[]         @relation("BuyerOrders")
  entitlements    Entitlement[]
```

Add new models at end of file:

```prisma
model WalletBinding {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  memberId    String   @map("member_id") @db.Uuid
  member      Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  chain       String   @default("sui")
  address     String
  isPrimary   Boolean  @default(true) @map("is_primary")
  verifiedAt  DateTime @default(now()) @map("verified_at") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  purchaseIntents PurchaseIntent[]
  orders          Order[]
  entitlements    Entitlement[]

  @@unique([chain, address])
  @@index([memberId, chain])
  @@map("wallet_bindings")
}

model AgentBundle {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId      String   @map("seller_id") @db.Uuid
  seller        Member   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  name          String
  description   String
  version       String   @default("1.0.0")
  category      String
  tags          String[]
  storageBucket String   @default("agent-bundles") @map("storage_bucket")
  storagePath   String   @map("storage_path")
  contentHash   String   @map("content_hash")
  previewImages String[] @map("preview_images")
  readme        String?
  status        String   @default("draft")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  listings     Listing[]
  entitlements Entitlement[]

  @@index([sellerId, status])
  @@map("agent_bundles")
}

model Listing {
  id                  String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bundleId            String      @map("bundle_id") @db.Uuid
  bundle              AgentBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  sellerWalletAddress String      @map("seller_wallet_address")
  priceMist           BigInt      @map("price_mist")
  currency            String      @default("SUI")
  status              String      @default("active")
  createdAt           DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  purchaseIntents PurchaseIntent[]
  orders          Order[]

  @@index([bundleId, status])
  @@map("listings")
}

model PurchaseIntent {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  listingId         String        @map("listing_id") @db.Uuid
  listing           Listing       @relation(fields: [listingId], references: [id], onDelete: Cascade)
  memberId          String        @map("member_id") @db.Uuid
  member            Member        @relation(fields: [memberId], references: [id], onDelete: Cascade)
  walletBindingId   String        @map("wallet_binding_id") @db.Uuid
  walletBinding     WalletBinding @relation(fields: [walletBindingId], references: [id], onDelete: Cascade)
  expectedPriceMist BigInt        @map("expected_price_mist")
  recipientAddress  String        @map("recipient_address")
  nonce             String        @unique
  expiresAt         DateTime      @map("expires_at") @db.Timestamptz
  txDigest          String?       @unique @map("tx_digest")
  status            String        @default("pending")
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime      @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  order Order?

  @@index([memberId, status])
  @@index([listingId, status])
  @@map("purchase_intents")
}

model Order {
  id               String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  listingId        String         @map("listing_id") @db.Uuid
  listing          Listing        @relation(fields: [listingId], references: [id], onDelete: Cascade)
  buyerId          String         @map("buyer_id") @db.Uuid
  buyer            Member         @relation("BuyerOrders", fields: [buyerId], references: [id], onDelete: Cascade)
  walletBindingId  String         @map("wallet_binding_id") @db.Uuid
  walletBinding    WalletBinding  @relation(fields: [walletBindingId], references: [id], onDelete: Cascade)
  purchaseIntentId String         @unique @map("purchase_intent_id") @db.Uuid
  purchaseIntent   PurchaseIntent @relation(fields: [purchaseIntentId], references: [id], onDelete: Cascade)
  priceMist        BigInt         @map("price_mist")
  txDigest         String         @unique @map("tx_digest")
  status           String         @default("completed")
  createdAt        DateTime       @default(now()) @map("created_at") @db.Timestamptz

  entitlement Entitlement?

  @@index([buyerId, createdAt(sort: Desc)])
  @@map("orders")
}

model Entitlement {
  id              String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bundleId        String         @map("bundle_id") @db.Uuid
  bundle          AgentBundle    @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  orderId         String         @unique @map("order_id") @db.Uuid
  order           Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)
  memberId        String         @map("member_id") @db.Uuid
  member          Member         @relation(fields: [memberId], references: [id], onDelete: Cascade)
  walletBindingId String?        @map("wallet_binding_id") @db.Uuid
  walletBinding   WalletBinding? @relation(fields: [walletBindingId], references: [id], onDelete: SetNull)
  accessType      String         @default("download") @map("access_type")
  status          String         @default("active")
  grantedAt       DateTime       @default(now()) @map("granted_at") @db.Timestamptz
  updatedAt       DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([memberId, status])
  @@index([bundleId, status])
  @@map("entitlements")
}
```

**Step 2: Run migration**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma migrate dev --name add-marketplace-models --schema=prisma/schema.prisma
```

Expected: Migration succeeds, `generated/prisma/` is regenerated with new model types.

**Step 3: Verify generated types**

```bash
cd /Users/admin/Desktop/nao/clawnews
npx prisma generate --schema=prisma/schema.prisma
```

Expected: No errors. New types available: `WalletBinding`, `AgentBundle`, `Listing`, `PurchaseIntent`, `Order`, `Entitlement`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(market): add marketplace Prisma models

Add WalletBinding, AgentBundle, Listing, PurchaseIntent, Order,
Entitlement models. Update Member with new relations."
```

---

## Task 2: Install Dependencies & Environment

**Files:**
- Modify: `web/package.json`
- Modify: `.env.example`
- Modify: `.env`

**Step 1: Install Sui SDK packages**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm install @mysten/sui @mysten/dapp-kit @tanstack/react-query
```

`@mysten/dapp-kit` requires `@tanstack/react-query` as a peer dependency.

**Step 2: Add environment variables**

Add to `.env.example`:

```
# Supabase (service role — needed for Storage uploads/signed URLs)
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Sui
NEXT_PUBLIC_SUI_NETWORK=testnet
SUI_RECIPIENT_ADDRESS=0x_YOUR_PLATFORM_WALLET_ADDRESS
```

Add the same to `.env` with your actual values. `SUPABASE_SERVICE_ROLE_KEY` is found in your Supabase dashboard under Settings → API → service_role key. It is required for bundle upload and download operations.

**Step 3: Create Supabase Storage buckets**

Create two buckets in your Supabase dashboard (Storage → New bucket):

1. `agent-bundles` — private bucket for downloadable bundles:
   - Public: **No** (downloads via signed URLs)
   - File size limit: 50MB
   - Allowed MIME types: `application/zip, application/x-zip-compressed`

2. `agent-previews` — public bucket for preview images:
   - Public: **Yes** (images render directly via public URL)
   - File size limit: 5MB
   - Allowed MIME types: `image/png, image/jpeg, image/webp`

**Step 4: Commit**

```bash
git add web/package.json web/package-lock.json .env.example
git commit -m "feat(market): add Sui SDK deps and env vars"
```

---

## Task 3: Server-Side Sui Client Utility

**Files:**
- Create: `web/lib/sui.ts`

**Step 1: Create Sui client singleton**

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'

const globalForSui = globalThis as unknown as { suiClient: SuiClient | undefined }

export const suiClient = globalForSui.suiClient ?? new SuiClient({ url: getFullnodeUrl(network) })

if (process.env.NODE_ENV !== 'production') globalForSui.suiClient = suiClient
```

This follows the same singleton pattern as `web/lib/prisma.ts`.

**Step 2: Commit**

```bash
git add web/lib/sui.ts
git commit -m "feat(market): add server-side SuiClient singleton"
```

---

## Task 4: Wallet Binding — Challenge API

**Files:**
- Create: `web/app/api/wallet/bind/challenge/route.ts`

**Step 1: Write the challenge endpoint**

```typescript
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSession } from '@web/lib/auth/session'

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nonce = randomBytes(32).toString('hex')
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${session.memberId}\nNonce: ${nonce}`
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}
```

The nonce is not persisted to DB — the confirm endpoint will receive it back along with the signature and re-derive the expected message for verification.

**Step 2: Commit**

```bash
git add web/app/api/wallet/bind/challenge/route.ts
git commit -m "feat(market): add wallet bind challenge endpoint"
```

---

## Task 5: Wallet Binding — Confirm API

**Files:**
- Create: `web/app/api/wallet/bind/confirm/route.ts`

**Step 1: Write the confirm endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { nonce, signature } = await request.json()
  if (!nonce || !signature) {
    return NextResponse.json({ error: 'Missing nonce or signature' }, { status: 400 })
  }

  // Re-derive the expected message
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${session.memberId}\nNonce: ${nonce}`
  const messageBytes = new TextEncoder().encode(message)

  let signerAddress: string
  try {
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
    signerAddress = publicKey.toSuiAddress()
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Check if this wallet is already bound to another account
  const existing = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain: 'sui', address: signerAddress } },
  })
  if (existing && existing.memberId !== session.memberId) {
    return NextResponse.json({ error: 'Wallet already bound to another account' }, { status: 409 })
  }
  if (existing && existing.memberId === session.memberId) {
    return NextResponse.json({ walletBinding: existing })
  }

  // Set all existing bindings for this member+chain to non-primary
  await prisma.walletBinding.updateMany({
    where: { memberId: session.memberId, chain: 'sui' },
    data: { isPrimary: false },
  })

  const walletBinding = await prisma.walletBinding.create({
    data: {
      memberId: session.memberId,
      chain: 'sui',
      address: signerAddress,
      isPrimary: true,
    },
  })

  return NextResponse.json({ walletBinding })
}
```

> **Note:** `verifyPersonalMessageSignature` is from `@mysten/sui/verify`. Check the latest `@mysten/sui` docs via context7 if the import path has changed. The function should verify the signature and return the public key, from which we derive the Sui address.

**Step 2: Commit**

```bash
git add web/app/api/wallet/bind/confirm/route.ts
git commit -m "feat(market): add wallet bind confirm endpoint with signature verification"
```

---

## Task 6: Listing Query APIs

**Files:**
- Create: `web/app/api/market/listings/route.ts`
- Create: `web/app/api/market/listings/[id]/route.ts`

**Step 1: Write the listings list endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const category = searchParams.get('category')
  const search = searchParams.get('search')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(60, parseInt(searchParams.get('limit') || '20'))
  const offset = (page - 1) * limit

  const where: Record<string, unknown> = {
    status: 'active',
    bundle: { status: 'active' },
  }
  if (category) {
    where.bundle = { ...where.bundle as object, category }
  }
  if (search) {
    where.bundle = {
      ...where.bundle as object,
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        bundle: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            tags: true,
            previewImages: true,
            version: true,
            seller: { select: { id: true, tgName: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.listing.count({ where }),
  ])

  return NextResponse.json({ listings, total, page, limit })
}
```

**Step 2: Write the listing detail endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const listing = await prisma.listing.findFirst({
    where: { id, status: 'active', bundle: { status: 'active' } },
    include: {
      bundle: {
        select: {
          id: true,
          name: true,
          description: true,
          readme: true,
          category: true,
          tags: true,
          previewImages: true,
          version: true,
          contentHash: true,
          seller: { select: { id: true, tgName: true, avatar: true, level: true } },
        },
      },
      _count: { select: { orders: true } },
    },
  })

  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ listing })
}
```

**Step 3: Commit**

```bash
git add web/app/api/market/listings/
git commit -m "feat(market): add listing query APIs (list + detail)"
```

---

## Task 7: Bundle Upload API

**Files:**
- Create: `web/app/api/market/upload/route.ts`

**Step 1: Write the upload endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getSession } from '@web/lib/auth/session'
import { createSupabaseServer } from '@web/lib/supabase/server'

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_BUNDLE_TYPES = ['application/zip', 'application/x-zip-compressed']
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileType = formData.get('type') as string | null // 'bundle' or 'preview'

  if (!file || !fileType) {
    return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })
  }

  const isBundle = fileType === 'bundle'
  const maxSize = isBundle ? MAX_BUNDLE_SIZE : MAX_IMAGE_SIZE
  const allowedTypes = isBundle ? ALLOWED_BUNDLE_TYPES : ALLOWED_IMAGE_TYPES

  if (file.size > maxSize) {
    return NextResponse.json({ error: `File too large (max ${maxSize / 1024 / 1024}MB)` }, { status: 400 })
  }
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(buffer).digest('hex')
  const ext = file.name.split('.').pop() || (isBundle ? 'zip' : 'png')
  const storagePath = `${session.memberId}/${Date.now()}-${hash.slice(0, 8)}.${ext}`

  const supabase = await createSupabaseServer()
  const { error } = await supabase.storage
    .from('agent-bundles')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })

  if (error) {
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    storagePath,
    contentHash: isBundle ? hash : undefined,
    size: file.size,
  })
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/upload/route.ts
git commit -m "feat(market): add bundle/preview upload endpoint"
```

---

## Task 8: Bundle Publish API

**Files:**
- Create: `web/app/api/market/publish/route.ts`

**Step 1: Write the publish endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Seller must have a primary Sui wallet bound
  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: session.memberId, chain: 'sui', isPrimary: true },
  })
  if (!wallet) {
    return NextResponse.json({ error: 'No Sui wallet bound. Please bind your wallet first.' }, { status: 400 })
  }

  const body = await request.json()
  const { name, description, category, tags, storagePath, contentHash, previewImages, readme, priceMist } = body

  if (!name || !description || !category || !storagePath || !contentHash || !priceMist) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const priceBigInt = BigInt(priceMist)
  if (priceBigInt <= 0n) {
    return NextResponse.json({ error: 'Price must be positive' }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const bundle = await tx.agentBundle.create({
      data: {
        sellerId: session.memberId,
        name,
        description,
        category,
        tags: tags || [],
        storagePath,
        contentHash,
        previewImages: previewImages || [],
        readme: readme || null,
        status: 'active',
      },
    })

    const listing = await tx.listing.create({
      data: {
        bundleId: bundle.id,
        sellerWalletAddress: wallet.address,
        priceMist: priceBigInt,
        status: 'active',
      },
    })

    return { bundle, listing }
  })

  return NextResponse.json(result, { status: 201 })
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/publish/route.ts
git commit -m "feat(market): add bundle publish endpoint"
```

---

## Task 9: Purchase Intent API

**Files:**
- Create: `web/app/api/market/purchase-intent/route.ts`

**Step 1: Write the purchase intent endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { listingId } = await request.json()
  if (!listingId) {
    return NextResponse.json({ error: 'Missing listingId' }, { status: 400 })
  }

  // Buyer must have a bound wallet
  const wallet = await prisma.walletBinding.findFirst({
    where: { memberId: session.memberId, chain: 'sui', isPrimary: true },
  })
  if (!wallet) {
    return NextResponse.json({ error: 'No Sui wallet bound' }, { status: 400 })
  }

  // Fetch listing and validate
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: 'active', bundle: { status: 'active' } },
    include: { bundle: { select: { sellerId: true } } },
  })
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found or inactive' }, { status: 404 })
  }

  // Cannot buy your own bundle
  if (listing.bundle.sellerId === session.memberId) {
    return NextResponse.json({ error: 'Cannot purchase your own bundle' }, { status: 400 })
  }

  // Check if already owns entitlement for this bundle
  const existingEntitlement = await prisma.entitlement.findFirst({
    where: { memberId: session.memberId, bundleId: listing.bundleId, status: 'active' },
  })
  if (existingEntitlement) {
    return NextResponse.json({ error: 'You already own this bundle' }, { status: 400 })
  }

  const nonce = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
  const recipientAddress = listing.sellerWalletAddress

  const intent = await prisma.purchaseIntent.create({
    data: {
      listingId,
      memberId: session.memberId,
      walletBindingId: wallet.id,
      expectedPriceMist: listing.priceMist,
      recipientAddress,
      nonce,
      expiresAt,
    },
  })

  return NextResponse.json({
    intentId: intent.id,
    nonce: intent.nonce,
    priceMist: intent.expectedPriceMist.toString(),
    recipientAddress: intent.recipientAddress,
    expiresAt: intent.expiresAt.toISOString(),
  })
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/purchase-intent/route.ts
git commit -m "feat(market): add purchase intent endpoint"
```

---

## Task 10: Confirm Purchase API

**Files:**
- Create: `web/app/api/market/confirm-purchase/route.ts`

**Step 1: Write the confirm purchase endpoint**

This is the most critical endpoint — it verifies the on-chain payment and atomically creates Order + Entitlement.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { intentId, txDigest } = await request.json()
  if (!intentId || !txDigest) {
    return NextResponse.json({ error: 'Missing intentId or txDigest' }, { status: 400 })
  }

  // Load intent and validate ownership
  const intent = await prisma.purchaseIntent.findUnique({
    where: { id: intentId },
    include: {
      listing: { select: { bundleId: true } },
      walletBinding: { select: { address: true } },
    },
  })
  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 })
  }
  if (intent.memberId !== session.memberId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (intent.status !== 'pending') {
    return NextResponse.json({ error: `Intent already ${intent.status}` }, { status: 400 })
  }
  if (new Date() > intent.expiresAt) {
    await prisma.purchaseIntent.update({ where: { id: intentId }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Intent expired' }, { status: 400 })
  }

  // Check txDigest uniqueness
  const existingOrder = await prisma.order.findUnique({ where: { txDigest } })
  if (existingOrder) {
    return NextResponse.json({ error: 'Transaction already used' }, { status: 409 })
  }

  // Verify on-chain transaction
  let txBlock
  try {
    txBlock = await suiClient.getTransactionBlock({
      digest: txDigest,
      options: { showEffects: true, showBalanceChanges: true, showInput: true },
    })
  } catch {
    return NextResponse.json({ error: 'Transaction not found on chain' }, { status: 400 })
  }

  // 1. Transaction must have succeeded
  const status = txBlock.effects?.status?.status
  if (status !== 'success') {
    return NextResponse.json({ error: `Transaction failed: ${status}` }, { status: 400 })
  }

  // 2. Sender must match bound wallet
  const sender = txBlock.transaction?.data?.sender
  if (sender !== intent.walletBinding.address) {
    return NextResponse.json({ error: 'Transaction sender does not match bound wallet' }, { status: 400 })
  }

  // 3. Verify balance changes — recipient received expected amount
  const balanceChanges = txBlock.balanceChanges || []
  const recipientChange = balanceChanges.find(
    (bc) => bc.owner && typeof bc.owner === 'object' && 'AddressOwner' in bc.owner &&
            bc.owner.AddressOwner === intent.recipientAddress &&
            bc.coinType === '0x2::sui::SUI'
  )
  if (!recipientChange || BigInt(recipientChange.amount) < intent.expectedPriceMist) {
    return NextResponse.json({ error: 'Payment amount insufficient or recipient mismatch' }, { status: 400 })
  }

  // All checks passed — atomically create Order + Entitlement
  const result = await prisma.$transaction(async (tx) => {
    await tx.purchaseIntent.update({
      where: { id: intentId },
      data: { status: 'confirmed', txDigest },
    })

    const order = await tx.order.create({
      data: {
        listingId: intent.listingId,
        buyerId: session.memberId,
        walletBindingId: intent.walletBindingId,
        purchaseIntentId: intentId,
        priceMist: intent.expectedPriceMist,
        txDigest,
      },
    })

    const entitlement = await tx.entitlement.create({
      data: {
        bundleId: intent.listing.bundleId,
        orderId: order.id,
        memberId: session.memberId,
        walletBindingId: intent.walletBindingId,
      },
    })

    return { order, entitlement }
  })

  return NextResponse.json(result)
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/confirm-purchase/route.ts
git commit -m "feat(market): add confirm purchase endpoint with on-chain verification"
```

---

## Task 11: Download API

**Files:**
- Create: `web/app/api/market/download/route.ts`

**Step 1: Write the download endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'
import { createSupabaseServer } from '@web/lib/supabase/server'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bundleId = request.nextUrl.searchParams.get('bundleId')
  if (!bundleId) {
    return NextResponse.json({ error: 'Missing bundleId' }, { status: 400 })
  }

  // Check entitlement
  const entitlement = await prisma.entitlement.findFirst({
    where: { memberId: session.memberId, bundleId, status: 'active' },
    include: {
      bundle: { select: { storageBucket: true, storagePath: true, name: true } },
    },
  })
  if (!entitlement) {
    return NextResponse.json({ error: 'No active entitlement for this bundle' }, { status: 403 })
  }

  // Generate signed URL (5 minutes)
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.storage
    .from(entitlement.bundle.storageBucket)
    .createSignedUrl(entitlement.bundle.storagePath, 300)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    fileName: `${entitlement.bundle.name}.zip`,
    expiresIn: 300,
  })
}
```

**Step 2: Commit**

```bash
git add web/app/api/market/download/route.ts
git commit -m "feat(market): add download endpoint with entitlement verification"
```

---

## Task 12: Frontend — Market Layout with Sui Provider

**Files:**
- Create: `web/app/market/layout.tsx`

**Step 1: Create the market layout with Sui wallet provider**

```tsx
'use client'

import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { getFullnodeUrl } from '@mysten/sui/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import '@mysten/dapp-kit/dist/index.css'

const networks = {
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
}

const defaultNetwork = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as keyof typeof networks

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork={defaultNetwork}>
        <WalletProvider autoConnect>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
```

> **Note:** Check the latest `@mysten/dapp-kit` docs via context7 for the correct `SuiClientProvider` props. The `networks` config format may have changed.

**Step 2: Commit**

```bash
git add web/app/market/layout.tsx
git commit -m "feat(market): add market layout with Sui wallet provider"
```

---

## Task 13: Frontend — Wallet Connect Component

**Files:**
- Create: `web/components/market/wallet-connect.tsx`

**Step 1: Create the wallet connect & bind component**

```tsx
'use client'

import { ConnectButton, useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

export function WalletConnect() {
  const account = useCurrentAccount()
  const { mutateAsync: signMessage } = useSignPersonalMessage()
  const { user } = useAuth()
  const [binding, setBinding] = useState(false)
  const [bound, setBound] = useState(false)
  const [error, setError] = useState('')

  async function handleBind() {
    if (!account || !user) return
    setBinding(true)
    setError('')

    try {
      // 1. Get challenge
      const challengeRes = await fetch('/api/wallet/bind/challenge', { method: 'POST' })
      const { nonce, message } = await challengeRes.json()
      if (!nonce) throw new Error('Failed to get challenge')

      // 2. Sign message with wallet
      const { signature } = await signMessage({ message: new TextEncoder().encode(message) })

      // 3. Confirm binding
      const confirmRes = await fetch('/api/wallet/bind/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, signature }),
      })
      const result = await confirmRes.json()
      if (!confirmRes.ok) throw new Error(result.error || 'Binding failed')

      setBound(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Binding failed')
    } finally {
      setBinding(false)
    }
  }

  if (!user) {
    return (
      <a href="/login" className="glass-card px-4 py-2 text-sm" style={{ color: 'var(--accent-cyan)' }}>
        登录后连接钱包
      </a>
    )
  }

  if (!account) {
    return <ConnectButton />
  }

  if (bound) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="badge badge-cyan">已绑定</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {account.address.slice(0, 6)}...{account.address.slice(-4)}
      </span>
      <button
        onClick={handleBind}
        disabled={binding}
        className="glass-card px-4 py-2 text-sm transition-colors"
        style={{ color: 'var(--accent-cyan)', opacity: binding ? 0.5 : 1 }}
      >
        {binding ? '签名中...' : '绑定钱包'}
      </button>
      {error && <span className="text-sm" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</span>}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/components/market/wallet-connect.tsx
git commit -m "feat(market): add wallet connect & bind component"
```

---

## Task 14: Frontend — Market List Page

**Files:**
- Create: `web/app/market/page.tsx`

**Step 1: Create the market list page**

Follow the same pattern as `web/app/skills/page.tsx` — client component, fetch from API, card grid, search, pagination.

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface ListingItem {
  id: string
  priceMist: string
  bundle: {
    id: string
    name: string
    description: string
    category: string
    tags: string[]
    previewImages: string[]
    version: string
    seller: { id: string; tgName: string | null; avatar: string | null }
  }
}

const PAGE_SIZE = 20

function formatSUI(mist: string): string {
  const sui = Number(BigInt(mist)) / 1e9
  return sui < 0.01 ? '< 0.01' : sui.toFixed(2)
}

export default function MarketPage() {
  const [listings, setListings] = useState<ListingItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    fetch(`/api/market/listings?${params}`)
      .then(r => r.ok ? r.json() : { listings: [], total: 0 })
      .then(data => { setListings(data.listings); setTotal(data.total) })
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { setPage(1) }, [search])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">模板市场</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {loading ? '加载中...' : `共 ${total} 个模板`}
          </p>
        </div>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索模板名称或描述..."
            className="input-dark"
            style={{ maxWidth: '20rem' }}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : listings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>暂无模板</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {listings.map(listing => (
                <Link
                  key={listing.id}
                  href={`/market/${listing.id}`}
                  className="glass-card p-5 transition-all hover:scale-[1.02] hover:shadow-lg"
                  style={{ textDecoration: 'none' }}
                >
                  {listing.bundle.previewImages[0] && (
                    <img
                      src={listing.bundle.previewImages[0]}
                      alt=""
                      className="w-full h-32 object-cover rounded-md mb-3"
                    />
                  )}
                  <h2 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {listing.bundle.name}
                  </h2>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
                    {listing.bundle.description.length > 80
                      ? listing.bundle.description.slice(0, 80) + '...'
                      : listing.bundle.description}
                  </p>
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="badge badge-cyan">{listing.bundle.category}</span>
                    <span className="font-semibold" style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                      {formatSUI(listing.priceMist)} SUI
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  disabled={page === 1}
                  className="glass-card px-3 py-1.5 text-sm transition-opacity disabled:opacity-30"
                  style={{ color: 'var(--text-primary)' }}
                >上一页</button>
                <span className="text-sm px-3" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  disabled={page === totalPages}
                  className="glass-card px-3 py-1.5 text-sm transition-opacity disabled:opacity-30"
                  style={{ color: 'var(--text-primary)' }}
                >下一页</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/market/page.tsx
git commit -m "feat(market): add market list page"
```

---

## Task 15: Frontend — Bundle Detail Page

**Files:**
- Create: `web/app/market/[id]/page.tsx`
- Create: `web/components/market/purchase-button.tsx`

**Step 1: Create the purchase button component**

```tsx
'use client'

import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'

interface PurchaseButtonProps {
  listingId: string
  priceMist: string
  disabled?: boolean
  onSuccess?: () => void
}

export function PurchaseButton({ listingId, priceMist, disabled, onSuccess }: PurchaseButtonProps) {
  const account = useCurrentAccount()
  const { user } = useAuth()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const [status, setStatus] = useState<'idle' | 'creating' | 'signing' | 'confirming' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handlePurchase() {
    if (!account || !user) return
    setStatus('creating')
    setError('')

    try {
      // 1. Create purchase intent
      const intentRes = await fetch('/api/market/purchase-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      })
      const intent = await intentRes.json()
      if (!intentRes.ok) throw new Error(intent.error || 'Failed to create intent')

      // 2. Build and sign transaction
      setStatus('signing')
      const tx = new Transaction()
      const [payment] = tx.splitCoins(tx.gas, [intent.priceMist])
      tx.transferObjects([payment], intent.recipientAddress)

      const result = await signAndExecute({ transaction: tx })

      // 3. Confirm purchase
      setStatus('confirming')
      const confirmRes = await fetch('/api/market/confirm-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: intent.intentId, txDigest: result.digest }),
      })
      const confirmData = await confirmRes.json()
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Confirmation failed')

      setStatus('done')
      onSuccess?.()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Purchase failed')
    }
  }

  const labels = {
    idle: '购买',
    creating: '创建订单...',
    signing: '请在钱包中确认...',
    confirming: '验证支付...',
    done: '购买成功 ✓',
    error: '重试',
  }

  if (!user) {
    return <a href="/login" className="glass-card px-6 py-3 text-sm font-semibold block text-center" style={{ color: 'var(--accent-cyan)' }}>登录后购买</a>
  }

  if (!account) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先连接 Sui 钱包</p>
  }

  return (
    <div>
      <button
        onClick={handlePurchase}
        disabled={disabled || status === 'creating' || status === 'signing' || status === 'confirming' || status === 'done'}
        className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all"
        style={{
          color: status === 'done' ? 'var(--accent-green, #10b981)' : 'var(--accent-cyan)',
          opacity: (disabled || status === 'done') ? 0.6 : 1,
        }}
      >
        {labels[status]}
      </button>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</p>}
    </div>
  )
}
```

**Step 2: Create the detail page**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { WalletConnect } from '@web/components/market/wallet-connect'
import { PurchaseButton } from '@web/components/market/purchase-button'

interface ListingDetail {
  id: string
  priceMist: string
  _count: { orders: number }
  bundle: {
    id: string
    name: string
    description: string
    readme: string | null
    category: string
    tags: string[]
    previewImages: string[]
    version: string
    contentHash: string
    seller: { id: string; tgName: string | null; avatar: string | null; level: number }
  }
}

function formatSUI(mist: string): string {
  const sui = Number(BigInt(mist)) / 1e9
  return sui < 0.01 ? '< 0.01' : sui.toFixed(2)
}

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [listing, setListing] = useState<ListingDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/market/listings/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setListing(data?.listing || null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        </div>
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p style={{ color: 'var(--text-muted)' }}>模板未找到</p>
        </div>
      </div>
    )
  }

  const b = listing.bundle

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left: info */}
          <div className="md:col-span-2 animate-fade-up">
            <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {b.name}
            </h1>
            <div className="flex items-center gap-3 mb-6">
              <span className="badge badge-cyan">{b.category}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>v{b.version}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{listing._count.orders} 次购买</span>
            </div>

            {b.previewImages.length > 0 && (
              <div className="flex gap-3 mb-6 overflow-x-auto">
                {b.previewImages.map((img, i) => (
                  <img key={i} src={img} alt="" className="h-40 rounded-lg object-cover" />
                ))}
              </div>
            )}

            <div className="glass-card p-6 mb-6">
              <p style={{ color: 'var(--text-secondary)' }}>{b.description}</p>
            </div>

            {b.readme && (
              <div className="glass-card p-6">
                <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>详细说明</h3>
                <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {b.readme}
                </div>
              </div>
            )}
          </div>

          {/* Right: purchase card */}
          <div className="animate-fade-up" style={{ animationDelay: '100ms' }}>
            <div className="glass-card p-6 sticky top-24">
              <div className="text-2xl font-bold mb-1" style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                {formatSUI(listing.priceMist)} SUI
              </div>
              <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>一次购买，永久下载</p>

              <div className="mb-4">
                <WalletConnect />
              </div>

              <PurchaseButton
                listingId={listing.id}
                priceMist={listing.priceMist}
                onSuccess={() => router.push('/market/my')}
              />

              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>卖家</p>
                <div className="flex items-center gap-2">
                  {b.seller.avatar ? (
                    <img src={b.seller.avatar} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {(b.seller.tgName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{b.seller.tgName || '匿名'}</span>
                </div>
              </div>

              <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                SHA-256: {b.contentHash.slice(0, 16)}...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add web/app/market/[id]/page.tsx web/components/market/purchase-button.tsx
git commit -m "feat(market): add bundle detail page with purchase flow"
```

---

## Task 16: Frontend — Publish Page

**Files:**
- Create: `web/app/market/publish/page.tsx`

**Step 1: Create the publish page**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { WalletConnect } from '@web/components/market/wallet-connect'
import { useAuth } from '@web/components/auth-provider'

export default function PublishPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({ name: '', description: '', category: '', tags: '', readme: '', priceSUI: '' })
  const [bundlePath, setBundlePath] = useState('')
  const [contentHash, setContentHash] = useState('')
  const [previewPaths, setPreviewPaths] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  async function uploadFile(file: File, type: 'bundle' | 'preview') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('type', type)
    const res = await fetch('/api/market/upload', { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Upload failed')
    }
    return res.json()
  }

  async function handleBundleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadFile(file, 'bundle')
      setBundlePath(result.storagePath)
      setContentHash(result.contentHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handlePreviewUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setUploading(true)
    setError('')
    try {
      const paths: string[] = []
      for (const file of Array.from(files)) {
        const result = await uploadFile(file, 'preview')
        paths.push(result.storagePath)
      }
      setPreviewPaths(prev => [...prev, ...paths])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handlePublish() {
    if (!bundlePath || !contentHash) { setError('请先上传模板包'); return }
    setPublishing(true)
    setError('')
    try {
      const priceMist = String(BigInt(Math.round(parseFloat(form.priceSUI) * 1e9)))
      const res = await fetch('/api/market/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
          storagePath: bundlePath,
          contentHash,
          previewImages: previewPaths,
          readme: form.readme || null,
          priceMist,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      router.push(`/market/${data.listing.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-2xl mx-auto px-6 py-10 text-center">
          <p style={{ color: 'var(--text-muted)' }}>请先 <a href="/login" style={{ color: 'var(--accent-cyan)' }}>登录</a></p>
        </div>
      </div>
    )
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const canPublish = form.name && form.description && form.category && form.priceSUI && bundlePath && !uploading && !publishing

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6 animate-fade-up" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">发布模板</span>
        </h1>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <WalletConnect />
        </div>

        <div className="space-y-4 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>名称 *</label>
            <input value={form.name} onChange={set('name')} className="input-dark w-full" placeholder="模板名称" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>描述 *</label>
            <textarea value={form.description} onChange={set('description')} className="input-dark w-full" rows={3} placeholder="简短描述" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>分类 *</label>
            <input value={form.category} onChange={set('category')} className="input-dark w-full" placeholder="如: 内容媒体, 交易金融, 开发工具" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>标签（逗号分隔）</label>
            <input value={form.tags} onChange={set('tags')} className="input-dark w-full" placeholder="AI, 新闻, 自动化" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>价格 (SUI) *</label>
            <input value={form.priceSUI} onChange={set('priceSUI')} type="number" step="0.01" min="0.01" className="input-dark w-full" placeholder="1.00" />
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>模板包 (.zip) *</label>
            <input type="file" accept=".zip" onChange={handleBundleUpload} className="text-sm" style={{ color: 'var(--text-muted)' }} />
            {bundlePath && <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>已上传 ✓</p>}
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>预览图</label>
            <input type="file" accept="image/*" multiple onChange={handlePreviewUpload} className="text-sm" style={{ color: 'var(--text-muted)' }} />
            {previewPaths.length > 0 && <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>已上传 {previewPaths.length} 张 ✓</p>}
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>详细说明</label>
            <textarea value={form.readme} onChange={set('readme')} className="input-dark w-full" rows={6} placeholder="详细的使用说明（支持纯文本）" />
          </div>

          {error && <p className="text-sm" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</p>}

          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all disabled:opacity-30"
            style={{ color: 'var(--accent-cyan)' }}
          >
            {uploading ? '上传中...' : publishing ? '发布中...' : '发布模板'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/app/market/publish/page.tsx
git commit -m "feat(market): add publish page with upload and listing creation"
```

---

## Task 17: Frontend — My Market Page

**Files:**
- Create: `web/app/market/my/page.tsx`

**Step 1: Create the my market page**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'
import { useAuth } from '@web/components/auth-provider'

interface MyEntitlement {
  id: string
  status: string
  grantedAt: string
  bundle: { id: string; name: string; category: string; version: string }
  order: { priceMist: string; txDigest: string; createdAt: string }
}

function formatSUI(mist: string): string {
  const sui = Number(BigInt(mist)) / 1e9
  return sui.toFixed(2)
}

export default function MyMarketPage() {
  const { user } = useAuth()
  const [entitlements, setEntitlements] = useState<MyEntitlement[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    fetch('/api/market/my')
      .then(r => r.ok ? r.json() : { entitlements: [] })
      .then(data => setEntitlements(data.entitlements || []))
      .finally(() => setLoading(false))
  }, [user])

  async function handleDownload(bundleId: string) {
    setDownloading(bundleId)
    try {
      const res = await fetch(`/api/market/download?bundleId=${bundleId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.open(data.downloadUrl, '_blank')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-3xl mx-auto px-6 py-10 text-center">
          <p style={{ color: 'var(--text-muted)' }}>请先 <a href="/login" style={{ color: 'var(--accent-cyan)' }}>登录</a></p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6 animate-fade-up" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">我的购买</span>
        </h1>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : entitlements.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }}>暂无购买记录</p>
            <Link href="/market" className="text-sm mt-2 inline-block" style={{ color: 'var(--accent-cyan)' }}>浏览市场</Link>
          </div>
        ) : (
          <div className="space-y-4 stagger-children">
            {entitlements.map(ent => (
              <div key={ent.id} className="glass-card p-5 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {ent.bundle.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="badge badge-cyan">{ent.bundle.category}</span>
                    <span>v{ent.bundle.version}</span>
                    <span>{formatSUI(ent.order.priceMist)} SUI</span>
                    <span>{new Date(ent.grantedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(ent.bundle.id)}
                  disabled={downloading === ent.bundle.id}
                  className="glass-card px-4 py-2 text-sm transition-all"
                  style={{ color: 'var(--accent-cyan)', opacity: downloading === ent.bundle.id ? 0.5 : 1 }}
                >
                  {downloading === ent.bundle.id ? '生成链接...' : '下载'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Create the my-entitlements API endpoint**

Create `web/app/api/market/my/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@web/lib/auth/session'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entitlements = await prisma.entitlement.findMany({
    where: { memberId: session.memberId, status: 'active' },
    include: {
      bundle: { select: { id: true, name: true, category: true, version: true } },
      order: { select: { priceMist: true, txDigest: true, createdAt: true } },
    },
    orderBy: { grantedAt: 'desc' },
  })

  return NextResponse.json({ entitlements })
}
```

**Step 3: Commit**

```bash
git add web/app/market/my/page.tsx web/app/api/market/my/route.ts
git commit -m "feat(market): add my-purchases page with download"
```

---

## Task 18: Navigation & Middleware Updates

**Files:**
- Modify: `web/components/public-nav.tsx`
- Modify: `web/middleware.ts`

**Step 1: Add "市场" to navigation**

In `web/components/public-nav.tsx`, add the market link to the `links` array:

```typescript
const links = [
  { href: '/', label: '新闻' },
  { href: '/skills', label: '技能' },
  { href: '/directions', label: '养成方向' },
  { href: '/community', label: '社区' },
  { href: '/knowledge', label: '知识库' },
  { href: '/market', label: '市场' },
]
```

**Step 2: Update middleware to allow public market routes**

In `web/middleware.ts`, add these lines to the public path check (inside the `if` condition):

```typescript
    pathname.startsWith('/market') ||
    pathname.startsWith('/api/market/listings') ||
```

> Note: `/market/publish` and `/market/my` need auth — but middleware only checks Supabase auth (admin). The app's own session check happens in the API routes. Since market pages are user-facing (not admin), they should be in the public allowlist in middleware, and API routes handle their own session auth via `getSession()`.

**Step 3: Commit**

```bash
git add web/components/public-nav.tsx web/middleware.ts
git commit -m "feat(market): add market to nav and middleware public routes"
```

---

## Task 19: Verify & Test

**Step 1: Build check**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm run build
```

Expected: Build succeeds with no type errors.

**Step 2: Manual smoke test**

```bash
cd /Users/admin/Desktop/nao/clawnews/web
npm run dev
```

Verify in browser:
1. `/market` loads and shows empty state
2. `/market` link appears in navbar
3. Wallet connect button renders (requires dapp-kit CSS loaded)
4. `/market/publish` shows form (requires login)

**Step 3: End-to-end on Sui testnet**

1. Login to clawnews
2. Connect Sui wallet (testnet) and bind
3. Upload a `.zip` file and publish a bundle with price
4. Open the listing in a different browser/account
5. Create purchase intent → sign transaction → confirm
6. Download the bundle from `/market/my`

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(market): marketplace MVP complete"
```
