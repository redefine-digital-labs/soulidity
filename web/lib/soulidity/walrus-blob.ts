import { resolveSuiNetwork } from '@/lib/sui-network'

export const TESTNET_WALRUS_BLOB_TYPE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66::blob::Blob'
export const MAINNET_WALRUS_BLOB_TYPE = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob'

export function resolveWalrusBlobType(network = process.env.NEXT_PUBLIC_SUI_NETWORK): string {
  return resolveSuiNetwork(network?.trim().toLowerCase()) === 'mainnet'
    ? MAINNET_WALRUS_BLOB_TYPE
    : TESTNET_WALRUS_BLOB_TYPE
}
