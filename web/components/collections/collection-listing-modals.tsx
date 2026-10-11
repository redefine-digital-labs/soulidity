'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@soulidity/sdk'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useCollectionCommands, type CollectionCommandSubject } from '@/lib/hooks/use-collection-commands'
import type { CollectionCommandRecord, CollectionCommandRequest } from '@/lib/collections/collection-command-plan'

interface CollectionModalProps { collection: CollectionCommandSubject; open: boolean; onClose: () => void }
const titles = { list: 'List Soul Collection', reprice: 'Edit Listing Price', delist: 'Delist Soul Collection' }
const amount = (value: string) => formatAtomicAmountForDisplay(value)
function gasBudget(record: CollectionCommandRecord) {
  const value = Transaction.from(fromBase64(record.packet.bytes)).getData().gasData.budget!
  const n = BigInt(value), whole = n / 1_000_000_000n, fraction = String(n % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SUI`
}

/** Original Collection forms, now using chain IDs and a persistent command.
 * Display props never authorize signing or impersonate a SQL summary. */
function CollectionCommandModal({ collection, open, onClose, action }: CollectionModalProps & { action: CollectionCommandRequest['action'] }) {
  const [price, setPrice] = useState(''), [backup, setBackup] = useState(''), [importText, setImportText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const queryClient = useQueryClient(), { showToast } = useToast()
  const commands = useCollectionCommands(open ? collection : null, () => {
    void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    void queryClient.invalidateQueries({ queryKey: ['collection'] })
    void queryClient.invalidateQueries({ queryKey: ['collections'] })
  })
  const formScope = JSON.stringify([collection.onChainId, open, action, commands.currentAddress, commands.targetKey])
  const [previousFormScope, setPreviousFormScope] = useState(formScope)
  if (previousFormScope !== formScope) { setPreviousFormScope(formScope); setPrice(''); setBackup(''); setImportText(''); setLocalError(null) }
  let priceAtomic: string | null = null, priceError: string | null = null
  if (action !== 'delist' && price.trim()) {
    try { const value = parseDisplayAmountToAtomic(price); if (value <= 0n) throw new Error('Enter a positive price')
      if (value > 18446744073709551615n) throw new Error('Price exceeds the on-chain u64 limit'); priceAtomic = String(value) }
    catch (cause) { priceError = cause instanceof Error ? cause.message : 'Invalid price' }
  }
  const samePrice = action === 'reprice' && priceAtomic !== null && priceAtomic === collection.listedPriceAtomic
  const relevant = commands.records.filter(record => !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.packet.phase)
    && record.plan.author === commands.currentAddress)
  async function perform(work: () => Promise<unknown>) {
    setLocalError(null)
    try { await work() } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Collection command failed') }
  }
  async function run(record: CollectionCommandRecord, mode: 'query' | 'resume' | 'cancel-unsigned') {
    await perform(async () => {
      const result = await commands.run(record, mode)
      if (result.status === 'SUCCEEDED' && mode === 'resume') showToast(`Collection ${record.plan.request.action} confirmed on chain`, 'success')
    })
  }
  const recordView = (record: CollectionCommandRecord, archived = false) => {
    const p = record.plan, q = p.quote, currentWallet = p.author === commands.currentAddress
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.packet.phase)
    const sameRelease = JSON.stringify(p.target) === commands.targetKey
    return <div key={`${record.packet.digest}:${archived}`} className="rounded-lg border border-border bg-card2/60 p-3 space-y-2">
      <p className="text-xs font-semibold">{p.request.action} · {record.packet.phase}{archived ? ' · retained receipt' : ''}</p>
      <p className="text-[11px] text-muted break-all">Transaction: {record.packet.digest}</p>
      {p.request.action !== 'delist' && <div className="text-xs space-y-1">
        <p>Seller receives: {amount(q.sellerReceivesAtomic)}</p>
        <p>Buyer adds platform fee: {amount(q.feeAtomic)} ({q.feeBps / 100}%)</p>
        <p>Buyer total: {amount(q.buyerTotalAtomic)}</p>
        <p className="text-[11px] text-muted">This is the current sale quote, not a fee charged to list. Sale fees can change before a future purchase.</p>
      </div>}
      <p className="text-xs">SUI gas budget: {gasBudget(record)} · expires after epoch {record.packet.expirationEpoch}</p>
      <p className="text-[11px] text-muted">The wallet signs these saved bytes. The budget is a cap, not the final gas charge.</p>
      {p.request.action === 'reprice' && <p className="text-[11px] text-muted">One transaction closes the old Listing and creates a new Listing at the approved price.</p>}
      {!currentWallet && !terminal && <p className="text-xs text-muted break-all">Connect the preparing wallet {p.author} to resume. Query and backup remain available.</p>}
      {!sameRelease && !terminal && <p className="text-xs text-muted">Release configuration changed. This request is query-only; it will not be rebuilt.</p>}
      <div className="flex flex-wrap gap-2">
        {!archived && <Button variant="outline" disabled={commands.pending} onClick={() => void run(record, 'query')}>Query result</Button>}
        {!archived && !terminal && <Button variant={p.request.action === 'delist' ? 'danger' : 'gold'}
          disabled={commands.pending || !currentWallet || !sameRelease} onClick={() => void run(record, 'resume')}>
          {record.packet.phase === 'PREPARED' ? 'Sign and submit' : 'Resume same request'}
        </Button>}
        {!archived && record.packet.phase === 'PREPARED' && <Button variant="outline" disabled={commands.pending}
          onClick={() => void run(record, 'cancel-unsigned')}>Cancel unsigned</Button>}
        <Button variant="outline" disabled={commands.pending} onClick={() => { try { setBackup(commands.exportRecord(record)) } catch (cause) {
          setLocalError(cause instanceof Error ? cause.message : 'Backup unavailable') } }}>Export recovery</Button>
      </div>
    </div>
  }
  return <Modal open={open} onClose={onClose} maxWidth="sm" title={titles[action]} subtitle={collection.name}
    className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
    <div className="space-y-4">
      {action !== 'list' && collection.listedPriceAtomic && <p className="text-sm">Current displayed price: {amount(collection.listedPriceAtomic)}</p>}
      {action !== 'delist' && <div>
        <label htmlFor={`collection-${action}-price`} className="block text-[10px] font-bold text-muted uppercase mb-1.5">{action === 'list' ? 'Listing' : 'New'} Price (USDC)</label>
        <input id={`collection-${action}-price`} type="text" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)}
          disabled={commands.pending || relevant.length > 0} placeholder="0.00"
          className="w-full rounded-lg border border-border bg-card2 px-3 py-2.5 text-sm outline-none focus:border-gold disabled:opacity-40" />
        {(priceError || samePrice) && <p className="mt-1 text-xs text-danger">{priceError ?? 'Same as current price'}</p>}
      </div>}
      <p className="text-[11px] text-muted">{action === 'delist'
        ? 'Remove this Listing and release its exclusive purchase reservation. The Right stays in your Kiosk; royalties remain yours. Delisting does not require the market to accept new listings.'
        : action === 'reprice' ? 'The old Listing is cancelled and a new Listing is created atomically. Royalties stay with you until a purchase transfers the Right.'
          : 'List your Collection Right. Royalties stay with you until a purchase transfers the Right. Listing itself only charges SUI gas.'}</p>
      {relevant.length === 0 && <Button variant={action === 'delist' ? 'danger' : 'gold'} full disabled={commands.pending || !commands.currentAddress
        || action !== 'delist' && (!priceAtomic || !!priceError || samePrice)}
        onClick={() => void perform(() => commands.prepare({ action, priceAtomic: action === 'delist' ? null : priceAtomic }))}>
        {commands.pending ? 'Checking chain…' : 'Review transaction'}
      </Button>}
      {commands.records.map(record => recordView(record))}
      {commands.history.length > 0 && <details><summary className="text-xs cursor-pointer">Retained receipts ({commands.history.length})</summary>
        <div className="space-y-2 mt-2">{commands.history.map(record => recordView(record, true))}</div></details>}
      {commands.status && <p role="status" className="text-xs">{commands.status}</p>}
      {commands.currentObservation && <p className="text-xs text-muted">{commands.currentObservation}</p>}
      {(localError || commands.error) && <p role="alert" className="text-xs text-danger">{localError || commands.error}</p>}
      {backup && <div className="ph-no-capture"><label className="text-xs">Public recovery backup — save this JSON before changing browsers or clearing local storage.</label>
        <textarea aria-label="Collection recovery backup" readOnly value={backup} rows={5} className="mt-1 w-full rounded border border-border bg-card2 p-2 text-[10px]" /></div>}
      <details className="ph-no-capture"><summary className="text-xs cursor-pointer">Import an existing recovery packet</summary>
        <textarea aria-label="Import collection recovery" value={importText} onChange={event => setImportText(event.target.value)} rows={4}
          className="mt-2 w-full rounded border border-border bg-card2 p-2 text-[10px]" />
        <Button variant="outline" disabled={commands.pending || !importText.trim()} onClick={() => void perform(() => commands.importRecord(importText))}>Import and query only</Button>
      </details>
      <p className="text-[10px] text-muted">Closing this form does not cancel a signed or unknown request. Reopening only queries; resuming requires your explicit action.</p>
      <Button variant="outline" full onClick={onClose}>Close</Button>
    </div>
  </Modal>
}
export function ListCollectionModal(props: CollectionModalProps) { return <CollectionCommandModal {...props} action="list" /> }
export function EditCollectionPriceModal(props: CollectionModalProps) { return <CollectionCommandModal {...props} action="reprice" /> }
export function DelistCollectionModal(props: CollectionModalProps) { return <CollectionCommandModal {...props} action="delist" /> }
