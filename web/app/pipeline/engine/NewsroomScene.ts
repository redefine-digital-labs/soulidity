import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { PipelineLane } from './PipelineLane'
import { NewsScroll } from './NewsScroll'
import { PigeonFlight } from './PigeonFlight'
import { RoleParticles } from './particles'
import { ROLE_DEFS } from './RoleStation'
import type { SceneEvent, PipelineArticle } from '../store/pipeline-store'

// ── Scene dimensions ────────────────────────────────────────────────
export const SCENE_W = 1200
export const SCENE_H = 700
export const WALL_H = 80
export const FLOOR_Y = SCENE_H - 60

// ── Inbox / Mailbox position ────────────────────────────────────────
export const INBOX_X = 40
export const INBOX_Y = 180
export const INBOX_W = 100
export const INBOX_H = 130

// ── Window position ─────────────────────────────────────────────────
export const WINDOW_X = SCENE_W - 100
export const WINDOW_Y = 20
export const WINDOW_W = 70
export const WINDOW_H = 70

// ── Lane layout ─────────────────────────────────────────────────────
export const LANE_START_X = 200
export const LANE_END_X = SCENE_W - 140
export const LANE_Y_BASE = 200
export const LANE_Y_GAP = 160

// ── Color palette ───────────────────────────────────────────────────
const COLOR = {
  wallTop: 0x3a3a5c,
  wallBottom: 0x2e2e48,
  floor: 0x5c4a3a,
  floorTile: 0x6b5a48,
  inbox: 0x8b6e4e,
  inboxFront: 0xa0825c,
  window: 0x87ceeb,
  windowFrame: 0x6e5a3c,
  windowLight: 0xfff8dc,
  midArea: 0x4a4a6e,
}

// ── Public factory ──────────────────────────────────────────────────
export function createRoomBackground(): Container {
  const root = new Container()

  root.addChild(drawWall())
  root.addChild(drawMidArea())
  root.addChild(drawFloor())
  root.addChild(drawWindow())
  root.addChild(drawLightRay())
  root.addChild(drawInbox())

  return root
}

// ── Wall (top portion) ──────────────────────────────────────────────
function drawWall(): Graphics {
  const g = new Graphics()
  g.rect(0, 0, SCENE_W, WALL_H)
  g.fill(COLOR.wallTop)
  // Subtle bottom band for depth
  g.rect(0, WALL_H - 8, SCENE_W, 8)
  g.fill(COLOR.wallBottom)
  return g
}

// ── Middle area (between wall and floor) ────────────────────────────
function drawMidArea(): Graphics {
  const g = new Graphics()
  g.rect(0, WALL_H, SCENE_W, FLOOR_Y - WALL_H)
  g.fill(COLOR.midArea)
  return g
}

// ── Floor (bottom 60px with tile grid) ──────────────────────────────
function drawFloor(): Graphics {
  const g = new Graphics()
  // Base floor
  g.rect(0, FLOOR_Y, SCENE_W, SCENE_H - FLOOR_Y)
  g.fill(COLOR.floor)

  // Tile grid lines
  const tileSize = 30
  for (let x = 0; x <= SCENE_W; x += tileSize) {
    g.rect(x, FLOOR_Y, 1, SCENE_H - FLOOR_Y)
    g.fill(COLOR.floorTile)
  }
  for (let y = FLOOR_Y; y <= SCENE_H; y += tileSize) {
    g.rect(0, y, SCENE_W, 1)
    g.fill(COLOR.floorTile)
  }
  return g
}

// ── Window (top-right, sky blue with wood frame and cross bars) ─────
function drawWindow(): Graphics {
  const g = new Graphics()

  // Outer frame
  g.rect(WINDOW_X - 4, WINDOW_Y - 4, WINDOW_W + 8, WINDOW_H + 8)
  g.fill(COLOR.windowFrame)

  // Sky pane
  g.rect(WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H)
  g.fill(COLOR.window)

  // Cross bars (horizontal + vertical)
  const barW = 3
  g.rect(WINDOW_X, WINDOW_Y + WINDOW_H / 2 - barW / 2, WINDOW_W, barW)
  g.fill(COLOR.windowFrame)
  g.rect(WINDOW_X + WINDOW_W / 2 - barW / 2, WINDOW_Y, barW, WINDOW_H)
  g.fill(COLOR.windowFrame)

  return g
}

// ── Light ray from window (subtle transparent triangle to floor) ────
function drawLightRay(): Graphics {
  const g = new Graphics()
  // Triangle from window center down to floor, spreading outward
  const cx = WINDOW_X + WINDOW_W / 2
  const cy = WINDOW_Y + WINDOW_H

  g.poly([
    cx - 10, cy,
    cx + 10, cy,
    cx + 120, FLOOR_Y,
    cx - 60, FLOOR_Y,
  ])
  g.fill({ color: COLOR.windowLight, alpha: 0.06 })
  return g
}

