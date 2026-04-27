import { verifyPersonalMessageSignature as verifyPersonalMessageSignatureRaw } from '@mysten/sui/verify'

import { suiClient } from '@/lib/sui'

export function verifyPersonalMessageSignature(
  message: Uint8Array,
  signature: string,
  options?: { address?: string },
) {
  return verifyPersonalMessageSignatureRaw(message, signature, {
    client: suiClient,
    ...options,
  })
}
