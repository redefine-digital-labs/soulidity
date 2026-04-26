import { useCallback, useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import type { Transaction } from '@mysten/sui/transactions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SuiTxResult = any

interface DesktopSuiWallet {
  address: string
  publicKey: string
  createdAt: number
}

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
 * Renderer-side Sui wallet surface for the desktop app. The actual Ed25519
 * keypair lives in the main process (encrypted via Electron `safeStorage`).
 * Renderer builds transactions, ships raw bytes to main for approval + signing,
 * and executes the signed bundle through dapp-kit's Sui RPC client.
 *
 * Returns `{ suiWallet, suiClient, signAndExecute, signPersonalMessage,
 * refresh, generate, importSecret, reset }`.
 */
export function useDesktopWallet() {
  const suiClient = useSuiClient()
  const [suiWallet, setSuiWallet] = useState<DesktopSuiWallet | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchWallet() {
      try {
        const info = await window.electronAPI.walletGetInfo()
        if (!cancelled) setSuiWallet(info)
      } catch (error) {
        console.warn('[wallet] failed to read wallet info', error)
        if (!cancelled) setSuiWallet(null)
      }
    }

    fetchWallet()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    const info = await window.electronAPI.walletGetInfo()
    setSuiWallet(info)
    return info
  }, [])

  const generate = useCallback(async () => {
    const info = await window.electronAPI.walletGenerate()
    setSuiWallet(info)
    return info
  }, [])

  const importSecret = useCallback(async (secret: string) => {
    const info = await window.electronAPI.walletImport(secret)
    setSuiWallet(info)
    return info
  }, [])

  const reset = useCallback(async () => {
    await window.electronAPI.walletReset()
    setSuiWallet(null)
  }, [])

  const signPersonalMessage = useCallback(async (message: Uint8Array): Promise<string> => {
    if (!suiWallet) {
      throw new Error('Generate or import a wallet before signing')
    }
    const result = await window.electronAPI.walletSignMessage(message)
    return result.signature
  }, [suiWallet])

  const signAndExecute = useCallback(async (tx: Transaction): Promise<SuiTxResult> => {
    if (!suiWallet) {
      throw new Error('Generate or import a wallet before signing transactions')
    }

    tx.setSenderIfNotSet(suiWallet.address)
    const rawBytes = await tx.build({ client: suiClient })
    const { signature } = await window.electronAPI.walletSignTransaction(rawBytes)

    const result = await suiClient.executeTransactionBlock({
      transactionBlock: rawBytes,
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
  }, [suiClient, suiWallet])

  return {
    suiWallet,
    suiClient,
    signAndExecute,
    signPersonalMessage,
    refresh,
    generate,
    importSecret,
    reset,
  }
}
