# Pixel Newsroom Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current /pipeline dashboard with an interactive PixiJS pixel newsroom where OpenClaw AI roles process news on visual assembly lines.

**Architecture:** PixiJS 8 Canvas renders the newsroom scene (room, roles, animations, particles). React overlay handles admin controls (floating panels). Zustand store bridges API data → scene events. API polling every 10s drives state updates.

**Tech Stack:** PixiJS 8, @pixi/react, Zustand, Next.js 16, React 19, TypeScript, existing Supabase auth

**Worktree:** `/Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom` (branch: `feature/pixel-newsroom`)

**Design doc:** `docs/plans/2026-03-06-pixel-newsroom-design.md`

---

## Task 1: Install Dependencies & Scaffold File Structure

**Files:**
- Modify: `web/package.json`
- Create: `web/app/pipeline/engine/NewsroomScene.ts`
- Create: `web/app/pipeline/engine/PipelineLane.ts`
- Create: `web/app/pipeline/engine/RoleStation.ts`
- Create: `web/app/pipeline/engine/NewsScroll.ts`
- Create: `web/app/pipeline/engine/PigeonFlight.ts`
- Create: `web/app/pipeline/engine/particles/index.ts`
- Create: `web/app/pipeline/store/pipeline-store.ts`
- Create: `web/app/pipeline/components/NewsroomCanvas.tsx`
- Create: `web/app/pipeline/components/AdminPanel.tsx`
- Create: `web/app/pipeline/components/InboxOverlay.tsx`

**Step 1: Install PixiJS and Zustand**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom/web
npm install pixi.js@^8 @pixi/react@^8 zustand
```

**Step 2: Create directory structure and empty scaffold files**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom
mkdir -p web/app/pipeline/engine/particles
mkdir -p web/app/pipeline/store
mkdir -p web/app/pipeline/components
mkdir -p web/app/pipeline/assets/sprites
```

Create scaffold files with minimal exports so imports work throughout development:

`web/app/pipeline/engine/NewsroomScene.ts`:
```typescript
// Newsroom scene — room layout, background, walls, floor, window
export {}
```

`web/app/pipeline/engine/PipelineLane.ts`:
```typescript
// Single pipeline lane with 5 role stations
export {}
```

`web/app/pipeline/engine/RoleStation.ts`:
```typescript
// Role workstation — sprite + animation state machine
export {}
```

`web/app/pipeline/engine/NewsScroll.ts`:
```typescript
// News scroll object — moves along pipeline lane
export {}
```

`web/app/pipeline/engine/PigeonFlight.ts`:
```typescript
// Pigeon flight animation — scroll transforms to pigeon, flies to window
export {}
```

`web/app/pipeline/engine/particles/index.ts`:
```typescript
// Particle effect configs for each role
export {}
```

`web/app/pipeline/store/pipeline-store.ts`:
```typescript
// Zustand store — API data + scene events
export {}
```

`web/app/pipeline/components/NewsroomCanvas.tsx`:
```typescript
// PixiJS canvas container
export {}
```

`web/app/pipeline/components/AdminPanel.tsx`:
```typescript
// Admin floating control panel (React overlay)
export {}
```

`web/app/pipeline/components/InboxOverlay.tsx`:
```typescript
// Inbox popup — pending news list
export {}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(pipeline): scaffold pixel newsroom file structure and install deps"
```

---

## Task 2: Zustand Store — Pipeline State & Event System

**Files:**
- Create: `web/app/pipeline/store/pipeline-store.ts`

**Context:** The store bridges API data and the PixiJS scene. It polls `/api/pipeline`, diffs state, and emits events that the scene consumes to trigger animations. It also manages local UI state (active lanes, inbox open, admin actions).

**Step 1: Implement the store**

`web/app/pipeline/store/pipeline-store.ts`:
```typescript
import { create } from 'zustand'

// --- Types matching API response ---

export interface ProcessLog {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: string | null
  completedAt: string | null
  role: { name: string; label: string; sortOrder: number }
}

export interface PipelineArticle {
  id: string
  titleZh: string
  pipelineStatus: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  rawItem: { title: string; sourceName: string; score: number }
  processLogs: ProcessLog[]
}

// --- Scene events (consumed by PixiJS) ---

export type SceneEventType =
  | 'article_enter_lane'    // new article starts processing
  | 'role_start_working'    // role begins work on article
  | 'role_complete'         // role finishes work
  | 'role_failed'           // role failed
  | 'article_published'     // all roles done, pigeon flies
  | 'lane_opened'           // new lane activated
  | 'lane_closed'           // lane deactivated

export interface SceneEvent {
  type: SceneEventType
  articleId: string
  roleName?: string
  laneIndex?: number
  timestamp: number
}

// --- Lane assignment ---

export interface LaneAssignment {
  laneIndex: number
  articleId: string
}

// --- Store ---

interface PipelineState {
  // API data
  articles: PipelineArticle[]
  pendingArticles: PipelineArticle[]
  processingArticles: PipelineArticle[]

  // Scene state
  activeLanes: number            // 1-3
  laneAssignments: LaneAssignment[]
  events: SceneEvent[]

  // UI state
  inboxOpen: boolean
  isAdmin: boolean
  lastSync: string | null
  error: string | null
  loading: boolean

  // Actions
  fetchArticles: () => Promise<void>
  setAdmin: (isAdmin: boolean) => void
  openInbox: () => void
  closeInbox: () => void
  openLane: () => void
  closeLane: (laneIndex: number) => void
  assignArticleToLane: (articleId: string) => void
  consumeEvents: () => SceneEvent[]
  retryRole: (articleId: string, roleName: string) => Promise<void>
  skipRole: (articleId: string, roleName: string) => Promise<void>
}

function diffEvents(
  prev: PipelineArticle[],
  next: PipelineArticle[]
): SceneEvent[] {
  const events: SceneEvent[] = []
  const now = Date.now()
  const prevMap = new Map(prev.map(a => [a.id, a]))

  for (const article of next) {
    const old = prevMap.get(article.id)

    // New article entering pipeline
    if (!old && article.pipelineStatus === 'running') {
      events.push({ type: 'article_enter_lane', articleId: article.id, timestamp: now })
    }

    // Check each role for status changes
    if (old) {
      for (const log of article.processLogs) {
        const oldLog = old.processLogs.find(l => l.role.name === log.role.name)
        const oldStatus = oldLog?.status ?? 'pending'

        if (oldStatus !== log.status) {
          if (log.status === 'running') {
            events.push({ type: 'role_start_working', articleId: article.id, roleName: log.role.name, timestamp: now })
          } else if (log.status === 'completed') {
            events.push({ type: 'role_complete', articleId: article.id, roleName: log.role.name, timestamp: now })
          } else if (log.status === 'failed') {
            events.push({ type: 'role_failed', articleId: article.id, roleName: log.role.name, timestamp: now })
          }
        }
      }

      // Article fully published
      if (old.pipelineStatus !== 'completed' && article.pipelineStatus === 'completed') {
        events.push({ type: 'article_published', articleId: article.id, timestamp: now })
      }
    }
  }

  return events
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  articles: [],
  pendingArticles: [],
  processingArticles: [],
  activeLanes: 1,
  laneAssignments: [],
  events: [],
  inboxOpen: false,
  isAdmin: false,
  lastSync: null,
  error: null,
  loading: true,

  fetchArticles: async () => {
    try {
      const res = await fetch('/api/pipeline', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`)

      const data: PipelineArticle[] = await res.json()
      const prev = get().articles
      const newEvents = diffEvents(prev, data)

      set({
        articles: data,
        pendingArticles: data.filter(a => a.pipelineStatus === 'pending'),
        processingArticles: data.filter(a => a.pipelineStatus === 'running'),
        events: [...get().events, ...newEvents],
        lastSync: new Date().toISOString(),
        error: null,
        loading: false,
      })
    } catch (e) {
      set({ error: 'RADAR LOST', loading: false })
    }
  },

  setAdmin: (isAdmin) => set({ isAdmin }),

  openInbox: () => set({ inboxOpen: true }),
  closeInbox: () => set({ inboxOpen: false }),

  openLane: () => {
    const { activeLanes } = get()
    if (activeLanes < 3) {
      const newIndex = activeLanes
      set({ activeLanes: activeLanes + 1 })
      set({ events: [...get().events, { type: 'lane_opened', articleId: '', laneIndex: newIndex, timestamp: Date.now() }] })
    }
  },

  closeLane: (laneIndex) => {
    const { activeLanes, laneAssignments } = get()
    const laneInUse = laneAssignments.some(a => a.laneIndex === laneIndex)
    if (activeLanes > 1 && !laneInUse) {
      set({
        activeLanes: activeLanes - 1,
        events: [...get().events, { type: 'lane_closed', articleId: '', laneIndex, timestamp: Date.now() }],
      })
    }
  },

  assignArticleToLane: (articleId) => {
    const { laneAssignments, activeLanes } = get()
    const usedLanes = new Set(laneAssignments.map(a => a.laneIndex))
    let freeLane = -1
    for (let i = 0; i < activeLanes; i++) {
      if (!usedLanes.has(i)) { freeLane = i; break }
    }
    if (freeLane === -1) return // all lanes busy

    set({
      laneAssignments: [...laneAssignments, { laneIndex: freeLane, articleId }],
      events: [...get().events, { type: 'article_enter_lane', articleId, laneIndex: freeLane, timestamp: Date.now() }],
    })
  },

  consumeEvents: () => {
    const events = get().events
    set({ events: [] })
    return events
  },

  retryRole: async (articleId, roleName) => {
    await fetch(`/api/pipeline/${articleId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleName }),
    })
    await get().fetchArticles()
  },

  skipRole: async (articleId, roleName) => {
    await fetch(`/api/pipeline/${articleId}/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleName }),
    })
    await get().fetchArticles()
  },
}))
```

**Step 2: Commit**

```bash
git add web/app/pipeline/store/pipeline-store.ts
git commit -m "feat(pipeline): add Zustand store with API polling, state diff, and event system"
```

---

## Task 3: PixiJS Canvas Container & Scene Bootstrap

**Files:**
- Modify: `web/app/pipeline/page.tsx` (full rewrite)
- Create: `web/app/pipeline/components/NewsroomCanvas.tsx`
- Create: `web/app/pipeline/engine/NewsroomScene.ts`

**Context:** Replace the existing 1500+ line page.tsx with a clean wrapper that mounts the PixiJS canvas + React overlay. The NewsroomScene builds the room: pixel floor, walls, window, inbox area.

**Step 1: Create NewsroomScene — the room background**

`web/app/pipeline/engine/NewsroomScene.ts`:
```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js'

