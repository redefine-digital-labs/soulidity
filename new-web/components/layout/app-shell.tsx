'use client'

import type { ReactNode } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/components/providers/auth-provider'
import { Navbar } from '@/components/nav/navbar'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { login } = usePrivy()

  return (
    <div className="relative min-h-screen">
      {/* Background orbs matching prototype */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-[100px] -top-[100px] z-0 h-[500px] w-[500px] rounded-full opacity-20 blur-[80px]"
        style={{ background: 'var(--purple-deep)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-[50px] -left-[50px] z-0 h-[300px] w-[300px] rounded-full opacity-20 blur-[80px]"
        style={{ background: 'var(--gold)' }}
      />
      <Navbar
        connected={!!user}
        onConnectClick={login}
        onDisconnect={logout}
        userEmoji={user?.avatar ? undefined : '🌟'}
        userName={user?.tgName}
      />
      <main className="relative min-h-[calc(100vh-56px)] overflow-x-clip">
        {children}
      </main>
    </div>
  )
}
