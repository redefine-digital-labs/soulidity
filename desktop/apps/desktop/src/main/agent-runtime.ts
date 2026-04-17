import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import {
  type AgentRuntimeSnapshot,
  type HookInstallStatus,
  type PendingPermission,
  type PendingQuestion,
  type RuntimeSession,
  type SupportedAgentSource,
} from '@soulidity/shared'

type IncomingEvent = Record<string, unknown>
type ResponseWriter = (body: string) => void
type SnapshotListener = (snapshot: AgentRuntimeSnapshot) => void
type IncomingEventResult = 'ignored' | 'handled' | 'deferred'

interface PendingPermissionState extends PendingPermission {
  respond?: ResponseWriter
}

interface PendingQuestionState extends PendingQuestion {
  respond?: ResponseWriter
  prompt?: AskUserQuestionPrompt
  askUserBatchId?: string
}

interface AskUserQuestionBatchState {
  batchId: string
  sessionId: string
  respond?: ResponseWriter
  answers: Record<string, string>
  requestIds: string[]
}

interface AskUserQuestionPrompt {
  header?: string
  question: string
  options?: string[]
  descriptions?: string[]
  answerKey: string
}

const DEFAULT_SNAPSHOT: AgentRuntimeSnapshot = {
  version: 1,
  lastUpdated: Date.now(),
  transport: {
    status: process.platform === 'win32' ? 'disabled' : 'starting',
    mode: process.platform === 'win32' ? 'disabled' : 'unix-socket',
  },
  sessions: {},
  pendingPermissions: [],
  pendingQuestions: [],
  hooks: [],
}

const MAX_SOCKET_PAYLOAD_BYTES = 1024 * 1024
const SOCKET_UPLOAD_TIMEOUT_MS = 15_000
const ENDED_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_RETAINED_ENDED_SESSIONS = 100
const STALE_SESSION_IDLE_TTL_MS = 30 * 60 * 1000

function normalizeEventName(raw: string): string {
  switch (raw) {
    case 'beforeSubmitPrompt':
      return 'UserPromptSubmit'
    case 'beforeShellExecution':
    case 'beforeReadFile':
    case 'beforeMCPExecution':
    case 'BeforeTool':
    case 'preToolUse':
      return 'PreToolUse'
    case 'afterShellExecution':
    case 'afterFileEdit':
    case 'afterMCPExecution':
    case 'AfterTool':
    case 'postToolUse':
      return 'PostToolUse'
    case 'BeforeAgent':
      return 'SubagentStart'
    case 'AfterAgent':
      return 'SubagentStop'
    case 'afterAgentThought':
    case 'afterAgentResponse':
    case 'errorOccurred':
      return 'Notification'
    case 'sessionStart':
      return 'SessionStart'
    case 'sessionEnd':
      return 'SessionEnd'
    case 'userPromptSubmitted':
      return 'UserPromptSubmit'
    case 'stop':
      return 'Stop'
    default:
      return raw
  }
}

function normalizeSource(raw: unknown): SupportedAgentSource {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  switch (value) {
    case 'claude':
    case 'codex':
    case 'gemini':
    case 'cursor':
    case 'trae':
    case 'traecn':
    case 'qoder':
    case 'droid':
    case 'factory':
    case 'codebuddy':
    case 'codybuddycn':
    case 'stepfun':
    case 'copilot':
    case 'kimi':
    case 'opencode':
    case 'antigravity':
    case 'workbuddy':
    case 'hermes':
      return value
    default:
      return 'custom'
  }
}

function clientTypeForSource(source: SupportedAgentSource): RuntimeSession['clientType'] {
  if (source === 'claude') return 'claude-code'
  if (source === 'codex') return 'codex'
  if (source === 'opencode') return 'opencode'
  return 'custom'
}

