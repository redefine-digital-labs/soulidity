export {}

import type { PetAgentEvent, PetUpdateStatus } from '@soulidity/shared'

declare global {
  interface Window {
    electronAPI: {
      // ── 基础 ──
      ping: () => Promise<string>
      closeWindow: () => void
      getConfig: () => Promise<Record<string, unknown>>
      setConfig: (config: Record<string, unknown>) => Promise<void>

      // ── 悬浮球 ──
      dragStart: () => void
      dragMove: () => void
      dragEnd: () => void
      setIgnoreMouseEvents: (ignore: boolean) => void
      showContextMenu: () => void
      hidePet: () => void
      resizePetWindow: (width: number, height: number) => void

      // ── Mood / Greeting / Persona ──
      getMoodSnapshot: () => Promise<unknown>
      onMoodChanged: (callback: (snapshot: unknown) => void) => () => void
      moodInteract: () => Promise<void>
      moodDragStart: () => Promise<void>
      moodDragEnd: () => Promise<void>
      getPersona: () => Promise<{ soul: string | null; user: string | null; context: string | null }>

      // ── Status watcher ──
      onAgentStatusChanged: (callback: (status: unknown) => void) => () => void
      onAgentEvent: (callback: (event: PetAgentEvent) => void) => () => void
      getCurrentAgentStatus: () => Promise<unknown>

      // ── Agent wallet ──
      generateAgentKeypair: () => Promise<unknown>
      loadAgentKeypair: () => Promise<unknown>
      exportAgentAddress: () => Promise<string>
      getSecretStorageStatus: () => Promise<'encrypted' | 'legacy' | 'missing'>

      // ── 设备绑定 ──
      deviceStartLink: (agentAddress: string) => Promise<{
        deviceCode: string; userCode: string; expiresAt: string; pollInterval: number
      }>
      devicePoll: (deviceCode: string) => Promise<{
        status: string; accountId?: string; expiresAt?: string | null
      }>
      deviceGetLinkUrl: () => Promise<string>

      // ── Task 执行 ──
      executeTask: (payload: { agent: string; instruction: string; filePaths?: string[]; cwd?: string }) =>
        Promise<{ taskId: string; error?: string }>
      cancelTask: (taskId: string) => void
      listActiveTasks: () => Promise<string[]>
      onTaskOutput: (callback: (data: { taskId: string; text: string }) => void) => () => void
      onTaskComplete: (callback: (data: { taskId: string; success: boolean; error?: string }) => void) => () => void

      // ── 本地缓存 ──
      cacheHasSprite: (spriteId: string) => Promise<boolean>
      cacheGetSprite: (spriteId: string) => Promise<unknown>
      cacheRemoveSprite: (spriteId: string) => Promise<boolean>
      cachePrune: (maxAgeMs: number) => Promise<number>
      cacheStats: () => Promise<{ totalSprites: number; totalBytes: number }>
      cacheList: () => Promise<unknown[]>

      // ── 自动更新 ──
      updaterCheck: () => Promise<{ available: boolean; version?: string; error?: string }>
      getUpdateStatus: () => Promise<PetUpdateStatus>
      onUpdateStatus: (callback: (status: PetUpdateStatus) => void) => () => void
      updaterDownload: () => Promise<{ ok: boolean; error?: string }>
      updaterInstall: () => Promise<void>
      getAppVersion: () => Promise<string>
    }
  }
}
