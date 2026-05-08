import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { usePersonaLibrary, type PersonaItem } from '../../hooks/usePersonaLibrary'
import {
  loadDecryptedContentVersion,
  parseContentAccessResponse,
} from '../../lib/soulidity/content-access'
import { useDesktopWallet } from '../../lib/hooks/use-desktop-wallet'

type CardSection = 'downloaded' | 'owned' | 'marketplace'

type RuntimeConfig = {
  suiNetwork: string
  authReady: boolean
  authBlocker: string | null
}

type DesktopMeResponse = {
  profile: {
    accountId: string
    primarySuiAddress: string | null
  }
}

async function ipcGetDesktopMe(): Promise<DesktopMeResponse | null> {
  const api = window.electronAPI
  if (!api?.getDesktopMe) return null

  try {
    return (await api.getDesktopMe()) as DesktopMeResponse | null
  } catch {
    return null
  }
}

function sameWalletAddress(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false

  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right)
  } catch {
    return false
  }
}

type SuiNetwork = 'mainnet' | 'testnet'
type ProtectedSpriteDownloadPolicy = 'owner_only' | 'allowlist'

type PrivateManifestPayload = {
  version: string
  sourceType: 'starter' | 'soul'
  sourceRef: string
  sprite: {
    assetName: string
    versionIndex: number
    contentOnChainId: string
    downloadPolicy: ProtectedSpriteDownloadPolicy
    config: {
      src: string
      frameWidth: number
      frameHeight: number
      columns: number
      animations: Record<string, {
        frames: number[]
        fps: number
        loop: boolean
      }>
    }
    privateAccess: unknown
  }
}

const suiNetworks = {
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' as const },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' as const },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSpriteConfig(value: unknown): value is NonNullable<PrivateManifestPayload['sprite']>['config'] {
  return (
    isRecord(value)
    && typeof value.src === 'string'
    && typeof value.frameWidth === 'number'
    && typeof value.frameHeight === 'number'
    && typeof value.columns === 'number'
    && isRecord(value.animations)
  )
}

function isProtectedSpritePolicy(value: unknown): value is ProtectedSpriteDownloadPolicy {
  return value === 'owner_only' || value === 'allowlist'
}

function parsePrivateManifest(payload: unknown): PrivateManifestPayload {
  if (
    !isRecord(payload)
    || typeof payload.version !== 'string'
    || (payload.sourceType !== 'starter' && payload.sourceType !== 'soul')
    || typeof payload.sourceRef !== 'string'
    || !isRecord(payload.sprite)
    || typeof payload.sprite.assetName !== 'string'
    || typeof payload.sprite.versionIndex !== 'number'
    || typeof payload.sprite.contentOnChainId !== 'string'
    || !isProtectedSpritePolicy(payload.sprite.downloadPolicy)
    || !isSpriteConfig(payload.sprite.config)
  ) {
    throw new Error('Desktop soul manifest is invalid')
  }

  return payload as PrivateManifestPayload
}

function formatListedPrice(value: string | null) {
  if (!value) return null

  const atomic = BigInt(value)
  const whole = atomic / 1_000_000n
  const fractional = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fractional ? `${whole.toString()}.${fractional} USDC` : `${whole.toString()} USDC`
}

function getDownloadDisabledState(
  persona: PersonaItem,
  section: CardSection,
  ownerOnlyReady: boolean,
  walletMismatch: boolean,
) {
  if (persona.isCached) {
    return { disabled: false, label: 'Download', hint: null as string | null }
  }

  if (persona.spriteDownloadPolicy === 'missing') {
    return { disabled: true, label: 'Sprite Missing', hint: 'This soul has no valid sprite metadata yet.' }
  }

  if (persona.spriteDownloadPolicy === 'invalid') {
    return { disabled: true, label: 'Sprite Invalid', hint: 'The sprite metadata exists but does not match the desktop contract.' }
  }

  if (isProtectedSpritePolicy(persona.spriteDownloadPolicy)) {
    const label = persona.spriteDownloadPolicy === 'allowlist' ? 'Allowlist' : 'Owner Only'
    const protectedHint = persona.spriteDownloadPolicy === 'allowlist'
      ? 'Allowlist-protected sprite. The local Sui address will decrypt it.'
      : 'Owner-only sprite. The local Sui address will decrypt it.'
    if (section === 'marketplace') {
      return {
        disabled: true,
        label,
        hint: 'Protected sprites must be downloaded from My Souls with desktop wallet auth.',
      }
    }
    if (!ownerOnlyReady) {
      return { disabled: true, label: 'Wallet Required', hint: 'Desktop wallet auth must be ready before private sprite download.' }
    }
    if (walletMismatch) {
      return {
        disabled: true,
        label: 'Wallet Mismatch',
        hint: 'The desktop pet keypair cannot sign for the bound Sui wallet. Use the web app to download protected sprites.',
      }
    }
    return { disabled: false, label: 'Download', hint: protectedHint }
  }

  if (persona.sourceType === 'soul') {
    return { disabled: false, label: 'Download', hint: 'Public sprite download.' }
  }

  return { disabled: false, label: 'Download', hint: null }
}