function firstString(payload: IncomingEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function firstNumber(payload: IncomingEvent, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function firstObject(payload: IncomingEvent, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }
  return undefined
}

function pushRecentMessage(
  session: RuntimeSession,
  message: { role: 'user' | 'assistant' | 'system'; text: string; timestamp: number },
): void {
  session.recentMessages.push(message)
  session.recentMessages = session.recentMessages.slice(-8)
}

function pushToolHistory(
  session: RuntimeSession,
  tool: string | undefined,
  description: string | undefined,
  success: boolean | undefined,
  timestamp: number,
): void {
  if (!tool) return
  session.toolHistory.push({
    tool,
    description,
    success,
    timestamp,
  })
  session.toolHistory = session.toolHistory.slice(-12)
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function extractToolDescription(toolName: string | undefined, toolInput: Record<string, unknown> | undefined): string | undefined {
  if (!toolInput) return undefined

  if (typeof toolInput.file_path === 'string') {
    return path.basename(toolInput.file_path)
  }
  if (typeof toolInput.command === 'string') {
    return truncate(toolInput.command, 60)
  }
  if (typeof toolInput.pattern === 'string') {
    return toolInput.pattern
  }
  if (typeof toolInput.question === 'string') {
    return truncate(toolInput.question, 120)
  }
  if (Array.isArray(toolInput.questions) && toolInput.questions.length > 0) {
    const first = toolInput.questions[0]
    if (typeof first === 'object' && first !== null && typeof (first as Record<string, unknown>).question === 'string') {
      return truncate((first as Record<string, unknown>).question as string, 120)
    }
  }
  if (toolName) {
    return truncate(toolName, 60)
  }
  return undefined
}

function buildAskUserQuestionPrompts(toolInput: Record<string, unknown> | undefined): AskUserQuestionPrompt[] {
  if (!toolInput) return []

  if (Array.isArray(toolInput.questions)) {
    return toolInput.questions.flatMap((item, index) => {
      if (typeof item !== 'object' || item === null) return []
      const record = item as Record<string, unknown>
      const question = typeof record.question === 'string' ? record.question.trim() : ''
      if (!question) return []
      const options = Array.isArray(record.options)
        ? record.options
          .map((option) => {
            if (typeof option === 'string') return option
            if (typeof option === 'object' && option !== null && typeof (option as Record<string, unknown>).label === 'string') {
              return (option as Record<string, unknown>).label as string
            }
            return null
          })
          .filter((option): option is string => Boolean(option))
        : undefined
      const descriptions = Array.isArray(record.options)
        ? record.options
          .map((option) => {
            if (typeof option === 'object' && option !== null && typeof (option as Record<string, unknown>).description === 'string') {
              return (option as Record<string, unknown>).description as string
            }
            return null
          })
          .filter((value): value is string => Boolean(value))
        : undefined
      const header = typeof record.header === 'string' ? record.header.trim() : undefined
      return [{
        header,
        question,
        options: options?.length ? options : undefined,
        descriptions: descriptions?.length ? descriptions : undefined,
        answerKey: header || `answer_${index + 1}`,
      }]
    })
  }

  if (typeof toolInput.question === 'string' && toolInput.question.trim()) {
    return [{
      question: toolInput.question.trim(),
      options: Array.isArray(toolInput.options)
        ? toolInput.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        : undefined,
      answerKey: 'answer',
    }]
  }

  return []
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!Number.isFinite(pid) || !pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function buildSessionTitle(payload: IncomingEvent): string | undefined {
  const prompt = firstString(payload, 'prompt', 'session_title', 'title')
  if (prompt) return truncate(prompt.replace(/\s+/g, ' '), 120)
  return undefined
}

export function buildPermissionResponse(
  behavior: 'allow' | 'deny',
  options: { allowAlways?: boolean; toolName?: string } = {},
): string {
  if (behavior === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny' },
      },
    })
  }

  if (options.allowAlways && options.toolName) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedPermissions: [{
            type: 'addRules',
            rules: [{ toolName: options.toolName, ruleContent: '*' }],
            behavior: 'allow',
            destination: 'session',
          }],
        },
      },
    })
  }

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  })
}

