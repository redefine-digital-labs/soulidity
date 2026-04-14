import type { MoodSnapshot, CliAgentStatus } from '@soulidity/shared'
import { resolveMood, type MoodSignals } from './mood'
import { memoryService } from './memory-service'

// ─── 常量 ────────────────────────────────────

/** 状态切换去抖间隔（毫秒）：同一 mood 不重复广播，切换频率上限 30s/次 */
const MOOD_DEBOUNCE_MS = 30_000

/** 定时刷新间隔（毫秒） */
const TICK_INTERVAL_MS = 60_000

// ─── MoodService ────────────────────────────

/**
 * Mood 服务：维护当前 MoodSnapshot、定时刷新、
 * 外部事件触发刷新、跨时间段边界检测。
 *
 * 对外暴露单例 `moodService`。
 */
class MoodService {
  /** 当前快照 */
  private snapshot: MoodSnapshot | null = null

  /** 上次 mood 变更的时间戳（ms） */
  private moodChangedAt = 0

  /** 上次广播的时间戳（ms） */
  private lastBroadcastAt = 0

  /** 计时器句柄 */
  private intervalId: ReturnType<typeof setInterval> | null = null

  /** 上一次刷新时的小时数，用于跨时间段边界检测 */
  private lastHour = -1

  // ── 外部输入信号 ──

  /** 当前 CLI agent 状态 */
  private cliStatus: CliAgentStatus = 'idle'

  /** 最近一次用户交互时间（ISO） */
  private lastInteractionAt: string | undefined

  /** 最近一次任务完成时间（ISO） */
  private lastTaskCompletedAt: string | undefined

  /** 当前是否正在流式回复 */
  private isStreaming = false

  /** 当前是否正在被拖拽 */
  private isDragging = false

  /** 连续完成计数 */
  private consecutiveCompletions = 0

  /** 今日是否已有交互（用于判断首次互动） */
  private hadInteractionToday = false

  /** 上次重置 hadInteractionToday 的日期 */
  private lastResetDate = ''

  /** 状态变更监听器 */
  private listeners: Array<(snap: MoodSnapshot) => void> = []

  // ── 生命周期 ──

  /** App 启动时调用：做首次刷新 + 启动定时器 */
  start(): void {
    this.refresh()
    this.intervalId = setInterval(() => this.tick(), TICK_INTERVAL_MS)
    console.log('[mood] service started')
  }

  /** App 关闭时调用：清理定时器 */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[mood] service stopped')
  }

  // ── 外部事件触发 ──

  /** CLI agent 状态变更时调用 */
  notifyCliStatusChanged(status: CliAgentStatus): void {
    const prev = this.cliStatus
    this.cliStatus = status

    // 连续完成计数
    if (status === 'completed') {
      this.consecutiveCompletions++
    } else if (prev === 'completed') {
      // 从 completed 转到其他状态时重置
      this.consecutiveCompletions = 0
    }

    this.refresh()
  }

  /** 用户发消息时触发 */
  notifyUserMessage(): void {
    this.lastInteractionAt = new Date().toISOString()
    this.refresh()
  }

  /** 流式开始 */
  notifyStreamStart(): void {
    this.isStreaming = true
    this.refresh()
  }

  /** 流式结束 */
  notifyStreamEnd(): void {
    this.isStreaming = false
    this.refresh()
  }

  /** 任务完成时触发 */
  notifyTaskCompleted(): void {
    this.lastTaskCompletedAt = new Date().toISOString()
    this.isStreaming = false
    // 通过 CLI status 通知来处理 consecutiveCompletions
    this.refresh()
  }

  /** 拖拽开始 */
  notifyDragStart(): void {
    this.isDragging = true
    this.refresh()
  }

  /** 拖拽结束 */
  notifyDragEnd(): void {
    this.isDragging = false
    this.refresh()
  }

  /** 注册 mood 变更监听器（用于 WS 广播等） */
  onChange(listener: (snap: MoodSnapshot) => void): void {
    this.listeners.push(listener)
  }

  /** 获取当前快照（安全返回默认 idle） */
  getSnapshot(): MoodSnapshot {
    if (!this.snapshot) this.refresh()
    return this.snapshot!
  }

  // ── 内部逻辑 ──

  /** 定时器回调：刷新 + 跨时间段边界检测 */
  private tick(): void {
    const hour = new Date().getHours()

    // 跨时间段边界：小时变化时强制刷新
    if (this.lastHour !== -1 && hour !== this.lastHour) {
      this.refresh()
    } else {
      this.refresh()
    }
    this.lastHour = hour
  }

  /** 核心刷新：构造信号 → 纯函数推导 → debounce → 广播 */
  private refresh(): void {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)

    // 日期切换时重置 hadInteractionToday
    if (todayStr !== this.lastResetDate) {
      this.hadInteractionToday = false
      this.lastResetDate = todayStr
    }

    const todayMessages = memoryService.getTodayPersistedMessages()

    // 判断首次互动：今日还没有过交互，且有新消息或刚交互
    const isFirstInteractionToday = !this.hadInteractionToday && (
      todayMessages.some(m => m.role === 'user') || !!this.lastInteractionAt
    )

    // 一旦有过交互就标记
    if (isFirstInteractionToday && (todayMessages.some(m => m.role === 'user') || !!this.lastInteractionAt)) {
      this.hadInteractionToday = true
    }

    const signals: MoodSignals = {
      now,
      cliStatus: this.cliStatus,
      todayMessages,
      lastInteractionAt: this.lastInteractionAt,
      lastTaskCompletedAt: this.lastTaskCompletedAt,
      isStreaming: this.isStreaming,
      isDragging: this.isDragging,
      isFirstInteractionToday,
      consecutiveCompletions: this.consecutiveCompletions
    }

    const derived = resolveMood(signals)
    const prev = this.snapshot
    const nowMs = now.getTime()

    // 首次刷新：直接接受
    if (!prev) {
      this.accept(derived, nowMs)
      return
    }

    // mood 未变：静默更新快照
    if (derived.mood === prev.mood) {
      this.snapshot = derived
      return
    }

    // debounce 判断：距上次广播不足 MOOD_DEBOUNCE_MS → 仅内部更新
    const sinceBroadcast = nowMs - this.lastBroadcastAt
    if (sinceBroadcast < MOOD_DEBOUNCE_MS) {
      this.snapshot = derived
      this.moodChangedAt = nowMs
      return
    }

    this.accept(derived, nowMs)
  }

  /** 接受新快照并广播 */
  private accept(snap: MoodSnapshot, nowMs: number): void {
    this.snapshot = snap
    this.moodChangedAt = nowMs
    this.lastBroadcastAt = nowMs
    this.lastHour = new Date(nowMs).getHours()

    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch (err) {
        console.error('[mood] listener error:', err)
      }
    }
  }
}

export const moodService = new MoodService()
