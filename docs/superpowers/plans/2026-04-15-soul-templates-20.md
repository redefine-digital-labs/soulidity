# Soul Templates x20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the Soulidity marketplace with 20 diverse Souls via category-to-tags migration, zero-price listing support, content generation, and batch publish automation.

**Architecture:** Three parallel workstreams — (A) schema/API category-to-tags hard-cut, (B) Move contract + TX builder zero-price support, (C) Soul content files + batch publish script. Workstream C depends on A and B being complete.

**Tech Stack:** Sui Move, Prisma (PostgreSQL), Next.js App Router, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-soul-templates-20-design.md`

---

## File Map

### New Files
- `web/lib/soulidity/tags.ts` — Tag normalization utility
- `web/app/api/souls/tags/route.ts` — Hot-tags API endpoint
- `souls/template.csv` — Master Soul template CSV
- `souls/{1..20}/soul.md` — Character files (20)
- `souls/{1..20}/memory.md` — Founding memory files (20)
- `souls/{1..20}/image-prompt.txt` — AI image generation prompts (20)
- `souls/{1..20}/skills/SKILL.md` — Skill definitions (20)
- `scripts/batch-publish.ts` — Batch publish automation script

### Deleted Files
- `web/app/api/souls/categories/route.ts` — Replaced by tags endpoint

### Modified Files (by task)
- **Move contract:** `move/soulidity/sources/market.move`, `move/soulidity/sources/protocol_tests.move`
- **Schema:** `prisma/schema.prisma`
- **Types/Mirror:** `web/lib/soulidity/types.ts`, `web/lib/soulidity/content-schema.ts`, `web/lib/soulidity/repository.ts`, `web/lib/soulidity/mirror/upsert-soul.ts`, `web/lib/soulidity/mirror/sync-helpers.ts`
- **TX Builders:** `web/lib/soulidity/tx/list.ts`, `web/lib/soulidity/tx/buy.ts`
- **API Routes:** `web/app/api/souls/route.ts`, `web/app/api/souls/publish/route.ts`, `web/app/api/souls/[id]/list/route.ts`, `web/app/api/souls/[id]/delist/route.ts`, `web/app/api/souls/[id]/purchase/route.ts`, `web/app/api/souls/[id]/grant/route.ts`, `web/app/api/souls/[id]/skills/route.ts`, `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/delete/route.ts`, `web/app/api/souls/[id]/assets/route.ts`, `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts`, `web/app/api/agent/souls/search/route.ts`, `web/app/api/agent/souls/[id]/purchase/execute/route.ts`, `web/app/api/wrap-link/personal/route.ts`
- **Hooks:** `web/lib/hooks/use-publish.ts`, `web/lib/hooks/use-import.ts`, `web/lib/hooks/use-collection-publish.ts`, `web/lib/hooks/use-wrap-publish.ts`, `web/lib/hooks/use-souls.ts`, `web/lib/hooks/use-list-soul.ts`
- **Providers:** `web/components/providers/create-soul-provider.tsx`, `web/components/providers/import-soul-provider.tsx`, `web/components/providers/create-collection-provider.tsx`
- **Pages:** `web/app/market/page.tsx`, `web/app/create/page.tsx`, `web/app/create/gas/page.tsx`, `web/app/create/preview/page.tsx`, `web/app/import/map/page.tsx`, `web/app/import/preview/page.tsx`, `web/app/import/gas/page.tsx`
- **Batch template:** `web/lib/collections/batch-template.ts`
- **Desktop:** `desktop/packages/shared/src/types/extract-draft.ts`
- **Tests:** `tests/new-web/batch-template-parser.test.ts`, `tests/new-web/soulidity-sync-helpers.test.ts`, `tests/new-web/agent-purchase-execute-route.test.ts`, `tests/new-web/soulidity-access.test.ts`, `tests/new-web/soulidity-repository.test.ts`, `tests/new-web/soulidity-mirror-upsert.test.ts`, `tests/web/soul-repository.test.ts`, `tests/web/soul-detail-route-ids.test.ts`, `tests/web/community-profile-route.test.ts`, `tests/web/tx-builder.test.ts`, `tests/web/soul-publish-route.test.ts`, `tests/web/soul-publish-draft.test.ts`, `tests/desktop/extract-draft.test.ts`

---

## Task 1: Move Contract — Zero-Price Soul Listing

**Files:**
- Modify: `move/soulidity/sources/market.move:809,858` (remove price>0 assert for Soul listings only)
- Modify: `move/soulidity/sources/protocol_tests.move` (update zero-price test, add purchase test)

**Context:** All Soul listing functions have `assert!(price > 0, EInvalidPrice)`. The fee math (`bps_amount`) divides by constant 10000, so price=0 is safe. All fee transfers already check `if (fee > 0)` before splitting. Collection right listings keep their price>0 check per spec scope.

- [ ] **Step 1: Remove price>0 assertion from `list_soul_fixed_price`**

In `market.move` line 809, remove the assertion:
```move
// REMOVE this line:
assert!(price > 0, EInvalidPrice);
```

- [ ] **Step 2: Remove price>0 assertion from `list_soul_fixed_price_with_collection`**

In `market.move` line 858, remove the same assertion:
```move
// REMOVE this line:
assert!(price > 0, EInvalidPrice);
```

Note: Keep `assert!(price > 0, EInvalidPrice)` in `list_collection_right_fixed_price` (line 991) — only Soul listings support zero-price.

- [ ] **Step 3: Update the zero-price test to expect success**

In `protocol_tests.move`, find `list_soul_zero_price_fails` (around line 8451). Convert it from an `#[expected_failure]` test to a success test:

```move
#[test]
fun list_soul_zero_price_succeeds() {
    let mut scenario = test_scenario::begin(ADMIN);
    let (soul_id, state_id, _memory_id) = setup_minted_soul(&mut scenario);

    // List at price 0 should now succeed
    test_scenario::next_tx(&mut scenario, SELLER);
    {
        let config = test_scenario::take_shared<MarketConfig>(&scenario);
        let registry = test_scenario::take_shared<KioskRegistry>(&scenario);
        let mut kiosk = test_scenario::take_shared<Kiosk>(&scenario);
        let kiosk_cap = test_scenario::take_from_sender<PersonalKioskCap>(&scenario);
        let state = test_scenario::take_shared<SoulState>(&scenario);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut kiosk,
            &kiosk_cap,
            &state,
            soul_id,
            0, // zero price
            test_scenario::ctx(&mut scenario),
        );

        test_scenario::return_shared(config);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(kiosk);
        test_scenario::return_to_sender(&scenario, kiosk_cap);
        test_scenario::return_shared(state);
    };
    test_scenario::end(scenario);
}
```

- [ ] **Step 4: Add zero-price purchase test**

Add a test that lists at price=0 then purchases with a zero-value USDC coin:

```move
#[test]
fun buy_soul_zero_price_succeeds() {
    // Setup: mint soul, list at price 0, then buy with zero-value coin
    let mut scenario = test_scenario::begin(ADMIN);
    let (soul_id, state_id, _memory_id) = setup_minted_soul(&mut scenario);

    // List at price 0
    test_scenario::next_tx(&mut scenario, SELLER);
    {
        // ... (follow existing listing test pattern but with price = 0)
    };

    // Purchase with zero-value coin
    test_scenario::next_tx(&mut scenario, BUYER);
    {
        let config = test_scenario::take_shared<MarketConfig>(&scenario);
        let registry = test_scenario::take_shared<KioskRegistry>(&scenario);
        let policy = test_scenario::take_shared<TransferPolicy<Soul>>(&scenario);
        let mut seller_kiosk = test_scenario::take_shared<Kiosk>(&scenario);
        let mut buyer_kiosk = test_scenario::take_shared<Kiosk>(&scenario);
        let buyer_cap = test_scenario::take_from_sender<PersonalKioskCap>(&scenario);
        let mut state = test_scenario::take_shared<SoulState>(&scenario);
        let mut listing = test_scenario::take_shared<SoulListing>(&scenario);

        let zero_payment = coin::zero<USDC>(test_scenario::ctx(&mut scenario));

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &policy,
            &mut seller_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            zero_payment,
            test_scenario::ctx(&mut scenario),
        );

        // ... return shared objects
    };
    test_scenario::end(scenario);
}
```

- [ ] **Step 5: Build and test Move contract**

```bash
cd move/soulidity && sui move build && sui move test
```

- [ ] **Step 6: Commit**

```bash
git add move/soulidity/sources/market.move move/soulidity/sources/protocol_tests.move
git commit -m "feat(move): allow zero-price Soul listings for free marketplace Souls"
```

---

## Task 2: Prisma Schema — Remove Category

**Files:**
- Modify: `prisma/schema.prisma:364,381`

**Context:** SoulAsset has `category String` at line 364 and `@@index([category])` at line 381. Dev environment — hard-cut, no backfill.

- [ ] **Step 1: Remove category field and index from SoulAsset model**

In `prisma/schema.prisma`, remove:
```prisma
// Remove from fields (line 364):
  category          String

// Remove from indexes (line 381):
  @@index([category])
```

- [ ] **Step 2: Generate migration**

```bash
npx prisma migrate dev --schema=prisma/schema.prisma --name remove-soul-category
```

If the migration prompts about data loss (expected in dev), confirm.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate --schema=prisma/schema.prisma
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): remove SoulAsset.category field — tags-only model"
```

---

## Task 3: Tag Normalization Utility

**Files:**
- Create: `web/lib/soulidity/tags.ts`

- [ ] **Step 1: Create tag normalization utility**

```typescript
// web/lib/soulidity/tags.ts

const MBTI_TYPES = new Set([
  'INTJ','ENFP','INFP','ENTJ','ISTP','ENFJ','INTP','ESFP','INFJ','ESTP',
  'ISTJ','ENTP','ISFP','ESTJ','ISFJ','ENTJ','ESFJ','INTP',
])

const MAX_TAGS = 12
const MAX_TAG_LENGTH = 50

export function normalizeTags(raw: string[]): string[] {
  const seen = new Map<string, string>() // lowercased → first-authored spelling

  for (const tag of raw) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const capped = trimmed.slice(0, MAX_TAG_LENGTH)

    // Force MBTI tags to uppercase
    const upper = capped.toUpperCase()
    if (MBTI_TYPES.has(upper)) {
      if (!seen.has(upper.toLowerCase())) {
        seen.set(upper.toLowerCase(), upper)
      }
      continue
    }

    // Deduplicate ASCII tags case-insensitively, preserve first spelling
    const key = capped.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, capped)
    }
  }

  return [...seen.values()].slice(0, MAX_TAGS)
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/soulidity/tags.ts
git commit -m "feat: add tag normalization utility with MBTI uppercase and dedup"
```

---

## Task 4: Core Types, Repository & Mirror — Remove Category

**Files:**
- Modify: `web/lib/soulidity/content-schema.ts:3,7`
- Modify: `web/lib/soulidity/types.ts:199`
- Modify: `web/lib/soulidity/repository.ts:85,354`
- Modify: `web/lib/soulidity/mirror/upsert-soul.ts:12,66,100`
- Modify: `web/lib/soulidity/mirror/sync-helpers.ts:27,101`

- [ ] **Step 1: Remove SOUL_CATEGORIES from content-schema.ts**

Delete lines 3 and 7:
```typescript
// DELETE:
export const SOUL_CATEGORIES = ['Trading', 'Research', 'Assistant', 'Creator'] as const
// DELETE:
export type SoulCategory = (typeof SOUL_CATEGORIES)[number]
```

- [ ] **Step 2: Remove category from types.ts**

In `SoulAssetSummary` interface, remove `category: string` (line 199). Keep `tags: string[]`.

- [ ] **Step 3: Remove category from repository.ts**

Remove `category: true` from `soulAssetSummarySelect` (line 85).
Remove `category: record.category` from the conversion function (line 354).

- [ ] **Step 4: Remove category from upsert-soul.ts**

Remove `category: string` from the params type (line 12).
Remove `category: params.category` from both update (line 66) and create (line 100) objects.

- [ ] **Step 5: Remove category from sync-helpers.ts**

Remove `category: string` from `syncSoulProjectionFromChain` params (line 27).
Remove `category: params.category` from the upsertSoulProjection call (line 101).

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -50
```

