import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import {
  bootServices, shutdownServices, sealDay,
  copyInitialTemplates, getPersonaDir,
  moodService
} from '@soulidity/backend'
import {
  CLI_TERMINAL_GRACE_MS,
  deriveAggregateStatus,
  derivePetAgentEvents,
  type AgentStatusFile,
  type MoodSnapshot,
  type PetUpdateStatus,
} from '@soulidity/shared'
import { startStatusWatcher, stopStatusWatcher, getCurrentAgentStatus } from './status-watcher'
import { startAgentMonitor, stopAgentMonitor } from './agent-monitor'
import { generateAgentKeypair, loadAgentKeypair, exportAgentAddress, getSecretStorageStatus } from './agent-wallet'
import { executeTask, cancelTask, getActiveTaskIds, shutdownAllTasks } from './task-executor'
import {
  hasCachedSprite, getCachedSprite, cacheSprite, removeCachedSprite,
  pruneCache, getCacheStats, listCachedSprites
} from './cache-manager'

// ── electron-store 替代手写 config ──────────────────────────
const store = new Store({ name: 'soulidity-settings' })

// ── 窗口引用 ───────────────────────────────────────────────
let ballWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
let dragOffset = { x: 0, y: 0 }
let petHoverLock = false
let petContextMenuOpen = false
let currentPetSize = 120
let lastAgentStatus: AgentStatusFile | null = null
let currentUpdateStatus: PetUpdateStatus = { state: 'idle' }
let moodGraceTimer: ReturnType<typeof setTimeout> | null = null

function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function setUpdateStatus(status: PetUpdateStatus): void {
  currentUpdateStatus = status
  broadcastToAllWindows('update-status', status)
}

function isCursorInPetHitArea(): boolean {
  if (!ballWin || ballWin.isDestroyed()) return false

  const bounds = ballWin.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const ballCenterX = bounds.x + Math.round(bounds.width / 2)
  const ballCenterY = bounds.y + bounds.height - 8 - Math.round(currentPetSize / 2)
  const dx = cursor.x - ballCenterX
  const dy = cursor.y - ballCenterY
  const radius = currentPetSize / 2 + 4
  return dx * dx + dy * dy <= radius * radius
}

function syncPetMouseMode(): void {
  if (!ballWin || ballWin.isDestroyed()) return

  const shouldStayInteractive = petHoverLock || petContextMenuOpen || isCursorInPetHitArea()
  ballWin.setIgnoreMouseEvents(!shouldStayInteractive, shouldStayInteractive ? undefined : { forward: true })
}

// ── 单实例锁 ───────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows: deep link 通过命令行参数传入
    const deepLinkArg = commandLine.find((arg) => arg.startsWith('soulidity://'))
    if (deepLinkArg) handleDeepLink(deepLinkArg)

    // 聚焦已有窗口
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    } else if (ballWin) {
      ballWin.show()
    }
  })
}

// ── 自定义协议 soulidity:// ─────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('soulidity', process.execPath, [process.argv[1]])
  }
} else {
  app.setAsDefaultProtocolClient('soulidity')
}

let pendingDeepLink: string | null = null

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (app.isReady()) {
    handleDeepLink(url)
  } else {
    pendingDeepLink = url
  }
})

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'soulidity:') return

    if (parsed.hostname === 'settings' || parsed.pathname === '//settings') {
      createMainWindow()
    }
    // soulidity://install-sprite?id=xxx — 预留
  } catch {
    console.warn('[main] invalid deep link:', url)
  }
}

// ── Mood 广播 ──────────────────────────────────────────────
function broadcastMoodChanged(snapshot: MoodSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mood-changed', snapshot)
  }
}

moodService.onChange((snapshot) => {
  broadcastMoodChanged(snapshot)
})

// ── 数据目录 ──────────────────────────────────────────────
function resolveDataDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'data')
  }
  return join(__dirname, '..', '..', '..', '..', 'data')
}

// ── 悬浮球窗口 ────────────────────────────────────────────
const DEFAULT_PET_SIZE = 120
const DEFAULT_WINDOW_PADDING = 40

function createBallWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  const petSize = (store.get('petSize', DEFAULT_PET_SIZE) as number)
  currentPetSize = petSize
  petHoverLock = false
  petContextMenuOpen = false
  const padding = DEFAULT_WINDOW_PADDING
  const winW = petSize + padding * 2
  const winH = petSize + padding * 2 + 30

  const defaultX = width - 60 - Math.round(winW / 2)
  const defaultY = height - 60 - (winH - 36)

  let x = defaultX
  let y = defaultY
  const saved = store.get('ballPosition') as { x: number; y: number } | undefined
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const inBounds =
      saved.x >= -winW / 2 && saved.x <= width - winW / 2 &&
      saved.y >= 0 && saved.y <= height - 40
    if (inBounds) { x = saved.x; y = saved.y }
  }

  ballWin = new BrowserWindow({
    width: winW, height: winH, x, y,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.platform === 'darwin') {
    ballWin.setAlwaysOnTop(true, 'floating')
  } else {
    ballWin.setAlwaysOnTop(true)
  }

  syncPetMouseMode()

  const POLL_INTERVAL = 80
  const pollTimer = setInterval(() => {
    if (!ballWin || ballWin.isDestroyed()) return
    syncPetMouseMode()
  }, POLL_INTERVAL)

  ballWin.on('ready-to-show', () => ballWin?.show())
  ballWin.on('closed', () => {
    clearInterval(pollTimer)
    petHoverLock = false
    petContextMenuOpen = false
    ballWin = null
  })

  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    ballWin.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    ballWin.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC: 悬浮球拖拽 ────────────────────────────────────────
ipcMain.on('drag:start', () => {
  if (!ballWin) return
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = ballWin.getPosition()
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
})

ipcMain.on('drag:move', () => {
  if (!ballWin) return
  const { x, y } = screen.getCursorScreenPoint()
  ballWin.setPosition(Math.round(x - dragOffset.x), Math.round(y - dragOffset.y))
})

ipcMain.on('drag:end', () => {
  if (!ballWin) return
  const [bx, by] = ballWin.getPosition()
  store.set('ballPosition', { x: bx, y: by })
})

// ── IPC: 透明区域点击穿透 ──────────────────────────────────
ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  if (!ballWin) return
  petHoverLock = !ignore
  syncPetMouseMode()
})

ipcMain.on('pet:hide', () => {
  petHoverLock = false
  petContextMenuOpen = false
  ballWin?.hide()
})

// ── IPC: 窗口自适应尺寸 ────────────────────────────────────
ipcMain.on('resize-pet-window', (_event, width: number, height: number) => {
  if (!ballWin) return
  const [cx, cy] = ballWin.getPosition()
  const [, ch] = ballWin.getSize()
  ballWin.setBounds({
    x: cx,
    y: Math.round(cy + ch - height),
    width: Math.round(width),
    height: Math.round(height),
  })
})

// ── IPC: 调试 ──────────────────────────────────────────────
ipcMain.handle('ipc:ping', () => 'pong from main')

// ── IPC: Mood / Greeting / Persona ─────────────────────────
ipcMain.handle('mood:get', () => moodService.getSnapshot())
ipcMain.handle('mood:interact', () => { moodService.notifyUserMessage(); return { ok: true } })
ipcMain.handle('mood:drag-start', () => { moodService.notifyDragStart(); return { ok: true } })
ipcMain.handle('mood:drag-end', () => { moodService.notifyDragEnd(); return { ok: true } })

ipcMain.handle('persona:get', () => {
  const dir = getPersonaDir()
  const read = (name: string): string | null => {
    const p = join(dir, name)
    try { return existsSync(p) ? readFileSync(p, 'utf-8') : null } catch { return null }
  }
  return { soul: read('SOUL.md'), user: read('USER.md'), context: read('CONTEXT.md') }
})

// ── IPC: Task 执行 (Claude / Codex) ────────────────────────
ipcMain.handle('task:execute', (_event, payload) => executeTask(payload))
ipcMain.on('task:cancel', (_event, taskId: string) => cancelTask(taskId))
ipcMain.handle('task:list-active', () => getActiveTaskIds())

// ── IPC: 本地缓存 ──────────────────────────────────────────
ipcMain.handle('cache:has-sprite', (_event, spriteId: string) => hasCachedSprite(spriteId))
ipcMain.handle('cache:get-sprite', (_event, spriteId: string) => getCachedSprite(spriteId))
ipcMain.handle('cache:remove-sprite', (_event, spriteId: string) => removeCachedSprite(spriteId))
ipcMain.handle('cache:prune', (_event, maxAgeMs: number) => pruneCache(maxAgeMs))
ipcMain.handle('cache:stats', () => getCacheStats())
ipcMain.handle('cache:list', () => listCachedSprites())

// ── IPC: 自动更新 ──────────────────────────────────────────
autoUpdater.autoDownload = false
autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} } as any

