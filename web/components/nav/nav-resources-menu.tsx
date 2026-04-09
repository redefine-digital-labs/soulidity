'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

interface ResourceItem {
  icon: string
  label: string
  href: string
}

const resourceItems: ResourceItem[] = [
  { icon: '📄', label: 'Documentation', href: '/resources' },
  { icon: '⛓', label: 'Protocol Stats', href: '/resources/stats' },
]

interface NavResourcesMenuProps {
  className?: string
}

export function NavResourcesMenu({ className }: NavResourcesMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive = pathname.startsWith('/resources')

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
          'flex items-center gap-1.5 text-[13px] font-medium tracking-[0.01em] transition-colors',
          isActive ? 'text-foreground' : 'text-muted hover:text-foreground',
        )}
      >
        <span>Resources</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={cn('transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M2 4.5L6 8L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-3 min-w-[180px] -translate-x-1/2 rounded-xl border border-border bg-card2 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {resourceItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm text-muted transition hover:bg-purple/10 hover:text-foreground"
            >
              <span>{item.icon}</span>
              <span className="text-[13px] font-semibold">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
