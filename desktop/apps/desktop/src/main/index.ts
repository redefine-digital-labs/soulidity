import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron'
import { basename, extname, join, resolve as resolvePath } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import {
  bootServices, shutdownServices, sealDay,
  prepareBuiltinPersonaTemplates, getPersonaDir,
  moodService,
} from '@soulidity/backend'
import {
  CLI_TERMINAL_GRACE_MS,
  type CreateLocalExtractDraftInput,
  createAgentStatusSignature,
  deriveAggregateStatus,
  derivePetAgentEvents,
  type ImportOpenClawDraftInput,
  type LocalExtractAgentStatus,
  type OpenClawImportStatus,
  toAgentStatusFile,
  type AgentStatusFile,
  type AgentRuntimeSnapshot,
  type ExtractSoulDraft,
  type MoodSnapshot,
  type PetUpdateStatus,
  type ScanProgress,
  type SupportedAgentSource,
} from '@soulidity/shared'
import { startStatusWatcher, stopStatusWatcher, getCurrentAgentStatus, publishAgentStatus } from './status-watcher'
import { startAgentMonitor, stopAgentMonitor } from './agent-monitor'
import {
  generateAgentKeypair,
  loadAgentKeypair,
  exportAgentAddress,
  getSecretStorageStatus,
  signAgentPersonalMessage,
  clearAgentKeypair,
} from './agent-wallet'
import {
  storeAgentApiKey,
  clearAgentApiKey,
  rotateAgentApiKey,
  configureAgentApiKeyStoreFetcher,
  getAgentApiKeyStatus,
} from './agent-api-key-store'
import {
  handleDevicePollResponse,
  type RawPollResponse,
} from './device-poll'
import { performAgentResetIdentity } from './agent-reset-identity'
import { performAgentUnlink } from './agent-unlink'
import {
  executeTask,
  cancelTask,
  getActiveTaskIds,
  shutdownAllTasks,
  createWriteApprovalToken,
  isSafeSandboxRoot,
  resolveApprovedSandboxRoot,
  MAX_APPROVED_INSTRUCTION_LENGTH,
} from './task-executor'
import {
  hasCachedSprite, getCachedSprite, cacheSprite, removeCachedSprite,
  pruneCache, getCacheStats, listCachedSprites
} from './cache-manager'
import { downloadSoulPersona } from './soul-downloader'
import {
  storeDesktopToken,
  loadDesktopToken,
  clearDesktopToken,
  getDesktopAuthStatus,
  loadDesktopTokenIssuingWebBaseUrl,
} from './desktop-auth-store'
import { clearExtractSoulDraft, loadExtractSoulDraft, saveExtractSoulDraft } from './extract-draft-store'
import { scanSessions } from './soul-extraction/session-scanner'
import { createLocalExtractDraft, getLocalExtractAgentStatuses } from './soul-extraction/local-draft-generator'
import { getOpenClawImportStatus, importOpenClawDraft } from './soul-extraction/openclaw-import'
import { buildUpdateErrorStatus, isMissingLatestReleaseAssetError, toUpdateErrorMessage } from './update-errors'
import { getDesktopWebBaseUrl, readDesktopJsonResponse } from './web-api'
import { validateOpenExternalUrl } from './external-url'
import { installWebContentsNavigationGuards, SECURE_WINDOW_WEB_PREFERENCES } from './window-security'
import { AgentRuntimeController, createUnixSocketTransportServer, type UnixSocketTransportServerHandle } from './agent-runtime'
import { AgentRuntimeHookManager, getDefaultRuntimeSocketPath } from './agent-runtime-hooks'
import { createCompatMirrorWriter } from './compat-mirror-writer'

// ── electron-store 替代手写 config ──────────────────────────
const store = new Store({ name: 'soulidity-settings' })

function getRendererNavigationAllowlist(): string[] {
  const urls = [new URL('../renderer/index.html', `file://${__dirname}/`).toString()]
  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    urls.push(process.env['ELECTRON_RENDERER_URL'])
  }
  return urls
}

function guardWindowNavigation(win: BrowserWindow): void {
  installWebContentsNavigationGuards(win.webContents, {
    allowedNavigationUrls: getRendererNavigationAllowlist(),
  })
}

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
let currentRuntimeSnapshot: AgentRuntimeSnapshot | null = null
let runtimeCompatStatus: AgentStatusFile | null = null
let monitorFallbackStatus: AgentStatusFile | null = null
let compatMirrorSignature: string | null = null
let publishedStatusSignature: string | null = null
let runtimeController: AgentRuntimeController | null = null
let runtimeTransportServer: UnixSocketTransportServerHandle | null = null
let runtimeHookManager: AgentRuntimeHookManager | null = null
const compatMirrorWriter = createCompatMirrorWriter({ write: writeCompatMirrorNow, delayMs: 200 })

function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function buildHideTasksMenuItem(): MenuItemConstructorOptions {
  return {
    label: 'Hide Tasks',
    type: 'checkbox',
    checked: Boolean(store.get('hideTasks', false)),
    click: () => {
      setHideTasksValue(!Boolean(store.get('hideTasks', false)))
    },
  }
}

function buildTrayMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Character', click: () => { if (ballWin) { ballWin.show() } else { createBallWindow() } } },
    { label: 'Hide Character', click: () => { hidePetWindow() } },
    { type: 'separator' },
    { label: 'Settings', click: () => createMainWindow() },
    buildHideTasksMenuItem(),
    { type: 'separator' },
    { label: 'Check for Updates', click: () => { void performUpdateCheck(true) } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]
}

function setHideTasksValue(next: boolean): void {
  store.set('hideTasks', next)
  broadcastToAllWindows('config:changed', { ...store.store })
  if (tray) {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()))
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

let lastIgnoreMouseState: boolean | null = null
function syncPetMouseMode(): void {
  if (!ballWin || ballWin.isDestroyed()) return

  const shouldStayInteractive = petHoverLock || petContextMenuOpen || isCursorInPetHitArea()
  const ignore = !shouldStayInteractive

  // 只在状态真的变化时调 setIgnoreMouseEvents，避免每 80ms 重复调用触发透明窗合成器重绘
  if (ignore === lastIgnoreMouseState) return
  lastIgnoreMouseState = ignore

  ballWin.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
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

function resolveHookResourcesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'hooks')
  }
  return join(__dirname, '..', '..', 'resources', 'hooks')
}

function resolveCompatMirrorPath(): string {
  return join(app.getPath('home'), '.soulidity', 'agent-status.json')
}

function writeCompatMirrorNow(status: AgentStatusFile): void {
  const targetPath = resolveCompatMirrorPath()
  const serialized = `${JSON.stringify(status, null, 2)}\n`
  if (serialized === compatMirrorSignature) return
  compatMirrorSignature = serialized

  try {
    const targetDir = join(app.getPath('home'), '.soulidity')
    const tmpPath = `${targetPath}.${process.pid}.tmp`
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(tmpPath, serialized, 'utf8')
    renameSync(tmpPath, targetPath)
  } catch (error) {
    console.warn('[main] failed to write agent compat mirror:', error)
  }
}

function mergeAgentStatuses(
  runtimeStatus: AgentStatusFile | null,
  monitorStatus: AgentStatusFile | null,
): AgentStatusFile | null {
  if (!runtimeStatus && !monitorStatus) return null

  const sessions = {
    ...(runtimeStatus?.sessions ?? {}),
  }

  if (monitorStatus) {
    for (const [sessionId, session] of Object.entries(monitorStatus.sessions)) {
      if (session.source === 'monitor') {
        sessions[sessionId] = session
      }
    }
  }

  return {
    version: 1,
    lastUpdated: Date.now(),
    sessions,
  }
}

function notifyCliStatus(status: AgentStatusFile): void {
  const signature = createAgentStatusSignature(status)
  if (signature === publishedStatusSignature) return
  publishedStatusSignature = signature

  publishAgentStatus(status)

  const now = Date.now()
  const agentEvents = derivePetAgentEvents(lastAgentStatus, status, {
    now,
    terminalGraceMs: CLI_TERMINAL_GRACE_MS,
  })
  lastAgentStatus = status

  for (const event of agentEvents) {
    broadcastToAllWindows('agent-event', event)
  }

  if (moodGraceTimer) {
    clearTimeout(moodGraceTimer)
    moodGraceTimer = null
  }

  const aggregateStatus = deriveAggregateStatus(status, {
    now,
    terminalGraceMs: CLI_TERMINAL_GRACE_MS,
  })
  moodService.notifyCliStatusChanged(aggregateStatus)

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
}

function publishMergedAgentStatus(): void {
  const merged = mergeAgentStatuses(runtimeCompatStatus, monitorFallbackStatus)
  if (!merged) return
  notifyCliStatus(merged)
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
  // Reset per-window cache so the first syncPetMouseMode() on the new BrowserWindow
  // always issues setIgnoreMouseEvents(), instead of skipping based on a stale value
  // left over from a previous ballWin instance (e.g. tray "Show Character" after close).
  lastIgnoreMouseState = null
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
      ...SECURE_WINDOW_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    }
  })
  guardWindowNavigation(ballWin)

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

  // Surface renderer / preload failures into the main-process log so a
  // silently-broken pet window (e.g. preload throws, renderer process dies)
  // is still discoverable from `pnpm dev` output without opening devtools.
  ballWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[ball] did-fail-load', { errorCode, errorDescription, validatedURL })
  })
  ballWin.webContents.on('render-process-gone', (_event, details) => {
    console.error('[ball] render-process-gone', details)
  })
  ballWin.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[ball] preload-error', preloadPath, error?.message ?? error)
  })

  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    ballWin.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // macOS quirk: a transparent + alwaysOnTop + skipTaskbar BrowserWindow that
    // is created with `show: false` and revealed via `ready-to-show` can land in
    // a "composited but never painted" state — `isVisible()` reports true but
    // the window does not appear in `System Events`' window list and is not
    // drawn on screen. Opening devtools in detach mode forces a first paint and
    // unblocks the compositor. Dev-only; production build does not need it
    // because packaged Electron exercises a different paint path.
    ballWin.webContents.openDevTools({ mode: 'detach' })
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

