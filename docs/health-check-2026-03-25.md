# Repository Health Check Report

**Date**: 2026-03-25
**Branch**: `feat/soul-marketplace-v1`
**Overall Health**: Moderate — no critical blockers, several high-priority items need attention

---

## 1. Security Risks

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 1 | **SSRF** — `/api/submit` passes user URL to `scrapeUrl()` → server-side `fetch()` with no scheme/IP validation | **HIGH** | `web/app/api/submit/route.ts:98`, `web/lib/scraper.ts:8` |
| 2 | **No auth on `/api/submit`** — unauthenticated, triggers LLM calls (costs money), no rate limit | **HIGH** | `web/app/api/submit/route.ts` |
| 3 | `/api/stats` exposes internal metrics without auth | MEDIUM | `web/app/api/stats/route.ts` |
| 4 | `/api/companies` unbounded `limit` param (no cap) | MEDIUM | `web/app/api/companies/route.ts` |
| 5 | Raw `err.message` leaked to clients in 7+ routes | MEDIUM | Multiple API routes |
| 6 | Hardcoded BIP39 mnemonic fallback in E2E script | MEDIUM | `web/scripts/e2e-agent-register.ts:16` |
| 7 | `post.type` not validated against allowlist | MEDIUM | `web/app/api/community/posts/route.ts:78` |
| 8 | In-memory rate limiter ineffective in serverless (Vercel) | MEDIUM | `web/lib/rate-limit.ts` |
| 9 | IP rate limiting fully disabled without `TRUST_PROXY_HEADERS` | MEDIUM | `web/lib/rate-limit.ts` |

**Positive findings**: No SQL injection (raw queries parameterized), no XSS (`dangerouslySetInnerHTML` absent), no hardcoded production secrets, crypto (AES-256-GCM, HMAC) implemented correctly.

---

## 2. Performance Issues

### P1 — High Impact

| Finding | Location |
|---------|----------|
| **Dedup N+1** — fetches ALL recent RawItems per collected item (N queries x M rows each) | `src/collector/dedup.ts:28-32` |
| **Leaderboard unbounded** — loads ALL members into memory, sorts in JS | `web/app/api/community/leaderboard/route.ts:10-18` |
| **Stats route** — 5 COUNT queries per request, no caching | `web/app/api/stats/route.ts` |
| **Missing index** — `Publication.articleId` has no `@@index` | `prisma/schema.prisma:118-127` |
| **RSS feeds sequential** — 3 feeds fetched one-by-one (up to 30s) | `src/collector/rss.ts:18-38` |

### P2 — Medium Impact

| Finding | Location |
|---------|----------|
| Company upsert loop (2 DB calls per company) | `web/app/api/submit/route.ts:177-186` |
| Skills upsert — individual roundtrip per skill | `src/collector/scan-skills.ts:69-94` |
| Reconcile loop — sequential on-chain RPC, no `p-limit` | `src/db/reconcile-soul-latest-releases.ts:60-107` |
| Agent access — sequential pass verification (on-chain RPC per pass) | `web/app/api/agent/souls/[id]/access/route.ts:118-144` |
| Missing indexes: `Publication.publishedAt`, `RawItem[titleHash,status,createdAt]`, `RawItem[sourceType,status,createdAt]` | `prisma/schema.prisma` |
| Leaderboard/tags/skills routes — no caching at all | Multiple API routes |
| OpenAI client instantiated per request (should be singleton) | `web/app/api/submit/route.ts:138-141` |
| GitHub queries & collectors run sequentially | `src/collector/github.ts`, `src/collector/run.ts` |

### P3 — Low Impact

| Finding | Location |
|---------|----------|
| Publisher writes not transactional (article update + publication create) | `src/publisher/publish.ts:54-57` |
| Homepage SSR fetches 50 articles with joins on every request | `web/app/page.tsx:8-16` |

---

## 3. Outdated Dependencies

### Urgent — Security Advisories

| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| **next** | 16.1.6 | **16.1.7+** | 5 CVEs (HTTP smuggling, CSRF bypass, DoS) |
| **react / react-dom** | 19.2.3 | 19.2.4 | Patch, trivial |

