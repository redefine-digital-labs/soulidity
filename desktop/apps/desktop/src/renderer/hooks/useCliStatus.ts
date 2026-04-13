import { useState, useEffect, useRef } from 'react'
import {
  CLI_TERMINAL_GRACE_MS,
  deriveAggregateStatus,
  type AgentStatusFile,
  type CliAgentStatus,
} from '@soulidity/shared'

function deriveStatus(file: unknown): CliAgentStatus {
  const statusFile = file as AgentStatusFile | null
  if (!statusFile?.sessions) return 'idle'
  return deriveAggregateStatus(statusFile, {
    now: Date.now(),
    terminalGraceMs: CLI_TERMINAL_GRACE_MS,
  })
}

export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')
  const graceTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI
    api?.getCurrentAgentStatus?.().then((file: any) => {
      setStatus(deriveStatus(file))
    }).catch(() => {})

    const unsub = api?.onAgentStatusChanged?.((file: any) => {
      const next = deriveStatus(file)
      setStatus(next)

      // Always cancel the previous grace timeout — a stale closure would overwrite
      // a fresh active status back to idle when it fires
      clearTimeout(graceTimerRef.current)

      // If showing a terminal state, schedule a re-evaluation after the grace period
      if (next === 'completed' || next === 'error') {
        graceTimerRef.current = setTimeout(() => {
          setStatus(deriveStatus(file))
        }, CLI_TERMINAL_GRACE_MS)
      }
    })

    return () => {
      unsub?.()
      clearTimeout(graceTimerRef.current)
    }
  }, [])

  return { status }
}
