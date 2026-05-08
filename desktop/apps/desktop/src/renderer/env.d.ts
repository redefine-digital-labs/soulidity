export {}

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

declare module '*.css'

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
      onConfigChanged: (callback: (config: Record<string, unknown>) => void) => () => void

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

      // ── Agent wallet (the unified local Sui identity for this desktop) ──
      generateAgentKeypair: () => Promise<unknown>
      loadAgentKeypair: () => Promise<unknown>
      exportAgentAddress: () => Promise<string>
      getSecretStorageStatus: () => Promise<'encrypted' | 'legacy' | 'missing'>
      agentSignPersonalMessage: (message: Uint8Array) => Promise<{ signature: string }>

      // ── 设备绑定 ──
      deviceStartLink: () => Promise<{
        deviceCode: string; userCode: string; expiresAt: string; pollInterval: number
      }>
      devicePoll: (deviceCode: string) => Promise<{
        status: string
        accountId?: string
        error?: string
        expiresAt?: string | null
        pollInterval?: number
      }>
      deviceGetLinkUrl: () => Promise<string>

      // ── Desktop auth ──
      getDesktopAuthStatus: () => Promise<{ hasToken: boolean; accountId: string | null }>
      unlinkDesktopDevice: () => Promise<
        { ok: true; remoteRevoked: boolean } | { ok: false; error: string; status?: number }
      >
      agentRotateApiKey: () => Promise<{ ok: true } | { ok: false; error: string }>
      agentGetApiKeyStatus: () => Promise<{ hasKey: boolean; storedAt: number | null }>
      agentResetIdentity: () => Promise<
        { ok: true; remoteRevoked: boolean } | { ok: false; error: string; status?: number }
      >
      getDesktopRuntimeConfig: () => Promise<{
        suiNetwork: string
        webBaseUrl: string
        authReady: boolean
        authBlocker: string | null
      }>
      getDesktopMe: () => Promise<unknown>

      // ── Desktop create draft ──
      'desktop:create-draft:load': () => Promise<ExtractSoulDraft | null>
      'desktop:create-draft:save': (draft: ExtractSoulDraft) => Promise<void>
      'desktop:create-draft:clear': () => Promise<void>
      'desktop:create-draft:pick-cover-image': () => Promise<{ dataUrl: string; fileName: string; mimeType: string } | null>

      // ── Soul download + active persona ──
      soulDownload: (params: { catalogId: string }) => Promise<{ catalogId: string; spriteId: string } | { error: string }>
      soulFetchManifest: (params: { catalogId: string; viewer?: string | null }) => Promise<unknown>
      soulCachePersona: (params: {
        catalogId: string
        sourceType: 'starter' | 'soul'
        sourceRef: string
        version: string
        spriteBytes: Uint8Array
        configJson: string
      }) => Promise<{ catalogId: string; spriteId: string }>
      onDownloadProgress: (callback: (progress: unknown) => void) => () => void
      soulSetActive: (params: { catalogId: string; sourceType: string; sourceRef: string } | null) => Promise<void>
      soulGetActive: () => Promise<{ catalogId?: string; spriteConfig?: unknown } | null>
      onPersonaChanged: (callback: (data: unknown) => void) => () => void
      soulFetchCatalog: (params: { page: number; pageSize: number }) => Promise<unknown>
      soulGetMySouls: () => Promise<unknown[]>

      // ── Session extraction + local create ──
      'extraction:scan-sessions': () => Promise<SessionScanResult[]>
      'extraction:get-openclaw-import-status': () => Promise<OpenClawImportStatus>
      'extraction:get-local-agent-statuses': () => Promise<LocalExtractAgentStatus[]>
      'extraction:import-openclaw-draft': (input: ImportOpenClawDraftInput) => Promise<ExtractSoulDraft>
      'extraction:create-local-draft': (input: CreateLocalExtractDraftInput) => Promise<ExtractSoulDraft>
      'extraction:open-web-create': () => Promise<void>
      'extraction:start-mint-handoff': (draft: ExtractSoulDraft) => Promise<void>
      'extraction:on-draft-cleared': (callback: (detail: { reason: string }) => void) => () => void
      'extraction:scan-progress': (callback: (progress: ScanProgress) => void) => () => void

      // ── Shell ──
      'shell:open-external': (url: string) => Promise<void>

      // ── Task 执行 ──
      executeTask: (payload: {
        agent: 'claude' | 'codex'
        instruction: string
        filePaths?: string[]
        cwd?: string
        executionMode?: 'read' | 'write'
        approvalToken?: string
      }) =>
        Promise<{ taskId: string; error?: string }>
      requestWriteApproval: (payload: {
        filePaths: string[]
        agent?: 'claude' | 'codex'
        instruction?: string
      }) => Promise<TaskWriteApprovalResult>
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
