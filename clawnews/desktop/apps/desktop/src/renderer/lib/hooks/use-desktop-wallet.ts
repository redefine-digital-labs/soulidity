import { useCallback, useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'

interface DesktopSuiWallet {
  address: string
  publicKey: string
  createdAt: number
}

interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt?: number
}

function normalizeKeypair(value: unknown): DesktopSuiWallet | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AgentKeypairInfo>
  if (typeof candidate.address !== 'string' || typeof candidate.publicKey !== 'string') return null
  return {
    address: candidate.address,
    publicKey: candidate.publicKey,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
  }
}

/**
 * Renderer-side surface for the desktop's local Sui identity.
 *
 * The desktop has exactly one local keypair: the agent keypair, auto-generated
 * on first launch and held encrypted in main via Electron `safeStorage`. After
 * the user runs Link to Web Account, that local address inherits access from
 * the linked web wallet — no separate desktop-only wallet is needed.
 *
 * Returns `{ suiWallet, suiClient, signPersonalMessage }`. Renderer ships raw
 * message bytes to main for signing; the keypair never leaves main.
 */
export function useDesktopWallet() {
  const suiClient = useSuiClient()
  const [suiWallet, setSuiWallet] = useState<DesktopSuiWallet | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchWallet() {
      try {
        const info = await window.electronAPI.loadAgentKeypair()
        if (!cancelled) setSuiWallet(normalizeKeypair(info))
      } catch (error) {
        console.warn('[wallet] failed to read agent keypair', error)
        if (!cancelled) setSuiWallet(null)
      }
    }

    fetchWallet()
    return () => {
      cancelled = true
    }
  }, [])

  const signPersonalMessage = useCallback(async (message: Uint8Array): Promise<string> => {
    if (!suiWallet) {
      throw new Error('Local Sui address is not ready yet')
    }
    const result = await window.electronAPI.agentSignPersonalMessage(message)
    return result.signature
  }, [suiWallet])

  return {
    suiWallet,
    suiClient,
    signPersonalMessage,
  }
}
