import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'

const globalForSui = globalThis as unknown as { suiClient: SuiClient | undefined }

export const suiClient = globalForSui.suiClient ?? new SuiClient({ url: getFullnodeUrl(network) })

if (process.env.NODE_ENV !== 'production') globalForSui.suiClient = suiClient