// Write-mode approval gate. The renderer can freely call `task:execute`,
// but the main process will only honor `executionMode: 'write'` when the
// caller presents a token minted here after an OS-level confirmation
// dialog. The token also pins the allowed file list, so a malicious
// renderer cannot widen the write scope via cwd/filePaths.
ipcMain.handle('task:request-write-approval', async (_event, payload: {
  filePaths: unknown
  agent?: unknown
  instruction?: unknown
}) => {
  const rawFilePaths = Array.isArray(payload?.filePaths)
    ? payload.filePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []
  if (rawFilePaths.length === 0) {
    return { ok: false as const, reason: 'invalid-paths' as const }
  }

  const agent = typeof payload?.agent === 'string' ? payload.agent : ''
  if (agent !== 'claude' && agent !== 'codex') {
    return { ok: false as const, reason: 'invalid-paths' as const }
  }
  const instruction = typeof payload?.instruction === 'string' ? payload.instruction : ''

  // Fail closed before opening any dialog if the instruction is too large to
  // display in full. The approval surfaces must show the exact string the
  // token will bind; any silent truncation would let a malicious renderer
  // hide a destructive suffix after a benign-looking preamble.
  if (instruction.trim().length > MAX_APPROVED_INSTRUCTION_LENGTH) {
    return { ok: false as const, reason: 'instruction-too-long' as const }
  }

  // Canonicalize the file list BEFORE showing it to the user. The approval
  // token later binds the `path.resolve(...)`'d form (see
  // `normalizeFilePaths` inside `createWriteApprovalToken`), so a raw
  // renderer-supplied relative path such as `../../private/secret.txt`
  // would otherwise render verbatim in the dialog while the token
  // authorized an unrelated absolute target. Dedupe + sort as well so the
  // displayed list matches exactly what `normalizeFilePaths` produces and
  // what `executeTask` compares against at launch time.
  const canonicalFilePaths = Array.from(
    new Set(rawFilePaths.map((p) => resolvePath(p))),
  ).sort()

  // Compute the effective write scope the child process will actually
  // receive. For Codex `--sandbox workspace-write` this is the real trust
  // surface (not the file list) because the sandbox operates at directory
  // granularity, so the dialog must name the directory Codex will be
  // allowed to mutate. Fail closed before opening any dialog if the
  // resolved sandbox root is unsafe (e.g. `/`, `/Users`) instead of
  // showing an approval surface whose token mint will be rejected after
  // the user has already clicked approve.
  const sandboxRoot = resolveApprovedSandboxRoot(canonicalFilePaths)
  if (!isSafeSandboxRoot(sandboxRoot)) {
    return { ok: false as const, reason: 'invalid-paths' as const }
  }

  const senderWindow = BrowserWindow.fromWebContents(_event.sender)
  const parentWindow = senderWindow ?? BrowserWindow.getFocusedWindow() ?? mainWin ?? ballWin
  if (!parentWindow) {
    return { ok: false as const, reason: 'no-window' as const }
  }

  const filesSummary = canonicalFilePaths.map((p) => `• ${p}`).join('\n')
  // Codex runs `codex exec --sandbox workspace-write` from `sandboxRoot`,
  // so the OS-level write capability the approval grants is the whole
  // directory tree rooted there, not just the listed files. Claude is
  // constrained to the file list at the prompt layer, but still runs
  // with `--dangerously-skip-permissions` (see T-016), so the same root
  // remains the effective trust surface. Spell it out — the user must
  // see that they are authorizing directory-level write access.
  const scopeSummary = agent === 'codex'
    ? `\n\nCodex will have workspace-write access to the entire directory:\n${sandboxRoot}`
    : `\n\nClaude will be asked to stay within the files above. Effective write root:\n${sandboxRoot}`
  // Show the exact instruction that will be bound into the approval token.
  // Do NOT slice here: the dialog is the last chance for the user to see the
  // full text they are authorizing. `createWriteApprovalToken` already caps
  // the length at `MAX_APPROVED_INSTRUCTION_LENGTH` so the detail area cannot
  // overflow what every supported OS dialog can render.
  const instructionDetail = instruction.trim()

  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'warning',
    buttons: ['Deny', 'Approve write access'],
    defaultId: 0,
    cancelId: 0,
    title: 'Allow write access?',
    message: `Allow ${agent} to modify these files?`,
    detail: `Files:\n${filesSummary}${scopeSummary}${instructionDetail ? `\n\nInstruction:\n${instructionDetail}` : ''}`,
    noLink: true,
  })

  if (response !== 1) {
    return { ok: false as const, reason: 'denied' as const }
  }

  const token = createWriteApprovalToken({
    filePaths: canonicalFilePaths,
    agent,
    instruction,
  })
  if (!token) {
    // Either (a) the approved file set does not share a safe sandbox root
    // (e.g., files span `/Users/...` and `/tmp/...`, collapsing the Codex
    // workspace-write cwd to `/`), or (b) the instruction exceeds the
    // displayable cap. Fail closed rather than silently minting a token
    // whose scope or text might not match what the user saw in the dialog.
    if (instruction.trim().length > MAX_APPROVED_INSTRUCTION_LENGTH) {
      return { ok: false as const, reason: 'instruction-too-long' as const }
    }
    return { ok: false as const, reason: 'invalid-paths' as const }
  }
  return { ok: true as const, token }
})

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
  const status = buildUpdateErrorStatus(err, currentUpdateStatus.version)
  if (status.state === 'not-available') {
    console.warn('[updater] release metadata missing, treating as no update')
  }
  setUpdateStatus(status)
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
    if (isMissingLatestReleaseAssetError(err)) {
      if (showNoUpdateDialog) {
        dialog.showMessageBox({ message: 'You are on the latest version.', type: 'info' }).catch(() => {})
      }
      return { available: false }
    }

    const error = toUpdateErrorMessage(err)
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
  if (mainWin) {
    // The window may be created with `show: false` waiting on ready-to-show, or
    // minimized / occluded. `focus()` alone is a no-op while hidden, which is
    // why repeated Settings clicks looked like nothing happened — they were all
    // early-returning here. Restore + show forces it visible on every click.
    if (mainWin.isMinimized()) mainWin.restore()
    if (!mainWin.isVisible()) mainWin.show()
    mainWin.focus()
    return
  }

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
    webPreferences: {
      ...SECURE_WINDOW_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    }
  })
  guardWindowNavigation(mainWin)

  mainWin.on('ready-to-show', () => mainWin?.show())
  mainWin.on('closed', () => { mainWin = null })

  const mainParam = '?view=main'
  if (process.env['NODE_ENV'] === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    mainWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + mainParam)
  } else {
    mainWin.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=main' })
  }
}

