import React, { useCallback } from 'react'
import { usePersonaLibrary, type PersonaItem } from '../../hooks/usePersonaLibrary'

// ── PersonaCard (inline) ─────────────────────────────────

function PersonaCard({
  persona,
  onDownload,
  onActivate,
  onRemove,
}: {
  persona: PersonaItem
  onDownload?: () => void
  onActivate?: () => void
  onRemove?: () => void
}): React.JSX.Element {
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
        </div>
        {persona.description && (
          <div className="persona-card__desc">{persona.description}</div>
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
          <button className="persona-card__btn" onClick={onDownload}>
            Download
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

// ── LibraryTab ───────────────────────────────────────────

export function LibraryTab(): React.JSX.Element {
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
  } = usePersonaLibrary()

  const handleDownload = useCallback(
    (catalogId: string) => () => downloadPersona(catalogId),
    [downloadPersona],
  )

  const handleActivate = useCallback(
    (catalogId: string) => () => activatePersona(catalogId),
    [activatePersona],
  )

  const handleRemove = useCallback(
    (catalogId: string) => () => removePersona(catalogId),
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
      {/* ── Active Persona ──────────────────────────────── */}
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

      {/* ── Downloaded ──────────────────────────────────── */}
      {downloaded.length > 0 && (
        <section className="settings-section">
          <h3 className="settings-section__title">Downloaded</h3>
          <div className="persona-grid">
            {downloaded.map(p => (
              <PersonaCard
                key={p.catalogId}
                persona={p}
                onActivate={handleActivate(p.catalogId)}
                onRemove={handleRemove(p.catalogId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── My Souls ───────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section__title">My Souls</h3>

        {isLinked ? (
          mySouls.length > 0 ? (
            <div className="persona-grid">
              {mySouls.map(p => (
                <PersonaCard
                  key={p.catalogId}
                  persona={p}
                  onDownload={handleDownload(p.catalogId)}
                  onActivate={handleActivate(p.catalogId)}
                  onRemove={handleRemove(p.catalogId)}
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

      {/* ── Browse Marketplace ─────────────────────────── */}
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
              {marketplace.map(p => (
                <PersonaCard
                  key={p.catalogId}
                  persona={p}
                  onDownload={handleDownload(p.catalogId)}
                  onActivate={handleActivate(p.catalogId)}
                  onRemove={handleRemove(p.catalogId)}
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
