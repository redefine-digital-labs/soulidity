'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface PurgeConfirmModalProps {
  open: boolean
  version: { kindName: string; name: string; versionIndex: number | string } | null
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
          This is the irreversible step after a soft-delete. Once the transaction succeeds, the version's on-chain Walrus Blob object is burned and the retained content slot is marked purged.
        </p>
      </div>

      <ul className="mb-5 space-y-1.5 text-[12px] text-muted">
        <li>· The Soul will no longer hold the Blob object for this artifact. Its historical slot and blob ID remain on chain.</li>
        <li>· Anyone (agent runtimes, downstream caches) who already downloaded the bundle keeps their copy. Purge cannot retroactively wipe distributed copies.</li>
        <li>· Purged version indexes are not reused; future appends to the same named content use the next version index.</li>
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
