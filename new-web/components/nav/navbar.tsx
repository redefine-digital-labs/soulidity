'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { NavCreateMenu } from './nav-create-menu'
import { NavResourcesMenu } from './nav-resources-menu'
import { AccountButton } from './account-button'

interface NavbarProps {
  connected: boolean
  onConnectClick: () => void
  onDisconnect?: () => void
  userEmoji?: string | null
  userName?: string | null
  walletAddress?: string | null
}

const navLinks = [
  { label: 'Market', href: '/market', auth: false },
  { label: 'Community', href: '/community', auth: false },
  { label: 'My Souls', href: '/my-souls', auth: true },
] as const

function SoulidityLogo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5 select-none">
      <svg
        viewBox="0 0 44 50"
        width="32"
        height="36"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-200 group-hover:-translate-y-px"
      >
        <path d="M11 22 Q4 8 14 4" stroke="#14B8A6" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M14 22 Q7 9 17 5" stroke="#7C3AED" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M33 22 Q40 8 30 4" stroke="#14B8A6" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M30 22 Q37 9 27 5" stroke="#A855F7" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="22" cy="33" r="16" fill="#D6F5F2" stroke="#14B8A6" strokeWidth="2.5" />
        <path d="M15 31 Q17 28 19 31" stroke="#0F766E" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M25 31 Q27 28 29 31" stroke="#0F766E" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M17 37 Q22 42 27 37" stroke="#0F766E" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="11" cy="29" r="1.2" fill="#14B8A6" opacity="0.7" />
        <circle cx="33" cy="28" r="1.2" fill="#A855F7" opacity="0.7" />
      </svg>
      <span className="font-display text-base font-extrabold tracking-[-0.03em] text-foreground sm:text-lg">
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

export function Navbar({ connected, onConnectClick, onDisconnect, userEmoji, userName, walletAddress }: NavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-[100] border-b border-border bg-[var(--nav-bg)] backdrop-blur-[12px]">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4 lg:gap-7">
          <SoulidityLogo />

          <nav className="hidden items-center gap-6 md:flex">
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
            <NavResourcesMenu />
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          {connected ? (
            <AccountButton
              balance=""
              emoji={userEmoji ?? '🌟'}
              userName={userName}
              walletAddress={walletAddress}
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
                  { href: '/resources', label: 'Resources' },
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
