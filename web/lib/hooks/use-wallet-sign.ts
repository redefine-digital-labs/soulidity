'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  useCurrentAccount,
  useCurrentWallet,
  useSignPersonalMessage,
  useSignTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import type { Transaction } from '@mysten/sui/transactions'
import {
  resolveSuiTxResultWithEffects,
  type SuiTxResultWithEffects,
} from '@soulidity/sdk'
import { enhanceSoulidityError } from '@soulidity/sdk'
import { useCommittedSession } from './use-committed-session'

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
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { mutateAsync: signTransactionMutation } = useSignTransaction()
  const { mutateAsync: signPersonalMessageMutation } = useSignPersonalMessage()
  const session = useCommittedSession('wallet-sign', currentAccount, suiClient, currentWallet)

  const suiWallet = currentAccount?.address ? { address: currentAccount.address } : null
  const currentAccountRef = useRef(currentAccount)
  useLayoutEffect(() => {
    currentAccountRef.current = currentAccount
    return () => { currentAccountRef.current = null }
  }, [currentAccount])
  const getWalletAddress = useCallback(() => currentAccountRef.current?.address ?? null, [])
  const suiGrpcClient = (suiClient as unknown as { grpc: SuiGrpcClient }).grpc

  /** Signing-only path for durable operation controllers: never broadcast before
   * they have verified and persisted the exact wallet-returned signature. */
  const signTransaction = useCallback(async (tx: Transaction) => {
    const lease = session.capture()
    const guard = () => { if (!lease?.matches()) throw new Error('Wallet signing session changed') }
    guard()
    const account = currentAccount
    if (!account) throw new Error('Connect a Sui wallet before signing transactions')
    if (tx.getData().sender && tx.getData().sender !== account.address) throw new Error('Prepared transaction belongs to another wallet')
    tx.setSenderIfNotSet(account.address)
    const result = await signTransactionMutation({ transaction: tx, account })
    guard(); return result
  }, [session, currentAccount, signTransactionMutation])

  const signAndExecute = useCallback(async (tx: Transaction): Promise<SuiTxResultWithEffects> => {
    const lease = session.capture()
    const guard = () => { if (!lease?.matches()) throw new Error('Wallet signing session changed') }
    guard()
    if (!currentAccount) {
      throw new Error('Connect a Sui wallet before signing transactions')
    }
    tx.setSenderIfNotSet(currentAccount.address)
    // Intentionally do not call `setGasBudget`. Mainnet PTB2 (mint + N×certify
    // + 5-8 shared objects + Seal/ContentAccessList) regularly exceeds any
    // safe hardcoded budget; the wallet's own dry-run is the authoritative
    // gas estimator for the signing flow.

    try {
      const { bytes, signature } = await signTransactionMutation({
        transaction: tx,
        account: currentAccount,
      })
      guard()

      const result = await resolveSuiTxResultWithEffects(suiClient, await suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: {
          showEffects: true,
          showInput: true,
          showObjectChanges: true,
          showEvents: true,
        },
      }))

      await waitForTransactionBestEffort(suiClient, result.digest)
      return result
    } catch (error) {
      // Re-throw Soulidity aborts with a user-facing message + recovery
      // hint. Non-Soulidity errors pass through unchanged.
      throw enhanceSoulidityError(error)
    }
  }, [session, currentAccount, signTransactionMutation, suiClient])

  const signPersonalMessage = useCallback(async (message: Uint8Array): Promise<string> => {
    const lease = session.capture()
    const guard = () => { if (!lease?.matches()) throw new Error('Wallet signing session changed') }
    guard()
    if (!currentAccount) {
      throw new Error('Connect a Sui wallet before signing messages')
    }
    const { signature } = await signPersonalMessageMutation({
      message,
      account: currentAccount,
    })
    guard()
    return signature
  }, [session, currentAccount, signPersonalMessageMutation])

  return { suiWallet, walletAccount: currentAccount, currentWallet,
    signAndExecute, signPersonalMessage, suiClient, suiGrpcClient, signTransaction, getWalletAddress }
}
