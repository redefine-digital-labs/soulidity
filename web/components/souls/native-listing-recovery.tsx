'use client'

import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { Button } from '@/components/ui/button'
import type { useNativeMarketListActions } from '@/lib/hooks/use-native-market-list-actions'

export function NativeListingRecovery({ actions }: { actions: ReturnType<typeof useNativeMarketListActions> }) {
  const record = actions.record
  return <section aria-label="Listing recovery" className="mt-4 space-y-3">
    {actions.confirmedResult?.phase === 'SUCCEEDED' && <p role="status" className="text-sm text-muted">
      {actions.confirmedResult.syncStatus === 'COMPLETE' ? 'Listing transaction and current chain state verified.'
        : actions.confirmedResult.syncStatus === 'SUPERSEDED' ? 'This listing transaction succeeded, but its listing is no longer current. The newer state was preserved.'
        : 'Listing transaction confirmed; current chain-state verification remains pending.'}
    </p>}
    {actions.error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{actions.error}</p>}
    {record && <div className="rounded-xl border border-border bg-card2 px-4 py-3">
      <p className="text-sm font-semibold">Saved {record.kind === 'reprice' ? 'price update' : 'listing'} · {record.phase}</p>
      <p className="mt-1 text-xs text-muted">Recorded price: {formatAtomicAmountForDisplay(record.priceAtomic)}</p>
      <p className="mt-1 break-all text-[11px] text-muted">{record.digest}</p>
      <p className="mt-2 text-xs text-muted">
        {record.phase === 'RETIRED'
          ? 'This request has expired and is archived. Its past result may still be unknown; it will never be submitted again.'
          : record.phase === 'SUCCEEDED'
            ? 'Check this recorded listing to verify its receipt and current wallet state. Do not create another transaction to recover it.'
            : 'Check this saved transaction before retrying. Recovery uses the same transaction and preserves its evidence.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={actions.busy} onClick={() => void actions.check()}>Check saved listing</Button>
        {record.phase !== 'RETIRED' && <Button variant="outline" disabled={actions.busy} onClick={() => void actions.resume()}>Resume saved listing</Button>}
        {record.phase === 'PREPARED' && record.signature === null &&
          <Button variant="outline" disabled={actions.busy} onClick={() => void actions.cancelUnsigned()}>Discard unsigned request</Button>}
        {['SIGNING','SIGNED'].includes(record.phase) &&
          <Button variant="outline" disabled={actions.busy} onClick={() => void actions.retireExpired()}>Check expiry and archive</Button>}
      </div>
      {['SIGNING','SIGNED'].includes(record.phase) && <p className="mt-2 text-xs text-muted">
        Archiving requires a confirmed chain checkpoint after the transaction expiry. It preserves the record and does not mean the listing failed.
      </p>}
    </div>}
    {actions.history.length > 0 && <details className="rounded-xl border border-border bg-card2 px-4 py-3">
      <summary className="cursor-pointer text-sm">Listing history ({actions.history.length})</summary>
      <p className="mt-2 text-xs text-muted">Checking an archived transaction never signs, lists again or changes your current Soul state.</p>
      <ul className="mt-3 space-y-3">
        {actions.history.map(value => <li key={value.digest} className="border-t border-border pt-3">
          <p className="break-all text-[11px] text-muted">{value.digest}</p>
          <p role="status" className="mt-1 text-xs text-muted">{historyMessage(actions.historyResults[value.digest])}</p>
          <Button variant="outline" disabled={actions.busy} aria-label={`Check archived listing ${value.digest}`}
            onClick={() => void actions.checkHistory(value.digest)}>Check archived listing</Button>
        </li>)}
      </ul>
    </details>}
    <Button variant="outline" disabled={actions.busy || actions.loading} onClick={actions.refresh}>Refresh listing state</Button>
  </section>
}

function historyMessage(status?: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED') {
  switch (status) {
    case 'SUCCEEDED': return 'Listing confirmed on chain. This historical result does not prove current ownership.'
    case 'FAILED': return 'This transaction failed on chain.'
    case 'PENDING': return 'A transaction was found; final confirmation is still pending.'
    case 'MISSING': return 'Not found by the current chain query. The past transaction result remains unknown, not failed.'
    default: return 'Archived transaction; historical result has not been checked in this session.'
  }
}
