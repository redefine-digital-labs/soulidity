import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { HookInstallStatus } from '@soulidity/shared'
import { useCliStatus } from '../../hooks/useCliStatus'
import { useAgentRuntime } from '../../hooks/useAgentRuntime'

interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

type LinkState =
  | { phase: 'idle' }
  | { phase: 'linking'; userCode: string; deviceCode: string; linkUrl: string; expiresAt: string }
  | { phase: 'confirmed'; accountId: string }
  | { phase: 'error'; message: string }

export function SettingsTab(): React.JSX.Element {
  const [keypair, setKeypair] = useState<AgentKeypairInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [storageStatus, setStorageStatus] = useState<string>('...')
  const [linkState, setLinkState] = useState<LinkState>({ phase: 'idle' })
  const [hookStatuses, setHookStatuses] = useState<HookInstallStatus[]>([])
  const [hookAction, setHookAction] = useState<'idle' | 'install' | 'repair' | 'uninstall'>('idle')
  const { status: cliStatus } = useCliStatus()
  const { snapshot } = useAgentRuntime()
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    window.electronAPI.loadAgentKeypair().then((kp) => {
      if (kp) setKeypair(kp as AgentKeypairInfo)
    })
    window.electronAPI.getSecretStorageStatus().then((s) => {
      setStorageStatus(s === 'encrypted' ? 'OS Keychain' : s === 'legacy' ? 'JSON (legacy)' : 'Not found')
    })
    window.electronAPI.getHookInstallStatus().then(setHookStatuses).catch(() => {})
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (snapshot?.hooks) {
      setHookStatuses(snapshot.hooks)
    }
  }, [snapshot?.hooks])

  const handleCopyAddress = useCallback(async () => {
    if (!keypair?.address) return
    await navigator.clipboard.writeText(keypair.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [keypair])

  const handleStartLink = useCallback(async () => {
    if (!keypair?.address) return

    try {
      const [session, linkUrl] = await Promise.all([
        window.electronAPI.deviceStartLink(keypair.address),
        window.electronAPI.deviceGetLinkUrl(),
      ])

      setLinkState({
        phase: 'linking',
        userCode: session.userCode,
        deviceCode: session.deviceCode,
        linkUrl,
        expiresAt: session.expiresAt,
      })

      // Start polling
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      pollTimerRef.current = setInterval(async () => {
        try {
          const poll = await window.electronAPI.devicePoll(session.deviceCode)
          if (poll.status === 'confirmed' && poll.accountId) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current)
            setLinkState({ phase: 'confirmed', accountId: poll.accountId })
          } else if (poll.status === 'expired') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current)
            setLinkState({ phase: 'error', message: 'Code expired. Try again.' })
          }
        } catch { /* keep polling */ }
      }, (session.pollInterval || 5) * 1000)
    } catch (err) {
      setLinkState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to start linking' })
    }
  }, [keypair])

  const handleCancelLink = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    setLinkState({ phase: 'idle' })
  }, [])

  const truncateAddress = (addr: string): string => {
    if (addr.length <= 16) return addr
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`
  }

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

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Agent Wallet</h3>

        <div className="settings-field">
          <span className="settings-field__label">Sui Address</span>
          <div className="settings-field__input-group">
            <input
              type="text"
              className="settings-field__input"
              value={keypair ? truncateAddress(keypair.address) : 'Generating...'}
              readOnly
              title={keypair?.address}
            />
            <button
              className="settings-field__toggle"
              onClick={handleCopyAddress}
              title={copied ? 'Copied!' : 'Copy address'}
              disabled={!keypair}
            >
              {copied ? '\u2713' : '\u2398'}
            </button>
          </div>
        </div>

        {keypair && (
          <div className="settings-field">
            <span className="settings-field__label">Created</span>
            <input
              type="text"
              className="settings-field__input"
              value={new Date(keypair.createdAt).toLocaleDateString()}
              readOnly
            />
          </div>
        )}

        <div className="settings-field">
          <span className="settings-field__label">Key Storage</span>
          <input
            type="text"
            className="settings-field__input"
            value={storageStatus}
            readOnly
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Account Link</h3>

        {linkState.phase === 'idle' && (
          <button
            className="link-button"
            onClick={handleStartLink}
            disabled={!keypair}
          >
            Link to Web Account
          </button>
        )}

        {linkState.phase === 'linking' && (
          <div className="link-panel">
            <p className="link-panel__instruction">
              Open the link below and enter this code:
            </p>
            <div className="link-panel__code">{linkState.userCode}</div>
            <div className="link-panel__url">
              <input
                type="text"
                className="settings-field__input"
                value={linkState.linkUrl}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <p className="link-panel__status">Waiting for confirmation...</p>
            <button className="link-button link-button--secondary" onClick={handleCancelLink}>
              Cancel
            </button>
          </div>
        )}

        {linkState.phase === 'confirmed' && (
          <div className="link-panel link-panel--success">
            <p className="link-panel__status">Linked to account</p>
            <input
              type="text"
              className="settings-field__input"
              value={truncateAddress(linkState.accountId)}
              readOnly
              title={linkState.accountId}
            />
          </div>
        )}

        {linkState.phase === 'error' && (
          <div className="link-panel">
            <p className="link-panel__error">{linkState.message}</p>
            <button className="link-button" onClick={handleStartLink} disabled={!keypair}>
              Try Again
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section__title-row">
          <h3 className="settings-section__title">Hooks &amp; Integrations</h3>
          <div className="agent-detail-actions">
            <button
              type="button"
              className="link-button"
              disabled={hookAction !== 'idle'}
              onClick={() => { void runHookAction('install') }}
            >
              Install All
            </button>
            <button
              type="button"
              className="link-button"
              disabled={hookAction !== 'idle'}
              onClick={() => { void runHookAction('repair') }}
            >
              Repair
            </button>
            <button
              type="button"
              className="link-button link-button--secondary"
              disabled={hookAction !== 'idle'}
              onClick={() => { void runHookAction('uninstall') }}
            >
              Uninstall
            </button>
          </div>
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
