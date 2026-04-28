'use client'

import { useCallback } from 'react'
import {
  useCurrentAccount,
  useSignPersonalMessage,
  useSignTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import type { Transaction } from '@mysten/sui/transactions'

type SuiTxResult = any

async function waitForTransactionBestEffort(
  client: ReturnType<typeof useSuiClient>,
  digest: string,
) {
  try {
    await client.waitForTransaction({ digest })
  } catch (error) {
    console.warn('[sui] Transaction confirmation polling failed', { digest, error })
  }
}

/**
 * Sui wallet signing surface backed by @mysten/dapp-kit. Replaces the legacy
 * embedded-wallet hook. Callers see the same shape as before:
 * `{ suiWallet, signAndExecute, signPersonalMessage, suiClient }`.
 */
export function useWalletSign() {
  const currentAccount = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signTransaction } = useSignTransaction()
  const { mutateAsync: signPersonalMessageMutation } = useSignPersonalMessage()

  const suiWallet = currentAccount?.address ? { address: currentAccount.address } : null

  const signAndExecute = useCallback(async (tx: Transaction): Promise<SuiTxResult> => {
    if (!currentAccount) {
      throw new Error('Connect a Sui wallet before signing transactions')
    }
    tx.setSenderIfNotSet(currentAccount.address)

    const { bytes, signature } = await signTransaction({
      transaction: tx,
      account: currentAccount,
    })

    const result = await suiClient.executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: {
        showEffects: true,
        showInput: true,
        showObjectChanges: true,
        showEvents: true,
      },
    })

    await waitForTransactionBestEffort(suiClient, result.digest)
    return result
  }, [currentAccount, signTransaction, suiClient])

  const signPersonalMessage = useCallback(async (message: Uint8Array): Promise<string> => {
    if (!currentAccount) {
      throw new Error('Connect a Sui wallet before signing messages')
    }
    const { signature } = await signPersonalMessageMutation({
      message,
      account: currentAccount,
    })
    return signature
  }, [currentAccount, signPersonalMessageMutation])

  return { suiWallet, signAndExecute, signPersonalMessage, suiClient }
}
