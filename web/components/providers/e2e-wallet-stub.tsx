'use client'

/**
 * Wallet Standard stub used by the E2E test plan.
 *
 * Reads an Ed25519 private key from `localStorage['__E2E_PRIVATE_KEY']` (bech32
 * `suiprivkey…`, base64, or hex), registers a Wallet Standard wallet named
 * "E2E Test Wallet", and signs every personal message / transaction in-process
 * — so dapp-kit's ConnectModal and `useSignTransaction` work without a real
 * browser extension or popup. Switch roles in tests by overwriting
 * `__E2E_PRIVATE_KEY` and reloading.
 *
 * Two-gate guard:
 *   1. `process.env.NODE_ENV === 'development'` — bundle-time gate; the stub
 *      is dead-stripped from production builds.
 *   2. `process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'` — runtime gate enforced
 *      both here and at the mount site in `app-providers.tsx`. A normal
 *      `npm run dev` session does not register the stub even if a stale
 *      `__E2E_PRIVATE_KEY` is sitting in localStorage.
 */

import { useEffect } from 'react'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import { ReadonlyWalletAccount, registerWallet } from '@wallet-standard/wallet'
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base'
import type {
  StandardConnectFeature,
  StandardConnectMethod,
  StandardDisconnectFeature,
  StandardDisconnectMethod,
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
} from '@wallet-standard/features'
import type {
  SuiSignAndExecuteTransactionFeature,
  SuiSignAndExecuteTransactionMethod,
  SuiSignPersonalMessageFeature,
  SuiSignPersonalMessageMethod,
  SuiSignTransactionFeature,
  SuiSignTransactionMethod,
} from '@mysten/wallet-standard'

const E2E_PRIVATE_KEY_STORAGE_KEY = '__E2E_PRIVATE_KEY'
const STUB_WALLET_NAME = 'E2E Test Wallet'

const STUB_ICON: WalletIcon =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNiIgZmlsbD0iIzBmMTcyYSIvPjx0ZXh0IHg9IjEyIiB5PSIxNiIgZm9udC1zaXplPSIxMiIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZmlsbD0iI2Y4ZmFmYyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RTI8L3RleHQ+PC9zdmc+'

const SUPPORTED_CHAINS = ['sui:testnet', 'sui:mainnet', 'sui:devnet', 'sui:localnet'] as const

function decodeEd25519SecretKey(raw: string): Ed25519Keypair {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('E2E private key is empty')

  if (trimmed.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(trimmed)
    return Ed25519Keypair.fromSecretKey(secretKey)
  }

  try {
    const bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0))
    if (bytes.length === 32 || bytes.length === 64) {
      return Ed25519Keypair.fromSecretKey(bytes.slice(0, 32))
    }
  } catch {
    /* not base64 */
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && (trimmed.length === 64 || trimmed.length === 128)) {
    const hex = trimmed.length === 128 ? trimmed.slice(0, 64) : trimmed
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return Ed25519Keypair.fromSecretKey(bytes)
  }

  throw new Error('E2E private key must be bech32 (suiprivkey…), base64, or hex')
}

class E2ETestWallet implements Wallet {
  readonly version = '1.0.0' as const
  readonly name = STUB_WALLET_NAME
  readonly icon = STUB_ICON
  readonly chains = SUPPORTED_CHAINS
  readonly id = 'e2e-test-wallet'

  #keypair: Ed25519Keypair
  #account: ReadonlyWalletAccount
  #suiClient: SuiJsonRpcClient
  #connected = false
  #listeners: Partial<{ [E in StandardEventsNames]: Set<StandardEventsListeners[E]> }> = {}

