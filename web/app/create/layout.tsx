'use client'

import { AuthGate } from '@/components/auth/auth-gate'
import { CreateSoulProvider } from '@/components/providers/create-soul-provider'

export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="✨"
      label="Sign in to create a Soul"
      sublabel="Minting a Soul uses authenticated routes and wallet signing across the full create flow."
      className="max-w-[680px]"
    >
      <CreateSoulProvider>
        {children}
      </CreateSoulProvider>
    </AuthGate>
  )
}