export function buildQuestionResponse(question: string, answer: string): string {
  void question
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Notification',
      answer,
    },
  })
}

function buildNotificationAckResponse(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Notification',
    },
  })
}

function buildAskUserQuestionResponse(answers: Record<string, string>): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
        updatedInput: {
          answers,
        },
      },
    },
  })
}

export class AgentRuntimeController {
  private snapshot: AgentRuntimeSnapshot = structuredClone(DEFAULT_SNAPSHOT)
  private readonly listeners = new Set<SnapshotListener>()
  private readonly permissionResponders = new Map<string, PendingPermissionState>()
  private readonly questionResponders = new Map<string, PendingQuestionState>()
  private readonly askUserQuestionBatches = new Map<string, AskUserQuestionBatchState>()
  private requestCounter = 0

  getSnapshot(): AgentRuntimeSnapshot {
    return structuredClone(this.snapshot)
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setTransportStatus(next: Partial<AgentRuntimeSnapshot['transport']>): void {
    this.snapshot.transport = {
      ...this.snapshot.transport,
      ...next,
      updatedAt: Date.now(),
    }
    this.bump()
  }

  setHooks(hooks: HookInstallStatus[]): void {
    this.snapshot.hooks = hooks
    this.bump()
  }

  handleIncomingEvent(payload: IncomingEvent, respond?: ResponseWriter): IncomingEventResult {
    const rawEventName = firstString(payload, 'hook_event_name', 'hookEventName', 'event_name', 'eventName', 'event')
    const sessionId = firstString(payload, 'session_id', 'sessionId', 'id')
    if (!rawEventName || !sessionId) return 'ignored'

    const eventName = normalizeEventName(rawEventName)

    const source = normalizeSource(firstString(payload, '_source', 'source'))
    const session = this.ensureSession(sessionId, source)
    const now = Date.now()
    const cwd = firstString(payload, 'cwd') ?? session.workingDirectory
    const taskId = firstString(payload, '_soulidity_task_id', 'task_id', 'taskId')
    const toolName = firstString(payload, 'tool_name', 'toolName', 'tool')
    const toolInput = firstObject(payload, 'tool_input', 'toolInput', 'input', 'arguments', 'args')
    const toolDescription = extractToolDescription(toolName, toolInput)
    const messageText = firstString(payload, 'message', 'text', 'summary', 'detail', 'content', 'last_assistant_message')

    session.lastUpdated = now
    session.workingDirectory = cwd
    session.sessionTitle = buildSessionTitle(payload) ?? session.sessionTitle
    session.transportSource = 'socket'
    session.model = firstString(payload, 'model', 'model_name', 'modelName') ?? session.model
    session.permissionMode = firstString(payload, 'permission_mode', 'permissionMode') ?? session.permissionMode
    session.cliPid = firstNumber(payload, '_ppid', 'pid', 'process_id', 'processId') ?? session.cliPid
    session.taskId = taskId ?? session.taskId

    switch (eventName) {
      case 'SessionStart':
        session.status = 'idle'
        session.startedAt = now
        delete session.endedAt
        session.currentTool = undefined
        session.toolDescription = undefined
        break
      case 'UserPromptSubmit': {
        session.status = 'processing'
        session.currentTool = undefined
        session.toolDescription = undefined
        const prompt = firstString(payload, 'prompt')
        if (prompt) {
          pushRecentMessage(session, { role: 'user', text: prompt, timestamp: now })
          session.sessionTitle ??= truncate(prompt.replace(/\s+/g, ' '), 120)
        }
        break
      }
      case 'PreToolUse':
        session.status = 'running'
        session.currentTool = toolName
        session.toolDescription = toolDescription
        break
      case 'PostToolUse':
        session.status = 'running'
        pushToolHistory(session, toolName ?? session.currentTool, toolDescription ?? session.toolDescription, true, now)
        if (toolName) session.currentTool = toolName
        if (toolDescription) session.toolDescription = toolDescription
        break
      case 'SubagentStart':
      case 'SubagentStop':
        session.status = 'running'
        if (toolName) session.currentTool = toolName
        if (toolDescription) session.toolDescription = toolDescription
        break
      case 'Stop':
        session.status = 'completed'
        session.endedAt = now
        session.currentTool = undefined
        session.toolDescription = undefined
        this.clearPendingForSession(session.sessionId)
        if (messageText) {
          pushRecentMessage(session, { role: 'assistant', text: messageText, timestamp: now })
        }
        break
      case 'SessionEnd':
        session.status = 'idle'
        session.endedAt = now
        session.currentTool = undefined
        session.toolDescription = undefined
        this.clearPendingForSession(session.sessionId)
        break
      case 'Notification':
        if (typeof payload.question === 'string' && payload.question.trim()) {
          return this.enqueueQuestion(session, payload, now, source, respond) ? 'deferred' : 'ignored'
        }
        session.status = session.status === 'running' ? 'running' : 'processing'
        if (messageText) {
          pushRecentMessage(session, {
            role: eventName === 'Notification' && rawEventName === 'errorOccurred' ? 'system' : 'assistant',
            text: messageText,
            timestamp: now,
          })
        }
        break
      case 'PermissionRequest':
        if (toolName === 'AskUserQuestion') {
          return this.enqueueAskUserQuestion(session, payload, now, source, respond) ? 'deferred' : 'ignored'
        }
        return this.enqueuePermission(session, payload, now, source, respond) ? 'deferred' : 'ignored'
      default:
        session.status = session.status === 'idle' ? 'processing' : session.status
        break
    }

    this.bump()
    return 'handled'
  }

  clearPendingForResponse(respond: ResponseWriter): void {
    const permissionIds = new Set<string>()
    const questionIds = new Set<string>()
    const askUserBatchIds = new Set<string>()
    const sessionIds = new Set<string>()

    for (const [requestId, pending] of this.permissionResponders.entries()) {
      if (pending.respond !== respond) continue
      permissionIds.add(requestId)
      sessionIds.add(pending.sessionId)
      this.permissionResponders.delete(requestId)
    }

    for (const [requestId, pending] of this.questionResponders.entries()) {
      if (pending.respond !== respond) continue
      if (pending.kind === 'ask-user' && pending.askUserBatchId) {
        askUserBatchIds.add(pending.askUserBatchId)
        sessionIds.add(pending.sessionId)
        continue
      }
      questionIds.add(requestId)
      sessionIds.add(pending.sessionId)
      this.questionResponders.delete(requestId)
    }

    if (permissionIds.size === 0 && questionIds.size === 0 && askUserBatchIds.size === 0) return

    if (permissionIds.size > 0) {
      this.snapshot.pendingPermissions = this.snapshot.pendingPermissions.filter((item) => !permissionIds.has(item.requestId))
    }

    if (questionIds.size > 0) {
      this.snapshot.pendingQuestions = this.snapshot.pendingQuestions.filter((item) => !questionIds.has(item.requestId))
    }

    for (const batchId of askUserBatchIds) {
      this.clearAskUserQuestionBatch(batchId)
    }

    const now = Date.now()
    for (const sessionId of sessionIds) {
      if (this.hasPendingForSession(sessionId)) continue
      const session = this.snapshot.sessions[sessionId]
      if (!session) continue
      if (session.status === 'waiting-approval' || session.status === 'waiting-question') {
        session.status = 'idle'
        session.currentTool = undefined
        session.toolDescription = undefined
        session.lastUpdated = now
      }
    }

    this.bump()
  }

  approvePermission(requestId: string, allowAlways = false): boolean {
    const pending = this.permissionResponders.get(requestId)
    if (!pending) return false

    pending.respond?.(buildPermissionResponse('allow', {
      allowAlways,
      toolName: pending.toolName,
    }))
    this.permissionResponders.delete(requestId)
    this.snapshot.pendingPermissions = this.snapshot.pendingPermissions.filter((item) => item.requestId !== requestId)
    const session = this.snapshot.sessions[pending.sessionId]
    if (session) {
      session.status = 'running'
      session.lastUpdated = Date.now()
    }
    this.bump()
    return true
  }

  denyPermission(requestId: string): boolean {
    const pending = this.permissionResponders.get(requestId)
    if (!pending) return false

    pending.respond?.(buildPermissionResponse('deny'))
    this.permissionResponders.delete(requestId)
    this.snapshot.pendingPermissions = this.snapshot.pendingPermissions.filter((item) => item.requestId !== requestId)
    const session = this.snapshot.sessions[pending.sessionId]
    if (session) {
      session.status = 'idle'
      session.currentTool = undefined
      session.toolDescription = undefined
      session.lastUpdated = Date.now()
    }
    this.bump()
    return true
  }

  answerQuestion(requestId: string, answer: string): boolean {
    const pending = this.takePendingQuestion(requestId)
    if (!pending) return false

    if (pending.kind === 'ask-user' && pending.askUserBatchId && pending.prompt) {
      const batch = this.askUserQuestionBatches.get(pending.askUserBatchId)
      if (batch) {
        batch.answers[pending.prompt.answerKey] = answer
        if (batch.requestIds.length === 0) {
          batch.respond?.(buildAskUserQuestionResponse(batch.answers))
          this.askUserQuestionBatches.delete(batch.batchId)
        }
      }
    } else {
      pending.respond?.(buildQuestionResponse(pending.question, answer))
    }

    const session = this.snapshot.sessions[pending.sessionId]
    if (session) {
      session.lastUpdated = Date.now()
      this.updateSessionAfterPendingChange(session, 'processing')
    }
    this.bump()
    return true
  }

  skipQuestion(requestId: string): boolean {
    const pending = this.questionResponders.get(requestId)
    if (!pending) return false

    if (pending.kind === 'ask-user' && pending.askUserBatchId) {
      this.clearAskUserQuestionBatch(pending.askUserBatchId, buildPermissionResponse('deny'))
    } else {
      pending.respond?.(buildNotificationAckResponse())
      this.takePendingQuestion(requestId)
    }
    const session = this.snapshot.sessions[pending.sessionId]
    if (session) {
      session.lastUpdated = Date.now()
      this.updateSessionAfterPendingChange(session, 'processing')
    }
    this.bump()
    return true
  }

  private ensureSession(sessionId: string, source: SupportedAgentSource): RuntimeSession {
    const existing = this.snapshot.sessions[sessionId]
    if (existing) {
      existing.source = source
      existing.clientType = clientTypeForSource(source)
      return existing
    }

    const session: RuntimeSession = {
      sessionId,
      source,
      clientType: clientTypeForSource(source),
      status: 'idle',
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      recentMessages: [],
      toolHistory: [],
      transportSource: 'socket',
    }
    this.snapshot.sessions[sessionId] = session
    return session
  }

  private enqueuePermission(
    session: RuntimeSession,
    payload: IncomingEvent,
    now: number,
    source: SupportedAgentSource,
    respond?: ResponseWriter,
  ): boolean {
    const toolName = firstString(payload, 'tool_name', 'toolName', 'tool') ?? 'Unknown'
    const requestId = `perm-${++this.requestCounter}`
    const pending: PendingPermissionState = {
      requestId,
      sessionId: session.sessionId,
      taskId: session.taskId,
      source,
      toolName,
      toolInput: firstObject(payload, 'tool_input', 'toolInput', 'input', 'arguments', 'args'),
      createdAt: now,
      options: { allowAlways: true },
      respond,
    }
    session.status = 'waiting-approval'
    session.currentTool = toolName
    session.toolDescription = extractToolDescription(toolName, pending.toolInput)
    this.permissionResponders.set(requestId, pending)
    this.snapshot.pendingPermissions = [...this.snapshot.pendingPermissions, {
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      taskId: pending.taskId,
      source: pending.source,
      toolName: pending.toolName,
      toolInput: pending.toolInput,
      createdAt: pending.createdAt,
      options: pending.options,
    }]
    this.bump()
    return true
  }

  private enqueueQuestion(
    session: RuntimeSession,
    payload: IncomingEvent,
    now: number,
    source: SupportedAgentSource,
    respond?: ResponseWriter,
  ): boolean {
    const question = firstString(payload, 'question')
    if (!question) return false
    const requestId = `question-${++this.requestCounter}`
    const pending: PendingQuestionState = {
      requestId,
      sessionId: session.sessionId,
      taskId: session.taskId,
      source,
      kind: 'question',
      question,
      options: Array.isArray(payload.options)
        ? payload.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        : undefined,
      descriptions: Array.isArray(payload.descriptions)
        ? payload.descriptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined,
      createdAt: now,
      respond,
    }
    session.status = 'waiting-question'
    session.currentTool = undefined
    session.toolDescription = undefined
    this.questionResponders.set(requestId, pending)
    this.snapshot.pendingQuestions = [...this.snapshot.pendingQuestions, {
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      taskId: pending.taskId,
      source: pending.source,
      kind: pending.kind,
      question: pending.question,
      options: pending.options,
      descriptions: pending.descriptions,
      createdAt: pending.createdAt,
    }]
    this.bump()
    return true
  }

  private enqueueAskUserQuestion(
    session: RuntimeSession,
    payload: IncomingEvent,
    now: number,
    source: SupportedAgentSource,
    respond?: ResponseWriter,
  ): boolean {
    const toolInput = firstObject(payload, 'tool_input', 'toolInput', 'input', 'arguments', 'args')
    const prompts = buildAskUserQuestionPrompts(toolInput)
    if (prompts.length === 0) return false

    const batchId = `ask-user-${++this.requestCounter}`
    const batch: AskUserQuestionBatchState = {
      batchId,
      sessionId: session.sessionId,
      respond,
      answers: {},
      requestIds: [],
    }
    session.status = 'waiting-question'
    session.currentTool = 'AskUserQuestion'
    session.toolDescription = prompts[0]?.question
    this.askUserQuestionBatches.set(batchId, batch)

    for (const prompt of prompts) {
      const requestId = `question-${++this.requestCounter}`
      const pending: PendingQuestionState = {
        requestId,
        sessionId: session.sessionId,
        taskId: session.taskId,
        source,
        kind: 'ask-user',
        question: prompt.question,
        options: prompt.options,
        descriptions: prompt.descriptions,
        createdAt: now,
        respond,
        prompt,
        askUserBatchId: batchId,
      }
      batch.requestIds.push(requestId)
      this.questionResponders.set(requestId, pending)
      this.snapshot.pendingQuestions = [...this.snapshot.pendingQuestions, {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        taskId: pending.taskId,
        source: pending.source,
        kind: pending.kind,
        question: pending.question,
        options: pending.options,
        descriptions: pending.descriptions,
        createdAt: pending.createdAt,
      }]
    }
    this.bump()
    return true
  }

  private clearPendingForSession(sessionId: string): void {
    const permissionIds = new Set<string>()
    for (const [requestId, pending] of this.permissionResponders.entries()) {
      if (pending.sessionId !== sessionId) continue
      permissionIds.add(requestId)
      pending.respond?.(buildPermissionResponse('deny'))
      this.permissionResponders.delete(requestId)
    }

    if (permissionIds.size > 0) {
      this.snapshot.pendingPermissions = this.snapshot.pendingPermissions.filter((item) => !permissionIds.has(item.requestId))
    }

    const questionIds = new Set<string>()
    const askUserBatchIds = new Set<string>()
    for (const [requestId, pending] of this.questionResponders.entries()) {
      if (pending.sessionId !== sessionId) continue
      if (pending.kind === 'ask-user' && pending.askUserBatchId) {
        askUserBatchIds.add(pending.askUserBatchId)
        continue
      }
      questionIds.add(requestId)
      pending.respond?.(
        pending.kind === 'ask-user'
          ? buildPermissionResponse('deny')
          : buildNotificationAckResponse(),
      )
      this.questionResponders.delete(requestId)
    }

    if (questionIds.size > 0) {
      this.snapshot.pendingQuestions = this.snapshot.pendingQuestions.filter((item) => !questionIds.has(item.requestId))
    }

    for (const batchId of askUserBatchIds) {
      this.clearAskUserQuestionBatch(batchId, buildPermissionResponse('deny'))
    }
  }

  private hasPendingForSession(sessionId: string): boolean {
    return this.snapshot.pendingPermissions.some((item) => item.sessionId === sessionId)
      || this.snapshot.pendingQuestions.some((item) => item.sessionId === sessionId)
  }

  private getNextPendingQuestion(sessionId: string): PendingQuestion | undefined {
    return this.snapshot.pendingQuestions.find((item) => item.sessionId === sessionId)
  }

  private updateSessionAfterPendingChange(
    session: RuntimeSession,
    fallbackStatus: Extract<RuntimeSession['status'], 'idle' | 'processing' | 'running'>,
  ): void {
    const nextQuestion = this.getNextPendingQuestion(session.sessionId)
    if (nextQuestion) {
      session.status = 'waiting-question'
      session.currentTool = nextQuestion.kind === 'ask-user' ? 'AskUserQuestion' : undefined
      session.toolDescription = nextQuestion.kind === 'ask-user' ? nextQuestion.question : undefined
      return
    }

    if (this.snapshot.pendingPermissions.some((item) => item.sessionId === session.sessionId)) {
      session.status = 'waiting-approval'
      return
    }

    session.status = fallbackStatus
    if (session.currentTool === 'AskUserQuestion') {
      session.currentTool = undefined
      session.toolDescription = undefined
    }
  }

  private takePendingQuestion(requestId: string): PendingQuestionState | undefined {
    const pending = this.questionResponders.get(requestId)
    if (!pending) return undefined
    this.questionResponders.delete(requestId)
    this.snapshot.pendingQuestions = this.snapshot.pendingQuestions.filter((item) => item.requestId !== requestId)
    if (pending.askUserBatchId) {
      const batch = this.askUserQuestionBatches.get(pending.askUserBatchId)
      if (batch) {
        batch.requestIds = batch.requestIds.filter((id) => id !== requestId)
      }
    }
    return pending
  }

  private clearAskUserQuestionBatch(batchId: string, responseBody?: string): void {
    const batch = this.askUserQuestionBatches.get(batchId)
    if (!batch) return
    if (responseBody) {
      batch.respond?.(responseBody)
    }
    this.askUserQuestionBatches.delete(batchId)
    const requestIds = new Set(batch.requestIds)
    for (const requestId of batch.requestIds) {
      this.questionResponders.delete(requestId)
    }
    if (requestIds.size > 0) {
      this.snapshot.pendingQuestions = this.snapshot.pendingQuestions.filter((item) => !requestIds.has(item.requestId))
    }
  }

  private pruneEndedSessions(now: number): void {
    for (const [sessionId, session] of Object.entries(this.snapshot.sessions)) {
      if (typeof session.endedAt === 'number') continue
      if ((now - session.lastUpdated) < STALE_SESSION_IDLE_TTL_MS) continue
      if (session.status === 'waiting-approval' || session.status === 'waiting-question') continue
      if (this.hasPendingForSession(sessionId)) continue
      if (isProcessAlive(session.cliPid)) continue

      session.status = 'completed'
      session.endedAt = now
      session.currentTool = undefined
      session.toolDescription = undefined
    }

    const endedSessions = Object.entries(this.snapshot.sessions)
      .filter(([, session]) => typeof session.endedAt === 'number')

    for (const [sessionId, session] of endedSessions) {
      if ((session.endedAt ?? session.lastUpdated) <= now - ENDED_SESSION_TTL_MS) {
        delete this.snapshot.sessions[sessionId]
      }
    }

    const retainedEndedSessions = Object.entries(this.snapshot.sessions)
      .filter(([, session]) => typeof session.endedAt === 'number')
      .sort(([, left], [, right]) => (right.endedAt ?? right.lastUpdated) - (left.endedAt ?? left.lastUpdated))

    for (const [sessionId] of retainedEndedSessions.slice(MAX_RETAINED_ENDED_SESSIONS)) {
      delete this.snapshot.sessions[sessionId]
    }
  }

  private bump(): void {
    const now = Date.now()
    this.snapshot.lastUpdated = now
    this.pruneEndedSessions(now)
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

export interface UnixSocketTransportServerHandle {
  socketPath: string
  stop(): Promise<void>
}

export async function createUnixSocketTransportServer(
  controller: AgentRuntimeController,
  socketPath: string,
): Promise<UnixSocketTransportServerHandle> {
  if (process.platform === 'win32') {
    controller.setTransportStatus({ status: 'disabled', mode: 'disabled', endpoint: socketPath })
    return {
      socketPath,
      async stop() {},
    }
  }

  try {
    fs.rmSync(socketPath, { force: true })
  } catch {
    // ignore
  }

  const activeSockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    activeSockets.add(socket)
    let raw = ''
    let receivedBytes = 0
    let socketClosed = false
    let requestRejected = false
    socket.setEncoding('utf8')
    socket.setTimeout(SOCKET_UPLOAD_TIMEOUT_MS)

    const writeResponse: ResponseWriter = (body) => {
      if (socketClosed || socket.destroyed || socket.writableEnded || !socket.writable) return
      try {
        socket.end(body || '{}')
      } catch {
        socketClosed = true
      }
    }

    socket.on('close', () => {
      socketClosed = true
      activeSockets.delete(socket)
      controller.clearPendingForResponse(writeResponse)
    })
    socket.on('error', () => {
      socketClosed = true
    })
    socket.on('timeout', () => {
      requestRejected = true
      writeResponse('{"error":"socket_timeout"}')
    })

    socket.on('data', (chunk) => {
      if (requestRejected) return
      receivedBytes += Buffer.byteLength(chunk, 'utf8')
      if (receivedBytes > MAX_SOCKET_PAYLOAD_BYTES) {
        requestRejected = true
        writeResponse(`{"error":"payload_too_large","limitBytes":${MAX_SOCKET_PAYLOAD_BYTES}}`)
        return
      }
      raw += chunk
    })
    socket.on('end', () => {
      if (requestRejected) return
      socket.setTimeout(0)
      try {
        const payload = JSON.parse(raw) as IncomingEvent
        const eventName = firstString(payload, 'hook_event_name', 'hookEventName', 'event_name', 'eventName', 'event')
        const isBlocking = eventName === 'PermissionRequest'
          || (eventName === 'Notification' && typeof payload.question === 'string' && payload.question.trim().length > 0)

        if (isBlocking) {
          const result = controller.handleIncomingEvent(payload, writeResponse)
          if (result !== 'deferred') {
            writeResponse(
              eventName === 'PermissionRequest'
                ? buildPermissionResponse('deny')
                : buildNotificationAckResponse(),
            )
          }
          return
        }

        controller.handleIncomingEvent(payload)
        writeResponse('{}')
      } catch {
        writeResponse('{"error":"invalid_json"}')
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  fs.chmodSync(socketPath, 0o600)

  controller.setTransportStatus({
    status: 'ready',
    mode: 'unix-socket',
    endpoint: socketPath,
  })

  return {
    socketPath,
    async stop() {
      for (const socket of activeSockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      try {
        fs.rmSync(socketPath, { force: true })
      } catch {
        // ignore
      }
      controller.setTransportStatus({
        status: 'disabled',
        endpoint: socketPath,
      })
    },
  }
}
