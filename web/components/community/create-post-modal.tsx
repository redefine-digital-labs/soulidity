'use client'

import { useState } from 'react'
import { buttonStyles } from '@/components/ui/button'
import { useCommunityPublish } from '@/lib/hooks/use-community-publish'
import { useAuth } from '@/components/providers/auth-provider'
import { useLogin } from '@/lib/hooks/use-login'

interface CreatePostModalProps {
  open: boolean
  onClose: () => void
  channel?: string
  onPublished?: () => void
}

const POST_TYPES = [
  { value: 'log', label: 'Log', desc: 'Share an update' },
  { value: 'question', label: 'Question', desc: 'Ask the community' },
  { value: 'knowledge', label: 'Knowledge', desc: 'Share insights' },
] as const

export function CreatePostModal({ open, onClose, channel, onPublished }: CreatePostModalProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('log')
  const [tags, setTags] = useState('')
  const operation = useCommunityPublish({ kind: 'post' })
  const { walletAddress, profile, loading, profileError } = useAuth()
  const login = useLogin()
  const isPending = operation.busy, error = operation.error

  if (!open) return null

  function closePublished() {
    setTitle(''); setContent(''); setType('log'); setTags(''); onClose(); onPublished?.()
  }

  async function handleSubmit() {
    try {
      const result = await operation.publish({
        title: title.trim(),
        content: content.trim(),
        postType: type === 'question' ? 1 : type === 'knowledge' ? 2 : 0,
        tags: tags.trim()
          ? tags.split(',').map((value) => value.trim()).filter(Boolean)
          : undefined,
        channel: channel === 'questions' ? 1 : 0,
      })
      if (result.status !== 'published') return
      closePublished()
    } catch { /* error set in hook */ }
  }

  const frozen = !!operation.pending
  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !isPending
    && !frozen && !!walletAddress && !!profile && !loading && !profileError
  const recover = (action: () => ReturnType<typeof operation.query>) => {
    void action().then(result => { if (result.status === 'published') closePublished() }).catch(() => {})
  }
  function exportRecovery() {
    if (!operation.recoveryExport) return
    const url = URL.createObjectURL(new Blob([operation.recoveryExport], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'soulidity-publication-recovery.json'; link.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-purple/40 bg-[linear-gradient(135deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))] p-6 shadow-[0_24px_64px_rgba(124,58,237,0.3)]">
        <h3 className="mb-4 text-lg font-bold text-foreground">Create Post</h3>

        {/* Type selector */}
        <div className="mb-4 flex gap-2">
          {POST_TYPES.map((t) => (
            <button
              key={t.value}
              disabled={isPending || frozen}
              onClick={() => setType(t.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                type === t.value
                  ? 'border-purple bg-purple/15 text-foreground'
                  : 'border-border text-muted hover:border-purple/40'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Title */}
        <input
          value={title}
          disabled={isPending || frozen}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          maxLength={500}
          className="mb-3 w-full rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Content */}
        <textarea
          value={content}
          disabled={isPending || frozen}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          maxLength={50000}
          className="mb-3 min-h-[120px] w-full resize-y rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Tags */}
        <input
          value={tags}
          disabled={isPending || frozen}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags (comma-separated, optional)"
          className="mb-4 w-full rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Error */}
        {!walletAddress && <button type="button" onClick={login} className="mb-3 text-sm text-teal">Connect your profile wallet to publish</button>}
        {walletAddress && !profile && !loading && <a href="/profile" className="mb-3 block text-sm text-teal">Create or reload your chain profile before publishing</a>}
        {profileError && <p role="alert" className="mb-3 text-xs text-danger">{profileError}</p>}
        {operation.pending && <div aria-label="Pending publication" className="mb-3 space-y-2 text-xs">
          <p>An unfinished publication is saved. Recovery uses its original content, not these form fields.</p>
          <p className="break-words">{operation.pending.intent.document.schema === 'soulidity.public-post.v1' ? operation.pending.intent.document.title : 'Saved publication'}</p>
          <button type="button" disabled={isPending} onClick={() => recover(operation.query)}>Check result</button>{' '}
          <button type="button" disabled={isPending} onClick={() => recover(operation.resume)}>Resume saved publication</button>{' '}
          <button type="button" disabled={isPending} onClick={() => recover(operation.cancel)}>Cancel if still unsigned</button>{' '}
          <button type="button" disabled={isPending} onClick={() => recover(operation.archive)}>Archive resolved operation</button>
        </div>}
        {operation.result && <p role="status" className="mb-3 break-all text-xs text-teal">Published: {operation.result.postId}</p>}
        {operation.recoveryExport && <button type="button" className="mb-3 text-xs text-teal" onClick={exportRecovery}>Export recovery record</button>}
        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2">
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'flex-1 rounded-xl border-border bg-transparent text-foreground hover:border-purple',
            })}
          >
            {frozen ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              className: `flex-1 rounded-xl ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`,
            })}
          >
            {isPending ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
