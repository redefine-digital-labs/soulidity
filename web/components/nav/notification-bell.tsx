'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils/cn'

interface NotificationBellProps {
  className?: string
}

type NotificationCategory = 'grants' | 'sales' | 'royalties' | 'mentions'

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  grants: 'Grants',
  sales: 'Sales',
  royalties: 'Royalties',
  mentions: 'Mentions',
}

export function NotificationBell({ className }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card2 text-muted transition hover:border-purple hover:text-foreground"
        aria-label="Notifications"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.086a2 2 0 0 1-.586 1.414L2 10.414V11h12v-.586l-.914-.914A2 2 0 0 1 12.5 8.086V6A4.5 4.5 0 0 0 8 1.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            fill="none"
          />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--ui-radius-md)] border border-[var(--ui-border)] bg-[var(--ui-panel-translucent)] shadow-[var(--ui-shadow-sm)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-[13px] font-bold tracking-[-0.01em] text-foreground">Notifications</span>
            <button
              type="button"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted transition hover:text-action-label"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((category) => (
              <div key={category} className="border-b border-border/60 last:border-b-0">
                <div className="px-4 pb-1.5 pt-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
                  {CATEGORY_LABELS[category]}
                </div>
                <div className="px-4 pb-3 text-[12.5px] text-muted/80">
                  No {CATEGORY_LABELS[category].toLowerCase()} yet — you&rsquo;ll see on-chain activity here as it happens.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
