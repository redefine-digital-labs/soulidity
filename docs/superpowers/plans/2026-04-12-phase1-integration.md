# Phase 1 Integration — 4 Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 4 remaining Phase 1 gaps: extract sprite sheet, wire SpriteRenderer into FloatingBall with CLI status, and restore Desktop API routes with Prisma models.

**Architecture:** Three independent tracks — (A) sprite asset extraction + config update, (B) FloatingBall UI integration, (C) Desktop API restoration. Track A blocks B. Track C is fully independent.

**Tech Stack:** TypeScript, React, Electron, Prisma, Next.js API routes, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-phase1-integration-design.md`

---

## Pre-existing (verified, no work needed)

- `SpriteRenderer.tsx` — canvas-based sprite animation component, fully implemented
- `useCliStatus.ts` — CLI status hook, fully implemented (returns `{ status, emotion }`)
- `useClawEmotion.ts` — backend emotion polling hook, fully implemented
- `sprite-config.json` — animation definitions (needs parameter update only)
- `FloatingBall/index.tsx` — full component with drag, bubbles, context menu (needs sprite swap)
- `FloatingBall/styles.css` — emotion-driven CSS halo animations (keep as overlay)
- `agent-wallet.ts`, `llm-config.ts`, `status-watcher.ts` — main process modules, done
- `SettingsPanel` — complete UI with API key, base URL, model fields

---

## Task 1: Extract sprite sheet + update config

**Files:**
- Source: `desktop/data/assets/乌萨奇！！.zip`
- Create: `desktop/apps/desktop/resources/default-persona/sprite.png`
- Create: `desktop/apps/desktop/resources/default-persona/manifest.json`
- Modify: `desktop/apps/desktop/resources/default-persona/sprite-config.json`

- [ ] **Step 1: Extract sprite assets from zip**

```bash
unzip -o "desktop/data/assets/乌萨奇！！.zip" sprite.png manifest.json -d desktop/apps/desktop/resources/default-persona/
```

Expected: `sprite.png` (8,265,640 bytes, 4096×3584) and `manifest.json` appear in `resources/default-persona/`.

- [ ] **Step 2: Update sprite-config.json**

Replace the entire contents of `desktop/apps/desktop/resources/default-persona/sprite-config.json` with:

```json
{
  "src": "sprite.png",
  "frameWidth": 512,
  "frameHeight": 512,
  "columns": 8,
  "animations": {
    "idle":             { "frames": [0,1,2,3,4,5,6,7],       "fps": 4,  "loop": true },
    "thinking":         { "frames": [8,9,10,11,12,13,14,15], "fps": 6,  "loop": true },
    "working":          { "frames": [24,25,26,27,28,29,30,31], "fps": 8, "loop": true },
    "needs-attention":  { "frames": [32,33,34,35,36,37,38,39], "fps": 4, "loop": true },
    "completed":        { "frames": [16,17,18,19,20,21,22,23], "fps": 4, "loop": false },
    "error":            { "frames": [40,41,42,43,44,45,46,47], "fps": 2, "loop": true }
  }
}
```

- [ ] **Step 3: Verify files exist**

```bash
file desktop/apps/desktop/resources/default-persona/sprite.png
cat desktop/apps/desktop/resources/default-persona/sprite-config.json
cat desktop/apps/desktop/resources/default-persona/manifest.json
```

Expected: PNG image data 4096×3584, updated JSON config with 8 columns/512 frames, manifest with 乌萨奇 metadata.

- [ ] **Step 4: Commit**

```bash
git add desktop/apps/desktop/resources/default-persona/
git commit -m "feat(desktop): extract 乌萨奇 sprite sheet + update config for 512×512 frames"
```

---

## Task 2: Wire useCliStatus into FloatingBall

**Files:**
- Modify: `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`
- Modify: `desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx`

- [ ] **Step 1: Update useCliStatus to expose raw status only**

Replace the full content of `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`:

```typescript
import { useState, useEffect } from 'react'

export type CliAgentStatus = 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'