// ── Inbox / Mailbox ─────────────────────────────────────────────────
function drawInbox(): Container {
  const c = new Container()

  const g = new Graphics()

  // Box top face
  g.rect(INBOX_X, INBOX_Y, INBOX_W, INBOX_H - 20)
  g.fill(COLOR.inbox)

  // Front face (slightly darker, gives 3D depth)
  g.rect(INBOX_X, INBOX_Y + INBOX_H - 20, INBOX_W, 20)
  g.fill(COLOR.inboxFront)

  // Mail slot
  const slotW = 50
  const slotH = 6
  const slotX = INBOX_X + (INBOX_W - slotW) / 2
  const slotY = INBOX_Y + 20
  g.rect(slotX, slotY, slotW, slotH)
  g.fill(COLOR.wallBottom)

  c.addChild(g)

  // "INBOX" label
  const style = new TextStyle({
    fontFamily: 'monospace',
    fontSize: 11,
    fill: 0xffffff,
    letterSpacing: 1,
  })
  const label = new Text({ text: 'INBOX', style })
  label.x = INBOX_X + (INBOX_W - label.width) / 2
  label.y = INBOX_Y + INBOX_H - 16
  c.addChild(label)

  return c
}

// ── Scene Manager ────────────────────────────────────────────────────

const MAX_LANES = 3

export class NewsroomSceneManager {
  readonly root: Container

  private readonly roomBg: Container
  private readonly lanesContainer: Container
  private readonly scrollsContainer: Container
  private readonly effectsContainer: Container

  private readonly lanes: PipelineLane[] = []
  private readonly scrolls = new Map<string, NewsScroll>()
  private readonly pigeons: PigeonFlight[] = []
  private readonly particles = new Map<string, RoleParticles>()

  private readonly inboxBadge: Text

  constructor() {
    this.root = new Container()

    // Background layer
    this.roomBg = createRoomBackground()
    this.root.addChild(this.roomBg)

    // Lanes layer
    this.lanesContainer = new Container()
    this.lanesContainer.x = LANE_START_X
    this.root.addChild(this.lanesContainer)

    // Scrolls layer
    this.scrollsContainer = new Container()
    this.scrollsContainer.x = LANE_START_X
    this.root.addChild(this.scrollsContainer)

    // Effects layer (on top)
    this.effectsContainer = new Container()
    this.root.addChild(this.effectsContainer)

    // Create first lane
    this.addLane()

    // Inbox badge
    this.inboxBadge = new Text({
      text: '0',
      style: new TextStyle({
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 12,
        fill: 0xff3333,
      }),
    })
    this.inboxBadge.x = INBOX_X + INBOX_W - 8
    this.inboxBadge.y = INBOX_Y - 14
    this.inboxBadge.visible = false
    this.root.addChild(this.inboxBadge)
  }

  /* ---------------------------------------------------------------- */
  /*  Lane management                                                  */
  /* ---------------------------------------------------------------- */

  addLane(): PipelineLane | null {
    if (this.lanes.length >= MAX_LANES) return null

    const index = this.lanes.length
    const lane = new PipelineLane(index)
    lane.y = LANE_Y_BASE + index * LANE_Y_GAP
    this.lanesContainer.addChild(lane)
    this.lanes.push(lane)

    // Create RoleParticles for each station in the lane
    for (const station of lane.stations) {
      const key = `${index}-${station.roleName}`
      const rp = new RoleParticles(station.roleName)
      // Position relative to lane: station.x + 32 centers horizontally,
      // station.y + 20 centers vertically on the character
      rp.x = LANE_START_X + station.x + 32
      rp.y = lane.y + station.y + 20
      this.effectsContainer.addChild(rp)
      this.particles.set(key, rp)
    }

    return lane
  }

  removeLane(): void {
    if (this.lanes.length <= 1) return
    const lane = this.lanes[this.lanes.length - 1]

    // Only remove if lane is empty
    if (lane.articleId) return

    // Clean up particles for this lane
    const laneIndex = this.lanes.length - 1
    for (const station of lane.stations) {
      const key = `${laneIndex}-${station.roleName}`
      const rp = this.particles.get(key)
      if (rp) {
        rp.clear()
        this.effectsContainer.removeChild(rp)
        rp.destroy()
        this.particles.delete(key)
      }
    }

    this.lanesContainer.removeChild(lane)
    lane.destroy()
    this.lanes.pop()
  }

  /* ---------------------------------------------------------------- */
  /*  Inbox badge                                                      */
  /* ---------------------------------------------------------------- */

