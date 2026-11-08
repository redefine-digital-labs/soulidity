import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'
import { getSuiGrpcFullnodeUrl } from '@soulidity/sdk'
import { withPackageObjectIdentity } from '../sui/package-object-client'

/** Public original/current reads only; constructed on explicit query/cancel. */
export function createIncomeWithdrawalOriginalClient(signal: AbortSignal) {
  return withPackageObjectIdentity(new SuiGrpcClient({ network: 'mainnet', transport: new GrpcWebFetchTransport({
    baseUrl: getSuiGrpcFullnodeUrl('mainnet'), abort: signal,
  }) }), signal)
}
