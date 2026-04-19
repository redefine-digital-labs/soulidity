'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { cn } from '@/lib/utils/cn'
import { useToast } from '@/components/ui/toast'

interface AccountButtonProps {
  emoji: string
  userName?: string | null
  walletAddress?: string | null
  profileHref?: string | null
  suiNetwork: 'mainnet' | 'testnet'
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

function formatSui(balanceMist: string) {
  try {
    const mist = BigInt(balanceMist)
    if (mist === 0n) return '0'
    if (mist < 1_000_000n) return '<0.001'
    if (mist < 100_000_000_000n) {
      const sui = Number(mist) / 1_000_000_000
      if (sui < 1) return sui.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
      return sui.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    }
    const whole = mist / 1_000_000_000n
    const rem = mist % 1_000_000_000n
    const rounded = rem >= 500_000_000n ? whole + 1n : whole
    return rounded.toString()
  } catch {
    return '—'
  }
}

function explorerUrl(addr: string, network: 'mainnet' | 'testnet') {
  const suffix = network === 'mainnet' ? '' : '?network=testnet'
  return `https://suivision.xyz/account/${addr}${suffix}`
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

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M10 3h3v3M13 3l-5.5 5.5M11 9v3.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5H7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function DepositIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function AccountButton({ emoji, userName, walletAddress, profileHref, suiNetwork, onDisconnect, onNavigate }: AccountButtonProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Clipboard-API fallback: when writeText() rejects (insecure context, permission
  // policy, embedded webview), swap the truncated address row for the full selectable
  // address so the user can long-press / triple-click to copy via OS-native mechanics.
  const [revealFull, setRevealFull] = useState(false)
  const [suiBalance, setSuiBalance] = useState<{ address: string; mist: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const suiClient = useSuiClient()
  const { showToast } = useToast()
  const displayBalanceMist =
    suiBalance !== null && suiBalance.address === walletAddress ? suiBalance.mist : null

  const dropdownItems: DropdownItem[] = [
    { label: 'Profile', href: profileHref ?? null },
    { label: 'Settings', href: '/profile' },
    { label: 'My Souls', href: '/my-souls' },
    { label: 'Wrap + Link', href: '/wrap-link' },
  ]

  // Centralized close so every close path (outside-click, nav, sign-out, deposit
  // success, toggle) also resets the reveal-full fallback. Resetting in an effect
  // keyed on `open` would call setState synchronously inside the effect body and
  // fail the repo's `react-hooks/set-state-in-effect` lint gate.
  const closeMenu = useCallback(() => {
    setOpen(false)
    setRevealFull(false)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, closeMenu])

  useEffect(() => {
    if (!open || !walletAddress) return
    let cancelled = false
    suiClient
      .getBalance({ owner: walletAddress, coinType: '0x2::sui::SUI' })
      .then((r) => {
        if (!cancelled) setSuiBalance({ address: walletAddress, mist: r.totalBalance })
      })
      .catch(() => {
        // leave stale so the next open retries instead of pinning a fake zero
      })
    return () => {
      cancelled = true
    }
  }, [open, walletAddress, suiClient])

  const handleCopyAddress = useCallback(async () => {
    if (!walletAddress) return
    try {
      // `navigator.clipboard` itself can be undefined in older webviews and
      // insecure contexts, where `.writeText()` would throw synchronously
      // before any `.catch()` attaches. `await` routes both that synchronous
      // TypeError and an async rejection through the same fallback branch.
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable or rejected. Swap the truncated row for a
      // selectable full-address block so the user can copy via OS-native
      // selection.
      setRevealFull(true)
      showToast('Could not copy address — long-press the full address below to copy manually.', 'danger')
    }
  }, [walletAddress, showToast])

  const handleDeposit = useCallback(async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      showToast('Address copied — send USDC or SUI to this address from any exchange or wallet.', 'success')
      closeMenu()
    } catch {
      // Clipboard access can be blocked (insecure context, permission policy, focus loss).
      // Reveal the full selectable address so the user can copy it manually.
      setRevealFull(true)
      showToast('Could not copy address — long-press the full address below to copy manually.', 'danger')
    }
  }, [walletAddress, showToast, closeMenu])

  const networkLabel = suiNetwork === 'mainnet' ? 'Sui Mainnet' : 'Sui Testnet'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card2 px-2 pr-2.5 text-foreground transition-[border-color] hover:border-purple sm:gap-2 sm:px-2.5 sm:pr-3"
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[13px]"
          style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
        >
          {emoji}
        </div>
        <span className="max-w-[88px] truncate text-[13px] font-semibold tracking-[0.01em] sm:max-w-[120px]">
          {userName || 'Account'}
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
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-2 px-3 pt-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-teal/50 bg-teal/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-teal"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse" />
              {networkLabel}
            </span>
            {walletAddress && (
              <a
                href={explorerUrl(walletAddress, suiNetwork)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted transition hover:text-purple"
                title="View on SuiVision"
              >
                Explorer
                <ExternalIcon className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="p-1.5 pt-2">
            {walletAddress && (
              <>
                {revealFull ? (
                  <div className="rounded-lg px-3 py-[9px]">
                    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Your address
                    </div>
                    <div className="select-all break-all font-mono text-[11px] leading-relaxed text-teal">
                      {walletAddress}
                    </div>
                    <div className="mt-1 text-[10.5px] text-muted">
                      Long-press to copy on mobile, or triple-click to select on desktop.
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleCopyAddress}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left transition hover:bg-purple/10 group"
                    title={walletAddress}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-teal">
                      {formatAddress(walletAddress)}
                    </span>
                    {copied ? (
                      <CheckIcon className="h-3.5 w-3.5 shrink-0 text-teal" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-foreground transition-colors" />
                    )}
                  </button>
                )}
                <div className="flex items-center justify-between rounded-lg px-3 py-[7px] text-[12px]">
                  <span className="text-muted">SUI balance</span>
                  <span className="font-mono font-semibold text-foreground">
                    {displayBalanceMist === null ? '…' : `${formatSui(displayBalanceMist)} SUI`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDeposit}
                  className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left transition hover:bg-purple/10 group"
                  title="Copy this wallet address so you can send USDC or SUI to it"
                >
                  <DepositIcon className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-foreground" />
                  <span className="flex-1 text-[13px] font-semibold text-foreground">Deposit</span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">USDC · SUI</span>
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
                    closeMenu()
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
                closeMenu()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-left text-sm font-semibold text-danger transition hover:bg-danger/10"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