export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI
    api?.getCurrentAgentStatus?.().then((file: any) => {
      if (file?.sessions) {
        const sessions = Object.values(file.sessions) as any[]
        const active = sessions.filter((s: any) => !s.endedAt)
        const latest = active.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated)[0]
        if (latest) setStatus(latest.status)
      }
    }).catch(() => {})

    const unsub = api?.onAgentStatusChanged?.((file: any) => {
      if (file?.sessions) {
        const sessions = Object.values(file.sessions) as any[]
        const active = sessions.filter((s: any) => !s.endedAt)
        const latest = active.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated)[0]
        setStatus(latest?.status ?? 'idle')
      }
    })
    return () => { unsub?.() }
  }, [])

  return { status }
}
```

Changes from original: exported `CliAgentStatus` type, removed `emotion` field and `CLI_TO_EMOTION` mapping.

- [ ] **Step 2: Add SpriteRenderer + useCliStatus to FloatingBall**

In `desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx`, apply these changes:

**Add imports** — after existing imports at top of file, add:

```typescript
import { SpriteRenderer } from '../SpriteRenderer'
import type { SpriteSheetConfig } from '../SpriteRenderer'
import { useCliStatus } from '../../hooks/useCliStatus'
import type { CliAgentStatus } from '../../hooks/useCliStatus'
import spriteConfigJson from '../../../resources/default-persona/sprite-config.json'
```

**Add sprite config loading and status mapping** — after the `DISMISS_COOLDOWN` constant (line 105), add:

```typescript
const spriteConfig: SpriteSheetConfig = {
  ...spriteConfigJson,
  src: new URL('../../../resources/default-persona/sprite.png', import.meta.url).href,
}

/** Map 4 backend emotions to CLI 6-status for sprite animation fallback */
const EMOTION_TO_CLI_STATUS: Record<string, CliAgentStatus> = {
  idle: 'idle',
  busy: 'working',
  done: 'completed',
  night: 'error',
}

/** Map CLI 6-status to 4 CSS emotions for halo effects */
const CLI_STATUS_TO_EMOTION: Record<CliAgentStatus, string> = {
  idle: 'idle',
  thinking: 'busy',
  working: 'busy',
  'needs-attention': 'night',
  completed: 'done',
  error: 'night',
}
```

**Add useCliStatus hook call** — inside `FloatingBall()`, after `const { snapshot, emotion } = useClawEmotion()` (line 124), add:

```typescript
const { status: cliStatus } = useCliStatus()
const spriteAnimation = cliStatus !== 'idle' ? cliStatus : (EMOTION_TO_CLI_STATUS[emotion] ?? 'idle')
const haloEmotion = cliStatus !== 'idle' ? CLI_STATUS_TO_EMOTION[cliStatus] : emotion
```

**Update data-emotion attribute** — change `data-emotion={emotion}` to `data-emotion={haloEmotion}` on the ball div (line 479).

**Replace emoji with SpriteRenderer** — replace `<span className="ball__icon">🐾</span>` (line 486) with:

```tsx
<SpriteRenderer config={spriteConfig} animation={spriteAnimation} width={56} height={56} />
```

- [ ] **Step 3: Update CSS for canvas rendering**

In `desktop/apps/desktop/src/renderer/components/FloatingBall/styles.css`, replace the `.ball__icon` rule (lines 121-125):

```css
.ball__icon {
  font-size: 26px;
  line-height: 1;
  pointer-events: none;
}
```

with:

```css
.ball__icon {
  pointer-events: none;
}

.ball canvas {
  display: block;
  border-radius: 50%;
  pointer-events: none;
}
```

- [ ] **Step 4: Verify dev build compiles**

```bash
cd desktop && npm run dev 2>&1 | head -20
```

Expected: No TypeScript or build errors. (Electron window may not open without display server — compilation success is sufficient.)

- [ ] **Step 5: Commit**

```bash
git add desktop/apps/desktop/src/renderer/
git commit -m "feat(desktop): wire SpriteRenderer + CLI status into FloatingBall overlay"
```

---

## Task 3: Add Prisma models for Desktop domain

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add StarterPersonaAsset model**

Append to the end of `prisma/schema.prisma` (after line 601):

```prisma