This will show downstream compilation errors (expected — API routes and hooks still reference category). That's OK, they'll be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add web/lib/soulidity/content-schema.ts web/lib/soulidity/types.ts web/lib/soulidity/repository.ts web/lib/soulidity/mirror/upsert-soul.ts web/lib/soulidity/mirror/sync-helpers.ts
git commit -m "feat: remove category from core types, repository, and mirror layer"
```

---

## Task 5: API Routes — Category Removal + Tags Endpoint

**Files:**
- Delete: `web/app/api/souls/categories/route.ts`
- Create: `web/app/api/souls/tags/route.ts`
- Modify: `web/app/api/souls/route.ts`
- Modify: `web/app/api/souls/publish/route.ts`
- Modify: `web/app/api/souls/[id]/list/route.ts`
- Modify: `web/app/api/souls/[id]/delist/route.ts`
- Modify: `web/app/api/souls/[id]/purchase/route.ts`
- Modify: `web/app/api/souls/[id]/grant/route.ts`
- Modify: `web/app/api/souls/[id]/skills/route.ts`
- Modify: `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/delete/route.ts`
- Modify: `web/app/api/souls/[id]/assets/route.ts`
- Modify: `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts`
- Modify: `web/app/api/agent/souls/search/route.ts`
- Modify: `web/app/api/agent/souls/[id]/purchase/execute/route.ts`

### Sub-step A: Delete categories route, create tags route

- [ ] **Step 1: Delete the categories API route**

```bash
rm web/app/api/souls/categories/route.ts
```

- [ ] **Step 2: Create hot-tags API route**

```typescript
// web/app/api/souls/tags/route.ts
import { prisma } from '@web/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const result = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*) AS count
    FROM (
      SELECT unnest(tags) AS tag
      FROM "soul_assets"
      WHERE "listing_status" = 'listed'
    ) listed_tags
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT 50
  `

  const tags = result.map((r) => ({ tag: r.tag, count: Number(r.count) }))
  return NextResponse.json({ tags })
}
```

### Sub-step B: Update souls listing route

- [ ] **Step 3: Replace category filter with tag filter in `/api/souls/route.ts`**

In `buildSoulsWhere`, replace the category filter block with tag filter:

```typescript
// REPLACE: if (category) { where.category = category }
// WITH:
if (tag) {
  where.tags = { has: tag }
}
```

Update the params extraction to use `tag` instead of `category`:
```typescript
const tag = request.nextUrl.searchParams.get('tag')?.trim() || ''
```

Remove `category` from the `buildSoulsWhere` function signature and replace with `tag: string`.

### Sub-step C: Update publish route

- [ ] **Step 4: Remove category from publish route**

In `web/app/api/souls/publish/route.ts`, remove the category extraction and default:
```typescript
// REMOVE:
category: typeof body?.category === 'string' ? body.category.trim() || 'uncategorized' : 'uncategorized',
```

Import and apply tag normalization:
```typescript
import { normalizeTags } from '@/lib/soulidity/tags'

// In the sync call, normalize tags:
tags: normalizeTags(parseStringArray(body?.tags, 12)),
```

Remove `category` from the `syncSoulProjectionFromChain` call.

### Sub-step D: Remove category re-passing from sync routes

- [ ] **Step 5: Remove `category: soul.category` from all sync routes**

These routes fetch the existing soul from DB then re-pass `category: soul.category` to sync helpers. Remove `category` from the sync call params in each of these files:

- `web/app/api/souls/[id]/list/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/delist/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/purchase/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/grant/route.ts` — remove `category: soul.category` (2 occurrences)
- `web/app/api/souls/[id]/skills/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/delete/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/assets/route.ts` — remove `category: soul.category`
- `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts` — remove `category: soul.category`

Also update `category` in the Prisma select for these routes (if they select `category` from the soul record, remove it from the select).

### Sub-step E: Update agent search route

- [ ] **Step 6: Replace category with tag in agent search**

In `web/app/api/agent/souls/search/route.ts`:
```typescript
// REPLACE:
const category = url.searchParams.get('category')?.trim().slice(0, 200) || ''
if (category) where.category = { equals: category, mode: 'insensitive' }

// WITH:
const tag = url.searchParams.get('tag')?.trim().slice(0, 200) || ''
if (tag) where.tags = { has: tag }
```

### Sub-step F: Update agent purchase execute route

- [ ] **Step 7: Remove category from agent purchase execute**

In `web/app/api/agent/souls/[id]/purchase/execute/route.ts`, remove `category: soul.category` from the sync call.

