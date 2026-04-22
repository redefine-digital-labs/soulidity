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
  | { phase: 'linking'; userCode: string; deviceCode: string; linkUrl: string; expiresAt: string; statusText: string }
  | { phase: 'confirmed'; accountId: string; suiAddress: string | null }
  | { phase: 'error'; message: string; canUnlink?: boolean }

interface RestoredIdentity {
  accountId: string
  suiAddress: string | null
}

type PendingLinkVerificationResult = 'confirmed' | 'invalid' | 'retry'

function getRestoredIdentity(value: unknown): RestoredIdentity | null {
  if (!value || typeof value !== 'object') return null

  const profile = (value as Record<string, unknown>).profile
  if (!profile || typeof profile !== 'object') return null

  const profileRecord = profile as Record<string, unknown>
  const accountId = profileRecord.accountId
  if (typeof accountId !== 'string' || !accountId.trim()) return null

  const rawSui = profileRecord.primarySuiAddress
  const suiAddress = typeof rawSui === 'string' && rawSui.trim() ? rawSui : null

  return { accountId, suiAddress }
}

export function SettingsTab(): React.JSX.Element {
  const [keypair, setKeypair] = useState<AgentKeypairInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [storageStatus, setStorageStatus] = useState<string>('...')
  const [linkState, setLinkState] = useState<LinkState>({ phase: 'restoring' })
  const [unlinking, setUnlinking] = useState(false)
  const [enhancedMotion, setEnhancedMotion] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const linkSessionNonceRef = useRef(0)
  const linkVerificationInFlightRef = useRef<number | null>(null)

  const stopPolling = useCallback((timer?: ReturnType<typeof setInterval> | null) => {
    const activeTimer = timer ?? pollTimerRef.current
    if (!activeTimer) return
    clearInterval(activeTimer)
    if (!timer || pollTimerRef.current === activeTimer) {
      pollTimerRef.current = null
    }
  }, [])

  const getVerifiedDesktopIdentity = useCallback(async (): Promise<RestoredIdentity | null> => {
    const me = await window.electronAPI.getDesktopMe()
    return getRestoredIdentity(me)
  }, [])

  const confirmPendingLink = useCallback(async (sessionNonce: number): Promise<PendingLinkVerificationResult> => {
    if (linkVerificationInFlightRef.current === sessionNonce) {
      return 'retry'
    }

    linkVerificationInFlightRef.current = sessionNonce
    try {
      const restored = await getVerifiedDesktopIdentity()
      if (linkSessionNonceRef.current !== sessionNonce) return 'retry'

      if (restored) {
        setLinkState({ phase: 'confirmed', accountId: restored.accountId, suiAddress: restored.suiAddress })
        return 'confirmed'
      }
      setLinkState({ phase: 'error', message: LINK_VERIFICATION_FAILED_MESSAGE, canUnlink: true })
      return 'invalid'
    } catch {
      if (linkSessionNonceRef.current !== sessionNonce) return 'retry'
      return 'retry'
    } finally {
      if (linkVerificationInFlightRef.current === sessionNonce) {
        linkVerificationInFlightRef.current = null
      }
    }
  }, [getVerifiedDesktopIdentity])

  useEffect(() => {
    let cancelled = false

    window.electronAPI.loadAgentKeypair().then((kp) => {
      if (kp) setKeypair(kp as AgentKeypairInfo)
    })
    window.electronAPI.getSecretStorageStatus().then((s) => {
      setStorageStatus(s === 'encrypted' ? 'OS Keychain' : s === 'legacy' ? 'JSON (legacy)' : 'Not found')
    })
    const configPromise = window.electronAPI.getConfig?.()
    configPromise?.then((config) => {
      if (cancelled) return
      setEnhancedMotion(Boolean(config.petEnhancedMotion))
    }).catch(() => {})

    void window.electronAPI.getDesktopAuthStatus().then(async (status) => {
      if (cancelled) return

      if (!status.hasToken) {
        setLinkState({ phase: 'idle' })
        return
      }

      try {
        const restored = await getVerifiedDesktopIdentity()
        if (cancelled) return

        if (restored) {
          setLinkState({ phase: 'confirmed', accountId: restored.accountId, suiAddress: restored.suiAddress })
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

    const unsubscribeConfig = window.electronAPI.onConfigChanged?.((config) => {
      if (!cancelled) {
        setEnhancedMotion(Boolean(config.petEnhancedMotion))
      }
    })

    return () => {
      cancelled = true
      linkSessionNonceRef.current += 1
      linkVerificationInFlightRef.current = null
      stopPolling()
      unsubscribeConfig?.()
    }
  }, [getVerifiedDesktopIdentity, stopPolling])

  const handleCopyAddress = useCallback(async () => {
    if (!keypair?.address) return
    await navigator.clipboard.writeText(keypair.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [keypair])

  const handleStartLink = useCallback(async () => {
    if (!keypair?.address) return
    linkSessionNonceRef.current += 1
    linkVerificationInFlightRef.current = null
    const sessionNonce = linkSessionNonceRef.current
    stopPolling()

    try {
      const [session, linkUrl] = await Promise.all([
        window.electronAPI.deviceStartLink(keypair.address),
        window.electronAPI.deviceGetLinkUrl(),
      ])
      if (linkSessionNonceRef.current !== sessionNonce) return

      setLinkState({
        phase: 'linking',
        userCode: session.userCode,
        deviceCode: session.deviceCode,
        linkUrl,
        expiresAt: session.expiresAt,
        statusText: 'Waiting for confirmation...',
      })

      // Start polling
      const timer = setInterval(async () => {
        try {
          const poll = await window.electronAPI.devicePoll(session.deviceCode)
          if (linkSessionNonceRef.current !== sessionNonce) return

          if (poll.status === 'confirmed') {
            setLinkState((current) => (
              current.phase === 'linking'
                ? { ...current, statusText: 'Verifying linked account...' }
                : current
            ))
            const verification = await confirmPendingLink(sessionNonce)
            if (linkSessionNonceRef.current !== sessionNonce) return
            if (verification === 'confirmed' || verification === 'invalid') {
              stopPolling(timer)
            }
          } else if (poll.status === 'expired') {
            stopPolling(timer)
            setLinkState({ phase: 'error', message: 'Code expired. Try again.' })
          }
        } catch { /* keep polling */ }
      }, (session.pollInterval || 5) * 1000)
      pollTimerRef.current = timer
    } catch (err) {
      if (linkSessionNonceRef.current !== sessionNonce) return
      setLinkState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to start linking' })
    }
  }, [confirmPendingLink, keypair, stopPolling])

  const handleCancelLink = useCallback(() => {
    linkSessionNonceRef.current += 1
    linkVerificationInFlightRef.current = null
    stopPolling()
    setLinkState({ phase: 'idle' })
  }, [stopPolling])

  const handleUnlink = useCallback(async () => {
    if (!window.confirm('Unlink this device from your Soulidity account?')) return
    linkSessionNonceRef.current += 1
    linkVerificationInFlightRef.current = null
    stopPolling()
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
  }, [stopPolling])

  const handleToggleEnhancedMotion = useCallback(async () => {
    const next = !enhancedMotion
    setEnhancedMotion(next)
    try {
      await window.electronAPI.setConfig?.({ petEnhancedMotion: next })
    } catch {
      setEnhancedMotion((current) => !current)
    }
  }, [enhancedMotion])

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
            <p className="link-panel__status">{linkState.statusText}</p>
            <button className="link-button link-button--secondary" onClick={handleCancelLink}>
              Cancel
            </button>
          </div>
        )}

        {linkState.phase === 'confirmed' && (
          <div className="link-panel link-panel--success">
            <p className="link-panel__status">
              {linkState.suiAddress ? 'Linked to Sui wallet' : 'Linked to account'}
            </p>
            <input
              type="text"
              className="settings-field__input"
              value={truncateAddress(linkState.suiAddress ?? linkState.accountId)}
              readOnly
              title={linkState.suiAddress ?? linkState.accountId}
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

      <section className="settings-section">
        <h3 className="settings-section__title">Pet Presence</h3>
        <div className="settings-field">
          <span className="settings-field__label">Enhanced Motion</span>
          <div className="settings-field__input-group">
            <input
              type="text"
              className="settings-field__input"
              value={enhancedMotion ? 'On' : 'Low disturbance'}
              readOnly
            />
            <button
              className="settings-field__toggle"
              onClick={() => { void handleToggleEnhancedMotion() }}
              title={enhancedMotion ? 'Turn enhanced motion off' : 'Turn enhanced motion on'}
            >
              {enhancedMotion ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        <p className="extract-notice">
          Low disturbance keeps the pet state visible while muting extra motion. Turn this on only if you want stronger presence feedback.
        </p>
      </section>
    </div>
  )
}