// ============================================================
// Desktop Companion Domain
// ============================================================

model StarterPersonaAsset {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug        String   @unique
  title       String
  description String?
  coverImage  String   @map("cover_image")
  thumbnail   String
  version     String
  checksum    String
  files       Json
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([updatedAt(sort: Desc)])
  @@map("starter_persona_assets")
}
```

- [ ] **Step 2: Add DesktopCatalogEntry model**

Append after StarterPersonaAsset:

```prisma

model DesktopCatalogEntry {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sourceType  String   @map("source_type")
  sourceRef   String   @map("source_ref")
  sortOrder   Int      @default(0) @map("sort_order")
  isPublished Boolean  @default(true) @map("is_published")
  isHidden    Boolean  @default(false) @map("is_hidden")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([sourceType, sourceRef])
  @@index([isPublished, isHidden, sortOrder])
  @@index([sourceType, sortOrder])
  @@map("desktop_catalog_entries")
}
```

- [ ] **Step 3: Add DesktopDeviceSession model**

Append after DesktopCatalogEntry:

```prisma

model DesktopDeviceSession {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId           String?   @map("account_id") @db.Uuid
  account             Account?  @relation(fields: [accountId], references: [id], onDelete: SetNull)
  deviceCode          String    @unique @map("device_code")
  userCode            String    @unique @map("user_code")
  status              String    @default("pending")
  pollIntervalSeconds Int       @default(5) @map("poll_interval_seconds")
  expiresAt           DateTime  @map("expires_at") @db.Timestamptz
  confirmedAt         DateTime? @map("confirmed_at") @db.Timestamptz
  lastPolledAt        DateTime? @map("last_polled_at") @db.Timestamptz
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([status, expiresAt])
  @@index([accountId, updatedAt(sort: Desc)])
  @@map("desktop_device_sessions")
}
```

- [ ] **Step 4: Add DesktopProfile model**

Append after DesktopDeviceSession:

```prisma

model DesktopProfile {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId        String    @unique @map("account_id") @db.Uuid
  account          Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  activeSourceType String?   @map("active_source_type")
  activeSourceRef  String?   @map("active_source_ref")
  preferences      Json?
  lastSyncedAt     DateTime? @map("last_synced_at") @db.Timestamptz
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt        DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([activeSourceType, activeSourceRef])
  @@map("desktop_profiles")
}
```

- [ ] **Step 5: Add relation fields to Account model**

In the `Account` model (around line 143), add two relation fields before the closing `}`:

After `members Member[]`, add:

```prisma
  desktopDeviceSessions DesktopDeviceSession[]
  desktopProfile        DesktopProfile?
```

- [ ] **Step 6: Generate Prisma client**

```bash
npx prisma generate --schema=prisma/schema.prisma
```

Expected: Prisma client generated successfully at `generated/prisma/`.

- [ ] **Step 7: Create migration**

```bash
npx prisma migrate dev --schema=prisma/schema.prisma --name add_desktop_domain_models
```

Expected: Migration created and applied. Three new tables: `starter_persona_assets`, `desktop_catalog_entries`, `desktop_device_sessions`, `desktop_profiles`.

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat(prisma): add Desktop domain models — StarterPersonaAsset, DesktopCatalogEntry, DesktopDeviceSession, DesktopProfile"
```

---

## Task 4: Restore Desktop types

**Files:**
- Create: `web/lib/types/desktop.ts`

- [ ] **Step 1: Create desktop types file**

Create `web/lib/types/desktop.ts` with the full type definitions:

```typescript
export type DesktopCatalogSourceType = 'starter' | 'soul'

export interface DesktopCatalogItem {
  id: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  title: string
  description: string | null
  coverImage: string
  thumbnail: string
  updatedAt: string
}

export interface DesktopPersonaManifestFile {
  path: string
  url: string
  checksum: string
}

export interface DesktopPersonaManifest extends DesktopCatalogItem {
  version: string
  checksum: string
  files: DesktopPersonaManifestFile[]
}

export interface DesktopDeviceStartResponse {
  deviceCode: string
  userCode: string
  expiresAt: string
  pollInterval: number
}

export type DesktopDevicePollResponse =
  | {
      status: 'pending'
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'confirmed'
      accountId: string
      deepLink: string | null
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'expired'
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'invalid_code'
      expiresAt: null
      pollInterval: number
    }

export interface DesktopDeviceCompleteResponse {
  status: 'confirmed'
  accountId: string
  deviceCode: string
  userCode: string
  deepLink: string
  expiresAt: string
  confirmedAt: string
  pollInterval: number
}

export interface DesktopProfile {
  accountId: string
  activeSourceType: DesktopCatalogSourceType | null
  activeSourceRef: string | null
  preferences: Record<string, unknown> | null
  lastSyncedAt: string | null
  updatedAt: string
}

export interface DesktopMeResponse {
  profile: DesktopProfile
  activePersona: DesktopPersonaManifest | null
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/types/desktop.ts
git commit -m "feat(desktop): restore Desktop API type definitions"
```

---

## Task 5: Restore catalog repository + tests

**Files:**
- Create: `web/lib/desktop/repository.ts`
- Create: `tests/new-web/desktop-catalog-repository.test.ts`

- [ ] **Step 1: Write the catalog repository test**

Create `tests/new-web/desktop-catalog-repository.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopCatalogEntry: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
  },
  starterPersonaAsset: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  soulAsset: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/services/walrus', () => ({
  materializeWalrusBlobUrls: (urls: string[]) => urls.map((u) => `https://walrus.test/${u}`),
  getBlobUrl: (id: string) => `https://walrus.test/blob/${id}`,
}))

describe('listDesktopCatalogItems', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns empty items when no entries exist', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([])
    mockedPrisma.desktopCatalogEntry.count.mockResolvedValue(0)

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns starter catalog items with correct shape', async () => {
    const entry = {
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      sortOrder: 0,
      updatedAt: new Date('2026-04-10'),
    }
    const starter = {
      slug: 'aurora',
      title: 'Aurora',
      description: 'A starter persona',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc123',
      files: [],
      updatedAt: new Date('2026-04-10'),
    }

    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([entry])
    mockedPrisma.desktopCatalogEntry.count.mockResolvedValue(1)
    mockedPrisma.starterPersonaAsset.findMany.mockResolvedValue([starter])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'entry-1',
      sourceType: 'starter',
      title: 'Aurora',
    })
    expect(result.total).toBe(1)
  })
})

