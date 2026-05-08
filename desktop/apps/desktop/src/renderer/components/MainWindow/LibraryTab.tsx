import React, { useCallback, useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
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
      ? 'Allowlist-protected sprite. The desktop pet grant will decrypt it.'
      : 'Owner-only sprite. The desktop pet grant will decrypt it.'
    if (section === 'marketplace') {
      return {
        disabled: true,
        label,
        hint: 'Protected sprites must be downloaded from My Souls with an active grant for this pet.',
      }
    }
    if (!ownerOnlyReady) {
      return { disabled: true, label: 'Wallet Required', hint: 'Desktop wallet auth must be ready before private sprite download.' }
    }
    if (!persona.agentSpriteGrant?.active) {
      // Per-Soul grant gate. Replaces the legacy global walletMismatch
      // blocker that fired even when an owner had not yet authorized any
      // pet for any Soul. Direct the user to the web app to authorize.
      return {
        disabled: true,
        label: 'Authorize on web',
        hint: 'Open My Desktop Pets on the web app and authorize this Soul for the linked pet to enable downloads.',
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
  onDownload,
  onActivate,
  onRemove,
}: {
  persona: PersonaItem
  section: CardSection
  ownerOnlyReady: boolean
  onDownload?: () => void
  onActivate?: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const downloadState = getDownloadDisabledState(persona, section, ownerOnlyReady)
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
  downloadProtectedSoul,
}: {
  ownerOnlyDownloadReady: boolean
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

      {/*
        The walletMismatch banner that used to live here surfaced for every
        Library open even though the desktop pet keypair never signs for
        the bound human wallet anyway. With per-Soul `agentSpriteGrant`
        gating below, the user only sees the relevant signal at the moment
        of action — and only when their pet has not yet been authorized
        for that specific Soul.
      */}

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

function LibraryTabWalletInner() {
  const { signPersonalMessage, suiClient, suiWallet } = useDesktopWallet()

  const downloadProtectedSoul = useCallback(async (item: PersonaItem) => {
    if (!suiWallet?.address) {
      return { error: 'Local Sui address is not ready yet.' }
    }

    if (!item.agentSpriteGrant?.active) {
      return {
        error: 'This pet has no active sprite grant for this Soul. Authorize it from My Desktop Pets on the web app.',
      }
    }

    const fetchManifest = window.electronAPI.soulFetchManifest
    const cachePersona = window.electronAPI.soulCachePersona
    if (!fetchManifest || !cachePersona) {
      return { error: 'Desktop sprite IPC is not available.' }
    }

    try {
      // No `viewer` query — the manifest route resolves the viewer from
      // the desktop bearer token's pet identity. Sending a `viewer` here
      // would only be accepted if it equalled the pet keypair anyway, so
      // omitting it keeps the call shape simpler and impossible to drift.
      const manifestPayload = await fetchManifest({
        catalogId: item.catalogId,
        viewer: null,
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
  }, [signPersonalMessage, suiClient, suiWallet?.address])

  return (
    <LibraryTabInner
      ownerOnlyDownloadReady
      downloadProtectedSoul={downloadProtectedSoul}
    />
  )
}

function LibraryTabContent({ runtimeConfig }: { runtimeConfig: RuntimeConfig | null }) {
  const ownerOnlyEnabled = Boolean(runtimeConfig?.authReady)
  const [queryClient] = useState(() => new QueryClient())

  if (!ownerOnlyEnabled) {
    return <LibraryTabInner ownerOnlyDownloadReady={false} />
  }

  const network = runtimeConfig!.suiNetwork as SuiNetwork
  const defaultNetwork: SuiNetwork = network in suiNetworks ? network : 'mainnet'

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
        <LibraryTabWalletInner />
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
