'use client'

import { useEffect } from 'react'
import {
  useCurrentAccount,
  useDisconnectWallet,
  useSignPersonalMessage,
} from '@mysten/dapp-kit'
import { useAuth, useAuthInternal } from './auth-provider'

/**
 * Bridges dapp-kit wallet state to AuthProvider. Kept in its own file so
 * `auth-provider.tsx` itself doesn't transitively import dapp-kit components
 * (vanilla-extract crashes vitest's node env when the dapp-kit barrel is loaded).
 *
 * Renders nothing; only watches the connected wallet and runs the wallet-login
 * flow whenever the wallet address diverges from the active session.
 */
export function WalletAuthBridge() {
  const currentAccount = useCurrentAccount()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const { mutateAsync: disconnectWallet } = useDisconnectWallet()
  const { user, loading } = useAuth()
  const { completeWalletLogin, registerDisconnectHandler } = useAuthInternal()

  useEffect(() => {
    registerDisconnectHandler(async () => {
      try {
        await disconnectWallet()
      } catch {
        // best effort
      }
    })
  }, [disconnectWallet, registerDisconnectHandler])

  useEffect(() => {
    if (!currentAccount?.address) return
    if (loading) return

    const sessionAddress = user?.primarySuiAddress ?? null
    if (sessionAddress && sessionAddress.toLowerCase() === currentAccount.address.toLowerCase()) {
      return
    }

    void completeWalletLogin(currentAccount.address, async (msg) => {
      const { signature } = await signPersonalMessage({ message: msg })
      return signature
    })
  }, [
    currentAccount?.address,
    loading,
    user?.primarySuiAddress,
    completeWalletLogin,
    signPersonalMessage,
  ])

  return null
}