function openMainWindowTab(tab?: 'settings' | 'library' | 'agent' | 'extract'): void {
  createMainWindow()
  if (!mainWin) return

  const sendNavigation = () => {
    if (tab) {
      mainWin?.webContents.send('desktop:navigate-tab', { tab })
    }
    mainWin?.show()
    mainWin?.focus()
  }

  if (mainWin.webContents.isLoadingMainFrame()) {
    mainWin.webContents.once('did-finish-load', sendNavigation)
  } else {
    sendNavigation()
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
    buildHideTasksMenuItem(),
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

ipcMain.handle('window:open-main-tab', (_event, tab?: 'settings' | 'library' | 'agent' | 'extract') => {
  openMainWindowTab(tab)
})

// ── 配置管理 IPC ──────────────────────────────────────────
ipcMain.handle('config:get', () => ({ ...store.store }))
ipcMain.handle('config:set', (_event, config: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(config)) {
    store.set(key, value)
  }
  broadcastToAllWindows('config:changed', { ...store.store })
})

// ── 设备绑定 IPC ──────────────────────────────────────────
const WEB_BASE_URL = getDesktopWebBaseUrl()

// Wire agent-api-key-store's rotation fetcher to the configured web URL.
// Tests that import agent-api-key-store directly inject their own fetcher;
// the main process binds it once here so `rotateAgentApiKey()` works.
configureAgentApiKeyStoreFetcher(async (pathname, init) => {
  const response = await fetch(`${WEB_BASE_URL}${pathname}`, init)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
})

function getLocalDesktopRuntimeConfig() {
  return {
    suiNetwork: process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'mainnet',
  }
}

type RemoteDesktopRuntimeConfig = {
  suiNetwork: string
  desktopWalletAuthReady: boolean
  walletAuthMessage: string | null
}

type DesktopRuntimeConfigResponse = {
  suiNetwork: string
  webBaseUrl: string
  authReady: boolean
  authBlocker: string | null
}

const DESKTOP_COVER_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

function inferDesktopCoverMimeType(filePath: string) {
  return DESKTOP_COVER_MIME_MAP[extname(filePath).toLowerCase()] ?? null
}

function bytesToDataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

async function fetchDesktopRuntimeConfigFromWeb(): Promise<{
  config: RemoteDesktopRuntimeConfig | null
  error: string | null
}> {
  const pathname = '/api/desktop/runtime-config'

  try {
    const response = await fetch(`${WEB_BASE_URL}${pathname}`)
    const config = await readJsonOrThrow<RemoteDesktopRuntimeConfig>(
      response,
      'Fetch desktop runtime config',
      pathname,
    )
    return {
      config,
      error: null,
    }
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Failed to fetch desktop runtime config.',
    }
  }
}

function buildDesktopRuntimeConfigResponse(
  localConfig: ReturnType<typeof getLocalDesktopRuntimeConfig>,
  remoteRuntimeConfig: RemoteDesktopRuntimeConfig | null,
  remoteError: string | null,
): DesktopRuntimeConfigResponse {
  const suiNetwork = remoteRuntimeConfig?.suiNetwork?.trim() || localConfig.suiNetwork

  if (remoteRuntimeConfig?.desktopWalletAuthReady) {
    return {
      suiNetwork,
      webBaseUrl: WEB_BASE_URL,
      authReady: true,
      authBlocker: null,
    }
  }

  const authBlocker = remoteError
    ?? remoteRuntimeConfig?.walletAuthMessage
    ?? 'The connected web deployment is not ready for desktop wallet auth yet.'

  return {
    suiNetwork,
    webBaseUrl: WEB_BASE_URL,
    authReady: false,
    authBlocker,
  }
}

function getRequiredDesktopToken() {
  const token = loadDesktopToken()
  if (!token) {
    throw new Error('Desktop auth token is missing. Link this desktop again from Settings.')
  }

  return token
}

async function readJsonOrThrow<T>(response: Response, action: string, pathname: string) {
  return readDesktopJsonResponse<T>(response, {
    action,
    baseUrl: WEB_BASE_URL,
    pathname,
  })
}

