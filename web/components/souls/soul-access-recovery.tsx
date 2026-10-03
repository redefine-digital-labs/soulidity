'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useSoulAccessMutations, type SoulAccessSubject } from '@/lib/hooks/use-soul-access-mutations'
import type { SoulAccessRecord } from '@/lib/soulidity/soul-access-plan'
import { PaidAccessQuote } from './paid-access-controls'

/** Outside tabs: switching between grants/content never hides an uncertain
 * payment. Old configuration and disconnected wallets still permit querying. */
export function SoulAccessRecoveryPanel({ soul, detailQueryId }: { soul: SoulAccessSubject; detailQueryId?: string }) {
  const queryClient = useQueryClient(), updated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId ?? soul.onChainId] })
    void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
  }, [queryClient, detailQueryId, soul.onChainId])
  const recovery = useSoulAccessMutations(soul, updated)
  const [purchase, setPurchase] = useState<{ record: SoulAccessRecord; identity: string } | null>(null)
  const selected = purchase?.identity === recovery.identityKey ? purchase.record : null
  function row(record: SoulAccessRecord, archived: boolean) {
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.packet.phase)
    return <div key={`${record.packet.digest}:${record.packet.phase}:${archived}`} className="mt-2 rounded-lg border border-[var(--border-soft)] p-3 text-xs">
      <p>{record.plan.action} · {record.plan.kind === null ? 'manual scope' : `kind ${record.plan.kind}`} · {record.packet.phase}{archived ? ' · retained receipt' : ''}</p>
      <p className="mt-1 break-all text-muted">Wallet {record.plan.author} · target {record.plan.granteeAddress ?? record.plan.paidAccessListId}</p>
      <p className="mt-1 break-all font-mono text-muted">{record.packet.digest}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => void recovery.query(record).catch(() => {})}>Check original transaction</Button>
        <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => recovery.exportRecord(record)}>Export public receipt</Button>
        {!archived && !terminal && <Button size="sm" variant="primary" disabled={recovery.pending || recovery.author !== record.plan.author}
          onClick={() => record.plan.action === 'paid-purchase' ? setPurchase({ record, identity: recovery.identityKey })
            : void recovery.resume(record).catch(() => {})}>Resume exact transaction</Button>}
        {!archived && record.packet.phase === 'PREPARED' && record.packet.signature === null && <Button size="sm" variant="outline"
          disabled={recovery.pending} onClick={() => void recovery.cancel(record).catch(() => {})}>Cancel unsigned preparation</Button>}
      </div>
    </div>
  }
  return <div className="m-4 rounded-xl border border-[var(--border-soft)] p-4" data-soul-access-recovery>
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Access changes & recovery</h3>
      <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => void recovery.refresh().catch(() => {})}>Refresh records</Button></div>
    <p className="mt-2 text-xs text-muted">Grants, pricing and purchases retain exact transaction bytes here. Check is read-only and needs no wallet. Resume never replaces an unknown payment. Local phase labels are not chain confirmation.</p>
    {recovery.records.map(record => row(record, false))}
    {recovery.history.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs">Retained earlier receipts ({recovery.history.length})</summary>
      {recovery.history.map(record => row(record, true))}</details>}
    {!recovery.records.length && !recovery.error && <p className="mt-2 text-xs text-muted">No recorded access changes on this device.</p>}
    {recovery.status && <p role="status" className="mt-2 text-xs text-muted">{recovery.status}</p>}
    {recovery.currentObservation && <p className="mt-2 text-xs text-muted">{recovery.currentObservation}</p>}
    {recovery.error && <p role="alert" className="mt-2 text-xs text-danger">{recovery.error}</p>}
    <Modal open={selected !== null} onClose={() => { if (!recovery.pending) setPurchase(null) }} title="Resume recorded purchase">
      {selected && <><PaidAccessQuote plan={selected.plan} />
        <p className="mt-3 text-xs text-muted">Only the original recorded transaction will be queried and, if eligible, resumed.</p>
        {recovery.error && <p role="alert" className="mt-2 text-xs text-danger">{recovery.error}</p>}
        <Button className="mt-4" variant="primary" disabled={recovery.pending} onClick={() => void recovery.resume(selected).then(result => {
          if (result.status === 'SUCCEEDED' || result.status === 'FAILED') setPurchase(null)
        }).catch(() => {})}>Resume exact purchase</Button></>}
    </Modal>
  </div>
}
