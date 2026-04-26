import React, { useState, useEffect, useCallback, useRef } from 'react'
import { normalizeSuiAddress } from '@mysten/sui/utils'

interface AgentKeypairInfo {
  address: string
}

interface DesktopSuiWalletInfo {
  address: string
  publicKey: string
  createdAt: number
}

type SuiWalletPanel =
  | { phase: 'loading' }
  | { phase: 'present'; info: DesktopSuiWalletInfo }
  | { phase: 'missing' }
  | { phase: 'importing' }

function sameSuiAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right)
  } catch {
    return left === right
  }
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
  const [suiWalletCopied, setSuiWalletCopied] = useState(false)
  const [suiWalletPanel, setSuiWalletPanel] = useState<SuiWalletPanel>({ phase: 'loading' })
  const [suiWalletBusy, setSuiWalletBusy] = useState<null | 'generate' | 'import' | 'reset'>(null)
  const [suiWalletError, setSuiWalletError] = useState<string | null>(null)
  const [suiWalletImportSecret, setSuiWalletImportSecret] = useState('')
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

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.walletGetInfo().then((info) => {
      if (cancelled) return
      setSuiWalletPanel(info ? { phase: 'present', info } : { phase: 'missing' })
    }).catch((err: unknown) => {
      if (cancelled) return
      setSuiWalletPanel({ phase: 'missing' })
      setSuiWalletError(err instanceof Error ? err.message : 'Failed to read desktop Sui wallet')
    })
    return () => { cancelled = true }
  }, [])

  const handleCopyAddress = useCallback(async () => {
    if (!keypair?.address) return
    await navigator.clipboard.writeText(keypair.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [keypair])

  const handleCopySuiWalletAddress = useCallback(async () => {
    if (suiWalletPanel.phase !== 'present') return
    await navigator.clipboard.writeText(suiWalletPanel.info.address)
    setSuiWalletCopied(true)
    setTimeout(() => setSuiWalletCopied(false), 2000)
  }, [suiWalletPanel])

  const handleGenerateSuiWallet = useCallback(async () => {
    setSuiWalletBusy('generate')
    setSuiWalletError(null)
    try {
      const info = await window.electronAPI.walletGenerate()
      setSuiWalletPanel({ phase: 'present', info })
    } catch (err) {
      setSuiWalletError(err instanceof Error ? err.message : 'Failed to generate desktop Sui wallet')
    } finally {
      setSuiWalletBusy(null)
    }
  }, [])

  const handleStartImportSuiWallet = useCallback(() => {
    setSuiWalletPanel({ phase: 'importing' })
    setSuiWalletImportSecret('')
    setSuiWalletError(null)
  }, [])

  const handleCancelImportSuiWallet = useCallback(async () => {
    setSuiWalletImportSecret('')
    setSuiWalletError(null)
    try {
      const info = await window.electronAPI.walletGetInfo()
      setSuiWalletPanel(info ? { phase: 'present', info } : { phase: 'missing' })
    } catch {
      setSuiWalletPanel({ phase: 'missing' })
    }
  }, [])

  const handleSubmitImportSuiWallet = useCallback(async () => {
    const secret = suiWalletImportSecret.trim()
    if (!secret) {
      setSuiWalletError('Paste a Sui private key (bech32, base64, or hex) before importing.')
      return
    }
    setSuiWalletBusy('import')
    setSuiWalletError(null)
    try {
      const info = await window.electronAPI.walletImport(secret)
      setSuiWalletPanel({ phase: 'present', info })
      setSuiWalletImportSecret('')
    } catch (err) {
      setSuiWalletError(err instanceof Error ? err.message : 'Failed to import desktop Sui wallet')
    } finally {
      setSuiWalletBusy(null)
    }
  }, [suiWalletImportSecret])

  const handleResetSuiWallet = useCallback(async () => {
    if (!window.confirm('Reset the desktop Sui wallet? You will need to back up its private key elsewhere first to keep controlling its assets.')) {
      return
    }
    setSuiWalletBusy('reset')
    setSuiWalletError(null)
    try {
      await window.electronAPI.walletReset()
      setSuiWalletPanel({ phase: 'missing' })
      setSuiWalletImportSecret('')
    } catch (err) {
      setSuiWalletError(err instanceof Error ? err.message : 'Failed to reset desktop Sui wallet')
    } finally {
      setSuiWalletBusy(null)
    }
  }, [])

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
        <h3 className="settings-section__title">Desktop Sui Wallet</h3>
        <p className="extract-notice">
          The desktop Sui wallet signs mint transactions and decrypts owner-only Souls in Library. The private key never leaves the main process — every signing or destructive action requires native confirmation.
        </p>

        {(() => {
          const linkedSuiAddress = linkState.phase === 'confirmed' ? linkState.suiAddress : null
          const presentAddress = suiWalletPanel.phase === 'present' ? suiWalletPanel.info.address : null
          const walletMismatch = Boolean(
            linkedSuiAddress && presentAddress && !sameSuiAddress(linkedSuiAddress, presentAddress),
          )

          return (
            <>
              {suiWalletPanel.phase === 'loading' && (
                <div className="link-panel">
                  <p className="link-panel__status">Checking desktop Sui wallet...</p>
                </div>
              )}

              {suiWalletPanel.phase === 'present' && (
                <>
                  <div className="settings-field">
                    <span className="settings-field__label">Sui Address</span>
                    <div className="settings-field__input-group">
                      <input
                        type="text"
                        className="settings-field__input"
                        value={truncateAddress(suiWalletPanel.info.address)}
                        readOnly
                        title={suiWalletPanel.info.address}
                      />
                      <button
                        className="settings-field__toggle"
                        onClick={() => { void handleCopySuiWalletAddress() }}
                        title={suiWalletCopied ? 'Copied!' : 'Copy address'}
                      >
                        {suiWalletCopied ? '✓' : '⎘'}
                      </button>
                    </div>
                  </div>
                  {walletMismatch && (
                    <p className="link-panel__error">
                      This desktop Sui wallet does not match the bound primary Sui wallet for the linked account. Mint and protected Library downloads will be rejected until both addresses match.
                    </p>
                  )}
                  <button
                    className="link-button link-button--secondary"
                    onClick={() => { void handleResetSuiWallet() }}
                    disabled={suiWalletBusy !== null}
                  >
                    {suiWalletBusy === 'reset' ? 'Resetting…' : 'Reset Desktop Sui Wallet'}
                  </button>
                </>
              )}

              {suiWalletPanel.phase === 'missing' && (
                <div className="link-panel">
                  <p className="link-panel__status">No desktop Sui wallet is configured yet.</p>
                  <button
                    className="link-button"
                    onClick={() => { void handleGenerateSuiWallet() }}
                    disabled={suiWalletBusy !== null}
                  >
                    {suiWalletBusy === 'generate' ? 'Generating…' : 'Generate Sui Wallet'}
                  </button>
                  <button
                    className="link-button link-button--secondary"
                    onClick={handleStartImportSuiWallet}
                    disabled={suiWalletBusy !== null}
                  >
                    Import Existing Key
                  </button>
                </div>
              )}

              {suiWalletPanel.phase === 'importing' && (
                <div className="link-panel">
                  <p className="link-panel__instruction">
                    Paste a Sui private key (bech32 `suiprivkey...`, base64, or hex). The key is sent to the main process once and never logged.
                  </p>
                  <textarea
                    className="settings-field__input"
                    rows={3}
                    value={suiWalletImportSecret}
                    onChange={(event) => setSuiWalletImportSecret(event.target.value)}
                    placeholder="suiprivkey1..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    className="link-button"
                    onClick={() => { void handleSubmitImportSuiWallet() }}
                    disabled={suiWalletBusy !== null || suiWalletImportSecret.trim().length === 0}
                  >
                    {suiWalletBusy === 'import' ? 'Importing…' : 'Import Key'}
                  </button>
                  <button
                    className="link-button link-button--secondary"
                    onClick={() => { void handleCancelImportSuiWallet() }}
                    disabled={suiWalletBusy !== null}
                  >
                    Cancel Import
                  </button>
                </div>
              )}

              {suiWalletError && (
                <p className="link-panel__error">{suiWalletError}</p>
              )}
            </>
          )
        })()}
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
