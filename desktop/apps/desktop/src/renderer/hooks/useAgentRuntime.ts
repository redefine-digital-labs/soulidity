import { useEffect, useState } from 'react'
import type { AgentRuntimeSnapshot } from '@soulidity/shared'

export function useAgentRuntime() {
  const [snapshot, setSnapshot] = useState<AgentRuntimeSnapshot | null>(null)

  useEffect(() => {
    let disposed = false

    window.electronAPI.getCurrentAgentRuntime()
      .then((next) => {
        if (!disposed) setSnapshot(next)
      })
      .catch(() => {})

    const unsubscribe = window.electronAPI.onAgentRuntimeChanged((next) => {
      setSnapshot(next)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return { snapshot }
}