// Design dimensions
export const SCENE_W = 1200
export const SCENE_H = 700

// Layout constants
export const WALL_H = 80
export const FLOOR_Y = SCENE_H - 60
export const INBOX_X = 40
export const INBOX_Y = 180
export const INBOX_W = 100
export const INBOX_H = 130
export const WINDOW_X = SCENE_W - 100
export const WINDOW_Y = 20
export const WINDOW_W = 70
export const WINDOW_H = 70
export const LANE_START_X = 200
export const LANE_END_X = SCENE_W - 140
export const LANE_Y_BASE = 200
export const LANE_Y_GAP = 160

const COLORS = {
  wallTop: 0x3a3a5c,
  wallBottom: 0x2e2e48,
  floor: 0x5c4a3a,
  floorTile: 0x6b5a48,
  inbox: 0x8b6e4e,
  inboxFront: 0xa0825c,
  window: 0x87ceeb,
  windowFrame: 0x6e5a3c,
  windowLight: 0xfff8dc,
}

/** Draw the static room background into a Container. */
export function createRoomBackground(): Container {
  const room = new Container()
  room.label = 'room-bg'

  // --- Wall ---
  const wall = new Graphics()
  wall.rect(0, 0, SCENE_W, WALL_H + 120).fill(COLORS.wallTop)
  // Darker strip at bottom of wall
  wall.rect(0, WALL_H + 100, SCENE_W, 20).fill(COLORS.wallBottom)
  room.addChild(wall)

  // --- Floor ---
  const floor = new Graphics()
  floor.rect(0, FLOOR_Y, SCENE_W, SCENE_H - FLOOR_Y).fill(COLORS.floor)
  // Tile grid pattern
  for (let x = 0; x < SCENE_W; x += 40) {
    floor.rect(x, FLOOR_Y, 1, SCENE_H - FLOOR_Y).fill(COLORS.floorTile)
  }
  for (let y = FLOOR_Y; y < SCENE_H; y += 40) {
    floor.rect(0, y, SCENE_W, 1).fill(COLORS.floorTile)
  }
  room.addChild(floor)

  // --- Middle area (between wall and floor) ---
  const mid = new Graphics()
  mid.rect(0, WALL_H + 120, SCENE_W, FLOOR_Y - WALL_H - 120).fill(0x4a4a6e)
  room.addChild(mid)

  // --- Window ---
  const windowFrame = new Graphics()
  windowFrame.roundRect(WINDOW_X - 5, WINDOW_Y - 5, WINDOW_W + 10, WINDOW_H + 10, 4).fill(COLORS.windowFrame)
  windowFrame.rect(WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H).fill(COLORS.window)
  // Cross bars
  windowFrame.rect(WINDOW_X + WINDOW_W / 2 - 1, WINDOW_Y, 2, WINDOW_H).fill(COLORS.windowFrame)
  windowFrame.rect(WINDOW_X, WINDOW_Y + WINDOW_H / 2 - 1, WINDOW_W, 2).fill(COLORS.windowFrame)
  room.addChild(windowFrame)

  // Light ray from window
  const lightRay = new Graphics()
  lightRay.moveTo(WINDOW_X, WINDOW_Y + WINDOW_H)
  lightRay.lineTo(WINDOW_X - 80, FLOOR_Y)
  lightRay.lineTo(WINDOW_X + WINDOW_W + 40, FLOOR_Y)
  lightRay.lineTo(WINDOW_X + WINDOW_W, WINDOW_Y + WINDOW_H)
  lightRay.closePath()
  lightRay.fill({ color: COLORS.windowLight, alpha: 0.06 })
  room.addChild(lightRay)

  // --- Inbox / Mailbox ---
  const inbox = new Graphics()
  // Back
  inbox.rect(INBOX_X, INBOX_Y, INBOX_W, INBOX_H).fill(COLORS.inbox)
  // Front face
  inbox.rect(INBOX_X, INBOX_Y + INBOX_H - 30, INBOX_W, 30).fill(COLORS.inboxFront)
  // Slot
  inbox.rect(INBOX_X + 15, INBOX_Y + INBOX_H - 25, INBOX_W - 30, 4).fill(0x5a4232)
  room.addChild(inbox)

  // Inbox label
  const inboxLabel = new Text({
    text: 'INBOX',
    style: new TextStyle({
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 10,
      fill: 0xffeedd,
    }),
  })
  inboxLabel.x = INBOX_X + 18
  inboxLabel.y = INBOX_Y + INBOX_H - 18
  room.addChild(inboxLabel)

  return room
}
```

**Step 2: Create NewsroomCanvas — React ↔ PixiJS bridge**

`web/app/pipeline/components/NewsroomCanvas.tsx`:
```tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Application, Container } from 'pixi.js'
import { createRoomBackground, SCENE_W, SCENE_H } from '../engine/NewsroomScene'
import { usePipelineStore } from '../store/pipeline-store'