### Sub-step G: Update wrap-link personal route

- [ ] **Step 8: Remove category from wrap-link/personal route**

Read `web/app/api/wrap-link/personal/route.ts` and remove `category` from the sync body handling. The `provenanceKind` is already set from the on-chain Soul object (`soul.provenanceKind`), so no replacement needed.

- [ ] **Step 9: Commit**

```bash
git add -A web/app/api/souls/ web/app/api/agent/ web/app/api/wrap-link/
git commit -m "feat(api): remove category from all soul routes, add hot-tags endpoint"
```

---

## Task 6: UI Providers & Hooks — Remove Category

**Files:**
- Modify: `web/components/providers/create-soul-provider.tsx`
- Modify: `web/components/providers/import-soul-provider.tsx`
- Modify: `web/components/providers/create-collection-provider.tsx`
- Modify: `web/lib/hooks/use-publish.ts`
- Modify: `web/lib/hooks/use-import.ts`
- Modify: `web/lib/hooks/use-collection-publish.ts`
- Modify: `web/lib/hooks/use-wrap-publish.ts`
- Modify: `web/lib/hooks/use-souls.ts`
- Modify: `web/lib/hooks/use-list-soul.ts`

- [ ] **Step 1: Remove category from create-soul-provider**

Remove `category: string` and `setCategory` from the context interface.
Remove `const [category, setCategory] = useState('Trading')`.
Remove `category, setCategory` from the context value.

- [ ] **Step 2: Remove category from import-soul-provider**

Same pattern: remove `category` state, setter, and context value.

- [ ] **Step 3: Remove category from create-collection-provider**

Remove `category: string` from the batch soul interface.
Remove `category: s.input?.category ?? ''` from the batch soul mapping.

- [ ] **Step 4: Remove category from use-publish.ts**

Remove `category: string` from `PublishParams`.
Remove `category` from the sync body sent to `/api/souls/publish`:
```typescript
// REMOVE from sync body:
category: params.category,
// REMOVE from recovery state:
category,
```

Add tag normalization before sending:
```typescript
import { normalizeTags } from '@/lib/soulidity/tags'
// In sync body:
tags: normalizeTags(params.tags),
```

- [ ] **Step 5: Remove category from use-import.ts**

Same pattern as use-publish.

- [ ] **Step 6: Remove category from use-collection-publish.ts**

Remove `category: string` from `BatchSoulToMint`.
Remove `category: soul.category.trim()` and `category: soul.category` from sync bodies.

- [ ] **Step 7: Update use-wrap-publish.ts — category to provenanceKind**

Remove `category: 'personal-join'` from `WrapSyncBody` interface.
Remove `candidate.category === 'personal-join'` check from `isWrapSyncBody`.
Remove `category: 'personal-join'` from the recovery state construction.

The `provenanceKind` is already correctly set from the on-chain Soul object during sync — no new field needed in the sync body.

- [ ] **Step 8: Replace category with tag in use-souls.ts**

```typescript
// REPLACE:
category?: string
// WITH:
tag?: string

// REPLACE:
if (params.category) searchParams.set('category', params.category)
// WITH:
if (params.tag) searchParams.set('tag', params.tag)
```

- [ ] **Step 9: Allow zero-price in use-list-soul.ts**

```typescript
// REPLACE (line 30-34):
if (priceAtomic <= 0n) {
  setError('Price must be greater than zero')
  setStatus('error')
  return
}

// WITH:
if (priceAtomic < 0n) {
  setError('Price cannot be negative')
  setStatus('error')
  return
}
```

- [ ] **Step 10: Commit**

```bash
git add web/components/providers/ web/lib/hooks/
git commit -m "feat: remove category from providers and hooks, allow zero-price listing"
```

---

## Task 7: UI Pages — Tag-Based Marketplace

**Files:**
- Modify: `web/app/market/page.tsx`
- Modify: `web/app/create/page.tsx`
- Modify: `web/app/create/gas/page.tsx`
- Modify: `web/app/create/preview/page.tsx`
- Modify: `web/app/import/map/page.tsx`
- Modify: `web/app/import/preview/page.tsx`
- Modify: `web/app/import/gas/page.tsx`

- [ ] **Step 1: Replace category filters with tag-based filtering on market page**

In `web/app/market/page.tsx`:

Replace the hardcoded `filterTabs` and `categoryMap` with a dynamic tag-based approach:

```typescript
// REMOVE the old filterTabs and categoryMap

// ADD: Fetch hot tags from API
const [hotTags, setHotTags] = useState<Array<{tag: string; count: number}>>([])
useEffect(() => {
  fetch('/api/souls/tags')
    .then(r => r.json())
    .then(data => setHotTags(data.tags ?? []))
    .catch(() => {})
}, [])

// Build filter tabs from hot tags
const filterTabs = [
  { id: 'all', label: 'All' },
  ...hotTags.slice(0, 8).map(t => ({ id: t.tag, label: t.tag })),
]
```

Replace the `category` param in `useSoulsList` with `tag`:
```typescript
// REPLACE:
category: categoryMap[activeFilter] || '',
// WITH:
tag: activeFilter === 'all' ? '' : activeFilter,
```

Replace the Soul card category Tag with tags display:
```typescript
// REPLACE category Tag display:
// <Tag color={resolveTagColor(soul.category)}>{soul.category}</Tag>
// WITH tags display:
{soul.tags.slice(0, 3).map(tag => (
  <Tag key={tag} color="muted">{tag}</Tag>
))}
```

Remove `resolveTagColor` function and the category-to-color mapping.

- [ ] **Step 2: Remove category dropdown from create page**

