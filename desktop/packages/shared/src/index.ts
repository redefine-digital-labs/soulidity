// Shared 公共类型与工具
export type {
  WsEnvelope,
  WsMessageType,
  ClientMessageType,
  ServerMessageType,
  TaskCreatePayload,
  TaskAckPayload,
  TaskTokenPayload,
  TaskDonePayload,
  TaskErrorPayload,
  ChatMessageData,
  ConversationHistoryPayload,
  FileAttachment
} from './types/ws'

export type {
  ToolSchema,
  ToolResult,
  ToolDefinition,
  ToolCall
} from './types/tool'

export type {
  EmotionState,
  EmotionSnapshot,
  Mood,
  MoodSnapshot
} from './types/emotion'

export {
  EMOTION_PRIORITY,
  EMOTION_MIN_HOLD_MS,
  EMOTION_DEBOUNCE_MS,
  ALL_MOODS,
  MOOD_TO_SPRITE,
  MOOD_PARAMS
} from './types/emotion'

// ─── CLI Status ─────────────────────────────
export type {
  CliAgentStatus,
  AgentSession,
  AgentStatusFile,
  AgentConfig
} from './types/cli-status'

export {
  CLI_TERMINAL_GRACE_MS,
  deduplicateAgentSessions,
  parseAgentStatusFile,
  deriveAggregateStatus
} from './types/cli-status'

export type {
  PetTaskAgent,
  PetTaskSummary,
  PetAgentEventType,
  PetAgentEvent,
  PetUpdateState,
  PetUpdateStatus,
  PetTaskOptions,
} from './types/pet'

export {
  toPetTaskSummary,
  getVisiblePetTasks,
  derivePetAgentEvents,
} from './types/pet'

// NOTE: AGENT_CONFIGS is NOT re-exported here — it uses node:os/node:path
// which can't be bundled into the renderer. Import directly:
//   import { AGENT_CONFIGS } from '@soulidity/shared/types/agent-configs'

// ─── Soul Profile ───────────────────────────────
export type {
  SessionFeatures,
  SessionScanResult,
  SoulProfile,
  ScanProgress
} from './types/soul-profile'

export type {
  ExtractSoulDraft,
} from './types/extract-draft'

export {
  createExtractSoulDraft,
  regenerateExtractSoulDraftContent,
} from './types/extract-draft'

// ─── Memory System ───────────────────────────

export type {
  MemoryType,
  SourceRef,
  MemoryObjectBase,
  SourceMode,
  SourceStatus,
  FastFingerprint,
  SourceRecord,
  SelfCategory,
  SelfMemoryItem,
  RelationshipMemoryItem,
  TopicStatus,
  TopicMemoryItem,
  SavedKind,
  SavedArchiveItem,
  MemoryObject,
  MemoryIndexEntry,
  SourceIndexEntry,
  SelfIndexEntry,
  RelationshipIndexEntry,
  TopicIndexEntry,
  SavedIndexEntry,
  MemoryManifest
} from './types/memory'
