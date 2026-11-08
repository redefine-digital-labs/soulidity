'use client'

import { useEffect, useRef, useState } from 'react'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { createNativeReceiveClient } from '@/lib/animacraft/native-receive'
import { readCollectionBuyHandoff } from '@/lib/collections/collection-buy-handoff'
import { parseCollectionBuyRecord, queryCollectionBuyOriginal } from '@/lib/collections/collection-buy-operation'
import type { CollectionBuyQuery, CollectionBuyRecord } from '@/lib/collections/collection-buy-plan'
import { readCollectionCommandListing } from '@/lib/collections/collection-command-listing-readback'
import { parseCollectionCommandRecord, queryCollectionCommandOriginal } from '@/lib/collections/collection-command-operation'
import type { CollectionCommandQuery, CollectionCommandRecord } from '@/lib/collections/collection-command-plan'

const MAX_RECORD_BYTES = 3 * 1024 * 1024
type OriginalRecord = CollectionBuyRecord | CollectionCommandRecord
type History = CollectionBuyQuery | CollectionCommandQuery
type Current = Awaited<ReturnType<typeof readCollectionBuyHandoff> | ReturnType<typeof readCollectionCommandListing>>
const listingAction = { list: 'listing', reprice: 'price change', delist: 'listing cancellation' } as const