export function NewsroomCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

  const fetchArticles = usePipelineStore(s => s.fetchArticles)

  const initApp = useCallback(async () => {
    if (!canvasRef.current || appRef.current) return

    const app = new Application()
    await app.init({
      width: SCENE_W,
      height: SCENE_H,
      backgroundColor: 0x2a2a44,
      antialias: false,
      roundPixels: true,
    })

    canvasRef.current.appendChild(app.canvas)
    appRef.current = app

    // Room background
    const room = createRoomBackground()
    app.stage.addChild(room)

    // Start polling
    await fetchArticles()
    const timer = setInterval(() => { void fetchArticles() }, 10_000)

    // Resize handler
    const resize = () => {
      if (!canvasRef.current) return
      const parentW = canvasRef.current.clientWidth
      const scale = Math.min(parentW / SCENE_W, 1)
      app.canvas.style.width = `${SCENE_W * scale}px`
      app.canvas.style.height = `${SCENE_H * scale}px`
    }
    window.addEventListener('resize', resize)
    resize()

    // Visibility handler — pause when hidden
    const onVisibility = () => {
      if (document.hidden) {
        app.ticker.stop()
      } else {
        app.ticker.start()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Cleanup
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      app.destroy(true)
      appRef.current = null
    }
  }, [fetchArticles])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void initApp().then(fn => { cleanup = fn })
    return () => cleanup?.()
  }, [initApp])

  return (
    <div
      ref={canvasRef}
      className="relative mx-auto"
      style={{ maxWidth: SCENE_W, aspectRatio: `${SCENE_W}/${SCENE_H}` }}
    />
  )
}
```

**Step 3: Rewrite page.tsx as a clean wrapper**

`web/app/pipeline/page.tsx`:
```tsx
'use client'

import { Press_Start_2P, VT323 } from 'next/font/google'
import { NewsroomCanvas } from './components/NewsroomCanvas'
import { PublicNav } from '@web/components/public-nav'
import { usePipelineStore } from './store/pipeline-store'

const pixelTitle = Press_Start_2P({ subsets: ['latin'], weight: '400' })
const pixelBody = VT323({ subsets: ['latin'], weight: '400' })

export default function PipelinePage() {
  const { pendingArticles, processingArticles, activeLanes, error, lastSync } = usePipelineStore()

  return (
    <div className={`min-h-screen bg-[#1a1a2e] ${pixelBody.className}`}>
      <PublicNav />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className={`${pixelTitle.className} text-lg text-[#dcffeb]`}>
            PIXEL NEWSROOM
          </h1>
          <div className="flex gap-3 text-xl text-[#8aff8a]">
            <span>INBOX: {pendingArticles.length}</span>
            <span>LINES: {activeLanes}/3</span>
            <span>ACTIVE: {processingArticles.length}</span>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className={`${pixelTitle.className} bg-red-900/60 px-4 py-2 text-center text-xs text-red-300`}>
            {error}
          </div>
        )}

        {/* PixiJS Canvas */}
        <NewsroomCanvas />
      </main>
    </div>
  )
}
```

**Step 4: Verify it builds**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom/web
npx next build 2>&1 | tail -20
```

Expected: builds without errors (may have warnings). The page should show a dark blue canvas with the room background.

**Step 5: Commit**

```bash
git add web/app/pipeline/page.tsx web/app/pipeline/components/NewsroomCanvas.tsx web/app/pipeline/engine/NewsroomScene.ts
git commit -m "feat(pipeline): PixiJS canvas with room background, replace old dashboard"
```

---

## Task 4: Role Stations — Sprite Rendering & State Machine

**Files:**
- Create: `web/app/pipeline/engine/RoleStation.ts`

**Context:** Each role station is a workstation on a lane. It renders the role sprite (reuse existing SVG concepts but as pixel rectangles drawn with PixiJS Graphics), a desk/workbench, and manages 4 animation states: idle, working, done, failed. For the initial pass, use PixiJS Graphics to draw simplified pixel characters. Sprite sheets can be swapped in later.

**Step 1: Implement RoleStation**

`web/app/pipeline/engine/RoleStation.ts`:
```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js'

export type RoleAnimState = 'idle' | 'working' | 'done' | 'failed'

export const ROLE_DEFS = [
  { name: 'scout', label: 'SCOUT', color: 0x4a90d9, deskColor: 0x8b5e3c },
  { name: 'reporter', label: 'SCRIBE', color: 0xdce4f8, deskColor: 0x6b5a48 },
  { name: 'analyst', label: 'SEER', color: 0x6898c8, deskColor: 0x8a7560 },
  { name: 'editor', label: 'SMITH', color: 0x8a8e96, deskColor: 0x7a5835 },
  { name: 'publisher', label: 'HERALD', color: 0xe0b040, deskColor: 0xc89028 },
] as const

const STATION_W = 64
const STATION_H = 80

export class RoleStation extends Container {
  public roleName: string
  private state: RoleAnimState = 'idle'
  private characterSprite: Graphics
  private deskSprite: Graphics
  private statusIndicator: Graphics
  private nameLabel: Text
  private elapsed = 0
  private roleDef: typeof ROLE_DEFS[number]

  constructor(roleName: string) {
    super()
    this.roleName = roleName
    this.roleDef = ROLE_DEFS.find(r => r.name === roleName) ?? ROLE_DEFS[0]
    this.label = `station-${roleName}`

    // Desk / workbench
    this.deskSprite = new Graphics()
    this.deskSprite.roundRect(0, STATION_H - 20, STATION_W, 20, 2).fill(this.roleDef.deskColor)
    this.addChild(this.deskSprite)

    // Character — simplified pixel figure
    this.characterSprite = new Graphics()
    this.drawCharacter()
    this.addChild(this.characterSprite)

    // Status indicator (small colored dot)
    this.statusIndicator = new Graphics()
    this.statusIndicator.circle(STATION_W / 2, STATION_H + 6, 4).fill(0x888888)
    this.addChild(this.statusIndicator)

    // Name label
    this.nameLabel = new Text({
      text: this.roleDef.label,
      style: new TextStyle({
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 7,
        fill: 0xcccccc,
        align: 'center',
      }),
    })
    this.nameLabel.anchor.set(0.5, 0)
    this.nameLabel.x = STATION_W / 2
    this.nameLabel.y = STATION_H + 14
    this.addChild(this.nameLabel)
  }

  private drawCharacter() {
    const g = this.characterSprite
    g.clear()
    const color = this.roleDef.color
    const cx = STATION_W / 2

    // Head (8x8 block)
    g.rect(cx - 4, 16, 8, 8).fill(color)
    // Body (12x16 block)
    g.rect(cx - 6, 24, 12, 16).fill(color)
    // Legs (two 4x8 blocks)
    g.rect(cx - 6, 40, 4, 8).fill(color)
    g.rect(cx + 2, 40, 4, 8).fill(color)
    // Eyes
    g.rect(cx - 2, 19, 2, 2).fill(0x111111)
    g.rect(cx + 1, 19, 2, 2).fill(0x111111)
  }

  setState(newState: RoleAnimState) {
    if (this.state === newState) return
    this.state = newState
    this.elapsed = 0

    // Update status indicator color
    this.statusIndicator.clear()
    const indicatorColor = {
      idle: 0x888888,
      working: 0xffcc00,
      done: 0x44ff44,
      failed: 0xff4444,
    }[newState]
    this.statusIndicator.circle(STATION_W / 2, STATION_H + 6, 4).fill(indicatorColor)
  }

  getState(): RoleAnimState {
    return this.state
  }

  /** Called every frame by the game loop. delta in seconds. */
  update(delta: number) {
    this.elapsed += delta

    switch (this.state) {
      case 'idle':
        // Gentle bob
        this.characterSprite.y = Math.sin(this.elapsed * 1.5) * 1.5
        break

      case 'working':
        // Faster bob + slight horizontal shake
        this.characterSprite.y = Math.sin(this.elapsed * 6) * 2
        this.characterSprite.x = Math.sin(this.elapsed * 8) * 1
        break

      case 'done':
        // Jump up then settle
        if (this.elapsed < 0.5) {
          this.characterSprite.y = -Math.sin(this.elapsed * Math.PI / 0.5) * 8
        } else {
          this.characterSprite.y = 0
        }
        this.characterSprite.x = 0
        break

      case 'failed':
        // Shake then slump
        if (this.elapsed < 0.4) {
          this.characterSprite.x = Math.sin(this.elapsed * 30) * 3
        } else {
          this.characterSprite.x = 0
          this.characterSprite.y = 2 // slumped
        }
        break
    }
  }
}
```