autoUpdater.on('checking-for-update', () => {
  setUpdateStatus({ state: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  setUpdateStatus({ state: 'available', version: info.version })
})

autoUpdater.on('update-not-available', () => {
  setUpdateStatus({ state: 'not-available' })
})

autoUpdater.on('download-progress', (progress) => {
  setUpdateStatus({
    state: 'downloading',
    version: currentUpdateStatus.version,
    progress: progress.percent,
  })
})

autoUpdater.on('update-downloaded', (info) => {
  setUpdateStatus({ state: 'downloaded', version: info.version, progress: 100 })
})

autoUpdater.on('error', (err) => {
  setUpdateStatus({
    state: 'error',
    version: currentUpdateStatus.version,
    error: err?.message ?? String(err),
  })
})

async function performUpdateCheck(showNoUpdateDialog = false): Promise<{
  available: boolean
  version?: string
  error?: string
}> {
  try {
    await autoUpdater.checkForUpdates()
    const available = currentUpdateStatus.state === 'available'
      || currentUpdateStatus.state === 'downloading'
      || currentUpdateStatus.state === 'downloaded'
    if (!available && showNoUpdateDialog) {
      dialog.showMessageBox({ message: 'You are on the latest version.', type: 'info' }).catch(() => {})
    }
    return { available, version: currentUpdateStatus.version }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (showNoUpdateDialog) {
      dialog.showMessageBox({ message: error, type: 'error' }).catch(() => {})
    }
    return { available: false, error }
  }
}

async function performUpdateDownload(): Promise<{ ok: boolean; error?: string }> {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

ipcMain.handle('updater:check', () => performUpdateCheck(false))
ipcMain.handle('updater:status', () => currentUpdateStatus)
ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('updater:download', () => performUpdateDownload())

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall()
})

// ── 右键上下文菜单 ────────────────────────────────────────

const MAIN_WIN_W = 480
const MAIN_WIN_H = 600
const MAIN_WIN_MIN_W = 400
const MAIN_WIN_MIN_H = 500

function createMainWindow(): void {
  if (mainWin) { mainWin.focus(); return }

  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea
  const x = Math.round(workArea.x + (workArea.width - MAIN_WIN_W) / 2)
  const y = Math.round(workArea.y + (workArea.height - MAIN_WIN_H) / 3)

  mainWin = new BrowserWindow({
    width: MAIN_WIN_W, height: MAIN_WIN_H,
    minWidth: MAIN_WIN_MIN_W, minHeight: MAIN_WIN_MIN_H,
    x, y,
    frame: false, transparent: false, alwaysOnTop: false,
    skipTaskbar: false, resizable: true, hasShadow: true, show: false,
    backgroundColor: '#18181c',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  mainWin.on('ready-to-show', () => mainWin?.show())
  mainWin.on('closed', () => { mainWin = null })

  const mainParam = '?view=main'
  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    mainWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + mainParam)
  } else {
    mainWin.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=main' })
  }
}

function hidePetWindow(): void {
  petHoverLock = false
  petContextMenuOpen = false
  ballWin?.hide()
}

ipcMain.on('contextmenu:show', () => {
  if (!ballWin) return

  const menu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => createMainWindow() },
    { label: 'Hide Character', click: () => hidePetWindow() },
    { label: 'Check for Updates', click: () => { void performUpdateCheck(true) } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  petContextMenuOpen = true
  syncPetMouseMode()

  menu.popup({
    window: ballWin,
    callback: () => {
      petContextMenuOpen = false
      syncPetMouseMode()
    },
  })
})

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// ── 配置管理 IPC ──────────────────────────────────────────
ipcMain.handle('config:get', () => ({ ...store.store }))
ipcMain.handle('config:set', (_event, config: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(config)) {
    store.set(key, value)
  }
})

// ── 设备绑定 IPC ──────────────────────────────────────────
const WEB_BASE_URL = process.env['SOULIDITY_WEB_URL'] || 'https://clawnews-mu.vercel.app'

