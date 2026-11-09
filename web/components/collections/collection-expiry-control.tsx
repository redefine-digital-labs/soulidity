'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { marketListDigest } from '@/lib/animacraft/market-list-operation'
import type { CollectionRetirement } from '@/lib/collections/collection-expiry-recovery'

export function CollectionExpiryControl({ pending, onRetire }: { pending: boolean; onRetire: (digest?: string) => void }) {
  const [candidate, setCandidate] = useState('')
  const digest = candidate.trim()
  return <div className="space-y-2 text-xs">
    <label className="block">Conflicting transaction digest (optional)
      <input className="block w-full rounded border border-border bg-card px-2 py-1" value={candidate}
        disabled={pending} onChange={event => setCandidate(event.currentTarget.value)}/>
    </label>
    <Button variant="outline" disabled={pending || Boolean(digest && !marketListDigest(digest))}
      onClick={() => onRetire(digest || undefined)}>Check expiry and retire original</Button>
  </div>
}

export function CollectionExpiryEvidence({ retirement }: { retirement: CollectionRetirement }) {
  return <p className="break-all text-xs text-muted">Expiry evidence retained · checkpoint {retirement.checkpoint.sequenceNumber}
    {retirement.conflict ? <> · conflicting transaction {retirement.conflict.digest}</> : <> · exact input {retirement.objectId}</>}</p>
}
