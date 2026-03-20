'use client'

import { use } from 'react'
import Link from 'next/link'
import { SOUL_RELEASE_DISABLED_MESSAGE } from '@web/lib/souls/publish-status'

export default function NewReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="glass-card p-6 space-y-4">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          New Release
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {SOUL_RELEASE_DISABLED_MESSAGE}
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          The previous release form generated placeholder release IDs client-side, which could diverge from the actual frozen Sui release object and break pass-to-release lookups.
        </p>
        <Link href={`/souls/${encodeURIComponent(id)}`} className="btn btn-primary inline-flex">
          Back to Soul
        </Link>
      </div>
    </div>
  )
}