ipcMain.handle('device:start-link', async (_event, agentAddress: string) => {
  const res = await fetch(`${WEB_BASE_URL}/api/desktop/device/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentAddress }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error((data.error as string) || `Link start failed (${res.status})`)
  return data
})

ipcMain.handle('device:poll', async (_event, deviceCode: string) => {
  const res = await fetch(`${WEB_BASE_URL}/api/desktop/device/poll`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error((data.error as string) || `Poll failed (${res.status})`)
  return data
})

ipcMain.handle('device:get-link-url', () => `${WEB_BASE_URL}/desktop/link`)

// ── Agent wallet + status watcher IPC ──────────────────────
ipcMain.handle('get-current-agent-status', () => getCurrentAgentStatus())
ipcMain.handle('generate-agent-keypair', () => generateAgentKeypair())
ipcMain.handle('load-agent-keypair', () => loadAgentKeypair())
ipcMain.handle('export-agent-address', () => exportAgentAddress())
ipcMain.handle('get-secret-storage-status', () => getSecretStorageStatus())

// ── System Tray ────────────────────────────────────────────
function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '..', '..', 'resources', 'icon.png')

  const icon = nativeImage.createFromPath(iconPath)
  const resized = icon.resize({ width: 16, height: 16 })
  if (process.platform === 'darwin') {
    resized.setTemplateImage(true)
  }

  tray = new Tray(resized)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Character',
      click: () => { if (ballWin) { ballWin.show() } else { createBallWindow() } }
    },
    {
      label: 'Hide Character',
      click: () => { hidePetWindow() }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => createMainWindow()
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => { void performUpdateCheck(true) }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])

  tray.setToolTip('Soulidity Desktop Companion')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (ballWin?.isVisible()) {
      hidePetWindow()
    } else if (ballWin) {
      ballWin.show()
    } else {
      createBallWindow()
    }
  })
}

// ── App 生命周期 ───────────────────────────────────────────
app.whenReady().then(async () => {
  // 处理启动时的 deep link
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink)
    pendingDeepLink = null
  }
  // macOS: 检查命令行中的 deep link
  const deepLinkArg = process.argv.find((arg) => arg.startsWith('soulidity://'))
  if (deepLinkArg) handleDeepLink(deepLinkArg)

  try {
    const builtinPersona = app.isPackaged
      ? join(process.resourcesPath, 'persona')
      : join(__dirname, '..', '..', 'resources', 'persona')
    if (existsSync(builtinPersona)) {
      copyInitialTemplates(builtinPersona)
    }

    await bootServices(resolveDataDir())
  } catch (err: unknown) {
    console.error('[main] Failed to boot services:', err)
    dialog.showErrorBox(
      'Startup Failed',
      `Services could not start.\n\n${err instanceof Error ? err.message : String(err)}`
    )
    app.quit()
    return
  }

  startStatusWatcher((status) => {
    const now = Date.now()
    const agentEvents = derivePetAgentEvents(lastAgentStatus, status, {
      now,
      terminalGraceMs: CLI_TERMINAL_GRACE_MS,
    })
    lastAgentStatus = status

    for (const event of agentEvents) {
      broadcastToAllWindows('agent-event', event)
    }

    // Clear any pending grace timer — a new status update supersedes it
    if (moodGraceTimer) {
      clearTimeout(moodGraceTimer)
      moodGraceTimer = null
    }

    const aggregateStatus = deriveAggregateStatus(status, {
      now,
      terminalGraceMs: CLI_TERMINAL_GRACE_MS,
    })
    moodService.notifyCliStatusChanged(aggregateStatus)

    // Schedule post-grace re-evaluation for terminal states so the mood
    // returns to idle once the grace window expires (mirrors useCliStatus)
    if (aggregateStatus === 'completed' || aggregateStatus === 'error') {
      moodGraceTimer = setTimeout(() => {
        moodGraceTimer = null
        const currentStatus = getCurrentAgentStatus()
        if (currentStatus) {
          moodService.notifyCliStatusChanged(deriveAggregateStatus(currentStatus, {
            now: Date.now(),
            terminalGraceMs: CLI_TERMINAL_GRACE_MS,
          }))
        }
      }, CLI_TERMINAL_GRACE_MS)
    }
  })
  startAgentMonitor()
  generateAgentKeypair().catch((err) => console.warn('Agent keypair generation deferred:', err.message))

  createBallWindow()
  createTray()
  void performUpdateCheck(false)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBallWindow()
  })
})

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  stopAgentMonitor()
  stopStatusWatcher()
  shutdownAllTasks()

  event.preventDefault()
  isQuitting = true

  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy()
  }
  tray?.destroy()

  const exitTimer = setTimeout(() => {
    console.warn('[main] shutdown timeout, force exit')
    app.exit(0)
  }, 60000)

  sealDay()
    .catch((err) => console.error('[main] sealDay error:', err))
    .then(() => shutdownServices())
    .finally(() => {
      clearTimeout(exitTimer)
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  // macOS: 不退出，tray 常驻
  if (process.platform !== 'darwin') app.quit()
})
