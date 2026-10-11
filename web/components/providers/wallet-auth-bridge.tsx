'use client'

import { useEffect } from 'react'
import { useCurrentAccount, useDisconnectWallet, useSuiClient } from '@mysten/dapp-kit'
import type { WalletProfileReadClient } from '@soulidity/sdk'
import { useAuthInternal } from './auth-provider'

/** Wallet state is identity, not a login signature or business API session.
 * All writes still need wallet transactions and actual chain authorization. */
export function WalletAuthBridge() {
  const account = useCurrentAccount(), client = useSuiClient()
  const { mutateAsync: disconnectWallet } = useDisconnectWallet()
  const { bindWallet, registerDisconnectHandler } = useAuthInternal()
  useEffect(() => {
    registerDisconnectHandler(async () => { await disconnectWallet() })
  }, [disconnectWallet, registerDisconnectHandler])
  useEffect(() => {
    const core = (client as unknown as { core?: WalletProfileReadClient }).core
    bindWallet(account?.address && core ? { address: account.address, client: core } : null)
    return () => bindWallet(null)
  }, [account?.address, client, bindWallet])
  return null
}
