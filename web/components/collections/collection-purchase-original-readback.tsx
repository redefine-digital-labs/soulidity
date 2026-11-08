'use client'

import { useEffect, useRef, useState } from 'react'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { createNativeReceiveClient } from '@/lib/animacraft/native-receive'
import { readCollectionBuyHandoff } from '@/lib/collections/collection-buy-handoff'
import { parseCollectionBuyRecord, queryCollectionBuyOriginal } from '@/lib/collections/collection-buy-operation'
import type { CollectionBuyQuery, CollectionBuyRecord } from '@/lib/collections/collection-buy-plan'

const MAX_RECORD_BYTES = 3 * 1024 * 1024
type Handoff = Awaited<ReturnType<typeof readCollectionBuyHandoff>>

export function CollectionPurchaseOriginalReadback({ collectionId }: { collectionId: string }) {
  const operation = useRef<AbortController | null>(null)
  const [record, setRecord] = useState<CollectionBuyRecord | null>(null)
  const [history, setHistory] = useState<CollectionBuyQuery | null>(null)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
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
    setHandoff(null)
    try {
      if (!file) return
      if (!file.size || file.size > MAX_RECORD_BYTES) throw new Error('Choose a Collection purchase JSON file up to 3 MiB.')
      let selected
      try { selected = parseCollectionBuyRecord(JSON.parse(await file.text())) }
      catch { throw new Error('The file does not contain a valid original Collection purchase record.') }
      if (selected.plan.request.collectionId !== normalizeSuiAddress(collectionId) || selected.plan.target.chainIdentifier !== '35834a8a') {
        throw new Error('Choose an original Sui mainnet purchase record for this Collection.')
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
    setHandoff(null)
    let original = history?.status === 'SUCCEEDED' ? history : null
    try {
      const client = createNativeReceiveClient(signal)
      if (!original) {
        const observed = await queryCollectionBuyOriginal({ client, record, signal })
        if (signal.aborted) return
        setHistory(observed)
        if (observed.status !== 'SUCCEEDED') return
        original = observed
      }
      if (!original.receipt) throw new Error('Missing purchase receipt')
      const current = await readCollectionBuyHandoff({ client, plan: record.plan, receipt: original.receipt, signal })
      if (!signal.aborted) setHandoff(current)
    } catch {
      if (!signal.aborted) setMessage(original
        ? 'Current custody could not be verified. You can retry this read.'
        : 'The original transaction could not be verified. You can retry the same digest.')
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
  return <details className="rounded-xl border border-border bg-card2 p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Verify an original Collection purchase</summary>
    <div className="mt-3 space-y-3">
      <p className="text-muted">Choose your exported purchase record to read the original settlement and current custody on Sui mainnet.</p>
      <label className="block">
        Original Collection purchase record
        <input className="block" type="file" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void select(file)
        }} />
      </label>
      {record && <p className="break-all">Original digest <code>{record.packet.digest}</code></p>}
      {busy ? <button type="button" onClick={stop}>Stop Collection purchase read</button>
        : record && history?.status !== 'FAILED' && <button className="underline" type="button" onClick={() => void query()}>
          {receipt ? 'Check current Collection custody' : 'Query original Collection purchase'}
        </button>}
      {message && <p role="status">{message}</p>}
      {history?.status === 'MISSING' && <p>The original digest was not found. You can query it again.</p>}
      {history?.status === 'PENDING' && <p>The original transaction is awaiting checkpoint evidence.</p>}
      {history?.status === 'FAILED' && <p>The original transaction failed at checkpoint {history.checkpoint}.</p>}
      {receipt && <div className="break-all space-y-1">
        <p className="font-semibold">Original purchase verified at checkpoint {history?.checkpoint}</p>
        <p>Right <code>{receipt.rightId}</code></p>
        <p>Original buyer Kiosk <code>{receipt.buyerKioskId}</code></p>
        <p>Seller received {formatAtomicAmountForDisplay(receipt.priceAtomic)} · <code>{receipt.sellerAddress}</code></p>
        <p>Platform received {formatAtomicAmountForDisplay(receipt.platformFeeAtomic)}
          {receipt.settlement?.feeRecipient && <> · <code>{receipt.settlement.feeRecipient}</code></>}
        </p>
        <p>Total payment {formatAtomicAmountForDisplay(receipt.totalPaymentAtomic)}</p>
        {receipt.settlement && <p>Net network gas {receipt.settlement.netGasMist} MIST</p>}
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
