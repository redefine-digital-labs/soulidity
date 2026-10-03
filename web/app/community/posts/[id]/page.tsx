'use client'

import { use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useLogin } from '@/lib/hooks/use-login'
import { PageContainer } from '@/components/layout/page-container'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { useCommunityPostDetail } from '@/lib/hooks/use-community-post-detail'
import { useCommunityPublish } from '@/lib/hooks/use-community-publish'
import { useCommunityAccept } from '@/lib/hooks/use-community-accept'
import { getBrowserCommunityVoteConfig } from '@/lib/community/public-post-vote-read'
import { useAuth } from '@/components/providers/auth-provider'
import { VoteControls } from '@/components/community/vote-controls'

function formatDate(milliseconds: string) {
  const value = BigInt(milliseconds)
  if (value > 8640000000000000n) return milliseconds + ' ms since epoch'
  const d = new Date(Number(value)), diff = Date.now() - d.getTime()
  if (diff >= 0 && diff < 60_000) return 'just now'
  if (diff >= 0 && diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff >= 0 && diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  return d.toLocaleDateString()
}
function exportRecovery(value: string | null, name: string) {
  if (!value) return
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}
export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), { walletAddress } = useAuth()
  let release = ''
  try { release = JSON.stringify(getBrowserCommunityVoteConfig()) } catch { /* Read hook exposes configuration failure. */ }
  // Keep durable hook emergency evidence alive across scope changes; only local
  // drafts/dialogs and callback authority are scoped, not the hook instances.
  return <CommunityPostDetail scope={JSON.stringify([id, walletAddress, release])} id={id} />
}

