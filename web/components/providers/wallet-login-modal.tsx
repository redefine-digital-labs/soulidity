'use client'

import { ConnectModal } from '@mysten/dapp-kit'
import { useLoginModal } from './auth-provider'

/**
 * Mounts the dapp-kit wallet connect modal driven by AuthProvider state.
 * Kept in its own module so auth-provider.tsx itself does not transitively
 * import dapp-kit component CSS (vanilla-extract crashes vitest's node env).
 */
export function WalletLoginModal() {
  const { open, setOpen } = useLoginModal()
  return (
    <ConnectModal
      open={open}
      onOpenChange={setOpen}
      trigger={<span style={{ display: 'none' }} aria-hidden />}
    />
  )
}