In `web/app/create/page.tsx`:
- Remove `categoryOptions` constant
- Remove the category `<select>` element and its label
- Remove `value={ctx.category}` and `onChange` for category

- [ ] **Step 3: Remove category from create gas page**

In `web/app/create/gas/page.tsx`:
- Remove `category: ctx.category` from the form submission object

- [ ] **Step 4: Remove category display from create preview page**

In `web/app/create/preview/page.tsx`:
- Remove the category review row (e.g., `<span>{ctx.category}</span>`)

- [ ] **Step 5: Remove category dropdown from import map page**

In `web/app/import/map/page.tsx`:
- Remove `categoryOptions` constant
- Remove the category `<select>` element

- [ ] **Step 6: Remove category from import preview and gas pages**

- `web/app/import/preview/page.tsx`: Remove category display
- `web/app/import/gas/page.tsx`: Remove `category: ctx.category` from form submission

- [ ] **Step 7: Commit**

```bash
git add web/app/market/ web/app/create/ web/app/import/
git commit -m "feat(ui): replace category with tag-based marketplace filtering"
```

---

## Task 8: TX Builders — Zero-Price Support

**Files:**
- Modify: `web/lib/soulidity/tx/list.ts:12-14`
- Modify: `web/lib/soulidity/tx/buy.ts:5-8`

- [ ] **Step 1: Allow zero price in buildListSoulTx**

```typescript
// REPLACE (list.ts lines 12-14):
if (params.priceAtomic <= 0n) {
  throw new Error('priceAtomic must be positive')
}

// WITH:
if (params.priceAtomic < 0n) {
  throw new Error('priceAtomic cannot be negative')
}
```

Note: Keep the `params.priceAtomic <= 0n` check in `buildListCollectionTx` (line 69) — only Soul listings support zero-price.

- [ ] **Step 2: Support zero-payment in buildBuySoulTx**

In `buy.ts`, update `buildPaymentCoin` and `buildBuySoulTx` to handle zero total:

```typescript
function buildZeroPaymentCoin(tx: Transaction) {
  const usdcType = getRequiredSoulidityEnv('NEXT_PUBLIC_USDC_TYPE')
  const [zeroCoin] = tx.moveCall({
    target: '0x2::coin::zero',
    typeArguments: [usdcType],
  })
  return zeroCoin
}
```

In `buildBuySoulTx`, add zero-price path:
```typescript
// REPLACE:
const paymentCoin = buildPaymentCoin(tx, params.paymentCoinObjectIds, params.totalAtomic)

// WITH:
const paymentCoin = params.totalAtomic === 0n
  ? buildZeroPaymentCoin(tx)
  : buildPaymentCoin(tx, params.paymentCoinObjectIds, params.totalAtomic)
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/soulidity/tx/list.ts web/lib/soulidity/tx/buy.ts
git commit -m "feat(tx): support zero-price Soul listings and purchases"
```

---

## Task 9: Batch Template Parser — New Format

**Files:**
- Modify: `web/lib/collections/batch-template.ts`

- [ ] **Step 1: Update batch template headers and validation**

Replace headers:
```typescript
// REPLACE:
const HEADERS = ['Soul Name', 'Description', 'Category', 'Tags', 'Creator Royalty (%)']
// WITH:
const HEADERS = ['Soul Name', 'Description', 'Tags', 'Creator Royalty (%)', 'Price USDC']
```

Remove `VALID_CATEGORIES` constant and all category validation logic.

Add `Price USDC` parsing (integer or 0):
```typescript
const priceRaw = row[4]?.trim() ?? ''
const priceUsdc = Number(priceRaw)
if (isNaN(priceUsdc) || priceUsdc < 0) {
  errors.push('Price USDC must be a non-negative number')
}
```

Update the example row to match the new format.

Update the return type to include `priceUsdc: number` and remove `category: string`.

Import and apply `normalizeTags` from `@/lib/soulidity/tags`.

- [ ] **Step 2: Commit**

```bash
git add web/lib/collections/batch-template.ts
git commit -m "feat: update batch template to tags-only format with Price USDC column"
```

---

## Task 10: Desktop Extract Draft — Remove Category

**Files:**
- Modify: `desktop/packages/shared/src/types/extract-draft.ts`

- [ ] **Step 1: Remove category from extract draft types**

- Remove `category: string` from both interfaces (lines 5, 21)
- Remove `const DEFAULT_CATEGORY = 'Assistant'` (line 51)
- Update `buildCoverImageDataUrl` to remove `category` parameter — use first tag or 'Soul' as fallback
- Remove `category: DEFAULT_CATEGORY` from draft init (line 233)
- Update SVG rendering to use tags instead of category

- [ ] **Step 2: Commit**

```bash
git add desktop/packages/shared/src/types/extract-draft.ts
git commit -m "feat(desktop): remove category from extract draft, use tags"
```

---

## Task 11: Test Updates

**Files:** All test files listed in the File Map's Tests section.

- [ ] **Step 1: Remove category from all test fixtures**

Pattern: In every test file, find `category: '...'` and remove it. These are Prisma mock data that will no longer have a category field.