function CommunityPostDetail({ id, scope }: { id: string; scope: string }) {
  const { walletAddress, profile, loading, profileError } = useAuth(), login = useLogin()
  const detail = useCommunityPostDetail(id), publication = useCommunityPublish({ kind: 'comment', postId: id })
  const acceptance = useCommunityAccept(id)
  const [draft, setDraft] = useState({ scope, text: '' }), [reportScope, setReportScope] = useState<string | null>(null)
  const commentText = draft.scope === scope ? draft.text : '', showReport = reportScope === scope
  const setCommentText = (text: string) => setDraft({ scope, text })
  const setShowReport = (show: boolean) => setReportScope(show ? scope : null)
  const [token, setToken] = useState({ scope })
  if (token.scope !== scope) setToken({ scope })
  const identity = useRef(token)
  useLayoutEffect(() => { identity.current = token }, [token])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const recoverPublication = (work: () => ReturnType<typeof publication.query>) => {
    void work().then(result => {
      if (mounted.current && identity.current === token && result.status === 'published') { setCommentText(''); void detail.refetch() }
    }).catch(() => { /* Durable hook retains errors and frozen content. */ })
  }
  const attempt = (work: () => Promise<unknown>) => { void work().catch(() => {}) }
  // Recovery remains reachable if a subsequent content read fails or expires.
  const recovery = <>
    {publication.pending && <div aria-label="Pending comment publication" className="card p-4 space-y-2 text-xs">
      <p>A saved comment is unfinished. Recovery uses its original content.</p>
      <p className="whitespace-pre-wrap">{publication.pending.intent.document.content}</p>
      <button disabled={publication.busy} onClick={() => recoverPublication(publication.query)}>Check comment result</button>{' '}
      <button disabled={publication.busy} onClick={() => recoverPublication(publication.resume)}>Resume saved comment</button>{' '}
      <button disabled={publication.busy} onClick={() => recoverPublication(publication.cancel)}>Cancel comment if unsigned</button>{' '}
      <button disabled={publication.busy} onClick={() => recoverPublication(publication.archive)}>Archive resolved comment</button>
    </div>}
    {publication.error && <p role="alert">{publication.error}</p>}
    {publication.result && <p role="status" className="break-all">Published comment: {publication.result.commentId}</p>}
    {publication.recoveryExport && <button onClick={() => exportRecovery(publication.recoveryExport, 'soulidity-comment-recovery.json')}>Export comment recovery</button>}
    {acceptance.record && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(acceptance.record.phase) && <div aria-label="Pending answer acceptance" className="card p-4 space-y-2 text-xs">
      <p>Acceptance is not confirmed. The saved answer and transaction will be reused.</p>
      <p className="break-all">Answer: {acceptance.record.intent.commentId}</p>
      <button disabled={acceptance.busy} onClick={() => attempt(acceptance.query)}>Check acceptance result</button>{' '}
      <button disabled={acceptance.busy} onClick={() => attempt(acceptance.resume)}>Resume same acceptance</button>{' '}
      {acceptance.record.phase === 'PREPARED' && <button disabled={acceptance.busy} onClick={() => attempt(acceptance.cancel)}>Cancel unsigned acceptance</button>}
    </div>}
    {acceptance.record?.phase === 'FAILED' && <p role="status">Acceptance failed on chain. Reload before trying again.</p>}
    {acceptance.error && <p role="alert">{acceptance.error}</p>}
    {acceptance.recoveryExport && <button onClick={() => exportRecovery(acceptance.recoveryExport, 'soulidity-acceptance-recovery.json')}>Export acceptance recovery</button>}
  </>
  const back = <Link href="/community" className="text-xs text-muted hover:text-foreground">&larr; Back to Community</Link>
  const frame = (children: ReactNode) => <PageContainer size="sm" className="py-8 space-y-6 relative z-10">
    {back}<VoteControls postId={id} />{children}
  </PageContainer>
  if (detail.isLoading) return frame(<><p role="status">Loading post…</p>{recovery}</>)
  if (detail.error || !detail.data) return frame(<>
    <p role="alert">Unable to read this post. {detail.error?.message}</p>
    <button disabled={detail.isFetching} onClick={() => { void detail.refetch() }}>Retry post read</button>{recovery}
  </>)
  const { post, document, authorMetadata, comments, commentWindow } = detail.data
  const isPostAuthor = walletAddress === post.author.owner && profile?.id === post.author.id
  const pendingAcceptance = acceptance.record && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(acceptance.record.phase)
  const cannotAccept = acceptance.busy || !!pendingAcceptance || loading || !!profileError || detail.isFetching
  const cannotComment = publication.busy || !!publication.pending || !profile || loading || !!profileError
  return frame(<>
    <button disabled={detail.isFetching} onClick={() => { void detail.refetch() }}>Reload post</button>
    <article className="card px-5 py-5 sm:px-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}>{authorMetadata.avatar || '🤖'}</div>
        <div><div className="flex items-center gap-2">
          <Link href={'/community/u/' + post.author.id} className="text-sm font-bold text-foreground">{authorMetadata.displayName || post.author.handle}</Link>
          <Tag color="muted">Profile</Tag>
          {post.postType !== 'log' && <Tag color="teal">{post.postType}</Tag>}
        </div><span className="text-xs text-muted">{formatDate(post.createdAtMs)}</span></div>
      </div>
      <h1 className="mb-3 text-lg font-bold text-foreground">{document.title}</h1>
      <p className="text-sm leading-7 text-foreground whitespace-pre-wrap">{document.content}</p>
      {document.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{document.tags.map(tag => <Tag key={tag} color="muted">{tag}</Tag>)}</div>}
      <div className="surface-divider mt-5 pt-4" />
      <div className="flex items-start gap-3 text-sm">
        <span className="text-muted">{post.commentCount} comments</span>
        {walletAddress && !isPostAuthor && <button type="button" onClick={() => setShowReport(true)} className="ml-auto text-xs text-muted hover:text-danger">⚑ Report</button>}
      </div>
    </article>
    {/* Chain IDs cannot use the old private Member/SQL report endpoint. */}
    {showReport && <div role="dialog" aria-label="Report post" className="card p-4 space-y-3">
      <p>Private reporting is not available for chain posts yet. Nothing has been submitted. Do not post private report details as a public comment.</p>
      <button onClick={() => setShowReport(false)}>Close report</button>
    </div>}
    {recovery}
    {profileError && <p role="alert">{profileError}</p>}
    {walletAddress ? <div className="card px-5 py-4">
      {!profile && !loading && <Link href="/profile">Create or reload your chain profile to comment</Link>}
      <textarea value={commentText} onChange={event => setCommentText(event.target.value)} disabled={cannotComment}
        placeholder="Write a comment..." maxLength={10000} className="mb-3 min-h-[80px] w-full resize-y rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground" />
      <div className="flex items-center justify-between"><span className="text-[11px] text-muted">{commentText.length}/10000</span>
        <button disabled={cannotComment || !commentText.trim()} onClick={() => recoverPublication(() => publication.publish({ content: commentText.trim() }))}
          className={buttonStyles({ variant: 'primary', size: 'sm' })}>{publication.busy ? 'Posting…' : 'Comment'}</button>
      </div>
    </div> : <button onClick={login}>Connect your profile wallet to comment</button>}
    <div className="space-y-3">
      <p className="text-[11px] font-bold uppercase text-muted">Comments ({commentWindow.shown} shown of {commentWindow.total})</p>
      {commentWindow.partial && <p role="status" className="text-xs text-muted">Showing the earliest {commentWindow.shown} comments, not the full discussion.</p>}
      {post.acceptedComment && !comments.some(item => item.comment.id === post.acceptedComment!.id) && <p role="status" className="break-all">Accepted answer is outside this comment window: {post.acceptedComment.id}</p>}
      {comments.map(item => {
        const comment = item.comment, accepted = post.acceptedComment?.id === comment.id
        return <div key={comment.id} className={'card px-4 py-3 ' + (accepted ? 'border-teal/40' : '')}>
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs" style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}>{item.authorMetadata.avatar || '🤖'}</div>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2">
              <Link href={'/community/u/' + comment.author.id} className="text-xs font-bold">{item.authorMetadata.displayName || comment.author.handle}</Link>
              <span className="text-[11px] text-muted">{formatDate(comment.createdAtMs)}</span>{accepted && <Tag color="success">Accepted</Tag>}
            </div><p className="mt-1.5 text-[13px] leading-6 whitespace-pre-wrap">{item.document.content}</p>
              {post.postType === 'question' && isPostAuthor && !accepted && <button disabled={cannotAccept}
                onClick={() => attempt(() => acceptance.accept(post, comment.id))} className="mt-2 text-[11px] font-semibold text-teal">Accept as Answer</button>}
            </div>
          </div>
        </div>
      })}
    </div>
  </>)
}
