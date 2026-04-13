import { contextBridge, ipcRenderer } from 'electron'
import type { PetAgentEvent, PetUpdateStatus } from '@soulidity/shared'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 基础 ──
  ping: (): Promise<string> => ipcRenderer.invoke('ipc:ping'),
  closeWindow: (): void => { ipcRenderer.send('window:close') },
  getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:get'),
  setConfig: (config: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('config:set', config),

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
  onAgentEvent: (callback: (event: PetAgentEvent) => void): (() => void) => {
    const listener = (_event: unknown, event: PetAgentEvent) => callback(event)
    ipcRenderer.on('agent-event', listener)
    return () => { ipcRenderer.removeListener('agent-event', listener) }
  },
  getCurrentAgentStatus: (): Promise<unknown> => ipcRenderer.invoke('get-current-agent-status'),

  // ── Agent wallet ──
  generateAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('generate-agent-keypair'),
  loadAgentKeypair: (): Promise<unknown> => ipcRenderer.invoke('load-agent-keypair'),
  exportAgentAddress: (): Promise<string> => ipcRenderer.invoke('export-agent-address'),
  getSecretStorageStatus: (): Promise<'encrypted' | 'legacy' | 'missing'> =>
    ipcRenderer.invoke('get-secret-storage-status'),

  // ── 设备绑定 ──
  deviceStartLink: (agentAddress: string): Promise<{
    deviceCode: string; userCode: string; expiresAt: string; pollInterval: number
  }> => ipcRenderer.invoke('device:start-link', agentAddress),
  devicePoll: (deviceCode: string): Promise<{
    status: string; accountId?: string; expiresAt?: string | null
  }> => ipcRenderer.invoke('device:poll', deviceCode),
  deviceGetLinkUrl: (): Promise<string> => ipcRenderer.invoke('device:get-link-url'),

  // ── Task 执行 (Claude / Codex) ──
  executeTask: (payload: { agent: string; instruction: string; filePaths?: string[]; cwd?: string }):
    Promise<{ taskId: string; error?: string }> => ipcRenderer.invoke('task:execute', payload),
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
