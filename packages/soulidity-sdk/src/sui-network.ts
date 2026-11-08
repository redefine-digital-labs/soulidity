export type SupportedSuiNetwork = 'testnet' | 'mainnet'

export function resolveSuiNetwork(value: string | null | undefined): SupportedSuiNetwork {
  return value === 'mainnet' ? 'mainnet' : 'testnet'
}
