import React, { useState, useEffect, useCallback, useRef } from 'react'

interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

const LINK_VERIFICATION_FAILED_MESSAGE = 'Saved desktop link could not be verified. Unlink this device and link again.'

type LinkState =
  | { phase: 'restoring' }
  | { phase: 'idle' }
  | { phase: 'linking'; userCode: string; deviceCode: string; linkUrl: string; expiresAt: string }
  | { phase: 'confirmed'; accountId: string }
  | { phase: 'error'; message: string; canUnlink?: boolean }

function getRestoredAccountId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null

  const profile = (value as Record<string, unknown>).profile
  if (!profile || typeof profile !== 'object') return null

  const accountId = (profile as Record<string, unknown>).accountId
  return typeof accountId === 'string' && accountId.trim() ? accountId : null
}

export function SettingsTab(): React.JSX.Element {
  const [keypair, setKeypair] = useState<AgentKeypairInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [storageStatus, setStorageStatus] = useState<string>('...')
  const [linkState, setLinkState] = useState<LinkState>({ phase: 'restoring' })
  const [unlinking, setUnlinking] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    window.electronAPI.loadAgentKeypair().then((kp) => {
      if (kp) setKeypair(kp as AgentKeypairInfo)
    })
    window.electronAPI.getSecretStorageStatus().then((s) => {
      setStorageStatus(s === 'encrypted' ? 'OS Keychain' : s === 'legacy' ? 'JSON (legacy)' : 'Not found')
    })

    void window.electronAPI.getDesktopAuthStatus().then(async (status) => {
      if (cancelled) return

      if (!status.hasToken) {
        setLinkState({ phase: 'idle' })
        return
      }

      try {
        const me = await window.electronAPI.getDesktopMe()
        if (cancelled) return

        const restoredAccountId = getRestoredAccountId(me)
        if (restoredAccountId) {
          setLinkState({ phase: 'confirmed', accountId: restoredAccountId })
          return
        }
      } catch {
        if (cancelled) return
      }

      setLinkState({ phase: 'error', message: LINK_VERIFICATION_FAILED_MESSAGE, canUnlink: true })
    }).catch(() => {
      if (cancelled) return
      setLinkState({ phase: 'idle' })
    })

    return () => {
      cancelled = true
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

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

  const handleUnlink = useCallback(async () => {
    if (!window.confirm('Unlink this device from your Soulidity account?')) return
    setUnlinking(true)
    try {
      const result = await window.electronAPI.unlinkDesktopDevice()
      if (result.ok) {
        setLinkState({ phase: 'idle' })
      } else {
        setLinkState({ phase: 'error', message: result.error || 'Failed to unlink device' })
      }
    } catch (err) {
      setLinkState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to unlink device' })
    } finally {
      setUnlinking(false)
    }
  }, [])

  const truncateAddress = (addr: string): string => {
    if (addr.length <= 16) return addr
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`
  }

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

        {linkState.phase === 'restoring' && (
          <div className="link-panel">
            <p className="link-panel__status">Checking saved link...</p>
          </div>
        )}

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
            <button
              className="link-button link-button--secondary"
              onClick={() => { void handleUnlink() }}
              disabled={unlinking}
            >
              {unlinking ? 'Unlinking…' : 'Unlink Device'}
            </button>
          </div>
        )}

        {linkState.phase === 'error' && (
          <div className="link-panel">
            <p className="link-panel__error">{linkState.message}</p>
            {linkState.canUnlink ? (
              <button
                className="link-button link-button--secondary"
                onClick={() => { void handleUnlink() }}
                disabled={unlinking}
              >
                {unlinking ? 'Unlinking…' : 'Unlink Device'}
              </button>
            ) : (
              <button className="link-button" onClick={handleStartLink} disabled={!keypair}>
                Try Again
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
