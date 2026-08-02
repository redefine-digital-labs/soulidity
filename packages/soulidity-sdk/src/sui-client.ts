import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

import { createSuiGrpcCompatClient } from './sui-grpc-compat'

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'

const globalForSui = globalThis as unknown as { suiClient: SuiJsonRpcClient | undefined }

export const suiClient = globalForSui.suiClient ?? createSuiGrpcCompatClient(network)

if (process.env.NODE_ENV !== 'production') globalForSui.suiClient = suiClient
