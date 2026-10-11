import { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuiGrpcJsonRpcCompatClient, getSuiGrpcFullnodeUrl,
  type createSuiGrpcCompatClient, type SuiGrpcNetwork } from '@soulidity/sdk'
import { withPackageObjectIdentity } from './package-object-client'

/** One adapter per provider client (page/network session), not per render or
 * per package read. Its explicit transport budgets span that same lifetime;
 * changing networks constructs a new client. No identity cache or retries. */
export function createBrowserSuiClient(network: SuiGrpcNetwork): ReturnType<typeof createSuiGrpcCompatClient> {
  const grpc = withPackageObjectIdentity(new SuiGrpcClient({ network, baseUrl: getSuiGrpcFullnodeUrl(network) }))
  // Same dapp-kit v1 typing bridge as the existing SDK factory. Preserve its
  // wallet/legacy method implementation; only inject the normalized gRPC client.
  return new SuiGrpcJsonRpcCompatClient(network, grpc) as unknown as ReturnType<typeof createSuiGrpcCompatClient>
}
