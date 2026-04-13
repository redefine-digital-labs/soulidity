import React from 'react'

export function LibraryTab(): React.JSX.Element {
  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Personas</h3>

        <div className="library-card library-card--active">
          <div className="library-card__name">Usagi (Default)</div>
          <div className="library-card__meta">Built-in sprite sheet | 6 animations</div>
          <div className="library-card__badge">Active</div>
        </div>

        <p className="library-hint">
          More personas from the Soul marketplace coming in Phase 2.
        </p>
      </section>
    </div>
  )
}
