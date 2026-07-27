'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

const adminNav = [
  { label: '仪表盘', href: '/admin' },
  { label: '文章', href: '/admin/articles' },
  { label: '推文', href: '/admin/tweets' },
  { label: '投稿', href: '/admin/submit' },
  { label: '项目', href: '/admin/companies' },
  { label: '成员', href: '/admin/members' },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      {/* Admin secondary nav strip */}
      <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-14 z-[90]">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-1 overflow-x-auto hide-scrollbar py-0">
            {adminNav.map(({ label, href }) => {
              const isActive =
                href === '/admin'
                  ? pathname === '/admin'
                  : pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'shrink-0 px-4 py-3 text-[13px] font-medium border-b-2 -mb-px transition-all duration-150',
                    isActive
                      ? 'text-action-label border-purple'
                      : 'text-muted border-transparent hover:text-foreground',
                  )}
                >
                  {label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      {children}
    </div>
  )
}
