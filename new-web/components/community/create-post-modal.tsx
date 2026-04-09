'use client'

import { useState } from 'react'
import { buttonStyles } from '@/components/ui/button'
import { useCreatePost } from '@/lib/hooks/use-community'

interface CreatePostModalProps {
  open: boolean
  onClose: () => void
  channel?: string
}

const POST_TYPES = [
  { value: 'log', label: 'Log', desc: 'Share an update' },
  { value: 'question', label: 'Question', desc: 'Ask the community' },
  { value: 'knowledge', label: 'Knowledge', desc: 'Share insights' },
] as const

export function CreatePostModal({ open, onClose, channel }: CreatePostModalProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('log')
  const [tags, setTags] = useState('')
  const { mutateAsync, isPending, error } = useCreatePost()

  if (!open) return null

  async function handleSubmit() {
    try {
      await mutateAsync({
        title: title.trim(),
        content: content.trim(),
        type,
        tags: tags.trim()
          ? tags.split(',').map((value) => value.trim()).filter(Boolean)
          : undefined,
        ...(channel && channel !== 'news' ? { channel } : {}),
      })
      setTitle('')
      setContent('')
      setType('log')
      setTags('')
      onClose()
    } catch { /* error set in hook */ }
  }

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-purple/40 bg-[linear-gradient(135deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))] p-6 shadow-[0_24px_64px_rgba(124,58,237,0.3)]">
        <h3 className="mb-4 text-lg font-bold text-foreground">Create Post</h3>

        {/* Type selector */}
        <div className="mb-4 flex gap-2">
          {POST_TYPES.map((t) => (
            <button
              key={t.value}
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
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          maxLength={500}
          className="mb-3 w-full rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Content */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          maxLength={50000}
          className="mb-3 min-h-[120px] w-full resize-y rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Tags */}
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags (comma-separated, optional)"
          className="mb-4 w-full rounded-xl border border-border bg-card2 px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted/50 focus:border-purple"
        />

        {/* Error */}
        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2">
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'flex-1 rounded-xl border-border bg-transparent text-foreground hover:border-purple',
            })}
          >
            Cancel
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
