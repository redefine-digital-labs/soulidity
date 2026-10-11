'use client'

import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { Button } from '@/components/ui/button'
import type { useCollectionBuy } from '@/lib/hooks/use-collection-buy'
import type { CollectionBuyRecord } from '@/lib/collections/collection-buy-plan'
import { publicMutationCanonical } from '@/lib/sui/public-mutation-journal'

function gasBudget(record: CollectionBuyRecord) {
  const n = BigInt(Transaction.from(fromBase64(record.packet.bytes)).getData().gasData.budget!)
  const tail = String(n % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '')
  return `${n / 1_000_000_000n}${tail ? '.' + tail : ''} SUI`
}
type Purchase = ReturnType<typeof useCollectionBuy>
export function CollectionPurchasePanel({ purchase, offered, expanded, onExpand }: {
  purchase: Purchase; offered: boolean; expanded: boolean; onExpand: () => void
}) {
  const [backup, setBackup] = useState(''), [importText, setImportText] = useState(''), [localError, setLocalError] = useState<string | null>(null)
  const current = useRef(purchase.identityKey), mounted = useRef(true)
  useLayoutEffect(() => { current.current = purchase.identityKey }, [purchase.identityKey])
  const scope = purchase.identityKey, matches = () => mounted.current && current.current === scope
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const formScope = scope
  const [previousFormScope, setPreviousFormScope] = useState(formScope)
  if (previousFormScope !== formScope) { setPreviousFormScope(formScope); setBackup(''); setImportText(''); setLocalError(null) }
  async function perform(work: () => Promise<unknown>) {
    if (!matches()) return
    setLocalError(null)
    try { await work() } catch (cause) { if (matches()) setLocalError(cause instanceof Error ? cause.message : 'Purchase recovery unavailable') }
  }
  const unresolved = purchase.records.filter(r => !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.packet.phase) && r.plan.author === purchase.currentAddress)
  const recordView = (record: CollectionBuyRecord, archived = false) => {
    const p = record.plan, q = p.quote, terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.packet.phase)
    const owner = p.author === purchase.currentAddress, release = publicMutationCanonical(p.target) === purchase.targetKey
    return <div key={`${record.packet.digest}:${archived}`} className="min-w-0 rounded-lg border border-border bg-card2 p-3 space-y-2">
      <p className="text-xs font-semibold">Purchase · {record.packet.phase}{archived ? ' · retained receipt' : ''}</p>
      <p className="text-[11px] text-muted break-all">Transaction: {record.packet.digest}</p>
      <div className="text-xs space-y-1 break-words">
        <p>Seller receives: {formatAtomicAmountForDisplay(q.sellerReceivesAtomic)}</p>
        <p>Platform fee: {formatAtomicAmountForDisplay(q.feeAtomic)} ({q.feeBps / 100}%)</p>
        <p className="font-semibold">Total USDC payment: {formatAtomicAmountForDisplay(q.buyerTotalAtomic)}</p>
        <p>SUI gas budget: {gasBudget(record)} · expires after epoch {record.packet.expirationEpoch}</p>
        <p>{p.buyerKiosk.kind === 'NEW' ? 'Creates and registers your personal Kiosk in this same transaction.' : 'Receives the Collection Right into your verified personal Kiosk.'}</p>
      </div>
      <p className="text-[11px] text-muted">This saved quote and transaction are fixed. Gas budget is a cap, not the final gas charge. A lost response does not authorize another payment.</p>
      {!owner && !terminal && <p className="text-xs text-muted break-all">Connect purchasing wallet {p.author} to resume. Query and backup remain available.</p>}
      {!release && !terminal && <p className="text-xs text-muted">Release configuration changed. This purchase is query-only and will not be rebuilt.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={purchase.pending} onClick={() => void perform(() => purchase.run(record, 'query'))}>Query purchase</Button>
        {!archived && !terminal && <Button variant="gold" disabled={purchase.pending || !owner || !release}
          onClick={() => void perform(() => purchase.run(record, 'resume'))}>
          {record.packet.phase === 'PREPARED' ? 'Sign and buy' : 'Resume same purchase'}
        </Button>}
        {!archived && record.packet.phase === 'PREPARED' && <Button variant="outline" disabled={purchase.pending}
          onClick={() => void perform(() => purchase.run(record, 'cancel-unsigned'))}>Cancel unsigned purchase</Button>}
        <Button variant="outline" disabled={purchase.pending} onClick={() => { try { if (matches()) setBackup(purchase.exportRecord(record)) }
          catch (cause) { if (matches()) setLocalError(cause instanceof Error ? cause.message : 'Backup unavailable') } }}>Export purchase recovery</Button>
      </div>
    </div>
  }
  const visible = expanded || purchase.records.length > 0 || purchase.history.length > 0
  return <section aria-label="Collection purchase recovery" className="min-w-0 rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-lg font-bold">Purchase & recovery</h2>
      {!visible && <Button variant="outline" size="sm" onClick={onExpand}>Open purchase recovery</Button>}
    </div>
    {visible && <>
      <p className="text-xs text-muted">Buying this Collection Right transfers royalty participation, not creator authority to add Souls. Review the saved quote before signing. Existing recovery remains available even if the current listing disappears.</p>
      {unresolved.length === 0 && offered && <Button variant="gold" disabled={purchase.pending || !purchase.currentAddress}
        onClick={() => void perform(purchase.prepare)}>Review purchase transaction</Button>}
      {!purchase.currentAddress && <p className="text-xs text-muted">Connect a wallet to prepare or resume a purchase. Public receipts can still be queried or imported.</p>}
      {!offered && unresolved.length === 0 && <p className="text-xs text-muted">No verified purchasable listing. Recovery and historical queries remain available.</p>}
      {purchase.records.map(record => recordView(record))}
      {purchase.history.length > 0 && <details><summary className="cursor-pointer text-xs">Retained purchase receipts ({purchase.history.length})</summary>
        <div className="mt-2 space-y-2">{purchase.history.map(record => recordView(record, true))}</div></details>}
      <details><summary className="cursor-pointer text-xs">Import purchase recovery</summary><div className="mt-2 space-y-2">
        <label className="block text-xs" htmlFor="collection-purchase-import">Public recovery JSON</label>
        <textarea id="collection-purchase-import" className="w-full min-w-0 h-28 rounded-lg border border-border bg-card2 p-2 text-xs font-mono"
          value={importText} onChange={event => setImportText(event.target.value)} />
        <Button variant="outline" disabled={purchase.pending || !importText.trim()} onClick={() => void perform(() => purchase.importRecord(importText))}>Query and import purchase</Button>
      </div></details>
      {backup && <div><label className="block text-xs mb-2" htmlFor="collection-purchase-export">Save this public recovery JSON before switching browsers</label>
        <textarea id="collection-purchase-export" readOnly value={backup} className="w-full min-w-0 h-32 rounded-lg border border-border bg-card2 p-2 text-xs font-mono" /></div>}
    </>}
    {(localError || purchase.error) && <p role="alert" className="text-xs text-danger break-words">{localError ?? purchase.error}</p>}
    {purchase.status && <p role="status" className="text-xs text-muted break-words">{purchase.status}</p>}
    {purchase.currentObservation && <p className="text-xs text-muted break-words">{purchase.currentObservation}</p>}
  </section>
}