**Step 2: Commit**

```bash
git add web/app/pipeline/engine/RoleStation.ts
git commit -m "feat(pipeline): add RoleStation with pixel character and 4-state animation"
```

---

## Task 5: Pipeline Lane — Track with 5 Stations

**Files:**
- Create: `web/app/pipeline/engine/PipelineLane.ts`

**Context:** A PipelineLane is a horizontal track with 5 RoleStations spaced evenly. It manages which article is being processed, handles the conveyor belt visual, and coordinates station states based on article data.

**Step 1: Implement PipelineLane**

`web/app/pipeline/engine/PipelineLane.ts`:
```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { RoleStation, ROLE_DEFS, type RoleAnimState } from './RoleStation'
import { LANE_START_X, LANE_END_X } from './NewsroomScene'

const ROLE_COUNT = 5

export class PipelineLane extends Container {
  public laneIndex: number
  public stations: RoleStation[] = []
  public articleId: string | null = null

  private track: Graphics
  private laneLabel: Text
  private stationSpacing: number

  constructor(laneIndex: number) {
    super()
    this.laneIndex = laneIndex
    this.label = `lane-${laneIndex}`

    const trackW = LANE_END_X - LANE_START_X
    this.stationSpacing = trackW / (ROLE_COUNT - 1)

    // Conveyor belt / track
    this.track = new Graphics()
    this.track.rect(0, 40, trackW, 6).fill(0x555566)
    // Track dots
    for (let i = 0; i < ROLE_COUNT; i++) {
      const dotX = i * this.stationSpacing
      this.track.circle(dotX, 43, 5).fill(0x666688)
    }
    this.addChild(this.track)

    // Lane label
    this.laneLabel = new Text({
      text: `LINE ${laneIndex + 1}`,
      style: new TextStyle({
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 8,
        fill: 0x888888,
      }),
    })
    this.laneLabel.x = -60
    this.laneLabel.y = 34
    this.addChild(this.laneLabel)

    // Create 5 role stations
    for (let i = 0; i < ROLE_COUNT; i++) {
      const station = new RoleStation(ROLE_DEFS[i].name)
      station.x = i * this.stationSpacing - 32 // center station on dot
      station.y = -50
      this.stations.push(station)
      this.addChild(station)
    }
  }

  /** Get the x position for a given role index on this lane (in lane-local coords). */
  getStationX(roleIndex: number): number {
    return roleIndex * this.stationSpacing
  }

  /** Update all station states from article process logs. */
  syncFromArticle(
    processLogs: Array<{ role: { name: string }; status: string }>
  ) {
    for (const station of this.stations) {
      const log = processLogs.find(l => l.role.name === station.roleName)
      const status = (log?.status ?? 'pending') as string
      const stateMap: Record<string, RoleAnimState> = {
        pending: 'idle',
        running: 'working',
        completed: 'done',
        failed: 'failed',
      }
      station.setState(stateMap[status] ?? 'idle')
    }
  }

  /** Reset all stations to idle. */
  clear() {
    this.articleId = null
    for (const station of this.stations) {
      station.setState('idle')
    }
  }

  /** Called every frame. delta in seconds. */
  update(delta: number) {
    for (const station of this.stations) {
      station.update(delta)
    }
  }
}
```

**Step 2: Commit**

```bash
git add web/app/pipeline/engine/PipelineLane.ts
git commit -m "feat(pipeline): add PipelineLane with conveyor track and 5 role stations"
```

---

## Task 6: News Scroll — Animated Object Moving Along Lane

**Files:**
- Create: `web/app/pipeline/engine/NewsScroll.ts`

**Context:** The NewsScroll is a small pixel scroll/paper that moves along the lane from station to station. It uses simple tweening (linear interpolation) to slide between positions.

**Step 1: Implement NewsScroll**

`web/app/pipeline/engine/NewsScroll.ts`:
```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js'

const SCROLL_W = 24
const SCROLL_H = 16

export class NewsScroll extends Container {
  public articleId: string
  private graphic: Graphics
  private glowGraphic: Graphics
  private titleLabel: Text
  private targetX = 0
  private moveSpeed = 200 // pixels per second
  public isMoving = false
  public onArrived?: () => void

  constructor(articleId: string, titleZh: string) {
    super()
    this.articleId = articleId
    this.label = `scroll-${articleId.slice(0, 8)}`

    // Glow (shown when completing a station)
    this.glowGraphic = new Graphics()
    this.glowGraphic.circle(SCROLL_W / 2, SCROLL_H / 2, 16).fill({ color: 0xffffaa, alpha: 0 })
    this.addChild(this.glowGraphic)

    // Scroll body
    this.graphic = new Graphics()
    // Paper body
    this.graphic.roundRect(0, 0, SCROLL_W, SCROLL_H, 2).fill(0xfff8dc)
    // Top/bottom roll
    this.graphic.rect(0, -2, SCROLL_W, 3).fill(0xe8d8a8)
    this.graphic.rect(0, SCROLL_H - 1, SCROLL_W, 3).fill(0xe8d8a8)
    // Text lines
    this.graphic.rect(4, 4, SCROLL_W - 8, 1).fill(0x333333)
    this.graphic.rect(4, 7, SCROLL_W - 10, 1).fill(0x333333)
    this.graphic.rect(4, 10, SCROLL_W - 12, 1).fill(0x333333)
    this.addChild(this.graphic)

    // Tiny title (truncated)
    const shortTitle = titleZh.length > 4 ? titleZh.slice(0, 4) : titleZh
    this.titleLabel = new Text({
      text: shortTitle,
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0x666666,
      }),
    })
    this.titleLabel.x = SCROLL_W + 4
    this.titleLabel.y = 2
    this.addChild(this.titleLabel)
  }

  /** Start moving to a target X position. */
  moveTo(x: number, onArrived?: () => void) {
    this.targetX = x
    this.isMoving = true
    this.onArrived = onArrived
  }

  /** Flash glow effect. */
  flashGlow() {
    this.glowGraphic.alpha = 1
  }

  /** Called every frame. delta in seconds. */
  update(delta: number) {
    // Move toward target
    if (this.isMoving) {
      const diff = this.targetX - this.x
      if (Math.abs(diff) < 2) {
        this.x = this.targetX
        this.isMoving = false
        this.onArrived?.()
        this.onArrived = undefined
      } else {
        this.x += Math.sign(diff) * Math.min(this.moveSpeed * delta, Math.abs(diff))
      }
    }

    // Fade glow
    if (this.glowGraphic.alpha > 0) {
      this.glowGraphic.alpha = Math.max(0, this.glowGraphic.alpha - delta * 2)
    }
  }
}
```

**Step 2: Commit**

```bash
git add web/app/pipeline/engine/NewsScroll.ts
git commit -m "feat(pipeline): add NewsScroll with movement tweening and glow effect"
```

---