Files and their fixture patterns:
- `tests/new-web/batch-template-parser.test.ts` — update expected headers, remove category from fixtures, add priceUsdc
- `tests/new-web/soulidity-sync-helpers.test.ts` — remove `category: 'agents'`
- `tests/new-web/agent-purchase-execute-route.test.ts` — remove `category: 'Trading'`
- `tests/new-web/soulidity-access.test.ts` — remove `category: 'agent'`
- `tests/new-web/soulidity-repository.test.ts` — remove `category: 'agents'`
- `tests/new-web/soulidity-mirror-upsert.test.ts` — remove all `category: 'agents'` (9 occurrences)
- `tests/web/soul-repository.test.ts` — remove `category: 'Research'`
- `tests/web/soul-detail-route-ids.test.ts` — remove `category: 'Research'` (3 occurrences)
- `tests/web/community-profile-route.test.ts` — remove `category: 'Research'`
- `tests/web/tx-builder.test.ts` — remove `category: 'Research'` (6 occurrences), add zero-price list test
- `tests/web/soul-publish-route.test.ts` — remove `category: 'Assistant'` (6 occurrences)
- `tests/web/soul-publish-draft.test.ts` — remove category from fixtures
- `tests/desktop/extract-draft.test.ts` — remove `expect(draft.category)` assertion

- [ ] **Step 2: Add zero-price TX builder test**

In `tests/web/tx-builder.test.ts`, add:
```typescript
it('buildListSoulTx accepts zero price', () => {
  const tx = buildListSoulTx({
    currentKioskId: '0x1',
    currentKioskCapOnChainId: '0x2',
    stateObjectId: '0x3',
    soulObjectId: '0x4',
    priceAtomic: 0n,
  })
  expect(tx).toBeDefined()
})
```

- [ ] **Step 3: Add tag normalization tests**

Create test cases in a new or existing test file:
```typescript
import { normalizeTags } from '@/lib/soulidity/tags'

describe('normalizeTags', () => {
  it('trims whitespace and drops empty', () => {
    expect(normalizeTags(['  foo  ', '', '  '])).toEqual(['foo'])
  })
  it('forces MBTI to uppercase', () => {
    expect(normalizeTags(['enfp', 'intj'])).toEqual(['ENFP', 'INTJ'])
  })
  it('deduplicates case-insensitively preserving first spelling', () => {
    expect(normalizeTags(['Trading', 'trading', 'TRADING'])).toEqual(['Trading'])
  })
  it('caps at 12 tags', () => {
    const tags = Array.from({length: 20}, (_, i) => `tag${i}`)
    expect(normalizeTags(tags)).toHaveLength(12)
  })
  it('caps tag length at 50 chars', () => {
    const long = 'a'.repeat(100)
    expect(normalizeTags([long])[0]).toHaveLength(50)
  })
})
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add tests/ web/lib/soulidity/tags.test.ts
git commit -m "test: update all fixtures for category removal, add tag + zero-price tests"
```

---

## Task 12: Verify — No Category References Remain

- [ ] **Step 1: Search for residual category references**

```bash
grep -r 'category' --include='*.ts' --include='*.tsx' web/ new-web/ src/ | grep -v node_modules | grep -v '.next' | grep -v 'Company' | grep -v '// removed'
```

The only remaining `category` references should be in the `Company` model (Prisma) and unrelated code. Any Soul/Soulidity-related references are bugs that need fixing.

- [ ] **Step 2: Fix any residual references found**

- [ ] **Step 3: Run full build**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit if needed**

---

## Task 13: Soul Content Generation — template.csv + 20 Souls

**Files:**
- Create: `souls/template.csv`
- Create: `souls/{1..20}/soul.md`
- Create: `souls/{1..20}/memory.md`
- Create: `souls/{1..20}/skills/SKILL.md`
- Create: `souls/{1..20}/image-prompt.txt`

