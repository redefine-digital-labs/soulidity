'use client'

import type { SoulRelease } from '@web/lib/souls/types'

export function ReleaseList({ releases }: { releases: SoulRelease[] }) {
  if (releases.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No releases yet</p>
  }

  return (
    <div className="space-y-2">
      {releases.map((release) => (
        <div key={release.id} className="glass-card p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              v{release.version}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {new Date(release.createdAt).toLocaleDateString()}
            </span>
          </div>
          {release.changelog && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {release.changelog}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