async function fetchDesktopJson<T>(pathname: string, init: RequestInit = {}, action = 'Desktop request') {
  const token = getRequiredDesktopToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${WEB_BASE_URL}${pathname}`, {
    ...init,
    headers,
  })

  return readJsonOrThrow<T>(response, action, pathname)
}

// `device:poll` per-deviceCode failure counter. Tracked in-process so a retry
// budget is enforced for the same device session without leaking between
// distinct sessions. Cleared on confirmed-success, expiry, invalid_code, or
// after the failure cap is hit.
const devicePollAttempts = new Map<string, number>()

ipcMain.handle('device:start-link', async () => {
  // Main owns the agent identity — never trust a renderer-supplied address.
  // Ensure-generated path: load the existing pet keypair, or generate one.
  let keypair = await loadAgentKeypair()
  if (!keypair) {
    keypair = await generateAgentKeypair()
  }

  // Step 1: ask for a fresh `desktop-link` challenge for our pet address.
  const challengePath = '/api/desktop/device/challenge'
  const challengeRes = await fetch(`${WEB_BASE_URL}${challengePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: keypair.address }),
  })
  const challenge = await readJsonOrThrow<{
    address: string
    nonce: string
    message: string
    expiresAt: string
    domain: string
  }>(challengeRes, 'Request desktop-link challenge', challengePath)

  // Step 2: sign the challenge message inside main with the pet keypair.
  const messageBytes = new TextEncoder().encode(challenge.message)
  const { signature } = await signAgentPersonalMessage(messageBytes)

  // Step 3: hand challenge + signature to /start. 401 → typed signature error.
  const startPath = '/api/desktop/device/start'
  const startRes = await fetch(`${WEB_BASE_URL}${startPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentAddress: keypair.address,
      nonce: challenge.nonce,
      signature,
    }),
  })

  if (startRes.status === 401) {
    throw new Error('desktop-link signature rejected')
  }

  return readJsonOrThrow<{
    deviceCode: string
    userCode: string
    expiresAt: string
    pollInterval: number
  }>(startRes, 'Start desktop link', startPath)
})

ipcMain.handle('device:poll', async (_event, deviceCode: string) => {
  const pathname = '/api/desktop/device/poll'
  const res = await fetch(`${WEB_BASE_URL}${pathname}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  })
  const data = await readJsonOrThrow<RawPollResponse>(
    res,
    'Poll desktop link status',
    pathname,
  )

  const attempts = devicePollAttempts.get(deviceCode) ?? 0
  const { renderer, nextAttempts } = handleDevicePollResponse(data, attempts, {
    storeDesktopToken,
    storeAgentApiKey,
  })

  if (nextAttempts === null) {
    devicePollAttempts.delete(deviceCode)
  } else {
    devicePollAttempts.set(deviceCode, nextAttempts)
  }

  // On confirmed success, broadcast so other windows / floating ball update.
  if (renderer.status === 'confirmed' && typeof renderer.accountId === 'string') {
    broadcastToAllWindows('desktop-auth:changed', {
      hasToken: true,
      accountId: renderer.accountId,
    })
  }

  return renderer
})

ipcMain.handle('device:get-link-url', () => `${WEB_BASE_URL}/desktop/link`)

// ── Desktop Auth ─────────────────────────────────────────
ipcMain.handle('desktop-auth:status', () => getDesktopAuthStatus())
ipcMain.handle('desktop-auth:unlink', async () => {
  // Tear down server-side `DesktopPet` + bound agent `Member` first via
  // `/api/desktop/me/revoke`, then clear the desktop token + agent API key
  // locally. The agent keypair is intentionally preserved — `revokeDesktopPet`
  // keeps the `WalletBinding` so a subsequent device-link reuses the same
  // agent address. Callers that want a fresh agent identity must use
  // `agent:reset-identity` instead.
  //
  // Target the *issuing* web base URL when we know it: if the user repointed
  // `SOULIDITY_WEB_URL` after linking, the currently-configured `WEB_BASE_URL`
  // is a different server that has no record of this token, so revoke would
  // 401 ("already gone") and the original server's pet would be orphaned.
  // Tokens saved before webBaseUrl tracking existed fall back to the current
  // base URL — that's the only address callers had at the time anyway.
  const revokeBaseUrl = loadDesktopTokenIssuingWebBaseUrl() ?? WEB_BASE_URL
  const result = await performAgentUnlink({
    loadDesktopToken,
    fetcher: async (pathname, init) => {
      const response = await fetch(`${revokeBaseUrl}${pathname}`, init)
      const body = await response.json().catch(() => null)
      return { status: response.status, body }
    },
    clearDesktopToken,
    clearAgentApiKey,
  })

  if (result.ok) {
    broadcastToAllWindows('desktop-auth:changed', { hasToken: false, accountId: null })
  }

  return result
})

ipcMain.handle('agent:rotate-api-key', async () => {
  // Delegates to T7's single-flight rotation. Do not log the apiKey.
  return rotateAgentApiKey()
})

ipcMain.handle('agent:get-api-key-status', () => {
  // Renderer-safe view of the local agent API key state. Never returns the
  // plaintext `sk-*`; only metadata that's safe to surface in Settings.
  const status = getAgentApiKeyStatus()
  return { hasKey: status.hasKey, storedAt: status.storedAt }
})

