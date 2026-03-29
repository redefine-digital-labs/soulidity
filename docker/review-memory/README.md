# Review-Memory Local Stack

This runs mem9 locally without OpenClaw:

- `postgres` in Docker stores both the mem9 control plane and the review-memory tenant database
- `mnemo-server` runs locally on `http://localhost:8080`
- `review-memory` MCP runs locally and proxies review skill lookups into mem9
- the default local tenant/API key is `5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0`

## Start mem9

```bash
npm run review-memory:docker:db:up
npm run review-memory:server:up
```

Keep `npm run review-memory:server:up` running in its own terminal. The server startup script downloads and builds `mnemo-server` into a local cache on first run.

Useful overrides:

```bash
REVIEW_MEMORY_PORT=8081 npm run review-memory:server:up
MEM9_REF=main npm run review-memory:server:up
```

## Environment

```bash
export MEM9_API_URL=http://127.0.0.1:8080
export MEM9_API_KEY=5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0
export REVIEW_MEMORY_REPO_ID=clawnews
```

## Start the MCP bridge for review skills

`new-review-batch` and `new-fix-batch` only see `review_memory_find_candidates` / `review_memory_record_resolution` after this MCP server is running and registered in the client:

```bash
MEM9_API_URL=http://127.0.0.1:8080 \
MEM9_API_KEY=5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0 \
REVIEW_MEMORY_REPO_ID=clawnews \
npm run mcp:review-memory
```

## Active vs archive layout

After the active-state cutover:

- `review/batch-0/review.md` and `review/batch-0/todo.md` are the active local files
- `review/batch-0/fixed.md` and `review/batch-0/not-issue.md` are small stubs only
- detailed fixed/not-issue history lives in `review/archive/batch-0/`
- review-memory MCP is the closed-history lookup layer

To migrate an existing repository into this layout:

```bash
npm run review-memory:migrate-active-state -- /path/to/repo
```

## Backfill the current batch

```bash
MEM9_API_URL=http://localhost:8080 \
MEM9_API_KEY=5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0 \
REVIEW_MEMORY_REPO_ID=clawnews \
npm run review-memory:backfill -- --batch-dir review/batch-0
```

`review-memory:backfill` reads:

- `review/archive/batch-0/fixed.md` when present, otherwise `review/batch-0/fixed.md`
- `review/archive/batch-0/not-issue.md` when present, otherwise `review/batch-0/not-issue.md`
- `review/batch-0/todo.md`

On the current repository state, a clean `clawnews` `batch-0` backfill now ends up at `processed=720`. Re-running it should report `created=0` and only `updated=720`.

## Remove accidental duplicates

```bash
MEM9_API_URL=http://localhost:8080 \
MEM9_API_KEY=5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0 \
REVIEW_MEMORY_REPO_ID=clawnews \
npm run review-memory:dedupe -- --dry-run
```

`review-memory:dedupe` is mainly for cleaning up older partial runs from before the upsert path was fixed. Normal backfill / fix flows should not need it.

## Query manually

```bash
curl -s \
  -H 'X-API-Key: 5b4c66f9-3b61-4be7-bc3d-9e346f5b2ac0' \
  -H 'X-Mnemo-Agent-Id: review-memory-debug' \
  'http://localhost:8080/v1alpha2/mem9s/memories?limit=5'
```

## Notes

- The local PostgreSQL path currently emits an upstream mem9 `sessions table migration failed` warning. That warning does not block the `memories` API used by review-memory.
- `review/batch-0/` remains the canonical local active state for open/deferred items.
- `review/archive/batch-0/` remains the canonical local detailed archive for fixed/not-issue history.
- mem9 is the closed-history lookup and sync layer.
