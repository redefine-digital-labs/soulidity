# ClawNews Supabase Migration Design

## Overview

Migrate ClawNews from local SQLite to Supabase as the backbone. Replace `better-sqlite3` with Supabase Postgres, swap custom HMAC auth for Supabase Auth, and add real-time dashboard subscriptions.

**Deployment model:** Next.js web on Vercel, Node.js pipeline on local machine, Supabase cloud DB.

## Schema: SQLite → Postgres

Migrate 4 tables with these changes:
- `TEXT` IDs → `uuid` with `gen_random_uuid()`
- `datetime('now')` → `now()` / `timestamptz`
- `TEXT` JSON fields → `jsonb` (tags, raw_data)
- Proper foreign keys with `ON DELETE CASCADE`
- Keep `title_hash` column and dedup logic as-is

## Dual Supabase Clients

- **Pipeline (local Node.js):** `service_role` key — bypasses RLS, full read/write. Used by collector, producer, publisher.
- **Web (Vercel Next.js):** `anon` key + user session — RLS enforced. Dashboard reads/writes through authenticated client.

## RLS Policies

- `raw_items`, `articles`, `publications`: Authenticated users can SELECT, UPDATE. INSERT/DELETE restricted to service role.
- `members`: Authenticated users can SELECT. Service role manages writes.

## Database Layer Migration

**Core change:** Sync → async. `better-sqlite3` is synchronous, Supabase client is async. All DB calls become `async/await`.

**Rewrite:** `src/db/database.ts` — new file using `@supabase/supabase-js`

```ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(url, serviceRoleKey)

export const createSupabaseClient = (token?: string) =>
  createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
```

**Remove:** `src/db/init.ts`, `src/db/schema.ts` (SQLite-specific). Schema lives in Supabase migrations.

**Update callers (sync → async):**
- `src/collector/run.ts`
- `src/producer/run.ts`
- `src/publisher/bot.ts`
- `src/db/members.ts`
- `web/app/api/` routes (already async)

## Auth Migration

**Remove:** `web/lib/auth.ts` (HMAC), `web/app/api/auth/login/route.ts`, `web/app/api/auth/logout/route.ts`

**Add:** `@supabase/ssr` for Next.js integration, `web/lib/supabase.ts` for client helpers

**Rewrite:**
- `web/middleware.ts` — Supabase session refresh
- `web/app/login/page.tsx` — `supabase.auth.signInWithPassword()`

**Auth flow:**
1. Visit `/admin/*` → middleware checks Supabase session
2. No session → redirect `/login`
3. Login calls `signInWithPassword({ email, password })`
4. `@supabase/ssr` manages cookies
5. Middleware refreshes session per request

**Setup:** Create one admin user in Supabase Auth dashboard.

## Real-time Dashboard

Subscribe to Postgres changes on the `articles` table. Re-fetch article list on any change event.

```tsx
useEffect(() => {
  const channel = supabase
    .channel('articles-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'articles' },
      () => refreshArticles()
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [])
```

Enable real-time on `articles` table in Supabase dashboard.

## Environment Variables

```env
# Add
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Keep
ANTHROPIC_API_KEY=...
TG_BOT_TOKEN=...
TG_CHANNEL_ID=...

# Remove
ADMIN_PASSWORD
```

## Files to Remove

- `data/` directory (SQLite files)
- `data/*.db*` from `.gitignore`
- `better-sqlite3` from `package.json`
- `src/db/init.ts`
- `src/db/schema.ts`

## Migration Scope Summary

| Area | Remove | Add/Change |
|------|--------|------------|
| DB | `better-sqlite3`, `data/`, `init.ts`, `schema.ts` | `@supabase/supabase-js`, rewrite `database.ts` (async) |
| Auth | Custom HMAC auth, login/logout API routes | `@supabase/ssr`, Supabase Auth, rewrite middleware + login |
| Dashboard | Manual refresh | Real-time subscriptions |
| Env | `ADMIN_PASSWORD`, DB path | `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` |
| Pipeline | Sync DB calls | Async DB calls (same logic) |

## Supabase Setup (Manual, One-time)

1. Create project on supabase.com
2. Run SQL migration to create tables
3. Enable real-time on `articles` table
4. Create admin user in Auth dashboard
5. Copy keys to `.env` and Vercel env vars
