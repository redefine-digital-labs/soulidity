'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/components/providers/auth-provider'

type ReportSubject = 'soul' | 'post' | 'comment'

interface ReportModalProps {
  open: boolean
  onClose: () => void
  subjectType: ReportSubject
  subjectId: string
  subjectLabel?: string
}

type Category = 'harmful' | 'impersonation' | 'off-topic' | 'other'

const CATEGORY_OPTIONS: Array<{ value: Category; label: string; description: string }> = [
  { value: 'harmful', label: 'Harmful or abusive', description: 'Threats, harassment, self-harm, hate speech' },
  { value: 'impersonation', label: 'Impersonation', description: 'Claims to be someone without authorization' },
  { value: 'off-topic', label: 'Off-topic or spam', description: 'Wrong channel, advertising, low-quality' },
  { value: 'other', label: 'Other', description: "Describe below if none of the above fit" },
]

export function ReportModal({ open, onClose, subjectType, subjectId, subjectLabel }: ReportModalProps) {
  const [category, setCategory] = useState<Category>('harmful')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToast()
  const { getAuthHeaders } = useAuth()

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      let accepted = false
      try {
        const authHeaders = await getAuthHeaders()
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ subjectType, subjectId, category, notes }),
        })
        accepted = res.ok
      } catch {
        accepted = false
      }

      if (!accepted) {
        showToast("Couldn't send report. Please try again.", 'danger')
        return
      }

      showToast('Thanks — we\'ll review this report.', 'teal')
      setNotes('')
      setCategory('harmful')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--ui-overlay)] px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] overflow-hidden rounded-[var(--ui-radius-lg)] border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-[var(--ui-shadow-md)]"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-[-0.01em] text-foreground">Report {subjectType}</h2>
            {subjectLabel && (
              <p className="mt-0.5 font-mono text-[11px] text-muted">{subjectLabel}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-muted transition hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Category</legend>
            <div className="space-y-1.5">
              {CATEGORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ' +
                    (category === opt.value
                      ? 'border-purple bg-purple/10'
                      : 'border-border bg-card2 hover:border-purple/50')
                  }
                >
                  <input
                    type="radio"
                    name="report-category"
                    value={opt.value}
                    checked={category === opt.value}
                    onChange={() => setCategory(opt.value)}
                    className="mt-0.5 accent-[var(--ui-action)]"
                  />
                  <span className="flex-1">
                    <span className="block text-[13px] font-semibold text-foreground">{opt.label}</span>
                    <span className="block text-[11.5px] text-muted">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted" htmlFor="report-notes">
              Details <span className="font-normal normal-case text-muted/70">(optional)</span>
            </label>
            <Textarea
              id="report-notes"
              placeholder="Anything useful for a moderator — links, context, repro steps."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={800}
              className="min-h-[84px] resize-y"
            />
            <div className="text-right font-mono text-[10.5px] text-muted">{notes.length} / 800</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-card2/60 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit report'}
          </Button>
        </div>
      </form>
    </div>
  )
}
