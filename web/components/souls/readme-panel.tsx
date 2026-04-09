'use client'

import { useState } from 'react'

const README_COLLAPSE_HEIGHT = 384

type ReadmePanelProps = {
  readme: string
}

export function ReadmePanel({ readme }: ReadmePanelProps) {
  const [expanded, setExpanded] = useState(false)
  const isLong = readme.length > 800

  return (
    <div className="glass-panel p-4 sm:p-6 flex flex-col gap-3">
      <h2
        className="text-sm font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--text-muted)' }}
      >
        README
      </h2>
      <div
        className="relative"
        style={{
          maxHeight: expanded || !isLong ? 'none' : `${README_COLLAPSE_HEIGHT}px`,
          overflow: 'hidden',
        }}
      >
        <pre
          className="whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}
        >
          {readme}
        </pre>
        {!expanded && isLong ? (
          <div
            className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
            style={{ background: 'linear-gradient(transparent, var(--bg-surface))' }}
          />
        ) : null}
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-sm font-medium self-start"
          style={{ color: 'var(--accent-cyan)' }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  )
}
