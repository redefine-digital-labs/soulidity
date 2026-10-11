'use client'

import Link from 'next/link'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { useWalletFollowOperation, useWalletFollowStatus } from '@/lib/hooks/use-wallet-follow'

/** Original profile action, now driven by shared chain state. A wallet prompt
 * or unknown broadcast is not proof that the relationship changed. */
export function FollowButton({ targetMemberId }: { targetMemberId: string }) {
  const { walletAddress, loading, profileError, refresh } = useAuth()
  const status = useWalletFollowStatus(targetMemberId)
  const operation = useWalletFollowOperation(targetMemberId)
  const pending = operation.record && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.record.phase)
  const attempt = (work: () => Promise<unknown>) => { void work().catch(() => { /* The hook retains recovery and error state. */ }) }
  if (!walletAddress) return null
  const isSelf = status.data?.target.owner === walletAddress
  if (isSelf) return null
  function exportRecovery() {
    if (!operation.recoveryExport) return
    const url = URL.createObjectURL(new Blob([operation.recoveryExport], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'soulidity-follow-recovery.json'
    link.click(); URL.revokeObjectURL(url)
  }
  return <div className="flex flex-col items-start gap-2" aria-label="Follow profile">
    <Button variant={status.data?.following ? 'primary' : 'outline'} size="sm"
      disabled={operation.busy || !!pending || status.isPending || !!status.error || !status.data?.viewer || loading || !!profileError}
      className={status.data?.following ? '' : 'border-purple text-action-label hover:bg-purple hover:text-white'}
      onClick={() => { if (status.data) attempt(() => operation.setFollowing(status.data!, !status.data!.following)) }}>
      {operation.busy ? 'Checking transaction…' : status.isPending ? 'Loading follow state…'
        : status.error ? 'Follow state unavailable' : status.data?.following ? 'Following' : '+ Follow'}
    </Button>
    {profileError && <div role="alert" className="text-xs text-red-400">
      {profileError}
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => { void refresh().catch(() => { /* AuthProvider retains the failure. */ }) }}>Retry profile read</Button>
    </div>}
    {status.error && <div role="alert" className="text-xs text-red-400">
      {status.error.message}
      <Button variant="ghost" size="sm" disabled={status.isFetching} onClick={() => { void status.refetch() }}>Retry follow read</Button>
    </div>}
    {!status.isPending && !status.error && !status.data?.viewer && <Link href="/profile" className="text-xs text-action-label">
      Create your chain profile to follow
    </Link>}
    {pending && <div aria-label="Pending follow transaction" className="text-xs text-muted space-y-2">
      <p>{operation.record!.intent.following ? 'Follow' : 'Unfollow'} transaction is not yet confirmed. Its saved bytes will be reused.</p>
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" disabled={operation.busy} onClick={() => attempt(operation.query)}>Check result</Button>
        <Button variant="outline" size="sm" disabled={operation.busy} onClick={() => attempt(operation.resume)}>Resume same transaction</Button>
        {operation.record!.phase === 'PREPARED' && <Button variant="ghost" size="sm" disabled={operation.busy}
          onClick={() => attempt(operation.cancel)}>Cancel unsigned transaction</Button>}
      </div>
    </div>}
    {operation.record?.phase === 'FAILED' && <p role="status" className="text-xs text-muted">The saved transaction failed on chain. Reload the follow state before a new attempt.</p>}
    {operation.error && <div role="alert" className="text-xs text-red-400">{operation.error}
      <Button variant="ghost" size="sm" disabled={operation.busy || status.isFetching}
        onClick={() => { void status.refetch() }}>Reload follow state</Button>
    </div>}
    {operation.recoveryExport && <Button variant="ghost" size="sm" onClick={exportRecovery}>Export recovery record</Button>}
  </div>
}