ipcMain.handle('agent:reset-identity', async () => {
  // Same issuing-URL routing as `desktop-auth:unlink`: the revoke must hit
  // the server that issued the token, otherwise a user who repointed
  // `SOULIDITY_WEB_URL` between sessions would silently orphan their pet on
  // the original server while the current server's reset path 401s its way
  // through `isAlreadyRevokedStatus` and clears local state anyway.
  const revokeBaseUrl = loadDesktopTokenIssuingWebBaseUrl() ?? WEB_BASE_URL
  const result = await performAgentResetIdentity({
    loadDesktopToken,
    fetcher: async (pathname, init) => {
      const response = await fetch(`${revokeBaseUrl}${pathname}`, init)
      const body = await response.json().catch(() => null)
      return { status: response.status, body }
    },
    clearDesktopToken,
    clearAgentApiKey,
    clearAgentKeypair,
  })

  if (result.ok) {
    broadcastToAllWindows('desktop-auth:changed', { hasToken: false, accountId: null })
    broadcastToAllWindows('agent-keypair:changed', { hasKeypair: false })
  }

  return result
})
ipcMain.handle('desktop-auth:runtime-config', async () => {
  const localConfig = getLocalDesktopRuntimeConfig()
  const remoteRuntimeConfig = await fetchDesktopRuntimeConfigFromWeb()
  return buildDesktopRuntimeConfigResponse(localConfig, remoteRuntimeConfig.config, remoteRuntimeConfig.error)
})
ipcMain.handle('desktop-auth:me', async () => {
  return fetchDesktopJson('/api/desktop/me', {}, 'Fetch desktop profile')
})

// ── Extract Draft Persistence ────────────────────────────
ipcMain.handle('desktop:create-draft:load', () => loadExtractSoulDraft())
ipcMain.handle('desktop:create-draft:save', (_event, draft: ExtractSoulDraft) => {
  saveExtractSoulDraft(draft)
})
ipcMain.handle('desktop:create-draft:clear', () => {
  clearExtractSoulDraft()
})
ipcMain.handle('desktop:create-draft:pick-cover-image', async () => {
  const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWin ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const dialogOptions: OpenDialogOptions = {
    title: 'Choose Cover Image',
    properties: ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
      },
    ],
  }
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  const mimeType = inferDesktopCoverMimeType(filePath)
  if (!mimeType) {
    throw new Error('Cover image must be PNG, JPEG, WebP, or SVG.')
  }

  const bytes = readFileSync(filePath)
  return {
    dataUrl: bytesToDataUrl(bytes, mimeType),
    fileName: basename(filePath),
    mimeType,
  }
})

// ── Soul Download + Active Persona ──────────────────────
ipcMain.handle('soul:download', async (_event, params: { catalogId: string }) => {
  const token = loadDesktopToken()
  return downloadSoulPersona(
    { catalogId: params.catalogId },
    {
      webBaseUrl: WEB_BASE_URL,
      desktopToken: token,
      onProgress: (progress) => broadcastToAllWindows('soul:download-progress', progress),
    },
  )
})

ipcMain.handle('soul:fetch-manifest', async (_event, params: { catalogId: string; viewer?: string | null }) => {
  const token = loadDesktopToken()
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const trimmedViewer = typeof params.viewer === 'string' ? params.viewer.trim() : ''
  const suffix = trimmedViewer ? `?viewer=${encodeURIComponent(trimmedViewer)}` : ''

  return fetchDesktopJson(
    `/api/desktop/catalog/${encodeURIComponent(params.catalogId)}${suffix}`,
    { headers },
    'Fetch desktop persona manifest',
  )
})

ipcMain.handle('soul:cache-persona', async (_event, params: {
  catalogId: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  version: string
  spriteBytes: Uint8Array
  configJson: string
}) => {
  const spriteId = `catalog-${params.catalogId}`
  cacheSprite(
    spriteId,
    {
      sprite: Buffer.from(params.spriteBytes),
      config: params.configJson,
    },
    {
      spriteId,
      source: 'desktop-catalog',
      version: params.version,
      catalogSourceType: params.sourceType,
      catalogSourceRef: params.sourceRef,
    },
  )

  return { catalogId: params.catalogId, spriteId }
})

