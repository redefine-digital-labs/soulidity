'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

interface MenuItem {
  icon: string
  label: string
  description: string
  href: string
}

const menuItems: Array<MenuItem | 'separator'> = [
  {
    icon: '✦',
    label: 'Create Soul',
    description: 'Start from scratch',
    href: '/create',
  },
  {
    icon: '📥',
    label: 'Import Soul',
    description: 'From local file or platform',
    href: '/import',
  },
  {
    icon: '🔗',
    label: 'Personal Join',
    description: 'Attach a Soul layer to an existing NFT you own',
    href: '/wrap-link',
  },
  {
    icon: '📦',
    label: 'Create Collection',
    description: 'Mint a tradable collection right from your wallet',
    href: '/collections/create',
  },
]

interface NavCreateMenuProps {
  className?: string
}

export function NavCreateMenu({ className }: NavCreateMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive = pathname.startsWith('/create')
    || pathname.startsWith('/import')
    || pathname.startsWith('/wrap-link')
    || pathname === '/collections/create'

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
        className={cn(
          'flex h-9 items-center overflow-hidden rounded-lg border transition-colors duration-150',
          'border-transparent bg-purple text-white hover:bg-purple-deep',
        )}
      >
        <span className="px-3.5 text-[13px] font-semibold tracking-[-0.01em]">+ Create Soul</span>
        <span className={cn(
          'flex h-full items-center border-l px-2.5',
          'border-white/20 text-white/80',
        )}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={cn('transition-transform duration-150', open && 'rotate-180')}
          >
            <path d="M2 4.5L6 8L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] rounded-xl border border-border bg-card2 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {menuItems.map((item, i) => {
            if (item === 'separator') {
              return <div key={i} className="surface-divider my-1.5" />
            }
            const itemIsActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-start gap-3 rounded-lg px-3.5 py-2.5 text-sm transition',
                  itemIsActive
                    ? 'bg-purple/12 text-foreground'
                    : 'text-muted hover:bg-purple/10 hover:text-foreground',
                )}
              >
                <span className="mt-0.5 text-base leading-none">{item.icon}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-foreground">{item.label}</span>
                  <span className="text-[11px] leading-relaxed text-muted/80">{item.description}</span>
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
