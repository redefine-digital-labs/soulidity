import React, { useEffect, useMemo, useState } from 'react'
import type { PendingPermission, PendingQuestion, RuntimeSession } from '@soulidity/shared'
import { useAgentRuntime } from '../../hooks/useAgentRuntime'

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

function formatSourceLabel(source?: string): string {
  switch (source) {
    case 'claude': return 'Claude Code'
    case 'codex': return 'Codex'
    case 'gemini': return 'Gemini CLI'
    case 'cursor': return 'Cursor'
    case 'trae': return 'Trae'
    case 'traecn': return 'Trae CN'
    case 'qoder': return 'Qoder'
    case 'droid': return 'Factory'
    case 'codebuddy': return 'CodeBuddy'
    case 'codybuddycn': return 'CodyBuddyCN'
    case 'copilot': return 'GitHub Copilot'
    case 'kimi': return 'Kimi Code CLI'
    case 'opencode': return 'OpenCode'
    default: return source || 'Custom'
  }
}

function formatRuntimeStatus(status: RuntimeSession['status']): string {
  switch (status) {
    case 'processing': return 'thinking'
    case 'running': return 'working'
    case 'waiting-approval':
    case 'waiting-question':
      return 'needs-attention'
    default:
      return status
  }
}

function summarizePath(filePath?: string): string | undefined {
  if (!filePath) return undefined
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 3) return filePath
  return `.../${parts.slice(-3).join('/')}`
}