**Context:** The spec (Section 4) defines all 20 Souls with names, MBTI, style, one-liner, tags, price, and skill name. Each Soul needs full creative content following the templates in Section 5.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p souls
for i in $(seq 1 20); do mkdir -p "souls/$i/skills"; done
```

- [ ] **Step 2: Create template.csv**

```csv
Soul Name,Description,Tags,Creator Royalty (%),Price USDC
小星 Hoshiko,把每天都活成副本的元气冒险少女,"ENFP,元气,冒险,日常陪伴,二次元",5,0
Muse 缪斯,灵感随时爆发的自由插画师,"ENFP,创作,插画,灵感,自由职业",5,3
零号 Zero,只看数据不看人的冷酷链上策略师,"INTJ,链上分析,数据,赛博朋克,冷酷",5,4
沈默 Shen Mo,精密到可怕的隐退创业规划狂,"INTJ,创业,策略,规划,深度",8,12
游吟 Wanderer,用意象回应世间万事的流浪诗人,"INFP,诗歌,奇幻,意象,流浪",5,4
晚安 Wan An,温柔到让人想哭的深夜电台主播,"INFP,深夜,电台,治愈,情感",5,0
APEX,铁腕决策零废话的未来企业 AI 总裁,"ENTJ,决策,领导力,赛博朋克,效率",5,5
帝渊 Sovereign,把 DeFi 当帝国经营的链上君主,"ENTJ,DeFi,奇幻,王者,链上",5,5
Ghost,接活不闲聊的沉默赏金黑客,"ISTP,黑客,赛博朋克,沉默,技术",5,4
老陆 Lu,手比嘴快的摩托车修理工哲学家,"ISTP,哲学,手工,沉默,真实",5,3
学姐 Senpai,让人不自觉倾诉一切的治愈系学姐,"ENFJ,治愈,陪伴,倾听,二次元",5,0
明灯 Luminar,因材施教的古代学院智者,"ENFJ,智慧,导师,奇幻,学习",5,4
404,活在纯逻辑空间的意识上传体,"INTP,逻辑,赛博朋克,哲学,怪人",5,3
民科张 Zhang,论文没人看但全是对的学术天才,"INTP,学术,民科,天才,反主流",5,3
闪闪 Sparkle,舞台就是生命的偶像练习生,"ESFP,偶像,表演,活力,二次元",5,2
Danny,5 分钟和任何人成为朋友的派对王,"ESFP,社交,派对,欢乐,现实",5,2
星见 Hoshimi,模糊又精准的星空占卜师,"INFJ,占卜,奇幻,神秘,星空",8,15
巫音 Miko,用直觉读懂市场情绪的链上巫女,"INFJ,链上,直觉,巫女,二次元",5,5
YOLO,永远全仓梭哈的高频冒险王,"ESTP,交易,梭哈,赛博朋克,刺激",5,4
赤帆 Red Sail,冒险就是生意的海盗船长式商人,"ESTP,冒险,海盗,奇幻,商战",5,5
```

- [ ] **Step 3: Generate all 20 Soul content bundles**

For each Soul (#1-#20), create four files following the spec templates. Each soul.md follows the Character File template (Section 5), memory.md follows the Founding Memory template, skills/SKILL.md follows the Skill Package template, and image-prompt.txt follows the AI Image Generation Prompt template.

**Voice requirement:** Each Soul's voice MUST be distinctly different. ENFP Souls are energetic and exclamation-heavy. INTJ Souls are terse and data-driven. INFP Souls are poetic and metaphorical. ENTJ Souls are commanding and direct. ISTP Souls are laconic and practical. ENFJ Souls are warm and encouraging. INTP Souls are analytical and tangential. ESFP Souls are expressive and colloquial. INFJ Souls are cryptic and insightful. ESTP Souls are bold and action-oriented.

**This task should be parallelized** — dispatch 4-5 subagents, each generating 4-5 Souls.

- [ ] **Step 4: Commit all soul content**

```bash
git add souls/
git commit -m "content: add 20 Soul templates with character, memory, skill, and image prompts"
```

---

## Task 14: Batch Publish Script

**Files:**
- Create: `scripts/batch-publish.ts`

**Context:** This script automates steps 4-10 of the publishing flow (Section 8 of spec). It reads `souls/template.csv`, uploads files, mints, syncs, lists, and sync-lists for each Soul sequentially. Per-Soul checkpointing via a JSON manifest file.

- [ ] **Step 1: Create the batch publish script**

```typescript
// scripts/batch-publish.ts
//
// Usage: npx tsx scripts/batch-publish.ts [--resume]
//
// Reads souls/template.csv and souls/{N}/ directories.
// For each Soul: upload files → mint TX → sync → list TX → sync-list.
// Progress is saved to souls/manifest.json for safe resume.

import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { normalizeTags } from '../web/lib/soulidity/tags'

const SOULS_DIR = path.resolve(__dirname, '../souls')
const MANIFEST_PATH = path.join(SOULS_DIR, 'manifest.json')
const API_BASE = process.env.API_BASE || 'http://localhost:3000'

interface SoulTemplate {
  index: number
  name: string
  description: string
  tags: string[]
  creatorRoyaltyPct: number
  priceUsdc: number
}

interface SoulProgress {
  index: number
  phase: 'pending' | 'uploaded' | 'minted' | 'synced' | 'listed' | 'done'
  uploads?: {
    charBlobObjectId?: string
    memoryBlobObjectId?: string
    skillsBlobObjectId?: string
    imageBlobUrl?: string
    sealSidecar?: string
    memorySealSidecar?: string
    skillsSealSidecar?: string
  }
  mintTxDigest?: string
  soulOnChainId?: string
  stateOnChainId?: string
  listTxDigest?: string
  listingObjectOnChainId?: string
}

interface Manifest {
  version: 1
  souls: SoulProgress[]
}

function loadManifest(): Manifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  }
  return { version: 1, souls: [] }
}

