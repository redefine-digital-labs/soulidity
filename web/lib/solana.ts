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