  constructor(keypair: Ed25519Keypair, network: 'testnet' | 'mainnet') {
    this.#keypair = keypair
    const address = keypair.toSuiAddress()
    const publicKey = keypair.getPublicKey().toRawBytes()
    this.#account = new ReadonlyWalletAccount({
      address,
      publicKey,
      chains: SUPPORTED_CHAINS,
      features: ['sui:signPersonalMessage', 'sui:signTransaction', 'sui:signAndExecuteTransaction'],
      label: `E2E ${address.slice(0, 6)}…${address.slice(-4)}`,
    })
    this.#suiClient = createSuiGrpcCompatClient(network)
  }

  get accounts(): readonly WalletAccount[] {
    return this.#connected ? [this.#account] : []
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SuiSignPersonalMessageFeature &
    SuiSignTransactionFeature &
    SuiSignAndExecuteTransactionFeature {
    return {
      'standard:connect': { version: '1.0.0', connect: this.#connect },
      'standard:disconnect': { version: '1.0.0', disconnect: this.#disconnect },
      'standard:events': { version: '1.0.0', on: this.#on },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: this.#signPersonalMessage },
      'sui:signTransaction': { version: '2.0.0', signTransaction: this.#signTransaction },
      'sui:signAndExecuteTransaction': {
        version: '2.0.0',
        signAndExecuteTransaction: this.#signAndExecuteTransaction,
      },
    }
  }

  #emit<E extends StandardEventsNames>(event: E, ...args: Parameters<StandardEventsListeners[E]>) {
    const listeners = this.#listeners[event]
    if (!listeners) return
    for (const listener of listeners) {
      try {
        ;(listener as (...a: any[]) => void)(...args)
      } catch (err) {
        console.error('[e2e-wallet-stub] listener threw', err)
      }
    }
  }

  #on: StandardEventsOnMethod = (event, listener) => {
    if (!this.#listeners[event]) this.#listeners[event] = new Set() as any
    ;(this.#listeners[event] as Set<typeof listener>).add(listener)
    return () => {
      ;(this.#listeners[event] as Set<typeof listener> | undefined)?.delete(listener)
    }
  }

  #connect: StandardConnectMethod = async () => {
    this.#connected = true
    this.#emit('change', { accounts: this.accounts })
    return { accounts: this.accounts }
  }

  #disconnect: StandardDisconnectMethod = async () => {
    this.#connected = false
    this.#emit('change', { accounts: this.accounts })
  }

  #signPersonalMessage: SuiSignPersonalMessageMethod = async ({ message }) => {
    const { signature } = await this.#keypair.signPersonalMessage(message)
    return { bytes: toBase64(message), signature }
  }

  #buildAndSign = async (transactionInput: { toJSON: () => Promise<string> }) => {
    const json = await transactionInput.toJSON()
    const tx = Transaction.from(json)
    const bytes = await tx.build({ client: this.#suiClient })
    const { signature } = await this.#keypair.signTransaction(bytes)
    return { bytes, signature }
  }

  #signTransaction: SuiSignTransactionMethod = async (input) => {
    const { bytes, signature } = await this.#buildAndSign(input.transaction)
    return { bytes: toBase64(bytes), signature }
  }

  #signAndExecuteTransaction: SuiSignAndExecuteTransactionMethod = async (input) => {
    const { bytes, signature } = await this.#buildAndSign(input.transaction)
    const result = await this.#suiClient.executeTransactionBlock({
      transactionBlock: toBase64(bytes),
      signature,
      options: { showRawEffects: true },
    })
    const rawEffects = (result as { rawEffects?: number[] }).rawEffects
    const effects = rawEffects ? toBase64(new Uint8Array(rawEffects)) : ''
    return {
      bytes: toBase64(bytes),
      signature,
      digest: result.digest,
      effects,
    }
  }
}

let registered = false

function readPrivateKeyFromStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(E2E_PRIVATE_KEY_STORAGE_KEY)
  } catch {
    return null
  }
}

function networkFromEnv(): 'testnet' | 'mainnet' {
  const value = process.env.NEXT_PUBLIC_SUI_NETWORK
  return value === 'mainnet' ? 'mainnet' : 'testnet'
}

export function E2EWalletStub() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (process.env.NEXT_PUBLIC_E2E_TEST_MODE !== '1') return
    if (registered) return

    const raw = readPrivateKeyFromStorage()
    if (!raw) return

    let keypair: Ed25519Keypair
    try {
      keypair = decodeEd25519SecretKey(raw)
    } catch (err) {
      console.warn('[e2e-wallet-stub] failed to decode private key', err)
      return
    }

    try {
      registerWallet(new E2ETestWallet(keypair, networkFromEnv()))
      registered = true
    } catch (err) {
      console.error('[e2e-wallet-stub] registerWallet failed', err)
    }
    // Wallet Standard has no deregister hook; role switches reload the page.
  }, [])

  return null
}