## Task 7: Pigeon Flight Animation

**Files:**
- Create: `web/app/pipeline/engine/PigeonFlight.ts`

**Context:** When an article finishes all 5 stations, the scroll transforms into a pixel pigeon that flies toward the window with a star trail.

**Step 1: Implement PigeonFlight**

`web/app/pipeline/engine/PigeonFlight.ts`:
```typescript
import { Container, Graphics } from 'pixi.js'
import { WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H } from './NewsroomScene'

const PIGEON_SIZE = 16

export class PigeonFlight extends Container {
  private pigeon: Graphics
  private trail: Graphics[] = []
  private startX: number
  private startY: number
  private targetX: number
  private targetY: number
  private progress = 0
  private duration = 1.5 // seconds
  private trailTimer = 0
  public isComplete = false
  public onComplete?: () => void

  constructor(startX: number, startY: number) {
    super()
    this.startX = startX
    this.startY = startY
    this.targetX = WINDOW_X + WINDOW_W / 2
    this.targetY = WINDOW_Y + WINDOW_H / 2
    this.label = 'pigeon-flight'

    // Pixel pigeon
    this.pigeon = new Graphics()
    // Body
    this.pigeon.rect(0, 4, 10, 6).fill(0xdddddd)
    // Head
    this.pigeon.rect(10, 2, 4, 4).fill(0xcccccc)
    // Eye
    this.pigeon.rect(12, 3, 1, 1).fill(0x111111)
    // Beak
    this.pigeon.rect(14, 4, 2, 1).fill(0xffaa00)
    // Wing (animated via y-offset)
    this.pigeon.rect(2, 0, 6, 3).fill(0xeeeeee)
    // Tail
    this.pigeon.rect(-3, 5, 3, 3).fill(0xbbbbbb)

    this.pigeon.x = startX
    this.pigeon.y = startY
    this.addChild(this.pigeon)
  }

  update(delta: number) {
    if (this.isComplete) return

    this.progress += delta / this.duration

    if (this.progress >= 1) {
      this.isComplete = true
      this.onComplete?.()
      return
    }

    // Eased position (ease-in curve for acceleration feel)
    const t = this.progress
    const ease = t * t // quadratic ease-in

    // Arc path — rise then dive toward window
    const arcHeight = -120
    const arcY = arcHeight * 4 * t * (1 - t) // parabolic arc

    this.pigeon.x = this.startX + (this.targetX - this.startX) * ease
    this.pigeon.y = this.startY + (this.targetY - this.startY) * ease + arcY

    // Wing flap animation
    const wingOffset = Math.sin(this.progress * Math.PI * 12) * 3
    // We approximate wing flap by slight y-jitter on the whole pigeon
    this.pigeon.y += wingOffset * 0.3

    // Star trail particles
    this.trailTimer += delta
    if (this.trailTimer > 0.05) {
      this.trailTimer = 0
      this.addTrailStar(this.pigeon.x, this.pigeon.y + 6)
    }

    // Update trail particles
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const star = this.trail[i]
      star.alpha -= delta * 2
      star.scale.set(star.scale.x * 0.97)
      if (star.alpha <= 0) {
        this.removeChild(star)
        star.destroy()
        this.trail.splice(i, 1)
      }
    }
  }

  private addTrailStar(x: number, y: number) {
    const star = new Graphics()
    const size = 1 + Math.random() * 2
    star.rect(-size / 2, -size / 2, size, size).fill(0xffff88)
    star.x = x + (Math.random() - 0.5) * 6
    star.y = y + (Math.random() - 0.5) * 4
    star.alpha = 0.8
    this.addChild(star)
    this.trail.push(star)
  }
}
```

**Step 2: Commit**

```bash
git add web/app/pipeline/engine/PigeonFlight.ts
git commit -m "feat(pipeline): add PigeonFlight animation with star trail"
```

---

## Task 8: Particle Effects for Each Role

**Files:**
- Create: `web/app/pipeline/engine/particles/index.ts`

**Context:** Each role has a distinctive particle effect when in "working" state. These are simple Graphics-based particle systems (no external lib needed for this level of complexity).

**Step 1: Implement particle system**

`web/app/pipeline/engine/particles/index.ts`:
```typescript
import { Container, Graphics } from 'pixi.js'

interface Particle {
  graphic: Graphics
  vx: number
  vy: number
  life: number
  maxLife: number
}

export class RoleParticles extends Container {
  private particles: Particle[] = []
  private spawnTimer = 0
  private active = false
  private config: ParticleConfig

  constructor(roleName: string) {
    super()
    this.config = PARTICLE_CONFIGS[roleName] ?? PARTICLE_CONFIGS.scout
    this.label = `particles-${roleName}`
  }

  start() { this.active = true }
  stop() { this.active = false }

  update(delta: number) {
    // Spawn new particles
    if (this.active) {
      this.spawnTimer += delta
      if (this.spawnTimer >= this.config.spawnInterval && this.particles.length < this.config.maxCount) {
        this.spawnTimer = 0
        this.spawnParticle()
      }
    }

    // Update existing
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= delta
      p.graphic.x += p.vx * delta
      p.graphic.y += p.vy * delta
      p.graphic.alpha = Math.max(0, p.life / p.maxLife)

      if (p.life <= 0) {
        this.removeChild(p.graphic)
        p.graphic.destroy()
        this.particles.splice(i, 1)
      }
    }
  }

  private spawnParticle() {
    const g = new Graphics()
    const c = this.config
    const size = c.sizeMin + Math.random() * (c.sizeMax - c.sizeMin)
    const colorIdx = Math.floor(Math.random() * c.colors.length)

    g.rect(-size / 2, -size / 2, size, size).fill(c.colors[colorIdx])
    g.x = (Math.random() - 0.5) * c.spreadX
    g.y = (Math.random() - 0.5) * c.spreadY

    const life = c.lifeMin + Math.random() * (c.lifeMax - c.lifeMin)
    const angle = c.angleMin + Math.random() * (c.angleMax - c.angleMin)
    const speed = c.speedMin + Math.random() * (c.speedMax - c.speedMin)

    this.addChild(g)
    this.particles.push({
      graphic: g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
    })
  }

  clear() {
    this.active = false
    for (const p of this.particles) {
      this.removeChild(p.graphic)
      p.graphic.destroy()
    }
    this.particles = []
  }
}

interface ParticleConfig {
  colors: number[]
  sizeMin: number
  sizeMax: number
  spreadX: number
  spreadY: number
  speedMin: number
  speedMax: number
  angleMin: number
  angleMax: number
  lifeMin: number
  lifeMax: number
  spawnInterval: number
  maxCount: number
}

const UP = -Math.PI / 2
const PARTICLE_CONFIGS: Record<string, ParticleConfig> = {
  // Scout — scanning light particles
  scout: {
    colors: [0x4a90d9, 0xa8d4ff, 0x6bb3f0],
    sizeMin: 1, sizeMax: 3,
    spreadX: 20, spreadY: 10,
    speedMin: 20, speedMax: 50,
    angleMin: UP - 0.5, angleMax: UP + 0.5,
    lifeMin: 0.3, lifeMax: 0.8,
    spawnInterval: 0.08,
    maxCount: 15,
  },

  // Reporter — ink splatter
  reporter: {
    colors: [0x2a3a6a, 0x1a2a50, 0x3a4a7a],
    sizeMin: 1, sizeMax: 4,
    spreadX: 16, spreadY: 8,
    speedMin: 30, speedMax: 80,
    angleMin: UP - 1, angleMax: UP + 1,
    lifeMin: 0.2, lifeMax: 0.6,
    spawnInterval: 0.06,
    maxCount: 20,
  },

  // Analyst — data glow particles
  analyst: {
    colors: [0xc0e0ff, 0xd8f0ff, 0x88b8e8, 0xe8f4ff],
    sizeMin: 1, sizeMax: 2,
    spreadX: 24, spreadY: 24,
    speedMin: 10, speedMax: 30,
    angleMin: 0, angleMax: Math.PI * 2,
    lifeMin: 0.5, lifeMax: 1.2,
    spawnInterval: 0.1,
    maxCount: 20,
  },

  // Editor — sparks
  editor: {
    colors: [0xffd54a, 0xffb830, 0xffe080, 0xffcc40],
    sizeMin: 1, sizeMax: 3,
    spreadX: 12, spreadY: 8,
    speedMin: 40, speedMax: 100,
    angleMin: UP - 0.8, angleMax: UP + 0.8,
    lifeMin: 0.15, lifeMax: 0.5,
    spawnInterval: 0.05,
    maxCount: 25,
  },

  // Publisher — musical notes
  publisher: {
    colors: [0xffe080, 0xffd060, 0xffe880],
    sizeMin: 2, sizeMax: 3,
    spreadX: 30, spreadY: 10,
    speedMin: 15, speedMax: 40,
    angleMin: UP - 0.3, angleMax: UP + 0.3,
    lifeMin: 0.6, lifeMax: 1.0,
    spawnInterval: 0.12,
    maxCount: 12,
  },
}
```

