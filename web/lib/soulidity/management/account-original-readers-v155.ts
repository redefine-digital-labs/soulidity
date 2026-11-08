import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'

/** Freeze query invocation identity before the first asynchronous boundary.
 * No lazy Proxy, latest-object helper, executor, signer or broadcast capability.
 * Native generated clients retain their real receiver; caller-owned objects
 * are never frozen or changed. Initial functions/transport remain trusted, and
 * canonical bytes/hash/type/checkpoint validation still belongs to each reader. */
export function captureAccountOriginalReadClientV155(source: SuiGrpcClient, signal?: AbortSignal): SuiGrpcClient {
  const service = source.ledgerService, core = source.core
  const getServiceInfo = service.getServiceInfo, getObject = service.getObject
  const getTransaction = service.getTransaction, getCheckpoint = service.getCheckpoint
  if (![getServiceInfo, getObject, getTransaction, getCheckpoint].every(method => typeof method === 'function')) throw Error('ACCOUNT_ORIGINAL_READ_V155_LEDGER_CAPABILITY_REQUIRED')
  const ledgerService = Object.freeze({ getServiceInfo: getServiceInfo.bind(service), getObject: getObject.bind(service),
    getTransaction: getTransaction.bind(service), getCheckpoint: getCheckpoint.bind(service) })
  // Installed SDK routes zkLogin signature verification through core only.
  // Preserve that original readonly capability if supplied; never fall back to
  // a newly installed verifier or an implicit external client after awaiting.
  // GrpcCoreClient's bound method still reads its private client's mutable
  // signatureVerificationService later. Capture that leaf RPC too, and use the
  // installed SDK's exact message encoding/response mapping without that lookup.
  const signatureService = source.signatureVerificationService, verifySignature = signatureService?.verifySignature
  const originalVerify = typeof verifySignature === 'function' ? verifySignature.bind(signatureService) : null
  const verifyZkLoginSignature = core?.verifyZkLoginSignature
  const unavailable = () => { throw Error('ACCOUNT_ORIGINAL_READ_V155_ZKLOGIN_CAPABILITY_UNAVAILABLE') }
  const verify: SuiGrpcClient['core']['verifyZkLoginSignature'] = originalVerify ? async options => {
    if (!['PersonalMessage', 'TransactionData'].includes(options.intentScope)) throw Error('ACCOUNT_ORIGINAL_READ_V155_SIGNATURE_INTENT')
    const bytes = fromBase64(options.bytes), abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)])
    abort.throwIfAborted()
    const { response } = await originalVerify({ message: { name: options.intentScope,
      value: options.intentScope === 'PersonalMessage' ? bcs.byteVector().serialize(bytes).toBytes() : bytes },
      signature: { bcs: { value: fromBase64(options.signature) }, signature: { oneofKind: undefined } }, address: options.address, jwks: [] }, { abort })
    abort.throwIfAborted()
    return { success: response.isValid === true, errors: response.reason ? [response.reason] : [] }
  } : !signatureService && typeof verifyZkLoginSignature === 'function' ? verifyZkLoginSignature.bind(core) : unavailable
  const capturedCore = Object.freeze({ verifyZkLoginSignature: verify })
  // Existing historical helpers type their narrow readonly use as SuiGrpcClient.
  // Deliberately provide only those capabilities at runtime, not a forwarding
  // client facade that could expose current reads or execution methods.
  return Object.freeze({ ledgerService, core: capturedCore }) as unknown as SuiGrpcClient
}
