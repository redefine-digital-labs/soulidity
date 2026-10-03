'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { PurgeConfirmModal } from './purge-confirm-modal'
import { useSoulContentMutations } from '@/lib/hooks/use-soul-content-mutations'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'
import type { ContentMutationRecord } from '@/lib/soulidity/content-mutation-transaction'

/** Kept outside content tabs so refresh/tab switches never hide an uncertain
 * delete, purge or active selection. Historical rows are query/export only. */
export function ContentMutationRecoveryPanel({ soul, detailQueryId }: { soul: ChainSoulDetail; detailQueryId: string }) {
  const queryClient = useQueryClient(), updated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId] })
    void queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
  }, [queryClient, detailQueryId, soul.onChainId])
  const recovery = useSoulContentMutations(soul, updated), [purge, setPurge] = useState<ContentMutationRecord | null>(null)
  function row(record: ContentMutationRecord, archived: boolean) {
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(record.packet.phase)
    return <div key={`${record.packet.digest}:${record.packet.phase}:${archived}`} className="mt-2 rounded-lg border border-[var(--border-soft)] p-3 text-xs">
      <p>{record.plan.action} · kind {record.plan.kind} · {record.plan.target ? `${record.plan.target.name} v${record.plan.target.versionIndex}` : 'clear binding'} · {record.packet.phase}{archived ? ' · retained receipt' : ''}</p>
      <p className="mt-1 break-all text-muted">Wallet {record.plan.author} · package {record.plan.deployment.callablePackageId}</p>
      <p className="mt-1 break-all font-mono text-muted">{record.packet.digest}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => void recovery.query(record).catch(() => {})}>Check original transaction</Button>
        <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => recovery.exportRecord(record)}>Export public receipt</Button>
        {!archived && !terminal && <Button size="sm" variant="primary" disabled={recovery.pending || recovery.author !== record.plan.author}
          onClick={() => record.plan.action === 'purge' ? setPurge(record) : void recovery.resume(record).catch(() => {})}>Resume exact transaction</Button>}
        {!archived && record.packet.phase === 'PREPARED' && record.packet.signature === null && <Button size="sm" variant="outline"
          disabled={recovery.pending} onClick={() => void recovery.cancel(record).catch(() => {})}>Cancel unsigned preparation</Button>}
      </div>
    </div>
  }
  return <div className="m-4 rounded-xl border border-[var(--border-soft)] p-4" data-content-mutation-recovery>
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Content changes & recovery</h3>
      <Button size="sm" variant="outline" disabled={recovery.pending} onClick={() => void recovery.refresh().catch(() => {})}>Refresh records</Button>
    </div>
    <p className="mt-2 text-xs text-muted">Delete, purge and active-selection transactions survive refresh here. Check reads the original chain result without a connected wallet. Resume reuses recorded bytes; an unknown signature or broadcast is never replaced. Local phase labels are not chain confirmation.</p>
    {recovery.records.map(record => row(record, false))}
    {recovery.history.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs">Retained earlier receipts ({recovery.history.length})</summary>
      {recovery.history.map(record => row(record, true))}</details>}
    {!recovery.records.length && !recovery.error && <p className="mt-2 text-xs text-muted">No recorded content changes on this device.</p>}
    {recovery.status && <p role="status" className="mt-2 text-xs text-muted">{recovery.status}</p>}
    {recovery.currentObservation && <p className="mt-2 text-xs text-muted">{recovery.currentObservation}</p>}
    {recovery.error && <p role="alert" className="mt-2 text-xs text-danger">{recovery.error}</p>}
    <PurgeConfirmModal open={purge !== null} version={purge?.plan.target ? { kindName: `Kind ${purge.plan.kind}`, ...purge.plan.target } : null}
      pending={recovery.pending} onClose={() => setPurge(null)} onConfirm={async () => {
        if (!purge) return
        const result = await recovery.resume(purge)
        if (result.status !== 'SUCCEEDED') throw new Error('Purge is not confirmed. Keep this record and query the original transaction.')
        setPurge(null)
      }} />
  </div>
}
