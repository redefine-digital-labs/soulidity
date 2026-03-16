# TODO

- [ ] Replace the in-memory rate limiter in `web/lib/rate-limit.ts` with a shared backend such as Redis, KV, or a database-backed bucket table so `/api/join` and `/api/register` limits work across Vercel serverless instances.
  Context: `review/batch-0` `R-001`. The current `globalThis` `Map` only protects requests handled by the same warm isolate.
