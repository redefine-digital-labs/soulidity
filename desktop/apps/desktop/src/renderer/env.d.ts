export {}

import type {
  AgentRuntimeSnapshot,
  HookInstallStatus,
  ExtractSoulDraft,
  PetAgentEvent,
  PetUpdateStatus,
  SessionScanResult,
  SoulProfile,
  ScanProgress,
  SupportedAgentSource,
} from '@soulidity/shared'

declare global {
  interface Window {
    electronAPI: {
      // ── 基础 ──
      ping: () => Promise<string>
      closeWindow: () => void
      openMainWindowTab: (tab?: 'settings' | 'library' | 'agent' | 'extract') => Promise<void>
      onNavigateTab: (callback: (detail: { tab?: string }) => void) => () => void
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
      onAgentRuntimeChanged: (callback: (snapshot: AgentRuntimeSnapshot) => void) => () => void
      onAgentEvent: (callback: (event: PetAgentEvent) => void) => () => void
      getCurrentAgentStatus: () => Promise<unknown>
      getCurrentAgentRuntime: () => Promise<AgentRuntimeSnapshot | null>
      approveAgentPermission: (requestId: string, allowAlways?: boolean) => Promise<boolean>
      denyAgentPermission: (requestId: string) => Promise<boolean>
      answerAgentQuestion: (requestId: string, answer: string) => Promise<boolean>
      skipAgentQuestion: (requestId: string) => Promise<boolean>
      getHookInstallStatus: () => Promise<HookInstallStatus[]>
      installHooks: (targets?: SupportedAgentSource[]) => Promise<HookInstallStatus[]>
      repairHooks: (targets?: SupportedAgentSource[]) => Promise<HookInstallStatus[]>
      uninstallHooks: (targets?: SupportedAgentSource[]) => Promise<HookInstallStatus[]>

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
        status: string; accountId?: string; desktopAccessToken?: string; expiresAt?: string | null
      }>
      deviceGetLinkUrl: () => Promise<string>

      // ── Desktop auth ──
      getDesktopAuthStatus: () => Promise<{ hasToken: boolean; accountId: string | null }>
      unlinkDesktopDevice: () => Promise<{ ok: true } | { ok: false; error: string }>
      getDesktopRuntimeConfig: () => Promise<{ privyAppId: string | null; suiNetwork: string }>
      getDesktopMe: () => Promise<unknown>
      getDesktopPrivyToken: () => Promise<{ jwt: string; alreadyLinked: boolean }>

      // ── Desktop create draft ──
      'desktop:create-draft:load': () => Promise<ExtractSoulDraft | null>
      'desktop:create-draft:save': (draft: ExtractSoulDraft) => Promise<void>
      'desktop:create-draft:clear': () => Promise<void>

      // ── Desktop create + mint ──
      'desktop:create:upload': (params: {
        bytes: Uint8Array
        fileName: string
        mimeType: string
        uploadType: 'public' | 'encrypted'
        sendObjectTo?: string | null
      }) => Promise<unknown>
      'desktop:create:personal-kiosk': (params: { walletAddress?: string | null }) => Promise<unknown>
      'desktop:create:publish': (payload: Record<string, unknown>) => Promise<unknown>

      // ── Soul download + active persona ──
      soulDownload: (params: { catalogId: string }) => Promise<{ catalogId: string; spriteId: string } | { error: string }>
      onDownloadProgress: (callback: (progress: unknown) => void) => () => void
      soulSetActive: (params: { catalogId: string } | null) => Promise<void>
      soulGetActive: () => Promise<{ catalogId?: string; spriteConfig?: unknown } | null>
      onPersonaChanged: (callback: (data: unknown) => void) => () => void
      soulFetchCatalog: (params: { page: number; pageSize: number }) => Promise<unknown>
      soulGetMySouls: () => Promise<unknown[]>

      // ── Session extraction + profile analysis ──
      'extraction:scan-sessions': () => Promise<SessionScanResult[]>
      'extraction:analyze-profile': (results: SessionScanResult[]) => Promise<SoulProfile>
      'extraction:scan-progress': (callback: (progress: ScanProgress) => void) => () => void

      // ── Shell ──
      'shell:open-external': (url: string) => Promise<void>

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
