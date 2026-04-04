'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils/cn'

interface AccountButtonProps {
  balance: string
  emoji: string
  userName?: string | null
  onDisconnect: () => void
  onNavigate: (href: string) => void
}

const dropdownItems = [
  { label: 'Profile', href: '/profile' },
  { label: 'Settings', href: '/profile/settings' },
  { label: 'My Souls', href: '/my-souls' },
  { label: 'Wrap + Link', href: '/wrap-link' },
]

export function AccountButton({ balance, emoji, userName, onDisconnect, onNavigate }: AccountButtonProps) {
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card2 px-2 pr-2.5 text-foreground transition-[border-color] hover:border-purple sm:gap-2 sm:px-2.5 sm:pr-3"
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[13px]"
          style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
        >
          {emoji}
        </div>
        <span className="max-w-[88px] truncate text-[13px] font-semibold tracking-[0.01em] sm:max-w-[120px]">
          {userName || balance || 'Account'}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={cn('text-muted transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M2 4.5L6 8L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] min-w-0 rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {dropdownItems.map((item) => (
            <button
              key={item.href}
              onClick={() => {
                onNavigate(item.href)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm text-muted transition hover:bg-purple/10 hover:text-foreground"
            >
              <span className="text-[13px] font-semibold">{item.label}</span>
            </button>
          ))}
          <div className="surface-divider my-1.5" />
          <button
            onClick={() => {
              onDisconnect()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm font-semibold text-danger transition hover:bg-danger/10"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