  setInboxCount(count: number): void {
    if (count <= 0) {
      this.inboxBadge.visible = false
    } else {
      this.inboxBadge.text = String(count)
      this.inboxBadge.visible = true
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Event processing                                                 */
  /* ---------------------------------------------------------------- */

  processEvents(events: SceneEvent[], articles: PipelineArticle[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'article_enter_lane': {
          if (!ev.articleId) break
          // Find a free lane
          const lane = this.lanes.find((l) => !l.articleId)
          if (!lane) break
          lane.articleId = ev.articleId

          // Find article data for the title
          const article = articles.find((a) => a.id === ev.articleId)
          const titleZh = article?.titleZh ?? '...'

          // Create scroll at left edge, then move to first station
          const scroll = new NewsScroll(ev.articleId, titleZh)
          scroll.x = -60
          scroll.y = lane.y + 30
          this.scrollsContainer.addChild(scroll)
          this.scrolls.set(ev.articleId, scroll)

          // Move to first station
          scroll.moveTo(lane.getStationX(0))
          break
        }

        case 'role_start_working': {
          if (!ev.articleId || !ev.roleName) break
          const key = this.findLaneKey(ev.articleId, ev.roleName)
          if (!key) break
          const rp = this.particles.get(key)
          rp?.start()
          break
        }

        case 'role_complete': {
          if (!ev.articleId || !ev.roleName) break
          // Stop particles
          const completeKey = this.findLaneKey(ev.articleId, ev.roleName)
          if (completeKey) {
            const rp = this.particles.get(completeKey)
            rp?.stop()
          }

          // Flash scroll glow
          const scroll = this.scrolls.get(ev.articleId)
          scroll?.flashGlow()

          // Move scroll to next station
          const lane = this.lanes.find((l) => l.articleId === ev.articleId)
          if (lane && scroll) {
            const roleIndex = ROLE_DEFS.findIndex((r) => r.name === ev.roleName)
            if (roleIndex >= 0 && roleIndex < ROLE_DEFS.length - 1) {
              scroll.moveTo(lane.getStationX(roleIndex + 1))
            }
          }
          break
        }

        case 'role_failed': {
          if (!ev.articleId || !ev.roleName) break
          const failKey = this.findLaneKey(ev.articleId, ev.roleName)
          if (failKey) {
            const rp = this.particles.get(failKey)
            rp?.stop()
          }
          break
        }

        case 'article_published': {
          if (!ev.articleId) break
          const scroll = this.scrolls.get(ev.articleId)
          if (scroll) {
            // Spawn pigeon from scroll position
            const pigeon = new PigeonFlight(
              LANE_START_X + scroll.x,
              scroll.y,
            )
            this.effectsContainer.addChild(pigeon)
            this.pigeons.push(pigeon)

            // Remove scroll
            this.scrollsContainer.removeChild(scroll)
            scroll.destroy()
            this.scrolls.delete(ev.articleId)
          }

          // Free the lane
          const lane = this.lanes.find((l) => l.articleId === ev.articleId)
          if (lane) {
            lane.clear()
          }
          break
        }

        case 'lane_opened': {
          this.addLane()
          break
        }

        case 'lane_closed': {
          this.removeLane()
          break
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Sync article state to lanes                                      */
  /* ---------------------------------------------------------------- */

  syncArticles(articles: PipelineArticle[]): void {
    for (const lane of this.lanes) {
      if (!lane.articleId) continue
      const article = articles.find((a) => a.id === lane.articleId)
      if (article) {
        lane.syncFromArticle(article.processLogs)
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Per-frame update                                                 */
  /* ---------------------------------------------------------------- */

  update(delta: number): void {
    // Update lanes (and their stations)
    for (const lane of this.lanes) {
      lane.update(delta)
    }

    // Update scrolls
    for (const scroll of this.scrolls.values()) {
      scroll.update(delta)
    }

    // Update pigeons, remove completed
    for (let i = this.pigeons.length - 1; i >= 0; i--) {
      const pigeon = this.pigeons[i]
      pigeon.update(delta)
      if (pigeon.isComplete) {
        this.effectsContainer.removeChild(pigeon)
        pigeon.destroy()
        this.pigeons.splice(i, 1)
      }
    }

    // Update particles
    for (const rp of this.particles.values()) {
      rp.update(delta)
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Helper: find particle map key for an article + role              */
  /* ---------------------------------------------------------------- */

  private findLaneKey(articleId: string, roleName: string): string | null {
    const laneIndex = this.lanes.findIndex((l) => l.articleId === articleId)
    if (laneIndex < 0) return null
    return `${laneIndex}-${roleName}`
  }
}
