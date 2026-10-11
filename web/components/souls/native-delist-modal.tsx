'use client'

import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

import { useQueryClient } from '@tanstack/react-query'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useNativeMarketCancelActions } from '@/lib/hooks/use-native-market-cancel-actions'
import type { MarketCancelOperationRecord, MarketCancelQueryResult } from '@/lib/animacraft/market-cancel-operation'

export function NativeDelistModal({ soul, open, onClose }: {
  soul: ChainSoulDetail; open: boolean; onClose: () => void
}) {
  const queryClient = useQueryClient(), { showToast } = useToast()
  const actions = useNativeMarketCancelActions({ soulId: soul.onChainId, stateId: soul.stateOnChainId,
    listingId: soul.listingObjectOnChainId, kioskCapId: soul.currentKioskCapOnChainId, enabled: open,
    onChanged: () => {
      void queryClient.invalidateQueries({ queryKey: ['soul'] })
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      void queryClient.invalidateQueries({ queryKey: ['souls'] })
    },
  })
  const finish = async (action: () => Promise<MarketCancelOperationRecord | null>) => {
    const result = await action()
    if (result?.phase === 'SUCCEEDED' && result.syncStatus === 'COMPLETE') {
      showToast('Soul delisted successfully', 'success'); onClose()
    } else if (result?.phase === 'SUCCEEDED' && result.syncStatus === 'SUPERSEDED') {
      showToast('Cancellation confirmed. The Soul has changed since then; its current state was preserved.', 'success'); onClose()
    }
  }
  const recovery = <div className="mt-3 rounded-xl border border-gold/25 px-4 py-3" role="status">
    <p className="text-sm">Saved cancellation · {actions.record?.phase}</p>
    {actions.record?.phase === 'SUCCEEDED' && actions.record.syncStatus === 'PENDING' &&
      <p className="mt-1 text-xs text-muted">Confirmed on chain. Current chain-state verification is still pending.</p>}
    {actions.record?.phase === 'RETIRED' && <p className="mt-1 text-xs text-muted">
      Expired and archived. This request cannot be submitted again; its past result is still unknown.
      Refresh the listing before starting a new cancellation. The original transaction remains in history.
    </p>}
    <p className="mt-1 break-all text-[11px] text-muted">{actions.record?.digest}</p>
    <p className="mt-2 text-xs text-muted">
      Check the saved transaction first. Closing this page does not discard its record.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" disabled={actions.busy} onClick={() => void finish(actions.check)}>Check saved transaction</Button>
      {actions.record?.phase !== 'RETIRED' &&
        <Button variant="outline" disabled={actions.busy} onClick={() => void finish(actions.resume)}>Resume saved cancellation</Button>}
      {actions.record?.phase === 'PREPARED' && actions.record.signature === null &&
        <Button variant="outline" disabled={actions.busy} onClick={() => void actions.cancelUnsigned()}>Discard unsigned request</Button>}
      {['SIGNING', 'SIGNED'].includes(actions.record?.phase ?? '') &&
        <Button variant="outline" disabled={actions.busy} onClick={() => void finish(actions.retireExpired)}>Check expiry and archive</Button>}
    </div>
    {['SIGNING', 'SIGNED'].includes(actions.record?.phase ?? '') && <p className="mt-2 text-xs text-muted">
      Archiving requires chain confirmation that this transaction can no longer execute. It preserves the full record and does not mean the cancellation failed.
    </p>}
  </div>
  const history = actions.history.length > 0 && <details className="mt-3 rounded-xl border border-gold/25 px-4 py-3">
    <summary className="cursor-pointer text-sm">Cancellation history ({actions.history.length})</summary>
    <p className="mt-2 text-xs text-muted">Archived requests are never signed or submitted again. Checking history does not change the current listing.</p>
    <ul className="mt-3 space-y-3">
      {actions.history.map(value => <li key={value.digest} className="border-t border-gold/15 pt-3">
        <p className="break-all text-[11px] text-muted">{value.digest}</p>
        <p className="mt-1 text-xs text-muted">{historyResult(actions.historyResults[value.digest])}</p>
        <Button variant="outline" disabled={actions.busy} aria-label={`Check archived transaction ${value.digest}`}
          onClick={() => void actions.checkHistory(value.digest)}>Check archived transaction</Button>
      </li>)}
    </ul>
  </details>
  const error = actions.error && <p role="alert" className="mt-3 text-xs text-danger">{actions.error}</p>
  return <>
    {/* Always mounted on a native Soul page, even after custody/listing changes. */}
    {!open && (actions.needsRecovery || actions.error || actions.history.length > 0) && <section aria-label="Cancellation recovery" className="mt-5">
      {actions.needsRecovery && recovery}{history}{error}
    </section>}
    <Modal open={open} onClose={() => { if (!actions.busy) onClose() }} maxWidth="sm" title="Delist Soul" subtitle={soul.name}>
      <div className="rounded-xl border border-danger/25 bg-danger/[0.06] px-4 py-3 mb-5">
        <p className="text-sm text-foreground">Are you sure you want to remove this Soul from the marketplace?</p>
        {soul.listedPriceAtomic && <p className="mt-1 text-xs text-muted">
          Current listing price: <span className="text-gold font-semibold">{formatAtomicAmountForDisplay(soul.listedPriceAtomic)}</span>
        </p>}
      </div>
      <p className="text-[11px] text-muted mb-5">
        The Soul will be returned to your kiosk and no longer visible in the marketplace. You can relist it at any time.
      </p>
      {actions.loading && <p role="status" className="mb-3 text-xs text-muted">Verifying the current listing and wallet capability…</p>}
      {actions.snapshot && !actions.snapshot.release.writesEnabled && <p className="mb-3 text-xs text-muted">
        Cancellation signing is disabled until this release is accepted. Saved transaction checks remain available.
      </p>}
      {actions.snapshot && (!actions.snapshot.listed || !actions.snapshot.listingActive) && <p className="mb-3 text-xs text-muted">
        This listing is no longer active. Check any saved cancellation to finish recovery.
      </p>}
      {actions.record?.phase === 'FAILED' && <p className="mb-3 text-xs text-danger">
        The saved cancellation failed on chain. Refresh the listing before preparing a new request.
      </p>}
      <div className="flex gap-2">
        <Button variant="outline" full onClick={onClose} disabled={actions.busy}>Cancel</Button>
        <Button variant="danger" full disabled={!actions.canStart} onClick={() => void finish(actions.start)}>
          {actions.busy ? 'Recovering…' : 'Delist Soul'}
        </Button>
      </div>
      <Button variant="outline" disabled={actions.busy || actions.loading} onClick={actions.refresh}>Refresh listing</Button>
      {actions.needsRecovery && recovery}{history}{error}
    </Modal>
  </>
}

function historyResult(result?: MarketCancelQueryResult) {
  switch (result) {
    case 'SUCCEEDED': return 'Cancellation confirmed on chain. This historical result does not describe the current listing.'
    case 'FAILED': return 'This transaction failed on chain.'
    case 'PENDING': return 'A transaction was found, but final confirmation is not yet available.'
    case 'MISSING': return 'Not found by the current chain query. The past result remains unknown, not failed.'
    default: return 'Expired request archived; historical result has not been checked in this session.'
  }
}
