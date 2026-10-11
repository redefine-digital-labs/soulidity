// ─── 情绪层共享协议 ─────────────────────────

/** 四状态情绪模型（Phase 1 遗留，Phase 1.5 由 Mood 替代） */
export type EmotionState = 'idle' | 'busy' | 'done' | 'night'

// ─── 12 Mood 系统（Phase 1.5）─────────────────

/** 12 态 Mood 模型，替代 4 态 EmotionState */
export type Mood =
  | 'idle'       // 空闲待机
  | 'happy'      // 开心（任务成功）
  | 'love'       // 喜爱（长时间陪伴）
  | 'excited'    // 兴奋（新任务/thinking）
  | 'celebrate'  // 庆祝（连续完成里程碑）
  | 'sleepy'     // 犯困（夜晚边缘）
  | 'snoring'    // 熟睡（深夜）
  | 'working'    // 工作中
  | 'angry'      // 生气（错误/失败）
  | 'surprised'  // 惊讶（需要注意）
  | 'shy'        // 害羞（首次互动）
  | 'dragging'   // 被拖拽中

export const ALL_MOODS: readonly Mood[] = [
  'idle', 'happy', 'love', 'excited', 'celebrate',
  'sleepy', 'snoring', 'working', 'angry', 'surprised', 'shy', 'dragging',
] as const

/** Mood → Sprite 动画名映射（12 mood 多对一映射 6 sprite 动画） */
export const MOOD_TO_SPRITE: Record<Mood, string> = {
  idle: 'idle',
  happy: 'completed',
  love: 'idle',
  excited: 'thinking',
  celebrate: 'completed',
  sleepy: 'idle',
  snoring: 'error',
  working: 'working',
  angry: 'error',
  surprised: 'needs-attention',
  shy: 'idle',
  dragging: 'dragging',
}

/** Mood 快照：后端统一输出、前端统一消费 */
export interface MoodSnapshot {
  /** 当前 mood */
  mood: Mood
  /** 状态来源（调试/日志用） */
  reason: string
  /** 最近一次变更时间 ISO */
  updatedAt: string
  /** 当前 mood 适用的话术池 */
  phrases: string[]
  /** 情绪表现强度 0–1 */
  intensity: number
  /** 环境活动度 */
  ambientLevel: 'low' | 'medium' | 'high'
  /** 映射后的 sprite 动画名 */
  spriteAnimation: string
}

/** Mood 参数：固定 intensity + ambientLevel */
export const MOOD_PARAMS: Record<Mood, { intensity: number; ambientLevel: 'low' | 'medium' | 'high' }> = {
  idle:      { intensity: 0.3, ambientLevel: 'low' },
  happy:     { intensity: 0.6, ambientLevel: 'medium' },
  love:      { intensity: 0.5, ambientLevel: 'medium' },
  excited:   { intensity: 0.7, ambientLevel: 'high' },
  celebrate: { intensity: 0.9, ambientLevel: 'high' },
  sleepy:    { intensity: 0.2, ambientLevel: 'low' },
  snoring:   { intensity: 0.1, ambientLevel: 'low' },
  working:   { intensity: 0.8, ambientLevel: 'high' },
  angry:     { intensity: 0.7, ambientLevel: 'medium' },
  surprised: { intensity: 0.6, ambientLevel: 'medium' },
  shy:       { intensity: 0.4, ambientLevel: 'low' },
  dragging:  { intensity: 0.3, ambientLevel: 'low' },
}

/**
 * 状态优先级（数值越高越优先）
 * 评估顺序：night > busy > done > idle
 */
export const EMOTION_PRIORITY: Record<EmotionState, number> = {
  idle: 0,
  done: 1,
  busy: 2,
  night: 3
}

/**
 * 最小保持时长（毫秒）
 * 进入该状态后，至少持续这么久才允许被更低优先级覆盖。
 * - night 由时间窗直接决定（22:00–06:00），无需最小保持
 * - idle 无强保持约束
 * - done 由 5-8 分钟窗口自带时限，无需额外保持
 */
export const EMOTION_MIN_HOLD_MS: Record<EmotionState, number> = {
  idle: 0,
  done: 0,              // 窗口型状态，5-8 分钟自然退出
  busy: 2 * 60_000,    // 2 分钟
  night: 0              // 由时间窗决定
}

/** 状态切换去抖间隔（毫秒）：同一状态不重复广播，切换频率上限 30s/次 */
export const EMOTION_DEBOUNCE_MS = 30_000

/** 情绪快照：后端统一输出、前端统一消费 */
export interface EmotionSnapshot {
  /** 当前主状态 */
  state: EmotionState
  /** 状态来源（调试/日志用），如 night_time / recent_conversation / quiet_after_active_day / default_idle */
  reason: string
  /** 最近一次状态变更时间 ISO 字符串 */
  updatedAt: string
  /** 当前状态适用的话术池 */
  phrases: string[]
  /** 情绪表现强度 0–1 */
  intensity: number
  /** 环境活动度：控制冒泡频率和视觉活动 */
  ambientLevel: 'low' | 'medium' | 'high'
}
