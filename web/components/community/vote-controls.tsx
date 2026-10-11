'use client'

import Link from 'next/link'
import {useAuth} from '@/components/providers/auth-provider'
import {useWalletVoteStatus,useWalletVoteOperation} from '@/lib/hooks/use-wallet-vote'
import {publicPostVoteDesiredState} from '@/lib/community/public-post-vote-read'
import {useLogin} from '@/lib/hooks/use-login'

/** Existing up/score/down interaction backed by a chain Post ID. Callers must
 * complete their data cutover before mounting; SQL IDs are not asset aliases. */
export function VoteControls({postId}:{postId:string}) {
  const {walletAddress,loading,profileError,refresh}=useAuth()
  const login=useLogin()
  const status=useWalletVoteStatus(postId),operation=useWalletVoteOperation(postId)
  const pending=operation.record&&!['SUCCEEDED','FAILED','CANCELLED'].includes(operation.record.phase)
  const disabled=operation.busy||!!pending||loading||!!walletAddress&&(status.isPending||!!status.error||!status.data?.viewer||!!profileError)
  const attempt=(work:()=>Promise<unknown>)=>{void work().catch(()=>{/* Hook retains error and recovery evidence. */})}
  function vote(direction:1|-1){
    if(!walletAddress){login();return}
    if(!disabled&&status.data)attempt(()=>operation.setVote(status.data!,publicPostVoteDesiredState(status.data!.state,direction)))
  }
  function exportRecovery(){
    if(!operation.recoveryExport)return
    const url=URL.createObjectURL(new Blob([operation.recoveryExport],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download='soulidity-vote-recovery.json';link.click();URL.revokeObjectURL(url)
  }
  return <div aria-label="Post voting" onClick={event=>event.stopPropagation()} className="space-y-2">
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Upvote" aria-pressed={status.data?.state===1} disabled={disabled}
        className={`rounded-md px-2 py-1 font-semibold transition hover:text-foreground ${status.data?.state===1?'text-teal':'text-muted'}`}
        onClick={()=>vote(1)}>▲</button>
      <span aria-label="Vote score" className="text-sm font-semibold">{status.error?'Unavailable':status.isPending?'…':status.data?.score??'Unavailable'}</span>
      <button type="button" aria-label="Downvote" aria-pressed={status.data?.state===2} disabled={disabled}
        className={`rounded-md px-2 py-1 font-semibold transition hover:text-foreground ${status.data?.state===2?'text-danger':'text-muted'}`}
        onClick={()=>vote(-1)}>▼</button>
    </div>
    {!walletAddress&&<p className="text-xs text-muted">Connect your profile wallet to vote.</p>}
    {walletAddress&&!status.isPending&&!status.error&&!status.data?.viewer&&<Link href="/profile" className="text-xs text-action-label">Create your chain profile to vote</Link>}
    {status.error&&<div role="alert">{status.error.message}<button type="button" disabled={status.isFetching} onClick={()=>{void status.refetch()}}>Retry vote read</button></div>}
    {profileError&&<div role="alert">{profileError}<button type="button" disabled={loading} onClick={()=>{void refresh().catch(()=>{})}}>Retry profile read</button></div>}
    {pending&&<div aria-label="Pending vote transaction" className="text-xs space-y-1">
      <p>Vote transaction is not yet confirmed. Its saved bytes will be reused.</p>
      <button type="button" disabled={operation.busy} onClick={()=>attempt(operation.query)}>Check result</button>
      <button type="button" disabled={operation.busy} onClick={()=>attempt(operation.resume)}>Resume same transaction</button>
      {operation.record!.phase==='PREPARED'&&<button type="button" disabled={operation.busy} onClick={()=>attempt(operation.cancel)}>Cancel unsigned transaction</button>}
    </div>}
    {operation.record?.phase==='FAILED'&&<p role="status">The saved transaction failed on chain. Reload before a new attempt.</p>}
    {operation.error&&<div role="alert">{operation.error}<button type="button" disabled={operation.busy||status.isFetching} onClick={()=>{void status.refetch()}}>Reload vote state</button></div>}
    {operation.recoveryExport&&<button type="button" onClick={exportRecovery}>Export recovery record</button>}
  </div>
}
