import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js'

const DEFAULT_NETWORK = 'devnet'
const MAINNET_NETWORK = 'mainnet-beta'

function getConfiguredNetwork(): string {
  return process.env.NEXT_PUBLIC_SOLANA_NETWORK || DEFAULT_NETWORK
}

function getDefaultRpcUrl(network: string): string {
  switch (network) {
    case DEFAULT_NETWORK:
    case 'testnet':
    case MAINNET_NETWORK:
      return clusterApiUrl(network)
    default:
      return clusterApiUrl(DEFAULT_NETWORK)
  }
}

export const solanaNetwork = getConfiguredNetwork()
const rpcUrl = process.env.SOLANA_RPC_URL || getDefaultRpcUrl(solanaNetwork)

const globalForSolana = globalThis as typeof globalThis & {
  solanaConnection?: Connection
}

export const solanaConnection =
  globalForSolana.solanaConnection ?? new Connection(rpcUrl, 'confirmed')

if (process.env.NODE_ENV !== 'production') {
  globalForSolana.solanaConnection = solanaConnection
}

export const USDC_MINT: Record<string, string> = {
  [MAINNET_NETWORK]: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
}

export const USDC_DECIMALS = 6
type X402SolanaNetwork = `solana:${string}`
const MICROS_PER_USD = BigInt(1_000_000)
const LAMPORTS_PER_SOL = BigInt(1_000_000_000)

const X402_SOLANA_NETWORKS: Record<string, X402SolanaNetwork> = {
  [MAINNET_NETWORK]: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
}

export function getUsdcMint(): PublicKey {
  const mint = USDC_MINT[solanaNetwork]
  if (!mint) {
    throw new Error(`No USDC mint configured for Solana network: ${solanaNetwork}`)
  }
  return new PublicKey(mint)
}

export function getX402SolanaNetwork(): X402SolanaNetwork {
  return X402_SOLANA_NETWORKS[solanaNetwork] || X402_SOLANA_NETWORKS.devnet
}

export function usdCentsToUsdcAtomicUnits(cents: number): bigint {
  return BigInt(cents) * BigInt(10_000)
}

export function usdCentsToLamports(cents: number, solPriceUsd: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('USD cents must be a non-negative safe integer')
  }
  if (!Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    throw new RangeError('SOL price must be a positive finite number')
  }

  const solPriceMicros = Math.round(solPriceUsd * Number(MICROS_PER_USD))
  if (!Number.isSafeInteger(solPriceMicros) || solPriceMicros <= 0) {
    throw new RangeError('SOL price must be representable in micro-USD precision')
  }

  const usdMicros = BigInt(cents) * (MICROS_PER_USD / BigInt(100))
  return ceilDiv(usdMicros * LAMPORTS_PER_SOL, BigInt(solPriceMicros))
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator
}
