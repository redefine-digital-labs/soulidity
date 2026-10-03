'use client'

import { AuthGate } from '@/components/auth/auth-gate'
import { CreateSoulProvider } from '@/components/providers/create-soul-provider'

export function CreateShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="✨"
      label="Sign in to create a Soul"
      sublabel="Connect your Sui wallet to create a Soul. Review each storage and mint transaction before signing."
      className="max-w-[680px]"
    >
      <CreateSoulProvider>
        {children}
      </CreateSoulProvider>
    </AuthGate>
  )
}