**Step 2: Commit**

```bash
git add web/app/pipeline/engine/particles/index.ts
git commit -m "feat(pipeline): add role-specific particle effects system"
```

---

## Task 9: Scene Integration — Wire Everything Together

**Files:**
- Modify: `web/app/pipeline/engine/NewsroomScene.ts` (add scene manager)
- Modify: `web/app/pipeline/components/NewsroomCanvas.tsx` (add game loop)

**Context:** This is the key integration task. The NewsroomScene becomes a full scene manager that creates lanes, processes events from the store, manages scroll objects, and triggers pigeon flights. The Canvas component hooks up the game loop.

**Step 1: Extend NewsroomScene with scene manager**

Add to the bottom of `web/app/pipeline/engine/NewsroomScene.ts`:

```typescript
// --- ADD THESE IMPORTS at the top ---
import { PipelineLane } from './PipelineLane'
import { NewsScroll } from './NewsScroll'
import { PigeonFlight } from './PigeonFlight'
import { RoleParticles } from './particles'
import type { SceneEvent, PipelineArticle } from '../store/pipeline-store'

// --- ADD after createRoomBackground function ---

export class NewsroomSceneManager {
  public root: Container
  private roomBg: Container
  private lanesContainer: Container
  private scrollsContainer: Container
  private effectsContainer: Container

  private lanes: PipelineLane[] = []
  private scrolls: Map<string, NewsScroll> = new Map()
  private pigeons: PigeonFlight[] = []
  private particles: Map<string, RoleParticles> = new Map()

  // Inbox badge
  private inboxBadge: Text | null = null
  private inboxCount = 0

  constructor() {
    this.root = new Container()
    this.root.label = 'newsroom'

    // Room background
    this.roomBg = createRoomBackground()
    this.root.addChild(this.roomBg)

    // Layers
    this.lanesContainer = new Container()
    this.lanesContainer.label = 'lanes'
    this.lanesContainer.x = LANE_START_X
    this.root.addChild(this.lanesContainer)

    this.scrollsContainer = new Container()
    this.scrollsContainer.label = 'scrolls'
    this.scrollsContainer.x = LANE_START_X
    this.root.addChild(this.scrollsContainer)

    this.effectsContainer = new Container()
    this.effectsContainer.label = 'effects'
    this.root.addChild(this.effectsContainer)

    // Create initial lane
    this.addLane()

    // Inbox badge
    this.inboxBadge = new Text({
      text: '0',
      style: new TextStyle({
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 12,
        fill: 0xff4444,
      }),
    })
    this.inboxBadge.x = INBOX_X + INBOX_W - 8
    this.inboxBadge.y = INBOX_Y - 14
    this.root.addChild(this.inboxBadge)
  }

  /** Add a new lane (up to 3). */
  addLane(): PipelineLane | null {
    if (this.lanes.length >= 3) return null
    const lane = new PipelineLane(this.lanes.length)
    lane.y = LANE_Y_BASE + this.lanes.length * LANE_Y_GAP
    this.lanesContainer.addChild(lane)
    this.lanes.push(lane)

    // Create particle emitters for each station on this lane
    for (const station of lane.stations) {
      const p = new RoleParticles(station.roleName)
      p.x = LANE_START_X + station.x + 32
      p.y = lane.y + station.y + 20
      this.effectsContainer.addChild(p)
      this.particles.set(`${lane.laneIndex}-${station.roleName}`, p)
    }

    return lane
  }

  /** Remove the last lane (only if empty). */
  removeLane() {
    if (this.lanes.length <= 1) return
    const lane = this.lanes[this.lanes.length - 1]
    if (lane.articleId) return // busy, can't remove

    // Remove particles for this lane
    for (const station of lane.stations) {
      const key = `${lane.laneIndex}-${station.roleName}`
      const p = this.particles.get(key)
      if (p) {
        p.clear()
        this.effectsContainer.removeChild(p)
        p.destroy()
        this.particles.delete(key)
      }
    }

    this.lanesContainer.removeChild(lane)
    lane.destroy()
    this.lanes.pop()
  }

  /** Update inbox badge count. */
  setInboxCount(count: number) {
    if (count === this.inboxCount) return
    this.inboxCount = count
    if (this.inboxBadge) {
      this.inboxBadge.text = String(count)
      this.inboxBadge.visible = count > 0
    }
  }

  /** Process events from store. */
  processEvents(events: SceneEvent[], articles: PipelineArticle[]) {
    for (const event of events) {
      switch (event.type) {
        case 'article_enter_lane': {
          const article = articles.find(a => a.id === event.articleId)
          if (!article) break
          // Find free lane
          const lane = this.lanes.find(l => !l.articleId) ?? this.lanes[0]
          if (!lane || lane.articleId) break

          lane.articleId = event.articleId
          // Create scroll
          const scroll = new NewsScroll(event.articleId, article.titleZh)
          scroll.x = -60 // start offscreen left (relative to lane container)
          scroll.y = lane.y + 30
          this.scrollsContainer.addChild(scroll)
          this.scrolls.set(event.articleId, scroll)
          // Move to first station
          scroll.moveTo(lane.getStationX(0) - 12)
          break
        }

        case 'role_start_working': {
          const key = this.findLaneKey(event.articleId, event.roleName!)
          if (key) {
            const p = this.particles.get(key)
            p?.start()
          }
          break
        }

        case 'role_complete': {
          const key = this.findLaneKey(event.articleId, event.roleName!)
          if (key) {
            const p = this.particles.get(key)
            p?.stop()
          }
          // Move scroll to next station
          const scroll = this.scrolls.get(event.articleId)
          const lane = this.lanes.find(l => l.articleId === event.articleId)
          if (scroll && lane) {
            scroll.flashGlow()
            const roleIdx = lane.stations.findIndex(s => s.roleName === event.roleName)
            if (roleIdx < lane.stations.length - 1) {
              scroll.moveTo(lane.getStationX(roleIdx + 1) - 12)
            }
          }
          break
        }

        case 'role_failed': {
          const key = this.findLaneKey(event.articleId, event.roleName!)
          if (key) {
            const p = this.particles.get(key)
            p?.stop()
          }
          break
        }

        case 'article_published': {
          const scroll = this.scrolls.get(event.articleId)
          const lane = this.lanes.find(l => l.articleId === event.articleId)
          if (scroll && lane) {
            // Remove scroll, spawn pigeon
            const pigeonX = scroll.x + LANE_START_X
            const pigeonY = scroll.y
            this.scrollsContainer.removeChild(scroll)
            scroll.destroy()
            this.scrolls.delete(event.articleId)

            const pigeon = new PigeonFlight(pigeonX, pigeonY)
            pigeon.onComplete = () => {
              this.effectsContainer.removeChild(pigeon)
              pigeon.destroy()
              this.pigeons = this.pigeons.filter(p => p !== pigeon)
            }
            this.effectsContainer.addChild(pigeon)
            this.pigeons.push(pigeon)

            // Free lane
            lane.clear()
          }
          break
        }

        case 'lane_opened':
          this.addLane()
          break

        case 'lane_closed':
          this.removeLane()
          break
      }
    }
  }

  /** Sync lane station states from article data. */
  syncArticles(articles: PipelineArticle[]) {
    for (const lane of this.lanes) {
      if (!lane.articleId) continue
      const article = articles.find(a => a.id === lane.articleId)
      if (article) {
        lane.syncFromArticle(article.processLogs)
      }
    }
  }

  /** Game loop tick. delta in seconds. */
  update(delta: number) {
    for (const lane of this.lanes) {
      lane.update(delta)
    }

    for (const scroll of this.scrolls.values()) {
      scroll.update(delta)
    }

    for (const pigeon of this.pigeons) {
      pigeon.update(delta)
    }

    for (const p of this.particles.values()) {
      p.update(delta)
    }
  }

  private findLaneKey(articleId: string, roleName: string): string | null {
    const lane = this.lanes.find(l => l.articleId === articleId)
    if (!lane) return null
    return `${lane.laneIndex}-${roleName}`
  }
}
```

