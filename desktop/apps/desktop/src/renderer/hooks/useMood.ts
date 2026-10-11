import { useState, useEffect, useRef } from 'react'
import type { Mood, MoodSnapshot } from '@soulidity/shared'

/** 默认轮询间隔 15 秒 */
const POLL_INTERVAL = 15_000

const DEFAULT_SNAPSHOT: MoodSnapshot = {
  mood: 'idle',
  reason: 'init',
  updatedAt: new Date().toISOString(),
  phrases: [],
  intensity: 0.3,
  ambientLevel: 'low',
  spriteAnimation: 'idle'
}

export interface UseMoodReturn {
  snapshot: MoodSnapshot
  mood: Mood
  spriteAnimation: string
}

/**
 * 轮询 IPC mood:get，返回最新的 MoodSnapshot。
 */
export function useMood(interval = POLL_INTERVAL): UseMoodReturn {
  const [snapshot, setSnapshot] = useState<MoodSnapshot>(DEFAULT_SNAPSHOT)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchMood = (): void => {
      window.electronAPI.getMoodSnapshot()
        .then((data) => {
          if (!cancelled && data) setSnapshot(data as MoodSnapshot)
        })
        .catch(() => {})
    }

    fetchMood()
    timerRef.current = setInterval(fetchMood, interval)
    const unsub = window.electronAPI.onMoodChanged?.((data) => {
      if (!cancelled && data) setSnapshot(data as MoodSnapshot)
    })

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
      unsub?.()
    }
  }, [interval])

  return {
    snapshot,
    mood: snapshot.mood,
    spriteAnimation: snapshot.spriteAnimation
  }
}
