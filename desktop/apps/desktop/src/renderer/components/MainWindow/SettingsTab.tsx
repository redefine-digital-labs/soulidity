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
const LINK_STORAGE_FAILED_MESSAGE = 'Local credential storage unavailable; unlink and try again.'
const RESET_REMOTE_REVOKE_FAILED_MESSAGE = 'Server-side revoke failed; please open /account/pets to remove this pet manually.'
const RESET_CONFIRM_COPY = "This will revoke this pet from your account permanently. You'll need to link a new pet to use the desktop again."

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

interface ApiKeyStatus {
  hasKey: boolean
  storedAt: number | null
}

type RotationFlash =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

type ResetFlash =
  | { kind: 'awaiting' }
  | { kind: 'remote-revoke-failed' }
  | { kind: 'error'; message: string }

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

/**
 * Convert the legacy `${WEB_BASE_URL}/desktop/link` endpoint into the canonical
 * pet-binding page. The redirect target lives at `/account/pets?link=<userCode>`,
 * so doing the rewrite client-side avoids an extra IPC round-trip and keeps
 * the UI link clean regardless of which entry the main process surfaces.
 */
function buildPetsLinkUrl(rawLinkUrl: string, userCode: string): string {
  const encoded = encodeURIComponent(userCode)
  try {
    const parsed = new URL(rawLinkUrl)
    parsed.pathname = '/account/pets'
    parsed.search = `?link=${encoded}`
    parsed.hash = ''
    return parsed.toString()
  } catch {
    // Fallback: best-effort string transform when the link URL isn't absolute.
    const trimmed = rawLinkUrl.replace(/\/desktop\/link\/?$/, '').replace(/\/+$/, '')
    return `${trimmed}/account/pets?link=${encoded}`
  }
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
  const [userCodeCopied, setUserCodeCopied] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null)
  const [rotationBusy, setRotationBusy] = useState(false)
  const [rotationFlash, setRotationFlash] = useState<RotationFlash | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [resetFlash, setResetFlash] = useState<ResetFlash | null>(null)
  const [resetSuccessNotice, setResetSuccessNotice] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const linkSessionNonceRef = useRef(0)
  const linkVerificationInFlightRef = useRef<number | null>(null)
  const rotationFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Synchronous rotation guard — state updates batch, so two rapid clicks both
  // see `rotationBusy=false`. The ref flips immediately and rejects the second.
  const rotationInFlightRef = useRef(false)
  const resetInFlightRef = useRef(false)

  const stopPolling = useCallback((timer?: ReturnType<typeof setInterval> | null) => {
    const activeTimer = timer ?? pollTimerRef.current
    if (!activeTimer) return
    clearInterval(activeTimer)
    if (!timer || pollTimerRef.current === activeTimer) {
      pollTimerRef.current = null
    }
  }, [])

  const refreshApiKeyStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.agentGetApiKeyStatus()
      setApiKeyStatus(status)
    } catch {
      setApiKeyStatus({ hasKey: false, storedAt: null })
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
        void refreshApiKeyStatus()
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
  }, [getVerifiedDesktopIdentity, refreshApiKeyStatus])

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
          void refreshApiKeyStatus()
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
      if (rotationFlashTimerRef.current) {
        clearTimeout(rotationFlashTimerRef.current)
        rotationFlashTimerRef.current = null
      }
      if (resetSuccessTimerRef.current) {
        clearTimeout(resetSuccessTimerRef.current)
        resetSuccessTimerRef.current = null
      }
    }
  }, [getVerifiedDesktopIdentity, refreshApiKeyStatus, stopPolling])

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
    // Main owns the agent keypair: it will generate one if none is present.
    // We do NOT short-circuit on `keypair` here.
    linkSessionNonceRef.current += 1
    linkVerificationInFlightRef.current = null
    const sessionNonce = linkSessionNonceRef.current
    stopPolling()

    try {
      const [session, linkUrl] = await Promise.all([
        window.electronAPI.deviceStartLink(),
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
          } else if (poll.status === 'error' && poll.error === 'storage-failed') {
            // T8 surface signal: main attempted the double-write three times
            // and gave up. Promote to a clear corrective UI with unlink.
            stopPolling(timer)
            setLinkState({ phase: 'error', message: LINK_STORAGE_FAILED_MESSAGE, canUnlink: true })
          }
        } catch { /* keep polling */ }
      }, (session.pollInterval || 5) * 1000)
      pollTimerRef.current = timer
    } catch (err) {
      if (linkSessionNonceRef.current !== sessionNonce) return
      setLinkState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to start linking' })
    }
  }, [confirmPendingLink, stopPolling])

  const handleCopyUserCode = useCallback(async (userCode: string) => {
    try {
      await navigator.clipboard.writeText(userCode)
      setUserCodeCopied(true)
      setTimeout(() => setUserCodeCopied(false), 2000)
    } catch {
      // Surface nothing — copy failures are rare and non-fatal.
    }
  }, [])

  const handleOpenLinkInBrowser = useCallback(async (linkUrl: string, userCode: string) => {
    const target = buildPetsLinkUrl(linkUrl, userCode)
    try {
      await window.electronAPI['shell:open-external'](target)
    } catch {
      /* best-effort: shell:open-external rejects only on URL validation. */
    }
  }, [])

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
        setApiKeyStatus(null)
      } else {
        setLinkState({ phase: 'error', message: result.error || 'Failed to unlink device' })
      }
    } catch (err) {
      setLinkState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to unlink device' })
    } finally {
      setUnlinking(false)
    }
  }, [stopPolling])

  const handleRotateApiKey = useCallback(async () => {
    if (rotationInFlightRef.current) return
    rotationInFlightRef.current = true
    setRotationBusy(true)
    setRotationFlash(null)
    if (rotationFlashTimerRef.current) {
      clearTimeout(rotationFlashTimerRef.current)
      rotationFlashTimerRef.current = null
    }
    try {
      const result = await window.electronAPI.agentRotateApiKey()
      if (result.ok) {
        await refreshApiKeyStatus()
        setRotationFlash({ kind: 'success', message: 'Agent key stored' })
        rotationFlashTimerRef.current = setTimeout(() => {
          setRotationFlash(null)
          rotationFlashTimerRef.current = null
        }, 3000)
      } else {
        setRotationFlash({ kind: 'error', message: `Failed to rotate key: ${result.error}` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rotate key'
      setRotationFlash({ kind: 'error', message })
    } finally {
      rotationInFlightRef.current = false
      setRotationBusy(false)
    }
  }, [refreshApiKeyStatus])

  const handleResetIdentityClick = useCallback(() => {
    if (resetInFlightRef.current) return
    setResetFlash(null)
    if (!resetConfirming) {
      setResetConfirming(true)
      return
    }
    resetInFlightRef.current = true
    void (async () => {
      setResetBusy(true)
      try {
        const result = await window.electronAPI.agentResetIdentity()
        if (result.ok) {
          // Tear down all linked-state in the renderer; main has wiped local
          // credentials + (if dtk was present) revoked the pet on the server.
          linkSessionNonceRef.current += 1
          linkVerificationInFlightRef.current = null
          stopPolling()
          setLinkState({ phase: 'idle' })
          setKeypair(null)
          setApiKeyStatus(null)
          setRotationFlash(null)
          setResetConfirming(false)
          setResetFlash(null)
          setResetSuccessNotice(true)
          if (resetSuccessTimerRef.current) {
            clearTimeout(resetSuccessTimerRef.current)
          }
          resetSuccessTimerRef.current = setTimeout(() => {
            setResetSuccessNotice(false)
            resetSuccessTimerRef.current = null
          }, 4000)
          return
        }
        if (result.error === 'remote-revoke-failed') {
          setResetFlash({ kind: 'remote-revoke-failed' })
        } else {
          setResetFlash({ kind: 'error', message: result.error })
        }
      } catch (err) {
        setResetFlash({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to reset pet identity',
        })
      } finally {
        resetInFlightRef.current = false
        setResetBusy(false)
      }
    })()
  }, [resetConfirming, stopPolling])

  const handleCancelResetConfirm = useCallback(() => {
    setResetConfirming(false)
    setResetFlash(null)
  }, [])

  const handleOpenPetsAccount = useCallback(async () => {
    try {
      const linkUrl = await window.electronAPI.deviceGetLinkUrl()
      const target = buildPetsLinkUrl(linkUrl, '')
      // Strip the trailing `?link=` query when no userCode is needed.
      const cleaned = target.replace(/\?link=$/, '')
      await window.electronAPI['shell:open-external'](cleaned)
    } catch {
      /* best-effort */
    }
  }, [])

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
              {copied ? '✓' : '⎘'}
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
          <>
            <button
              className="link-button"
              onClick={() => { void handleStartLink() }}
            >
              Link to Web Account
            </button>
            {resetSuccessNotice && (
              <p className="link-panel__status" role="status">
                Pet identity reset; ready to link a new pet.
              </p>
            )}
          </>
        )}

        {linkState.phase === 'linking' && (
          <div className="link-panel">
            <p className="link-panel__instruction">
              Open the link below and enter this code:
            </p>
            <div className="link-panel__code">{linkState.userCode}</div>
            <div className="settings-field__input-group">
              <button
                className="link-button link-button--secondary"
                onClick={() => { void handleCopyUserCode(linkState.userCode) }}
              >
                {userCodeCopied ? 'Copied!' : 'Copy userCode'}
              </button>
              <button
                className="link-button"
                onClick={() => { void handleOpenLinkInBrowser(linkState.linkUrl, linkState.userCode) }}
              >
                Open in browser
              </button>
            </div>
            <div className="link-panel__url">
              <input
                type="text"
                className="settings-field__input"
                value={buildPetsLinkUrl(linkState.linkUrl, linkState.userCode)}
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

            <div className="settings-field">
              <span className="settings-field__label">Pet ID</span>
              <input
                type="text"
                className="settings-field__input"
                value={keypair ? truncateAddress(keypair.address) : '—'}
                readOnly
                title={keypair?.address}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Linked account</span>
              <input
                type="text"
                className="settings-field__input"
                value={truncateAddress(linkState.suiAddress ?? linkState.accountId)}
                readOnly
                title={linkState.suiAddress ?? linkState.accountId}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Agent key</span>
              <span
                className={`settings-field__status${
                  apiKeyStatus?.hasKey ? ' settings-field__status--ok' : ' settings-field__status--missing'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`settings-field__status-dot${
                    apiKeyStatus?.hasKey ? ' settings-field__status-dot--ok' : ' settings-field__status-dot--missing'
                  }`}
                />
                {apiKeyStatus?.hasKey ? 'Agent key stored' : 'Agent key missing'}
              </span>
            </div>

            <button
              className="link-button link-button--secondary"
              onClick={() => { void handleRotateApiKey() }}
              disabled={rotationBusy}
            >
              {rotationBusy ? 'Rotating…' : 'Regenerate API key'}
            </button>

            {rotationFlash?.kind === 'success' && (
              <p className="link-panel__status" role="status">{rotationFlash.message}</p>
            )}
            {rotationFlash?.kind === 'error' && (
              <p className="link-panel__error">{rotationFlash.message}</p>
            )}

            <button
              className="link-button link-button--secondary"
              onClick={() => { void handleUnlink() }}
              disabled={unlinking}
            >
              {unlinking ? 'Unlinking…' : 'Unlink Device'}
            </button>

            <details className="settings-section__danger-zone">
              <summary>Reset Pet Identity</summary>
              <div className="settings-section__danger-body">
                {!resetConfirming && !resetFlash && (
                  <>
                    <p className="extract-notice">
                      Reset removes this pet from your account and wipes the local agent key. Use this when you want to bind a different pet.
                    </p>
                    <button
                      className="link-button link-button--secondary"
                      onClick={handleResetIdentityClick}
                      disabled={resetBusy}
                    >
                      Reset Pet Identity
                    </button>
                  </>
                )}

                {resetConfirming && (
                  <>
                    <p className="link-panel__instruction">{RESET_CONFIRM_COPY}</p>
                    <div className="settings-field__input-group">
                      <button
                        className="link-button link-button--secondary"
                        onClick={handleCancelResetConfirm}
                        disabled={resetBusy}
                      >
                        Cancel
                      </button>
                      <button
                        className="link-button"
                        onClick={handleResetIdentityClick}
                        disabled={resetBusy}
                      >
                        {resetBusy ? 'Resetting…' : 'Confirm reset'}
                      </button>
                    </div>
                  </>
                )}

                {resetFlash?.kind === 'remote-revoke-failed' && (
                  <div className="link-panel">
                    <p className="link-panel__error">{RESET_REMOTE_REVOKE_FAILED_MESSAGE}</p>
                    <button
                      className="link-button link-button--secondary"
                      onClick={() => { void handleOpenPetsAccount() }}
                    >
                      Open /account/pets
                    </button>
                  </div>
                )}

                {resetFlash?.kind === 'error' && (
                  <p className="link-panel__error">{resetFlash.message}</p>
                )}
              </div>
            </details>
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
              <button className="link-button" onClick={() => { void handleStartLink() }}>
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
