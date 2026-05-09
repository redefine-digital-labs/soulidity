'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import type { SoulContentVersionRecord } from '@soulidity/sdk'

interface PurgeConfirmModalProps {
  open: boolean
  version: SoulContentVersionRecord | null
  pending: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
}

function PurgeConfirmModal({ open, version, pending, onClose, onConfirm }: PurgeConfirmModalProps) {
  const [error, setError] = useState<string | null>(null)

  const subtitle = version
    ? `${version.kindName || 'Content'} · ${version.name || '(unnamed)'} · v${version.versionIndex}`
    : undefined

  async function handleConfirm() {
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purge failed')
    }
  }

  function handleClose() {
    if (pending) return
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} maxWidth="sm" title="Purge version permanently" subtitle={subtitle}>
      <div className="rounded-xl border border-danger/25 bg-danger/[0.06] px-4 py-3 mb-4">
        <p className="text-sm text-foreground">
          This is the irreversible step after a soft-delete. Once you sign, the on-chain version object is destroyed and the storage rebate is reclaimed.
        </p>
      </div>

      <ul className="mb-5 space-y-1.5 text-[12px] text-muted">
        <li>· The Soul will no longer be able to serve this artifact — its Walrus blob reference is dropped from the content tree.</li>
        <li>· Anyone (agent runtimes, downstream caches) who already downloaded the bundle keeps their copy. Purge cannot retroactively wipe distributed copies.</li>
        <li>· The version row is replaced by a tombstone in the mirror; future appends to the same slot will start at the next version index.</li>
      </ul>

      <div className="flex gap-2">
        <Button variant="outline" full onClick={handleClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="danger" full disabled={pending || !version} onClick={() => void handleConfirm()}>
          {pending ? 'Purging…' : 'Purge permanently'}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Modal>
  )
}

export { PurgeConfirmModal }
export type { PurgeConfirmModalProps }