ipcMain.handle('soul:set-active', async (_event, params: { catalogId: string; sourceType: string; sourceRef: string } | null) => {
  if (!params) {
    store.delete('activePersonaCatalogId')
    store.delete('lastAppliedPersona')

    // Sync reset to server so remote state is cleared
    const token = loadDesktopToken()
    if (token) {
      try {
        await fetch(`${WEB_BASE_URL}/api/desktop/me/active-persona`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sourceType: null, sourceRef: null }),
        })
      } catch { /* offline — local cache is fallback */ }
    }

    broadcastToAllWindows('persona-changed', null)
    return
  }

  const cached = getCachedSprite(`catalog-${params.catalogId}`)
  if (!cached) throw new Error('Persona not cached — download it first')

  let spriteConfig = null
  try {
    const configRaw = readFileSync(cached.configPath, 'utf-8')
    spriteConfig = JSON.parse(configRaw)
    // Resolve src to absolute file URL
    if (cached.spritePath) {
      spriteConfig.src = `file://${cached.spritePath}`
    }
  } catch {
    throw new Error('Failed to load cached persona config')
  }

  store.set('activePersonaCatalogId', params.catalogId)
  store.set('lastAppliedPersona', { catalogId: params.catalogId, spriteConfig })

  // Sync to web if token available — use the catalog entry's real sourceType/sourceRef
  const token = loadDesktopToken()
  if (token) {
    try {
      const res = await fetch(`${WEB_BASE_URL}/api/desktop/me/active-persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceType: params.sourceType, sourceRef: params.sourceRef }),
      })
      if (!res.ok) {
        console.warn(`[main] active-persona sync failed: ${res.status} ${res.statusText}`)
      }
    } catch { /* offline — local cache is fallback */ }
  }

  broadcastToAllWindows('persona-changed', { spriteConfig })
})

ipcMain.handle('soul:get-active', () => {
  const saved = store.get('lastAppliedPersona') as { catalogId?: string; spriteConfig?: unknown } | undefined
  if (saved?.spriteConfig) {
    return { catalogId: saved.catalogId, spriteConfig: saved.spriteConfig }
  }
  return null
})

ipcMain.handle('soul:fetch-catalog', async (_event, params: { page: number; pageSize: number }) => {
  const pathname = `/api/desktop/catalog?page=${params.page}&pageSize=${params.pageSize}`
  try {
    const res = await fetch(
      `${WEB_BASE_URL}${pathname}`,
    )
    if (!res.ok) return null
    return await readJsonOrThrow(res, 'Fetch desktop catalog', pathname)
  } catch {
    return null
  }
})

ipcMain.handle('soul:get-my-souls', async () => {
  const token = loadDesktopToken()
  if (!token) return []
  const pathname = '/api/desktop/me/souls'
  try {
    const res = await fetch(`${WEB_BASE_URL}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await readJsonOrThrow<{ souls?: unknown[] }>(res, 'Fetch linked desktop souls', pathname)
    return data.souls ?? []
  } catch {
    return []
  }
})

// ── Session Extraction + Local Create ────────────────────
ipcMain.handle('extraction:scan-sessions', async () => {
  return scanSessions({
    onProgress: (progress: ScanProgress) => broadcastToAllWindows('extraction:scan-progress', progress),
  })
})

ipcMain.handle('extraction:get-openclaw-import-status', async (): Promise<OpenClawImportStatus> => {
  return getOpenClawImportStatus()
})

ipcMain.handle('extraction:get-local-agent-statuses', async (): Promise<LocalExtractAgentStatus[]> => {
  return getLocalExtractAgentStatuses()
})

ipcMain.handle('extraction:import-openclaw-draft', async (_event, input: ImportOpenClawDraftInput) => {
  return importOpenClawDraft(input)
})

ipcMain.handle('extraction:create-local-draft', async (_event, input: CreateLocalExtractDraftInput) => {
  return createLocalExtractDraft(input)
})

ipcMain.handle('extraction:open-web-create', async () => {
  await shell.openExternal(validateOpenExternalUrl(new URL('/create', WEB_BASE_URL).toString()))
})

ipcMain.handle('extraction:start-mint-handoff', async (_event, draft: ExtractSoulDraft) => {
  // Cover image must be a real upload (not the SVG placeholder) before the
  // hand-off — mirrors the product gating on the Mint By Web button. The web
  // server also rejects `image/svg+xml` payloads, so this just turns a slow
  // round-trip rejection into a fast local error.
  if (
    draft.coverImageGenerated
    || !draft.coverImageDataUrl
    || draft.coverImageMimeType === 'image/svg+xml'
  ) {
    throw new Error('Upload a real cover image before starting the mint hand-off.')
  }

  const payload = {
    name: draft.name,
    description: draft.description,
    tags: draft.tags,
    royaltyBps: draft.royaltyBps,
    soulMarkdown: draft.soulMarkdown,
    memoryMarkdown: draft.memoryMarkdown,
    coverImageDataUrl: draft.coverImageDataUrl,
    coverImageFileName: draft.coverImageFileName,
    coverImageMimeType: draft.coverImageMimeType,
    coverImagePrompt: draft.coverImagePrompt,
    characterType: draft.characterType,
    extraDescription: draft.extraDescription,
    skillsArchive: draft.skillsArchive,
  }

  const result = await fetchDesktopJson<{ token: string; expiresAt: string }>(
    '/api/desktop/mint-handoff',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    'Start mint hand-off',
  )

  const url = new URL('/create', WEB_BASE_URL)
  url.searchParams.set('handoff', result.token)
  await shell.openExternal(validateOpenExternalUrl(url.toString()))
})

// ── Shell ─────────────────────────────────────────────────
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  await shell.openExternal(validateOpenExternalUrl(url))
})

// ── Agent wallet + status watcher IPC ──────────────────────
ipcMain.handle('get-current-agent-status', () => getCurrentAgentStatus())
ipcMain.handle('get-current-agent-runtime', () => currentRuntimeSnapshot ?? runtimeController?.getSnapshot() ?? null)
ipcMain.handle('agent:approve-permission', (_event, requestId: string, allowAlways?: boolean) =>
  runtimeController?.approvePermission(requestId, Boolean(allowAlways)) ?? false)
ipcMain.handle('agent:deny-permission', (_event, requestId: string) =>
  runtimeController?.denyPermission(requestId) ?? false)
