# X Data Source Implementation Plan

日期：2026-03-08

## Goal

Integrate X (Twitter) data from an external Supabase database into ClawNews while fixing three business-critical constraints:

1. Approval must not overwrite the original tweet text
2. Sync must be incremental instead of full-scan
3. Documentation must match the real Prisma and RawItem model

## Implemented Shape

### 1. Collector cursor persistence

Added `CollectorState` in Prisma:

```prisma
model CollectorState {
  source       String    @id
  lastPostedAt DateTime? @map("last_posted_at")
  lastTweetId  String?   @map("last_tweet_id")
  updatedAt    DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("collector_states")
}
```

Supporting files:

- `prisma/schema.prisma`
- `prisma/migrations/20260308115500_add_collector_state/migration.sql`
- `src/db/database.ts`

Helper API:

```ts
getCollectorState(prisma, 'x')
upsertCollectorState(prisma, 'x', {
  last_posted_at,
  last_tweet_id,
})
```

### 2. Incremental X sync

`src/collector/x.ts` now:

- loads the cursor from `collector_states`
- fetches tweets in ascending `(posted_at, tweet_id)` order
- processes results in batches
- advances the cursor after each scanned batch
- relies on `raw_items.url` unique constraint as the idempotency backstop

Important implementation rule:

- the cursor is advanced for scanned rows, even when a tweet is filtered out

That avoids repeated scans of irrelevant content on every run.

### 3. Non-destructive approval flow

`web/app/api/admin/tweets/[id]/approve/route.ts` no longer updates:

- `RawItem.title`
- `RawItem.content`

Instead it:

1. runs the LLM expansion
2. stores the result inside `rawData.review`
3. flips `status` from `pending_review` to `new`

`web/lib/admin-tweet-review.ts` encapsulates this behavior.

Stored structure:

```json
{
  "review": {
    "title": "...",
    "summary": "...",
    "reviewedAt": "2026-03-08T08:00:00.000Z"
  }
}
```

### 4. Producer integration

`src/producer/pipeline.ts` parses `rawData.review` and passes it into `buildReporterPrompt(...)`.

`src/producer/agents/reporter.ts` appends the review output as:

- a suggested title
- a suggested summary

The prompt explicitly marks these as writing guidance only, not new facts.

## Actual RawItem Mapping

The real repository does not use `sourceId`, `meta`, or a Prisma enum status field.

The X collector writes:

| Field | Value |
|------|------|
| `sourceType` | `'x'` |
| `sourceName` | `x:${username}` |
| `title` | original tweet preview |
| `content` | original tweet body |
| `url` | `tweet_url` |
| `status` | `pending_review` or `new` |
| `rawData` | tweet metadata JSON, including `tweet_id` |

## Test Coverage Added

### Collector and DB

- `tests/db/database.test.ts`
  - collector cursor read/write
- `tests/collector/x.test.ts`
  - incremental sync
  - cursor advancement on filtered rows
  - correct short/long status mapping

### Review flow

- `tests/web/admin-tweet-review.test.ts`
  - approval update does not overwrite `title` or `content`
  - review data merges into `rawData`

### Producer

- `tests/producer/agents/reporter.test.ts`
  - review hints are included in the prompt as non-authoritative guidance
- `tests/producer/pipeline.test.ts`
  - pipeline uses review hints while preserving original source text

## Verification Commands

Targeted tests:

```bash
npx vitest run --dir tests \
  tests/db/database.test.ts \
  tests/collector/x.test.ts \
  tests/producer/agents/reporter.test.ts \
  tests/producer/pipeline.test.ts \
  tests/web/admin-tweet-review.test.ts
```

Prisma generate:

```bash
npx prisma generate
```

Web build:

```bash
cd web && npm run build
```

## Follow-up Notes

- `RawItem.status` remains a string field; there is no enum migration to perform
- Existing X items without `rawData.review` continue to work
- If future volume grows further, the next optimization should be bounded catch-up per run or batched backfill controls
