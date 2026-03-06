import { create } from 'zustand'

/* ------------------------------------------------------------------ */
/*  Types matching API response                                        */
/* ------------------------------------------------------------------ */

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
  pipelineStatus: string
  createdAt: string
  rawItem: { title: string; sourceName: string; score: number }
  processLogs: ProcessLog[]
}

/* ------------------------------------------------------------------ */
/*  Scene events (consumed by PixiJS)                                  */
/* ------------------------------------------------------------------ */

export type SceneEventType =
  | 'article_enter_lane'
  | 'role_start_working'
  | 'role_complete'
  | 'role_failed'
  | 'article_published'
  | 'lane_opened'
  | 'lane_closed'

export interface SceneEvent {
  type: SceneEventType
  articleId?: string
  roleName?: string
  laneIndex?: number
  timestamp: number
}

/* ------------------------------------------------------------------ */
/*  Lane assignment                                                    */
/* ------------------------------------------------------------------ */

export interface LaneAssignment {
  laneIndex: number
  articleId: string
}

/* ------------------------------------------------------------------ */
/*  Store shape                                                        */
/* ------------------------------------------------------------------ */

interface PipelineState {
  // API data
  articles: PipelineArticle[]
  pendingArticles: PipelineArticle[]
  processingArticles: PipelineArticle[]

  // Scene
  activeLanes: number
  laneAssignments: LaneAssignment[]
  events: SceneEvent[]

  // UI
  inboxOpen: boolean
  isAdmin: boolean
  lastSync: number | null
  error: string | null
  loading: boolean
}

interface PipelineActions {
  fetchArticles: () => Promise<void>
  setAdmin: (value: boolean) => void
  openInbox: () => void
  closeInbox: () => void
  openLane: () => void
  closeLane: (index: number) => void
  assignArticleToLane: (articleId: string) => void
  consumeEvents: () => SceneEvent[]
  retryRole: (articleId: string, roleName: string) => Promise<void>
  skipRole: (articleId: string, roleName: string) => Promise<void>
}

/* ------------------------------------------------------------------ */
/*  diffEvents — compare prev vs next articles to emit scene events    */
/* ------------------------------------------------------------------ */

export function diffEvents(
  prev: PipelineArticle[],
  next: PipelineArticle[],
): SceneEvent[] {
  const events: SceneEvent[] = []
  const now = Date.now()
  const prevMap = new Map(prev.map((a) => [a.id, a]))

  for (const article of next) {
    const old = prevMap.get(article.id)

    if (!old) {
      // Brand-new article that already has status running → enter lane
      if (article.pipelineStatus === 'running') {
        events.push({
          type: 'article_enter_lane',
          articleId: article.id,
          timestamp: now,
        })
      }
      continue
    }

    // Article pipeline status changed to running (was not running before)
    if (old.pipelineStatus !== 'running' && article.pipelineStatus === 'running') {
      events.push({
        type: 'article_enter_lane',
        articleId: article.id,
        timestamp: now,
      })
    }

    // Article completed
    if (
      old.pipelineStatus !== 'completed' &&
      article.pipelineStatus === 'completed'
    ) {
      events.push({
        type: 'article_published',
        articleId: article.id,
        timestamp: now,
      })
    }

    // Compare individual process logs
    const oldLogMap = new Map(old.processLogs.map((l) => [l.role.name, l]))

    for (const log of article.processLogs) {
      const oldLog = oldLogMap.get(log.role.name)
      const oldStatus = oldLog?.status
      if (oldStatus === log.status) continue

      if (log.status === 'running') {
        events.push({
          type: 'role_start_working',
          articleId: article.id,
          roleName: log.role.name,
          timestamp: now,
        })
      } else if (log.status === 'completed') {
        events.push({
          type: 'role_complete',
          articleId: article.id,
          roleName: log.role.name,
          timestamp: now,
        })
      } else if (log.status === 'failed') {
        events.push({
          type: 'role_failed',
          articleId: article.id,
          roleName: log.role.name,
          timestamp: now,
        })
      }
    }
  }

  return events
}

