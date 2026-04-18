'use client'

import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils/cn'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'
import { useGenericLogin } from '@/lib/hooks/use-generic-login'

interface AuthGateProps {
  children: ReactNode
  icon: string
  label: string
  sublabel?: string
  className?: string
}

export function AuthGate({
  children,
  icon,
  label,
  sublabel,
  className,
}: AuthGateProps) {
  const { isAuthenticated, loading } = useRequireAuth()
  const login = useGenericLogin()

  if (loading) {
    return (
      <div className={cn('max-w-[680px] mx-auto px-6 py-10 relative z-10', className)}>
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="h-5 w-28 rounded bg-card2 animate-pulse" />
          <div className="h-10 w-full rounded bg-card2 animate-pulse" />
          <div className="h-24 w-full rounded bg-card2 animate-pulse" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className={cn('max-w-[680px] mx-auto px-6 py-10 relative z-10', className)}>
        <EmptyState
          icon={icon}
          label={label}
          sublabel={sublabel}
          actionLabel="Sign In"
          onAction={login}
        />
      </div>
    )
  }

  return <>{children}</>
}