describe('findDesktopPersonaManifestById', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns null when entry does not exist', async () => {
    mockedPrisma.desktopCatalogEntry.findUnique.mockResolvedValue(null)

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById('nonexistent')

    expect(result).toBeNull()
  })

  it('returns starter manifest with files', async () => {
    const entry = { id: 'entry-1', sourceType: 'starter', sourceRef: 'aurora' }
    const starter = {
      slug: 'aurora',
      title: 'Aurora',
      description: 'desc',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc',
      files: [{ path: 'sprite.png', url: 'https://cdn.test/sprite.png', checksum: 'hash' }],
      updatedAt: new Date('2026-04-10'),
    }

    mockedPrisma.desktopCatalogEntry.findUnique.mockResolvedValue(entry)
    mockedPrisma.starterPersonaAsset.findUnique.mockResolvedValue(starter)

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById('entry-1')

    expect(result).toMatchObject({
      id: 'entry-1',
      sourceType: 'starter',
      title: 'Aurora',
      version: '1.0',
      files: [{ path: 'sprite.png' }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-catalog-repository.test.ts
```

Expected: FAIL — `web/lib/desktop/repository` module not found.

- [ ] **Step 3: Implement repository.ts**

Create `web/lib/desktop/repository.ts` with the full catalog repository implementation recovered from git (commit `84cbebb`). The file is the exact content from the git history exploration — `buildDesktopCatalogWhere`, `listDesktopCatalogItems`, `findDesktopPersonaManifestById`, `findDesktopPersonaManifestBySource`, and all helper functions (`toStarterCatalogItem`, `toSoulCatalogItem`, `toStarterPersonaManifest`, `toSoulPersonaManifest`, `materializeDesktopImage`, `resolveDesktopThumbnail`, `normalizeManifestFiles`, `findDesktopPersonaManifestForEntry`).

> **Note:** This is the **full** content from `git show 84cbebb:web/lib/desktop/repository.ts`. Restore it as-is.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-catalog-repository.test.ts
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/lib/desktop/repository.ts tests/new-web/desktop-catalog-repository.test.ts
git commit -m "feat(desktop): restore catalog repository with tests"
```

---

## Task 6: Restore catalog API routes + tests

**Files:**
- Create: `web/app/api/desktop/catalog/route.ts`
- Create: `web/app/api/desktop/catalog/[id]/route.ts`
- Create: `tests/new-web/desktop-catalog-routes.test.ts`

- [ ] **Step 1: Write the catalog routes test**

Create `tests/new-web/desktop-catalog-routes.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedListDesktopCatalogItems = vi.hoisted(() => vi.fn())
const mockedFindDesktopPersonaManifestById = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/repository', () => ({
  listDesktopCatalogItems: mockedListDesktopCatalogItems,
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))

describe('GET /api/desktop/catalog', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns paginated catalog items with defaults', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({ items: [], total: 0 })

    const { GET } = await import('../../web/app/api/desktop/catalog/route')
    const request = new Request('http://localhost/api/desktop/catalog')
    // NextRequest needs nextUrl — use a wrapper
    const nextRequest = Object.assign(request, {
      nextUrl: new URL('http://localhost/api/desktop/catalog'),
    })
    const response = await GET(nextRequest as any)
    const body = await response.json()

    expect(body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 12 })
    expect(mockedListDesktopCatalogItems).toHaveBeenCalledWith({ page: 1, pageSize: 12 })
  })

  it('clamps pageSize to MAX_PAGE_SIZE', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({ items: [], total: 0 })

    const { GET } = await import('../../web/app/api/desktop/catalog/route')
    const request = new Request('http://localhost/api/desktop/catalog?pageSize=999')
    const nextRequest = Object.assign(request, {
      nextUrl: new URL('http://localhost/api/desktop/catalog?pageSize=999'),
    })
    const response = await GET(nextRequest as any)
    const body = await response.json()

    expect(body.pageSize).toBe(50)
  })
})

describe('GET /api/desktop/catalog/[id]', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 404 when manifest not found', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/entry-1'),
      { params: Promise.resolve({ id: 'entry-1' }) },
    )

    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-catalog-routes.test.ts
```

Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement catalog routes**

Create `web/app/api/desktop/catalog/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { listDesktopCatalogItems } from '@/lib/desktop/repository'

export const dynamic = 'force-dynamic'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInteger(request.nextUrl.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
  )

  const { items, total } = await listDesktopCatalogItems({
    page,
    pageSize,
  })

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}
```

Create `web/app/api/desktop/catalog/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const manifest = await findDesktopPersonaManifestById(id)

  if (!manifest) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(manifest)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-catalog-routes.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/desktop/catalog/ tests/new-web/desktop-catalog-routes.test.ts
git commit -m "feat(desktop): restore catalog API routes with tests"
```

---

## Task 7: Restore device session service + tests

**Files:**
- Create: `web/lib/desktop/device-session.ts`
- Create: `tests/new-web/desktop-device-session.test.ts`

- [ ] **Step 1: Write the device session test**

Create `tests/new-web/desktop-device-session.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopDeviceSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

describe('startDesktopDeviceSession', () => {
  beforeEach(() => vi.resetAllMocks())

  it('creates a session with device and user codes', async () => {
    mockedPrisma.desktopDeviceSession.create.mockImplementation(({ data }) => {
      return Promise.resolve({
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        expiresAt: data.expiresAt,
        pollIntervalSeconds: data.pollIntervalSeconds,
      })
    })

    const { startDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const now = new Date('2026-04-12T10:00:00Z')
    const result = await startDesktopDeviceSession({ now })

    expect(result.deviceCode).toBeTruthy()
    expect(result.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(result.pollInterval).toBe(5)
  })
})

describe('pollDesktopDeviceSession', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns invalid_code when session not found', async () => {
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(null)

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('nonexistent-code')

    expect(result.status).toBe('invalid_code')
  })

  it('returns pending for active unexpired session', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'pending',
      accountId: null,
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('pending')
  })

  it('expires session when past expiresAt', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'expired',
      accountId: null,
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:15:00Z'),
    })

    expect(result.status).toBe('expired')
  })
})

describe('completeDesktopDeviceSession', () => {
  beforeEach(() => vi.resetAllMocks())

  it('confirms session by user code', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      accountId: 'account-123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: new Date('2026-04-12T10:05:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.accountId).toBe('account-123')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-device-session.test.ts
```

Expected: FAIL — `web/lib/desktop/device-session` not found.

- [ ] **Step 3: Implement device-session.ts**

Create `web/lib/desktop/device-session.ts` with the full implementation recovered from git (commit `9762ba0`). This includes `startDesktopDeviceSession`, `pollDesktopDeviceSession`, `completeDesktopDeviceSession`, and `DesktopDeviceSessionConflictError`.

> **Note:** Restore the **full** content from `git show 9762ba0:web/lib/desktop/device-session.ts`. It includes all helpers: `createDeviceCode`, `createUserCode`, `toStartResponse`, `toPollResponse`, `toCompleteConfirmedResponse`, `toStatusResponse`.

The file imports from `@shared/prisma-errors` which exists at `src/shared/prisma-errors.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-device-session.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/lib/desktop/device-session.ts tests/new-web/desktop-device-session.test.ts
git commit -m "feat(desktop): restore device session service with tests"
```

---

## Task 8: Restore device API routes + tests

**Files:**
- Create: `web/app/api/desktop/device/start/route.ts`
- Create: `web/app/api/desktop/device/poll/route.ts`
- Create: `web/app/api/desktop/device/complete/route.ts`
- Create: `tests/new-web/desktop-device-routes.test.ts`

- [ ] **Step 1: Write the device routes test**

Create `tests/new-web/desktop-device-routes.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedStartDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedPollDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedCompleteDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedRequireIdentity = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/device-session', () => ({
  startDesktopDeviceSession: mockedStartDesktopDeviceSession,
  pollDesktopDeviceSession: mockedPollDesktopDeviceSession,
  completeDesktopDeviceSession: mockedCompleteDesktopDeviceSession,
  DesktopDeviceSessionConflictError: class extends Error {
    constructor() { super('Session already confirmed by another account') }
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

describe('POST /api/desktop/device/start', () => {
  beforeEach(() => vi.resetAllMocks())

  it('creates a device session', async () => {
    const sessionData = {
      deviceCode: 'abc123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    }
    mockedStartDesktopDeviceSession.mockResolvedValue(sessionData)

    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST()
    const body = await response.json()

    expect(body).toEqual(sessionData)
  })
})

describe('POST /api/desktop/device/poll', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 400 when deviceCode missing', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
  })

  it('returns poll status for valid device code', async () => {
    mockedPollDesktopDeviceSession.mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: 'abc123' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('pending')
  })
})

describe('POST /api/desktop/device/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { accountId: 'account-123', kind: 'human' },
    })
  })

  it('returns 400 when userCode missing', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
  })

  it('confirms session with valid userCode', async () => {
    mockedCompleteDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      deviceCode: 'abc',
      userCode: 'ABCD-EFGH',
      deepLink: 'soulidity://auth?token=xxx',
      expiresAt: '2026-04-12T10:10:00.000Z',
      confirmedAt: '2026-04-12T10:05:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('confirmed')
    expect(body.accountId).toBe('account-123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-device-routes.test.ts
```

Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement device routes**

Create `web/app/api/desktop/device/start/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { startDesktopDeviceSession } from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await startDesktopDeviceSession()
  return NextResponse.json(session)
}
```

Create `web/app/api/desktop/device/poll/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { pollDesktopDeviceSession } from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const deviceCode = body && typeof body === 'object' && 'deviceCode' in body && typeof body.deviceCode === 'string'
    ? body.deviceCode.trim()
    : ''

  if (!deviceCode) {
    return NextResponse.json({ error: 'deviceCode is required' }, { status: 400 })
  }

  const response = await pollDesktopDeviceSession(deviceCode)
  return NextResponse.json(response)
}
```

Create `web/app/api/desktop/device/complete/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import {
  completeDesktopDeviceSession,
  DesktopDeviceSessionConflictError,
} from '@/lib/desktop/device-session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const userCode = body && typeof body === 'object' && 'userCode' in body && typeof body.userCode === 'string'
    ? body.userCode.trim().toUpperCase()
    : ''

  if (!userCode) {
    return NextResponse.json({ error: 'userCode is required' }, { status: 400 })
  }

  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can confirm a desktop device' }, { status: 403 })
  }

  try {
    const result = await completeDesktopDeviceSession(userCode, identity.accountId)

    if (result.status === 'invalid_code') {
      return NextResponse.json(result, { status: 404 })
    }

    if (result.status === 'expired') {
      return NextResponse.json(result, { status: 410 })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DesktopDeviceSessionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-device-routes.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/desktop/device/ tests/new-web/desktop-device-routes.test.ts
git commit -m "feat(desktop): restore device binding API routes with tests"
```

---

## Task 9: Restore profile service + tests

**Files:**
- Create: `web/lib/desktop/profile.ts`
- Create: `tests/new-web/desktop-profile-service.test.ts`

- [ ] **Step 1: Write the profile service test**

Create `tests/new-web/desktop-profile-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopProfile: {
    upsert: vi.fn(),
  },
}))

const mockedFindDesktopPersonaManifestBySource = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/desktop/repository', () => ({
  findDesktopPersonaManifestBySource: mockedFindDesktopPersonaManifestBySource,
}))

describe('getDesktopMe', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns profile with null activePersona when no source set', async () => {
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: null,
      activeSourceRef: null,
      preferences: null,
      lastSyncedAt: null,
      updatedAt: new Date('2026-04-10'),
    })

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe('account-123')

    expect(result.profile.accountId).toBe('account-123')
    expect(result.activePersona).toBeNull()
  })

  it('returns activePersona when source is set', async () => {
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: 'starter',
      activeSourceRef: 'aurora',
      preferences: null,
      lastSyncedAt: null,
      updatedAt: new Date('2026-04-10'),
    })

    const manifest = {
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      title: 'Aurora',
      description: null,
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc',
      files: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    }
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue(manifest)

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe('account-123')

    expect(result.activePersona).toMatchObject({ title: 'Aurora' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-profile-service.test.ts
```

Expected: FAIL — `web/lib/desktop/profile` not found.

- [ ] **Step 3: Implement profile.ts**

Create `web/lib/desktop/profile.ts` with the full implementation recovered from git (commit `84cbebb`). This includes `getDesktopMe`, `setDesktopActivePersona`, `DesktopActivePersonaNotFoundError`, and helpers.

> **Note:** Restore the **full** content from `git show 84cbebb:web/lib/desktop/profile.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-profile-service.test.ts
```

Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/lib/desktop/profile.ts tests/new-web/desktop-profile-service.test.ts
git commit -m "feat(desktop): restore profile service with tests"
```

---

## Task 10: Restore profile API routes + tests

**Files:**
- Create: `web/app/api/desktop/me/route.ts`
- Create: `web/app/api/desktop/me/active-persona/route.ts`
- Create: `tests/new-web/desktop-profile-routes.test.ts`

- [ ] **Step 1: Write the profile routes test**

Create `tests/new-web/desktop-profile-routes.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetDesktopMe = vi.hoisted(() => vi.fn())
const mockedSetDesktopActivePersona = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@/lib/desktop/profile', () => {
  class MockedDesktopActivePersonaNotFoundError extends Error {
    constructor(message = 'Desktop active persona was not found') {
      super(message)
      this.name = 'DesktopActivePersonaNotFoundError'
    }
  }

  return {
    DesktopActivePersonaNotFoundError: MockedDesktopActivePersonaNotFoundError,
    getDesktopMe: mockedGetDesktopMe,
    setDesktopActivePersona: mockedSetDesktopActivePersona,
  }
})

describe('GET /api/desktop/me', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { accountId: 'account-123', memberId: 'member-123', kind: 'human' },
    })
  })

  it('returns the signed-in desktop profile', async () => {
    const meResponse = {
      profile: {
        accountId: 'account-123',
        activeSourceType: null,
        activeSourceRef: null,
        preferences: null,
        lastSyncedAt: null,
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      activePersona: null,
    }
    mockedGetDesktopMe.mockResolvedValue(meResponse)

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))
    const body = await response.json()

    expect(body.profile.accountId).toBe('account-123')
  })

  it('rejects non-human identities', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { accountId: 'agent-1', kind: 'agent' },
    })

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(403)
  })
})

