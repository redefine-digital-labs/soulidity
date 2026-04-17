'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils/cn'

interface AccountButtonProps {
  balance: string
  emoji: string
  userName?: string | null
  walletAddress?: string | null
  profileHref?: string | null
  onDisconnect: () => void
  onNavigate: (href: string) => void
}

type DropdownItem = {
  label: string
  href: string | null
}

function formatAddress(addr: string) {
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AccountButton({ balance, emoji, userName, walletAddress, profileHref, onDisconnect, onNavigate }: AccountButtonProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const dropdownItems: DropdownItem[] = [
    { label: 'Profile', href: profileHref ?? null },
    { label: 'Settings', href: '/profile' },
    { label: 'My Souls', href: '/my-souls' },
    { label: 'Wrap + Link', href: '/wrap-link' },
  ]

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

  const handleCopyAddress = useCallback(() => {
    if (!walletAddress) return
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [walletAddress])

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
          {/* Wallet address */}
          {walletAddress && (
            <>
              <button
                onClick={handleCopyAddress}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left transition hover:bg-purple/10 group"
                title={walletAddress}
              >
                <span className="min-w-0 flex-1 font-mono text-xs text-teal truncate">
                  {formatAddress(walletAddress)}
                </span>
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-teal" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-foreground transition-colors" />
                )}
              </button>
              <div className="surface-divider my-1.5" />
            </>
          )}

          {dropdownItems.map((item) => {
            const disabled = !item.href
            return (
              <button
                key={item.label}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!item.href) return
                  onNavigate(item.href)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm transition',
                  disabled
                    ? 'cursor-not-allowed text-muted/50'
                    : 'text-muted hover:bg-purple/10 hover:text-foreground',
                )}
              >
                <span className="text-[13px] font-semibold">{item.label}</span>
              </button>
            )
          })}
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
