import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'

const globalForSui = globalThis as unknown as { suiClient: SuiJsonRpcClient | undefined }

export const suiClient = globalForSui.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network })

if (process.env.NODE_ENV !== 'production') globalForSui.suiClient = suiClient
