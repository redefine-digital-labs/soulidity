'use client'

import { useEffect, useRef, useState } from 'react'
import { formatEquipmentMarketAmount } from '@/lib/animacraft/equipment-market-amount'
import { parseEquipmentPurchaseOriginal, queryEquipmentPurchaseOriginal } from '@/lib/animacraft/equipment-market-purchase-original'
import type { EquipmentMarketPurchaseFunds } from '@/lib/animacraft/equipment-market-purchase-funds'
import { createNativeReceiveClient, receiveId } from '@/lib/animacraft/native-receive'

const maxOriginalBytes = 500_000
type Selected = { original: unknown; record: ReturnType<typeof parseEquipmentPurchaseOriginal> }

export function EquipmentPurchaseEvidence({ proof }: { proof: EquipmentMarketPurchaseFunds }) {
  if (proof.status === 'LEGACY_EFFECTS') {
    return <p role="status">The original checkpoint is available. This effects format has no verified funds or custody result.</p>
  }
  if (proof.status !== 'FUNDS_VERIFIED') {
    const messages = {
      MISSING: 'The original digest was not found. Its payment outcome is still unknown.',
      PENDING: 'The original transaction is awaiting a checkpoint.',
      FAILED: 'The original transaction was reported as failed.',
    }
    return <p role="status">{messages[proof.status]}</p>
  }
  const { receipt, coinType, custody } = proof
  return <article aria-label="Verified original component settlement" className="space-y-2 break-all">
    <p>Original checkpoint {proof.checkpoint} · net gas {proof.gas.netGasCharge} MIST.</p>
    <p>Buyer paid {formatEquipmentMarketAmount(receipt.grossAtomic, coinType)}.</p>
    <p>Seller received {formatEquipmentMarketAmount(receipt.sellerAtomic, coinType)} · platform treasury credited {formatEquipmentMarketAmount(receipt.protocolAtomic, coinType)}.</p>
    {custody && <>
      <p>Original delivery · {receipt.assetId} · {custody.itemType}</p>
      <p>Original listing {receipt.listingId} · component source {custody.sourceId}</p>
      <p>Original buyer {custody.originalHolder} received the component at ownership epoch {custody.originalOwnershipEpoch}.</p>
      {custody.status === 'CURRENT_UNAVAILABLE'
        ? <p role="status">Current custody could not be verified. Query the same original digest to check again.</p>
        : <>
          <p>Current holder {custody.currentHolder} · ownership epoch {custody.currentOwnershipEpoch}</p>
          {custody.currentListingId
            ? <p>Current listing {custody.currentListingId}</p>
            : <p>Current address owner {custody.currentAddressOwner}</p>}
          {custody.status === 'SUPERSEDED' && <p>Custody or listing state changed after the original purchase.</p>}
        </>}
    </>}
  </article>
}

/** Portable files stay in the active page. The selected digest is queried
 * explicitly, independently of wallet state or the current market selection.
 */
export function EquipmentMarketPurchaseRecovery() {
  const active = useRef<AbortController | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [proof, setProof] = useState<EquipmentMarketPurchaseFunds | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  useEffect(() => () => active.current?.abort(), [])

  function begin() {
    const request = new AbortController()
    active.current?.abort()
    active.current = request
    setProof(null)
    setError(null)
    setStopped(false)
    setPending(true)
    const current = () => active.current === request && !request.signal.aborted
    return { request, current, finish() {
      if (current()) { active.current = null; setPending(false) }
    } }
  }

  async function select(file: File | undefined) {
    const operation = begin()
    setSelected(null)
    try {
      if (!file) return
      if (!file.size || file.size > maxOriginalBytes) throw Error('Select a component purchase JSON file under 500 KB.')
      const original: unknown = JSON.parse(await file.text())
      if (!operation.current()) return
      const selection = original as { snapshot?: { asset?: { itemId?: unknown } } } | null
      const itemId = receiveId(selection?.snapshot?.asset?.itemId)
      const record = parseEquipmentPurchaseOriginal(original, itemId)
      setSelected({ original, record })
    } catch (cause) {
      if (operation.current()) setError(cause instanceof Error ? cause.message : 'The original file could not be read.')
    } finally { operation.finish() }
  }

  async function verify() {
    if (!selected || active.current) return
    const { original, record } = selected
    const operation = begin()
    try {
      const signal = operation.request.signal
      const result = await queryEquipmentPurchaseOriginal(original, record.snapshot.asset.itemId, createNativeReceiveClient(signal), signal)
      if (!operation.current()) return
      if (result.transactionDigest !== record.digest) throw Error('The evidence does not match the selected original digest.')
      setProof(result)
    } catch (cause) {
      if (operation.current()) setError(cause instanceof Error ? cause.message : 'The original purchase could not be verified.')
    } finally { operation.finish() }
  }

  function stop() {
    active.current?.abort()
    active.current = null
    setPending(false)
    setStopped(true)
  }

  return <section aria-label="Import original component purchase" className="space-y-2 text-sm">
    <h3>Recover an original component purchase</h3>
    <p>Use the exported JSON to verify this original purchase and custody from public chain data.</p>
    <label>Original component purchase JSON <input type="file" accept="application/json,.json"
      onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        void select(file)
      }}/></label>
    {selected && <div className="space-y-2 break-all">
      <p>Selected {selected.record.snapshot.asset.kind === 'base' ? 'Base' : 'External'} component {selected.record.snapshot.asset.itemId}</p>
      <p>Maker {selected.record.snapshot.target.rootId} · buyer in file {selected.record.snapshot.actor}</p>
      <p>Original digest {selected.record.digest}</p>
      <button type="button" disabled={pending} onClick={() => void verify()}>Verify imported component purchase</button>
    </div>}
    {pending && <><p role="status">Reading component evidence…</p><button type="button" onClick={stop}>Stop component recovery</button></>}
    {stopped && <p role="status">Stopped component recovery. The original digest can be checked again.</p>}
    {error && <p role="alert">{error}</p>}
    {proof && <EquipmentPurchaseEvidence proof={proof}/>}
  </section>
}
