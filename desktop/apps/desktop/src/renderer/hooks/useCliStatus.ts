import { useState, useEffect } from 'react'

export type CliAgentStatus = 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'

export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI
    api?.getCurrentAgentStatus?.().then((file: any) => {
      if (file?.sessions) {
        const sessions = Object.values(file.sessions) as any[]
        const active = sessions.filter((s: any) => !s.endedAt)
        const latest = active.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated)[0]
        if (latest) setStatus(latest.status)
      }
    }).catch(() => {})

    const unsub = api?.onAgentStatusChanged?.((file: any) => {
      if (file?.sessions) {
        const sessions = Object.values(file.sessions) as any[]
        const active = sessions.filter((s: any) => !s.endedAt)
        const latest = active.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated)[0]
        setStatus(latest?.status ?? 'idle')
      }
    })
    return () => { unsub?.() }
  }, [])

  return { status }
}