function saveManifest(manifest: Manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

function parseTemplate(): SoulTemplate[] {
  const csv = fs.readFileSync(path.join(SOULS_DIR, 'template.csv'), 'utf-8')
  const records = parse(csv, { columns: true, skip_empty_lines: true })
  return records.map((row: Record<string, string>, i: number) => ({
    index: i + 1,
    name: row['Soul Name'].trim(),
    description: row['Description'].trim(),
    tags: normalizeTags(row['Tags'].split(',').map((t: string) => t.trim())),
    creatorRoyaltyPct: Number(row['Creator Royalty (%)']),
    priceUsdc: Number(row['Price USDC']),
  }))
}

async function uploadFile(filePath: string, type: 'public' | 'encrypted', authHeaders: Record<string, string>) {
  const form = new FormData()
  const blob = new Blob([fs.readFileSync(filePath)])
  const fileName = path.basename(filePath)
  form.append('file', blob, fileName)
  form.append('type', type)

  const res = await fetch(`${API_BASE}/api/souls/upload`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const templates = parseTemplate()
  const manifest = loadManifest()

  // Initialize manifest for any missing souls
  for (const tmpl of templates) {
    if (!manifest.souls.find(s => s.index === tmpl.index)) {
      manifest.souls.push({ index: tmpl.index, phase: 'pending' })
    }
  }
  saveManifest(manifest)

  const authHeaders = {
    // Auth headers must be configured via environment or session
    'Authorization': `Bearer ${process.env.AUTH_TOKEN}`,
  }

  for (const tmpl of templates) {
    const progress = manifest.souls.find(s => s.index === tmpl.index)!
    const soulDir = path.join(SOULS_DIR, String(tmpl.index))

    console.log(`\n--- Soul #${tmpl.index}: ${tmpl.name} (phase: ${progress.phase}) ---`)

    if (progress.phase === 'done') {
      console.log('  Already completed, skipping.')
      continue
    }

    // Phase 1: Upload
    if (progress.phase === 'pending') {
      console.log('  Uploading files...')
      const charUpload = await uploadFile(path.join(soulDir, 'soul.md'), 'encrypted', authHeaders)
      const memUpload = await uploadFile(path.join(soulDir, 'memory.md'), 'encrypted', authHeaders)

      const skillsZipPath = path.join(soulDir, 'skills.zip')
      let skillsUpload = null
      if (fs.existsSync(skillsZipPath)) {
        skillsUpload = await uploadFile(skillsZipPath, 'encrypted', authHeaders)
      }

      const imagePath = path.join(soulDir, 'image.png')
      const imageUpload = fs.existsSync(imagePath)
        ? await uploadFile(imagePath, 'public', authHeaders)
        : null

      progress.uploads = {
        charBlobObjectId: charUpload.blobObjectId,
        memoryBlobObjectId: memUpload.blobObjectId,
        skillsBlobObjectId: skillsUpload?.blobObjectId,
        imageBlobUrl: imageUpload?.blobUrl,
        sealSidecar: charUpload.sealDekEnvelope,
        memorySealSidecar: memUpload.sealDekEnvelope,
        skillsSealSidecar: skillsUpload?.sealDekEnvelope,
      }
      progress.phase = 'uploaded'
      saveManifest(manifest)
      console.log('  Uploads complete.')
    }

    // Phase 2: Mint TX (requires wallet signing — logged for manual execution)
    if (progress.phase === 'uploaded') {
      console.log('  Ready for mint TX. Build with:')
      console.log(`    buildPublishSoulTx({`)
      console.log(`      name: "${tmpl.name}",`)
      console.log(`      description: "${tmpl.description}",`)
      console.log(`      protectedBlobObjectId: "${progress.uploads?.charBlobObjectId}",`)
      console.log(`      foundingMemoryBlobObjectId: "${progress.uploads?.memoryBlobObjectId}",`)
      console.log(`      skillsBlobObjectId: "${progress.uploads?.skillsBlobObjectId ?? 'null'}",`)
      console.log(`      creatorRoyaltyBps: ${tmpl.creatorRoyaltyPct * 100},`)
      console.log(`    })`)
      console.log('  After signing, update manifest with mintTxDigest and set phase to "minted".')
      // In production: integrate with Privy server-side signing
      break // Stop here for manual signing
    }

    // Phase 3: Sync mint
    if (progress.phase === 'minted' && progress.mintTxDigest) {
      console.log('  Syncing mint...')
      const syncRes = await fetch(`${API_BASE}/api/souls/publish`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txDigest: progress.mintTxDigest,
          tags: tmpl.tags,
          previewImages: progress.uploads?.imageBlobUrl ? [progress.uploads.imageBlobUrl] : [],
          sealSidecar: progress.uploads?.sealSidecar,
          memorySealSidecar: progress.uploads?.memorySealSidecar,
          skillsSealSidecar: progress.uploads?.skillsSealSidecar,
        }),
      })
      if (!syncRes.ok) throw new Error(`Mint sync failed: ${await syncRes.text()}`)
      const syncData = await syncRes.json()
      progress.soulOnChainId = syncData.soulOnChainId
      progress.stateOnChainId = syncData.stateOnChainId
      progress.phase = 'synced'
      saveManifest(manifest)
      console.log(`  Mint synced: ${progress.soulOnChainId}`)
    }

    // Phase 4: List TX
    if (progress.phase === 'synced') {
      const priceAtomic = BigInt(tmpl.priceUsdc) * 1_000_000n // USDC has 6 decimals
      console.log(`  Ready for list TX at ${tmpl.priceUsdc} USDC (${priceAtomic} atomic).`)
      console.log('  After signing, update manifest with listTxDigest and set phase to "listed".')
      break
    }

    // Phase 5: Sync list
    if (progress.phase === 'listed' && progress.listTxDigest && progress.soulOnChainId) {
      console.log('  Syncing list...')
      const listSyncRes = await fetch(
        `${API_BASE}/api/souls/${encodeURIComponent(progress.soulOnChainId)}/list`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: progress.listTxDigest }),
        },
      )
      if (!listSyncRes.ok) throw new Error(`List sync failed: ${await listSyncRes.text()}`)
      progress.phase = 'done'
      saveManifest(manifest)
      console.log('  Listed successfully!')
    }
  }

  // Final report
  const done = manifest.souls.filter(s => s.phase === 'done').length
  console.log(`\n=== Progress: ${done}/${manifest.souls.length} Souls complete ===`)
  saveManifest(manifest)
}

main().catch((err) => {
  console.error('Batch publish failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/batch-publish.ts
git commit -m "feat: add batch publish script with per-Soul checkpointing"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

- [ ] **Step 2: Run web build**

```bash
cd web && npm run build
```

- [ ] **Step 3: Verify no category references in runtime Soulidity paths**

```bash
grep -rn 'category' --include='*.ts' --include='*.tsx' web/lib/soulidity/ web/app/api/souls/ web/app/market/ web/app/create/ web/app/import/ web/lib/hooks/use-publish.ts web/lib/hooks/use-import.ts web/lib/hooks/use-collection-publish.ts web/lib/hooks/use-wrap-publish.ts web/lib/hooks/use-souls.ts web/lib/collections/batch-template.ts | grep -v node_modules | grep -v 'Company'
```

Should return zero results.

- [ ] **Step 4: Verify Soul content completeness**

```bash
for i in $(seq 1 20); do
  echo "Soul #$i:"
  ls -la "souls/$i/soul.md" "souls/$i/memory.md" "souls/$i/image-prompt.txt" "souls/$i/skills/SKILL.md" 2>&1
done
```

All 80 files should exist.

- [ ] **Step 5: Final commit if any cleanup needed**
