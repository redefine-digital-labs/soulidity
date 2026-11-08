import {SuiGrpcClient} from '@mysten/sui/grpc'
import {GrpcWebFetchTransport} from '@protobuf-ts/grpcweb-transport'
import {getSuiGrpcFullnodeUrl} from '@soulidity/sdk'
import {withPackageObjectIdentity} from '../sui/package-object-client'

/** Original V2 records are mainnet-only. Construct on explicit original query,
 * never at import/discovery, and never use a current paid release/provider. */
export function createNativePublicReadPaidOriginalClientV2(signal:AbortSignal){
 return withPackageObjectIdentity(new SuiGrpcClient({network:'mainnet',transport:new GrpcWebFetchTransport({baseUrl:getSuiGrpcFullnodeUrl('mainnet'),abort:signal})}),signal)
}
