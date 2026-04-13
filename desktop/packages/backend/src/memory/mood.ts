import type { PersistedMessage } from './memory-service'
import type { Mood, MoodSnapshot, CliAgentStatus } from '@soulidity/shared'
import { MOOD_TO_SPRITE, MOOD_PARAMS } from '@soulidity/shared'

// ─── 话术池（12 mood × 3-5 条中文话术）──────────

export const MOOD_PHRASES: Record<Mood, string[]> = {
  idle: [
    '在呢～',
    '今天怎么样？',
    '无聊可以找我玩哦',
    '我在这里等你～',
    '要不要聊聊天？'
  ],
  happy: [
    '太好了！',
    '完成啦～',
    '干得漂亮！',
    '又搞定一个！',
    '继续加油～'
  ],
  love: [
    '今天陪了我好久呀～',
    '和你在一起真开心',
    '你是最棒的搭档！',
    '谢谢你一直在'
  ],
  excited: [
    '嗯嗯，让我想想…',
    '有意思！',
    '这个问题很有趣',
    '我在认真思考中～'
  ],
  celebrate: [
    '连续大捷！太厉害了！',
    '势不可挡！',
    '今天效率爆表！',
    '庆祝一下吧！'
  ],
  sleepy: [
    '呼…有点困了',
    '该休息了吧？',
    '夜深了呢…',
    '打个哈欠～'
  ],
  snoring: [
    'zzZ…',
    '（已经睡着了）',
    '呼噜呼噜…',
    '明天见～'
  ],
  working: [
    '在忙呢～',
    '认真工作中...',
    '专注ing',
    '别打扰我，快写完了'
  ],
  angry: [
    '呜…出错了',
    '这不对劲',
    '需要修一下',
    '怎么回事…'
  ],
  surprised: [
    '嗯？怎么了？',
    '有情况！',
    '需要你看一下',
    '出了点状况'
  ],
  shy: [
    '你、你好…',
    '今天第一次见面呢',
    '有点紧张…',
    '嗯…你来了呀'
  ],
  dragging: [
    '哇，放开我～',
    '你要带我去哪？',
    '嘻嘻，飞起来了',
    '别拖啦～'
  ]
}

// ─── 输入信号 ────────────────────────────────

export interface MoodSignals {
  now: Date
  cliStatus: CliAgentStatus
  todayMessages: PersistedMessage[]
  lastInteractionAt?: string
  lastTaskCompletedAt?: string
  isStreaming?: boolean
  isDragging?: boolean
  isFirstInteractionToday?: boolean
  consecutiveCompletions?: number
}

// ─── 纯函数：12 mood 优先级决策 ──────────────

/**
 * 从信号推导 Mood（纯函数，零 LLM 成本）
 *
 * 优先级见表：dragging > error > needs-attention > working > thinking
 * > celebrate > completed > snoring > sleepy > shy > love > idle
 */
export function resolveMood(signals: MoodSignals): MoodSnapshot {
  const {
    now,
    cliStatus,
    todayMessages,
    lastInteractionAt,
    isDragging,
    isFirstInteractionToday,
    consecutiveCompletions
  } = signals

  const hour = now.getHours()
  const nowMs = now.getTime()
  const updatedAt = now.toISOString()

  // 计算交互时间差
  const lastInteractionMs = lastInteractionAt ? new Date(lastInteractionAt).getTime() : 0
  const lastMsgTime = todayMessages.length > 0
    ? new Date(todayMessages[todayMessages.length - 1]!.ts).getTime()
    : 0
  const lastActivityMs = Math.max(lastMsgTime, lastInteractionMs)
  const minutesSinceActivity = lastActivityMs
    ? (nowMs - lastActivityMs) / 60_000
    : Infinity

  const userMsgCount = todayMessages.filter((m) => m.role === 'user').length

  // ── #1 isDragging ──
  if (isDragging) {
    return snap('dragging', 'user_dragging', updatedAt)
  }

  // ── #2 cliStatus = error ──
  if (cliStatus === 'error') {
    return snap('angry', 'cli_error', updatedAt)
  }

  // ── #3 cliStatus = needs-attention ──
  if (cliStatus === 'needs-attention') {
    return snap('surprised', 'cli_needs_attention', updatedAt)
  }

  // ── #4 cliStatus = working ──
  if (cliStatus === 'working') {
    return snap('working', 'cli_working', updatedAt)
  }

  // ── #5 cliStatus = thinking ──
  if (cliStatus === 'thinking') {
    return snap('excited', 'cli_thinking', updatedAt)
  }

  // ── #6 cliStatus = completed + consecutiveCompletions >= 3 ──
  if (cliStatus === 'completed' && (consecutiveCompletions ?? 0) >= 3) {
    return snap('celebrate', 'consecutive_completions', updatedAt)
  }

  // ── #7 cliStatus = completed ──
  if (cliStatus === 'completed') {
    return snap('happy', 'cli_completed', updatedAt)
  }

  // ── #8 深夜 23:00-05:00 ──
  if (hour >= 23 || hour < 5) {
    return snap('snoring', 'late_night', updatedAt)
  }

  // ── #9 夜晚边缘 22:00-23:00 or 05:00-06:00 ──
  if (hour === 22 || hour === 5) {
    return snap('sleepy', 'night_edge', updatedAt)
  }

  // ── #10 首次互动 + 最近活动 < 2 分钟 ──
  if (isFirstInteractionToday && minutesSinceActivity < 2) {
    return snap('shy', 'first_interaction_today', updatedAt)
  }

  // ── #11 当日互动 >= 10 + CLI idle + 静默 5-15 分钟 ──
  if (
    userMsgCount >= 10 &&
    cliStatus === 'idle' &&
    minutesSinceActivity >= 5 &&
    minutesSinceActivity <= 15
  ) {
    return snap('love', 'companion_bond', updatedAt)
  }

  // ── #12 兜底 ──
  return snap('idle', 'default_idle', updatedAt)
}

// ─── 辅助：构造 MoodSnapshot ─────────────────

function snap(mood: Mood, reason: string, updatedAt: string): MoodSnapshot {
  const { intensity, ambientLevel } = MOOD_PARAMS[mood]
  return {
    mood,
    reason,
    updatedAt,
    phrases: MOOD_PHRASES[mood],
    intensity,
    ambientLevel,
    spriteAnimation: MOOD_TO_SPRITE[mood]
  }
}
