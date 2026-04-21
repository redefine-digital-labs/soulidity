'use client'

import { AuthGate } from '@/components/auth/auth-gate'

export function SellShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="🏷️"
      label="Sign in to manage your Soul listing"
      sublabel="Listing, authorizing, and confirming a Soul sale all require your authenticated owner session."
      className="max-w-[560px]"
    >
      {children}
    </AuthGate>
  )
}