export function AgentTab(): React.JSX.Element {
  const { snapshot } = useAgentRuntime()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})

  const sessions = useMemo(() => {
    const values = Object.values(snapshot?.sessions ?? {})
    return values.sort((a, b) => {
      if (a.endedAt && !b.endedAt) return 1
      if (!a.endedAt && b.endedAt) return -1
      return b.lastUpdated - a.lastUpdated
    })
  }, [snapshot])

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null)
      return
    }
    if (!selectedSessionId || !sessions.some((session) => session.sessionId === selectedSessionId)) {
      setSelectedSessionId(sessions[0].sessionId)
    }
  }, [selectedSessionId, sessions])

  const activeSessions = sessions.filter((session) => !session.endedAt)
  const recentSessions = sessions.filter((session) => session.endedAt)
  const currentSession = sessions.find((session) => session.sessionId === selectedSessionId) ?? null
  const currentPermission = snapshot?.pendingPermissions.find((item) => item.sessionId === currentSession?.sessionId) ?? null
  const currentQuestion = snapshot?.pendingQuestions.find((item) => item.sessionId === currentSession?.sessionId) ?? null
  const currentPermissionCommand = typeof currentPermission?.toolInput?.command === 'string'
    ? currentPermission.toolInput.command
    : undefined
  const currentPermissionFilePath = typeof currentPermission?.toolInput?.file_path === 'string'
    ? currentPermission.toolInput.file_path
    : undefined

  const handleApprove = async (request: PendingPermission, allowAlways = false): Promise<void> => {
    await window.electronAPI.approveAgentPermission(request.requestId, allowAlways)
  }

  const handleDeny = async (request: PendingPermission): Promise<void> => {
    await window.electronAPI.denyAgentPermission(request.requestId)
  }

  const handleAnswerQuestion = async (question: PendingQuestion, answer: string): Promise<void> => {
    if (!answer.trim()) return
    await window.electronAPI.answerAgentQuestion(question.requestId, answer.trim())
    setDraftAnswers((current) => {
      const next = { ...current }
      delete next[question.requestId]
      return next
    })
  }

  const handleSkipQuestion = async (question: PendingQuestion): Promise<void> => {
    await window.electronAPI.skipAgentQuestion(question.requestId)
    setDraftAnswers((current) => {
      const next = { ...current }
      delete next[question.requestId]
      return next
    })
  }

  return (
    <div className="tab-content agent-console">
      <section className="settings-section">
        <h3 className="settings-section__title">Runtime</h3>
        <div className="agent-runtime-grid">
          <div className="agent-runtime-stat">
            <span className="agent-runtime-stat__label">Transport</span>
            <strong>{snapshot?.transport.status ?? 'starting'}</strong>
            {snapshot?.transport.endpoint && <span>{snapshot.transport.endpoint}</span>}
          </div>
          <div className="agent-runtime-stat">
            <span className="agent-runtime-stat__label">Active</span>
            <strong>{activeSessions.length}</strong>
            <span>{snapshot?.pendingPermissions.length ?? 0} permissions / {snapshot?.pendingQuestions.length ?? 0} questions</span>
          </div>
          <div className="agent-runtime-stat">
            <span className="agent-runtime-stat__label">Hooks</span>
            <strong>{snapshot?.hooks.filter((hook) => hook.installed).length ?? 0}</strong>
            <span>{snapshot?.hooks.filter((hook) => hook.detected).length ?? 0} detected tools</span>
          </div>
        </div>
      </section>

      <section className="settings-section agent-console__body">
        <div className="agent-session-list">
          <div className="agent-session-list__title">Sessions</div>
          {sessions.length === 0 && <p className="agent-empty">No active runtime sessions</p>}
          {sessions.map((session) => {
            const displayStatus = formatRuntimeStatus(session.status)
            return (
              <button
                key={session.sessionId}
                type="button"
                className={`agent-session-row${selectedSessionId === session.sessionId ? ' agent-session-row--active' : ''}`}
                onClick={() => setSelectedSessionId(session.sessionId)}
              >
                <div className="agent-session-row__top">
                  <span>{formatSourceLabel(session.source)}</span>
                  <span className={`agent-card__status agent-card__status--${displayStatus}`}>{displayStatus}</span>
                </div>
                <div className="agent-session-row__title">
                  {session.sessionTitle || summarizePath(session.workingDirectory) || session.sessionId}
                </div>
                <div className="agent-session-row__meta">
                  {formatTime(session.lastUpdated)} · {formatDuration(session.startedAt, session.endedAt)}
                </div>
              </button>
            )
          })}
        </div>

        <div className="agent-session-detail">
          {!currentSession && <p className="agent-empty">Choose a session to inspect details</p>}

          {currentSession && (
            <>
              <div className="agent-detail-card">
                <div className="agent-detail-card__header">
                  <div>
                    <div className="agent-detail-card__title">
                      {currentSession.sessionTitle || currentSession.sessionId}
                    </div>
                    <div className="agent-detail-card__subtitle">
                      {formatSourceLabel(currentSession.source)} · {currentSession.sessionId}
                    </div>
                  </div>
                  <span className={`agent-card__status agent-card__status--${formatRuntimeStatus(currentSession.status)}`}>
                    {formatRuntimeStatus(currentSession.status)}
                  </span>
                </div>

                <div className="agent-detail-grid">
                  {currentSession.taskId && (
                    <div>
                      <span className="agent-detail-grid__label">Task ID</span>
                      <div className="agent-detail-grid__value">{currentSession.taskId}</div>
                    </div>
                  )}
                  <div>
                    <span className="agent-detail-grid__label">Working Dir</span>
                    <div className="agent-detail-grid__value">{currentSession.workingDirectory || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="agent-detail-grid__label">Current Tool</span>
                    <div className="agent-detail-grid__value">
                      {currentSession.currentTool
                        ? `${currentSession.currentTool}${currentSession.toolDescription ? ` · ${currentSession.toolDescription}` : ''}`
                        : 'Idle'}
                    </div>
                  </div>
                  <div>
                    <span className="agent-detail-grid__label">Started</span>
                    <div className="agent-detail-grid__value">{formatTime(currentSession.startedAt)}</div>
                  </div>
                  <div>
                    <span className="agent-detail-grid__label">Updated</span>
                    <div className="agent-detail-grid__value">{formatTime(currentSession.lastUpdated)}</div>
                  </div>
                </div>
              </div>

              {currentPermission && (
                <div className="agent-detail-card agent-detail-card--attention">
                  <div className="agent-detail-card__title">Permission Request</div>
                  <div className="agent-detail-card__subtitle">
                    {currentPermission.toolName}
                    {currentPermissionCommand && ` · ${currentPermissionCommand}`}
                    {currentPermissionFilePath && ` · ${currentPermissionFilePath}`}
                  </div>
                  <div className="agent-detail-actions">
                    <button type="button" className="link-button" onClick={() => { void handleApprove(currentPermission) }}>
                      Allow Once
                    </button>
                    <button type="button" className="link-button" onClick={() => { void handleApprove(currentPermission, true) }}>
                      Allow Always
                    </button>
                    <button type="button" className="link-button link-button--secondary" onClick={() => { void handleDeny(currentPermission) }}>
                      Deny
                    </button>
                  </div>
                </div>
              )}

              {currentQuestion && (
                <div className="agent-detail-card agent-detail-card--attention">
                  <div className="agent-detail-card__title">Question</div>
                  <div className="agent-detail-card__subtitle">{currentQuestion.question}</div>

                  {currentQuestion.options && currentQuestion.options.length > 0 ? (
                    <>
                      <div className="agent-option-list">
                        {currentQuestion.options.map((option, index) => (
                          <button
                            key={option}
                            type="button"
                            className="agent-option-button"
                            onClick={() => { void handleAnswerQuestion(currentQuestion, option) }}
                          >
                            <span>{option}</span>
                            {currentQuestion.descriptions?.[index] && (
                              <small>{currentQuestion.descriptions[index]}</small>
                            )}
                          </button>
                        ))}
                      </div>
                      <div className="agent-detail-actions">
                        <button
                          type="button"
                          className="link-button link-button--secondary"
                          onClick={() => { void handleSkipQuestion(currentQuestion) }}
                        >
                          Skip
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="agent-question-form">
                      <textarea
                        className="task-panel__textarea agent-question-form__textarea"
                        placeholder="Type your answer"
                        value={draftAnswers[currentQuestion.requestId] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setDraftAnswers((current) => ({ ...current, [currentQuestion.requestId]: value }))
                        }}
                      />
                      <div className="agent-detail-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => { void handleAnswerQuestion(currentQuestion, draftAnswers[currentQuestion.requestId] ?? '') }}
                        >
                          Submit
                        </button>
                        <button
                          type="button"
                          className="link-button link-button--secondary"
                          onClick={() => { void handleSkipQuestion(currentQuestion) }}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="agent-detail-columns">
                <div className="agent-detail-card">
                  <div className="agent-detail-card__title">Recent Tools</div>
                  {currentSession.toolHistory.length === 0 && <p className="agent-empty">No tool activity yet</p>}
                  {currentSession.toolHistory.slice().reverse().map((entry, index) => (
                    <div key={`${entry.tool}-${entry.timestamp}-${index}`} className="agent-timeline-row">
                      <strong>{entry.tool}</strong>
                      <span>{entry.description || 'No details'}</span>
                      <small>{formatTime(entry.timestamp)}</small>
                    </div>
                  ))}
                </div>

                <div className="agent-detail-card">
                  <div className="agent-detail-card__title">Recent Messages</div>
                  {currentSession.recentMessages.length === 0 && <p className="agent-empty">No messages recorded</p>}
                  {currentSession.recentMessages.slice().reverse().map((message, index) => (
                    <div key={`${message.role}-${message.timestamp}-${index}`} className="agent-message-row">
                      <strong>{message.role}</strong>
                      <span>{message.text}</span>
                      <small>{formatTime(message.timestamp)}</small>
                    </div>
                  ))}
                </div>
              </div>

              {recentSessions.length > 0 && (
                <div className="agent-detail-card">
                  <div className="agent-detail-card__title">Recent Sessions</div>
                  {recentSessions.slice(0, 5).map((session) => (
                    <div key={session.sessionId} className="agent-timeline-row">
                      <strong>{formatSourceLabel(session.source)}</strong>
                      <span>{session.sessionTitle || session.sessionId}</span>
                      <small>{formatDuration(session.startedAt, session.endedAt)}</small>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