ipcMain.handle('agent:answer-question', (_event, requestId: string, answer: string) =>
  runtimeController?.answerQuestion(requestId, answer) ?? false)
ipcMain.handle('agent:skip-question', (_event, requestId: string) =>
  runtimeController?.skipQuestion(requestId) ?? false)
ipcMain.handle('hooks:get-install-status', () => runtimeHookManager?.getStatuses() ?? [])
function runHookManagerAction(
  action: 'install' | 'repair' | 'uninstall',
  targets?: SupportedAgentSource[],
) {
  try {
    const statuses = action === 'install'
      ? runtimeHookManager?.installHooks(targets) ?? []
      : action === 'repair'
        ? runtimeHookManager?.repairHooks(targets) ?? []
        : runtimeHookManager?.uninstallHooks(targets) ?? []
    runtimeController?.setHooks(statuses)
    return statuses
  } catch (error) {
    dialog.showErrorBox(
      'Hook Action Failed',
      error instanceof Error ? error.message : String(error),
    )
    const statuses = runtimeHookManager?.getStatuses() ?? []
    runtimeController?.setHooks(statuses)
    return statuses
  }
}
ipcMain.handle('hooks:install', (_event, targets?: SupportedAgentSource[]) => {
  const statuses = runHookManagerAction('install', targets)
  return statuses
})
ipcMain.handle('hooks:repair', (_event, targets?: SupportedAgentSource[]) => {
  const statuses = runHookManagerAction('repair', targets)
  return statuses
})
ipcMain.handle('hooks:uninstall', (_event, targets?: SupportedAgentSource[]) => {
  const statuses = runHookManagerAction('uninstall', targets)
  return statuses
})
ipcMain.handle('generate-agent-keypair', () => generateAgentKeypair())
ipcMain.handle('load-agent-keypair', () => loadAgentKeypair())
ipcMain.handle('export-agent-address', () => exportAgentAddress())
ipcMain.handle('get-secret-storage-status', () => getSecretStorageStatus())
ipcMain.handle('agent:sign-personal-message', (_event, message: Uint8Array | ArrayBuffer) => {
  const bytes = message instanceof Uint8Array ? message : new Uint8Array(message)
  return signAgentPersonalMessage(bytes)
})

// ── System Tray ────────────────────────────────────────────
function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '..', '..', 'resources', 'icon.png')

  const icon = nativeImage.createFromPath(iconPath)
  const resized = icon.resize({ width: 16, height: 16 })

  tray = new Tray(resized)

  tray.setToolTip('Soulidity Desktop Companion')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()))
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
    const dataDir = resolveDataDir()
    const builtinPersona = app.isPackaged
      ? join(process.resourcesPath, 'persona')
      : join(__dirname, '..', '..', 'resources', 'persona')
    if (existsSync(builtinPersona)) {
      prepareBuiltinPersonaTemplates(dataDir, builtinPersona)
    }

    await bootServices(dataDir)
  } catch (err: unknown) {
    console.error('[main] Failed to boot services:', err)
    dialog.showErrorBox(
      'Startup Failed',
      `Services could not start.\n\n${err instanceof Error ? err.message : String(err)}`
    )
    app.quit()
    return
  }

  runtimeController = new AgentRuntimeController()
  runtimeHookManager = new AgentRuntimeHookManager({
    resourcesDir: resolveHookResourcesDir(),
  })
  runtimeController.setHooks(runtimeHookManager.getStatuses())
  runtimeController.subscribe((snapshot) => {
    currentRuntimeSnapshot = snapshot
    runtimeCompatStatus = toAgentStatusFile(snapshot)
    compatMirrorWriter.schedule(runtimeCompatStatus)
    broadcastToAllWindows('agent-runtime-changed', snapshot)
    publishMergedAgentStatus()
  })

  try {
    runtimeTransportServer = await createUnixSocketTransportServer(
      runtimeController,
      getDefaultRuntimeSocketPath(),
    )
  } catch (error) {
    console.error('[main] failed to start agent runtime transport:', error)
    runtimeController.setTransportStatus({
      status: 'error',
      mode: process.platform === 'win32' ? 'disabled' : 'unix-socket',
      endpoint: getDefaultRuntimeSocketPath(),
      lastError: error instanceof Error ? error.message : String(error),
    })
  }

  startStatusWatcher((status) => {
    const serialized = `${JSON.stringify(status, null, 2)}\n`
    if (serialized === compatMirrorSignature) return

    const hasMonitorSessions = Object.values(status.sessions).some((session) => session.source === 'monitor')
    monitorFallbackStatus = hasMonitorSessions ? status : monitorFallbackStatus
    if (hasMonitorSessions) {
      publishMergedAgentStatus()
    }
  })

  startAgentMonitor((status) => {
    monitorFallbackStatus = status
    publishMergedAgentStatus()
  })
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
  compatMirrorWriter.flush()
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
    .then(async () => {
      if (runtimeTransportServer) {
        try {
          await runtimeTransportServer.stop()
        } catch (error) {
          console.warn('[main] failed to stop runtime transport:', error)
        }
        runtimeTransportServer = null
      }
      await shutdownServices()
    })
    .finally(() => {
      clearTimeout(exitTimer)
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  // macOS: 不退出，tray 常驻
  if (process.platform !== 'darwin') app.quit()
})