function PersonaCard({
  persona,
  section,
  ownerOnlyReady,
  walletMismatch,
  onDownload,
  onActivate,
  onRemove,
}: {
  persona: PersonaItem
  section: CardSection
  ownerOnlyReady: boolean
  walletMismatch: boolean
  onDownload?: () => void
  onActivate?: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const downloadState = getDownloadDisabledState(persona, section, ownerOnlyReady, walletMismatch)
  const listedPrice = formatListedPrice(persona.listedPriceAtomic)

  return (
    <div className={`persona-card ${persona.isActive ? 'persona-card--active' : ''}`}>
      <div className="persona-card__thumb-wrap">
        {persona.thumbnail ? (
          <img
            className="persona-card__thumb"
            src={persona.thumbnail}
            alt={persona.title}
            loading="lazy"
          />
        ) : (
          <div className="persona-card__thumb persona-card__thumb--placeholder">
            {persona.title.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="persona-card__info">
        <div className="persona-card__name">{persona.title}</div>
        <div className="persona-card__badges">
          {persona.isActive && <span className="persona-card__badge">Active</span>}
          {persona.sourceType === 'soul' && (
            <span className="persona-card__badge persona-card__badge--soul">Soul</span>
          )}
          {persona.listingStatus === 'listed' && (
            <span className="persona-card__badge persona-card__badge--listed">Listed</span>
          )}
          {persona.activeSpriteVersionIndex != null && (
            <span className="persona-card__badge persona-card__badge--version">
              Sprite v{persona.activeSpriteVersionIndex}
            </span>
          )}
        </div>
        {listedPrice && (
          <div className="persona-card__price">{listedPrice}</div>
        )}
        {persona.description && (
          <div className="persona-card__desc">{persona.description}</div>
        )}
        {persona.downloadError && (
          <div className="persona-card__status persona-card__status--error">{persona.downloadError}</div>
        )}
        {!persona.downloadError && downloadState.hint && (
          <div className="persona-card__status">{downloadState.hint}</div>
        )}
      </div>

      <div className="persona-card__actions">
        {persona.downloadProgress !== null ? (
          <div className="persona-card__progress">
            <div
              className="persona-card__progress-bar"
              style={{ width: `${persona.downloadProgress}%` }}
            />
            <span className="persona-card__progress-label">
              {Math.round(persona.downloadProgress)}%
            </span>
          </div>
        ) : persona.isCached && !persona.isActive && onActivate ? (
          <button className="persona-card__btn" onClick={onActivate}>
            Activate
          </button>
        ) : !persona.isCached && onDownload ? (
          <button
            className="persona-card__btn"
            onClick={onDownload}
            disabled={downloadState.disabled}
            title={downloadState.hint ?? downloadState.label}
          >
            {downloadState.label}
          </button>
        ) : null}

        {persona.isCached && !persona.isActive && onRemove && (
          <button
            className="persona-card__btn persona-card__btn--remove"
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function LibraryTabInner({
  ownerOnlyDownloadReady,
  walletMismatch,
  downloadProtectedSoul,
}: {
  ownerOnlyDownloadReady: boolean
  walletMismatch: boolean
  downloadProtectedSoul?: (item: PersonaItem) => Promise<{ error?: string } | void>
}) {
  const {
    activePersona,
    downloaded,
    mySouls,
    marketplace,
    isLinked,
    isLoading,
    hasMoreMarketplace,
    downloadPersona,
    activatePersona,
    resetToDefault,
    removePersona,
    loadMoreMarketplace,
    refresh,
  } = usePersonaLibrary({
    downloadProtectedSoul,
  })

  const handleDownload = useCallback(
    (catalogId: string) => () => void downloadPersona(catalogId),
    [downloadPersona],
  )

  const handleActivate = useCallback(
    (catalogId: string) => () => void activatePersona(catalogId),
    [activatePersona],
  )

  const handleRemove = useCallback(
    (catalogId: string) => () => void removePersona(catalogId),
    [removePersona],
  )

  if (isLoading) {
    return (
      <div className="tab-content">
        <div className="library-loading">Loading library...</div>
      </div>
    )
  }

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Active Persona</h3>

        {activePersona && (
          <div className="library-active">
            <div className="library-active__thumb-wrap">
              {activePersona.thumbnail ? (
                <img
                  className="library-active__thumb"
                  src={activePersona.thumbnail}
                  alt={activePersona.title}
                />
              ) : (
                <div className="library-active__thumb library-active__thumb--placeholder">
                  {activePersona.title.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="library-active__info">
              <div className="library-active__name">
                {activePersona.title}
                {activePersona.catalogId === '__default__' && (
                  <span className="library-card__badge">Default</span>
                )}
              </div>
              {activePersona.description && (
                <div className="library-active__desc">{activePersona.description}</div>
              )}
            </div>
          </div>
        )}

        {activePersona && activePersona.catalogId !== '__default__' && (
          <button
            className="link-button link-button--secondary library-reset-btn"
            onClick={resetToDefault}
          >
            Reset to Default
          </button>
        )}
      </section>

      {ownerOnlyDownloadReady && walletMismatch && (
        <div className="persona-card__status persona-card__status--error" style={{ marginBottom: 12 }}>
          The desktop pet keypair cannot sign for the bound Sui wallet. Protected sprite downloads are
          disabled until you sign in on the web app.
        </div>
      )}

      {downloaded.length > 0 && (
        <section className="settings-section">
          <h3 className="settings-section__title">Downloaded</h3>
          <div className="persona-grid">
            {downloaded.map((persona) => (
              <PersonaCard
                key={persona.catalogId}
                persona={persona}
                section="downloaded"
                ownerOnlyReady={ownerOnlyDownloadReady}
                walletMismatch={walletMismatch}
                onActivate={handleActivate(persona.catalogId)}
                onRemove={handleRemove(persona.catalogId)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="settings-section">
        <h3 className="settings-section__title">My Souls</h3>

        {isLinked ? (
          mySouls.length > 0 ? (
            <div className="persona-grid">
              {mySouls.map((persona) => (
                <PersonaCard
                  key={persona.catalogId}
                  persona={persona}
                  section="owned"
                  ownerOnlyReady={ownerOnlyDownloadReady}
                  walletMismatch={walletMismatch}
                  onDownload={handleDownload(persona.catalogId)}
                  onActivate={handleActivate(persona.catalogId)}
                  onRemove={handleRemove(persona.catalogId)}
                />
              ))}
            </div>
          ) : (
            <p className="agent-empty">No souls in your wallet yet</p>
          )
        ) : (
          <div className="library-link-cta">
            <p className="library-link-cta__text">
              Link your account in Settings to see your owned Souls
            </p>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section__title-row">
          <h3 className="settings-section__title">Browse Marketplace</h3>
          <button className="library-refresh-btn" onClick={refresh} title="Refresh">
            &#x21bb;
          </button>
        </div>

        {marketplace.length > 0 ? (
          <>
            <div className="persona-grid">
              {marketplace.map((persona) => (
                <PersonaCard
                  key={persona.catalogId}
                  persona={persona}
                  section="marketplace"
                  ownerOnlyReady={false}
                  walletMismatch={walletMismatch}
                  onDownload={handleDownload(persona.catalogId)}
                  onActivate={handleActivate(persona.catalogId)}
                  onRemove={handleRemove(persona.catalogId)}
                />
              ))}
            </div>

            {hasMoreMarketplace && (
              <button
                className="link-button link-button--secondary library-load-more"
                onClick={loadMoreMarketplace}
              >
                Load More
              </button>
            )}
          </>
        ) : (
          <p className="agent-empty">
            Marketplace catalog not available. Check your connection or try again later.
          </p>
        )}
      </section>
    </div>
  )
}

function LibraryTabWalletInner({ primarySuiAddress }: { primarySuiAddress: string | null }) {
  const { signPersonalMessage, suiClient, suiWallet } = useDesktopWallet()

  // After the desktop pet identity split, `suiWallet.address` is the local
  // pet/agent keypair, not the user's bound Sui wallet. Owner-only / allowlist
  // sprites are encrypted to the bound wallet, so the desktop pet cannot sign
  // the Seal session — and the manifest route's F-278 backstop also rejects
  // any `viewer` that is not in the bound wallet set. Detect the mismatch up
  // front so the UI never advertises a Download button that we know will fail.
  const walletMismatch = useMemo(
    () => Boolean(primarySuiAddress && suiWallet?.address && !sameWalletAddress(primarySuiAddress, suiWallet.address)),
    [primarySuiAddress, suiWallet?.address],
  )

  const downloadProtectedSoul = useCallback(async (item: PersonaItem) => {
    if (!suiWallet?.address) {
      return { error: 'Local Sui address is not ready yet.' }
    }

    if (walletMismatch) {
      return {
        error: 'The desktop pet keypair cannot sign for the bound Sui wallet. Use the web app to download protected sprites.',
      }
    }

    const fetchManifest = window.electronAPI.soulFetchManifest
    const cachePersona = window.electronAPI.soulCachePersona
    if (!fetchManifest || !cachePersona) {
      return { error: 'Desktop sprite IPC is not available.' }
    }

    try {
      const manifestPayload = await fetchManifest({
        catalogId: item.catalogId,
        viewer: suiWallet.address,
      })
      const manifest = parsePrivateManifest(manifestPayload)
      const access = parseContentAccessResponse(manifest.sprite.privateAccess)
      const decrypted = await loadDecryptedContentVersion({
        access,
        signPersonalMessage,
        suiClient,
      })

      await cachePersona({
        catalogId: item.catalogId,
        sourceType: manifest.sourceType,
        sourceRef: manifest.sourceRef,
        version: manifest.version,
        spriteBytes: decrypted.bytes,
        configJson: JSON.stringify(manifest.sprite.config),
      })

      return {}
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to decrypt protected sprite',
      }
    }
  }, [signPersonalMessage, suiClient, suiWallet?.address, walletMismatch])

  return (
    <LibraryTabInner
      ownerOnlyDownloadReady
      walletMismatch={walletMismatch}
      downloadProtectedSoul={downloadProtectedSoul}
    />
  )
}

function LibraryTabContent({ runtimeConfig }: { runtimeConfig: RuntimeConfig | null }) {
  const ownerOnlyEnabled = Boolean(runtimeConfig?.authReady)
  const [queryClient] = useState(() => new QueryClient())
  const [primarySuiAddress, setPrimarySuiAddress] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerOnlyEnabled) return

    let cancelled = false
    void ipcGetDesktopMe().then((me) => {
      if (!cancelled) {
        setPrimarySuiAddress(me?.profile?.primarySuiAddress ?? null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ownerOnlyEnabled])

  if (!ownerOnlyEnabled) {
    return <LibraryTabInner ownerOnlyDownloadReady={false} walletMismatch={false} />
  }

  const network = runtimeConfig!.suiNetwork as SuiNetwork
  const defaultNetwork: SuiNetwork = network in suiNetworks ? network : 'mainnet'

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
        <LibraryTabWalletInner primarySuiAddress={primarySuiAddress} />
      </SuiClientProvider>
    </QueryClientProvider>
  )
}

export function LibraryTab(): React.JSX.Element {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null)

  useEffect(() => {
    let cancelled = false

    void window.electronAPI.getDesktopRuntimeConfig()
      .then((nextConfig) => {
        if (!cancelled) {
          setRuntimeConfig(nextConfig)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeConfig({
            suiNetwork: 'mainnet',
            authReady: false,
            authBlocker: 'Failed to load desktop wallet configuration.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return <LibraryTabContent runtimeConfig={runtimeConfig} />
}