**Step 2: Update NewsroomCanvas to use the scene manager**

Replace `web/app/pipeline/components/NewsroomCanvas.tsx`:

```tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { Application } from 'pixi.js'
import { NewsroomSceneManager, SCENE_W, SCENE_H } from '../engine/NewsroomScene'
import { usePipelineStore } from '../store/pipeline-store'

export function NewsroomCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const sceneRef = useRef<NewsroomSceneManager | null>(null)

  const fetchArticles = usePipelineStore(s => s.fetchArticles)
  const consumeEvents = usePipelineStore(s => s.consumeEvents)

  const initApp = useCallback(async () => {
    if (!canvasRef.current || appRef.current) return

    const app = new Application()
    await app.init({
      width: SCENE_W,
      height: SCENE_H,
      backgroundColor: 0x2a2a44,
      antialias: false,
      roundPixels: true,
    })

    canvasRef.current.appendChild(app.canvas)
    appRef.current = app

    // Scene manager
    const scene = new NewsroomSceneManager()
    sceneRef.current = scene
    app.stage.addChild(scene.root)

    // Game loop
    app.ticker.add((ticker) => {
      const delta = ticker.deltaTime / 60 // convert to seconds

      // Consume events from store
      const events = consumeEvents()
      const state = usePipelineStore.getState()
      if (events.length > 0) {
        scene.processEvents(events, state.articles)
      }

      // Sync article states
      scene.syncArticles(state.articles)

      // Update inbox badge
      scene.setInboxCount(state.pendingArticles.length)

      // Animate
      scene.update(delta)
    })

    // Start polling
    await fetchArticles()
    const timer = setInterval(() => { void fetchArticles() }, 10_000)

    // Resize handler
    const resize = () => {
      if (!canvasRef.current) return
      const parentW = canvasRef.current.clientWidth
      const scale = Math.min(parentW / SCENE_W, 1)
      app.canvas.style.width = `${SCENE_W * scale}px`
      app.canvas.style.height = `${SCENE_H * scale}px`
    }
    window.addEventListener('resize', resize)
    resize()

    // Visibility handler
    const onVisibility = () => {
      if (document.hidden) app.ticker.stop()
      else app.ticker.start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      app.destroy(true)
      appRef.current = null
      sceneRef.current = null
    }
  }, [fetchArticles, consumeEvents])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void initApp().then(fn => { cleanup = fn })
    return () => cleanup?.()
  }, [initApp])

  return (
    <div
      ref={canvasRef}
      className="relative mx-auto"
      style={{ maxWidth: SCENE_W, aspectRatio: `${SCENE_W}/${SCENE_H}` }}
    />
  )
}
```

**Step 3: Build and verify**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom/web
npx next build 2>&1 | tail -20
```

**Step 4: Commit**

```bash
git add web/app/pipeline/engine/NewsroomScene.ts web/app/pipeline/components/NewsroomCanvas.tsx
git commit -m "feat(pipeline): integrate scene manager with game loop, events, and animations"
```

---

## Task 10: Admin Panel — Floating Controls

**Files:**
- Create: `web/app/pipeline/components/AdminPanel.tsx`
- Modify: `web/app/pipeline/page.tsx`

**Context:** Admin panel floats over the Canvas. Shows buttons for: open/close lane, trigger inbox. Only visible when user is authenticated (Supabase session exists). Uses existing Supabase client.

**Step 1: Create AdminPanel**

`web/app/pipeline/components/AdminPanel.tsx`:
```tsx
'use client'

import { Press_Start_2P } from 'next/font/google'
import { usePipelineStore } from '../store/pipeline-store'

const pixelFont = Press_Start_2P({ subsets: ['latin'], weight: '400' })

