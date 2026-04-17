import React, { useCallback, useEffect, useState } from 'react'
import type { HookInstallStatus } from '@soulidity/shared'
import { useCliStatus } from '../../hooks/useCliStatus'
import { useAgentRuntime } from '../../hooks/useAgentRuntime'

export function HooksTab(): React.JSX.Element {
  const [hookStatuses, setHookStatuses] = useState<HookInstallStatus[]>([])
  const [hookAction, setHookAction] = useState<'idle' | 'install' | 'repair' | 'uninstall'>('idle')
  const { status: cliStatus } = useCliStatus()
  const { snapshot } = useAgentRuntime()

  useEffect(() => {
    window.electronAPI.getHookInstallStatus().then(setHookStatuses).catch(() => {})
  }, [])

  useEffect(() => {
    if (snapshot?.hooks) {
      setHookStatuses(snapshot.hooks)
    }
  }, [snapshot?.hooks])

  const runHookAction = useCallback(async (action: 'install' | 'repair' | 'uninstall') => {
    setHookAction(action)
    try {
      const next = action === 'install'
        ? await window.electronAPI.installHooks()
        : action === 'repair'
          ? await window.electronAPI.repairHooks()
          : await window.electronAPI.uninstallHooks()
      setHookStatuses(next)
    } finally {
      setHookAction('idle')
    }
  }, [])

  const needsInstall = hookStatuses.some((h) => h.detected && !h.installed)
  const needsRepair = hookStatuses.some((h) => h.detected && h.installed && !h.healthy)
  const hasAnyInstalled = hookStatuses.some((h) => h.installed)
  const isBusy = hookAction !== 'idle'
  const hasAnyAction = needsInstall || needsRepair || hasAnyInstalled

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Hooks &amp; Integrations</h3>

        <div className="hooks-actions">
          {needsInstall && (
            <button
              type="button"
              className="link-button"
              disabled={isBusy}
              onClick={() => { void runHookAction('install') }}
              title="Install hooks for detected CLIs that don't have them yet"
            >
              Install All
            </button>
          )}
          {needsRepair && (
            <button
              type="button"
              className="link-button"
              disabled={isBusy}
              onClick={() => { void runHookAction('repair') }}
              title="Repair hooks that are installed but no longer healthy"
            >
              Repair
            </button>
          )}
          {hasAnyInstalled && (
            <button
              type="button"
              className="link-button link-button--secondary"
              disabled={isBusy}
              onClick={() => { void runHookAction('uninstall') }}
              title="Remove Soulidity hooks from every detected CLI"
            >
              Uninstall
            </button>
          )}
          {!hasAnyAction && (
            <p className="hooks-actions__empty">No hook actions available.</p>
          )}
        </div>

        <div className="settings-field">
          <span className="settings-field__label">CLI Status</span>
          <input
            type="text"
            className="settings-field__input"
            value={cliStatus}
            readOnly
          />
        </div>

        <div className="settings-field">
          <span className="settings-field__label">Transport</span>
          <input
            type="text"
            className="settings-field__input"
            value={snapshot?.transport.endpoint
              ? `${snapshot.transport.status} · ${snapshot.transport.endpoint}`
              : snapshot?.transport.status ?? 'starting'}
            readOnly
          />
        </div>

        <div className="agent-hook-list">
          {hookStatuses.map((status) => (
            <div key={status.source} className="agent-hook-row">
              <div>
                <div className="agent-hook-row__title">{status.label}</div>
                <div className="agent-hook-row__meta">
                  {status.detected
                    ? status.installed
                      ? status.healthy ? 'installed' : 'needs repair'
                      : 'not installed'
                    : 'not detected'}
                  {status.configPath ? ` · ${status.configPath}` : ''}
                </div>
              </div>
              <span className={`agent-card__status agent-card__status--${status.installed ? (status.healthy ? 'working' : 'needs-attention') : 'idle'}`}>
                {status.detected ? (status.installed ? (status.healthy ? 'ready' : 'repair') : 'off') : 'missing'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
