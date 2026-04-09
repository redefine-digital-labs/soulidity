import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSignRawHash } from '@privy-io/react-auth/extended-chains'
import { useSuiClient } from '@mysten/dapp-kit'
import { bcs } from '@mysten/sui/bcs'
import { messageWithIntent, toSerializedSignature } from '@mysten/sui/cryptography'
import { publicKeyFromRawBytes } from '@mysten/sui/verify'
import type { Transaction } from '@mysten/sui/transactions'
import { blake2b } from '@noble/hashes/blake2.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SuiTxResult = any

export function getPrivySuiWallet(privyUser: {
  linkedAccounts?: Array<{ type: string; chainType?: string; address?: string; publicKey?: string }>
} | null): { address: string; publicKey: string } | null {
  if (!privyUser?.linkedAccounts) return null
  const wallet = privyUser.linkedAccounts.find(
    (account) => account.type === 'wallet' && account.chainType === 'sui',
  ) as { address?: string; publicKey?: string } | undefined
  if (!wallet?.address || !wallet?.publicKey) return null
  return { address: wallet.address, publicKey: wallet.publicKey }
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
  return (`0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`) as `0x${string}`
}

export function normalizePrivyEd25519PublicKeyBytes(publicKeyHex: string): Uint8Array {
  const publicKeyBytes = hexToBytes(publicKeyHex)
  const normalizedBytes = publicKeyBytes.length === 33 ? publicKeyBytes.slice(1) : publicKeyBytes
  if (normalizedBytes.length !== 32) {
    throw new Error('Privy Sui public key must be 32 bytes after normalization')
  }
  return normalizedBytes
}

function toSuiPersonalMessageBytes(message: Uint8Array) {
  return bcs.byteVector().serialize(message).toBytes()
}

async function waitForTransactionBestEffort(client: ReturnType<typeof useSuiClient>, digest: string) {
  try {
    await client.waitForTransaction({ digest })
  } catch (error) {
    console.warn('[sui] Transaction confirmation polling failed', { digest, error })
  }
}

export function usePrivySuiSign() {
  const { user: privyUser } = usePrivy()
  const { signRawHash } = useSignRawHash()
  const suiClient = useSuiClient()

  const suiWallet = getPrivySuiWallet(privyUser)

  const signDigestWithPrivy = useCallback(async (digestHex: `0x${string}`) => {
    if (!suiWallet) {
      throw new Error('No Sui wallet found in Privy account')
    }

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
  }, [signRawHash, suiWallet])

  const signAndExecute = useCallback(async (tx: Transaction): Promise<SuiTxResult> => {
    if (!suiWallet) {
      throw new Error('No Sui wallet found in Privy account')
    }

    tx.setSender(suiWallet.address)
    const rawBytes = await tx.build({ client: suiClient })
    const intentMessage = messageWithIntent('TransactionData', rawBytes)
    const digestHex = bytesToHex(blake2b(intentMessage, { dkLen: 32 }))
    const serializedSig = await signDigestWithPrivy(digestHex)

    const result = await suiClient.executeTransactionBlock({
      transactionBlock: Buffer.from(rawBytes).toString('base64'),
      signature: serializedSig,
      options: { showEffects: true, showInput: true, showObjectChanges: true, showEvents: true },
    })

    await waitForTransactionBestEffort(suiClient, result.digest)
    return result
  }, [signDigestWithPrivy, suiClient, suiWallet])

  const signPersonalMessage = useCallback(async (message: Uint8Array) => {
    const intentMessage = messageWithIntent('PersonalMessage', toSuiPersonalMessageBytes(message))
    const digest = blake2b(intentMessage, { dkLen: 32 })
    return signDigestWithPrivy(bytesToHex(digest))
  }, [signDigestWithPrivy])

  return { suiWallet, signAndExecute, signPersonalMessage, suiClient }
}