export function AdminPanel() {
  const {
    isAdmin,
    activeLanes,
    laneAssignments,
    processingArticles,
    openLane,
    closeLane,
    openInbox,
  } = usePipelineStore()

  if (!isAdmin) return null

  const allLanesBusy = laneAssignments.length >= activeLanes
  const canCloseLane = activeLanes > 1

  return (
    <div className={`${pixelFont.className} pointer-events-none absolute inset-0 z-10`}>
      {/* Top-right controls */}
      <div className="pointer-events-auto absolute right-3 top-3 flex flex-col gap-2">
        {/* Open inbox */}
        <button
          onClick={() => openInbox()}
          className="rounded bg-[#3a5a3a] px-3 py-2 text-[8px] text-[#88ff88] transition hover:bg-[#4a6a4a]"
        >
          OPEN INBOX
        </button>

        {/* Open new lane */}
        {activeLanes < 3 && (
          <button
            onClick={() => openLane()}
            className="rounded bg-[#3a3a5a] px-3 py-2 text-[8px] text-[#8888ff] transition hover:bg-[#4a4a6a]"
          >
            + NEW LINE
          </button>
        )}

        {/* Close last lane */}
        {canCloseLane && (
          <button
            onClick={() => closeLane(activeLanes - 1)}
            disabled={!!laneAssignments.find(a => a.laneIndex === activeLanes - 1)}
            className="rounded bg-[#5a3a3a] px-3 py-2 text-[8px] text-[#ff8888] transition hover:bg-[#6a4a4a] disabled:opacity-30"
          >
            - CLOSE LINE
          </button>
        )}
      </div>

      {/* Status bar bottom */}
      <div className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/50 px-4 py-1 text-[8px] text-[#aaffaa]">
        ADMIN MODE | LINES {activeLanes}/3 | ACTIVE {processingArticles.length}
      </div>
    </div>
  )
}
```

**Step 2: Create InboxOverlay**

`web/app/pipeline/components/InboxOverlay.tsx`:
```tsx
'use client'

import { Press_Start_2P, VT323 } from 'next/font/google'
import { usePipelineStore } from '../store/pipeline-store'

const pixelFont = Press_Start_2P({ subsets: ['latin'], weight: '400' })
const bodyFont = VT323({ subsets: ['latin'], weight: '400' })

export function InboxOverlay() {
  const {
    inboxOpen,
    closeInbox,
    pendingArticles,
    assignArticleToLane,
    activeLanes,
    laneAssignments,
  } = usePipelineStore()

  if (!inboxOpen) return null

  const allBusy = laneAssignments.length >= activeLanes

  const handleSelect = (articleId: string) => {
    assignArticleToLane(articleId)
    closeInbox()
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md border-2 border-[#6a5a3a] bg-[#2a2a3a] p-4">
        <div className="flex items-center justify-between">
          <h2 className={`${pixelFont.className} text-xs text-[#ffeedd]`}>
            INBOX ({pendingArticles.length})
          </h2>
          <button
            onClick={() => closeInbox()}
            className={`${pixelFont.className} text-xs text-[#ff8888] hover:text-[#ffaaaa]`}
          >
            [X]
          </button>
        </div>

        {allBusy && (
          <p className={`${pixelFont.className} mt-3 text-[8px] text-[#ff8888]`}>
            ALL LINES BUSY
          </p>
        )}

        <div className={`${bodyFont.className} mt-3 max-h-64 space-y-2 overflow-y-auto`}>
          {pendingArticles.length === 0 ? (
            <p className="text-center text-lg text-[#888888]">NO PENDING NEWS</p>
          ) : (
            pendingArticles
              .sort((a, b) => b.rawItem.score - a.rawItem.score)
              .map(article => (
                <button
                  key={article.id}
                  onClick={() => handleSelect(article.id)}
                  disabled={allBusy}
                  className="w-full rounded border border-[#444455] bg-[#333344] px-3 py-2 text-left transition hover:bg-[#444466] disabled:opacity-40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg text-[#dddddd]">
                      {article.titleZh || article.rawItem.title}
                    </span>
                    <span className="text-sm text-[#88ff88]">
                      SCORE {article.rawItem.score}
                    </span>
                  </div>
                  <div className="text-sm text-[#888888]">
                    {article.rawItem.sourceName}
                  </div>
                </button>
              ))
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Update page.tsx to include admin panel and inbox**

Add imports and components to `web/app/pipeline/page.tsx`. After the `<NewsroomCanvas />` line, add inside the same relative container:

```tsx
'use client'

import { useEffect } from 'react'
import { Press_Start_2P, VT323 } from 'next/font/google'
import { NewsroomCanvas } from './components/NewsroomCanvas'
import { AdminPanel } from './components/AdminPanel'
import { InboxOverlay } from './components/InboxOverlay'
import { PublicNav } from '@web/components/public-nav'
import { usePipelineStore } from './store/pipeline-store'
import { createBrowserClient } from '@supabase/ssr'

const pixelTitle = Press_Start_2P({ subsets: ['latin'], weight: '400' })
const pixelBody = VT323({ subsets: ['latin'], weight: '400' })

export default function PipelinePage() {
  const { pendingArticles, processingArticles, activeLanes, error, setAdmin } = usePipelineStore()

  // Check if user is authenticated (admin)
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      setAdmin(!!data.user)
    })
  }, [setAdmin])

  return (
    <div className={`min-h-screen bg-[#1a1a2e] ${pixelBody.className}`}>
      <PublicNav />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className={`${pixelTitle.className} text-lg text-[#dcffeb]`}>
            PIXEL NEWSROOM
          </h1>
          <div className="flex gap-3 text-xl text-[#8aff8a]">
            <span>INBOX: {pendingArticles.length}</span>
            <span>LINES: {activeLanes}/3</span>
            <span>ACTIVE: {processingArticles.length}</span>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className={`${pixelTitle.className} bg-red-900/60 px-4 py-2 text-center text-xs text-red-300`}>
            {error}
          </div>
        )}

        {/* Canvas + overlays */}
        <div className="relative">
          <NewsroomCanvas />
          <AdminPanel />
          <InboxOverlay />
        </div>
      </main>
    </div>
  )
}
```

**Step 4: Verify build**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom/web
npx next build 2>&1 | tail -20
```

**Step 5: Commit**

```bash
git add web/app/pipeline/components/AdminPanel.tsx web/app/pipeline/components/InboxOverlay.tsx web/app/pipeline/page.tsx
git commit -m "feat(pipeline): add admin panel, inbox overlay, and Supabase auth check"
```

---

## Task 11: API Routes for Admin Actions

**Files:**
- Create: `web/app/api/pipeline/[articleId]/retry/route.ts`
- Create: `web/app/api/pipeline/[articleId]/skip/route.ts`

**Context:** Admin actions (retry, skip) need backend API routes. These update the AgentProcessLog status in the database. Protected by Supabase auth check.

**Step 1: Create retry route**

`web/app/api/pipeline/[articleId]/retry/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import prisma from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  // Auth check
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { articleId } = await params
  const { roleName } = await request.json()

  const role = await prisma.agentRole.findUnique({ where: { name: roleName } })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  await prisma.agentProcessLog.updateMany({
    where: { articleId, roleId: role.id, status: 'failed' },
    data: { status: 'pending', startedAt: null, completedAt: null },
  })

  return NextResponse.json({ ok: true })
}
```

**Step 2: Create skip route**

`web/app/api/pipeline/[articleId]/skip/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import prisma from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  // Auth check
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { articleId } = await params
  const { roleName } = await request.json()

  const role = await prisma.agentRole.findUnique({ where: { name: roleName } })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  await prisma.agentProcessLog.updateMany({
    where: { articleId, roleId: role.id, status: 'failed' },
    data: { status: 'completed', completedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
```

**Step 3: Check prisma import path**

The existing API routes import prisma. Verify the import path:

```bash
grep -r "from.*prisma" web/app/api/ --include="*.ts" | head -5
```

Use whatever import path the existing routes use.

**Step 4: Commit**

```bash
git add web/app/api/pipeline/
git commit -m "feat(pipeline): add retry and skip API routes for admin actions"
```

---

## Task 12: Delete Old Pipeline Game Redirect & Clean Up

**Files:**
- Delete: `web/app/pipeline/game/page.tsx`
- Remove: `web/app/pipeline/game/` directory

**Step 1: Remove game redirect**

```bash
rm -rf web/app/pipeline/game/
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore(pipeline): remove old game redirect page"
```

---

## Task 13: Visual Polish & Manual Testing

**Files:**
- Possibly modify: various engine files for visual tuning

**Step 1: Run dev server and test visually**

```bash
cd /Users/admin/Desktop/nao/clawnews/.worktrees/pixel-newsroom/web
npx next dev
```

Open `http://localhost:3000/pipeline` in browser.

**Step 2: Verify these behaviors work**

- [ ] Room background renders (walls, floor, window, inbox)
- [ ] At least 1 lane visible with 5 role stations
- [ ] Stations show idle animation (gentle bobbing)
- [ ] Stats header shows correct counts
- [ ] Admin: login, check admin controls appear
- [ ] Admin: open inbox, see pending articles
- [ ] Admin: select article, watch scroll enter lane
- [ ] Scroll moves between stations as roles process
- [ ] Particles appear when role is "working"
- [ ] Pigeon flies when article completes
- [ ] Admin: open/close lanes
- [ ] Error banner shows when API is down
- [ ] Canvas resizes responsively

**Step 3: Fix any visual issues found during testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(pipeline): visual polish and integration fixes"
```

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|----------------|
| 1 | Install deps & scaffold | 3 |
| 2 | Zustand store & event system | 2 |
| 3 | Canvas container & room background | 5 |
| 4 | RoleStation sprite & animation | 2 |
| 5 | PipelineLane track | 2 |
| 6 | NewsScroll movement | 2 |
| 7 | PigeonFlight animation | 2 |
| 8 | Role particle effects | 2 |
| 9 | Scene integration (wire all) | 4 |
| 10 | Admin panel & inbox overlay | 5 |
| 11 | Admin API routes | 4 |
| 12 | Clean up old code | 2 |
| 13 | Visual polish & testing | 4 |

**Total: 13 tasks, ~39 steps**
