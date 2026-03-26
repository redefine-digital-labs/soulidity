import { verifyTransactionSignature } from '@mysten/sui/verify'

export async function verifyPreparedTransactionSignature(params: {
  txBytesBase64: string
  signature: string
  agentAddress: string
}): Promise<void> {
  await verifyTransactionSignature(
    Buffer.from(params.txBytesBase64, 'base64'),
    params.signature,
    { address: params.agentAddress },
  )
}
