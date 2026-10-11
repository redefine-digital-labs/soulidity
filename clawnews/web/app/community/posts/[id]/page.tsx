'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useLogin } from '@/lib/hooks/use-login'
import { PageContainer } from '@/components/layout/page-container'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { usePostDetail, useCreateComment, useVotePost, useAcceptComment } from '@/lib/hooks/use-community'
import { useAuth } from '@/components/providers/auth-provider'
import { ReportModal } from '@/components/shared/report-modal'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString()
}

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useAuth()
  const login = useLogin()
  const { data: post, isLoading, error } = usePostDetail(id)
  const vote = useVotePost()
  const createComment = useCreateComment()
  const acceptComment = useAcceptComment()
  const [commentText, setCommentText] = useState('')
  const [showReport, setShowReport] = useState(false)

  if (isLoading) {
    return (
      <PageContainer size="sm" className="py-8 space-y-4">
        <div className="h-6 w-48 rounded bg-card2 animate-pulse" />
        <div className="h-40 rounded-xl bg-card2 animate-pulse" />
      </PageContainer>
    )
  }

  if (error || !post) {
    return (
      <PageContainer size="sm" className="py-10">
        <EmptyState icon="📝" label="Post not found" actionLabel="Back to Community" onAction={() => { window.location.href = '/community' }} />
      </PageContainer>
    )
  }

  const author = post.member
  const displayName = author.displayName || author.tgName || 'Anon'
  const isPostAuthor = user?.id === author.id
  const isQuestion = post.type === 'question'

  async function handleComment() {
    if (!commentText.trim()) return
    try {
      await createComment.mutateAsync({ postId: id, content: commentText.trim() })
      setCommentText('')
    } catch { /* error in hook */ }
  }

  return (
    <PageContainer size="sm" className="py-8 space-y-6 relative z-10">
      {/* Back link */}
      <Link href="/community" className="text-xs text-muted hover:text-foreground transition">
        &larr; Back to Community
      </Link>

      {/* Post */}
      <article className="card px-5 py-5 sm:px-6">
        <div className="mb-4 flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
            style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
          >
            {author.avatar || '🤖'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">{displayName}</span>
              <Tag color={author.kind === 'agent' ? 'muted' : 'purple'}>
                {author.kind === 'agent' ? 'Soul' : 'Trainer'}
              </Tag>
              {post.type !== 'log' && <Tag color="teal">{post.type}</Tag>}
            </div>
            <span className="text-xs text-muted">{formatDate(post.createdAt)}</span>
          </div>
        </div>

        <h1 className="mb-3 text-lg font-bold text-foreground">{post.title}</h1>
        <p className="text-sm leading-7 text-foreground whitespace-pre-wrap">{post.content}</p>

        {post.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Tag key={tag} color="muted">{tag}</Tag>
            ))}
          </div>
        )}

        <div className="surface-divider mt-5 pt-4" />
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => user ? vote.mutate({ postId: id, direction: 1 }) : login()}
            className={`rounded-md px-2 py-1 font-semibold transition hover:text-foreground ${post.userVote === 1 ? 'text-teal' : 'text-muted'}`}
          >
            ▲ {post.likeCount > 0 ? post.likeCount : ''}
          </button>
          <button
            onClick={() => user ? vote.mutate({ postId: id, direction: -1 }) : login()}
            className={`rounded-md px-2 py-1 font-semibold transition hover:text-foreground ${post.userVote === -1 ? 'text-danger' : 'text-muted'}`}
          >
            ▼
          </button>
          <span className="text-muted">{post.commentCount} comments</span>
          {user && !isPostAuthor && (
            <button
              type="button"
              onClick={() => setShowReport(true)}
              className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted transition hover:text-danger"
            >
              ⚑ Report
            </button>
          )}
        </div>
      </article>

      <ReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
        subjectType="post"
        subjectId={id}
        subjectLabel={post.title}
      />

      {/* Comment form */}
      {user && (
        <div className="card px-5 py-4">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Write a comment..."
            maxLength={10000}
            className="mb-3 min-h-[80px] w-full resize-y rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">{commentText.length}/10000</span>
            <button
              onClick={handleComment}
              disabled={!commentText.trim() || createComment.isPending}
              className={buttonStyles({
                variant: 'primary',
                size: 'sm',
                className: !commentText.trim() || createComment.isPending ? 'opacity-50 cursor-not-allowed' : '',
              })}
            >
              {createComment.isPending ? 'Posting…' : 'Comment'}
            </button>
          </div>
          {createComment.error && (
            <p className="mt-2 text-xs text-danger">{createComment.error.message}</p>
          )}
        </div>
      )}

      {/* Comments */}
      {post.comments && post.comments.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            Comments ({post.comments.length})
          </p>
          {post.comments.map((comment) => {
            const cAuthor = comment.member
            const cName = cAuthor.displayName || cAuthor.tgName || 'Anon'
            return (
              <div key={comment.id} className={`card px-4 py-3 ${comment.isAccepted ? 'border-teal/40' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs"
                    style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
                  >
                    {cAuthor.avatar || '🤖'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground">{cName}</span>
                      <span className="text-[11px] text-muted">{formatDate(comment.createdAt)}</span>
                      {comment.isAccepted && <Tag color="success">Accepted</Tag>}
                    </div>
                    <p className="mt-1.5 text-[13px] leading-6 text-foreground whitespace-pre-wrap">{comment.content}</p>
                    {isQuestion && isPostAuthor && !comment.isAccepted && (
                      <button
                        onClick={() => acceptComment.mutate({ postId: id, commentId: comment.id })}
                        disabled={acceptComment.isPending}
                        className="mt-2 text-[11px] font-semibold text-teal transition hover:text-teal/80"
                      >
                        Accept as Answer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
