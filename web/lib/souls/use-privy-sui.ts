/**
 * Hook for signing and executing Sui transactions via Privy embedded wallet.
 * Reusable across publish, purchase, and allowlist flows.
 */

import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSignRawHash } from '@privy-io/react-auth/extended-chains'
import { useSuiClient } from '@mysten/dapp-kit'
import { bcs } from '@mysten/sui/bcs'
import { messageWithIntent, toSerializedSignature } from '@mysten/sui/cryptography'
import { publicKeyFromRawBytes } from '@mysten/sui/verify'
import { blake2b } from '@noble/hashes/blake2.js'
import type { Transaction } from '@mysten/sui/transactions'
import { waitForTransactionBestEffort } from '@web/lib/souls/tx-confirmation'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SuiTxResult = any

/** Extract Sui embedded wallet from Privy user's linked accounts */
export function getPrivySuiWallet(privyUser: {
  linkedAccounts?: Array<{ type: string; chainType?: string; address?: string; publicKey?: string }>
} | null): { address: string; publicKey: string } | null {
  if (!privyUser?.linkedAccounts) return null
  const w = privyUser.linkedAccounts.find(
    (a) => a.type === 'wallet' && a.chainType === 'sui',
  ) as { address?: string; publicKey?: string } | undefined
  if (!w?.address || !w?.publicKey) return null
  return { address: w.address, publicKey: w.publicKey }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Invalid hex string')
  }

  const bytes = new Uint8Array(clean.length / 2)
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16)
  }

  return bytes
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

export { hexToBytes }

export function normalizePrivyEd25519PublicKeyBytes(publicKeyHex: string): Uint8Array {
  const publicKeyBytes = hexToBytes(publicKeyHex)
  const normalizedBytes = publicKeyBytes.length === 33 ? publicKeyBytes.slice(1) : publicKeyBytes
  if (normalizedBytes.length !== 32) {
    throw new Error('Privy Sui public key must be 32 bytes after normalization')
  }
  return normalizedBytes
}

export function toSuiPersonalMessageBytes(message: Uint8Array): Uint8Array {
  return bcs.byteVector().serialize(message).toBytes()
}

export function usePrivySuiSign() {
  const { user: privyUser } = usePrivy()
  const { signRawHash } = useSignRawHash()
  const suiClient = useSuiClient()

  const suiWallet = getPrivySuiWallet(privyUser)

  const signDigestWithPrivy = useCallback(
    async (digestHex: `0x${string}`): Promise<string> => {
      if (!suiWallet) throw new Error('No Sui wallet found in Privy account')

      const { signature: rawSigHex } = await signRawHash({
        address: suiWallet.address,
        chainType: 'sui',
        hash: digestHex,
      })

      const rawSigBytes = hexToBytes(rawSigHex)
      const pkBytes = normalizePrivyEd25519PublicKeyBytes(suiWallet.publicKey)
      const pubKey = publicKeyFromRawBytes('ED25519', pkBytes)
      return toSerializedSignature({
        signature: rawSigBytes,
        signatureScheme: 'ED25519',
        publicKey: pubKey,
      })
    },
    [signRawHash, suiWallet],
  )

  const signAndExecute = useCallback(
    async (tx: Transaction): Promise<SuiTxResult> => {
      if (!suiWallet) throw new Error('No Sui wallet found in Privy account')

      tx.setSender(suiWallet.address)

      // Build TX bytes
      const rawBytes = await tx.build({ client: suiClient })

      // Intent message → blake2b hash
      const intentMessage = messageWithIntent('TransactionData', rawBytes)
      const digest = blake2b(intentMessage, { dkLen: 32 })
      const digestHex = bytesToHex(digest)
      const serializedSig = await signDigestWithPrivy(digestHex)

      // Execute
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: Buffer.from(rawBytes).toString('base64'),
        signature: serializedSig,
        options: { showEffects: true, showInput: true, showObjectChanges: true, showEvents: true },
      })

      // Wait for the transaction to be confirmed so subsequent TXs see updated object versions
      await waitForTransactionBestEffort(suiClient, result.digest)

      return result
    },
    [signDigestWithPrivy, suiClient, suiWallet],
  )

  const signPersonalMessage = useCallback(
    async (message: Uint8Array): Promise<string> => {
      const intentMessage = messageWithIntent('PersonalMessage', toSuiPersonalMessageBytes(message))
      const digest = blake2b(intentMessage, { dkLen: 32 })
      return signDigestWithPrivy(bytesToHex(digest))
    },
    [signDigestWithPrivy],
  )

  return { suiWallet, signAndExecute, signPersonalMessage }
}
