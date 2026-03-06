import { Container, Graphics, Text, TextStyle } from 'pixi.js'

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
