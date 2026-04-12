import { useState, useEffect, useRef } from 'react'

export type CliAgentStatus = 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'

const TERMINAL_GRACE_MS = 3000

function pickLatestStatus(sessions: any[]): CliAgentStatus {
  const now = Date.now()
  // Include sessions that are active OR ended within the grace period
  const visible = sessions.filter(
    (s: any) => !s.endedAt || (now - s.endedAt) < TERMINAL_GRACE_MS
  )
  const latest = visible.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated)[0]
  return latest?.status ?? 'idle'
}

export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')
  const graceTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI
    api?.getCurrentAgentStatus?.().then((file: any) => {
      if (file?.sessions) {
        setStatus(pickLatestStatus(Object.values(file.sessions)))
      }
    }).catch(() => {})

    const unsub = api?.onAgentStatusChanged?.((file: any) => {
      if (file?.sessions) {
        const sessions = Object.values(file.sessions) as any[]
        const next = pickLatestStatus(sessions)
        setStatus(next)

        // If showing a terminal state, schedule a re-evaluation after the grace period
        if (next === 'completed' || next === 'error') {
          clearTimeout(graceTimerRef.current)
          graceTimerRef.current = setTimeout(() => {
            setStatus(pickLatestStatus(sessions))
          }, TERMINAL_GRACE_MS)
        }
      }
    })

    return () => {
      unsub?.()
      clearTimeout(graceTimerRef.current)
    }
  }, [])

  return { status }
}