describe('PUT /api/desktop/me/active-persona', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { accountId: 'account-123', memberId: 'member-123', kind: 'human' },
    })
  })

  it('updates active persona', async () => {
    const meResponse = {
      profile: {
        accountId: 'account-123',
        activeSourceType: 'starter',
        activeSourceRef: 'aurora',
        preferences: null,
        lastSyncedAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      activePersona: { title: 'Aurora' },
    }
    mockedSetDesktopActivePersona.mockResolvedValue(meResponse)

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'aurora' }),
    }))
    const body = await response.json()

    expect(body.profile.activeSourceType).toBe('starter')
  })

  it('returns 400 for invalid sourceType', async () => {
    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'invalid', sourceRef: 'test' }),
    }))

    expect(response.status).toBe(400)
  })

  it('returns 404 when persona not found', async () => {
    const { DesktopActivePersonaNotFoundError } = await import('../../web/lib/desktop/profile')
    mockedSetDesktopActivePersona.mockRejectedValue(new DesktopActivePersonaNotFoundError())

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'nonexistent' }),
    }))

    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run tests/new-web/desktop-profile-routes.test.ts
```

Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement profile routes**

Create `web/app/api/desktop/me/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { requireIdentity } from '@web/lib/auth/identity'
import { getDesktopMe } from '@/lib/desktop/profile'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can read a desktop profile' }, { status: 403 })
  }

  const response = await getDesktopMe(identity.accountId)
  return NextResponse.json(response)
}
```

Create `web/app/api/desktop/me/active-persona/route.ts`:

Restore the **full** content from `git show 84cbebb:web/app/api/desktop/me/active-persona/route.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run tests/new-web/desktop-profile-routes.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/desktop/me/ tests/new-web/desktop-profile-routes.test.ts
git commit -m "feat(desktop): restore profile API routes with tests"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run all tests**

```bash
npm test -- --run
```

Expected: No new failures compared to master baseline (284 pre-existing failures, 0 introduced).

- [ ] **Step 2: Run typecheck**

```bash
npm --prefix web run typecheck 2>&1 | tail -5
```

Expected: No type errors.

- [ ] **Step 3: Verify desktop API test files pass individually**

```bash
npm test -- --run tests/new-web/desktop-catalog-repository.test.ts tests/new-web/desktop-catalog-routes.test.ts tests/new-web/desktop-device-session.test.ts tests/new-web/desktop-device-routes.test.ts tests/new-web/desktop-profile-service.test.ts tests/new-web/desktop-profile-routes.test.ts
```

Expected: All 6 test files PASS.

- [ ] **Step 4: Commit plan file and any remaining fixes**

```bash
git add docs/superpowers/plans/2026-04-12-phase1-integration.md
git commit -m "docs: add Phase 1 integration implementation plan"
```

- [ ] **Step 5: Final summary**

Report: what was done, what passes, what's ready for Phase 2.
