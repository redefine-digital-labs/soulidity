'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { Navbar } from '@/components/nav/navbar'
import { SiteFooter } from '@/components/layout/site-footer'
import { useToast } from '@/components/ui/toast'
import { clearPendingAction, readPendingAction } from '@/lib/utils/pending-action'
import { useLogin } from '@/lib/hooks/use-login'

function PendingActionReplay() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()
  const prevUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading) return
    const currentId = user?.id ?? null
    const previousId = prevUserIdRef.current
    prevUserIdRef.current = currentId

    if (currentId === null) return

    // Replay on first observation of a signed-in user (initial mount after
    // auth-flow remount, or in-tab signed-out → signed-in transition) whenever
    // a fresh pending action is present. Hijack by unrelated sign-ins is
    // prevented upstream: useLogin clears the entry before login, and
    // TTL in readPendingAction drops stale entries.
    if (previousId === null) {
      const action = readPendingAction()
      if (action) {
        clearPendingAction()
        showToast(action.label, 'teal')
        router.push(action.path)
      }
    }
  }, [user, loading, router, showToast])

  return null
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const handleGenericLogin = useLogin()

  return (
    <div className="relative min-h-screen">
      <PendingActionReplay />
      {/* Theme ambient color; opacity drops behind Animacraft's paper grid. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-[100px] -top-[100px] z-0 h-[500px] w-[500px] rounded-full blur-[80px]"
        style={{ background: 'var(--ui-action-hover)', opacity: 'var(--ui-ambient-opacity)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-[50px] -left-[50px] z-0 h-[300px] w-[300px] rounded-full blur-[80px]"
        style={{ background: 'var(--ui-value)', opacity: 'var(--ui-ambient-opacity)' }}
      />
      <Navbar
        connected={!!user}
        onConnectClick={handleGenericLogin}
        onDisconnect={logout}
        userEmoji={user?.avatar ?? '🌟'}
        userName={user?.displayName || user?.tgName}
        userKind={user?.kind}
        walletAddress={user?.primarySuiAddress}
        profileHref={user?.id ? `/community/u/${encodeURIComponent(user.id)}` : null}
        isAdmin={user?.isAdmin}
        suiNetwork={(process.env.NEXT_PUBLIC_SUI_NETWORK as 'mainnet' | 'testnet' | undefined) ?? 'testnet'}
      />
      <main className="relative min-h-[calc(100vh-56px)] overflow-x-clip">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