/* ------------------------------------------------------------------ */
/*  Derived filter helpers                                             */
/* ------------------------------------------------------------------ */

function filterPending(articles: PipelineArticle[]): PipelineArticle[] {
  return articles.filter((a) => a.pipelineStatus === 'pending')
}

function filterProcessing(articles: PipelineArticle[]): PipelineArticle[] {
  return articles.filter((a) => a.pipelineStatus === 'running')
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const usePipelineStore = create<PipelineState & PipelineActions>()(
  (set, get) => ({
    // --- State defaults ---
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
    loading: false,

    // --- Actions ---

    async fetchArticles() {
      set({ loading: true, error: null })

      try {
        const res = await fetch('/api/pipeline')
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const next: PipelineArticle[] = await res.json()

        const prev = get().articles
        const newEvents = diffEvents(prev, next)

        set((state) => ({
          articles: next,
          pendingArticles: filterPending(next),
          processingArticles: filterProcessing(next),
          events: [...state.events, ...newEvents],
          lastSync: Date.now(),
          loading: false,
        }))
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Unknown error',
          loading: false,
        })
      }
    },

    setAdmin(value: boolean) {
      set({ isAdmin: value })
    },

    openInbox() {
      set({ inboxOpen: true })
    },

    closeInbox() {
      set({ inboxOpen: false })
    },

    openLane() {
      const { activeLanes, events } = get()
      if (activeLanes >= 3) return
      const newIndex = activeLanes // 0-indexed, so current count = next index
      set({
        activeLanes: activeLanes + 1,
        events: [
          ...events,
          { type: 'lane_opened' as const, laneIndex: newIndex, timestamp: Date.now() },
        ],
      })
    },

    closeLane(index: number) {
      const { activeLanes, laneAssignments, events } = get()
      if (activeLanes <= 1) return

      // Don't close a lane that has an active assignment
      const isBusy = laneAssignments.some((la) => la.laneIndex === index)
      if (isBusy) return

      set({
        activeLanes: activeLanes - 1,
        laneAssignments: laneAssignments
          .filter((la) => la.laneIndex !== index)
          .map((la) => ({
            ...la,
            // Shift higher-indexed lanes down
            laneIndex: la.laneIndex > index ? la.laneIndex - 1 : la.laneIndex,
          })),
        events: [
          ...events,
          { type: 'lane_closed' as const, laneIndex: index, timestamp: Date.now() },
        ],
      })
    },

    assignArticleToLane(articleId: string) {
      const { activeLanes, laneAssignments, events } = get()

      // Find the first free lane
      const occupiedLanes = new Set(laneAssignments.map((la) => la.laneIndex))
      let freeLane: number | null = null
      for (let i = 0; i < activeLanes; i++) {
        if (!occupiedLanes.has(i)) {
          freeLane = i
          break
        }
      }
      if (freeLane === null) return // no free lane available

      set({
        laneAssignments: [
          ...laneAssignments,
          { laneIndex: freeLane, articleId },
        ],
        events: [
          ...events,
          {
            type: 'article_enter_lane' as const,
            articleId,
            laneIndex: freeLane,
            timestamp: Date.now(),
          },
        ],
      })
    },

    consumeEvents(): SceneEvent[] {
      const current = get().events
      set({ events: [] })
      return current
    },

    async retryRole(articleId: string, roleName: string) {
      try {
        const res = await fetch(`/api/pipeline/${articleId}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleName }),
        })
        if (!res.ok) throw new Error(`Retry failed: ${res.status}`)
        // Re-fetch to pick up changes
        await get().fetchArticles()
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Retry failed',
        })
      }
    },

    async skipRole(articleId: string, roleName: string) {
      try {
        const res = await fetch(`/api/pipeline/${articleId}/skip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleName }),
        })
        if (!res.ok) throw new Error(`Skip failed: ${res.status}`)
        // Re-fetch to pick up changes
        await get().fetchArticles()
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Skip failed',
        })
      }
    },
  }),
)
