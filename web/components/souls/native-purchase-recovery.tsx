'use client'

import { Button } from '@/components/ui/button'
import type { useNativeMarketBuyActions } from '@/lib/hooks/use-native-market-buy-actions'

export function NativePurchaseRecovery({ actions }: { actions: ReturnType<typeof useNativeMarketBuyActions> }) {
  const record = actions.record
  return <section aria-label="Purchase recovery" className="mt-4 space-y-3">
    {actions.error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">{actions.error}</p>}
    {actions.needsRecovery && record && <div className="rounded-xl border border-border bg-card2 px-4 py-3">
      <p className="text-sm font-semibold">Saved purchase · {record.phase}</p>
      <p className="mt-1 break-all text-[11px] text-muted">{record.digest}</p>
      <p className="mt-2 text-xs text-muted">
        {record.phase === 'RETIRED'
          ? 'This request has expired and is archived. Its past result may still be unknown; it will never be submitted again.'
          : record.phase === 'SUCCEEDED'
            ? 'Check this recorded purchase to verify its receipt and current wallet state. Do not repeat payment for this saved transaction.'
            : 'Check this saved transaction before retrying. Recovery uses the same transaction and keeps its payment evidence.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={actions.busy} onClick={() => void actions.check()}>Check saved purchase</Button>
        {record.phase !== 'RETIRED' && <Button variant="outline" disabled={actions.busy} onClick={() => void actions.resume()}>Resume saved purchase</Button>}
        {record.phase === 'PREPARED' && record.signature === null &&
          <Button variant="outline" disabled={actions.busy} onClick={() => void actions.cancelUnsigned()}>Discard unsigned request</Button>}
        {['SIGNING','SIGNED'].includes(record.phase) &&
          <Button variant="outline" disabled={actions.busy} onClick={() => void actions.retireExpired()}>Check expiry and archive</Button>}
      </div>
      {['SIGNING','SIGNED'].includes(record.phase) && <p className="mt-2 text-xs text-muted">
        Archiving requires a confirmed chain checkpoint after the transaction expiry. It preserves the record and does not mean the purchase failed.
      </p>}
    </div>}
    {actions.history.length > 0 && <details className="rounded-xl border border-border bg-card2 px-4 py-3">
      <summary className="cursor-pointer text-sm">Purchase history ({actions.history.length})</summary>
      <p className="mt-2 text-xs text-muted">Checking an archived transaction never signs, pays again or changes your current Soul state.</p>
      <ul className="mt-3 space-y-3">
        {actions.history.map(value => <li key={value.digest} className="border-t border-border pt-3">
          <p className="break-all text-[11px] text-muted">{value.digest}</p>
          <p role="status" className="mt-1 text-xs text-muted">{historyMessage(actions.historyResults[value.digest])}</p>
          <Button variant="outline" disabled={actions.busy} aria-label={`Check archived purchase ${value.digest}`}
            onClick={() => void actions.checkHistory(value.digest)}>Check archived purchase</Button>
        </li>)}
      </ul>
    </details>}
    <Button variant="outline" disabled={actions.busy || actions.loading} onClick={actions.refresh}>Refresh purchase state</Button>
  </section>
}

function historyMessage(status?: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED') {
  switch (status) {
    case 'SUCCEEDED': return 'Purchase confirmed on chain. This historical result does not prove current ownership.'
    case 'FAILED': return 'This transaction failed on chain.'
    case 'PENDING': return 'A transaction was found; final confirmation is still pending.'
    case 'MISSING': return 'Not found by the current chain query. The past payment result remains unknown, not failed.'
    default: return 'Archived transaction; historical result has not been checked in this session.'
  }
}
