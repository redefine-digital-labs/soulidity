import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentRuntimeSnapshot,
  CreateLocalExtractDraftInput,
  HookInstallStatus,
  ExtractSoulDraft,
  ImportOpenClawDraftInput,
  LocalExtractAgentStatus,
  OpenClawImportStatus,
  PetAgentEvent,
  PetUpdateStatus,
  SessionScanResult,
  ScanProgress,
  SupportedAgentSource,
  TaskWriteApprovalResult,
} from '@soulidity/shared'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 基础 ──
  ping: (): Promise<string> => ipcRenderer.invoke('ipc:ping'),
  closeWindow: (): void => { ipcRenderer.send('window:close') },
  openMainWindowTab: (tab?: 'settings' | 'library' | 'agent' | 'extract'): Promise<void> =>
    ipcRenderer.invoke('window:open-main-tab', tab),
  onNavigateTab: (callback: (detail: { tab?: string }) => void): (() => void) => {
    const listener = (_event: unknown, detail: { tab?: string }) => callback(detail)
    ipcRenderer.on('desktop:navigate-tab', listener)
    return () => { ipcRenderer.removeListener('desktop:navigate-tab', listener) }
  },
  getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:get'),
  setConfig: (config: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('config:set', config),
  onConfigChanged: (callback: (config: Record<string, unknown>) => void): (() => void) => {
    const listener = (_event: unknown, config: Record<string, unknown>) => callback(config)
    ipcRenderer.on('config:changed', listener)
    return () => { ipcRenderer.removeListener('config:changed', listener) }
  },

  // ── 悬浮球拖拽 ──
  dragStart: (): void => { ipcRenderer.send('drag:start') },
  dragMove: (): void => { ipcRenderer.send('drag:move') },
  dragEnd: (): void => { ipcRenderer.send('drag:end') },
  setIgnoreMouseEvents: (ignore: boolean): void => { ipcRenderer.send('set-ignore-mouse-events', ignore) },
  showContextMenu: (): void => { ipcRenderer.send('contextmenu:show') },
  hidePet: (): void => { ipcRenderer.send('pet:hide') },
  resizePetWindow: (width: number, height: number): void => { ipcRenderer.send('resize-pet-window', width, height) },

  // ── Mood / Greeting / Persona ──
  getMoodSnapshot: (): Promise<unknown> => ipcRenderer.invoke('mood:get'),
  onMoodChanged: (callback: (snapshot: unknown) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: unknown) => callback(snapshot)
    ipcRenderer.on('mood-changed', listener)
    return () => { ipcRenderer.removeListener('mood-changed', listener) }
  },
  moodInteract: (): Promise<void> => ipcRenderer.invoke('mood:interact'),
  moodDragStart: (): Promise<void> => ipcRenderer.invoke('mood:drag-start'),
  moodDragEnd: (): Promise<void> => ipcRenderer.invoke('mood:drag-end'),
  getPersona: (): Promise<{ soul: string | null; user: string | null; context: string | null }> =>
    ipcRenderer.invoke('persona:get'),

  // ── Status watcher ──
  onAgentStatusChanged: (callback: (status: unknown) => void): (() => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status)
    ipcRenderer.on('agent-status-changed', listener)
    return () => { ipcRenderer.removeListener('agent-status-changed', listener) }
  },
  onAgentRuntimeChanged: (callback: (snapshot: AgentRuntimeSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: AgentRuntimeSnapshot) => callback(snapshot)
    ipcRenderer.on('agent-runtime-changed', listener)
    return () => { ipcRenderer.removeListener('agent-runtime-changed', listener) }
  },
  onAgentEvent: (callback: (event: PetAgentEvent) => void): (() => void) => {
    const listener = (_event: unknown, event: PetAgentEvent) => callback(event)
    ipcRenderer.on('agent-event', listener)
    return () => { ipcRenderer.removeListener('agent-event', listener) }
  },
  getCurrentAgentStatus: (): Promise<unknown> => ipcRenderer.invoke('get-current-agent-status'),
  getCurrentAgentRuntime: (): Promise<AgentRuntimeSnapshot | null> => ipcRenderer.invoke('get-current-agent-runtime'),
  approveAgentPermission: (requestId: string, allowAlways = false): Promise<boolean> =>
    ipcRenderer.invoke('agent:approve-permission', requestId, allowAlways),
  denyAgentPermission: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:deny-permission', requestId),
  answerAgentQuestion: (requestId: string, answer: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:answer-question', requestId, answer),
  skipAgentQuestion: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent:skip-question', requestId),
  getHookInstallStatus: (): Promise<HookInstallStatus[]> =>
    ipcRenderer.invoke('hooks:get-install-status'),
  installHooks: (targets?: SupportedAgentSource[]): Promise<HookInstallStatus[]> =>
    ipcRenderer.invoke('hooks:install', targets),
  repairHooks: (targets?: SupportedAgentSource[]): Promise<HookInstallStatus[]> =>
    ipcRenderer.invoke('hooks:repair', targets),
  uninstallHooks: (targets?: SupportedAgentSource[]): Promise<HookInstallStatus[]> =>
    ipcRenderer.invoke('hooks:uninstall', targets),

  // ── Agent wallet (the unified local Sui identity for this desktop) ──
  generateAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('generate-agent-keypair'),
  loadAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('load-agent-keypair'),
  exportAgentAddress: (): Promise<string> => ipcRenderer.invoke('export-agent-address'),
  getSecretStorageStatus: (): Promise<'encrypted' | 'legacy' | 'missing'> =>
    ipcRenderer.invoke('get-secret-storage-status'),
  agentSignPersonalMessage: (message: Uint8Array): Promise<{ signature: string }> =>
    ipcRenderer.invoke('agent:sign-personal-message', message),

  // ── 设备绑定 ──
  deviceStartLink: (): Promise<{
    deviceCode: string; userCode: string; expiresAt: string; pollInterval: number
  }> => ipcRenderer.invoke('device:start-link'),
  devicePoll: (deviceCode: string): Promise<{
    status: string
    accountId?: string
    error?: string
    expiresAt?: string | null
    pollInterval?: number
  }> => ipcRenderer.invoke('device:poll', deviceCode),
  deviceGetLinkUrl: (): Promise<string> => ipcRenderer.invoke('device:get-link-url'),

  // ── Desktop auth ──
  getDesktopAuthStatus: (): Promise<{ hasToken: boolean; accountId: string | null }> =>
    ipcRenderer.invoke('desktop-auth:status'),
  unlinkDesktopDevice: (): Promise<
    { ok: true; remoteRevoked: boolean } | { ok: false; error: string; status?: number }
  > => ipcRenderer.invoke('desktop-auth:unlink'),
  // Renderer never sees the rotated `sk-*` key — it's stored via safeStorage in main.
  agentRotateApiKey: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('agent:rotate-api-key'),
  // Sanitized status — `hasKey` boolean + `storedAt` epoch ms; no plaintext.
  agentGetApiKeyStatus: (): Promise<{ hasKey: boolean; storedAt: number | null }> =>
    ipcRenderer.invoke('agent:get-api-key-status'),
  // Reset pet identity: server revoke first, then wipe local credentials + keypair.
  agentResetIdentity: (): Promise<
    { ok: true; remoteRevoked: boolean } | { ok: false; error: string; status?: number }
  > => ipcRenderer.invoke('agent:reset-identity'),
  getDesktopRuntimeConfig: (): Promise<{
    suiNetwork: string
    webBaseUrl: string
    authReady: boolean
    authBlocker: string | null
  }> =>
    ipcRenderer.invoke('desktop-auth:runtime-config'),
  getDesktopMe: (): Promise<unknown> =>
    ipcRenderer.invoke('desktop-auth:me'),

  // ── Desktop create draft ──
  'desktop:create-draft:load': (): Promise<ExtractSoulDraft | null> =>
    ipcRenderer.invoke('desktop:create-draft:load'),
  'desktop:create-draft:save': (draft: ExtractSoulDraft): Promise<void> =>
    ipcRenderer.invoke('desktop:create-draft:save', draft),
  'desktop:create-draft:clear': (): Promise<void> =>
    ipcRenderer.invoke('desktop:create-draft:clear'),
  'desktop:create-draft:pick-cover-image': (): Promise<{ dataUrl: string; fileName: string; mimeType: string } | null> =>
    ipcRenderer.invoke('desktop:create-draft:pick-cover-image'),

  // ── Soul download + active persona ──
  soulDownload: (params: { catalogId: string }): Promise<{ catalogId: string; spriteId: string } | { error: string }> =>
    ipcRenderer.invoke('soul:download', params),
  soulFetchManifest: (params: { catalogId: string; viewer?: string | null }): Promise<unknown> =>
    ipcRenderer.invoke('soul:fetch-manifest', params),
  soulCachePersona: (params: {
    catalogId: string
    sourceType: 'starter' | 'soul'
    sourceRef: string
    version: string
    spriteBytes: Uint8Array
    configJson: string
  }): Promise<{ catalogId: string; spriteId: string }> =>
    ipcRenderer.invoke('soul:cache-persona', params),
  onDownloadProgress: (callback: (progress: unknown) => void): (() => void) => {
    const listener = (_event: unknown, progress: unknown) => callback(progress)
    ipcRenderer.on('soul:download-progress', listener)
    return () => { ipcRenderer.removeListener('soul:download-progress', listener) }
  },
  soulSetActive: (params: { catalogId: string; sourceType: string; sourceRef: string } | null): Promise<void> =>
    ipcRenderer.invoke('soul:set-active', params),
  soulGetActive: (): Promise<{ catalogId?: string; spriteConfig?: unknown } | null> =>
    ipcRenderer.invoke('soul:get-active'),
  onPersonaChanged: (callback: (data: unknown) => void): (() => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('persona-changed', listener)
    return () => { ipcRenderer.removeListener('persona-changed', listener) }
  },
  soulFetchCatalog: (params: { page: number; pageSize: number }): Promise<unknown> =>
    ipcRenderer.invoke('soul:fetch-catalog', params),
  soulGetMySouls: (): Promise<unknown[]> =>
    ipcRenderer.invoke('soul:get-my-souls'),

  // ── Session extraction + local create ──
  'extraction:scan-sessions': (): Promise<SessionScanResult[]> =>
    ipcRenderer.invoke('extraction:scan-sessions'),
  'extraction:get-openclaw-import-status': (): Promise<OpenClawImportStatus> =>
    ipcRenderer.invoke('extraction:get-openclaw-import-status'),
  'extraction:get-local-agent-statuses': (): Promise<LocalExtractAgentStatus[]> =>
    ipcRenderer.invoke('extraction:get-local-agent-statuses'),
  'extraction:import-openclaw-draft': (input: ImportOpenClawDraftInput): Promise<ExtractSoulDraft> =>
    ipcRenderer.invoke('extraction:import-openclaw-draft', input),
  'extraction:create-local-draft': (input: CreateLocalExtractDraftInput): Promise<ExtractSoulDraft> =>
    ipcRenderer.invoke('extraction:create-local-draft', input),
  'extraction:open-web-create': (): Promise<void> =>
    ipcRenderer.invoke('extraction:open-web-create'),
  'extraction:start-mint-handoff': (draft: ExtractSoulDraft): Promise<void> =>
    ipcRenderer.invoke('extraction:start-mint-handoff', draft),
  'extraction:scan-progress': (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('extraction:scan-progress', listener)
    return () => { ipcRenderer.removeListener('extraction:scan-progress', listener) }
  },

  // ── Shell ──
  'shell:open-external': (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-external', url),

  // ── Task 执行 (Claude / Codex) ──
  executeTask: (payload: {
    agent: 'claude' | 'codex'
    instruction: string
    filePaths?: string[]
    cwd?: string
    executionMode?: 'read' | 'write'
    approvalToken?: string
  }):
    Promise<{ taskId: string; error?: string }> => ipcRenderer.invoke('task:execute', payload),
  requestWriteApproval: (payload: {
    filePaths: string[]
    agent?: 'claude' | 'codex'
    instruction?: string
  }): Promise<TaskWriteApprovalResult> =>
    ipcRenderer.invoke('task:request-write-approval', payload),
  cancelTask: (taskId: string): void => { ipcRenderer.send('task:cancel', taskId) },
  listActiveTasks: (): Promise<string[]> => ipcRenderer.invoke('task:list-active'),
  onTaskOutput: (callback: (data: { taskId: string; text: string }) => void): (() => void) => {
    const listener = (_event: unknown, data: { taskId: string; text: string }) => callback(data)
    ipcRenderer.on('task:output', listener)
    return () => { ipcRenderer.removeListener('task:output', listener) }
  },
  onTaskComplete: (callback: (data: { taskId: string; success: boolean; error?: string }) => void): (() => void) => {
    const listener = (_event: unknown, data: { taskId: string; success: boolean; error?: string }) => callback(data)
    ipcRenderer.on('task:complete', listener)
    return () => { ipcRenderer.removeListener('task:complete', listener) }
  },

  // ── 本地缓存 ──
  cacheHasSprite: (spriteId: string): Promise<boolean> => ipcRenderer.invoke('cache:has-sprite', spriteId),
  cacheGetSprite: (spriteId: string): Promise<unknown> => ipcRenderer.invoke('cache:get-sprite', spriteId),
  cacheRemoveSprite: (spriteId: string): Promise<boolean> => ipcRenderer.invoke('cache:remove-sprite', spriteId),
  cachePrune: (maxAgeMs: number): Promise<number> => ipcRenderer.invoke('cache:prune', maxAgeMs),
  cacheStats: (): Promise<{ totalSprites: number; totalBytes: number }> => ipcRenderer.invoke('cache:stats'),
  cacheList: (): Promise<unknown[]> => ipcRenderer.invoke('cache:list'),

  // ── 自动更新 ──
  updaterCheck: (): Promise<{ available: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('updater:check'),
  getUpdateStatus: (): Promise<PetUpdateStatus> => ipcRenderer.invoke('updater:status'),
  onUpdateStatus: (callback: (status: PetUpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: PetUpdateStatus) => callback(status)
    ipcRenderer.on('update-status', listener)
    return () => { ipcRenderer.removeListener('update-status', listener) }
  },
  updaterDownload: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('updater:download'),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
})