### High Priority

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `@anthropic-ai/sdk` | 0.39.0 | 0.80.0 | 41 releases behind (0.x = breaking per minor) |
| `@mysten/sui` | 2.6.0 | 2.11.0 | 5 minor versions behind, core to marketplace |
| `@mysten/seal` | 1.0.1 | 1.1.1 | Minor, Seal access control |
| Prisma stack | 7.4.2 | 7.5.0 | Minor bump, resolves transitive vuln paths |
| `openai` | 6.25.0 | 6.32.0 | 7 minor versions behind |
| `@privy-io/react-auth` | 3.17.0 | 3.18.0 | Minor, auth provider |
| `grammy` | 1.40.1 | 1.41.1 | Minor, Telegram bot |

### Defer — Major Version Bumps (need migration)

| Package | Current | Latest |
|---------|---------|--------|
| TypeScript | 5.9.3 | 6.0.2 |
| Vitest | 3.2.4 | 4.1.1 |
| node-cron | 3.0.3 | 4.2.1 |
| ESLint | 9.39.3 | 10.1.0 |
| @types/node | 22.19.13 | 25.5.0 |

### Security Audit Summary

- **Root**: 11 vulnerabilities (6 high, 5 moderate) — mostly transitive via Prisma (hono, effect, lodash)
- **Web**: 16 vulnerabilities (9 high, 7 moderate) — includes `next`, `undici`, `flatted` CVEs
- **8 duplicate packages** between root and web could be consolidated with npm workspaces

### Duplicate Dependencies (root + web)

| Package | Root Version | Web Version |
|---------|-------------|-------------|
| `@prisma/adapter-pg` | ^7.4.2 | ^7.4.2 |
| `@prisma/client` | ^7.4.2 | ^7.4.2 |
| `prisma` | ^7.4.2 | ^7.4.2 |
| `openai` | ^6.25.0 | ^6.25.0 |
| `pg` | ^8.19.0 | ^8.19.0 |
| `dotenv` | ^17.3.1 | ^17.3.1 |
| `typescript` | ^5.7.0 | ^5 |
| `grammy` | ^1.30.0 | ^1.40.1 |

---

## 4. Dead Code

| Finding | Type | Location |
|---------|------|----------|
| `@anthropic-ai/sdk` | Unused dependency (never imported) | `package.json` |
| `src/producer/dedup-run.ts` | Orphaned file (never imported or in scripts) | `src/producer/` |
| `web/app/api/souls/[id]/release/seal/` | Empty directory (no route.ts) | `web/app/api/` |
| `collectX()` first overload | Redundant type stub (2nd overload covers all callers) | `src/collector/x.ts:146` |
| Achievement system | **Incomplete feature** — models exist, seed script exists, but achievements are never awarded programmatically | `prisma/schema.prisma`, `src/db/seed-achievements.ts` |

---

## Recommended Action Plan

### Immediate (low effort, high impact)

1. **Update `next`** to 16.1.7+ — patches 5 CVEs, minor bump
2. **Add URL validation** to `/api/submit` — block private IPs, require `https://`
3. **Add auth** to `/api/submit` — prevent anonymous LLM API abuse
4. **Add `@@index([articleId])` and `@@index([publishedAt])`** to `Publication` model
5. **Parallelize RSS collector** — swap `for` loop for `Promise.allSettled`

### Short-term (moderate effort)

6. Fix dedup N+1 — add composite index on RawItem, add `take` limit
7. Add caching to stats/leaderboard/tags routes (even a 60s in-memory TTL)
8. Cap `/api/companies` limit param, add generic error responses
9. Update `@mysten/sui`, `@mysten/seal`, Prisma stack
10. Remove dead code: `dedup-run.ts`, empty `seal/` dir, unused `@anthropic-ai/sdk`

### Longer-term

11. Migrate rate limiter to distributed store (Upstash Redis) for serverless
12. Update `@anthropic-ai/sdk` 0.39 → 0.80 (needs careful testing)
13. Decide: complete or remove the Achievement system
14. Consider npm workspaces to deduplicate shared dependencies
