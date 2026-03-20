'use client'

import Link from 'next/link'
import { SOUL_PUBLISH_DISABLED_MESSAGE } from '@web/lib/souls/publish-status'

export default function PublishSoulPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="glass-card p-6 space-y-4">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Publish Soul
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {SOUL_PUBLISH_DISABLED_MESSAGE}
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          The previous web flow generated placeholder `onChainId` values before the Move transaction existed, which could later conflict with the real Sui object synced by the indexer.
        </p>
        <Link href="/souls" className="btn btn-primary inline-flex">
          Back to Souls
        </Link>
      </div>
    </div>
  )
}
