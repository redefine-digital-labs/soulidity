'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { NavCreateMenu } from './nav-create-menu'
import { AccountButton } from './account-button'
import { NotificationBell } from './notification-bell'
import { AgentModeBadge } from './agent-mode-badge'

interface NavbarProps {
  connected: boolean
  onConnectClick: () => void
  onDisconnect?: () => void
  userEmoji?: string | null
  userName?: string | null
  userKind?: string | null
  walletAddress?: string | null
  profileHref?: string | null
  isAdmin?: boolean
  suiNetwork?: 'mainnet' | 'testnet' | null
}

const navLinks = [
  { label: 'Market', href: '/market', auth: false },
  { label: 'Community', href: '/community', auth: false },
  { label: 'My Souls', href: '/my-souls', auth: true },
  { label: 'Docs', href: '/resources', auth: false },
] as const

function SoulidityLogo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5 select-none" aria-label="Soulidity">
      <svg
        viewBox="0 0 32 32"
        width="28"
        height="28"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0 transition-transform duration-200 group-hover:-translate-y-px"
      >
        <defs>
          <linearGradient id="soulidity-nav-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A855F7" />
            <stop offset="1" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
        <path
          d="M16 3 C 9 3, 4 8, 4 15 C 4 21, 8 25, 13 26 L 13 29 L 19 29 L 19 26 C 24 25, 28 21, 28 15 C 28 8, 23 3, 16 3 Z"
          fill="url(#soulidity-nav-mark)"
          opacity="0.22"
        />
        <path
          d="M16 6 C 10.5 6, 7 10, 7 15 C 7 19, 9.5 22, 13 23"
          stroke="url(#soulidity-nav-mark)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M16 6 C 21.5 6, 25 10, 25 15 C 25 19, 22.5 22, 19 23"
          stroke="url(#soulidity-nav-mark)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="16" cy="15" r="3.2" fill="#F59E0B" />
        <path
          d="M13 25 L 13 28 L 19 28 L 19 25"
          stroke="url(#soulidity-nav-mark)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="font-display text-base font-extrabold tracking-[-0.02em] text-foreground sm:text-lg">
        Soul<span className="text-purple">idity</span>
      </span>
    </Link>
  )
}

function navLinkClass(isActive: boolean) {
  return cn(
    'text-[13px] font-medium tracking-[0.01em] transition-colors',
    isActive ? 'text-foreground' : 'text-muted hover:text-foreground',
  )
}

export function Navbar({ connected, onConnectClick, onDisconnect, userEmoji, userName, userKind, walletAddress, profileHref, isAdmin, suiNetwork }: NavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-[100] border-b border-border bg-[var(--nav-bg)] backdrop-blur-[12px]">
      <div className="grid h-14 grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <SoulidityLogo />

        <nav className="hidden items-center justify-center gap-6 md:flex">
          {navLinks.map(({ label, href, auth }) => {
            if (auth && !connected) return null
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link key={href} href={href} className={navLinkClass(isActive)}>
                {label}
              </Link>
            )
          })}
          <NavCreateMenu />
          {isAdmin && (
            <Link
              href="/admin"
              className={navLinkClass(pathname === '/admin' || pathname.startsWith('/admin/'))}
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center justify-end gap-2.5">
          {connected && userKind === 'agent' && <AgentModeBadge />}
          {connected && <NotificationBell className="hidden md:block" />}
          {connected ? (
            <AccountButton
              emoji={userEmoji ?? '🌟'}
              userName={userName}
              walletAddress={walletAddress}
              profileHref={profileHref}
              suiNetwork={suiNetwork ?? 'testnet'}
              onDisconnect={onDisconnect ?? (() => {})}
              onNavigate={(href) => router.push(href)}
            />
          ) : (
            <div className="hidden md:block">
              <Button variant="outline" size="sm" onClick={onConnectClick}>
                Login
              </Button>
            </div>
          )}

          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-transparent text-foreground transition hover:border-purple md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            <span className="sr-only">{mobileOpen ? 'Close menu' : 'Open menu'}</span>
            {mobileOpen ? (
              <span className="relative block h-4 w-4">
                <span className="absolute left-0 top-1/2 block h-0.5 w-4 -translate-y-1/2 rotate-45 bg-current" />
                <span className="absolute left-0 top-1/2 block h-0.5 w-4 -translate-y-1/2 -rotate-45 bg-current" />
              </span>
            ) : (
              <span className="relative block h-4 w-4">
                <span className="absolute left-0 top-0.5 block h-0.5 w-4 bg-current" />
                <span className="absolute left-0 top-[7px] block h-0.5 w-4 bg-current" />
                <span className="absolute left-0 bottom-0.5 block h-0.5 w-4 bg-current" />
              </span>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-[rgba(13,10,30,0.96)] px-4 py-4 md:hidden">
          <div className="mx-auto max-w-[1100px]">
            <div className="max-h-[calc(100dvh-56px)] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className="flex flex-col gap-2">
                {navLinks.map(({ label, href, auth }) => {
                  if (auth && !connected) return null
                  const isActive = pathname === href || pathname.startsWith(href + '/')
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-purple/12 text-white'
                          : 'text-muted hover:bg-white/[0.05] hover:text-foreground',
                      )}
                    >
                      {label}
                    </Link>
                  )
                })}

                <div className="surface-divider my-1" />

                {[
                  { href: '/create', label: 'Create Soul' },
                  { href: '/collections/create', label: 'Create Collection' },
                  { href: '/import', label: 'Import Soul' },
                  { href: '/wrap-link', label: 'Expand to Soul' },
                ].map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                  return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'rounded-xl px-3.5 py-2.5 text-sm font-medium transition',
                      isActive
                        ? 'bg-purple/12 text-white'
                        : 'text-muted hover:bg-white/[0.05] hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                  )
                })}

                {isAdmin && (
                  <>
                    <div className="surface-divider my-1" />
                    <Link
                      href="/admin"
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'rounded-xl px-3.5 py-2.5 text-sm font-medium transition',
                        pathname.startsWith('/admin')
                          ? 'bg-purple/12 text-white'
                          : 'text-muted hover:bg-white/[0.05] hover:text-foreground',
                      )}
                    >
                      Admin
                    </Link>
                  </>
                )}

                {!connected && (
                  <>
                    <div className="surface-divider my-1" />
                    <Button
                      variant="primary"
                      size="sm"
                      full
                      onClick={() => {
                        setMobileOpen(false)
                        onConnectClick()
                      }}
                    >
                      Login
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
