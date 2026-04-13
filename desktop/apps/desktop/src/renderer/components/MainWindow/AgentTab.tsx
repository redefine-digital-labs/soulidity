import React, { useState, useEffect } from 'react'

interface AgentSessionInfo {
  sessionId: string
  clientType: string
  status: string
  source?: string
  workingDirectory?: string
  sessionTitle?: string
  currentAction?: { tool?: string; details?: string }
  startedAt: number
  lastUpdated: number
  endedAt?: number
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function formatDuration(startMs: number, endMs?: number): string {
  const elapsed = (endMs ?? Date.now()) - startMs
  const mins = Math.floor(elapsed / 60_000)
  if (mins < 1) return '< 1m'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function AgentTab(): React.JSX.Element {
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])

  useEffect(() => {
    const fetchSessions = (): void => {
      window.electronAPI.getCurrentAgentStatus().then((file: unknown) => {
        const f = file as { sessions?: Record<string, AgentSessionInfo> } | null
        if (f?.sessions) {
          const list = Object.values(f.sessions)
            .sort((a, b) => b.lastUpdated - a.lastUpdated)
          setSessions(list)
        }
      }).catch(() => {})
    }

    fetchSessions()
    const timer = setInterval(fetchSessions, 5000)

    const unsub = window.electronAPI.onAgentStatusChanged((file: unknown) => {
      const f = file as { sessions?: Record<string, AgentSessionInfo> } | null
      if (f?.sessions) {
        const list = Object.values(f.sessions)
          .sort((a, b) => b.lastUpdated - a.lastUpdated)
        setSessions(list)
      }
    })

    return () => {
      clearInterval(timer)
      unsub()
    }
  }, [])

  const active = sessions.filter((s) => !s.endedAt)
  const recent = sessions.filter((s) => s.endedAt).slice(0, 5)

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Active Sessions ({active.length})</h3>
        {active.length === 0 && (
          <p className="agent-empty">No active CLI agents detected</p>
        )}
        {active.map((s) => (
          <div key={s.sessionId} className="agent-card">
            <div className="agent-card__header">
              <span className="agent-card__type">{s.clientType}</span>
              <span className={`agent-card__status agent-card__status--${s.status}`}>{s.status}</span>
              {s.source && <span className="agent-card__source">{s.source}</span>}
            </div>
            {s.workingDirectory && (
              <div className="agent-card__detail">{s.workingDirectory}</div>
            )}
            {s.currentAction?.tool && (
              <div className="agent-card__detail">
                {s.currentAction.tool}{s.currentAction.details ? `: ${s.currentAction.details}` : ''}
              </div>
            )}
            <div className="agent-card__meta">
              Started {formatTime(s.startedAt)} | {formatDuration(s.startedAt)}
            </div>
          </div>
        ))}
      </section>

      {recent.length > 0 && (
        <section className="settings-section">
          <h3 className="settings-section__title">Recent</h3>
          {recent.map((s) => (
            <div key={s.sessionId} className="agent-card agent-card--ended">
              <div className="agent-card__header">
                <span className="agent-card__type">{s.clientType}</span>
                <span className="agent-card__status agent-card__status--ended">{s.status}</span>
              </div>
              <div className="agent-card__meta">
                {formatTime(s.startedAt)} - {formatTime(s.endedAt!)} | {formatDuration(s.startedAt, s.endedAt)}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