export function CollectionOriginalReadback({ collectionId }: { collectionId: string }) {
  const operation = useRef<AbortController | null>(null)
  const [record, setRecord] = useState<OriginalRecord | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => () => operation.current?.abort(), [])

  function begin() {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setMessage(null)
    return controller.signal
  }

  function finish(signal: AbortSignal) {
    if (signal.aborted) return
    operation.current = null
    setBusy(false)
  }

  async function select(file?: File) {
    const signal = begin()
    setRecord(null)
    setHistory(null)
    setCurrent(null)
    try {
      if (!file) return
      if (!file.size || file.size > MAX_RECORD_BYTES) throw new Error('Choose a Collection recovery JSON file up to 3 MiB.')
      let selected: OriginalRecord
      try {
        const value = JSON.parse(await file.text())
        selected = value?.schema === 'soulidity.collection-command.v1' ? parseCollectionCommandRecord(value) : parseCollectionBuyRecord(value)
      } catch { throw new Error('The file does not contain a valid Collection purchase or listing record.') }
      if (selected.plan.request.collectionId !== normalizeSuiAddress(collectionId) || selected.plan.target.chainIdentifier !== '35834a8a') {
        throw new Error('Choose an original Sui mainnet record for this Collection.')
      }
      if (!signal.aborted) setRecord(selected)
    } catch (error) {
      if (!signal.aborted && error instanceof Error) setMessage(error.message)
    } finally {
      finish(signal)
    }
  }

  async function query() {
    if (!record) return
    const signal = begin()
    setCurrent(null)
    let original = history?.status === 'SUCCEEDED' ? history : null
    try {
      const client = createNativeReceiveClient(signal)
      if (!original) {
        const observed = record.schema === 'soulidity.collection-buy.v1'
          ? await queryCollectionBuyOriginal({ client, record, signal })
          : await queryCollectionCommandOriginal({ client, record, signal })
        if (signal.aborted) return
        setHistory(observed)
        if (observed.status !== 'SUCCEEDED') return
        original = observed
      }
      const receipt = original.receipt
      if (!receipt) throw new Error('Missing Collection receipt')
      let currentRead: Current
      if (record.schema === 'soulidity.collection-buy.v1' && 'buyerAddress' in receipt) {
        currentRead = await readCollectionBuyHandoff({ client, plan: record.plan, receipt, signal })
      } else if (record.schema === 'soulidity.collection-command.v1' && 'newListingId' in receipt) {
        currentRead = await readCollectionCommandListing({ client, plan: record.plan, receipt, signal })
      } else {
        throw new Error('Collection receipt kind changed')
      }
      if (!signal.aborted) setCurrent(currentRead)
    } catch {
      if (signal.aborted) return
      if (!original) setMessage('The original transaction could not be verified. You can retry the same digest.')
      else if (record.schema === 'soulidity.collection-buy.v1') setMessage('Current custody could not be verified. You can retry this read.')
      else setMessage('Current listing and custody could not be verified. You can retry this read.')
    } finally {
      finish(signal)
    }
  }

  function stop() {
    operation.current?.abort()
    operation.current = null
    setBusy(false)
    setMessage('Read stopped.')
  }

  const receipt = history?.receipt
  const purchase = receipt && 'buyerAddress' in receipt ? receipt : null
  const listing = receipt && 'newListingId' in receipt ? receipt : null
  const handoff = current && 'status' in current ? current : null
  const listingRead = current && 'listingStatus' in current ? current : null
  const action = record?.schema === 'soulidity.collection-command.v1' ? listingAction[record.plan.request.action] : null
  const queryLabel = action ? 'Query original Collection listing command' : 'Query original Collection purchase'
  const currentLabel = action ? 'Check current Collection listing' : 'Check current Collection custody'
  return <details className="rounded-xl border border-border bg-card2 p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Verify an original Collection transaction</summary>
    <div className="mt-3 space-y-3">
      <p className="text-muted">Choose a recovery file to verify a purchase, listing, price change or cancellation on Sui mainnet.</p>
      <label className="block">
        Original Collection recovery record
        <input className="block" type="file" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void select(file)
        }} />
      </label>
      {record && <p className="break-all">Original digest <code>{record.packet.digest}</code></p>}
      {busy ? <button type="button" onClick={stop}>Stop Collection transaction read</button>
        : record && history?.status !== 'FAILED' && <button className="underline" type="button" onClick={() => void query()}>
          {receipt ? currentLabel : queryLabel}
        </button>}
      {message && <p role="status">{message}</p>}
      {history?.status === 'MISSING' && <p>The original digest was not found. You can query it again.</p>}
      {history?.status === 'PENDING' && <p>The original transaction is awaiting checkpoint evidence.</p>}
      {history?.status === 'FAILED' && <p>The original transaction failed at checkpoint {history.checkpoint}.</p>}
      {purchase && <div className="break-all space-y-1">
        <p className="font-semibold">Original purchase verified at checkpoint {history?.checkpoint}</p>
        <p>Right <code>{purchase.rightId}</code></p>
        <p>Original buyer Kiosk <code>{purchase.buyerKioskId}</code></p>
        <p>Seller received {formatAtomicAmountForDisplay(purchase.priceAtomic)} · <code>{purchase.sellerAddress}</code></p>
        <p>Platform received {formatAtomicAmountForDisplay(purchase.platformFeeAtomic)}
          {purchase.settlement?.feeRecipient && <> · <code>{purchase.settlement.feeRecipient}</code></>}
        </p>
        <p>Total payment {formatAtomicAmountForDisplay(purchase.totalPaymentAtomic)}</p>
        {purchase.settlement && <p>Net network gas {purchase.settlement.netGasMist} MIST</p>}
      </div>}
      {listing && <div className="break-all space-y-1">
        <p className="font-semibold">Original {action} verified at checkpoint {history?.checkpoint}</p>
        <p>Right <code>{listing.rightId}</code></p>
        {listing.oldListingId && <p>Retired listing <code>{listing.oldListingId}</code></p>}
        {listing.newListingId && <p>Created listing <code>{listing.newListingId}</code></p>}
        {listing.priceAtomic !== null && <p>Listing price {formatAtomicAmountForDisplay(listing.priceAtomic)}</p>}
      </div>}
      {listingRead && <div className="break-all space-y-1">
        <p>Current holder <code>{listingRead.holderAddress}</code></p>
        <p>Current Kiosk <code>{listingRead.holderKioskId}</code></p>
        <p>Exact listing <code>{listingRead.listingId}</code> · {listingRead.listingStatus.toLowerCase()}</p>
      </div>}
      {handoff && <div className="break-all space-y-1">
        <p className="font-semibold">{handoff.status === 'CUSTODY_CHANGED' ? 'Current custody differs from the original delivery' : 'Original buyer handoff verified'}</p>
        <p>Current holder <code>{handoff.holder}</code></p>
        <p>Current Kiosk <code>{handoff.kioskId}</code></p>
        {handoff.status === 'BUYER_HANDOFF_VERIFIED' && <>
          <p>Personal Kiosk cap <code>{handoff.kioskCapId}</code></p>
          <p>{handoff.reserved ? 'A Kiosk reservation was observed.' : 'No Kiosk reservation was observed.'}</p>
        </>}
      </div>}
    </div>
  </details>
}
